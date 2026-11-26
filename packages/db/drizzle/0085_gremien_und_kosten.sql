CREATE TYPE "public"."fonds_kosten_art" AS ENUM('verwaltungsverguetung', 'fondskosten');--> statement-breakpoint
CREATE TYPE "public"."fonds_kosten_verteilung" AS ENUM('grundlage', 'manuell');--> statement-breakpoint
CREATE TYPE "public"."gremium_art" AS ENUM('beirat', 'aufsichtsrat', 'board', 'sonstiges');--> statement-breakpoint
CREATE TYPE "public"."mandat_rolle" AS ENUM('mitglied', 'vorsitz', 'stellvertretender_vorsitz', 'beobachter');--> statement-breakpoint
CREATE TABLE "fonds_kosten" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"art" "fonds_kosten_art" NOT NULL,
	"valuta" date NOT NULL,
	"betrag" numeric(18, 2) NOT NULL,
	"verteilung" "fonds_kosten_verteilung" NOT NULL,
	"zeitraum_von" date,
	"zeitraum_bis" date,
	"satz" numeric(9, 6),
	"bemerkung" text,
	"storniert_kosten_id" uuid,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fonds_kosten_vorzeichen" CHECK (("fonds_kosten"."storniert_kosten_id" IS NULL AND "fonds_kosten"."betrag" > 0) OR ("fonds_kosten"."storniert_kosten_id" IS NOT NULL AND "fonds_kosten"."betrag" < 0)),
	CONSTRAINT "fonds_kosten_zeitraum" CHECK ("fonds_kosten"."zeitraum_von" IS NULL OR "fonds_kosten"."zeitraum_bis" IS NULL OR "fonds_kosten"."zeitraum_bis" >= "fonds_kosten"."zeitraum_von"),
	CONSTRAINT "fonds_kosten_satz" CHECK ("fonds_kosten"."satz" IS NULL OR ("fonds_kosten"."satz" > 0 AND "fonds_kosten"."satz" < 1))
);
--> statement-breakpoint
CREATE TABLE "fonds_kosten_anteil" (
	"kosten_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"betrag" numeric(18, 2) NOT NULL,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fonds_kosten_anteil_kosten_id_organisation_id_pk" PRIMARY KEY("kosten_id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "gremienmandat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beteiligung_id" uuid NOT NULL,
	"gremium" "gremium_art" NOT NULL,
	"gremium_name" text,
	"person_id" uuid NOT NULL,
	"rolle" "mandat_rolle" NOT NULL,
	"beginn" date NOT NULL,
	"ende" date,
	"bemerkung" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gremienmandat_zeitraum" CHECK ("gremienmandat"."ende" IS NULL OR "gremienmandat"."ende" >= "gremienmandat"."beginn")
);
--> statement-breakpoint
ALTER TABLE "fonds_kosten" ADD CONSTRAINT "fonds_kosten_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonds_kosten" ADD CONSTRAINT "fonds_kosten_storniert_kosten_id_fonds_kosten_id_fk" FOREIGN KEY ("storniert_kosten_id") REFERENCES "public"."fonds_kosten"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonds_kosten_anteil" ADD CONSTRAINT "fonds_kosten_anteil_kosten_id_fonds_kosten_id_fk" FOREIGN KEY ("kosten_id") REFERENCES "public"."fonds_kosten"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonds_kosten_anteil" ADD CONSTRAINT "fonds_kosten_anteil_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gremienmandat" ADD CONSTRAINT "gremienmandat_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gremienmandat" ADD CONSTRAINT "gremienmandat_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fonds_kosten_fonds_valuta_idx" ON "fonds_kosten" USING btree ("fonds_id","valuta");--> statement-breakpoint
CREATE UNIQUE INDEX "fonds_kosten_storno_uq" ON "fonds_kosten" USING btree ("storniert_kosten_id");--> statement-breakpoint
CREATE INDEX "fonds_kosten_anteil_organisation_idx" ON "fonds_kosten_anteil" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "gremienmandat_beteiligung_idx" ON "gremienmandat" USING btree ("beteiligung_id");--> statement-breakpoint
CREATE INDEX "gremienmandat_person_idx" ON "gremienmandat" USING btree ("person_id");--> statement-breakpoint
-- Kostenbuchungen sind unveränderlich wie Abrufanteile und LP-Zahlungen; Korrektur nur per Storno. TRUNCATE bleibt erlaubt.
CREATE TRIGGER fonds_kosten_unveraenderlich BEFORE UPDATE OR DELETE ON fonds_kosten
  FOR EACH ROW EXECUTE FUNCTION lp_buchung_unveraenderlich();--> statement-breakpoint
CREATE TRIGGER fonds_kosten_anteil_unveraenderlich BEFORE UPDATE OR DELETE ON fonds_kosten_anteil
  FOR EACH ROW EXECUTE FUNCTION lp_buchung_unveraenderlich();--> statement-breakpoint
-- Ein Storno gleicht ein Original desselben Fonds und derselben Art aus, das selbst kein Storno ist, mit Valuta nicht davor.
CREATE FUNCTION fonds_kosten_storno_pruefen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM fonds_kosten k WHERE k.id = NEW.storniert_kosten_id AND k.storniert_kosten_id IS NULL
      AND k.fonds_id = NEW.fonds_id AND k.art = NEW.art AND k.betrag = -NEW.betrag AND k.valuta <= NEW.valuta
  ) THEN
    RAISE EXCEPTION 'Das Storno muss die ursprüngliche Kostenbuchung desselben Fonds ausgleichen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER fonds_kosten_storno_pruefen BEFORE INSERT ON fonds_kosten
  FOR EACH ROW WHEN (NEW.storniert_kosten_id IS NOT NULL) EXECUTE FUNCTION fonds_kosten_storno_pruefen();--> statement-breakpoint
-- Periodensperre wie bei Fondsbewegungen.
CREATE TRIGGER fonds_kosten_periodensperre BEFORE INSERT ON fonds_kosten
  FOR EACH ROW EXECUTE FUNCTION periodensperre_fonds_bewegung();--> statement-breakpoint
-- Die Anteile ergeben zum Ende der Transaktion genau den Betrag der Buchung; kein Anteil hat das Gegenvorzeichen der Buchung.
CREATE FUNCTION fonds_kosten_anteile_pruefen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  k fonds_kosten%ROWTYPE;
  summe numeric;
BEGIN
  SELECT * INTO k FROM fonds_kosten WHERE id = NEW.kosten_id;
  SELECT coalesce(sum(betrag), 0) INTO summe FROM fonds_kosten_anteil WHERE kosten_id = NEW.kosten_id;
  IF summe <> k.betrag THEN
    RAISE EXCEPTION 'Die Anteile der Kostenbuchung ergeben % statt %', summe, k.betrag USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM fonds_kosten_anteil a WHERE a.kosten_id = NEW.kosten_id AND sign(a.betrag) = -sign(k.betrag)) THEN
    RAISE EXCEPTION 'Ein Anteil der Kostenbuchung hat das falsche Vorzeichen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fonds_kosten_anteile_summe AFTER INSERT ON fonds_kosten_anteil
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fonds_kosten_anteile_pruefen();--> statement-breakpoint
-- Das Änderungsprotokoll ordnet Kostenbuchungen und Gremienmandate ihrem Fonds zu.
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
    WHEN 'fonds_kosten' THEN (SELECT x.fonds_id FROM fonds_kosten x WHERE x.id = datensatz)
    WHEN 'gremienmandat' THEN (SELECT b.fonds_id FROM gremienmandat x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'fonds_mitteilung' THEN (SELECT x.fonds_id FROM fonds_mitteilung x WHERE x.id = datensatz)
    ELSE NULL
  END
$$;
