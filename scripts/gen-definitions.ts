#!/usr/bin/env tsx
/**
 * Generates the scoring definitions in packages/scoring/definitions/ from the
 * template dump (templates/tikmi/<year>/_dump/*.json, made by
 * scripts/dump-template.py). The output is committed and reviewed as code;
 * nothing regenerates it at run time.
 *
 * Fails loudly (exit 1, with every problem listed) when:
 * - a formula does not parse, or uses a function the evaluator lacks;
 * - a formula reads a sheet that is neither modelled nor an external table;
 * - a formula reads a cell that is neither a formula, a declared input nor a
 *   template constant in an expected place (e.g. an undeclared PJP answer);
 * - a sheet-1 indicator's M or O formula matches none of the known kinds;
 * - an indicator ID repeats, unless listed in KNOWN_ISSUES.
 *
 * Usage: npx tsx scripts/gen-definitions.ts [--year=2025]
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { formatAddress, functionNames, parseAddress, parseFormula, references, type Node } from "../packages/scoring/src/formula/parse";
import { SUPPORTED_FUNCTIONS } from "../packages/scoring/src/formula/functions";
import { rowHash, type MrDefinition, type ItDefinition, type IndicatorDef, type ItSheetDef } from "../packages/scoring/src/definitions";

const year = process.argv.find((a) => a.startsWith("--year="))?.slice(7) ?? "2025";
const TEMPLATE_DIR = resolve(process.env.TIKMI_TEMPLATES_DIR ?? `templates/tikmi/${year}`);
const DUMP_DIR = resolve(TEMPLATE_DIR, "_dump");
const OUT_DIR = resolve("packages/scoring/definitions");

interface DumpCell {
  v?: unknown;
  f?: string | { arrayFormula: string; ref: string };
}
interface DumpSheet {
  state: string;
  maxRow: number;
  maxColumn: number;
  cells: Record<string, DumpCell>;
}
interface Dump {
  file: string;
  sheetOrder: string[];
  sheets: Record<string, DumpSheet>;
}

const problems: string[] = [];
const fail = (msg: string) => problems.push(msg);

/** Template facts that would otherwise fail the generator, each reviewed. */
const KNOWN_ISSUES: Record<string, string[]> = {
  "mr-b3": ["duplicate indicator I.STG.2.3"],
};

async function loadDump(file: string): Promise<Dump> {
  return JSON.parse(await readFile(resolve(DUMP_DIR, file.replace(/\.xlsx$/, ".json")), "utf8"));
}

async function sha256Of(file: string): Promise<string | null> {
  try {
    return createHash("sha256").update(await readFile(resolve(TEMPLATE_DIR, file))).digest("hex");
  } catch {
    return null;
  }
}

function formulaText(c: DumpCell | undefined): string | null {
  if (!c?.f) return null;
  return typeof c.f === "string" ? c.f : c.f.arrayFormula;
}

const rowOf = (addr: string) => Number(/\d+$/.exec(addr)![0]);
const colOf = (addr: string) => /^[A-Z]+/.exec(addr)![0];

function findSheet(d: Dump, prefix: string): string {
  const name = d.sheetOrder.find((n) => n.replace(/\s+/g, " ").startsWith(prefix));
  if (!name) throw new Error(`${d.file}: no sheet starting with "${prefix}"`);
  return name;
}

function cellsIn(range: string): string[] {
  const [a, b] = range.split(":");
  const p = parseAddress(a);
  const q = parseAddress(b ?? a);
  const out: string[] = [];
  for (let r = p.row; r <= q.row; r++) for (let c = p.col; c <= q.col; c++) out.push(formatAddress(c, r));
  return out;
}

// ---------------------------------------------------------------- M / O classification

function hasOp(n: Node, op: string): boolean {
  if (n.t === "bin") return n.op === op || hasOp(n.a, op) || hasOp(n.b, op);
  if (n.t === "fn") return n.args.some((a) => hasOp(a, op));
  if (n.t === "neg" || n.t === "pct") return hasOp(n.a, op);
  return false;
}
function hasArith(n: Node): boolean {
  return ["+", "-", "*", "/"].some((op) => hasOp(n, op));
}
function refCells(n: Node, sheet: string): string[] {
  const out: string[] = [];
  for (const r of references(n)) {
    if (r.t === "ref") out.push(`${r.sheet ?? sheet}!${formatAddress(r.col, r.row)}`);
    else if (r.t === "range" && Number.isFinite(r.row2)) for (let row = r.row1; row <= r.row2; row++) for (let c = r.col1; c <= r.col2; c++) out.push(`${r.sheet ?? sheet}!${formatAddress(c, row)}`);
  }
  return [...new Set(out)];
}

function classifyM(ast: Node, sheet: string): IndicatorDef["mKind"] | null {
  const refs = refCells(ast, sheet);
  const fns = functionNames(ast);
  if (refs.some((r) => r.endsWith("!D8"))) return "periodDivisor";
  if (hasOp(ast, "/")) return fns.has("COUNTIF") || fns.has("COUNTBLANK") || fns.has("COUNTA") ? "countRatio" : "ratio";
  if (!hasArith(ast) && refs.length === 1) return "passthrough";
  if (fns.has("COUNTIF") || fns.has("COUNTA")) return "count";
  if (hasArith(ast) || fns.has("SUM")) return "sum";
  if (fns.has("MAX") || fns.has("MIN")) return "minmax";
  if (!hasArith(ast) && refs.every((r) => /!H\d+$/.test(r))) return "choice";
  return null;
}

/** O on row r reading M r and M r+1 only (two indicators rated together). */
function classifyPair(ast: Node, sheet: string, row: number): "pairFirst" | null {
  const refs = refCells(ast, sheet).sort();
  const want = [`${sheet}!M${row}`, `${sheet}!M${row + 1}`].sort();
  return refs.length === 2 && refs[0] === want[0] && refs[1] === want[1] ? "pairFirst" : null;
}

function classifyO(ast: Node, sheet: string, mCell: string): IndicatorDef["oKind"] | null {
  const refs = refCells(ast, sheet);
  if (refs.length === 1 && refs[0] === `${sheet}!${mCell}`) return "band";
  if (refs.every((r) => /!H\d+$/.test(r) || r === `${sheet}!${mCell}`)) return "direct";
  return null;
}

// ---------------------------------------------------------------- MR

interface InputDecl {
  sheet: string;
  cells: string[];
}

/** Cells -> A1 ranges, merging runs of consecutive rows in one column ("F19", "F20", "F21" -> "F19:F21"). */
function toRanges(cells: string[]): string[] {
  const byCol = new Map<string, number[]>();
  for (const a of cells) {
    const col = colOf(a);
    if (!byCol.has(col)) byCol.set(col, []);
    byCol.get(col)!.push(rowOf(a));
  }
  const out: string[] = [];
  for (const [col, rows] of [...byCol.entries()].sort(([a], [b]) => (a.length - b.length) || a.localeCompare(b))) {
    rows.sort((a, b) => a - b);
    let start = rows[0];
    let prev = rows[0];
    for (const r of [...rows.slice(1), Infinity]) {
      if (r === prev + 1) {
        prev = r;
        continue;
      }
      out.push(start === prev ? `${col}${start}` : `${col}${start}:${col}${prev}`);
      start = prev = r;
    }
  }
  return out;
}

async function genMr(bundling: 2 | 3): Promise<MrDefinition> {
  const kkFile = `Nama PSP LSB Bundling ${bundling}_Kertas Kerja M Pengawas_Posisi.xlsx`;
  const pjpFile = `Nama PSP LSB Bundling ${bundling}_Self Asesmen M_Posisi.xlsx`;
  const kk = await loadDump(kkFile);
  const pj = await loadDump(pjpFile);
  const tag = `mr-b${bundling}`;
  const known = new Set(KNOWN_ISSUES[tag] ?? []);

  const S = {
    risiko: findSheet(kk, "1 - Asesmen Risiko"),
    tkmr: findSheet(kk, "2 -"),
    permodalan: findSheet(kk, "3 -"),
    form: findSheet(kk, "4 - Form Penilaian"),
    lamp1: findSheet(kk, "Lamp1."),
    dropdown: findSheet(kk, "DropDown List"),
  };
  const EXTERNAL = ["Sumber BI 1 Tahun", "Sumber BI (6 Bulan)", "Lamp. PJP"];
  const modelled = Object.values(S);

  // ---- inputs (never baked in as constants)
  const s1 = kk.sheets[S.risiko].cells;
  const p1 = pj.sheets[findSheet(pj, "1 - Asesmen Risiko")].cells;
  const pjpRows = Object.keys(p1)
    .filter((a) => colOf(a) === "B" && /^R\./.test(String(p1[a].v ?? "")))
    .map(rowOf)
    .sort((a, b) => a - b);
  const inputRows = pjpRows.filter((r) => !formulaText(s1[`H${r}`]));
  // Below the PJP block: ID DATA rows filled from Sumber BI (H = VLOOKUP) and rows the pengawas fills for
  // Bank Indonesia (H typed in the KK, column G "Diisi oleh Bank Indonesia ..."): those are pengawas inputs.
  const pengawasRows = Object.keys(s1)
    .filter((a) => colOf(a) === "B" && rowOf(a) > pjpRows[pjpRows.length - 1] && /^R\./.test(String(s1[a].v ?? "")) && !formulaText(s1[`H${rowOf(a)}`]))
    .map(rowOf)
    .sort((a, b) => a - b);
  const tkmrMax = kk.sheets[S.tkmr].maxRow;
  const tkmrRows: number[] = [];
  for (let r = 19; r <= tkmrMax; r++) tkmrRows.push(r);

  const inputs: InputDecl[] = [
    { sheet: S.risiko, cells: ["D4", "D6", "D7", "D8", "D9", "E9", ...[...inputRows, ...pengawasRows].flatMap((r) => [`H${r}`, `I${r}`])] },
    { sheet: S.tkmr, cells: tkmrRows.flatMap((r) => ["F", "G", "H", "I", "K", "L"].map((c) => `${c}${r}`)).filter((a) => !formulaText(kk.sheets[S.tkmr].cells[a])) },
    { sheet: S.permodalan, cells: [...cellsIn("C6:E6"), ...cellsIn("C8:E10")] },
    { sheet: S.lamp1, cells: cellsIn("E5:L116") },
    { sheet: S.form, cells: cellsIn("B76:L101").filter((a) => !formulaText(kk.sheets[S.form].cells[a])) },
  ];
  const inputSet = new Set(inputs.flatMap((d) => d.cells.map((c) => `${d.sheet}!${c}`)));

  // ---- formulas of modelled sheets
  const formulas: Record<string, string> = {};
  const asts = new Map<string, Node>();
  for (const sheet of modelled) {
    for (const [addr, cell] of Object.entries(kk.sheets[sheet].cells)) {
      const f = formulaText(cell);
      if (!f) continue;
      const ref = `${sheet}!${addr}`;
      try {
        const ast = parseFormula(f);
        for (const fn of functionNames(ast)) if (!SUPPORTED_FUNCTIONS.has(fn)) fail(`${tag} ${ref}: unsupported function ${fn}`);
        for (const r of references(ast)) {
          const s = (r as { sheet?: string }).sheet ?? sheet;
          if (!modelled.includes(s) && !EXTERNAL.includes(s)) fail(`${tag} ${ref}: reads unmodelled sheet "${s}"`);
        }
        asts.set(ref, ast);
        formulas[ref] = f;
      } catch (err) {
        fail(`${tag} ${ref}: ${(err as Error).message}`);
      }
    }
  }

  // ---- constants: every non-formula, non-input cell a formula reads
  const constants: Record<string, string | number | boolean> = {};
  const dims: Record<string, { maxRow: number; maxCol: number }> = {};
  for (const sheet of modelled) dims[sheet] = { maxRow: kk.sheets[sheet].maxRow, maxCol: kk.sheets[sheet].maxColumn };
  const addConstant = (sheet: string, addr: string) => {
    const ref = `${sheet}!${addr}`;
    if (formulas[ref] || inputSet.has(ref)) return;
    const cell = kk.sheets[sheet]?.cells[addr];
    if (cell === undefined || cell.v === null || cell.v === undefined) return;
    const v = cell.v;
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
      fail(`${tag} ${ref}: constant of unexpected type ${typeof v}`);
      return;
    }
    constants[ref] = v;
  };
  for (const [ref, ast] of asts) {
    const sheet = ref.slice(0, ref.lastIndexOf("!"));
    for (const r of references(ast)) {
      const s = r.sheet ?? sheet;
      if (EXTERNAL.includes(s) || !kk.sheets[s]) continue;
      if (r.t === "ref") addConstant(s, formatAddress(r.col, r.row));
      else if (r.t === "range") {
        const row2 = Number.isFinite(r.row2) ? r.row2 : kk.sheets[s].maxRow;
        for (let row = r.row1; row <= row2; row++) for (let c = r.col1; c <= r.col2; c++) addConstant(s, formatAddress(c, row));
      }
    }
  }
  // A PJP answer column showing up as a constant means an input cell is missing from the declaration.
  for (const ref of Object.keys(constants)) {
    const [sheet, addr] = [ref.slice(0, ref.lastIndexOf("!")), ref.slice(ref.lastIndexOf("!") + 1)];
    const col = colOf(addr);
    const row = rowOf(addr);
    if (sheet === S.risiko && (col === "H" || col === "I") && row >= 17) fail(`${tag} ${ref}: sheet-1 answer cell read as a constant (undeclared input)`);
    if (sheet === S.tkmr && ["F", "H", "K", "L"].includes(col) && row >= 19) fail(`${tag} ${ref}: TKMR answer cell read as a constant`);
    if (sheet === S.lamp1 && row >= 5 && row <= 116 && col >= "E" && col <= "L") fail(`${tag} ${ref}: Lamp1 cell read as a constant`);
  }

  // ---- indicators
  const indicators: IndicatorDef[] = [];
  const seen = new Map<string, number>();
  for (const [addr, cell] of Object.entries(s1)) {
    if (colOf(addr) !== "K" || !/^I\./.test(String(cell.v ?? "")) || formulaText(cell)) continue;
    const row = rowOf(addr);
    const id = String(cell.v).trim();
    const mRef = `${S.risiko}!M${row}`;
    const oRef = `${S.risiko}!O${row}`;
    const mAst = asts.get(mRef);
    if (!mAst) {
      fail(`${tag} ${id} (row ${row}): M has no formula`);
      continue;
    }
    // O normally sits on the same row. Two templates quirks: a pair of indicators rated together by one O
    // (I.OPS.2.7/2.8, I.LIQ.1.5/1.6: O on the first row reads both M), and an intermediate value with no
    // rating of its own that another M reads (I.LIQ.3.2 feeds I.LIQ.3.3).
    let oCell: string | null = `O${row}`;
    let oAst = asts.get(oRef);
    let oKind: IndicatorDef["oKind"] | null = null;
    if (oAst) oKind = classifyO(oAst, S.risiko, `M${row}`) ?? classifyPair(oAst, S.risiko, row);
    else {
      const pairO = asts.get(`${S.risiko}!O${row - 1}`);
      const readsMe = (a: Node | undefined) => !!a && refCells(a, S.risiko).includes(mRef);
      if (pairO && readsMe(pairO) && classifyPair(pairO, S.risiko, row - 1)) {
        oCell = `O${row - 1}`;
        oAst = pairO;
        oKind = "pairSecond";
      } else if ([...asts.entries()].some(([r, a]) => r !== mRef && r.startsWith(`${S.risiko}!M`) && readsMe(a))) {
        oCell = null;
        oKind = "intermediate";
      } else fail(`${tag} ${id} (row ${row}): no O formula, and no other cell rates this M`);
    }
    const mKind = classifyM(mAst, S.risiko);
    if (!mKind) fail(`${tag} ${id} (row ${row}): unclassified M formula ${formulas[mRef].slice(0, 160)}`);
    if (!oKind && oAst) fail(`${tag} ${id} (row ${row}): unclassified O formula ${formulas[oRef]?.slice(0, 160)}`);
    if (seen.has(id)) {
      const issue = `duplicate indicator ${id}`;
      if (!known.has(issue)) fail(`${tag} ${issue} (rows ${seen.get(id)} and ${row})`);
    }
    seen.set(id, row);
    const parts = id.split(".");
    indicators.push({
      id,
      row,
      risk: parts[1],
      parameter: parts.slice(0, 3).join("."),
      label: String(s1[`L${row}`]?.v ?? "").trim(),
      bandText: String(s1[`N${row}`]?.v ?? "").trim(),
      mCell: `M${row}`,
      oCell,
      inputs: refCells(mAst, S.risiko).filter((r) => r.startsWith(`${S.risiko}!H`) || r.endsWith("!D8")).map((r) => r.slice(r.lastIndexOf("!") + 1)),
      mKind: mKind ?? "sum",
      oKind: oKind ?? "band",
    });
  }
  indicators.sort((a, b) => a.row - b.row);

  // ---- BI-sourced rows: H formulas that VLOOKUP a Sumber BI sheet
  const biRows = Object.entries(s1)
    .filter(([a, c]) => colOf(a) === "H" && /Sumber BI/.test(formulaText(c) ?? ""))
    .map(([a]) => ({ row: rowOf(a), dataId: String(s1[`B${rowOf(a)}`]?.v ?? "").trim(), label: String(s1[`E${rowOf(a)}`]?.v ?? s1[`D${rowOf(a)}`]?.v ?? "").trim() }))
    .sort((a, b) => a.row - b.row);

  // ---- TKMR questions: rows with a family code in A and a question in C
  const t = kk.sheets[S.tkmr].cells;
  const tkmrQuestions = tkmrRows
    .filter((r) => /^P\d\./.test(String(t[`A${r}`]?.v ?? "")) && String(t[`C${r}`]?.v ?? "").trim())
    .map((r) => ({ row: r, code: String(t[`A${r}`]!.v).trim(), id: String(t[`B${r}`]?.v ?? "").trim() }));

  // ---- the PJP template: what a submission looks like, and where its cells go in the KK
  const pS = {
    risiko: findSheet(pj, "1 - Asesmen Risiko"),
    tkmr: pj.sheetOrder.find((n) => /^2\s*-/.test(n))!,
    permodalan: pj.sheetOrder.find((n) => /^3\s*-/.test(n))!,
    lamp1: findSheet(pj, "Lamp1."),
  };
  const rowsSig = Object.keys(p1)
    .filter((a) => colOf(a) === "B" && /^R\./.test(String(p1[a].v ?? "")))
    .map(rowOf)
    .sort((a, b) => a - b)
    .map((row) => [row, String(p1[`B${row}`].v).trim(), rowHash(["C", "D", "E", "F"].map((c) => p1[`${c}${row}`]?.v))] as [number, string, string]);
  const p2 = pj.sheets[pS.tkmr].cells;
  const pjpTkmr = Object.keys(p2)
    .filter((a) => colOf(a) === "A" && /^P\d\./.test(String(p2[a].v ?? "")) && String(p2[`C${rowOf(a)}`]?.v ?? "").trim())
    .map(rowOf)
    .sort((a, b) => a - b);
  if (pjpTkmr.join() !== tkmrQuestions.map((q) => q.row).join()) fail(`${tag}: TKMR question rows differ between PJP template and KK`);
  // Lamp1: PJP data rows are one lower than the KK's; columns are matched by header text (Bundling 3's PJP template has only 4).
  const pl = pj.sheets[pS.lamp1].cells;
  const kl = kk.sheets[S.lamp1].cells;
  const lampCols: Record<string, string> = {};
  for (const pc of ["E", "F", "G", "H", "I", "J", "K", "L"]) {
    const label = String(pl[`${pc}4`]?.v ?? "").trim();
    if (!label) continue;
    const kc = ["E", "F", "G", "H", "I", "J", "K", "L"].find((c) => String(kl[`${c}4`]?.v ?? "").trim() === label);
    if (!kc) fail(`${tag}: PJP Lamp1 column ${pc} "${label}" has no KK column`);
    else lampCols[pc] = kc;
  }
  for (let r = 5; r <= 116; r++) {
    if (String(kl[`D${r}`]?.v ?? "") !== String(pl[`D${r + 1}`]?.v ?? "")) fail(`${tag}: Lamp1 KK row ${r} / PJP row ${r + 1} name differs`);
  }
  // Sheet 3: PJP rows 7, 9, 10 (KPSP, laba LK-1, laba LK) -> KK rows 6, 8, 9.
  const p3 = pj.sheets[pS.permodalan].cells;
  const k3 = kk.sheets[S.permodalan].cells;
  const permodalanRows: [number, number][] = [[7, 6], [9, 8], [10, 9]];
  for (const [pr, kr] of permodalanRows) {
    const a = String(p3[`B${pr}`]?.v ?? "").toLowerCase();
    const b = String(k3[`B${kr}`]?.v ?? "").toLowerCase();
    const ok = pr === 7 ? /kpsp/.test(a) && /permodalan/.test(b) : a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
    if (!ok) fail(`${tag}: sheet 3 PJP row ${pr} ("${a.slice(0, 40)}") does not match KK row ${kr} ("${b.slice(0, 40)}")`);
  }
  // Values the blank PJP template ships with (it is pre-filled: D4 "Bank of America ...", every TKMR F = 5,
  // placeholder document numbers in G ...). Keyed by KK address, so a submission still holding them can be flagged.
  const defaults: Record<string, string | number | boolean> = {};
  const addDefault = (kkRef: string, c: DumpCell | undefined) => {
    if (!c || formulaText(c) || c.v === null || c.v === undefined || c.v === "") return;
    if (typeof c.v === "string" || typeof c.v === "number" || typeof c.v === "boolean") defaults[kkRef] = c.v;
  };
  for (const a of ["D4", "D6", "D7", "D8", "D9", "E9"]) addDefault(`${S.risiko}!${a}`, p1[a]);
  for (const r of inputRows) for (const c of ["H", "I"]) addDefault(`${S.risiko}!${c}${r}`, p1[`${c}${r}`]);
  for (const r of tkmrRows) for (const c of ["F", "G", "H", "I"]) addDefault(`${S.tkmr}!${c}${r}`, p2[`${c}${r}`]);
  for (const [pr, kr] of permodalanRows) for (const c of ["C", "D"]) addDefault(`${S.permodalan}!${c}${kr}`, p3[`${c}${pr}`]);
  for (let r = 6; r <= 117; r++) for (const [pc, kc] of Object.entries(lampCols)) addDefault(`${S.lamp1}!${kc}${r - 1}`, pl[`${pc}${r}`]);

  const pjpTemplate = {
    templateFile: pjpFile,
    sheets: pS,
    identity: ["D4", "D5", "D6", "D7", "D8", "D9", "E9"],
    rows: rowsSig,
    /** Sheet-1 cells that already hold a formula in the PJP template (so a formula there was not typed by the PJP). */
    formulaCells: Object.keys(p1).filter((a) => formulaText(p1[a])).sort(),
    lamp1: { pjpFirstRow: 6, pjpLastRow: 117, kkRowOffset: -1, columns: lampCols },
    permodalan: Object.fromEntries(permodalanRows.flatMap(([pr, kr]) => [[`C${pr}`, `C${kr}`], [`D${pr}`, `D${kr}`]])),
    defaults,
  };

  const kkSheets = kk.sheetOrder.filter((n) => kk.sheets[n].state === "visible" && !n.startsWith("Sumber BI") && !n.startsWith("Lamp. PJP"));
  return {
    kind: "mr",
    year: Number(year),
    bundling,
    templateFile: kkFile,
    templateSha256: await sha256Of(kkFile),
    sheets: S,
    visibleSheets: kkSheets,
    spec: { sheets: dims, formulas, constants, external: EXTERNAL },
    inputs: inputs.map((d) => ({ sheet: d.sheet, ranges: toRanges(d.cells) })),
    pjpInputRows: { first: pjpRows[0], last: pjpRows[pjpRows.length - 1], rows: inputRows },
    pengawasInputRows: pengawasRows.map((row) => ({ row, dataId: String(s1[`B${row}`]?.v ?? "").trim(), guide: String(s1[`G${row}`]?.v ?? "").trim() })),
    indicators,
    biRows,
    tkmrQuestions,
    pjp: pjpTemplate,
    knownIssues: [...known],
  };
}

// ---------------------------------------------------------------- IT

const IT_PAIRS: { key: string; sm: string; tk: string; pipOnly?: boolean }[] = [
  { key: "General", sm: "Standar Minimum (SM) General", tk: "Tata Kelola (TK) General" },
  { key: "PSD-UE", sm: "SM PSD-UE", tk: "TK PSD-UE" },
  { key: "PSD-APMK", sm: "SM PSD-APMK", tk: "TK PSD-APMK" },
  { key: "PSD-Propchan", sm: "SM PSD-Propchan", tk: "TK PSD-Propchan" },
  { key: "Penerusan TD", sm: "SM Penerusan TD", tk: "TK Penerusan TD" },
  { key: "Penerusan Data", sm: "SM Penerusan Data", tk: "TK Penerusan Data" },
  { key: "TI-SPBI", sm: "SM Inheren TI - SPBI", tk: "TK TI - SPBI" },
  { key: "Infra SP", sm: "SM Infra SP", tk: "TK Infra SP", pipOnly: true },
];

const itIssues = new Set<string>();
/** Component labels as written elsewhere in the IT KK, for a component whose label is missing on a sheet. */
const IT_LABELS: Record<string, string> = {};
const labelFor = (code: string) => IT_LABELS[code];

function itSheet(d: Dump, name: string, pair: string, type: "SM" | "TK", tag: string): ItSheetDef | null {
  const sh = d.sheets[name];
  if (!sh) return null;
  const c = sh.cells;
  const header = ["Variabel", "Komponen", "Pertanyaan/Parameter"];
  header.forEach((h, i) => {
    const got = String(c[`${"ABC"[i]}1`]?.v ?? "").trim();
    if (!got.startsWith(h)) fail(`${tag} ${name}: header ${"ABC"[i]}1 is "${got}", expected "${h}"`);
  });
  const rows: ItSheetDef["rows"] = [];
  let component: { code: string; label: string } | null = null;
  for (let r = 2; r <= sh.maxRow; r++) {
    const b = String(c[`B${r}`]?.v ?? "").trim();
    if (b) {
      // "2. E Kontrol ..." (TK Penerusan Data) has a stray space: tolerated.
      const m = /^(\d)\.\s*([A-H])\.?\s*(.*)$/.exec(b);
      if (!m) {
        fail(`${tag} ${name} B${r}: component label "${b}" does not start with a code like 1.A / 2.H`);
        continue;
      }
      component = { code: `${m[1]}.${m[2]}`, label: m[3].trim() };
      IT_LABELS[component.code] ??= component.label;
    }
    const question = String(c[`C${r}`]?.v ?? "").trim();
    if (!question) continue;
    if (!component) {
      fail(`${tag} ${name} row ${r}: question before any component label`);
      continue;
    }
    const code = /^(\d\.[A-H]\.\d+)/.exec(question)?.[1] ?? null;
    const placeholder = /^N\/?A$/i.test(question);
    // The question's own code decides its component: SM PSD-Propchan lacks the "1.E" label in column B,
    // so rows 1.E.1-1.E.11 sit inside the 1.D block there.
    let comp = component.code;
    if (code && !code.startsWith(component.code + ".")) {
      comp = code.slice(0, 3);
      itIssues.add(`${name}: column B has no "${comp}" label; ${comp} rows taken from their question codes`);
    }
    // Rows without a code that are not "N/A" are explanatory notes ("Pertanyaan 1.F.1 s.d. 1.F.4 mencakup ..."): never scored.
    const note = !code && !placeholder;
    rows.push({ row: r, component: comp, componentLabel: comp === component.code ? component.label : (labelFor(comp) ?? ""), code, na: placeholder || note, ...(note ? { note: true } : {}) });
  }
  const expectedPrefix = type === "SM" ? "1." : "2.";
  for (const row of rows) if (!row.component.startsWith(expectedPrefix)) fail(`${tag} ${name} row ${row.row}: component ${row.component} in a ${type} sheet`);
  return { name, pair, type, rows };
}

async function genIt(): Promise<ItDefinition> {
  const kkFile = "Lampiran 2 Kertas Kerja - Penilaian Keandalan Infrastruktur TI.xlsx";
  const pjpFile = "Nama PSP_Self Asesmen Infrastruktur TI_Posisi.xlsx";
  const kk = await loadDump(kkFile);
  const pj = await loadDump(pjpFile);
  const sheets: ItSheetDef[] = [];
  for (const p of IT_PAIRS) {
    const src = p.pipOnly ? pj : kk;
    for (const [type, name] of [["SM", p.sm], ["TK", p.tk]] as const) {
      const def = itSheet(src, name, p.key, type, "it");
      if (!def) {
        fail(`it: sheet "${name}" missing from ${src.file}`);
        continue;
      }
      // The PJP template must have the same rows as the KK (the parser maps by row).
      if (!p.pipOnly) {
        const pjDef = itSheet(pj, name, p.key, type, "it-pjp");
        const diff = pjDef ? def.rows.filter((r, i) => pjDef.rows[i]?.row !== r.row || pjDef.rows[i]?.component !== r.component).map((r) => r.row) : ["missing"];
        if (diff.length) fail(`it: ${name} rows differ between KK and PJP template: ${diff.slice(0, 10).join(", ")}`);
      }
      sheets.push({ ...def, pipOnly: p.pipOnly ?? false });
    }
  }
  const defaults: Record<string, string | number | boolean> = {};
  for (const sheet of sheets) {
    const c = (pj.sheets[sheet.name] ?? kk.sheets[sheet.name])?.cells ?? {};
    for (const r of sheet.rows) for (const col of ["E", "F", "G"]) {
      const v = c[`${col}${r.row}`];
      if (v && !formulaText(v) && v.v !== null && v.v !== undefined && v.v !== "" && ["string", "number", "boolean"].includes(typeof v.v)) defaults[`${sheet.name}!${col}${r.row}`] = v.v as string | number | boolean;
    }
  }
  return {
    kind: "it",
    year: Number(year),
    templateFile: kkFile,
    templateSha256: await sha256Of(kkFile),
    pjpTemplateFile: pjpFile,
    columns: { nilaiRiil: "E", self: "F", justifikasi: "G", pengawas: "I", justifikasiPengawas: "J" },
    // Fallback only: applicability comes from deriveItApplicability (config/it-applicability-<year>.json).
    defaultApplicable: ["General"],
    knownIssues: [...itIssues],
    pairs: IT_PAIRS.map((p) => ({ key: p.key, sm: p.sm, tk: p.tk, pipOnly: p.pipOnly ?? false })),
    sheets,
    pjpDefaults: defaults,
  };
}

async function main() {
  const out: [string, unknown][] = [];
  for (const b of [2, 3] as const) out.push([`${year}-mr-b${b}.json`, await genMr(b)]);
  out.push([`${year}-it.json`, await genIt()]);
  if (problems.length) {
    console.error(`gen-definitions: ${problems.length} problem(s), nothing written:\n  ` + problems.join("\n  "));
    process.exit(1);
  }
  for (const [file, def] of out) {
    await writeFile(resolve(OUT_DIR, file), JSON.stringify(def, null, 1) + "\n");
    const d = def as { kind: string; indicators?: unknown[]; spec?: { formulas: object; constants: object }; sheets?: unknown[] };
    console.log(
      `${file}: ${d.kind === "mr" ? `${d.indicators!.length} indicators, ${Object.keys(d.spec!.formulas).length} formulas, ${Object.keys(d.spec!.constants).length} constants` : `${d.sheets!.length} sheets`}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
