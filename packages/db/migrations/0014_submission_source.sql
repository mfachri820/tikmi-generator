CREATE TYPE "public"."submission_source" AS ENUM('form', 'manual');--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "source" "submission_source" DEFAULT 'form' NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "uploaded_by" uuid;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;