import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ExcelJS from "exceljs";

/**
 * The 2025 round's template files, as delivered in templates/tikmi/2025/
 * (gitignored: the KKs carry a filled PJP sample and BI data for every PJP).
 * TIKMI_TEMPLATES_DIR overrides the folder.
 */
export const TEMPLATES_DIR = process.env.TIKMI_TEMPLATES_DIR ?? resolve("templates/tikmi/2025");

export const TEMPLATE_FILES = {
  mr_kk_b2: "Nama PSP LSB Bundling 2_Kertas Kerja M Pengawas_Posisi.xlsx",
  mr_kk_b3: "Nama PSP LSB Bundling 3_Kertas Kerja M Pengawas_Posisi.xlsx",
  it_kk: "Lampiran 2 Kertas Kerja - Penilaian Keandalan Infrastruktur TI.xlsx",
  mr_pjp_b2: "Nama PSP LSB Bundling 2_Self Asesmen M_Posisi.xlsx",
  mr_pjp_b3: "Nama PSP LSB Bundling 3_Self Asesmen M_Posisi.xlsx",
  it_pjp: "Nama PSP_Self Asesmen Infrastruktur TI_Posisi.xlsx",
  it_rekap: "Rekap Penilaian per PJP.xlsx",
} as const;
export type TemplateKey = keyof typeof TEMPLATE_FILES;

export const FORM_TEXT_FILE = "google-form.txt";

export function templatePath(key: TemplateKey): string {
  return resolve(TEMPLATES_DIR, TEMPLATE_FILES[key]);
}

export async function readTemplate(key: TemplateKey): Promise<Buffer> {
  try {
    return await readFile(templatePath(key));
  } catch {
    throw new Error(`Template not found: ${templatePath(key)} (set TIKMI_TEMPLATES_DIR or copy the 2025 templates there)`);
  }
}

export async function readFormText(): Promise<string> {
  return readFile(resolve(TEMPLATES_DIR, FORM_TEXT_FILE), "utf8");
}

/** Risk keys in Form Penilaian column order C..L. */
export const RISK_KEYS = ["OPS", "LIQ", "KEU", "CR", "CMP", "PUPT", "HK", "STG", "RPT", "PK"] as const;
export type RiskKey = (typeof RISK_KEYS)[number];
export type Weights = Record<RiskKey, number>;

/** `DropDown List` row-33 headers, in the same order as RISK_KEYS. */
const WEIGHT_HEADERS = ["MR Operasional", "MR Likuiditas", "MR Keuangan", "MR Kredit", "MR Kepatuhan", "MR PU-PT", "MR Hukum", "MR Strategis", "MR Reputasi", "MR PK/MC"];

export interface WeightRow {
  bundling: string;
  bentukLembaga: string;
  weights: Weights;
}

function plain(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === "object" && "result" in v) return v.result;
  return v;
}

/**
 * The weight table Form Penilaian's XLOOKUP reads (`DropDown List` A34:L41):
 * located by its header row ("MR Operasional" ... "MR PK/MC"), one row per
 * (bundling, bentuk lembaga) until the first empty row.
 */
export async function readWeightTable(kk: Buffer): Promise<WeightRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(kk as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("DropDown List");
  if (!ws) throw new Error('Sheet "DropDown List" not found');
  let headerRow = 0;
  let firstCol = 0;
  ws.eachRow((row, r) => {
    if (headerRow) return;
    row.eachCell((cell, c) => {
      if (!headerRow && String(plain(cell.value) ?? "").trim() === WEIGHT_HEADERS[0]) {
        headerRow = r;
        firstCol = c;
      }
    });
  });
  if (!headerRow) throw new Error("Weight table header (MR Operasional ...) not found in DropDown List");
  WEIGHT_HEADERS.forEach((h, i) => {
    const got = String(plain(ws.getRow(headerRow).getCell(firstCol + i).value) ?? "").trim();
    if (got !== h) throw new Error(`Weight table column ${i + 1}: expected "${h}", found "${got}"`);
  });

  const out: WeightRow[] = [];
  for (let r = headerRow + 1; ; r++) {
    const row = ws.getRow(r);
    const bundling = plain(row.getCell(firstCol - 2).value);
    const bentuk = plain(row.getCell(firstCol - 1).value);
    if (bundling === null || bundling === undefined || bundling === "") break;
    const weights = Object.fromEntries(
      RISK_KEYS.map((k, i) => {
        const v = plain(row.getCell(firstCol + i).value);
        if (typeof v !== "number") throw new Error(`DropDown List row ${r}, ${k}: not a number (${String(v)})`);
        return [k, v];
      }),
    ) as Weights;
    out.push({ bundling: String(bundling), bentukLembaga: String(bentuk).trim(), weights });
  }
  return out;
}
