ALTER TYPE "public"."dokument_status" ADD VALUE 'endgueltig_geloescht';--> statement-breakpoint
ALTER TABLE "dokument" ADD COLUMN "endgueltig_geloescht_am" timestamp with time zone;