import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * TIKMI Generator schema. One assessment per PJP per period, in two parts
 * (MR KK, IT KK). Only typed cells are stored (`cell_inputs`, keyed by template
 * address); every formula is recomputed by `@tikmi/scoring`, and export writes
 * the typed cells back into the untouched KK template.
 */

// ---------------------------------------------------------------- users

/**
 * koordinator = ketua tim: finalizes and reopens. pengawas: edits only the
 * PJPs assigned to them. viewer: read-only.
 */
export const userRole = pgEnum("user_role", ["admin", "koordinator", "pengawas", "viewer"]);
export type UserRole = (typeof userRole.enumValues)[number];

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  /** Short code shown in lists (the old pengawas folder code: AA, AF, AGT, ...). */
  initials: text("initials"),
  email: text("email").notNull().unique(),
  role: userRole("role").notNull().default("pengawas"),
  /** scrypt hash (see passwords.ts); null = cannot sign in until an admin sets a password. */
  passwordHash: text("password_hash"),
  active: boolean("active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Signed-in browsers. Only the SHA-256 of the cookie token is stored. */
export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ---------------------------------------------------------------- periods, templates, weights

export const periodStatus = pgEnum("period_status", ["draft", "active", "closed"]);
/**
 * Which Rating M is official: C64 (Berdasarkan Asesmen Mandiri, row 39) or F64 (Berdasarkan Penilaian
 * Pengawas, row 55). Both are KK cells and both are always shown. Null = not decided (2025: unset until
 * the methodology owner confirms), and then neither is labelled official.
 */
export const ratingBasis = pgEnum("rating_basis", ["template", "validasi_pengawas"]);

export const periods = pgTable("periods", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** E.g. "2025": the data year the self-assessments cover (template cell E9). */
  code: text("code").notNull().unique(),
  dataYear: integer("data_year").notNull(),
  /** Expected Posisi Penilaian (template cell D9), e.g. "1 Januari - 31 Desember". */
  posisi: text("posisi").notNull(),
  /** Submission deadline (19 Nov 2026 23.59 WIB for the 2025 round). */
  deadline: timestamp("deadline", { withTimezone: true }).notNull(),
  status: periodStatus("status").notNull().default("draft"),
  officialRatingBasis: ratingBasis("official_rating_basis"),
  /**
   * Other per-period switches (all off by default): Google Sheet push target,
   * IRA APU-PPT import for PU-PT, ... Typed in apps/web/lib/periodSettings.ts.
   */
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** What a stored template workbook is. PJP templates are used to recognise submissions; KK templates are filled on export. */
export const templateRole = pgEnum("template_role", [
  "mr_kk_b2",
  "mr_kk_b3",
  "it_kk",
  "mr_pjp_b2",
  "mr_pjp_b3",
  "it_pjp",
  "it_rekap",
]);
export type TemplateRole = (typeof templateRole.enumValues)[number];

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => periods.id),
    role: templateRole("role").notNull(),
    filename: text("filename").notNull(),
    sha256: text("sha256").notNull(),
    /** Private storage object holding the .xlsx (see apps/web/lib/fileStorage.ts). */
    storageKey: text("storage_key").notNull(),
    /** Grid layout (styles, merges, widths) from packages/template's extractLayout. */
    layoutJson: jsonb("layout_json"),
    /** Newest row per (period, role) is the one in use; older rows stay for exports made with them. */
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("templates_period_role_sha_idx").on(t.periodId, t.role, t.sha256)],
);

/**
 * Risk weights (Form Penilaian C10:L10), versioned: every save is a new row and
 * the newest per (period, bundling, bentuk lembaga) is in force. Seeded from the
 * `DropDown List` of the KK that matches the bundling (the Bundling 2 KK's copy
 * of the Bundling 3 row is outdated). Keys: OPS LIQ KEU CR CMP PUPT HK STG RPT PK.
 */
export const weightSets = pgTable(
  "weight_sets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => periods.id),
    bundling: integer("bundling").notNull(),
    /** As in the KK's weight table: "Bank" or "Lembaga Selain Bank". */
    bentukLembaga: text("bentuk_lembaga").notNull(),
    weights: jsonb("weights").notNull(),
    source: text("source").notNull(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("weight_sets_lookup_idx").on(t.periodId, t.bundling, t.bentukLembaga, t.createdAt)],
);

// ---------------------------------------------------------------- PJP master

export const pjp = pgTable("pjp", {
  /** Sandi LBUT/LSBU, as text with leading zeros (e.g. "033000000"). */
  sandi: text("sandi").primaryKey(),
  /** Official name, from `Lamp. PJP` or entered by an admin. */
  nama: text("nama").notNull(),
  /** `Lamp. PJP` column B (PJP LR, PJP LSB, PJP Bank, ...). */
  kategoriLamp: text("kategori_lamp"),
  /** Name as listed in this round's Google Form dropdown, when it is listed. */
  formName: text("form_name"),
  /** Expected bundling (2 or 3); confirmed or corrected from submissions. */
  bundling: integer("bundling"),
  /** Supervised by this KPw this round (in the form's list or added by an admin). */
  supervised: boolean("supervised").notNull().default(false),
  defaultPengawasId: uuid("default_pengawas_id").references(() => users.id),
  /** "lamp_pjp" or "admin". */
  source: text("source").notNull(),
  sortOrder: integer("sort_order"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const aliasStatus = pgEnum("alias_status", [
  /** Normalised name equals a PJP's normalised name. */
  "auto",
  /** An admin confirmed it (a fuzzy suggestion or a manual pick). */
  "confirmed",
  /** Fuzzy match waiting for one-click confirmation; `suggested_sandi` holds the candidate. */
  "suggested",
  /** No candidate: an admin has to pick a PJP or enter a missing Sandi. */
  "unmatched",
  "rejected",
]);
export type AliasStatus = (typeof aliasStatus.enumValues)[number];

/** Every PJP name spelling seen (form dropdown, "Other" answers, file D4) and the Sandi it means. */
export const pjpAliases = pgTable(
  "pjp_aliases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    alias: text("alias").notNull(),
    /** packages/pjp-master normalizeName(alias): the matching key. */
    normalized: text("normalized").notNull(),
    sandi: text("sandi").references(() => pjp.sandi),
    suggestedSandi: text("suggested_sandi").references(() => pjp.sandi),
    score: real("score"),
    status: aliasStatus("status").notNull(),
    /** "form_list", "form_other", "file_d4", "lamp_pjp", "admin". */
    source: text("source").notNull(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("pjp_aliases_normalized_idx").on(t.normalized)],
);

// ---------------------------------------------------------------- submissions

export const fileKind = pgEnum("file_kind", ["mr", "it"]);
export type FileKind = (typeof fileKind.enumValues)[number];
export const parseStatus = pgEnum("parse_status", ["pending", "parsed", "failed"]);
/** form: the Google Form (Apps Script). manual: uploaded by a pengawas/admin on the PJP page. */
export const submissionSource = pgEnum("submission_source", ["form", "manual"]);

/**
 * One Google Form response version. Response editing is on: an edited response
 * arrives again with the same `response_id` and becomes a new version.
 */
export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => periods.id),
    responseId: text("response_id").notNull(),
    /** 1, 2, ... per response_id. */
    version: integer("version").notNull(),
    source: submissionSource("source").notNull().default("form"),
    /** Manual uploads: who uploaded (the activity log also names them). */
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    respondentEmail: text("respondent_email"),
    /** Dropdown answer, and the "Other" text when the dropdown says Other. */
    formPjpName: text("form_pjp_name").notNull(),
    formPjpOther: text("form_pjp_other"),
    /** 2 or 3, from "Bundling Aktivitas". */
    formBundling: integer("form_bundling"),
    /** Null until the name is matched (then the submission joins the review queue's resolution). */
    pjpSandi: text("pjp_sandi").references(() => pjp.sandi),
    /** Every answer, keyed by item ID (titles repeat between Bagian 2 and 3). */
    answers: jsonb("answers").notNull(),
  },
  (t) => [
    uniqueIndex("submissions_response_version_idx").on(t.periodId, t.responseId, t.version),
    index("submissions_pjp_idx").on(t.periodId, t.pjpSandi),
  ],
);

/** An uploaded workbook of a submission. Originals of every version are kept in private storage. */
export const submissionFiles = pgTable(
  "submission_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    kind: fileKind("kind").notNull(),
    originalName: text("original_name").notNull(),
    driveFileId: text("drive_file_id"),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    parseStatus: parseStatus("parse_status").notNull().default("pending"),
    /** Parser output summary + validation report (packages/tikmi-parser). */
    report: jsonb("report"),
    /**
     * Can become the active version (packages/parser decideFile). False for a non-TIKMI or unreadable file, the
     * other kind, or the other bundling's template; the previous valid version then stays active.
     */
    valid: boolean("valid"),
    /** Why it cannot become active: unreadable, not_tikmi, wrong_kind, wrong_bundling. */
    excluded: text("excluded"),
    /** "ok" or "perlu_perbaikan" (used, but Final is blocked: wrong Posisi/year). Null when excluded. */
    acceptance: text("acceptance"),
    parsedAt: timestamp("parsed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("submission_files_submission_kind_idx").on(t.submissionId, t.kind)],
);

// ---------------------------------------------------------------- assessments

export const assessmentStatus = pgEnum("assessment_status", ["draft", "direview", "final"]);
export type AssessmentStatus = (typeof assessmentStatus.enumValues)[number];

export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => periods.id),
    pjpSandi: text("pjp_sandi")
      .notNull()
      .references(() => pjp.sandi),
    /** 2 or 3: picks the MR KK template and weight table. */
    bundling: integer("bundling").notNull(),
    status: assessmentStatus("status").notNull().default("draft"),
    pengawasId: uuid("pengawas_id").references(() => users.id),
    /** Pengawas marks the PJP as an SPBI participant: switches the TI-SPBI sheets on. */
    spbiParticipant: boolean("spbi_participant").notNull().default(false),
    finalizedBy: uuid("finalized_by").references(() => users.id),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("assessments_period_pjp_idx").on(t.periodId, t.pjpSandi)],
);

export const assessmentParts = pgTable(
  "assessment_parts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    kind: fileKind("kind").notNull(),
    /** The KK template the part is shown in and exported to. */
    templateId: uuid("template_id")
      .notNull()
      .references(() => templates.id),
    /** Submission file whose PJP values the part shows. */
    activeFileId: uuid("active_file_id").references(() => submissionFiles.id),
    /** Set when a pengawas pinned a version; null = the latest valid version is used automatically. */
    pinnedBy: uuid("pinned_by").references(() => users.id),
    /**
     * IT only: pengawas override of the applicable sheet pairs { pairs, note, by, at }. Without it,
     * applicability is derived from the MR service declarations (packages/scoring deriveItApplicability).
     */
    applicabilityOverride: jsonb("applicability_override"),
    /**
     * Pengawas accepts a "Perlu Perbaikan" file anyway { fileId, note, by, at }: Final is no longer blocked for
     * that file. Applies to that file only; a new version needs its own decision.
     */
    perbaikanOverride: jsonb("perbaikan_override"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("assessment_parts_assessment_kind_idx").on(t.assessmentId, t.kind)],
);

/**
 * pjp: parsed from the PJP's file. pengawas: a pengawas input cell (scores,
 * K/L, E6, I/J, narrative). koreksi: a pengawas correction of a PJP cell (note
 * required; the PJP value stays in the file and the audit log). system: set by
 * the app (BI-sourced rows, identity).
 */
export const cellSource = pgEnum("cell_source", ["pjp", "pengawas", "koreksi", "system"]);
export type CellSource = (typeof cellSource.enumValues)[number];

export const cellInputs = pgTable(
  "cell_inputs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    partId: uuid("part_id")
      .notNull()
      .references(() => assessmentParts.id, { onDelete: "cascade" }),
    /**
     * Template address, e.g. "1 - Asesmen Risiko!H22" in the KK's own sheet
     * names. App-only inputs that have no KK cell use the sheet "_app"
     * (e.g. "_app!PUPT", "_app!PUPT_NOTE").
     */
    cellRef: text("cell_ref").notNull(),
    value: jsonb("value"),
    source: cellSource("source").notNull(),
    note: text("note"),
    /** Under a koreksi: the PJP's own value (from its file), so a resubmission that changes it can be flagged. */
    pjpValue: jsonb("pjp_value"),
    /** For pjp cells: the submission file the value came from. */
    fileId: uuid("file_id").references(() => submissionFiles.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("cell_inputs_part_cell_idx").on(t.partId, t.cellRef)],
);

export const comments = pgTable("comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  partId: uuid("part_id")
    .notNull()
    .references(() => assessmentParts.id, { onDelete: "cascade" }),
  cellRef: text("cell_ref").notNull(),
  threadId: uuid("thread_id").notNull(),
  body: text("body").notNull(),
  resolved: boolean("resolved").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const yjsSnapshots = pgTable("yjs_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  partId: uuid("part_id")
    .notNull()
    .references(() => assessmentParts.id, { onDelete: "cascade" }),
  stateBlob: text("state_blob").notNull(),
  version: integer("version").notNull(),
});

// ---------------------------------------------------------------- activity log

export const auditEvent = pgEnum("audit_event", [
  "cell",
  "koreksi",
  "ingest",
  "version",
  "status",
  "finalize",
  "reopen",
  "assign",
  "setting",
  "weights",
  "sumber_bi",
  "pjp_master",
  "bundling",
  "applicability",
  "perbaikan_override",
  "export",
]);
export type AuditEvent = (typeof auditEvent.enumValues)[number];

/** Every change, who made it and why. Cell writes go through `recordCellInput`, which logs them in the same transaction. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    event: auditEvent("event").notNull(),
    /** Null for events outside one assessment (Sumber BI upload, PJP master, settings). */
    assessmentId: uuid("assessment_id").references(() => assessments.id, { onDelete: "cascade" }),
    partId: uuid("part_id").references(() => assessmentParts.id, { onDelete: "cascade" }),
    cellRef: text("cell_ref"),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    reason: text("reason"),
    userId: uuid("user_id").references(() => users.id),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_log_assessment_idx").on(t.assessmentId, t.at), index("audit_log_at_idx").on(t.at)],
);

// ---------------------------------------------------------------- Sumber BI

/** `Sumber BI 1 Tahun` / `Sumber BI (6 Bulan)` (per PJP and data ID) or `Industri(6 Bulan)` (per data ID). */
export const sumberBiKind = pgEnum("sumber_bi_kind", ["1_tahun", "6_bulan", "industri"]);
export type SumberBiKind = (typeof sumberBiKind.enumValues)[number];
export const sumberBiSource = pgEnum("sumber_bi_source", ["seed", "upload"]);
export const uploadStatus = pgEnum("upload_status", ["parsing", "ready", "failed"]);

/** One BI data file as imported; exactly one active per (period, kind) fills the KK's BI-sourced rows. */
export const sumberBiUploads = pgTable(
  "sumber_bi_uploads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => periods.id),
    kind: sumberBiKind("kind").notNull(),
    source: sumberBiSource("source").notNull(),
    filename: text("filename").notNull(),
    /** Null for seeds read from a template. */
    storageKey: text("storage_key"),
    sha256: text("sha256").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
    status: uploadStatus("status").notNull().default("parsing"),
    rowCount: integer("row_count"),
    /** Parse report: counts, flags, duplicate keys, distinct IDs and pelapor. */
    report: jsonb("report"),
    isActive: boolean("is_active").notNull().default(false),
  },
  (t) => [
    uniqueIndex("sumber_bi_uploads_sha_idx").on(t.periodId, t.kind, t.sha256),
    uniqueIndex("sumber_bi_uploads_one_active").on(t.periodId, t.kind).where(sql`${t.isActive}`),
  ],
);

/**
 * Rows in file order. The KK's VLOOKUP takes the first row whose `idx` matches,
 * so `row_no` decides between duplicate keys.
 */
export const sumberBiRows = pgTable(
  "sumber_bi_rows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    uploadId: uuid("upload_id")
      .notNull()
      .references(() => sumberBiUploads.id, { onDelete: "cascade" }),
    rowNo: integer("row_no").notNull(),
    /** Data ID, e.g. "R.OPS.1.c.55". */
    dataId: text("data_id").notNull(),
    ket: text("ket"),
    /** Sandi of the reporting PJP, 9 digits with leading zeros. Null for `industri`. */
    idpelapor: text("idpelapor"),
    /** Lookup key `${dataId}-${idpelapor}` (as the template's `idx` column). */
    idx: text("idx"),
    amount: doublePrecision("amount"),
    /** Non-numeric amount as written ("NA", "#DIV/0!"): looked up as text, flagged in the report. */
    amountText: text("amount_text"),
  },
  (t) => [index("sumber_bi_rows_upload_idx").on(t.uploadId, t.idx, t.rowNo)],
);

// ---------------------------------------------------------------- exports

export const exportKind = pgEnum("export_kind", ["kk_mr", "kk_it", "rekap_xlsx", "sheet_push"]);

export const exports = pgTable("exports", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: exportKind("kind").notNull(),
  assessmentId: uuid("assessment_id").references(() => assessments.id, { onDelete: "set null" }),
  periodId: uuid("period_id").references(() => periods.id),
  storageKey: text("storage_key"),
  status: text("status").notNull(),
  /** Exported from a Final assessment: the file is stamped "FINAL" with this date. */
  finalAt: timestamp("final_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
