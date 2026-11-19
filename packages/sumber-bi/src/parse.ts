import ExcelJS from "exceljs";
import { normalizeSandi } from "@tikmi/pjp-master";

export type SumberBiKind = "1_tahun" | "6_bulan" | "industri";

export interface SumberBiRow {
  /** Worksheet row: the KK's VLOOKUP takes the first match, so order matters. */
  rowNo: number;
  dataId: string;
  ket: string | null;
  idpelapor: string | null;
  /** Lookup key, `${dataId}-${idpelapor}` (the template's `idx` column). */
  idx: string | null;
  amount: number | null;
  /** A non-numeric amount as written ("NA", "#DIV/0!"). */
  amountText: string | null;
}

export type RowFlag =
  /** Same lookup key as an earlier row: VLOOKUP never reaches this one. */
  | "DUPLICATE_KEY"
  | "NON_NUMERIC_AMOUNT"
  /** Empty amount: VLOOKUP returns 0 for it. */
  | "BLANK_AMOUNT"
  /** idpelapor is not a 9-digit Sandi (e.g. the masked "X77000003" codes in the SNAP rows): never matches a PJP. */
  | "BAD_PELAPOR"
  /** The file's idx does not equal id-idpelapor (e.g. a UUS row filed under its parent bank); the stored idx is used. */
  | "IDX_MISMATCH";

export interface SumberBiReport {
  sheet: string;
  rows: number;
  distinctDataIds: number;
  distinctPelapor: number;
  flags: Partial<Record<RowFlag, number>>;
  /** First examples per flag (row number + detail), at most 20 each. */
  examples: Partial<Record<RowFlag, { rowNo: number; detail: string }[]>>;
  warnings: string[];
}

export interface ParsedSumberBi {
  rows: SumberBiRow[];
  report: SumberBiReport;
}

export class SumberBiFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SumberBiFormatError";
  }
}

export interface ParseOptions {
  kind: SumberBiKind;
  /** Read this sheet; otherwise the first sheet whose header row has the expected columns. */
  sheetName?: string;
  /**
   * Use the file's own `idx` column as the lookup key when it has one (default
   * true). The 2025 KKs type idx by hand for bank Unit Usaha Syariah rows
   * (idpelapor 116990000 filed under idx ...-116000000, the parent bank), so a
   * stored idx is a deliberate mapping, not noise. Rows without an idx, and
   * files without the column, use `${id}-${idpelapor}`.
   */
  keepIdx?: boolean;
}

const REQUIRED: Record<SumberBiKind, string[]> = {
  "1_tahun": ["id", "idpelapor", "amount"],
  "6_bulan": ["id", "idpelapor", "amount"],
  industri: ["id", "amount"],
};

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    if (v instanceof Date) return v;
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("error" in v) return String(v.error);
    if ("text" in v) return String(v.text);
    if ("formula" in v || "sharedFormula" in v) return null;
  }
  return v;
}

function headerMap(ws: ExcelJS.Worksheet): Map<string, number> {
  const cols = new Map<string, number>();
  ws.getRow(1).eachCell((cell, c) => {
    const t = String(cellValue(cell.value) ?? "").trim().toLowerCase();
    if (t && !cols.has(t)) cols.set(t, c);
  });
  return cols;
}

/** Amount as the KK's VLOOKUP sees it: number, text, or blank (which VLOOKUP turns into 0). */
function readAmount(raw: unknown): { amount: number | null; amountText: string | null; blank: boolean } {
  if (raw === null || raw === "") return { amount: null, amountText: null, blank: true };
  if (typeof raw === "number") return { amount: raw, amountText: null, blank: false };
  const t = String(raw).trim();
  if (t === "") return { amount: null, amountText: null, blank: true };
  // Plain numeric text ("1234.5", "-12"); thousands separators are not guessed at.
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(t)) return { amount: Number(t), amountText: null, blank: false };
  return { amount: null, amountText: t, blank: false };
}

/**
 * Reads a Sumber BI sheet in the template's shape: row 1 = `id, ket,
 * idpelapor, [idx,] amount` (any order, located by header text); `industri`
 * has no idpelapor. Throws SumberBiFormatError when no sheet has the columns.
 */
export async function parseSumberBi(xlsx: Buffer | ArrayBuffer, options: ParseOptions): Promise<ParsedSumberBi> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as ArrayBuffer);
  const required = REQUIRED[options.kind];

  let ws: ExcelJS.Worksheet | undefined;
  let cols: Map<string, number> | undefined;
  if (options.sheetName) {
    ws = wb.getWorksheet(options.sheetName);
    if (!ws) throw new SumberBiFormatError(`Sheet "${options.sheetName}" tidak ditemukan`);
    cols = headerMap(ws);
  } else {
    for (const candidate of wb.worksheets) {
      const m = headerMap(candidate);
      if (required.every((h) => m.has(h))) {
        ws = candidate;
        cols = m;
        break;
      }
    }
    if (!ws) {
      throw new SumberBiFormatError(
        `Tidak ada sheet dengan kolom ${required.join(", ")} pada baris 1. Format yang diharapkan: id, ket, idpelapor, amount.`,
      );
    }
  }
  const missing = required.filter((h) => !cols!.has(h));
  if (missing.length) throw new SumberBiFormatError(`Kolom tidak ditemukan di sheet "${ws.name}": ${missing.join(", ")}`);

  const c = { id: cols!.get("id")!, ket: cols!.get("ket"), pel: cols!.get("idpelapor"), idx: cols!.get("idx"), amount: cols!.get("amount")! };
  const rows: SumberBiRow[] = [];
  const flags: Partial<Record<RowFlag, number>> = {};
  const examples: Partial<Record<RowFlag, { rowNo: number; detail: string }[]>> = {};
  const flag = (f: RowFlag, rowNo: number, detail: string) => {
    flags[f] = (flags[f] ?? 0) + 1;
    const list = (examples[f] ??= []);
    if (list.length < 20) list.push({ rowNo, detail });
  };
  const seen = new Map<string, number>();
  const warnings: string[] = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const dataId = String(cellValue(row.getCell(c.id).value) ?? "").trim();
    if (!dataId) continue;
    const ketRaw = c.ket ? cellValue(row.getCell(c.ket).value) : null;
    const ket = ketRaw === null ? null : String(ketRaw).trim() || null;

    let idpelapor: string | null = null;
    if (c.pel) {
      const raw = cellValue(row.getCell(c.pel).value);
      idpelapor = normalizeSandi(raw);
      if (!idpelapor) {
        idpelapor = raw === null ? null : String(raw).trim() || null;
        flag("BAD_PELAPOR", r, `${dataId}: "${raw ?? ""}"`);
      }
    }

    const derived = idpelapor === null ? (options.kind === "industri" ? dataId : null) : `${dataId}-${idpelapor}`;
    let idx = derived;
    if (options.keepIdx !== false && c.idx) {
      const stored = cellValue(row.getCell(c.idx).value);
      const storedText = stored === null ? null : String(stored).trim();
      if (storedText) {
        if (storedText !== derived) flag("IDX_MISMATCH", r, `idx "${storedText}" ≠ "${derived}"`);
        idx = storedText;
      }
    }

    const { amount, amountText, blank } = readAmount(cellValue(row.getCell(c.amount).value));
    if (blank) flag("BLANK_AMOUNT", r, idx ?? dataId);
    if (amountText !== null) flag("NON_NUMERIC_AMOUNT", r, `${idx ?? dataId}: "${amountText}"`);

    if (idx !== null) {
      const key = idx.toLowerCase();
      const first = seen.get(key);
      if (first === undefined) seen.set(key, r);
      else flag("DUPLICATE_KEY", r, `${idx} (baris pertama ${first})`);
    }

    rows.push({ rowNo: r, dataId, ket, idpelapor, idx, amount, amountText });
  }

  if (rows.length === 0) warnings.push("File tidak berisi baris data.");
  return {
    rows,
    report: {
      sheet: ws.name,
      rows: rows.length,
      distinctDataIds: new Set(rows.map((x) => x.dataId)).size,
      distinctPelapor: new Set(rows.map((x) => x.idpelapor).filter(Boolean)).size,
      flags,
      examples,
      warnings,
    },
  };
}
