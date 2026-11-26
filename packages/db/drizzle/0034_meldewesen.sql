CREATE TYPE "public"."melde_datei_art" AS ENUM('meldung', 'pruefansicht');--> statement-breakpoint
CREATE TYPE "public"."melde_format" AS ENUM('xlsx', 'csv', 'pdf', 'xml');--> statement-breakpoint
CREATE TYPE "public"."melde_lauf_status" AS ENUM('entwurf', 'geprueft', 'freigegeben');--> statement-breakpoint
CREATE TYPE "public"."melde_mittelart" AS ENUM('foerdermittel', 'kofinanzierung', 'eigenmittel', 'rueckflussmittel');--> statement-breakpoint
CREATE TYPE "public"."melde_rhythmus" AS ENUM('quartal', 'halbjahr', 'jahr', 'stichtag');--> statement-breakpoint
CREATE TABLE "beteiligung_meldezuordnung" (
	"beteiligung_id" uuid PRIMARY KEY NOT NULL,
	"foerderprogramm_id" uuid,
	"mittelart" "melde_mittelart",
	"projektnummer" text,
	"vertragsnummer" text,
	"partnernummer" text,
	"buchungskreis" text,
	"geaendert_von" text NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foerderprogramm" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schluessel" text NOT NULL,
	"bezeichnung" text NOT NULL,
	"erstellt_von" text DEFAULT 'system' NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "foerderprogramm_schluessel" CHECK ("foerderprogramm"."schluessel" ~ '^[a-z][a-z0-9_]{1,59}$')
);
--> statement-breakpoint
CREATE TABLE "melde_aktivierung" (
	"fonds_id" uuid NOT NULL,
	"schluessel" text NOT NULL,
	"foerderprogramm_id" uuid,
	"aktiviert_von" text NOT NULL,
	"aktiviert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "melde_aktivierung_fonds_id_schluessel_pk" PRIMARY KEY("fonds_id","schluessel")
);
--> statement-breakpoint
CREATE TABLE "melde_datei" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lauf_id" uuid NOT NULL,
	"art" "melde_datei_art" NOT NULL,
	"format" "melde_format" NOT NULL,
	"name" text NOT NULL,
	"schluessel" text NOT NULL,
	"sha256" text NOT NULL,
	"groesse" integer NOT NULL,
	"erzeugt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "melde_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schluessel" text NOT NULL,
	"version" integer NOT NULL,
	"bezeichnung_de" text NOT NULL,
	"bezeichnung_en" text NOT NULL,
	"herausgeber" text NOT NULL,
	"rhythmus" "melde_rhythmus" NOT NULL,
	"format" "melde_format" NOT NULL,
	"gueltig_ab" date NOT NULL,
	"gueltig_bis" date,
	"definition" jsonb NOT NULL,
	"erstellt_von" text DEFAULT 'system' NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "melde_definition_schluessel" CHECK ("melde_definition"."schluessel" ~ '^[a-z][a-z0-9_]{1,59}$'),
	CONSTRAINT "melde_definition_gueltig" CHECK ("melde_definition"."gueltig_bis" IS NULL OR "melde_definition"."gueltig_bis" >= "melde_definition"."gueltig_ab")
);
--> statement-breakpoint
CREATE TABLE "melde_freigabe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lauf_id" uuid NOT NULL,
	"stufe_index" integer NOT NULL,
	"stufe" text NOT NULL,
	"ergebnis" text NOT NULL,
	"kommentar" text,
	"akteur" text NOT NULL,
	"am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "melde_freigabe_ergebnis" CHECK ("melde_freigabe"."ergebnis" IN ('ok', 'zurueck'))
);
--> statement-breakpoint
CREATE TABLE "melde_lauf" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"foerderprogramm_id" uuid,
	"definition_id" uuid NOT NULL,
	"definition_schluessel" text NOT NULL,
	"definition_version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"format" "melde_format" NOT NULL,
	"sprache" text NOT NULL,
	"periode_art" "melde_rhythmus" NOT NULL,
	"periode_kennung" text NOT NULL,
	"periode_beginn" date NOT NULL,
	"periode_ende" date NOT NULL,
	"fassung" integer DEFAULT 1 NOT NULL,
	"vorgaenger_id" uuid,
	"stand_vorgabe" timestamp with time zone,
	"stand" timestamp with time zone NOT NULL,
	"berechnet_am" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "melde_lauf_status" DEFAULT 'entwurf' NOT NULL,
	"freigabestufen" jsonb NOT NULL,
	"naechste_stufe" integer DEFAULT 0 NOT NULL,
	"befund_kommentare" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"erstellt_von" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"freigegeben_am" timestamp with time zone,
	CONSTRAINT "melde_lauf_sprache" CHECK ("melde_lauf"."sprache" IN ('de', 'en')),
	CONSTRAINT "melde_lauf_periode" CHECK ("melde_lauf"."periode_ende" >= "melde_lauf"."periode_beginn")
);
--> statement-breakpoint
CREATE TABLE "melde_wert" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lauf_id" uuid NOT NULL,
	"schluessel" text NOT NULL,
	"art" text NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	"wert" text,
	"herkunft" jsonb,
	"manuell" boolean DEFAULT false NOT NULL,
	"geaendert_von" text,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisation_meldedaten" (
	"organisation_id" uuid PRIMARY KEY NOT NULL,
	"sitzland" text,
	"region" text,
	"geaendert_von" text NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_meldedaten_sitzland" CHECK ("organisation_meldedaten"."sitzland" IS NULL OR "organisation_meldedaten"."sitzland" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
ALTER TABLE "beteiligung_meldezuordnung" ADD CONSTRAINT "beteiligung_meldezuordnung_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beteiligung_meldezuordnung" ADD CONSTRAINT "beteiligung_meldezuordnung_foerderprogramm_id_foerderprogramm_id_fk" FOREIGN KEY ("foerderprogramm_id") REFERENCES "public"."foerderprogramm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "melde_aktivierung" ADD CONSTRAINT "melde_aktivierung_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "melde_aktivierung" ADD CONSTRAINT "melde_aktivierung_foerderprogramm_id_foerderprogramm_id_fk" FOREIGN KEY ("foerderprogramm_id") REFERENCES "public"."foerderprogramm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "melde_datei" ADD CONSTRAINT "melde_datei_lauf_id_melde_lauf_id_fk" FOREIGN KEY ("lauf_id") REFERENCES "public"."melde_lauf"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "melde_freigabe" ADD CONSTRAINT "melde_freigabe_lauf_id_melde_lauf_id_fk" FOREIGN KEY ("lauf_id") REFERENCES "public"."melde_lauf"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "melde_lauf" ADD CONSTRAINT "melde_lauf_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "melde_lauf" ADD CONSTRAINT "melde_lauf_foerderprogramm_id_foerderprogramm_id_fk" FOREIGN KEY ("foerderprogramm_id") REFERENCES "public"."foerderprogramm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "melde_lauf" ADD CONSTRAINT "melde_lauf_definition_id_melde_definition_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."melde_definition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "melde_lauf" ADD CONSTRAINT "melde_lauf_vorgaenger_id_melde_lauf_id_fk" FOREIGN KEY ("vorgaenger_id") REFERENCES "public"."melde_lauf"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "melde_wert" ADD CONSTRAINT "melde_wert_lauf_id_melde_lauf_id_fk" FOREIGN KEY ("lauf_id") REFERENCES "public"."melde_lauf"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_meldedaten" ADD CONSTRAINT "organisation_meldedaten_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "foerderprogramm_schluessel_uq" ON "foerderprogramm" USING btree ("schluessel");--> statement-breakpoint
CREATE UNIQUE INDEX "melde_datei_lauf_art_uq" ON "melde_datei" USING btree ("lauf_id","art");--> statement-breakpoint
CREATE UNIQUE INDEX "melde_definition_version_uq" ON "melde_definition" USING btree ("schluessel","version");--> statement-breakpoint
CREATE INDEX "melde_freigabe_lauf_idx" ON "melde_freigabe" USING btree ("lauf_id","am");--> statement-breakpoint
CREATE UNIQUE INDEX "melde_lauf_fassung_uq" ON "melde_lauf" USING btree ("fonds_id","definition_schluessel","periode_kennung","fassung");--> statement-breakpoint
CREATE INDEX "melde_lauf_fonds_idx" ON "melde_lauf" USING btree ("fonds_id","periode_ende");--> statement-breakpoint
CREATE UNIQUE INDEX "melde_wert_lauf_schluessel_uq" ON "melde_wert" USING btree ("lauf_id","schluessel");
--> statement-breakpoint
-- Meldedefinitionen sind nach dem Anlegen unveränderlich; nur das Ende der Gültigkeit (`gueltig_bis`) darf gesetzt werden, wenn eine neue Version sie ablöst. Gelöscht wird nie.
CREATE FUNCTION melde_definition_schutz() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Meldedefinitionen werden nie gelöscht (DELETE auf melde_definition)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.schluessel, NEW.version, NEW.bezeichnung_de, NEW.bezeichnung_en, NEW.herausgeber, NEW.rhythmus, NEW.format, NEW.gueltig_ab, NEW.definition, NEW.erstellt_von, NEW.erstellt_am)
     IS DISTINCT FROM
     (OLD.id, OLD.schluessel, OLD.version, OLD.bezeichnung_de, OLD.bezeichnung_en, OLD.herausgeber, OLD.rhythmus, OLD.format, OLD.gueltig_ab, OLD.definition, OLD.erstellt_von, OLD.erstellt_am) THEN
    RAISE EXCEPTION 'Eine Meldedefinition wird nie geändert, nur ihre Gültigkeit begrenzt (UPDATE auf melde_definition)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER melde_definition_schutz BEFORE UPDATE OR DELETE ON "melde_definition"
  FOR EACH ROW EXECUTE FUNCTION melde_definition_schutz();--> statement-breakpoint
-- Ein freigegebener Meldelauf wird nie geändert oder gelöscht. Davor sind Fonds, Definition, Zeitraum, Format, Sprache und Wissensstand fest: Eine Neuberechnung ist ein neuer Lauf.
CREATE FUNCTION melde_lauf_schutz() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'freigegeben' THEN
    RAISE EXCEPTION 'Ein freigegebener Meldelauf wird nie geändert oder gelöscht (% auf melde_lauf)', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF (NEW.fonds_id, NEW.foerderprogramm_id, NEW.definition_id, NEW.definition_schluessel, NEW.definition_version, NEW.definition, NEW.format, NEW.sprache, NEW.periode_art, NEW.periode_kennung, NEW.periode_beginn, NEW.periode_ende, NEW.fassung, NEW.vorgaenger_id, NEW.stand_vorgabe, NEW.stand, NEW.freigabestufen, NEW.erstellt_von, NEW.erstellt_am)
     IS DISTINCT FROM
     (OLD.fonds_id, OLD.foerderprogramm_id, OLD.definition_id, OLD.definition_schluessel, OLD.definition_version, OLD.definition, OLD.format, OLD.sprache, OLD.periode_art, OLD.periode_kennung, OLD.periode_beginn, OLD.periode_ende, OLD.fassung, OLD.vorgaenger_id, OLD.stand_vorgabe, OLD.stand, OLD.freigabestufen, OLD.erstellt_von, OLD.erstellt_am) THEN
    RAISE EXCEPTION 'Fonds, Definition, Zeitraum, Wissensstand und Stufen eines Meldelaufs sind fest (UPDATE auf melde_lauf)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER melde_lauf_schutz BEFORE UPDATE OR DELETE ON "melde_lauf"
  FOR EACH ROW EXECUTE FUNCTION melde_lauf_schutz();--> statement-breakpoint
-- Die Werte eines freigegebenen Meldelaufs bleiben, wie sie freigegeben wurden. FOR SHARE: Eingabe und Freigabe (UPDATE des Laufs) können sich nicht überlappen.
CREATE FUNCTION melde_wert_schutz() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  alt_status "melde_lauf_status";
  neu_status "melde_lauf_status";
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.lauf_id <> OLD.lauf_id THEN
    RAISE EXCEPTION 'Ein Wert lässt sich nicht einem anderen Meldelauf zuordnen'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO alt_status FROM "melde_lauf" WHERE id = OLD.lauf_id FOR SHARE;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO neu_status FROM "melde_lauf" WHERE id = NEW.lauf_id FOR SHARE;
  END IF;
  IF alt_status = 'freigegeben' OR neu_status = 'freigegeben' THEN
    RAISE EXCEPTION 'Die Werte eines freigegebenen Meldelaufs werden nicht geändert (% auf melde_wert)', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER melde_wert_schutz BEFORE INSERT OR UPDATE OR DELETE ON "melde_wert"
  FOR EACH ROW EXECUTE FUNCTION melde_wert_schutz();--> statement-breakpoint
-- Freigabeprotokoll und Dateien: nur anhängend und unveränderlich.
CREATE FUNCTION melde_nur_anhaengen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% ist nur anhängend und unveränderlich (% auf %)', TG_TABLE_NAME, TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER melde_freigabe_kein_update_delete BEFORE UPDATE OR DELETE ON "melde_freigabe"
  FOR EACH ROW EXECUTE FUNCTION melde_nur_anhaengen();--> statement-breakpoint
CREATE TRIGGER melde_datei_kein_update_delete BEFORE UPDATE OR DELETE ON "melde_datei"
  FOR EACH ROW EXECUTE FUNCTION melde_nur_anhaengen();--> statement-breakpoint
-- Mitgelieferte Meldedefinitionen (Version 1, gültig ab 2026-01-01), alle als Vorlage, fachlich zu prüfen. Ein Test hält diese Zeilen und die Konstanten in packages/berichte gleich.
INSERT INTO "melde_definition" ("schluessel", "version", "bezeichnung_de", "bezeichnung_en", "herausgeber", "rhythmus", "format", "gueltig_ab", "definition") VALUES
  ('foerderbericht_quartal', 1, 'Förderbericht je Quartal (Vorlage)', 'Funding report per quarter (template)', 'Fundament (Vorlage)', 'quartal', 'xlsx', '2026-01-01', $def${"schema":1,"hinweis":{"de":"Vorlage, fachlich zu prüfen. Die Definition zeigt den Aufbau der Meldung und ersetzt keine Formularvorgabe des Empfängers.","en":"Template, subject to professional review. The definition shows the structure of the report and does not replace a form specification of the recipient."},"abschnitte":[{"id":"stammdaten","typ":"felder","titel":{"de":"Stammdaten","en":"Master data"},"felder":[{"id":"fonds_name","bezeichnung":{"de":"Fonds","en":"Fund"},"format":"text","quelle":{"art":"stammdaten","feld":"fonds.name"}},{"id":"fonds_waehrung","bezeichnung":{"de":"Währung","en":"Currency"},"format":"text","quelle":{"art":"stammdaten","feld":"fonds.waehrung"}},{"id":"programm","bezeichnung":{"de":"Förderprogramm","en":"Funding programme"},"format":"text","quelle":{"art":"stammdaten","feld":"programm.bezeichnung"}},{"id":"zeitraum_beginn","bezeichnung":{"de":"Beginn des Berichtszeitraums","en":"Start of the reporting period"},"format":"datum","quelle":{"art":"stammdaten","feld":"periode.beginn"}},{"id":"zeitraum_ende","bezeichnung":{"de":"Ende des Berichtszeitraums","en":"End of the reporting period"},"format":"datum","quelle":{"art":"stammdaten","feld":"periode.ende"}},{"id":"verantwortlich","bezeichnung":{"de":"Verantwortliche Person für die Meldung","en":"Person responsible for the report"},"format":"text","quelle":{"art":"manuell"},"pflicht":true}]},{"id":"mittelabruf","typ":"felder","titel":{"de":"Mittelabruf","en":"Drawdown of funds"},"felder":[{"id":"abrufe_periode","bezeichnung":{"de":"Kapitalabrufe im Berichtszeitraum","en":"Capital calls in the reporting period"},"einheit":"EUR","format":"betrag","quelle":{"art":"fondsbewegung","bewegung":"abruf","zeitraum":"periode"}},{"id":"abrufe_kumuliert","bezeichnung":{"de":"Kapitalabrufe kumuliert","en":"Capital calls to date"},"einheit":"EUR","format":"betrag","quelle":{"art":"fondsbewegung","bewegung":"abruf","zeitraum":"kumuliert"}},{"id":"zeichnungskapital","bezeichnung":{"de":"Zeichnungskapital des Fonds","en":"Subscribed capital of the fund"},"einheit":"EUR","format":"betrag","quelle":{"art":"stammdaten","feld":"fonds.zeichnungskapital"}},{"id":"noch_nicht_abgerufen","bezeichnung":{"de":"Noch nicht abgerufen","en":"Not yet called"},"einheit":"EUR","format":"betrag","quelle":{"art":"berechnet","operation":"differenz","felder":["zeichnungskapital","abrufe_kumuliert"]}}]},{"id":"mittelverwendung","typ":"felder","titel":{"de":"Mittelverwendung","en":"Use of funds"},"felder":[{"id":"zusagen_periode","bezeichnung":{"de":"Zusagen an Unternehmen im Berichtszeitraum","en":"Commitments to companies in the reporting period"},"einheit":"EUR","format":"betrag","quelle":{"art":"vorgang","vorgangsarten":["zusage"],"zeitraum":"periode","aggregation":"summe","negieren":false}},{"id":"auszahlungen_periode","bezeichnung":{"de":"Auszahlungen an Unternehmen im Berichtszeitraum","en":"Disbursements to companies in the reporting period"},"einheit":"EUR","format":"betrag","quelle":{"art":"vorgang","vorgangsarten":["auszahlung"],"zeitraum":"periode","aggregation":"summe","negieren":false}},{"id":"zusagen_kumuliert","bezeichnung":{"de":"Zusagen kumuliert","en":"Commitments to date"},"einheit":"EUR","format":"betrag","quelle":{"art":"vorgang","vorgangsarten":["zusage"],"zeitraum":"kumuliert","aggregation":"summe","negieren":false}},{"id":"auszahlungen_kumuliert","bezeichnung":{"de":"Auszahlungen kumuliert","en":"Disbursements to date"},"einheit":"EUR","format":"betrag","quelle":{"art":"vorgang","vorgangsarten":["auszahlung"],"zeitraum":"kumuliert","aggregation":"summe","negieren":false}},{"id":"offene_zusage","bezeichnung":{"de":"Offene Zusagen","en":"Open commitments"},"einheit":"EUR","format":"betrag","quelle":{"art":"bestand","groesse":"offene_zusage"}},{"id":"anzahl_beteiligungen","bezeichnung":{"de":"Beteiligungen im Bestand","en":"Holdings in the portfolio"},"format":"ganzzahl","quelle":{"art":"beteiligungsanzahl","umfang":"bestand"}},{"id":"neue_beteiligungen","bezeichnung":{"de":"Neue Beteiligungen im Berichtszeitraum","en":"New holdings in the reporting period"},"format":"ganzzahl","quelle":{"art":"beteiligungsanzahl","umfang":"neu"}}]},{"id":"rueckfluesse","typ":"felder","titel":{"de":"Rückflüsse","en":"Returns"},"felder":[{"id":"rueckfluesse_periode","bezeichnung":{"de":"Rückflüsse und Tilgungen im Berichtszeitraum","en":"Proceeds and repayments in the reporting period"},"einheit":"EUR","format":"betrag","quelle":{"art":"vorgang","vorgangsarten":["rueckfluss","tilgung"],"zeitraum":"periode","aggregation":"summe","negieren":false}},{"id":"zinsen_periode","bezeichnung":{"de":"Gebuchte Zinsen im Berichtszeitraum","en":"Interest booked in the reporting period"},"einheit":"EUR","format":"betrag","quelle":{"art":"vorgang","vorgangsarten":["zins"],"zeitraum":"periode","aggregation":"summe","negieren":false}},{"id":"rueckfluesse_kumuliert","bezeichnung":{"de":"Rückflüsse und Tilgungen kumuliert","en":"Proceeds and repayments to date"},"einheit":"EUR","format":"betrag","quelle":{"art":"vorgang","vorgangsarten":["rueckfluss","tilgung"],"zeitraum":"kumuliert","aggregation":"summe","negieren":false}},{"id":"ausschuettungen_periode","bezeichnung":{"de":"Ausschüttungen des Fonds im Berichtszeitraum","en":"Distributions of the fund in the reporting period"},"einheit":"EUR","format":"betrag","quelle":{"art":"fondsbewegung","bewegung":"ausschuettung","zeitraum":"periode"}},{"id":"ausschuettungen_kumuliert","bezeichnung":{"de":"Ausschüttungen des Fonds kumuliert","en":"Distributions of the fund to date"},"einheit":"EUR","format":"betrag","quelle":{"art":"fondsbewegung","bewegung":"ausschuettung","zeitraum":"kumuliert"}}]},{"id":"portfolio_programm","typ":"tabelle","titel":{"de":"Portfolio je Förderprogramm","en":"Portfolio by funding programme"},"je":"programm","spalten":[{"id":"programm","bezeichnung":{"de":"Förderprogramm","en":"Funding programme"},"format":"text","quelle":{"art":"stammdaten","feld":"gruppe.bezeichnung"}},{"id":"anzahl","bezeichnung":{"de":"Beteiligungen","en":"Holdings"},"format":"ganzzahl","quelle":{"art":"beteiligungsanzahl","umfang":"bestand"},"summe":true},{"id":"zusagen","bezeichnung":{"de":"Zusagen","en":"Commitments"},"einheit":"EUR","format":"betrag","quelle":{"art":"bestand","groesse":"zusage"},"summe":true},{"id":"investiert","bezeichnung":{"de":"Investiert","en":"Invested"},"einheit":"EUR","format":"betrag","quelle":{"art":"bestand","groesse":"investiert"},"summe":true},{"id":"rueckfluesse","bezeichnung":{"de":"Rückflüsse","en":"Proceeds"},"einheit":"EUR","format":"betrag","quelle":{"art":"bestand","groesse":"rueckfluesse"},"summe":true},{"id":"buchwert","bezeichnung":{"de":"Buchwert","en":"Carrying amount"},"einheit":"EUR","format":"betrag","quelle":{"art":"bestand","groesse":"buchwert"},"summe":true}]},{"id":"erlaeuterung","typ":"felder","titel":{"de":"Erläuterung","en":"Commentary"},"felder":[{"id":"erlaeuterung_text","bezeichnung":{"de":"Erläuterung zum Berichtszeitraum","en":"Commentary on the reporting period"},"format":"text","quelle":{"art":"manuell"}}]}],"regeln":[{"id":"tabelle_gleich_feld","schwere":"fehler","meldung":{"de":"Die Summe der Tabelle „Portfolio je Förderprogramm“ weicht von den kumulierten Auszahlungen ab.","en":"The total of the table “Portfolio by funding programme” differs from the disbursements to date."},"art":"vergleich","links":"portfolio_programm.investiert","operator":"=","rechts":"auszahlungen_kumuliert","toleranz":"0.01"},{"id":"auszahlungen_ueber_abrufen","schwere":"warnung","meldung":{"de":"Die kumulierten Auszahlungen liegen über den kumulierten Kapitalabrufen.","en":"Disbursements to date exceed capital calls to date."},"art":"vergleich","links":"auszahlungen_kumuliert","operator":"<=","rechts":"abrufe_kumuliert"},{"id":"abruf_ueber_zeichnung","schwere":"warnung","meldung":{"de":"Die Kapitalabrufe übersteigen das Zeichnungskapital.","en":"Capital calls exceed the subscribed capital."},"art":"bereich","feld":"noch_nicht_abgerufen","minimum":"0"},{"id":"erlaeuterung_fehlt","schwere":"warnung","meldung":{"de":"Es ist keine Erläuterung zum Berichtszeitraum erfasst.","en":"No commentary on the reporting period has been entered."},"art":"pflicht","felder":["erlaeuterung_text"]}]}$def$::jsonb),
  ('efre_indikatoren', 1, 'EFRE-Indikatorbericht (Vorlage)', 'ERDF indicator report (template)', 'Fundament (Vorlage)', 'jahr', 'xlsx', '2026-01-01', $def${"schema":1,"hinweis":{"de":"Vorlage, fachlich zu prüfen. Aufbau angelehnt an die Berichtspflichten der Verordnung (EU) 2021/1060 (Finanzinstrumente Artikel 58 bis 60 und 68, Daten je Vorhaben Anhang XVII). Indikatorcodes (RCO, RCR) sind nicht hinterlegt; die Länder und Programme nutzen eigene Systeme und Vorgaben.","en":"Template, subject to professional review. Structure based on the reporting obligations of Regulation (EU) 2021/1060 (financial instruments Articles 58 to 60 and 68, data per operation Annex XVII). Indicator codes (RCO, RCR) are not stored; member states and programmes use their own systems and specifications."},"abschnitte":[{"id":"stammdaten","typ":"felder","titel":{"de":"Stammdaten","en":"Master data"},"felder":[{"id":"fonds_name","bezeichnung":{"de":"Finanzinstrument (Fonds)","en":"Financial instrument (fund)"},"format":"text","quelle":{"art":"stammdaten","feld":"fonds.name"}},{"id":"programm","bezeichnung":{"de":"Programm","en":"Programme"},"format":"text","quelle":{"art":"stammdaten","feld":"programm.bezeichnung"}},{"id":"zeitraum_beginn","bezeichnung":{"de":"Beginn des Berichtszeitraums","en":"Start of the reporting period"},"format":"datum","quelle":{"art":"stammdaten","feld":"periode.beginn"}},{"id":"zeitraum_ende","bezeichnung":{"de":"Ende des Berichtszeitraums","en":"End of the reporting period"},"format":"datum","quelle":{"art":"stammdaten","feld":"periode.ende"}}]},{"id":"finanzinstrument","typ":"felder","titel":{"de":"Finanzinstrument","en":"Financial instrument"},"felder":[{"id":"an_endempfaenger_kumuliert","bezeichnung":{"de":"An Endempfänger ausgezahlte Mittel kumuliert","en":"Funds paid out to final recipients to date"},"einheit":"EUR","format":"betrag","quelle":{"art":"vorgang","vorgangsarten":["auszahlung"],"zeitraum":"kumuliert","aggregation":"summe","negieren":false}},{"id":"zusagen_kumuliert","bezeichnung":{"de":"Zusagen an Endempfänger kumuliert","en":"Commitments to final recipients to date"},"einheit":"EUR","format":"betrag","quelle":{"art":"vorgang","vorgangsarten":["zusage"],"zeitraum":"kumuliert","aggregation":"summe","negieren":false}},{"id":"rueckfluesse_kumuliert","bezeichnung":{"de":"Rückflüsse und Tilgungen kumuliert","en":"Returns and repayments to date"},"einheit":"EUR","format":"betrag","quelle":{"art":"vorgang","vorgangsarten":["rueckfluss","tilgung"],"zeitraum":"kumuliert","aggregation":"summe","negieren":false}},{"id":"zinsen_periode","bezeichnung":{"de":"Gebuchte Zinsen im Berichtszeitraum","en":"Interest booked in the reporting period"},"einheit":"EUR","format":"betrag","quelle":{"art":"vorgang","vorgangsarten":["zins"],"zeitraum":"periode","aggregation":"summe","negieren":false}},{"id":"foerdermittel_periode","bezeichnung":{"de":"Auszahlungen aus Fördermitteln im Berichtszeitraum","en":"Disbursements from grant funds in the reporting period"},"einheit":"EUR","format":"betrag","quelle":{"art":"vorgang","vorgangsarten":["auszahlung"],"zeitraum":"periode","aggregation":"summe","negieren":false},"filter":{"mittelart":["foerdermittel"]}},{"id":"kofinanzierung_periode","bezeichnung":{"de":"Auszahlungen aus Kofinanzierungsmitteln im Berichtszeitraum","en":"Disbursements from co-financing in the reporting period"},"einheit":"EUR","format":"betrag","quelle":{"art":"vorgang","vorgangsarten":["auszahlung"],"zeitraum":"periode","aggregation":"summe","negieren":false},"filter":{"mittelart":["kofinanzierung"]}}]},{"id":"indikatoren","typ":"felder","titel":{"de":"Indikatoren (Platzhalter)","en":"Indicators (placeholders)"},"felder":[{"id":"ind_output_unternehmen","bezeichnung":{"de":"Unterstützte Unternehmen (Outputindikator)","en":"Enterprises supported (output indicator)"},"format":"ganzzahl","quelle":{"art":"beteiligungsanzahl","umfang":"bestand"},"hinweis":{"de":"Platzhalter: Der Indikatorcode (RCO oder RCR) ist nicht hinterlegt und vom Programm festzulegen.","en":"Placeholder: the indicator code (RCO or RCR) is not stored and is to be set by the programme."}},{"id":"ind_output_darlehen","bezeichnung":{"de":"davon mit Darlehen unterstützt","en":"of which supported by loans"},"format":"ganzzahl","quelle":{"art":"beteiligungsanzahl","umfang":"bestand"},"filter":{"instrument":["darlehen","wandeldarlehen"]},"hinweis":{"de":"Platzhalter: Der Indikatorcode (RCO oder RCR) ist nicht hinterlegt und vom Programm festzulegen.","en":"Placeholder: the indicator code (RCO or RCR) is not stored and is to be set by the programme."}},{"id":"ind_output_eigenkapital","bezeichnung":{"de":"davon mit Beteiligungskapital unterstützt","en":"of which supported by equity"},"format":"ganzzahl","quelle":{"art":"beteiligungsanzahl","umfang":"bestand"},"filter":{"instrument":["offene_beteiligung","stille_beteiligung"]},"hinweis":{"de":"Platzhalter: Der Indikatorcode (RCO oder RCR) ist nicht hinterlegt und vom Programm festzulegen.","en":"Placeholder: the indicator code (RCO or RCR) is not stored and is to be set by the programme."}},{"id":"ind_output_neu","bezeichnung":{"de":"Im Berichtszeitraum neu unterstützte Unternehmen","en":"Enterprises newly supported in the reporting period"},"format":"ganzzahl","quelle":{"art":"beteiligungsanzahl","umfang":"neu"},"hinweis":{"de":"Platzhalter: Der Indikatorcode (RCO oder RCR) ist nicht hinterlegt und vom Programm festzulegen.","en":"Placeholder: the indicator code (RCO or RCR) is not stored and is to be set by the programme."}},{"id":"ind_ergebnis_beschaeftigte","bezeichnung":{"de":"Beschäftigte der unterstützten Unternehmen (Vollzeitäquivalente, Ergebnisindikator)","en":"Employees of the supported enterprises (full-time equivalents, result indicator)"},"format":"zahl","quelle":{"art":"kennzahl","schluessel":"mitarbeitende_vzae","szenario":"ist","zeitraum":"letzter","aggregation":"summe"},"hinweis":{"de":"Platzhalter: Der Indikatorcode (RCO oder RCR) ist nicht hinterlegt und vom Programm festzulegen.","en":"Placeholder: the indicator code (RCO or RCR) is not stored and is to be set by the programme."}},{"id":"ind_ergebnis_umsatz","bezeichnung":{"de":"Umsatz der unterstützten Unternehmen im Berichtszeitraum","en":"Revenue of the supported enterprises in the reporting period"},"einheit":"EUR","format":"betrag","quelle":{"art":"kennzahl","schluessel":"umsatz","szenario":"ist","zeitraum":"periode","aggregation":"summe"},"hinweis":{"de":"Platzhalter: Der Indikatorcode (RCO oder RCR) ist nicht hinterlegt und vom Programm festzulegen.","en":"Placeholder: the indicator code (RCO or RCR) is not stored and is to be set by the programme."}},{"id":"ind_investition_privat","bezeichnung":{"de":"Private Investitionen als Ergänzung der öffentlichen Unterstützung","en":"Private investments matching public support"},"einheit":"EUR","format":"betrag","quelle":{"art":"manuell"},"hinweis":{"de":"Platzhalter: Der Indikatorcode (RCO oder RCR) ist nicht hinterlegt und vom Programm festzulegen.","en":"Placeholder: the indicator code (RCO or RCR) is not stored and is to be set by the programme."}}]},{"id":"vorhaben","typ":"tabelle","titel":{"de":"Daten je Vorhaben (Auswahl, Anhang XVII)","en":"Data per operation (selection, Annex XVII)"},"je":"beteiligung","spalten":[{"id":"projektnummer","bezeichnung":{"de":"Projektnummer","en":"Project number"},"format":"text","quelle":{"art":"schluessel","feld":"projektnummer"}},{"id":"vertragsnummer","bezeichnung":{"de":"Vertragsnummer","en":"Contract number"},"format":"text","quelle":{"art":"schluessel","feld":"vertragsnummer"}},{"id":"partnernummer","bezeichnung":{"de":"Partnernummer","en":"Partner number"},"format":"text","quelle":{"art":"schluessel","feld":"partnernummer"}},{"id":"unternehmen","bezeichnung":{"de":"Endempfänger","en":"Final recipient"},"format":"text","quelle":{"art":"stammdaten","feld":"organisation.name"}},{"id":"sitzland","bezeichnung":{"de":"Sitzland","en":"Country of seat"},"format":"text","quelle":{"art":"stammdaten","feld":"organisation.sitzland"}},{"id":"region","bezeichnung":{"de":"Region","en":"Region"},"format":"text","quelle":{"art":"stammdaten","feld":"organisation.region"}},{"id":"instrument","bezeichnung":{"de":"Instrument","en":"Instrument"},"format":"text","quelle":{"art":"stammdaten","feld":"beteiligung.instrument"}},{"id":"mittelart","bezeichnung":{"de":"Mittelart","en":"Type of funds"},"format":"text","quelle":{"art":"stammdaten","feld":"foerderung.mittelart"}},{"id":"erstinvestment","bezeichnung":{"de":"Erstinvestment","en":"First investment"},"format":"datum","quelle":{"art":"stammdaten","feld":"beteiligung.erstinvestment"}},{"id":"zusage","bezeichnung":{"de":"Zusage","en":"Commitment"},"einheit":"EUR","format":"betrag","quelle":{"art":"bestand","groesse":"zusage"},"summe":true},{"id":"investiert","bezeichnung":{"de":"Ausgezahlt","en":"Paid out"},"einheit":"EUR","format":"betrag","quelle":{"art":"bestand","groesse":"investiert"},"summe":true},{"id":"rueckfluesse","bezeichnung":{"de":"Rückflüsse","en":"Returns"},"einheit":"EUR","format":"betrag","quelle":{"art":"bestand","groesse":"rueckfluesse"},"summe":true}],"sortierung":{"spalte":"unternehmen","richtung":"auf"}}],"regeln":[{"id":"vorhaben_gleich_finanzinstrument","schwere":"fehler","meldung":{"de":"Die Summe der Vorhaben weicht von den kumulierten Auszahlungen an Endempfänger ab.","en":"The total of the operations differs from the funds paid out to final recipients to date."},"art":"vergleich","links":"vorhaben.investiert","operator":"=","rechts":"an_endempfaenger_kumuliert","toleranz":"0.01"},{"id":"privat_fehlt","schwere":"warnung","meldung":{"de":"Die privaten Investitionen sind nicht erfasst.","en":"Private investments have not been entered."},"art":"pflicht","felder":["ind_investition_privat"]}]}$def$::jsonb),
  ('bundesbank_beteiligungsbestand', 1, 'Beteiligungsbestand für die Bundesbank-Statistik (Strukturvorbereitung)', 'Holdings for the Bundesbank statistics (structural preparation)', 'Fundament (Vorlage)', 'stichtag', 'xlsx', '2026-01-01', $def${"schema":1,"hinweis":{"de":"Strukturelle Vorbereitung entlang der Bundesbank-Statistik über Investmentvermögen (Formulare 10390 bis 10392), keine Zusicherung der Meldefähigkeit und kein amtliches Meldeformat. Die Zuordnung der Beteiligungen zu den Positionen 61 bis 63 ist nicht hinterlegt und mit dem Empfänger zu klären; Vorlage, fachlich zu prüfen.","en":"Structural preparation along the Bundesbank statistics on investment funds (forms 10390 to 10392); no assurance of filing capability and not an official reporting format. The assignment of holdings to positions 61 to 63 is not stored and is to be agreed with the recipient; template, subject to professional review."},"abschnitte":[{"id":"stammdaten","typ":"felder","titel":{"de":"Stammdaten je Investmentvermögen (Struktur zu Formular 10390)","en":"Master data per investment fund (structure for form 10390)"},"felder":[{"id":"fonds_name","bezeichnung":{"de":"Bezeichnung des Investmentvermögens","en":"Name of the investment fund"},"format":"text","quelle":{"art":"stammdaten","feld":"fonds.name"}},{"id":"fonds_kurzname","bezeichnung":{"de":"Kurzbezeichnung","en":"Short name"},"format":"text","quelle":{"art":"stammdaten","feld":"fonds.kurzname"}},{"id":"waehrung","bezeichnung":{"de":"Währung","en":"Currency"},"format":"text","quelle":{"art":"stammdaten","feld":"fonds.waehrung"}},{"id":"auflagejahr","bezeichnung":{"de":"Auflagejahr","en":"Year of launch"},"format":"ganzzahl","quelle":{"art":"stammdaten","feld":"fonds.vintage"}},{"id":"stichtag","bezeichnung":{"de":"Stichtag","en":"Reporting date"},"format":"datum","quelle":{"art":"stammdaten","feld":"periode.ende"}},{"id":"kennung","bezeichnung":{"de":"Kennung beim Empfänger","en":"Identifier at the recipient"},"format":"text","quelle":{"art":"manuell"},"pflicht":true}]},{"id":"positionen","typ":"tabelle","titel":{"de":"Bestand je Instrument (Zuordnung zu den Positionen offen)","en":"Holdings by instrument (assignment to positions open)"},"je":"instrument","spalten":[{"id":"instrument","bezeichnung":{"de":"Instrument","en":"Instrument"},"format":"text","quelle":{"art":"stammdaten","feld":"gruppe.bezeichnung"}},{"id":"anzahl","bezeichnung":{"de":"Beteiligungen","en":"Holdings"},"format":"ganzzahl","quelle":{"art":"beteiligungsanzahl","umfang":"bestand"},"summe":true},{"id":"buchwert","bezeichnung":{"de":"Buchwert","en":"Carrying amount"},"einheit":"EUR","format":"betrag","quelle":{"art":"bestand","groesse":"buchwert"},"summe":true},{"id":"wertansatz","bezeichnung":{"de":"Wertansatz","en":"Valuation"},"einheit":"EUR","format":"betrag","quelle":{"art":"bestand","groesse":"bewertung"},"summe":true}]},{"id":"bestand","typ":"tabelle","titel":{"de":"Beteiligungsbestand","en":"Holdings"},"je":"beteiligung","spalten":[{"id":"unternehmen","bezeichnung":{"de":"Unternehmen","en":"Company"},"format":"text","quelle":{"art":"stammdaten","feld":"organisation.name"}},{"id":"sitzland","bezeichnung":{"de":"Sitzland","en":"Country of seat"},"format":"text","quelle":{"art":"stammdaten","feld":"organisation.sitzland"}},{"id":"branche","bezeichnung":{"de":"Branche","en":"Sector"},"format":"text","quelle":{"art":"stammdaten","feld":"organisation.sektor"}},{"id":"instrument","bezeichnung":{"de":"Instrument","en":"Instrument"},"format":"text","quelle":{"art":"stammdaten","feld":"beteiligung.instrument"}},{"id":"erstinvestment","bezeichnung":{"de":"Erstinvestment","en":"First investment"},"format":"datum","quelle":{"art":"stammdaten","feld":"beteiligung.erstinvestment"}},{"id":"buchwert","bezeichnung":{"de":"Buchwert","en":"Carrying amount"},"einheit":"EUR","format":"betrag","quelle":{"art":"bestand","groesse":"buchwert"},"summe":true},{"id":"wertansatz","bezeichnung":{"de":"Wertansatz","en":"Valuation"},"einheit":"EUR","format":"betrag","quelle":{"art":"bestand","groesse":"bewertung"},"summe":true}],"sortierung":{"spalte":"unternehmen","richtung":"auf"}}],"regeln":[{"id":"bestand_gleich_positionen","schwere":"fehler","meldung":{"de":"Die Summe des Beteiligungsbestands weicht von der Summe je Instrument ab.","en":"The total of the holdings differs from the total by instrument."},"art":"vergleich","links":"bestand.buchwert","operator":"=","rechts":"positionen.buchwert","toleranz":"0.01"}]}$def$::jsonb);
