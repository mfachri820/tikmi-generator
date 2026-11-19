ALTER TYPE "public"."audit_event" ADD VALUE 'bundling' BEFORE 'export';--> statement-breakpoint
ALTER TYPE "public"."audit_event" ADD VALUE 'applicability' BEFORE 'export';--> statement-breakpoint
ALTER TYPE "public"."audit_event" ADD VALUE 'perbaikan_override' BEFORE 'export';--> statement-breakpoint
ALTER TABLE "assessment_parts" ADD COLUMN "applicability_override" jsonb;--> statement-breakpoint
ALTER TABLE "assessment_parts" ADD COLUMN "perbaikan_override" jsonb;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "spbi_participant" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_files" ADD COLUMN "excluded" text;--> statement-breakpoint
ALTER TABLE "submission_files" ADD COLUMN "acceptance" text;