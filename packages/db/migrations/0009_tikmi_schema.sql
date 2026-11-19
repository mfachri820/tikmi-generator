CREATE TYPE "public"."alias_status" AS ENUM('auto', 'confirmed', 'suggested', 'unmatched', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."assessment_status" AS ENUM('draft', 'direview', 'final');--> statement-breakpoint
CREATE TYPE "public"."audit_event" AS ENUM('cell', 'koreksi', 'ingest', 'version', 'status', 'finalize', 'reopen', 'assign', 'setting', 'weights', 'sumber_bi', 'pjp_master', 'export');--> statement-breakpoint
CREATE TYPE "public"."cell_source" AS ENUM('pjp', 'pengawas', 'koreksi', 'system');--> statement-breakpoint
CREATE TYPE "public"."export_kind" AS ENUM('kk_mr', 'kk_it', 'rekap_xlsx', 'sheet_push');--> statement-breakpoint
CREATE TYPE "public"."file_kind" AS ENUM('mr', 'it');--> statement-breakpoint
CREATE TYPE "public"."parse_status" AS ENUM('pending', 'parsed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('draft', 'active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."rating_basis" AS ENUM('template', 'validasi_pengawas');--> statement-breakpoint
CREATE TYPE "public"."sumber_bi_kind" AS ENUM('1_tahun', '6_bulan', 'industri');--> statement-breakpoint
CREATE TYPE "public"."sumber_bi_source" AS ENUM('seed', 'upload');--> statement-breakpoint
CREATE TYPE "public"."template_role" AS ENUM('mr_kk_b2', 'mr_kk_b3', 'it_kk', 'mr_pjp_b2', 'mr_pjp_b3', 'it_pjp', 'it_rekap');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('parsing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'koordinator', 'pengawas', 'viewer');--> statement-breakpoint
CREATE TABLE "assessment_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"kind" "file_kind" NOT NULL,
	"template_id" uuid NOT NULL,
	"active_file_id" uuid,
	"pinned_by" uuid,
	"applicable_sheets" text[],
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"pjp_sandi" text NOT NULL,
	"bundling" integer NOT NULL,
	"status" "assessment_status" DEFAULT 'draft' NOT NULL,
	"pengawas_id" uuid,
	"finalized_by" uuid,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" "audit_event" NOT NULL,
	"assessment_id" uuid,
	"part_id" uuid,
	"cell_ref" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"reason" text,
	"user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cell_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"cell_ref" text NOT NULL,
	"value" jsonb,
	"source" "cell_source" NOT NULL,
	"note" text,
	"file_id" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"cell_ref" text NOT NULL,
	"thread_id" uuid NOT NULL,
	"body" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "export_kind" NOT NULL,
	"assessment_id" uuid,
	"period_id" uuid,
	"storage_key" text,
	"status" text NOT NULL,
	"final_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"data_year" integer NOT NULL,
	"posisi" text NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"status" "period_status" DEFAULT 'draft' NOT NULL,
	"official_rating_basis" "rating_basis" DEFAULT 'template' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "periods_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "pjp" (
	"sandi" text PRIMARY KEY NOT NULL,
	"nama" text NOT NULL,
	"kategori_lamp" text,
	"form_name" text,
	"bundling" integer,
	"supervised" boolean DEFAULT false NOT NULL,
	"default_pengawas_id" uuid,
	"source" text NOT NULL,
	"sort_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pjp_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alias" text NOT NULL,
	"normalized" text NOT NULL,
	"sandi" text,
	"suggested_sandi" text,
	"score" real,
	"status" "alias_status" NOT NULL,
	"source" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "submission_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"kind" "file_kind" NOT NULL,
	"original_name" text NOT NULL,
	"drive_file_id" text,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"parse_status" "parse_status" DEFAULT 'pending' NOT NULL,
	"report" jsonb,
	"valid" boolean,
	"parsed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"response_id" text NOT NULL,
	"version" integer NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"respondent_email" text,
	"form_pjp_name" text NOT NULL,
	"form_pjp_other" text,
	"form_bundling" integer,
	"pjp_sandi" text,
	"answers" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sumber_bi_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"data_id" text NOT NULL,
	"ket" text,
	"idpelapor" text,
	"idx" text,
	"amount" double precision,
	"amount_text" text
);
--> statement-breakpoint
CREATE TABLE "sumber_bi_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"kind" "sumber_bi_kind" NOT NULL,
	"source" "sumber_bi_source" NOT NULL,
	"filename" text NOT NULL,
	"storage_key" text,
	"sha256" text NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "upload_status" DEFAULT 'parsing' NOT NULL,
	"row_count" integer,
	"report" jsonb,
	"is_active" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"role" "template_role" NOT NULL,
	"filename" text NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"layout_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"initials" text,
	"email" text NOT NULL,
	"role" "user_role" DEFAULT 'pengawas' NOT NULL,
	"password_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "weight_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"bundling" integer NOT NULL,
	"bentuk_lembaga" text NOT NULL,
	"weights" jsonb NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yjs_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"state_blob" text NOT NULL,
	"version" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessment_parts" ADD CONSTRAINT "assessment_parts_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_parts" ADD CONSTRAINT "assessment_parts_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_parts" ADD CONSTRAINT "assessment_parts_active_file_id_submission_files_id_fk" FOREIGN KEY ("active_file_id") REFERENCES "public"."submission_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_parts" ADD CONSTRAINT "assessment_parts_pinned_by_users_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_pjp_sandi_pjp_sandi_fk" FOREIGN KEY ("pjp_sandi") REFERENCES "public"."pjp"("sandi") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_pengawas_id_users_id_fk" FOREIGN KEY ("pengawas_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_part_id_assessment_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."assessment_parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell_inputs" ADD CONSTRAINT "cell_inputs_part_id_assessment_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."assessment_parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell_inputs" ADD CONSTRAINT "cell_inputs_file_id_submission_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."submission_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell_inputs" ADD CONSTRAINT "cell_inputs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_part_id_assessment_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."assessment_parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pjp" ADD CONSTRAINT "pjp_default_pengawas_id_users_id_fk" FOREIGN KEY ("default_pengawas_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pjp_aliases" ADD CONSTRAINT "pjp_aliases_sandi_pjp_sandi_fk" FOREIGN KEY ("sandi") REFERENCES "public"."pjp"("sandi") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pjp_aliases" ADD CONSTRAINT "pjp_aliases_suggested_sandi_pjp_sandi_fk" FOREIGN KEY ("suggested_sandi") REFERENCES "public"."pjp"("sandi") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pjp_aliases" ADD CONSTRAINT "pjp_aliases_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_pjp_sandi_pjp_sandi_fk" FOREIGN KEY ("pjp_sandi") REFERENCES "public"."pjp"("sandi") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sumber_bi_rows" ADD CONSTRAINT "sumber_bi_rows_upload_id_sumber_bi_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."sumber_bi_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sumber_bi_uploads" ADD CONSTRAINT "sumber_bi_uploads_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sumber_bi_uploads" ADD CONSTRAINT "sumber_bi_uploads_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_sets" ADD CONSTRAINT "weight_sets_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_sets" ADD CONSTRAINT "weight_sets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yjs_snapshots" ADD CONSTRAINT "yjs_snapshots_part_id_assessment_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."assessment_parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_parts_assessment_kind_idx" ON "assessment_parts" USING btree ("assessment_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "assessments_period_pjp_idx" ON "assessments" USING btree ("period_id","pjp_sandi");--> statement-breakpoint
CREATE INDEX "audit_log_assessment_idx" ON "audit_log" USING btree ("assessment_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "cell_inputs_part_cell_idx" ON "cell_inputs" USING btree ("part_id","cell_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "pjp_aliases_normalized_idx" ON "pjp_aliases" USING btree ("normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_files_submission_kind_idx" ON "submission_files" USING btree ("submission_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_response_version_idx" ON "submissions" USING btree ("period_id","response_id","version");--> statement-breakpoint
CREATE INDEX "submissions_pjp_idx" ON "submissions" USING btree ("period_id","pjp_sandi");--> statement-breakpoint
CREATE INDEX "sumber_bi_rows_upload_idx" ON "sumber_bi_rows" USING btree ("upload_id","idx","row_no");--> statement-breakpoint
CREATE UNIQUE INDEX "sumber_bi_uploads_sha_idx" ON "sumber_bi_uploads" USING btree ("period_id","kind","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "sumber_bi_uploads_one_active" ON "sumber_bi_uploads" USING btree ("period_id","kind") WHERE "sumber_bi_uploads"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "templates_period_role_sha_idx" ON "templates" USING btree ("period_id","role","sha256");--> statement-breakpoint
CREATE INDEX "weight_sets_lookup_idx" ON "weight_sets" USING btree ("period_id","bundling","bentuk_lembaga","created_at");