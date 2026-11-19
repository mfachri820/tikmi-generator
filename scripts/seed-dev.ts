#!/usr/bin/env tsx
/**
 * One-time dev seed. Creates everything the `/workbook` UI and `/api/*`
 * routes need:
 *  - one `template_versions` row: layout extracted from a real, non-malformed
 *    2026 fixture, and that fixture's bytes stored as the template
 *    (`xlsx_base64` -- the app runs on Vercel, which has no filesystem). The
 *    repo has no blank "Excel Template Filled" yet; a filled fixture is safe
 *    because export rewrites every input cell and the Validasi sheet.
 *  - one active `periods` row (2026 assessment, 2025 data)
 *  - `pjp` rows (in sheet order) and `pjp_validation_meta` (Status PJP /
 *    Keterangan) from that fixture's "Validasi Data Transaksi" sheet
 *  - the Indomarco `ltdbb_code_overrides` row, then the default LTDBB import
 *    from the repo-root workbook (see scripts/lib/ltdbbDefault.ts)
 *  - a handful of real `field_mappings`, verified against the actual
 *    `Raw_Data_IRA` headers in `[Master] Rekap_IRA.xlsx` (columns 7-18 ->
 *    C2!C6:C17, columns 20-22 -> C2!C22:C24, columns 24-25 -> C2!C28:C29).
 *    `formColumn` is the header text, not a real Apps Script item ID -- this
 *    environment has no access to the live form, same limitation the build
 *    plan and README already call out for the ingest webhook.
 *  - one fully-populated demo `workbooks` row (or N with `--workbooks=N`, each
 *    from its own PJP's fixture), with every input cell written through
 *    `recordCellInput` (so `audit_log` gets real rows too), for the grid to render.
 *
 * Reads only from IRA_FIXTURES_DIR and the gitignored LTDBB file; never
 * commits PJP data (see ground rules).
 *
 * Usage: IRA_FIXTURES_DIR=... npx tsx scripts/seed-dev.ts [specific-fixture.xlsx] [--workbooks=N]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import ExcelJS from "exceljs";
import { extractLayout, parseCellRef } from "@tikmi/template";
import { eq } from "drizzle-orm";
import {
  createDb,
  fieldMappings,
  generateTemporaryPassword,
  hashPassword,
  ltdbbCodeOverrides,
  periods,
  pjp,
  pjpValidationMeta,
  recordCellInput,
  templateVersions,
  users,
  workbooks,
} from "@tikmi/db";
import { parameterShareRefs, scoringConfig2026 } from "../packages/scoring/config/2026";
import { inputCellRefs2026, sharedCellRefs2026 } from "../packages/scoring/config/2026-input-cells";
import { DEFAULT_LTDBB_FILE, importLtdbbFile } from "./lib/ltdbbDefault";
import { replaceKpmrMappings } from "./lib/kpmrMappings";

const C2_SHEET = "C2. Form PJP LR";
const A2_SHEET = "A2. PJP ALL peng";
const KPMR_SHEET = "B. KPMR 2025";
const VALIDASI_SHEET = "Validasi Data Transaksi";
const DEV_USER_EMAIL = "mfachri820@gmail.com";
const ASSESSMENT_YEAR = 2026;
const DATA_YEAR = 2025;

function rawCellValue(raw: unknown): unknown {
  if (raw != null && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if ("result" in obj) return obj.result;
    if ("hyperlink" in obj) return obj.hyperlink ?? obj.text ?? null;
    if ("richText" in obj && Array.isArray(obj.richText)) {
      return (obj.richText as { text: string }[]).map((r) => r.text).join("");
    }
  }
  return raw;
}

function findWorkbookFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...findWorkbookFiles(full));
    else if (entry.startsWith("IRA_") && entry.endsWith(".xlsx")) files.push(full);
  }
  return files;
}

/** The known malformed fixture (see build plan / golden-test): never pick it as the demo workbook or layout source. */
function isMalformedFixture(path: string): boolean {
  return path.includes("777111112");
}

async function main() {
  const fixturesDir = process.env.IRA_FIXTURES_DIR;
  if (!fixturesDir) {
    console.error("Set IRA_FIXTURES_DIR (the 66-fixture folder, see .env.example).");
    process.exit(1);
  }

  const files = findWorkbookFiles(fixturesDir).filter((f) => !isMalformedFixture(f)).sort();
  if (files.length === 0) {
    console.error(`No usable IRA_<Sandi>.xlsx fixtures found under ${fixturesDir}`);
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const demoFilePath = args.find((a) => !a.startsWith("--")) ?? files[0];
  const workbookCount = Number(args.find((a) => a.startsWith("--workbooks="))?.split("=")[1] ?? 1);
  if (!Number.isInteger(workbookCount) || workbookCount < 1) {
    console.error("--workbooks=N needs a whole number of at least 1.");
    process.exit(1);
  }

  const demoWb = new ExcelJS.Workbook();
  await demoWb.xlsx.readFile(demoFilePath);

  console.log(`Template source: ${demoFilePath}`);
  const layout = extractLayout(demoWb, new Set(inputCellRefs2026));

  const db = createDb();

  const [devUser] = await db
    .insert(users)
    .values({ name: "Dev Pengawas", email: DEV_USER_EMAIL, role: "admin" })
    .onConflictDoNothing({ target: users.email })
    .returning();
  const user = devUser ?? (await db.select().from(users).where(eq(users.email, DEV_USER_EMAIL)).limit(1))[0];
  // Sign-in for the dev admin: IRA_ADMIN_PASSWORD if set, else a temporary one printed here (changed at first login).
  if (!user.passwordHash) {
    const password = process.env.IRA_ADMIN_PASSWORD || generateTemporaryPassword();
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password), mustChangePassword: !process.env.IRA_ADMIN_PASSWORD })
      .where(eq(users.id, user.id));
    console.log(`Admin login: ${DEV_USER_EMAIL}${process.env.IRA_ADMIN_PASSWORD ? " (password from IRA_ADMIN_PASSWORD)" : ` / temporary password ${password}`}`);
  }

  const [templateVersion] = await db
    .insert(templateVersions)
    .values({
      year: ASSESSMENT_YEAR,
      xlsxFile: basename(demoFilePath),
      xlsxBase64: readFileSync(demoFilePath).toString("base64"),
      layoutJson: layout,
      inputCellsJson: inputCellRefs2026,
      scoringConfigJson: { ...scoringConfig2026, parameterShareRefs },
    })
    .returning();

  const [period] = await db
    .insert(periods)
    .values({ year: ASSESSMENT_YEAR, dataYear: DATA_YEAR, templateVersionId: templateVersion.id, status: "active" })
    .returning();

  // field_mappings: the product/channel/distribution/partner columns verified
  // against the real Raw_Data_IRA headers (see this file's header comment).
  const PRODUCT_COLUMNS = [
    "Total Nominal Cash to Cash (Incoming)",
    "Total Nominal Cash to Cash (Outgoing)",
    "Total Nominal Cash to Cash (Domestic)",
    "Total Nominal Cash to Account (Incoming)",
    "Total Nominal Cash to Account (Outgoing)",
    "Total Nominal Cash to Account (Domestic)",
    "Total Nominal Account to Account (Incoming)",
    "Total Nominal Account to Account (Outgoing)",
    "Total Nominal Account to Account (Domestic)",
    "Total Nominal Account to Cash (Incoming)",
    "Total Nominal Account to Cash (Outgoing)",
    "Total Nominal Account to Cash (Domestic)",
  ];
  const mappingRows = [
    ...PRODUCT_COLUMNS.map((header, i) => ({ header, cell: `C2. Form PJP LR!C${6 + i}` })),
    { header: "Total Nominal Berdasarkan Jalur Distribusi Kantor PTD", cell: "C2. Form PJP LR!C22" },
    {
      header: "Total Nominal Berdasarkan Jalur Distribusi Aplikasi Mobile (dan/atau Website)",
      cell: "C2. Form PJP LR!C23",
    },
    { header: "Total Nominal Berdasarkan Jalur Distribusi Mitra", cell: "C2. Form PJP LR!C24" },
    { header: "Jumlah Mitra Domestik", cell: "C2. Form PJP LR!C28" },
    { header: "Jumlah Mitra Asing", cell: "C2. Form PJP LR!C29" },
  ];
  await db
    .insert(fieldMappings)
    .values(
      mappingRows.map((m) => ({
        templateVersionId: templateVersion.id,
        formColumn: m.header,
        targetCell: m.cell,
        transform: "number",
      })),
    );
  console.log(`Seeded ${mappingRows.length} field_mappings row(s).`);
  const kpmrMappings = await replaceKpmrMappings(db, templateVersion.id);
  console.log(`Seeded ${kpmrMappings.added} KPMR field_mappings row(s) (2027 form -> B. KPMR 2025 H/I).`);

  // pjp (in sheet order) + Status PJP / Keterangan from "Validasi Data Transaksi" (same in every fixture).
  // Its transaction columns are not seeded: those come from the LTDBB import below.
  const validasi = demoWb.getWorksheet(VALIDASI_SHEET);
  if (!validasi) throw new Error(`Sheet "${VALIDASI_SHEET}" not found in ${demoFilePath}`);

  let pjpCount = 0;
  for (let row = 2; row <= validasi.rowCount; row++) {
    const sandi = String(rawCellValue(validasi.getCell(`A${row}`).value) ?? "").trim();
    const nama = String(rawCellValue(validasi.getCell(`B${row}`).value) ?? "").trim();
    if (!sandi || !nama) continue;
    const statusPjp = String(rawCellValue(validasi.getCell(`D${row}`).value) ?? "").trim() || null;
    const keterangan = String(rawCellValue(validasi.getCell(`E${row}`).value) ?? "").trim() || null;

    await db
      .insert(pjp)
      .values({
        sandi,
        nama,
        status: statusPjp ?? "Aktif",
        // Real license type isn't in "Validasi Data Transaksi"; backfill from
        // Simple Result IRA 2026.xlsx once its layout is confirmed (open question
        // in the build plan). PJP KI 3 is correct for every 2026/2027 PJP so far.
        licenseType: "PJP KI 3",
        sortOrder: row - 1,
      })
      .onConflictDoNothing({ target: pjp.sandi });
    await db
      .insert(pjpValidationMeta)
      .values({ dataYear: DATA_YEAR, sandi, statusPjp, keterangan })
      .onConflictDoNothing();
    pjpCount++;
  }
  console.log(`Seeded ${pjpCount} pjp row(s) with Status PJP / Keterangan for ${DATA_YEAR}.`);

  // Kode 777930079 in LTDBB mixes Indogo with Indomarco's rows; Indomarco's real sandi is 777958116.
  await db
    .insert(ltdbbCodeOverrides)
    .values({ namaLtdbb: "Indomarco Prismatama", kode: "777958116" })
    .onConflictDoNothing();

  /** Matches the build plan's Input cells "Filled by" column. */
  function sourceFor(sheet: string, address: string): "form" | "pengawas" {
    if (sheet === C2_SHEET) return "form";
    if (sheet === KPMR_SHEET) return address.startsWith("H") || address.startsWith("I") ? "form" : "pengawas";
    return "pengawas"; // A2: L/M/N/O are all pengawas-filled
  }

  /** One fully-populated workbook from a PJP's own fixture: every typed input cell, through `recordCellInput`. */
  async function seedWorkbook(fixture: ExcelJS.Workbook, filePath: string, status: (typeof workbooks.$inferInsert)["status"]) {
    const sheetByName: Record<string, ExcelJS.Worksheet | undefined> = {
      [C2_SHEET]: fixture.getWorksheet(C2_SHEET),
      [A2_SHEET]: fixture.getWorksheet(A2_SHEET),
      [KPMR_SHEET]: fixture.getWorksheet(KPMR_SHEET),
    };
    const sandiNama = String(rawCellValue(sheetByName[C2_SHEET]?.getCell("B2").value) ?? "");
    const [sandi] = sandiNama.split(" - ");
    if (!sandi) throw new Error(`Could not read "Sandi - Nama" from ${filePath}'s C2!B2`);

    const [workbook] = await db
      .insert(workbooks)
      .values({ pjpSandi: sandi.trim(), periodId: period.id, templateVersionId: templateVersion.id, status })
      .returning();

    let cellCount = 0;
    for (const ref of inputCellRefs2026) {
      const { sheet, address } = parseCellRef(ref);
      const worksheet = sheetByName[sheet];
      if (!worksheet) continue;
      const cellValue = worksheet.getCell(address).value;
      // Some "input" cells (e.g. A2!O, which defaults to a `=L` formula until a
      // pengawas actually overrides it) still hold the template's own formula
      // in an unedited fixture -- that's not a typed value, so leave it out of
      // cell_inputs rather than writing its cached result as a fake override
      // (writeInputCells would then correctly refuse to export it: a formula
      // cell can never be overwritten).
      if (typeof cellValue === "object" && cellValue !== null && "formula" in cellValue) continue;
      const value = rawCellValue(cellValue);
      if (value === null || value === undefined || value === "") continue;

      await recordCellInput(db, {
        workbookId: workbook.id,
        cellRef: ref,
        value: value instanceof Date ? value.toISOString() : value,
        source: sourceFor(sheet, address),
        userId: user.id,
        reason: "dev seed from fixture",
        // A2's Keterangan is one value per period; seeding it here gives every workbook the template's text.
        shared: sharedCellRefs2026.includes(ref),
      });
      cellCount++;
    }
    console.log(`Seeded workbook ${workbook.id} for "${sandiNama}" (${status}) with ${cellCount} cell_inputs.`);
    return workbook;
  }

  // `--workbooks=N`: the template-source fixture first, then the next ones in sorted order, each from its own
  // file. Statuses rotate so the home page shows every stage.
  const STATUSES = ["in_review", "generated", "final", "in_review", "locked"] as const;
  const seedFiles = [demoFilePath, ...files.filter((f) => f !== demoFilePath)].slice(0, workbookCount);
  const seeded = [];
  for (const [i, file] of seedFiles.entries()) {
    const fixture = file === demoFilePath ? demoWb : await new ExcelJS.Workbook().xlsx.readFile(file);
    seeded.push(await seedWorkbook(fixture, file, STATUSES[i % STATUSES.length]));
  }
  const demoWorkbook = seeded[0];

  if (existsSync(DEFAULT_LTDBB_FILE)) {
    await importLtdbbFile(db, DEFAULT_LTDBB_FILE, user.id);
  } else {
    console.warn(`\nNo LTDBB file at ${DEFAULT_LTDBB_FILE}: exports stay blocked until "npm run import-ltdbb <file>".`);
  }

  console.log(`\nOpen http://localhost:3000/workbook/${demoWorkbook.id} after "npm run dev".`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
