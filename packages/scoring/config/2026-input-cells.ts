/**
 * The full "Input cells" list from the build plan: every cell a person types
 * into in the 2026 template, as "Sheet!Address" refs. Everything else in the
 * template is a formula or fixed text the app never writes.
 *
 * This feeds `template_versions.input_cells_json` (via `extractLayout`'s
 * `inputCellRefs` set) and is the allow-list the ingest webhook and the
 * pengawas PATCH route check `cellRef` against before calling
 * `recordCellInput` -- cell addresses are template-version config, not code,
 * per the build plan's ground rules.
 */

const C2_SHEET = "C2. Form PJP LR";
const A2_SHEET = "A2. PJP ALL peng";
const KPMR_SHEET = "B. KPMR 2025";

function range(prefix: string, from: number, to: number): string[] {
  const cells: string[] = [];
  for (let i = from; i <= to; i++) cells.push(`${prefix}${i}`);
  return cells;
}

function sheetRefs(sheet: string, addresses: string[]): string[] {
  return addresses.map((address) => `${sheet}!${address}`);
}

/** The 35 A2 parameter rows (see build plan, "The 35 A2 parameter rows are..."). */
export const a2ParameterRows = [
  7, 8, 10, 11, 13, 14, 15, 16, 17, 19, 20, 23, 24, 26, 27, 29, 30, 31, 32, 34, 35, 38, 39, 41, 42,
  44, 45, 46, 48, 51, 52, 53, 54, 55, 57,
];

/** KPMR's 31 question rows, grouped by the 5 pillars' row ranges. */
export const kpmrQuestionRows = [
  ...range("", 5, 11),
  ...range("", 14, 21),
  ...range("", 24, 33),
  ...range("", 36, 38),
  ...range("", 41, 43),
].map(Number);

const c2Cells = [
  "B2",
  ...range("C", 6, 17),
  ...range("C", 22, 24),
  ...range("C", 28, 29),
  ...range("C", 34, 56),
  "C58",
  ...range("C", 62, 70),
  "C72",
  "C73",
  "C76",
  ...range("C", 80, 117),
  "C120",
  "C121",
  "C123",
  "C127",
  "C128",
  "C131",
  "C132",
  "C135",
  "C136",
  ...range("C", 139, 141),
  "C145",
  "C147",
  "E5",
  "E21",
  "E27",
  "E80",
  "E126",
  "E144",
];

const a2Cells = [
  "L26",
  "L31",
  "L32",
  "L39",
  "L42",
  "L51",
  "L55",
  ...a2ParameterRows.flatMap((row) => [`M${row}`, `N${row}`, `O${row}`]),
];

const kpmrCells = kpmrQuestionRows.flatMap((row) => [`H${row}`, `I${row}`, `J${row}`]);

export const inputCellRefs2026: string[] = [
  ...sheetRefs(C2_SHEET, c2Cells),
  ...sheetRefs(A2_SHEET, a2Cells),
  ...sheetRefs(KPMR_SHEET, kpmrCells),
];

/**
 * Input cells a pengawas may edit in the app (the Input cells table's
 * "Editable in app by" column). Excluded: C2!B2 and the Drive evidence links
 * (system/form only), KPMR H/I (the PJP's own self-score and links), and the
 * A2 L defaults of the 7 manual parameters -- their pengawas judgement is
 * entered in O like every other parameter, which is the cell the scoring
 * engine reads.
 */
export const pengawasEditableCellRefs2026: string[] = [
  ...sheetRefs(C2_SHEET, c2Cells.filter((a) => a.startsWith("C"))),
  ...sheetRefs(A2_SHEET, a2ParameterRows.flatMap((row) => [`M${row}`, `N${row}`, `O${row}`])),
  ...sheetRefs(KPMR_SHEET, kpmrQuestionRows.map((row) => `J${row}`)),
];

/** Pengawas score cells: whole numbers 1-5 only. */
export const scoreCellRefs2026: string[] = [
  ...sheetRefs(A2_SHEET, a2ParameterRows.map((row) => `O${row}`)),
  ...sheetRefs(KPMR_SHEET, kpmrQuestionRows.map((row) => `J${row}`)),
];

/**
 * Input cells with one value per period, shared by every PJP's workbook rather
 * than stored per workbook: A2's "Keterangan" column (the SRA reference text),
 * identical in all 66 2026 fixtures. Editing one in any workbook changes it in all.
 */
export const sharedCellRefs2026: string[] = sheetRefs(A2_SHEET, a2ParameterRows.map((row) => `M${row}`));

/** Notes/keterangan cells: free text. Every other editable cell is a C2 form answer (stored as a number when it parses as one). */
export const textCellRefs2026: string[] = sheetRefs(
  A2_SHEET,
  a2ParameterRows.flatMap((row) => [`M${row}`, `N${row}`]),
);
