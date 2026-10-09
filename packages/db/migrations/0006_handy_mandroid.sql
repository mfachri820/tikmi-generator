CREATE TABLE "weight_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"weights" jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "weight_settings" ADD CONSTRAINT "weight_settings_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_settings" ADD CONSTRAINT "weight_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;