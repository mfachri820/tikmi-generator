#!/usr/bin/env tsx
/**
 * Random input sets for the engine-vs-Excel parity test (scripts/parity/README.md).
 * Seeded, so a case can be regenerated. Values are steered toward the paths
 * each answer cell's formulas have: the text literals the formulas compare the
 * cell with ("YA", "TIDAK", "YA 24/7", ...), zero, small and large numbers,
 * decimals, "NA", blanks and the occasional unexpected text (Data Invalid).
 *
 * Output: templates/tikmi/<year>/_parity/cases-b<bundling>.json (gitignored).
 * Usage: npx tsx scripts/parity/generate-cases.ts [--cases=12] [--seed=2025]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inputCellRefs, parseFormula, references, splitRef, type MrDefinition, type Node } from "@tikmi/scoring";
import { formatAddress } from "@tikmi/scoring";

const arg = (name: string, d: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? d;
const CASES = Number(arg("cases", "12"));
const SEED = Number(arg("seed", "2025"));
const DIR = resolve(process.env.TIKMI_TEMPLATES_DIR ?? "templates/tikmi/2025");

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function strings(n: Node, out: Set<string>) {
  if (n.t === "str" && n.v && !/^(NA|Belum Diisi|Data Invalid|Perlu Cek Data|N\/A)$/i.test(n.v)) out.add(n.v);
  if (n.t === "fn") n.args.forEach((a) => strings(a, out));
  if (n.t === "bin") {
    strings(n.a, out);
    strings(n.b, out);
  }
  if (n.t === "neg" || n.t === "pct") strings(n.a, out);
}

async function main() {
  await mkdir(resolve(DIR, "_parity"), { recursive: true });
  for (const bundling of [2, 3] as const) {
    const def = JSON.parse(await readFile(resolve("packages/scoring/definitions", `2025-mr-b${bundling}.json`), "utf8")) as MrDefinition;
    const S = def.sheets;

    // Text literals each sheet-1 answer cell is compared with, anywhere in the formulas.
    const literals = new Map<string, Set<string>>();
    for (const [ref, f] of Object.entries(def.spec.formulas)) {
      if (!ref.startsWith(`${S.risiko}!`)) continue;
      const ast = parseFormula(f);
      const lits = new Set<string>();
      strings(ast, lits);
      if (!lits.size) continue;
      for (const r of references(ast)) {
        if (r.t !== "ref" || (r.sheet && r.sheet !== S.risiko)) continue;
        const k = `${S.risiko}!${formatAddress(r.col, r.row)}`;
        if (!literals.has(k)) literals.set(k, new Set());
        for (const l of lits) literals.get(k)!.add(l);
      }
    }

    // PJP names whose Sandi has Sumber BI rows, so the BI-sourced rows get real amounts.
    const dump = JSON.parse(await readFile(resolve(DIR, "_dump", def.templateFile.replace(/\.xlsx$/, ".json")), "utf8"));
    const lamp = dump.sheets["Lamp. PJP"].cells as Record<string, { v: unknown }>;
    const bi = dump.sheets["Sumber BI 1 Tahun"].cells as Record<string, { v: unknown }>;
    const biSandi = new Set(Object.entries(bi).filter(([a]) => a.startsWith("C")).map(([, c]) => String(c.v)));
    const names: string[] = [];
    for (let r = 5; r <= 463; r++) {
      const n = lamp[`D${r}`]?.v;
      const s = lamp[`E${r}`]?.v;
      if (typeof n === "string" && s !== undefined && biSandi.has(String(s))) names.push(n);
    }

    const inputs = [...inputCellRefs(def)];
    const tkmrQ = new Set(def.tkmrQuestions.map((q) => q.row));
    const cases: { seed: number; cells: Record<string, string | number> }[] = [];
    for (let i = 0; i < CASES; i++) {
      const seed = SEED * 100 + bundling * 1000 + i;
      const rnd = mulberry32(seed);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
      const chance = (p: number) => rnd() < p;
      // Some cases are mostly filled, some mostly empty: both ends of the NA / Belum Diisi logic get exercised.
      const fill = [0.35, 0.8, 0.97][i % 3];
      const cells: Record<string, string | number> = {};
      const number = (): number =>
        pick([
          () => 0,
          () => Math.floor(rnd() * 10),
          () => Math.floor(rnd() * 1000),
          () => Math.floor(rnd() * 1e9),
          () => Math.round(rnd() * 1e12) / 100,
          () => Math.round(rnd() * 10000) / 100,
          () => Math.round(rnd() * 100) / 100,
        ])();

      cells[`${S.risiko}!D4`] = pick(names);
      cells[`${S.risiko}!D6`] = pick(["Lembaga Selain Bank", "Lembaga Selain Bank", "Bank", "Lembaga Remitansi"]);
      cells[`${S.risiko}!D7`] = chance(0.85) ? bundling : pick([1, 2, 3]);
      cells[`${S.risiko}!D8`] = pick(["PSP Utama", "PSP Selain PSP Utama", "Belum Diketahui"]);
      cells[`${S.risiko}!D9`] = pick(["1 Januari - 31 Desember", "1 Januari- 30 Juni", "1 Juli - 31 Desember"]);
      cells[`${S.risiko}!E9`] = pick([2025, 2025, 2026]);

      for (const ref of inputs) {
        const { sheet, col, row } = splitRef(ref);
        const letter = formatAddress(col, row).replace(/\d+/, "");
        if (ref in cells) continue;
        if (sheet === S.risiko) {
          if (letter === "I") {
            if (chance(0.1)) cells[ref] = "penjelasan";
            continue;
          }
          if (letter !== "H" || !chance(fill)) continue;
          const lits = [...(literals.get(ref) ?? [])];
          const r = rnd();
          if (r < 0.1) cells[ref] = "NA";
          else if (r < 0.13) cells[ref] = "tidak jelas";
          else if (lits.length && r < 0.6) cells[ref] = pick(lits);
          else cells[ref] = number();
        } else if (sheet === S.tkmr) {
          if (letter === "F" && tkmrQ.has(row) && chance(fill)) cells[ref] = chance(0.1) ? "NA" : pick([1, 2, 3, 4, 5]);
          else if (letter === "L" && tkmrQ.has(row) && chance(fill * 0.7)) cells[ref] = pick([1, 2, 3, 4, 5]);
          else if (letter === "K" && tkmrQ.has(row) && chance(fill * 0.5)) cells[ref] = pick(["Memadai", "Cukup Memadai", "Tidak Memadai"]);
          else if (letter === "H" && chance(fill * 0.3)) cells[ref] = pick(["Ada - Eksisting", "Ada - Baru", "Tidak Ada", "NA"]);
        } else if (sheet === S.permodalan) {
          if (formatAddress(col, row) === "E6" && chance(0.9)) cells[ref] = pick([1, 2, 3, 4, 5]);
        } else if (sheet === S.lamp1) {
          if (chance(0.02 * fill)) cells[ref] = Math.floor(rnd() * 6);
        }
      }
      cases.push({ seed, cells });
    }
    const out = resolve(DIR, "_parity", `cases-b${bundling}.json`);
    await writeFile(out, JSON.stringify({ bundling, templateFile: def.templateFile, inputRanges: def.inputs, cases }, null, 1));
    console.log(`${out}: ${cases.length} cases, ${Math.round(cases.reduce((s, c) => s + Object.keys(c.cells).length, 0) / cases.length)} cells each on average`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
