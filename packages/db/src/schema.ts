import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
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
  layoutJson: jsonb("layout_json").notNull(),
  inputCellsJson: jsonb("input_cells_json").notNull(),
  scoringConfigJson: jsonb("scoring_config_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const periods = pgTable("periods", {
  id: uuid("id").defaultRandom().primaryKey(),
  year: integer("year").notNull(),
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

export const biTransactions = pgTable("bi_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  pjpSandi: text("pjp_sandi")
    .notNull()
    .references(() => pjp.sandi),
  periodId: uuid("period_id")
    .notNull()
    .references(() => periods.id),
  freqIn: integer("freq_in"),
  nominalIn: numeric("nominal_in"),
  freqOut: integer("freq_out"),
  nominalOut: numeric("nominal_out"),
  freqDomestic: integer("freq_domestic"),
  nominalDomestic: numeric("nominal_domestic"),
  totalFreq: integer("total_freq"),
  totalNominal: numeric("total_nominal"),
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

export const cellInputs = pgTable("cell_inputs", {
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
});

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
});
