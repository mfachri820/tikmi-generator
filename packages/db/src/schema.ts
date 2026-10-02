import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Every typed value is stored once, keyed by its template address (see
 * `cell_inputs` below), so export is a straight write into the template and
 * next year's template is a new `template_versions` row, not new code.
 */

export const userRole = pgEnum("user_role", ["admin", "pengawas", "viewer"]);

export const periodStatus = pgEnum("period_status", ["draft", "active", "closed"]);

export const workbookStatus = pgEnum("workbook_status", [
  "generated",
  "in_review",
  "final",
  "locked",
]);

export const cellInputSource = pgEnum("cell_input_source", ["form", "pengawas", "system"]);
export type CellInputSource = (typeof cellInputSource.enumValues)[number];

export const exportKind = pgEnum("export_kind", [
  "xlsx_individu",
  "rekap",
  "bi_sss",
  "sheet_post",
]);

export const templateVersions = pgTable("template_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  year: integer("year").notNull(),
  xlsxFile: text("xlsx_file").notNull(),
  /** The template .xlsx itself, base64 -- the app runs on Vercel, which has no filesystem to keep it on. */
  xlsxBase64: text("xlsx_base64").notNull(),
  layoutJson: jsonb("layout_json").notNull(),
  inputCellsJson: jsonb("input_cells_json").notNull(),
  scoringConfigJson: jsonb("scoring_config_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const periods = pgTable("periods", {
  id: uuid("id").defaultRandom().primaryKey(),
  year: integer("year").notNull(),
  /** Year the period's transaction data covers, e.g. the 2026 assessment uses 2025 data (the form's "Tahun Laporan"). */
  dataYear: integer("data_year").notNull(),
  templateVersionId: uuid("template_version_id")
    .notNull()
    .references(() => templateVersions.id),
  status: periodStatus("status").notNull().default("draft"),
});

export const fieldMappings = pgTable("field_mappings", {
  id: uuid("id").defaultRandom().primaryKey(),
  templateVersionId: uuid("template_version_id")
    .notNull()
    .references(() => templateVersions.id),
  /** Google Form item ID, not header text -- see the build plan's ingest notes. */
  formColumn: text("form_column").notNull(),
  targetCell: text("target_cell").notNull(),
  transform: text("transform"),
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  /** Folder code: AA, AF, AGT, AJ, D, F, MA. */
  initials: text("initials"),
  email: text("email").notNull().unique(),
  role: userRole("role").notNull().default("pengawas"),
});

export const pjp = pgTable("pjp", {
  sandi: text("sandi").primaryKey(),
  nama: text("nama").notNull(),
  status: text("status").notNull(),
  licenseType: text("license_type").notNull(),
  dedicatedUserId: uuid("dedicated_user_id").references(() => users.id),
  /** Position in the form's 85-PJP list, which is also the row order of "Validasi Data Transaksi". */
  sortOrder: integer("sort_order").notNull(),
});

export const formSubmissions = pgTable("form_submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  pjpSandi: text("pjp_sandi")
    .notNull()
    .references(() => pjp.sandi),
  periodId: uuid("period_id")
    .notNull()
    .references(() => periods.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
  rawJsonb: jsonb("raw_jsonb").notNull(),
  sheetRow: integer("sheet_row"),
  isLatest: boolean("is_latest").notNull().default(true),
});

export const workbooks = pgTable("workbooks", {
  id: uuid("id").defaultRandom().primaryKey(),
  pjpSandi: text("pjp_sandi")
    .notNull()
    .references(() => pjp.sandi),
  periodId: uuid("period_id")
    .notNull()
    .references(() => periods.id),
  templateVersionId: uuid("template_version_id")
    .notNull()
    .references(() => templateVersions.id),
  status: workbookStatus("status").notNull().default("generated"),
  lockedBy: uuid("locked_by").references(() => users.id),
  finalScore: numeric("final_score"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const cellInputs = pgTable(
  "cell_inputs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workbookId: uuid("workbook_id")
      .notNull()
      .references(() => workbooks.id),
    /** Template address, e.g. "A2. PJP ALL peng!O7". */
    cellRef: text("cell_ref").notNull(),
    value: jsonb("value"),
    source: cellInputSource("source").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    /** One current value per cell per workbook; recordCellInput upserts on this. */
    uniqueIndex("cell_inputs_workbook_cell_idx").on(table.workbookId, table.cellRef),
  ],
);

/**
 * Input cells shared by every workbook in a period (e.g. A2's "Keterangan"
 * column): one value per cell per period instead of one per workbook. Written
 * only through `recordCellInput` with `shared: true`.
 */
export const sharedCellInputs = pgTable(
  "shared_cell_inputs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => periods.id),
    /** Template address, e.g. "A2. PJP ALL peng!M7". */
    cellRef: text("cell_ref").notNull(),
    value: jsonb("value"),
    source: cellInputSource("source").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("shared_cell_inputs_period_cell_idx").on(table.periodId, table.cellRef)],
);

export const yjsSnapshots = pgTable("yjs_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  workbookId: uuid("workbook_id")
    .notNull()
    .references(() => workbooks.id),
  stateBlob: text("state_blob").notNull(),
  version: integer("version").notNull(),
});

export const scores = pgTable("scores", {
  id: uuid("id").defaultRandom().primaryKey(),
  workbookId: uuid("workbook_id")
    .notNull()
    .references(() => workbooks.id),
  key: text("key").notNull(),
  pjpValue: numeric("pjp_value"),
  pengawasValue: numeric("pengawas_value"),
});

export const comments = pgTable("comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  workbookId: uuid("workbook_id")
    .notNull()
    .references(() => workbooks.id),
  cellRef: text("cell_ref").notNull(),
  threadId: uuid("thread_id").notNull(),
  body: text("body").notNull(),
  resolved: boolean("resolved").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  workbookId: uuid("workbook_id")
    .notNull()
    .references(() => workbooks.id),
  userId: uuid("user_id").references(() => users.id),
  cellRef: text("cell_ref").notNull(),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  reason: text("reason"),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
});

export const exports = pgTable("exports", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: exportKind("kind").notNull(),
  scope: text("scope").notNull(),
  fileUrl: text("file_url"),
  status: text("status").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  /** The LTDBB snapshot the file's "Validasi Data Transaksi" sheet was filled from. */
  ltdbbUploadId: uuid("ltdbb_upload_id").references(() => ltdbbUploads.id),
});

export const ltdbbUploadStatus = pgEnum("ltdbb_upload_status", ["parsing", "ready", "failed"]);
export const ltdbbUploadSource = pgEnum("ltdbb_upload_source", ["seed", "upload"]);

/** One LTDBB transaction workbook as imported; exactly one is active and feeds "Validasi Data Transaksi". */
export const ltdbbUploads = pgTable(
  "ltdbb_uploads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    filename: text("filename").notNull(),
    source: ltdbbUploadSource("source").notNull(),
    /** Vercel Blob URL for files uploaded through the app; null for the seeded default. */
    blobUrl: text("blob_url"),
    sha256: text("sha256").notNull().unique(),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
    status: ltdbbUploadStatus("status").notNull().default("parsing"),
    rowCount: integer("row_count"),
    minDate: date("min_date"),
    maxDate: date("max_date"),
    /** Parse report: row counts, counts per flag, errors. */
    report: jsonb("report"),
    isActive: boolean("is_active").notNull().default(false),
  },
  (table) => [uniqueIndex("ltdbb_uploads_one_active").on(table.isActive).where(sql`${table.isActive}`)],
);

/** Cleaned Trx_PJPJKT rows: one PJP-month each, Rupiah values from the "Fin" columns. */
export const ltdbbMonthly = pgTable(
  "ltdbb_monthly",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    uploadId: uuid("upload_id")
      .notNull()
      .references(() => ltdbbUploads.id, { onDelete: "cascade" }),
    /** Sandi after `ltdbb_code_overrides`; `kodeRaw` keeps what the file said. */
    kode: text("kode").notNull(),
    kodeRaw: text("kode_raw").notNull(),
    namaLtdbb: text("nama_ltdbb").notNull(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    // double precision, not integer/numeric: frequencies aren't always whole (212036.755) and the
    // template's own totals carry float noise (98727824564.99998); comparisons use a ±1 tolerance.
    finJumlahInc: doublePrecision("fin_jumlah_inc").notNull(),
    finNilaiInc: doublePrecision("fin_nilai_inc").notNull(),
    finJumlahOut: doublePrecision("fin_jumlah_out").notNull(),
    finNilaiOut: doublePrecision("fin_nilai_out").notNull(),
    finJumlahDom: doublePrecision("fin_jumlah_dom").notNull(),
    finNilaiDom: doublePrecision("fin_nilai_dom").notNull(),
    flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
  },
  (table) => [index("ltdbb_monthly_upload_year_kode_idx").on(table.uploadId, table.year, table.kode)],
);

/** LTDBB name -> correct sandi, for rows filed under the wrong Kode (e.g. Indomarco under Indogo's). */
export const ltdbbCodeOverrides = pgTable("ltdbb_code_overrides", {
  namaLtdbb: text("nama_ltdbb").primaryKey(),
  kode: text("kode").notNull(),
});

/** "Status PJP" / "Keterangan" columns of "Validasi Data Transaksi", per data year. Official source still undecided. */
export const pjpValidationMeta = pgTable(
  "pjp_validation_meta",
  {
    dataYear: integer("data_year").notNull(),
    sandi: text("sandi")
      .notNull()
      .references(() => pjp.sandi),
    statusPjp: text("status_pjp"),
    keterangan: text("keterangan"),
  },
  (table) => [primaryKey({ columns: [table.dataYear, table.sandi] })],
);
