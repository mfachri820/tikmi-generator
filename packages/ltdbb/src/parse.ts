import ExcelJS from "exceljs";

/** The only sheet read; the rest of the LTDBB workbook is pivots and scratch work. */
export const LTDBB_SHEET = "Trx_PJPJKT";

/** Row 1, columns A-S, exactly (ignoring surrounding spaces). Anything after S is ignored. */
export const LTDBB_HEADERS = [
  "Date", "Month", "Quarter", "Year", "Kode", "Nama PJP",
  "Jumlah Inc", "Nilai Inc", "Jumlah Out", "Nilai Out", "Jumlah Dom", "Nilai Dom",
  "Fin Jumlah Inc", "Fin Nilai Inc", "Fin Jumlah Out", "Fin Nilai Out", "Fin Jumlah Dom", "Fin Nilai Dom",
  "Bundling",
] as const;

export type LtdbbFlag =
  | "NON_NUMERIC"
  | "DERIVED_FROM_NILAI"
  | "MISSING_VALUE"
  | "NON_INTEGER_FREQ"
  | "NEGATIVE"
  | "DATE_MISMATCH"
  | "CODE_OVERRIDDEN";

export interface LtdbbRow {
  kode: string;
  kodeRaw: string;
  namaLtdbb: string;
  year: number;
  month: number;
  finJumlahInc: number;
  finNilaiInc: number;
  finJumlahOut: number;
  finNilaiOut: number;
  finJumlahDom: number;
  finNilaiDom: number;
  flags: LtdbbFlag[];
}

export interface LtdbbReport {
  rowCount: number;
  skippedNoKode: number;
  /** Rows without a usable Year/Month or Date; not imported. */
  skippedNoPeriod: number[];
  kodeCount: number;
  minDate: string | null;
  maxDate: string | null;
  flagCounts: Partial<Record<LtdbbFlag, number>>;
}

export class LtdbbParseError extends Error {}

type FinKey = "finJumlahInc" | "finNilaiInc" | "finJumlahOut" | "finNilaiOut" | "finJumlahDom" | "finNilaiDom";

/**
 * Each Fin (Rupiah) column, the column it falls back to when the Fin cell has
 * no cached value, and that column's scale. The file's formulas run both ways
 * (Fin = Nilai*10^9 on some rows, Nilai = Fin*10^-9 on others), and many were
 * saved without cached results, so the fallback is the common path.
 */
const FIN_COLUMNS: { key: FinKey; col: number; fallbackCol: number; factor: number; isFrequency: boolean }[] = [
  { key: "finJumlahInc", col: 13, fallbackCol: 7, factor: 1, isFrequency: true },
  { key: "finNilaiInc", col: 14, fallbackCol: 8, factor: 1e9, isFrequency: false },
  { key: "finJumlahOut", col: 15, fallbackCol: 9, factor: 1, isFrequency: true },
  { key: "finNilaiOut", col: 16, fallbackCol: 10, factor: 1e9, isFrequency: false },
  { key: "finJumlahDom", col: 17, fallbackCol: 11, factor: 1, isFrequency: true },
  { key: "finNilaiDom", col: 18, fallbackCol: 12, factor: 1e9, isFrequency: false },
];

/** A cell's cached value: a formula's result (undefined when the file stored none), or the literal. */
function cached(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v !== null && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) {
      const result = (v as { result?: unknown }).result;
      return result !== null && typeof result === "object" && "error" in result ? undefined : result;
    }
    if ("formula" in v || "sharedFormula" in v) return undefined;
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
  }
  return v ?? undefined;
}

/** A number, a number stored as text ("248,294,749,080"), missing, or not a number at all. */
function toNumber(raw: unknown): { value?: number; nonNumeric?: true } {
  if (typeof raw === "number") return Number.isFinite(raw) ? { value: raw } : { nonNumeric: true };
  if (typeof raw === "string") {
    const text = raw.replace(/[,\s]/g, "");
    if (text === "") return {};
    const n = Number(text);
    return Number.isFinite(n) ? { value: n } : { nonNumeric: true };
  }
  return {};
}

function columnLetter(col: number): string {
  return String.fromCharCode(64 + col);
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/**
 * Reads the LTDBB workbook's Trx_PJPJKT sheet into cleaned PJP-month rows.
 * `overrides` maps an LTDBB name to the sandi its rows really belong to
 * (`ltdbb_code_overrides`). Throws `LtdbbParseError` with a readable message
 * when the file can't be used at all: no sheet, wrong headers, or a PJP-month
 * that still appears twice after overrides.
 */
export async function parseLtdbb(buffer: Buffer | ArrayBuffer, overrides: Map<string, string>): Promise<{
  rows: LtdbbRow[];
  report: LtdbbReport;
}> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as ArrayBuffer);
  } catch {
    throw new LtdbbParseError("File tidak dapat dibaca sebagai workbook Excel (.xlsx).");
  }
  const sheet = workbook.getWorksheet(LTDBB_SHEET);
  if (!sheet) throw new LtdbbParseError(`Sheet "${LTDBB_SHEET}" tidak ditemukan di file ini.`);

  const header = sheet.getRow(1);
  LTDBB_HEADERS.forEach((expected, i) => {
    const actual = String(cached(header.getCell(i + 1)) ?? "").trim();
    if (actual !== expected) {
      throw new LtdbbParseError(
        `Header kolom ${columnLetter(i + 1)} harus "${expected}", tetapi berisi "${actual}".`,
      );
    }
  });

  const rows: LtdbbRow[] = [];
  const report: LtdbbReport = {
    rowCount: 0,
    skippedNoKode: 0,
    skippedNoPeriod: [],
    kodeCount: 0,
    minDate: null,
    maxDate: null,
    flagCounts: {},
  };

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.findRow(r);
    if (!row) continue;
    const kodeRaw = String(cached(row.getCell(5)) ?? "").trim();
    if (!kodeRaw) {
      report.skippedNoKode++;
      continue;
    }
    const flags = new Set<LtdbbFlag>();
    const namaLtdbb = String(cached(row.getCell(6)) ?? "").trim();

    const date = cached(row.getCell(1));
    const dateYear = date instanceof Date ? date.getUTCFullYear() : undefined;
    const dateMonth = date instanceof Date ? date.getUTCMonth() + 1 : undefined;
    const yearCol = toNumber(cached(row.getCell(4))).value;
    const monthCol = toNumber(cached(row.getCell(2))).value;
    const year = yearCol ?? dateYear;
    const month = monthCol ?? dateMonth;
    if (!year || !month || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      report.skippedNoPeriod.push(r);
      continue;
    }
    if (dateYear !== undefined && (dateYear !== year || dateMonth !== month)) flags.add("DATE_MISMATCH");

    const values = {} as Record<FinKey, number>;
    for (const spec of FIN_COLUMNS) {
      const fin = toNumber(cached(row.getCell(spec.col)));
      let value = fin.value;
      if (fin.nonNumeric) flags.add("NON_NUMERIC");
      if (value === undefined) {
        const fallback = toNumber(cached(row.getCell(spec.fallbackCol)));
        if (fallback.nonNumeric) flags.add("NON_NUMERIC");
        if (fallback.value !== undefined) {
          value = fallback.value * spec.factor;
          flags.add("DERIVED_FROM_NILAI");
        } else if (!fin.nonNumeric && !fallback.nonNumeric) {
          flags.add("MISSING_VALUE");
        }
      }
      value ??= 0;
      if (value < 0) flags.add("NEGATIVE");
      if (spec.isFrequency && !Number.isInteger(value)) flags.add("NON_INTEGER_FREQ");
      values[spec.key] = value;
    }

    const overrideKode = overrides.get(namaLtdbb);
    const kode = overrideKode ?? kodeRaw;
    if (overrideKode && overrideKode !== kodeRaw) flags.add("CODE_OVERRIDDEN");

    rows.push({ kode, kodeRaw, namaLtdbb, year, month, ...values, flags: [...flags] });
  }

  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.kode} ${monthKey(row.year, row.month).slice(0, 7)}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicates = [...seen].filter(([, n]) => n > 1).map(([key]) => key);
  if (duplicates.length > 0) {
    const shown = duplicates.slice(0, 20).join(", ");
    const more = duplicates.length > 20 ? ` (+${duplicates.length - 20} lainnya)` : "";
    throw new LtdbbParseError(`Data ganda untuk Kode dan bulan yang sama: ${shown}${more}.`);
  }

  const months = rows.map((row) => monthKey(row.year, row.month)).sort();
  report.rowCount = rows.length;
  report.kodeCount = new Set(rows.map((row) => row.kode)).size;
  report.minDate = months[0] ?? null;
  report.maxDate = months[months.length - 1] ?? null;
  for (const row of rows) {
    for (const flag of row.flags) report.flagCounts[flag] = (report.flagCounts[flag] ?? 0) + 1;
  }
  return { rows, report };
}
