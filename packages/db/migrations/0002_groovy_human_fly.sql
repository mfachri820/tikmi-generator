CREATE TYPE "public"."ltdbb_upload_source" AS ENUM('seed', 'upload');--> statement-breakpoint
CREATE TYPE "public"."ltdbb_upload_status" AS ENUM('parsing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "ltdbb_code_overrides" (
	"nama_ltdbb" text PRIMARY KEY NOT NULL,
	"kode" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ltdbb_monthly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"kode" text NOT NULL,
	"kode_raw" text NOT NULL,
	"nama_ltdbb" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"fin_jumlah_inc" double precision NOT NULL,
	"fin_nilai_inc" double precision NOT NULL,
	"fin_jumlah_out" double precision NOT NULL,
	"fin_nilai_out" double precision NOT NULL,
	"fin_jumlah_dom" double precision NOT NULL,
	"fin_nilai_dom" double precision NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ltdbb_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"source" "ltdbb_upload_source" NOT NULL,
	"blob_url" text,
	"sha256" text NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "ltdbb_upload_status" DEFAULT 'parsing' NOT NULL,
	"row_count" integer,
	"min_date" date,
	"max_date" date,
	"report" jsonb,
	"is_active" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ltdbb_uploads_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "pjp_validation_meta" (
	"data_year" integer NOT NULL,
	"sandi" text NOT NULL,
	"status_pjp" text,
	"keterangan" text,
	CONSTRAINT "pjp_validation_meta_data_year_sandi_pk" PRIMARY KEY("data_year","sandi")
);
--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "ltdbb_upload_id" uuid;--> statement-breakpoint
ALTER TABLE "ltdbb_monthly" ADD CONSTRAINT "ltdbb_monthly_upload_id_ltdbb_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."ltdbb_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ltdbb_uploads" ADD CONSTRAINT "ltdbb_uploads_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pjp_validation_meta" ADD CONSTRAINT "pjp_validation_meta_sandi_pjp_sandi_fk" FOREIGN KEY ("sandi") REFERENCES "public"."pjp"("sandi") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ltdbb_monthly_upload_year_kode_idx" ON "ltdbb_monthly" USING btree ("upload_id","year","kode");--> statement-breakpoint
CREATE UNIQUE INDEX "ltdbb_uploads_one_active" ON "ltdbb_uploads" USING btree ("is_active") WHERE "ltdbb_uploads"."is_active";--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_ltdbb_upload_id_ltdbb_uploads_id_fk" FOREIGN KEY ("ltdbb_upload_id") REFERENCES "public"."ltdbb_uploads"("id") ON DELETE no action ON UPDATE no action;