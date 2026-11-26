CREATE TYPE "public"."beleg_art" AS ENUM('vertragsanlage', 'auszahlung', 'zinsbuchung', 'verkauf', 'wandlung', 'kapitalabruf', 'ausschuettung');--> statement-breakpoint
CREATE TYPE "public"."beleg_bezug_art" AS ENUM('vorgang', 'zinslauf', 'verkauf', 'wandlung', 'beteiligung', 'fonds_bewegung');--> statement-breakpoint
CREATE TYPE "public"."beleg_status" AS ENUM('entwurf', 'geprueft', 'freigegeben');--> statement-breakpoint
CREATE TYPE "public"."buchungsquelle" AS ENUM('zins', 'auszahlung', 'rueckfluss', 'tilgung', 'zusage', 'wertberichtigung', 'abruf', 'ausschuettung');--> statement-breakpoint
CREATE TYPE "public"."gliederung_sicht" AS ENUM('bilanz', 'guv', 'liquiditaet', 'mittelverwendung', 'portfolio');--> statement-breakpoint
CREATE TYPE "public"."sachkonto_art" AS ENUM('aktiv', 'passiv', 'aufwand', 'ertrag');--> statement-breakpoint
CREATE TYPE "public"."saldenlauf_status" AS ENUM('hochgeladen', 'geprueft', 'uebernommen');--> statement-breakpoint
CREATE TABLE "beleg" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"art" "beleg_art" NOT NULL,
	"bezug_art" "beleg_bezug_art" NOT NULL,
	"bezug_id" uuid NOT NULL,
	"beteiligung_id" uuid,
	"sprache" text NOT NULL,
	"status" "beleg_status" DEFAULT 'entwurf' NOT NULL,
	"vorlage" jsonb NOT NULL,
	"daten" jsonb NOT NULL,
	"befunde" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"naechste_stufe" integer DEFAULT 0 NOT NULL,
	"belegnummer" text,
	"belegnummer_lfd" integer,
	"erstellt_von" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"freigegeben_am" timestamp with time zone,
	"datei_name" text,
	"datei_schluessel" text,
	"datei_sha256" text,
	"datei_groesse" integer,
	CONSTRAINT "beleg_nummer_status" CHECK (("beleg"."status" = 'freigegeben') = ("beleg"."belegnummer" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "beleg_nummernkreis" (
	"fonds_id" uuid PRIMARY KEY NOT NULL,
	"letzte" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beleg_stufe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beleg_id" uuid NOT NULL,
	"stufe_index" integer NOT NULL,
	"stufe" text NOT NULL,
	"ergebnis" text NOT NULL,
	"kommentar" text,
	"akteur" text NOT NULL,
	"am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beleg_stufe_ergebnis" CHECK ("beleg_stufe"."ergebnis" IN ('ok', 'zurueck'))
);
--> statement-breakpoint
CREATE TABLE "beleg_vorlage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"art" "beleg_art" NOT NULL,
	"felder" jsonb NOT NULL,
	"kopf_de" text DEFAULT '' NOT NULL,
	"kopf_en" text DEFAULT '' NOT NULL,
	"fuss_de" text DEFAULT '' NOT NULL,
	"fuss_en" text DEFAULT '' NOT NULL,
	"geaendert_von" text NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beteiligung_buchhaltung" (
	"beteiligung_id" uuid PRIMARY KEY NOT NULL,
	"projektnummer" text,
	"vertragsnummer" text,
	"partnernummer" text,
	"buchungskreis" text,
	"foerderprogramm" text,
	"geaendert_von" text NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buchungsexport" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"format_version" text NOT NULL,
	"erzeugt_von" text NOT NULL,
	"erzeugt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"datum_von" date NOT NULL,
	"datum_bis" date NOT NULL,
	"anzahl" integer NOT NULL,
	"summe" numeric(18, 2) NOT NULL,
	"wiederholung" boolean DEFAULT false NOT NULL,
	"grund" text,
	"datei_name" text NOT NULL,
	"datei_schluessel" text NOT NULL,
	"datei_sha256" text NOT NULL,
	"datei_groesse" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buchungsexport_position" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"export_id" uuid NOT NULL,
	"vorgang_id" uuid,
	"fonds_bewegung_id" uuid,
	"aktiv" boolean DEFAULT true NOT NULL,
	"belegfeld" text NOT NULL,
	"betrag" numeric(18, 2) NOT NULL,
	CONSTRAINT "buchungsexport_position_quelle" CHECK (("buchungsexport_position"."vorgang_id" IS NOT NULL) <> ("buchungsexport_position"."fonds_bewegung_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "buchungsregel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"quelle" "buchungsquelle" NOT NULL,
	"konto" text NOT NULL,
	"gegenkonto" text NOT NULL,
	"richtung" text DEFAULT 'S' NOT NULL,
	"bu_schluessel" text,
	"buchungstext" text NOT NULL,
	"geaendert_von" text NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buchungsregel_richtung" CHECK ("buchungsregel"."richtung" IN ('S', 'H')),
	CONSTRAINT "buchungsregel_konten" CHECK ("buchungsregel"."konto" ~ '^[0-9]{1,9}$' AND "buchungsregel"."gegenkonto" ~ '^[0-9]{1,9}$')
);
--> statement-breakpoint
CREATE TABLE "fonds_buchhaltung" (
	"fonds_id" uuid PRIMARY KEY NOT NULL,
	"beraternummer" integer,
	"mandantennummer" integer,
	"wirtschaftsjahr_beginn" integer DEFAULT 1 NOT NULL,
	"sachkontenlaenge" integer DEFAULT 4 NOT NULL,
	"belegpraefix" text DEFAULT 'B' NOT NULL,
	"geaendert_von" text NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fonds_buchhaltung_wj" CHECK ("fonds_buchhaltung"."wirtschaftsjahr_beginn" BETWEEN 1 AND 12),
	CONSTRAINT "fonds_buchhaltung_laenge" CHECK ("fonds_buchhaltung"."sachkontenlaenge" BETWEEN 4 AND 8),
	CONSTRAINT "fonds_buchhaltung_praefix" CHECK ("fonds_buchhaltung"."belegpraefix" ~ '^[A-Za-z0-9-]{0,12}$')
);
--> statement-breakpoint
CREATE TABLE "fonds_mittelart" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"schluessel" text NOT NULL,
	"bezeichnung_de" text NOT NULL,
	"bezeichnung_en" text NOT NULL,
	"quote" numeric(8, 6) NOT NULL,
	"gueltig_ab" date NOT NULL,
	"gueltig_bis" date,
	CONSTRAINT "fonds_mittelart_quote" CHECK ("fonds_mittelart"."quote" >= 0 AND "fonds_mittelart"."quote" <= 1),
	CONSTRAINT "fonds_mittelart_zeitraum" CHECK ("fonds_mittelart"."gueltig_bis" IS NULL OR "fonds_mittelart"."gueltig_bis" >= "fonds_mittelart"."gueltig_ab")
);
--> statement-breakpoint
CREATE TABLE "gliederung_position" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"sicht" "gliederung_sicht" NOT NULL,
	"schluessel" text NOT NULL,
	"eltern_schluessel" text,
	"bezeichnung_de" text NOT NULL,
	"bezeichnung_en" text NOT NULL,
	"reihenfolge" integer NOT NULL,
	"seite" text DEFAULT 'soll' NOT NULL,
	CONSTRAINT "gliederung_position_seite" CHECK ("gliederung_position"."seite" IN ('soll', 'haben'))
);
--> statement-breakpoint
CREATE TABLE "kontenregel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"sicht" "gliederung_sicht" NOT NULL,
	"konto_von" text NOT NULL,
	"konto_bis" text NOT NULL,
	"position_schluessel" text NOT NULL,
	"gueltig_ab" date NOT NULL,
	"gueltig_bis" date,
	"erstellt_von" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kontenregel_konten" CHECK ("kontenregel"."konto_von" ~ '^[0-9]{1,9}$' AND "kontenregel"."konto_bis" ~ '^[0-9]{1,9}$' AND length("kontenregel"."konto_von") = length("kontenregel"."konto_bis") AND "kontenregel"."konto_bis" >= "kontenregel"."konto_von"),
	CONSTRAINT "kontenregel_zeitraum" CHECK ("kontenregel"."gueltig_bis" IS NULL OR "kontenregel"."gueltig_bis" >= "kontenregel"."gueltig_ab")
);
--> statement-breakpoint
CREATE TABLE "sachkonto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"nummer" text NOT NULL,
	"bezeichnung" text NOT NULL,
	"art" "sachkonto_art" NOT NULL,
	"beteiligung_id" uuid,
	CONSTRAINT "sachkonto_nummer" CHECK ("sachkonto"."nummer" ~ '^[0-9]{1,9}$')
);
--> statement-breakpoint
CREATE TABLE "saldenlauf" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"zeitraum_von" date NOT NULL,
	"zeitraum_bis" date NOT NULL,
	"dateiname" text NOT NULL,
	"dateityp" text NOT NULL,
	"format" text,
	"groesse" integer NOT NULL,
	"sha256" text NOT NULL,
	"datei" "bytea" NOT NULL,
	"status" "saldenlauf_status" DEFAULT 'hochgeladen' NOT NULL,
	"hochgeladen_von" text NOT NULL,
	"hochgeladen_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geprueft_von" text,
	"geprueft_am" timestamp with time zone,
	"fehler_anzahl" integer,
	"warnung_anzahl" integer,
	"summe" jsonb,
	"uebernommen_von" text,
	"uebernommen_am" timestamp with time zone,
	"ersetzt_am" timestamp with time zone,
	"ersetzt_von_lauf_id" uuid,
	CONSTRAINT "saldenlauf_zeitraum" CHECK ("saldenlauf"."zeitraum_bis" >= "saldenlauf"."zeitraum_von")
);
--> statement-breakpoint
CREATE TABLE "saldenlauf_befund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lauf_id" uuid NOT NULL,
	"nr" integer NOT NULL,
	"zeile" integer,
	"spalte" text,
	"code" text NOT NULL,
	"schweregrad" text NOT NULL,
	"meldung" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "saldenlauf_befund_grad" CHECK ("saldenlauf_befund"."schweregrad" IN ('fehler', 'warnung'))
);
--> statement-breakpoint
CREATE TABLE "saldo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lauf_id" uuid NOT NULL,
	"zeile" integer NOT NULL,
	"konto_nummer" text NOT NULL,
	"bezeichnung" text,
	"eb_wert" numeric(18, 2),
	"soll" numeric(18, 2),
	"haben" numeric(18, 2),
	"saldo" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beleg" ADD CONSTRAINT "beleg_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beleg" ADD CONSTRAINT "beleg_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beleg_nummernkreis" ADD CONSTRAINT "beleg_nummernkreis_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beleg_stufe" ADD CONSTRAINT "beleg_stufe_beleg_id_beleg_id_fk" FOREIGN KEY ("beleg_id") REFERENCES "public"."beleg"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beleg_vorlage" ADD CONSTRAINT "beleg_vorlage_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beteiligung_buchhaltung" ADD CONSTRAINT "beteiligung_buchhaltung_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buchungsexport" ADD CONSTRAINT "buchungsexport_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buchungsexport_position" ADD CONSTRAINT "buchungsexport_position_export_id_buchungsexport_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."buchungsexport"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buchungsexport_position" ADD CONSTRAINT "buchungsexport_position_vorgang_id_vorgang_id_fk" FOREIGN KEY ("vorgang_id") REFERENCES "public"."vorgang"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buchungsexport_position" ADD CONSTRAINT "buchungsexport_position_fonds_bewegung_id_fonds_bewegung_id_fk" FOREIGN KEY ("fonds_bewegung_id") REFERENCES "public"."fonds_bewegung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buchungsregel" ADD CONSTRAINT "buchungsregel_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonds_buchhaltung" ADD CONSTRAINT "fonds_buchhaltung_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonds_mittelart" ADD CONSTRAINT "fonds_mittelart_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gliederung_position" ADD CONSTRAINT "gliederung_position_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontenregel" ADD CONSTRAINT "kontenregel_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sachkonto" ADD CONSTRAINT "sachkonto_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sachkonto" ADD CONSTRAINT "sachkonto_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldenlauf" ADD CONSTRAINT "saldenlauf_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldenlauf" ADD CONSTRAINT "saldenlauf_ersetzt_von_lauf_id_saldenlauf_id_fk" FOREIGN KEY ("ersetzt_von_lauf_id") REFERENCES "public"."saldenlauf"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldenlauf_befund" ADD CONSTRAINT "saldenlauf_befund_lauf_id_saldenlauf_id_fk" FOREIGN KEY ("lauf_id") REFERENCES "public"."saldenlauf"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldo" ADD CONSTRAINT "saldo_lauf_id_saldenlauf_id_fk" FOREIGN KEY ("lauf_id") REFERENCES "public"."saldenlauf"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "beleg_bezug_uq" ON "beleg" USING btree ("art","bezug_art","bezug_id");--> statement-breakpoint
CREATE UNIQUE INDEX "beleg_nummer_uq" ON "beleg" USING btree ("fonds_id","belegnummer_lfd");--> statement-breakpoint
CREATE INDEX "beleg_fonds_idx" ON "beleg" USING btree ("fonds_id","erstellt_am");--> statement-breakpoint
CREATE INDEX "beleg_stufe_beleg_idx" ON "beleg_stufe" USING btree ("beleg_id","am");--> statement-breakpoint
CREATE UNIQUE INDEX "beleg_vorlage_fonds_art_uq" ON "beleg_vorlage" USING btree ("fonds_id","art");--> statement-breakpoint
CREATE INDEX "buchungsexport_fonds_idx" ON "buchungsexport" USING btree ("fonds_id","erzeugt_am");--> statement-breakpoint
CREATE UNIQUE INDEX "buchungsexport_position_aktiv_uq" ON "buchungsexport_position" USING btree ("vorgang_id") WHERE "buchungsexport_position"."aktiv";--> statement-breakpoint
CREATE UNIQUE INDEX "buchungsexport_position_bewegung_aktiv_uq" ON "buchungsexport_position" USING btree ("fonds_bewegung_id") WHERE "buchungsexport_position"."aktiv";--> statement-breakpoint
CREATE INDEX "buchungsexport_position_export_idx" ON "buchungsexport_position" USING btree ("export_id");--> statement-breakpoint
CREATE UNIQUE INDEX "buchungsregel_uq" ON "buchungsregel" USING btree ("fonds_id","quelle");--> statement-breakpoint
CREATE UNIQUE INDEX "fonds_mittelart_uq" ON "fonds_mittelart" USING btree ("fonds_id","schluessel","gueltig_ab");--> statement-breakpoint
CREATE UNIQUE INDEX "gliederung_position_uq" ON "gliederung_position" USING btree ("fonds_id","sicht","schluessel");--> statement-breakpoint
CREATE INDEX "kontenregel_fonds_sicht_idx" ON "kontenregel" USING btree ("fonds_id","sicht");--> statement-breakpoint
CREATE UNIQUE INDEX "sachkonto_fonds_nummer_uq" ON "sachkonto" USING btree ("fonds_id","nummer");--> statement-breakpoint
CREATE INDEX "saldenlauf_fonds_idx" ON "saldenlauf" USING btree ("fonds_id","zeitraum_bis");--> statement-breakpoint
CREATE INDEX "saldenlauf_befund_idx" ON "saldenlauf_befund" USING btree ("lauf_id","nr");--> statement-breakpoint
CREATE UNIQUE INDEX "saldo_lauf_konto_uq" ON "saldo" USING btree ("lauf_id","konto_nummer");--> statement-breakpoint
-- Ein freigegebener Beleg wird nie geändert oder gelöscht; ein Beleg wird erst mit der Freigabe nummeriert (Check am Beleg).
CREATE FUNCTION beleg_freigegeben_schutz() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'freigegeben' THEN
    RAISE EXCEPTION 'Ein freigegebener Beleg wird nie geändert oder gelöscht (% auf beleg)', TG_OP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER beleg_freigegeben_schutz BEFORE UPDATE OR DELETE ON "beleg"
  FOR EACH ROW EXECUTE FUNCTION beleg_freigegeben_schutz();--> statement-breakpoint
-- Das Stufenprotokoll ist nur anhängend (TRUNCATE bleibt erlaubt).
CREATE FUNCTION beleg_stufe_nur_anhaengen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Das Stufenprotokoll der Belege ist nur anhängend (% auf beleg_stufe)', TG_OP;
END;
$$;--> statement-breakpoint
CREATE TRIGGER beleg_stufe_nur_anhaengen BEFORE UPDATE OR DELETE ON "beleg_stufe"
  FOR EACH ROW EXECUTE FUNCTION beleg_stufe_nur_anhaengen();--> statement-breakpoint
-- Fonds der Tabellen dieser Etappe im Änderungsprotokoll (eigener Trigger, setzt `fonds_id` nur, wo es noch leer ist).
CREATE FUNCTION aenderung_fonds_buchhaltung_setzen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  aus text := coalesce(NEW.nachher->>'fondsId', NEW.nachher->>'fonds_id', NEW.vorher->>'fondsId', NEW.vorher->>'fonds_id');
BEGIN
  IF NEW.fonds_id IS NULL AND NEW.tabelle IN ('fonds_buchhaltung', 'fonds_mittelart', 'beleg_vorlage', 'beleg', 'sachkonto', 'gliederung_position', 'kontenregel', 'saldenlauf', 'buchungsregel', 'buchungsexport') AND aus IS NOT NULL THEN
    NEW.fonds_id := aus::uuid;
  ELSIF NEW.fonds_id IS NULL AND NEW.tabelle = 'beteiligung_buchhaltung' THEN
    NEW.fonds_id := (SELECT b.fonds_id FROM beteiligung b WHERE b.id = NEW.datensatz_id);
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER aenderung_fonds_buchhaltung_setzen BEFORE INSERT ON "aenderung"
  FOR EACH ROW EXECUTE FUNCTION aenderung_fonds_buchhaltung_setzen();
