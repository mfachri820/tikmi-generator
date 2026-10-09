import ExcelJS from "exceljs";
import type { WorkbookScoringResult } from "@ira/scoring";
import { scoringConfig2026, type WeightSet } from "@ira/scoring/config/2026";
import { a2ItemRows } from "@ira/scoring/config/2026-sheet";
import type { ExtractedLayout } from "@ira/template";
import { INDIVIDU_TEMPLATE_BASE64 } from "./individuTemplate";
import type { ParameterExplanation } from "./scoreExplain";

/**
 * BI's "APU PPT dan Net Risk PTD Individu" report for one PJP, filled from the
 * app's scores into a blank copy of BI's own layout (`individuTemplate.ts`).
 * Row positions below are that layout's, checked against BI's report for
 * PT Agung Remittance Global (Sept 2026).
 */

const A2 = "A2. PJP ALL peng";

/** Report rows of the 35 A2 parameters, in `scoringConfig2026.parameters` order. */
const PARAMETER_ROWS = [12, 13, 16, 17, 20, 21, 22, 23, 24, 27, 28, 32, 33, 36, 37, 40, 41, 42, 43, 46, 47, 51, 52, 55, 56, 59, 60, 61, 64, 68, 69, 70, 71, 72, 75];
/** "Sub Total" rows, one per A2 item (in `a2ItemRows` order). */
const SUBTOTAL_ROWS = [14, 18, 25, 29, 34, 38, 44, 48, 53, 57, 62, 65, 73, 76];
/** The 31 KPMR answers, in `scoringConfig2026.kpmrQuestions` order (BI's layout puts Proses MR's first question at 98, above its heading). */
const KPMR_ROWS = [82, 83, 84, 85, 86, 87, 88, 90, 91, 92, 93, 94, 95, 96, 97, 98, 100, 101, 102, 103, 104, 105, 106, 107, 108, 110, 111, 112, 114, 115, 116];
/** "Perhitungan Nilai Risiko": item rows and the category total row, per category. */
const CATEGORY_BLOCKS: { category: string; itemRows: number[]; totalRow: number }[] = [
  { category: "TPPU", itemRows: [121, 122, 123, 124], totalRow: 125 },
  { category: "TPPT", itemRows: [127, 128, 129, 130], totalRow: 131 },
  { category: "PPSPM", itemRows: [133, 134, 135, 136], totalRow: 137 },
  { category: "Struktural", itemRows: [139, 140], totalRow: 141 },
];
const OVERALL_ROW = 142;
const PILLAR_ROWS = [146, 147, 148, 149, 150];
/** The item headings of the first block ("1. Produk dan/ atau Jasa (30%)"), in `a2ItemRows` order. */
const ITEM_HEADING_ROWS = [11, 15, 19, 26, 31, 35, 39, 45, 50, 54, 58, 63, 67, 74];
/** The KPMR pillar headings above the answers ("1. Tugas Dan Tanggung Jawab … (20%)"). */
const PILLAR_HEADING_ROWS = [81, 89, 99, 109, 113];
const KPMR_TOTAL_ROW = 151;

export interface IndividuReportInput {
  pjpNama: string;
  year: number;
  printedBy: string;
  printedAt: Date;
  scores: WorkbookScoringResult;
  parameterInfo: ParameterExplanation[];
  /** Cell values of the workbook (for the KPMR pengawas answers in column J). */
  cells: Record<string, unknown>;
  layout: ExtractedLayout;
  /** The weights in force (category and KPMR pillar weights; item and parameter weights come from `layout`). */
  weights: WeightSet;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
/** BI writes predikat in title case: "Rendah Ke Menengah". */
const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const scoreOrNA = (x: number) => (Number.isFinite(x) ? round2(x) : "#N/A");

/** "dd-MM-yyyy HH:mm:ss" in WIB, as BI prints it. */
function printedStamp(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

export async function buildIndividuReport(input: IndividuReportInput): Promise<Buffer> {
  const { scores, layout } = input;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(INDIVIDU_TEMPLATE_BASE64, "base64") as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const set = (ref: string, value: ExcelJS.CellValue) => {
    ws.getCell(ref).value = value;
  };

  // Header. BI lists the PJP without its "PT" prefix, in capitals.
  set("B4", `: ${input.pjpNama.replace(/^PT\.?\s+/i, "").toUpperCase()}`);
  set("B5", `: ${input.year}`);
  set("B6", `: ${printedStamp(input.printedAt)}`);
  set("B7", `: ${input.printedBy}`);

  // Weights come from the template's own A2 sheet: E = weight within the item, D (item row) = item weight.
  const a2 = layout.sheets.find((s) => s.name === A2);
  const num = (address: string) => {
    const v = a2?.cells.find((c) => c.address === address)?.value;
    return typeof v === "number" ? v : 0;
  };

  const infoByRow = new Map(input.parameterInfo.map((p) => [p.row, p]));
  const ruleById = new Map(scoringConfig2026.parameters.map((p) => [p.id, p]));
  const itemScore = new Map<number, number>();

  // Parameter rows and their item subtotals.
  scoringConfig2026.parameters.forEach((p, i) => {
    const row = PARAMETER_ROWS[i];
    const a2Row = Number(p.id);
    const info = infoByRow.get(a2Row)!;
    const config = ruleById.get(p.id)!;
    // As BI does: "Persentase …" parameters show the share in whole percent (0 for the manual ones, which
    // have no form data); yes/no parameters ("Ada/tidak …", UBO, struktur) show the score itself.
    const isPercentage = /^persentase/i.test(config.label);
    const leaf = num(`E${a2Row}`);
    const risk = info.pengawasScore;
    set(`C${row}`, isPercentage ? (info.manual ? 0 : Math.round(info.total * 100)) : risk);
    set(`D${row}`, risk);
    set(`E${row}`, round2(leaf * 100));
    set(`F${row}`, round2(risk * leaf));
  });
  a2ItemRows.forEach((itemRow, i) => {
    const next = a2ItemRows[i + 1] ?? Infinity;
    const members = scoringConfig2026.parameters.filter((p) => Number(p.id) > itemRow && Number(p.id) < next);
    const weightSum = members.reduce((s, p) => s + num(`E${p.id}`), 0);
    const score = members.reduce((s, p) => s + num(`E${p.id}`) * infoByRow.get(Number(p.id))!.pengawasScore, 0);
    itemScore.set(itemRow, score);
    const itemHeading = ws.getCell(`A${ITEM_HEADING_ROWS[i]}`);
    if (typeof itemHeading.value === "string") itemHeading.value = itemHeading.value.replace(/(d+(?:[.,]d+)?%)/, `(${round2(num(`D${itemRow}`) * 100)}%)`);
    set(`E${SUBTOTAL_ROWS[i]}`, round2(weightSum * 100));
    set(`F${SUBTOTAL_ROWS[i]}`, round2(score));
  });

  // KPMR answers (pengawas, column J of the workbook).
  scoringConfig2026.kpmrQuestions.forEach((q, i) => {
    const v = input.cells[q.pengawasCellRef];
    set(`C${KPMR_ROWS[i]}`, typeof v === "number" ? v : null);
  });

  // Perhitungan Nilai Risiko APU PPT: item score × item weight, per category, then × category weight.
  let overall = 0;
  let itemIndex = 0;
  for (const block of CATEGORY_BLOCKS) {
    let categoryScore = 0;
    for (const row of block.itemRows) {
      const itemRow = a2ItemRows[itemIndex++];
      const weight = num(`D${itemRow}`);
      const value = (itemScore.get(itemRow) ?? 0) * weight;
      categoryScore += value;
      set(`B${row}`, round2(itemScore.get(itemRow) ?? 0));
      set(`C${row}`, round2(weight * 100));
      set(`D${row}`, round2(value));
    }
    const categoryWeight = input.weights.categories[block.category];
    overall += categoryScore * categoryWeight;
    set(`C${block.totalRow}`, 100);
    set(`D${block.totalRow}`, round2(categoryScore));
    set(`E${block.totalRow}`, round2(categoryWeight * 100));
    set(`F${block.totalRow}`, round2(categoryScore * categoryWeight));
  }
  set(`G${OVERALL_ROW}`, 100);
  set(`H${OVERALL_ROW}`, round2(overall));

  // Aspek KPMR: pillar averages (pengawas) and their weights.
  const pillars = [...new Set(scoringConfig2026.kpmrQuestions.map((q) => q.pillar))];
  pillars.forEach((pillar, i) => {
    const avg = scores.kpmrPillarAverages.pengawas[pillar] ?? 0;
    const weight = input.weights.kpmrPillars[pillar];
    // BI's layout prints "(20%)" in each pillar heading; show the weight actually used.
    const heading = ws.getCell(`A${PILLAR_HEADING_ROWS[i]}`);
    if (typeof heading.value === "string") heading.value = heading.value.replace(/\(\d+(?:[.,]\d+)?%\)/, `(${round2(weight * 100)}%)`);
    set(`B${PILLAR_ROWS[i]}`, round2(avg));
    set(`C${PILLAR_ROWS[i]}`, round2(weight * 100));
    set(`D${PILLAR_ROWS[i]}`, round2(avg * weight));
  });
  set(`C${KPMR_TOTAL_ROW}`, 100);
  set(`D${KPMR_TOTAL_ROW}`, round2(scores.kpmrOverall.pengawas));

  // Sebelum Judgement = the PJP's own data; Sesudah Judgement = the pengawas assessment (the app's final score).
  set("B156", round2(scores.inherentScore.pjp));
  set("C156", titleCase(scores.inherentPredikat.pjp));
  set("B157", round2(scores.kpmrOverall.pjp));
  set("C157", titleCase(scores.kpmrPredikat.pjp));
  set("C158", scoreOrNA(scores.finalIra.pjp));
  set("B163", round2(scores.inherentScore.pengawas));
  set("C163", titleCase(scores.inherentPredikat.pengawas));
  set("B164", round2(scores.kpmrOverall.pengawas));
  set("C164", titleCase(scores.kpmrPredikat.pengawas));
  set("C165", scoreOrNA(scores.finalIra.pengawasAdjusted));

  return Buffer.from(await wb.xlsx.writeBuffer());
}

