CREATE TYPE "public"."investor_rolle" AS ENUM('investor_lesen');--> statement-breakpoint
CREATE TABLE "fonds_mitteilung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bewegung_id" uuid NOT NULL,
	"fonds_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"art" "fonds_bewegung_art" NOT NULL,
	"valuta" date NOT NULL,
	"betrag" numeric(18, 2) NOT NULL,
	"sprache" text NOT NULL,
	"datei_name" text NOT NULL,
	"datei_schluessel" text NOT NULL,
	"datei_sha256" text NOT NULL,
	"datei_groesse" integer NOT NULL,
	"freigegeben_von" text NOT NULL,
	"freigegeben_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fonds_mitteilung_sprache" CHECK ("fonds_mitteilung"."sprache" IN ('de', 'en'))
);
--> statement-breakpoint
CREATE TABLE "investor_benutzer" (
	"benutzer_id" uuid PRIMARY KEY NOT NULL,
	"erstellt_von" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investor_zugang" (
	"benutzer_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"rolle" "investor_rolle" DEFAULT 'investor_lesen' NOT NULL,
	"erstellt_von" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investor_zugang_benutzer_id_organisation_id_pk" PRIMARY KEY("benutzer_id","organisation_id")
);
--> statement-breakpoint
ALTER TABLE "fonds_mitteilung" ADD CONSTRAINT "fonds_mitteilung_bewegung_id_fonds_bewegung_id_fk" FOREIGN KEY ("bewegung_id") REFERENCES "public"."fonds_bewegung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonds_mitteilung" ADD CONSTRAINT "fonds_mitteilung_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonds_mitteilung" ADD CONSTRAINT "fonds_mitteilung_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_benutzer" ADD CONSTRAINT "investor_benutzer_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_zugang" ADD CONSTRAINT "investor_zugang_benutzer_id_investor_benutzer_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."investor_benutzer"("benutzer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_zugang" ADD CONSTRAINT "investor_zugang_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fonds_mitteilung_bewegung_organisation_uq" ON "fonds_mitteilung" USING btree ("bewegung_id","organisation_id");--> statement-breakpoint
CREATE INDEX "fonds_mitteilung_organisation_idx" ON "fonds_mitteilung" USING btree ("organisation_id","valuta");--> statement-breakpoint
CREATE INDEX "investor_zugang_organisation_idx" ON "investor_zugang" USING btree ("organisation_id");--> statement-breakpoint
-- Mitteilungen sind nach der Freigabe unveränderlich (wie freigegebene Berichtsdateien): kein Ändern, kein Löschen.
CREATE FUNCTION fonds_mitteilung_unveraenderlich() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Mitteilungen sind unveränderlich (% auf fonds_mitteilung)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER fonds_mitteilung_kein_update_delete BEFORE UPDATE OR DELETE ON "fonds_mitteilung"
  FOR EACH ROW EXECUTE FUNCTION fonds_mitteilung_unveraenderlich();--> statement-breakpoint
-- Investor-Benutzer und interne Benutzer schließen sich aus (SQLSTATE IV001): Der Kennzeichen-Eintrag verlangt einen Benutzer ohne Fondsrollen,
-- ohne Verwalterrecht und ohne technische Rolle; danach sperren Trigger an `fondsrolle` und `benutzer` den Weg zurück.
CREATE FUNCTION investor_benutzer_pruefen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "fondsrolle" WHERE benutzer_id = NEW.benutzer_id)
    OR EXISTS (SELECT 1 FROM "benutzer" WHERE id = NEW.benutzer_id AND (global_verwalter OR technisch)) THEN
    RAISE EXCEPTION 'Ein Investor-Benutzer darf keine Fondsrolle haben, nicht Verwalter und nicht technisch sein'
      USING ERRCODE = 'IV001';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER investor_benutzer_pruefen BEFORE INSERT ON "investor_benutzer"
  FOR EACH ROW EXECUTE FUNCTION investor_benutzer_pruefen();--> statement-breakpoint
CREATE FUNCTION investor_keine_fondsrolle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "investor_benutzer" WHERE benutzer_id = NEW.benutzer_id) THEN
    RAISE EXCEPTION 'Investor-Benutzer erhalten keine Fondsrollen' USING ERRCODE = 'IV001';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER investor_keine_fondsrolle BEFORE INSERT OR UPDATE ON "fondsrolle"
  FOR EACH ROW EXECUTE FUNCTION investor_keine_fondsrolle();--> statement-breakpoint
CREATE FUNCTION investor_kein_verwalter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.global_verwalter OR NEW.technisch) AND EXISTS (SELECT 1 FROM "investor_benutzer" WHERE benutzer_id = NEW.id) THEN
    RAISE EXCEPTION 'Ein Investor-Benutzer kann nicht Verwalter oder technisch sein' USING ERRCODE = 'IV001';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER investor_kein_verwalter BEFORE UPDATE OF global_verwalter, technisch ON "benutzer"
  FOR EACH ROW EXECUTE FUNCTION investor_kein_verwalter();--> statement-breakpoint
-- Änderungsabfrage: Mitteilungen gehören zu ihrem Fonds. Die Funktion ist die Fassung aus 0023 (alle Fälle der Basis, die Kennzahlen-Tabellen setzt 0027 über einen eigenen Trigger) plus `fonds_mitteilung`.
CREATE OR REPLACE FUNCTION aenderung_fonds_von(tabelle text, datensatz uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT CASE tabelle
    WHEN 'fonds' THEN datensatz
    WHEN 'periodensperre' THEN datensatz
    WHEN 'fonds_bewegung' THEN (SELECT x.fonds_id FROM fonds_bewegung x WHERE x.id = datensatz)
    WHEN 'fonds_zeichnung' THEN (SELECT x.fonds_id FROM fonds_zeichnung x WHERE x.id = datensatz)
    WHEN 'beteiligung' THEN (SELECT x.fonds_id FROM beteiligung x WHERE x.id = datensatz)
    WHEN 'vorgang' THEN (SELECT b.fonds_id FROM vorgang x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'meilenstein' THEN (SELECT b.fonds_id FROM meilenstein x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
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
