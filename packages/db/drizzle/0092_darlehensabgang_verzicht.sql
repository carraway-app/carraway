ALTER TYPE "public"."buchungsquelle" ADD VALUE 'principal_disposal';--> statement-breakpoint
ALTER TYPE "public"."buchungsquelle" ADD VALUE 'impairment_disposal';--> statement-breakpoint
ALTER TYPE "public"."buchungsquelle" ADD VALUE 'interest_waiver';--> statement-breakpoint
ALTER TYPE "public"."buchungsquelle" ADD VALUE 'principal_waiver';--> statement-breakpoint
ALTER TYPE "public"."vorgang_art" ADD VALUE 'principal_disposal';--> statement-breakpoint
ALTER TYPE "public"."vorgang_art" ADD VALUE 'impairment_disposal';--> statement-breakpoint
ALTER TYPE "public"."vorgang_art" ADD VALUE 'interest_waiver';--> statement-breakpoint
CREATE TABLE "darlehen_verzicht" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"datum" date NOT NULL,
	"grund" text NOT NULL,
	"dokument_id" uuid,
	"schritte" jsonb NOT NULL,
	"storniert_am" timestamp with time zone,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vorgang" ADD COLUMN "verzicht_id" uuid;--> statement-breakpoint
ALTER TABLE "vorgang" ADD COLUMN "darlehensverkauf_id" uuid;--> statement-breakpoint
ALTER TABLE "vorgang" ADD COLUMN "zinsverzicht_bis" date;--> statement-breakpoint
ALTER TABLE "darlehen_verzicht" ADD CONSTRAINT "darlehen_verzicht_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "darlehen_verzicht" ADD CONSTRAINT "darlehen_verzicht_dokument_id_dokument_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "darlehen_verzicht_instrument_idx" ON "darlehen_verzicht" USING btree ("instrument_id");--> statement-breakpoint
ALTER TABLE "vorgang" ADD CONSTRAINT "vorgang_verzicht_id_darlehen_verzicht_id_fk" FOREIGN KEY ("verzicht_id") REFERENCES "public"."darlehen_verzicht"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vorgang" ADD CONSTRAINT "vorgang_darlehensverkauf_id_verkauf_id_fk" FOREIGN KEY ("darlehensverkauf_id") REFERENCES "public"."verkauf"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vorgang_verzicht_idx" ON "vorgang" USING btree ("verzicht_id") WHERE "vorgang"."verzicht_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "vorgang_darlehensverkauf_idx" ON "vorgang" USING btree ("darlehensverkauf_id") WHERE "vorgang"."darlehensverkauf_id" IS NOT NULL;
--> statement-breakpoint
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
    WHEN 'darlehen_verzicht' THEN (SELECT b.fonds_id FROM darlehen_verzicht w JOIN instrument i ON i.id = w.instrument_id JOIN beteiligung b ON b.id = i.beteiligung_id WHERE w.id = datensatz)
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
    WHEN 'fonds_kosten' THEN (SELECT x.fonds_id FROM fonds_kosten x WHERE x.id = datensatz)
    WHEN 'gremienmandat' THEN (SELECT b.fonds_id FROM gremienmandat x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'fonds_mitteilung' THEN (SELECT x.fonds_id FROM fonds_mitteilung x WHERE x.id = datensatz)
    ELSE NULL
  END
$$;
