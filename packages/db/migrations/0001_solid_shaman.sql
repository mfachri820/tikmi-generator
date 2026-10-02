DROP TABLE "bi_transactions" CASCADE;--> statement-breakpoint
ALTER TABLE "periods" ADD COLUMN "data_year" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "pjp" ADD COLUMN "sort_order" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "xlsx_base64" text NOT NULL;