ALTER TABLE "periods" ALTER COLUMN "official_rating_basis" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "periods" ALTER COLUMN "official_rating_basis" DROP NOT NULL;