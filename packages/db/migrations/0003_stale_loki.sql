CREATE TABLE "shared_cell_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"cell_ref" text NOT NULL,
	"value" jsonb,
	"source" "cell_input_source" NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared_cell_inputs" ADD CONSTRAINT "shared_cell_inputs_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_cell_inputs" ADD CONSTRAINT "shared_cell_inputs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shared_cell_inputs_period_cell_idx" ON "shared_cell_inputs" USING btree ("period_id","cell_ref");--> statement-breakpoint
-- A2's "Keterangan" column (the only A2 input cells in column M) becomes one value per period:
-- keep the most recently edited value per period, then drop the per-workbook copies.
INSERT INTO "shared_cell_inputs" ("period_id", "cell_ref", "value", "source", "updated_by", "updated_at")
SELECT DISTINCT ON (w."period_id", ci."cell_ref") w."period_id", ci."cell_ref", ci."value", ci."source", ci."updated_by", ci."updated_at"
FROM "cell_inputs" ci
JOIN "workbooks" w ON w."id" = ci."workbook_id"
WHERE ci."cell_ref" ~ '^A2\. PJP ALL peng!M[0-9]+$'
ORDER BY w."period_id", ci."cell_ref", ci."updated_at" DESC;--> statement-breakpoint
DELETE FROM "cell_inputs" WHERE "cell_ref" ~ '^A2\. PJP ALL peng!M[0-9]+$';
