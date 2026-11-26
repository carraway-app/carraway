ALTER TABLE "aktivitaet_sync" ADD COLUMN "absender_hash" text;--> statement-breakpoint
ALTER TABLE "aktivitaet_sync" ADD COLUMN "teilnehmer_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "aktivitaet_sync" ADD COLUMN "uebernommen_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "aktivitaet_sync" ADD COLUMN "absage_gemeldet_am" timestamp with time zone;