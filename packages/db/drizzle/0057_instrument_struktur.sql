-- Der Enum-Typ `instrument` heißt jetzt `instrument_art`: Die neue Tabelle `instrument` belegt den Typnamen (jede Tabelle ist auch ein Typ).
ALTER TYPE "public"."instrument" RENAME TO "instrument_art";--> statement-breakpoint
CREATE TYPE "public"."instrument_status" AS ENUM('aktiv', 'gewandelt', 'getilgt', 'verkauft', 'abgeschrieben');--> statement-breakpoint
CREATE TABLE "instrument" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beteiligung_id" uuid NOT NULL,
	"art" "instrument_art" NOT NULL,
	"bezeichnung" text NOT NULL,
	"runde_id" uuid,
	"anteilsklasse_id" uuid,
	"status" "instrument_status" DEFAULT 'aktiv' NOT NULL,
	"felder" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meilenstein" RENAME TO "tranche";--> statement-breakpoint
ALTER TABLE "tranche" RENAME CONSTRAINT "meilenstein_pkey" TO "tranche_pkey";--> statement-breakpoint
ALTER TABLE "tranche" RENAME COLUMN "frist" TO "geplant_am";--> statement-breakpoint
ALTER TABLE "vorgang" RENAME COLUMN "meilenstein_id" TO "tranche_id";--> statement-breakpoint
ALTER TABLE "tranche" DROP CONSTRAINT "meilenstein_betrag_positiv";--> statement-breakpoint
ALTER TABLE "tranche" DROP CONSTRAINT "meilenstein_beteiligung_id_beteiligung_id_fk";
--> statement-breakpoint
ALTER TABLE "vorgang" DROP CONSTRAINT "vorgang_meilenstein_id_meilenstein_id_fk";
--> statement-breakpoint
DROP INDEX "meilenstein_beteiligung_idx";--> statement-breakpoint
ALTER TABLE "darlehen_kondition" ADD COLUMN "instrument_id" uuid;--> statement-breakpoint
ALTER TABLE "forderung" ADD COLUMN "instrument_id" uuid;--> statement-breakpoint
ALTER TABLE "tranche" ADD COLUMN "instrument_id" uuid;--> statement-breakpoint
ALTER TABLE "tranche" ADD COLUMN "nummer" integer;--> statement-breakpoint
ALTER TABLE "rundenposition" ADD COLUMN "instrument_id" uuid;--> statement-breakpoint
ALTER TABLE "verkauf" ADD COLUMN "instrument_id" uuid;--> statement-breakpoint
ALTER TABLE "vorgang" ADD COLUMN "instrument_id" uuid;--> statement-breakpoint
ALTER TABLE "vorgang" ADD COLUMN "beglichen_vorgang_id" uuid;--> statement-breakpoint
ALTER TABLE "wandlung" ADD COLUMN "quell_instrument_id" uuid;--> statement-breakpoint
ALTER TABLE "wandlung" ADD COLUMN "ziel_instrument_id" uuid;--> statement-breakpoint
ALTER TABLE "zinslauf_position" ADD COLUMN "instrument_id" uuid;--> statement-breakpoint
ALTER TABLE "zinsperiode_gebucht" ADD COLUMN "instrument_id" uuid;--> statement-breakpoint
ALTER TABLE "instrument" ADD CONSTRAINT "instrument_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument" ADD CONSTRAINT "instrument_runde_id_finanzierungsrunde_id_fk" FOREIGN KEY ("runde_id") REFERENCES "public"."finanzierungsrunde"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument" ADD CONSTRAINT "instrument_anteilsklasse_id_anteilsklasse_id_fk" FOREIGN KEY ("anteilsklasse_id") REFERENCES "public"."anteilsklasse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instrument_beteiligung_idx" ON "instrument" USING btree ("beteiligung_id");--> statement-breakpoint
CREATE INDEX "instrument_runde_idx" ON "instrument" USING btree ("runde_id");--> statement-breakpoint
CREATE INDEX "instrument_anteilsklasse_idx" ON "instrument" USING btree ("anteilsklasse_id");--> statement-breakpoint
ALTER TABLE "darlehen_kondition" ADD CONSTRAINT "darlehen_kondition_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forderung" ADD CONSTRAINT "forderung_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tranche" ADD CONSTRAINT "tranche_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tranche" ADD CONSTRAINT "tranche_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rundenposition" ADD CONSTRAINT "rundenposition_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verkauf" ADD CONSTRAINT "verkauf_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vorgang" ADD CONSTRAINT "vorgang_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vorgang" ADD CONSTRAINT "vorgang_tranche_id_tranche_id_fk" FOREIGN KEY ("tranche_id") REFERENCES "public"."tranche"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vorgang" ADD CONSTRAINT "vorgang_beglichen_vorgang_id_vorgang_id_fk" FOREIGN KEY ("beglichen_vorgang_id") REFERENCES "public"."vorgang"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wandlung" ADD CONSTRAINT "wandlung_quell_instrument_id_instrument_id_fk" FOREIGN KEY ("quell_instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wandlung" ADD CONSTRAINT "wandlung_ziel_instrument_id_instrument_id_fk" FOREIGN KEY ("ziel_instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zinslauf_position" ADD CONSTRAINT "zinslauf_position_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zinsperiode_gebucht" ADD CONSTRAINT "zinsperiode_gebucht_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "darlehen_kondition_instrument_idx" ON "darlehen_kondition" USING btree ("instrument_id");--> statement-breakpoint
CREATE INDEX "tranche_beteiligung_idx" ON "tranche" USING btree ("beteiligung_id");--> statement-breakpoint
CREATE INDEX "tranche_instrument_idx" ON "tranche" USING btree ("instrument_id");--> statement-breakpoint
CREATE INDEX "vorgang_instrument_valuta_idx" ON "vorgang" USING btree ("instrument_id","valuta");--> statement-breakpoint
ALTER TABLE "tranche" ADD CONSTRAINT "tranche_betrag_positiv" CHECK ("tranche"."betrag" > 0);
--> statement-breakpoint
-- Die Funktion für das Änderungsprotokoll liest die Tabelle `meilenstein` im Text; sie heißt jetzt `tranche`. Die Objektnamen `meilenstein` (bisher) und `tranche`, `instrument` (neu) führen zum Fonds.
CREATE OR REPLACE FUNCTION aenderung_fonds_von(tabelle text, datensatz uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT CASE tabelle
    WHEN 'fonds' THEN datensatz
    WHEN 'periodensperre' THEN datensatz
    WHEN 'fonds_bewegung' THEN (SELECT x.fonds_id FROM fonds_bewegung x WHERE x.id = datensatz)
    WHEN 'fonds_zeichnung' THEN (SELECT x.fonds_id FROM fonds_zeichnung x WHERE x.id = datensatz)
    WHEN 'beteiligung' THEN (SELECT x.fonds_id FROM beteiligung x WHERE x.id = datensatz)
    WHEN 'vorgang' THEN (SELECT b.fonds_id FROM vorgang x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'meilenstein' THEN (SELECT b.fonds_id FROM tranche x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'tranche' THEN (SELECT b.fonds_id FROM tranche x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'instrument' THEN (SELECT b.fonds_id FROM instrument x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'forderung' THEN (SELECT b.fonds_id FROM forderung x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'darlehen_kondition' THEN (SELECT b.fonds_id FROM darlehen_kondition x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'jahresueberschuss' THEN (SELECT b.fonds_id FROM jahresueberschuss x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'bewertung' THEN (SELECT b.fonds_id FROM bewertung x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'verkauf' THEN (SELECT b.fonds_id FROM verkauf x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'kaufpreisanpassung' THEN (SELECT b.fonds_id FROM kaufpreisanpassung x JOIN verkauf v ON v.id = x.verkauf_id JOIN beteiligung b ON b.id = v.beteiligung_id WHERE x.id = datensatz)
    WHEN 'wandlung' THEN (SELECT b.fonds_id FROM wandlung x JOIN beteiligung b ON b.id = x.darlehen_beteiligung_id WHERE x.id = datensatz)
    WHEN 'zinslauf' THEN (SELECT x.fonds_id FROM zinslauf x WHERE x.id = datensatz)
    WHEN 'bewertungsrunde' THEN (SELECT x.fonds_id FROM bewertungsrunde x WHERE x.id = datensatz)
    WHEN 'bericht' THEN (SELECT coalesce(x.fonds_id, (SELECT b.fonds_id FROM beteiligung b WHERE b.id = x.beteiligung_id)) FROM bericht x WHERE x.id = datensatz)
    WHEN 'deal' THEN (SELECT x.fonds_id FROM deal x WHERE x.id = datensatz)
    WHEN 'deal_phasenwechsel' THEN (SELECT d.fonds_id FROM deal_phasenwechsel x JOIN deal d ON d.id = x.deal_id WHERE x.id = datensatz)
    WHEN 'beschluss' THEN (SELECT d.fonds_id FROM beschluss x JOIN deal d ON d.id = x.deal_id WHERE x.id = datensatz)
    WHEN 'aktivitaet' THEN (SELECT d.fonds_id FROM aktivitaet x JOIN deal d ON d.id = x.deal_id WHERE x.id = datensatz)
    WHEN 'rundenposition' THEN (SELECT x.fonds_id FROM rundenposition x WHERE x.id = datensatz)
    WHEN 'beschlussvorlage' THEN (SELECT x.fonds_id FROM beschlussvorlage x WHERE x.id = datensatz)
    WHEN 'organisationsbeziehung' THEN (SELECT x.fonds_id FROM organisationsbeziehung x WHERE x.id = datensatz)
    WHEN 'fonds_mitteilung' THEN (SELECT x.fonds_id FROM fonds_mitteilung x WHERE x.id = datensatz)
    ELSE NULL
  END
$$;
