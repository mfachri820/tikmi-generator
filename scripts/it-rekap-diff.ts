#!/usr/bin/env tsx
/**
 * Compares the ranges `Rekap Penilaian per PJP.xlsx` hard-codes (its formulas
 * are stored as text) with the component rows derived from column B of the
 * IT KK (packages/scoring/definitions/<year>-it.json). Structural only: no PJP
 * data is read. Prints a Markdown table for docs/tikmi-deviations.md.
 *
 * Usage: npx tsx scripts/it-rekap-diff.ts [--year=2025]
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseFormula, references, type ItDefinition } from "@tikmi/scoring";

const year = process.argv.find((a) => a.startsWith("--year="))?.slice(7) ?? "2025";
const DIR = resolve(process.env.TIKMI_TEMPLATES_DIR ?? `templates/tikmi/${year}`);

interface Cell {
  v?: unknown;
}

async function main() {
  const def = JSON.parse(await readFile(resolve("packages/scoring/definitions", `${year}-it.json`), "utf8")) as ItDefinition;
  const dump = JSON.parse(await readFile(resolve(DIR, "_dump", "Rekap Penilaian per PJP.json"), "utf8"));
  const cells = (Object.values(dump.sheets)[0] as { cells: Record<string, Cell> }).cells;
  const rows = [...new Set(Object.keys(cells).map((a) => Number(/\d+/.exec(a)![0])))].sort((a, b) => a - b);

  const lines: string[] = ["| Sheet | Komponen | Rekap: self (F) | Rekap: pengawas (I) | Baris pertanyaan (kolom B + kode) | Masalah |", "|---|---|---|---|---|---|"];
  let section: string | null = null;
  let issues = 0;
  for (const r of rows) {
    const label = String(cells[`A${r}`]?.v ?? "").trim();
    if (!label) continue;
    if (def.sheets.some((s) => s.name === label)) {
      section = label;
      continue;
    }
    const code = /^(\d)\.\s*([A-H])/.exec(label);
    if (!section || !code) continue;
    const component = `${code[1]}.${code[2]}`;
    const sheet = def.sheets.find((s) => s.name === section)!;
    const derived = sheet.rows.filter((x) => x.component === component);
    const scored = derived.filter((x) => !x.na).map((x) => x.row);
    const derivedText = scored.length ? `${scored[0]}–${scored[scored.length - 1]}` : derived.length ? "(tidak ada pertanyaan)" : "—";

    const rangeOf = (col: "B" | "C") => {
      const raw = String(cells[`${col}${r}`]?.v ?? "").trim();
      if (!raw) return null;
      const f = "=" + raw.replace(/^\{/, "").replace(/\}$/, "");
      const refs = references(parseFormula(f)).filter((x) => (x as { sheet?: string }).sheet === section);
      return refs.map((x) => (x.t === "range" ? [x.row1, x.row2] : x.t === "ref" ? [x.row, x.row] : [0, 0]))[0] ?? null;
    };
    const self = rangeOf("B");
    const peng = rangeOf("C");
    const fmt = (x: number[] | null) => (x ? `${x[0]}–${x[1]}` : "(kosong)");
    const problems: string[] = [];
    // Compared with the scored rows: placeholder ("N/A") and note rows inside a block do not count.
    const want = scored.length ? [scored[0], scored[scored.length - 1]] : null;
    if (!self && !peng && scored.length) problems.push("tidak dihitung");
    if (self && want && (self[0] !== want[0] || self[1] !== want[1])) problems.push("rentang F salah");
    if (peng && want && (peng[0] !== want[0] || peng[1] !== want[1])) problems.push("rentang I salah");
    if (self && peng && (self[0] !== peng[0] || self[1] !== peng[1])) problems.push("F dan I berbeda");
    if ((self || peng) && !scored.length) problems.push("tanpa baris dinilai → #DIV/0!");
    if (problems.length) issues++;
    lines.push(`| ${section} | ${component} ${label.replace(/^\d\.\s*[A-H]\.?\s*/, "")} | ${fmt(self)} | ${fmt(peng)} | ${derivedText} | ${problems.join("; ") || "–"} |`);
  }
  console.log(lines.join("\n"));
  console.error(`\n${issues} component rows with problems.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
