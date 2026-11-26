ALTER TABLE "fonds_closing_zusage" DROP CONSTRAINT "fonds_closing_zusage_positiv";--> statement-breakpoint
ALTER TABLE "fonds_zeichnung" DROP CONSTRAINT "fonds_zeichnung_anteil_bereich";--> statement-breakpoint
ALTER TABLE "fonds_zeichnung" DROP CONSTRAINT "fonds_zeichnung_zusage_positiv";--> statement-breakpoint
ALTER TABLE "fonds_closing" ADD COLUMN "art" text DEFAULT 'closing' NOT NULL;--> statement-breakpoint
ALTER TABLE "fonds_closing_basis" ADD COLUMN "ausgetreten" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fonds_closing_stand" ADD COLUMN "ausgetreten" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fonds_zeichnung" ADD COLUMN "ausgetreten" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fonds_closing" ADD CONSTRAINT "fonds_closing_art" CHECK ("fonds_closing"."art" IN ('closing', 'verringerung', 'austritt'));--> statement-breakpoint
ALTER TABLE "fonds_closing_zusage" ADD CONSTRAINT "fonds_closing_zusage_positiv" CHECK ("fonds_closing_zusage"."zusage" >= 0);--> statement-breakpoint
ALTER TABLE "fonds_zeichnung" ADD CONSTRAINT "fonds_zeichnung_anteil_bereich" CHECK ("fonds_zeichnung"."anteil" >= 0 AND "fonds_zeichnung"."anteil" <= 1 AND ("fonds_zeichnung"."anteil" > 0 OR "fonds_zeichnung"."ausgetreten"));--> statement-breakpoint
ALTER TABLE "fonds_zeichnung" ADD CONSTRAINT "fonds_zeichnung_zusage_positiv" CHECK ("fonds_zeichnung"."zusage" > 0 OR ("fonds_zeichnung"."ausgetreten" AND "fonds_zeichnung"."zusage" >= 0));