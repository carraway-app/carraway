CREATE TYPE "public"."deal_herkunft" AS ENUM('anfrage', 'sourcing');--> statement-breakpoint
CREATE TYPE "public"."deal_typ" AS ENUM('erstinvestment', 'anschlussinvestment');--> statement-breakpoint
ALTER TABLE "benutzer_einstellung" ADD COLUMN "dealflow_kartenfelder" text[] DEFAULT ARRAY['ticket', 'investmentmanager']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "eingangsdatum" date DEFAULT (now() AT TIME ZONE 'Europe/Berlin')::date NOT NULL;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "herkunft" "deal_herkunft";--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "dealtyp" "deal_typ";--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "investmentmanager_id" uuid;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "projektleiter_id" uuid;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_investmentmanager_id_benutzer_id_fk" FOREIGN KEY ("investmentmanager_id") REFERENCES "public"."benutzer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_projektleiter_id_benutzer_id_fk" FOREIGN KEY ("projektleiter_id") REFERENCES "public"."benutzer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Bei Bestandsdeals entspricht der Eingang dem ersten Tag im Phasenverlauf.
UPDATE "deal" d
SET "eingangsdatum" = COALESCE(
  (SELECT min(w.am) FROM "deal_phasenwechsel" w WHERE w.deal_id = d.id),
  (d.erstellt_am AT TIME ZONE 'Europe/Berlin')::date
);
