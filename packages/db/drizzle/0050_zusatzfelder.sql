-- Zusatzfelder überall (Etappe 21): Werte an Fonds, Finanzierungsrunde, Beteiligung (und deren Instrument) und Vorgang; Felddefinitionen für alle Objekte.
CREATE TYPE "public"."feld_objekt" AS ENUM('organisation', 'person', 'deal', 'fonds', 'runde', 'instrument', 'beteiligung', 'vorgang');--> statement-breakpoint
ALTER TABLE "feld_definition" ALTER COLUMN "objekt" SET DATA TYPE "public"."feld_objekt" USING "objekt"::text::"public"."feld_objekt";--> statement-breakpoint
ALTER TABLE "beteiligung" ADD COLUMN "felder" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "beteiligung" ADD COLUMN "instrument_felder" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "finanzierungsrunde" ADD COLUMN "felder" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fonds" ADD COLUMN "felder" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "vorgang" ADD COLUMN "felder" jsonb DEFAULT '{}'::jsonb NOT NULL;