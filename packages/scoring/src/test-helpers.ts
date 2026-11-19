/** Shared by the golden and parity tests: template loading, Sumber BI tables, Excel-style comparison. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { buildLookup, parseSumberBi } from "@tikmi/sumber-bi";
import { splitRef } from "./formula/evaluate";
import { formatAddress } from "./formula/parse";
import { isError, XlError, type Scalar } from "./formula/values";
import type { MrTables } from "./mr";

export const DIR = process.env.TIKMI_TEMPLATES_DIR ?? resolve(__dirname, "../../../templates/tikmi/2025");

/** A cell's typed value or cached formula result, as the evaluator represents it. */
export function plain(v: ExcelJS.CellValue): Scalar {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if ("error" in v) return XlError.of(String(v.error));
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("formula" in v || "sharedFormula" in v) {
      const r = (v as { result?: unknown }).result;
      if (r === undefined) return null;
      return plain(r as ExcelJS.CellValue);
    }
    if ("text" in v) return String((v as { text: unknown }).text);
  }
  return String(v);
}

export interface Loaded {
  wb: ExcelJS.Workbook;
  xlsx: Buffer;
}

export async function load(file: string): Promise<Loaded> {
  const xlsx = await readFile(resolve(DIR, file));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
  return { wb, xlsx };
}

export function valueAt(wb: ExcelJS.Workbook, ref: string): Scalar {
  const { sheet, col, row } = splitRef(ref);
  const ws = wb.getWorksheet(sheet);
  if (!ws) throw new Error(`No sheet ${sheet}`);
  return plain(ws.getCell(formatAddress(col, row)).value);
}

export async function tablesFrom({ wb, xlsx }: Loaded): Promise<MrTables> {
  const satu = await parseSumberBi(xlsx, { kind: "1_tahun", sheetName: "Sumber BI 1 Tahun" });
  const enam = await parseSumberBi(xlsx, { kind: "6_bulan", sheetName: "Sumber BI (6 Bulan)" });
  const lamp = wb.getWorksheet("Lamp. PJP")!;
  const names: [string, Scalar][] = [];
  for (let r = 5; r <= 463; r++) names.push([String(plain(lamp.getCell(`D${r}`).value) ?? ""), plain(lamp.getCell(`E${r}`).value)]);
  return {
    satuTahun: buildLookup(satu.rows),
    enamBulan: buildLookup(enam.rows),
    lampPjp: (name) => names.find(([n]) => n.toLowerCase() === name.toLowerCase())?.[1] ?? undefined,
  };
}

/** Cached formula results by "Sheet!A1", from the openpyxl dump. */
export async function cachedFromDump(file: string): Promise<Map<string, Scalar>> {
  const dump = JSON.parse(await readFile(resolve(DIR, "_dump", file.replace(/\.xlsx$/, ".json")), "utf8")) as {
    sheets: Record<string, { cells: Record<string, { f?: unknown; v?: unknown }> }>;
  };
  const out = new Map<string, Scalar>();
  for (const [sheet, s] of Object.entries(dump.sheets)) {
    for (const [addr, c] of Object.entries(s.cells)) {
      if (c.f === undefined) continue;
      const v = c.v;
      out.set(`${sheet}!${addr}`, typeof v === "string" && /^#(DIV\/0!|N\/A|VALUE!|REF!|NAME\?|NUM!|NULL!|CALC!)$/.test(v) ? XlError.of(v) : ((v ?? null) as Scalar));
    }
  }
  return out;
}

export function same(actual: Scalar, expected: Scalar): boolean {
  if (typeof expected === "number" && typeof actual === "number") return Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
  if (isError(expected) || isError(actual)) return isError(expected) && isError(actual) && expected.code === actual.code;
  // A formula whose cached result is empty text can be saved without a value.
  if ((expected === null && actual === "") || (expected === "" && actual === null)) return true;
  return actual === expected;
}

