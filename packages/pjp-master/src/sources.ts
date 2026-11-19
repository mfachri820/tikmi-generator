import ExcelJS from "exceljs";
import { normalizeSandi } from "./normalize";

export interface LampPjpRow {
  sandi: string;
  nama: string;
  kategori: string | null;
  /** Worksheet row, for error messages and ordering. */
  row: number;
}

export const LAMP_PJP_SHEET = "Lamp. PJP";

function text(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in v) return text(v.result as ExcelJS.CellValue);
  if (typeof v === "object" && "richText" in v) return v.richText.map((r) => r.text).join("");
  return String(v);
}

/**
 * The PJP list of a TIKMI template's `Lamp. PJP` sheet: header row with
 * "Kategori", "Kode Sandi", "Nama" (B, C, D in the 2025 templates; located by
 * text). Rows without a name or a valid Sandi (the opinion list below the PJP
 * list) are skipped. D5's VLOOKUP returns column E; C and E are the same Sandi.
 */
export async function readLampPjp(xlsx: Buffer | ArrayBuffer): Promise<LampPjpRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as ArrayBuffer);
  const ws = wb.getWorksheet(LAMP_PJP_SHEET);
  if (!ws) throw new Error(`Sheet "${LAMP_PJP_SHEET}" not found`);

  let header: { row: number; kategori: number; sandi: number; nama: number } | null = null;
  ws.eachRow((row, r) => {
    if (header) return;
    const cols = new Map<string, number>();
    row.eachCell((cell, c) => {
      const t = text(cell.value).trim().toLowerCase();
      if (t && !cols.has(t)) cols.set(t, c);
    });
    if (cols.has("nama") && cols.has("kode sandi")) {
      header = { row: r, kategori: cols.get("kategori") ?? 0, sandi: cols.get("kode sandi")!, nama: cols.get("nama")! };
    }
  });
  if (!header) throw new Error(`No "Kode Sandi" / "Nama" header in "${LAMP_PJP_SHEET}"`);
  const h = header as { row: number; kategori: number; sandi: number; nama: number };

  const out: LampPjpRow[] = [];
  for (let r = h.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nama = text(row.getCell(h.nama).value).trim();
    const sandi = normalizeSandi(row.getCell(h.sandi).value === null ? null : text(row.getCell(h.sandi).value).trim() || null);
    if (!nama || !sandi) continue;
    const kategori = h.kategori ? text(row.getCell(h.kategori).value).trim() || null : null;
    out.push({ sandi, nama, kategori, row: r });
  }
  return out;
}

/**
 * The PJP dropdown of the Google Form, from its text export
 * (templates/tikmi/<year>/google-form.txt): the numbered options after the
 * "Nama Penyelenggara ..." question, up to "Other".
 */
export function readFormPjpNames(formText: string, questionTitle = "Nama Penyelenggara PJP"): string[] {
  const lines = formText.split(/\r?\n/).map((l) => l.trim());
  const start = lines.findIndex((l) => l.startsWith(questionTitle));
  if (start < 0) throw new Error(`Question "${questionTitle}" not found in the form text`);
  const names: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (!/^\d+\.$/.test(lines[i])) continue;
    const name = lines[i + 1] ?? "";
    if (name === "Other") break;
    if (name) names.push(name);
    i++;
  }
  if (names.length === 0) throw new Error(`No options found under "${questionTitle}"`);
  return names;
}
