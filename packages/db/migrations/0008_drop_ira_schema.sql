-- TIKMI Generator starts from an empty schema: drop every IRA table and enum.
-- Hand-written (drizzle-kit would ask interactively about renames). The app is new, so no data is migrated.
DROP TABLE IF EXISTS "yjs_snapshots" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "comments" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "audit_log" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "scores" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "shared_cell_inputs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "cell_inputs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "exports" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "ltdbb_monthly" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "ltdbb_uploads" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "ltdbb_code_overrides" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "pjp_validation_meta" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "form_submissions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workbooks" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "field_mappings" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "weight_settings" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "pjp" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "periods" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "template_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "sessions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "users" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."cell_input_source";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."export_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."ltdbb_upload_source";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."ltdbb_upload_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."period_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."user_role";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."workbook_status";
