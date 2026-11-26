CREATE TYPE "public"."kennzahl_abfrage_status" AS ENUM('offen', 'eingereicht', 'bestaetigt', 'widerrufen');--> statement-breakpoint
CREATE TYPE "public"."kennzahl_aggregation" AS ENUM('summe', 'stand', 'durchschnitt');--> statement-breakpoint
CREATE TYPE "public"."kennzahl_kategorie" AS ENUM('finanzen', 'betrieb', 'esg_umwelt', 'esg_sozial', 'esg_governance');--> statement-breakpoint
CREATE TYPE "public"."kennzahl_periodizitaet" AS ENUM('monat', 'quartal', 'jahr');--> statement-breakpoint
CREATE TYPE "public"."kennzahl_quelle" AS ENUM('intern', 'unternehmen', 'import');--> statement-breakpoint
CREATE TYPE "public"."kennzahl_szenario" AS ENUM('ist', 'plan', 'forecast');--> statement-breakpoint
CREATE TYPE "public"."kennzahl_typ" AS ENUM('betrag', 'zahl', 'prozent', 'ja_nein', 'text');--> statement-breakpoint
CREATE TYPE "public"."kennzahl_wert_status" AS ENUM('entwurf', 'eingereicht', 'bestaetigt');--> statement-breakpoint
CREATE TABLE "abfrage_zugriff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schluessel" text NOT NULL,
	"am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fonds_kennzahl" (
	"fonds_id" uuid NOT NULL,
	"schluessel" text NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "fonds_kennzahl_fonds_id_schluessel_pk" PRIMARY KEY("fonds_id","schluessel")
);
--> statement-breakpoint
CREATE TABLE "kennzahl_abfrage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beteiligung_id" uuid NOT NULL,
	"periode_beginn" date NOT NULL,
	"periode_ende" date NOT NULL,
	"faellig_am" date NOT NULL,
	"status" "kennzahl_abfrage_status" DEFAULT 'offen' NOT NULL,
	"sprache" text DEFAULT 'de' NOT NULL,
	"hinweis" text,
	"token_hash" text NOT NULL,
	"token_ablauf" timestamp with time zone NOT NULL,
	"token_erzeugt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"erstellt_von" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"eingereicht_am" timestamp with time zone,
	"bestaetigt_am" timestamp with time zone,
	"widerrufen_am" timestamp with time zone,
	"widerrufen_von" text,
	CONSTRAINT "kennzahl_abfrage_periode" CHECK ("kennzahl_abfrage"."periode_ende" >= "kennzahl_abfrage"."periode_beginn"),
	CONSTRAINT "kennzahl_abfrage_sprache" CHECK ("kennzahl_abfrage"."sprache" IN ('de', 'en'))
);
--> statement-breakpoint
CREATE TABLE "kennzahl_abfrage_position" (
	"abfrage_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	CONSTRAINT "kennzahl_abfrage_position_abfrage_id_definition_id_pk" PRIMARY KEY("abfrage_id","definition_id")
);
--> statement-breakpoint
CREATE TABLE "kennzahl_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schluessel" text NOT NULL,
	"katalog_version" integer DEFAULT 1 NOT NULL,
	"bezeichnung_de" text NOT NULL,
	"bezeichnung_en" text NOT NULL,
	"einheit" text NOT NULL,
	"typ" "kennzahl_typ" NOT NULL,
	"kategorie" "kennzahl_kategorie" NOT NULL,
	"periodizitaet" "kennzahl_periodizitaet" NOT NULL,
	"aggregation" "kennzahl_aggregation" NOT NULL,
	"pflicht" boolean DEFAULT false NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	"gueltig_ab" date NOT NULL,
	"gueltig_bis" date,
	"erstellt_von" text DEFAULT 'system' NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kennzahl_definition_schluessel" CHECK ("kennzahl_definition"."schluessel" ~ '^[a-z][a-z0-9_]{1,59}$'),
	CONSTRAINT "kennzahl_definition_gueltig" CHECK ("kennzahl_definition"."gueltig_bis" IS NULL OR "kennzahl_definition"."gueltig_bis" >= "kennzahl_definition"."gueltig_ab")
);
--> statement-breakpoint
CREATE TABLE "kennzahl_wert" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folge" bigint GENERATED ALWAYS AS IDENTITY (sequence name "kennzahl_wert_folge_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"beteiligung_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"periode_beginn" date NOT NULL,
	"periode_ende" date NOT NULL,
	"szenario" "kennzahl_szenario" NOT NULL,
	"wert" text NOT NULL,
	"quelle" "kennzahl_quelle" NOT NULL,
	"erfasst_von" text NOT NULL,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "kennzahl_wert_status" DEFAULT 'entwurf' NOT NULL,
	"kommentar" text,
	"abfrage_id" uuid,
	"bestaetigt_von" text,
	"bestaetigt_am" timestamp with time zone,
	"verworfen_von" text,
	"verworfen_am" timestamp with time zone,
	CONSTRAINT "kennzahl_wert_periode" CHECK ("kennzahl_wert"."periode_ende" >= "kennzahl_wert"."periode_beginn"),
	CONSTRAINT "kennzahl_wert_bestaetigt" CHECK (("kennzahl_wert"."status" = 'bestaetigt') = ("kennzahl_wert"."bestaetigt_am" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "fonds_kennzahl" ADD CONSTRAINT "fonds_kennzahl_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kennzahl_abfrage" ADD CONSTRAINT "kennzahl_abfrage_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kennzahl_abfrage_position" ADD CONSTRAINT "kennzahl_abfrage_position_abfrage_id_kennzahl_abfrage_id_fk" FOREIGN KEY ("abfrage_id") REFERENCES "public"."kennzahl_abfrage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kennzahl_abfrage_position" ADD CONSTRAINT "kennzahl_abfrage_position_definition_id_kennzahl_definition_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."kennzahl_definition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kennzahl_wert" ADD CONSTRAINT "kennzahl_wert_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kennzahl_wert" ADD CONSTRAINT "kennzahl_wert_definition_id_kennzahl_definition_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."kennzahl_definition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kennzahl_wert" ADD CONSTRAINT "kennzahl_wert_abfrage_id_kennzahl_abfrage_id_fk" FOREIGN KEY ("abfrage_id") REFERENCES "public"."kennzahl_abfrage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abfrage_zugriff_schluessel_idx" ON "abfrage_zugriff" USING btree ("schluessel","am");--> statement-breakpoint
CREATE UNIQUE INDEX "kennzahl_abfrage_token_uq" ON "kennzahl_abfrage" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "kennzahl_abfrage_aktiv_uq" ON "kennzahl_abfrage" USING btree ("beteiligung_id","periode_beginn","periode_ende") WHERE "kennzahl_abfrage"."status" IN ('offen', 'eingereicht');--> statement-breakpoint
CREATE INDEX "kennzahl_abfrage_beteiligung_idx" ON "kennzahl_abfrage" USING btree ("beteiligung_id","periode_ende");--> statement-breakpoint
CREATE UNIQUE INDEX "kennzahl_definition_version_uq" ON "kennzahl_definition" USING btree ("schluessel","katalog_version");--> statement-breakpoint
CREATE INDEX "kennzahl_wert_reihe_idx" ON "kennzahl_wert" USING btree ("beteiligung_id","definition_id","periode_beginn","periode_ende","szenario");--> statement-breakpoint
CREATE INDEX "kennzahl_wert_abfrage_idx" ON "kennzahl_wert" USING btree ("abfrage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kennzahl_wert_abfrage_offen_uq" ON "kennzahl_wert" USING btree ("abfrage_id","definition_id") WHERE "kennzahl_wert"."abfrage_id" IS NOT NULL AND "kennzahl_wert"."status" IN ('entwurf', 'eingereicht') AND "kennzahl_wert"."verworfen_am" IS NULL;--> statement-breakpoint
-- Standardkatalog (Version 1, gültig ab 2026-01-01). Der Block esg_* ist ein Platzhalter, den die ESG-Etappe um die PAI-Indikatoren erweitert.
INSERT INTO "kennzahl_definition" ("schluessel", "katalog_version", "bezeichnung_de", "bezeichnung_en", "einheit", "typ", "kategorie", "periodizitaet", "aggregation", "pflicht", "reihenfolge", "gueltig_ab") VALUES
  ('umsatz', 1, 'Umsatz', 'Revenue', 'EUR', 'betrag', 'finanzen', 'monat', 'summe', true, 10, '2026-01-01'),
  ('ebitda', 1, 'EBITDA', 'EBITDA', 'EUR', 'betrag', 'finanzen', 'monat', 'summe', true, 20, '2026-01-01'),
  ('liquiditaet', 1, 'Liquidität', 'Cash position', 'EUR', 'betrag', 'finanzen', 'monat', 'stand', true, 30, '2026-01-01'),
  ('mittelabfluss_monat', 1, 'Monatlicher Mittelabfluss', 'Monthly cash burn', 'EUR', 'betrag', 'finanzen', 'monat', 'durchschnitt', false, 40, '2026-01-01'),
  ('mitarbeitende_vzae', 1, 'Mitarbeitende (VZÄ)', 'Employees (FTE)', 'Anzahl', 'zahl', 'betrieb', 'quartal', 'stand', true, 50, '2026-01-01'),
  ('arr', 1, 'ARR (wiederkehrender Jahresumsatz)', 'ARR (annual recurring revenue)', 'EUR', 'betrag', 'betrieb', 'monat', 'stand', false, 60, '2026-01-01'),
  ('kundenzahl', 1, 'Kundenzahl', 'Number of customers', 'Anzahl', 'zahl', 'betrieb', 'quartal', 'stand', false, 70, '2026-01-01'),
  ('esg_thg_scope1', 1, 'Treibhausgasemissionen Scope 1', 'Greenhouse gas emissions scope 1', 't CO2e', 'zahl', 'esg_umwelt', 'jahr', 'summe', false, 110, '2026-01-01'),
  ('esg_thg_scope2', 1, 'Treibhausgasemissionen Scope 2', 'Greenhouse gas emissions scope 2', 't CO2e', 'zahl', 'esg_umwelt', 'jahr', 'summe', false, 120, '2026-01-01'),
  ('esg_frauenanteil_leitung', 1, 'Frauenanteil im Leitungsorgan', 'Share of women in the management body', 'Prozent', 'prozent', 'esg_sozial', 'jahr', 'stand', false, 130, '2026-01-01'),
  ('esg_verstoesse_ungc', 1, 'Verstöße gegen UNGC oder OECD-Leitsätze', 'Violations of UNGC or OECD guidelines', '', 'ja_nein', 'esg_governance', 'jahr', 'stand', false, 140, '2026-01-01');--> statement-breakpoint
-- Fonds der Kennzahlen-Tabellen im Änderungsprotokoll: eigener Trigger statt eine Neufassung von aenderung_fonds_von, damit die Migration
-- unabhängig von anderen Erweiterungen dieser Funktion bleibt. Er setzt `fonds_id` nur, wo es noch leer ist; der Trigger von aenderung_fonds_setzen (Rückfall auf `fondsId` im Stand) läuft danach
-- (Triggernamen alphabetisch) und lässt einen gesetzten Wert unberührt.
CREATE FUNCTION aenderung_fonds_kennzahl_setzen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fonds_id IS NULL THEN
    NEW.fonds_id := CASE NEW.tabelle
      WHEN 'fonds_kennzahl' THEN NEW.datensatz_id
      WHEN 'kennzahl_wert' THEN (SELECT b.fonds_id FROM kennzahl_wert x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = NEW.datensatz_id)
      WHEN 'kennzahl_abfrage' THEN (SELECT b.fonds_id FROM kennzahl_abfrage x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = NEW.datensatz_id)
      ELSE NULL
    END;
    -- Gelöschte Zeilen finden über die Tabelle keine Beteiligung mehr: dann gilt sie aus dem protokollierten Stand (vorher, sonst nachher),
    -- als `beteiligungId` (Drizzle) oder `beteiligung_id` (SQL). Ohne Fonds fielen sie aus der Änderungsabfrage je Fonds heraus.
    IF NEW.fonds_id IS NULL AND NEW.tabelle IN ('kennzahl_wert', 'kennzahl_abfrage') THEN
      NEW.fonds_id := (
        SELECT b.fonds_id FROM beteiligung b
        WHERE b.id::text = coalesce(NEW.vorher->>'beteiligungId', NEW.vorher->>'beteiligung_id', NEW.nachher->>'beteiligungId', NEW.nachher->>'beteiligung_id')
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER aenderung_fonds_kennzahl_setzen BEFORE INSERT ON "aenderung"
  FOR EACH ROW EXECUTE FUNCTION aenderung_fonds_kennzahl_setzen();