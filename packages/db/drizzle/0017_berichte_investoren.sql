CREATE TYPE "public"."abschnitt_status" AS ENUM('entwurf', 'freigegeben');--> statement-breakpoint
CREATE TYPE "public"."bericht_art" AS ENUM('fondsbericht', 'quartalsbericht', 'lp_bericht', 'gremienvorlage', 'portfolioliste', 'exitliste');--> statement-breakpoint
CREATE TYPE "public"."bericht_format" AS ENUM('pdf', 'xlsx');--> statement-breakpoint
CREATE TYPE "public"."bericht_status" AS ENUM('entwurf', 'geprueft', 'freigegeben');--> statement-breakpoint
CREATE TABLE "bericht" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"art" "bericht_art" NOT NULL,
	"format" "bericht_format" NOT NULL,
	"fonds_id" uuid,
	"beteiligung_id" uuid,
	"stichtag" date NOT NULL,
	"sprache" text NOT NULL,
	"stand_vorgabe" timestamp with time zone,
	"stand" timestamp with time zone,
	"status" "bericht_status" DEFAULT 'entwurf' NOT NULL,
	"parameter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"freigabestufen" jsonb NOT NULL,
	"naechste_stufe" integer DEFAULT 0 NOT NULL,
	"erstellt_von" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"erzeugt_am" timestamp with time zone,
	"datei_name" text,
	"datei_schluessel" text,
	"datei_sha256" text,
	"datei_groesse" integer,
	"kontrolle_ueberschrieben" jsonb,
	CONSTRAINT "bericht_bezug" CHECK ("bericht"."fonds_id" IS NOT NULL OR "bericht"."beteiligung_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "bericht_abschnitt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bericht_id" uuid NOT NULL,
	"schluessel" text NOT NULL,
	"text_de" text DEFAULT '' NOT NULL,
	"text_en" text DEFAULT '' NOT NULL,
	"status" "abschnitt_status" DEFAULT 'entwurf' NOT NULL,
	"geaendert_von" text NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bericht_freigabe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bericht_id" uuid NOT NULL,
	"stufe_index" integer NOT NULL,
	"stufe" text NOT NULL,
	"ergebnis" text NOT NULL,
	"kommentar" text,
	"akteur" text NOT NULL,
	"am" timestamp with time zone DEFAULT now() NOT NULL,
	"kontrolle_ueberschreibung" text,
	CONSTRAINT "bericht_freigabe_ergebnis" CHECK ("bericht_freigabe"."ergebnis" IN ('ok', 'zurueck'))
);
--> statement-breakpoint
CREATE TABLE "bericht_freigabestufen" (
	"fonds_id" uuid PRIMARY KEY NOT NULL,
	"stufen" jsonb NOT NULL,
	"geaendert_von" text NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bericht_vorlage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"art" "bericht_art" NOT NULL,
	"konfiguration" jsonb NOT NULL,
	"geaendert_von" text NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fonds_zeichnung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"zusage" numeric(18, 2) NOT NULL,
	"anteil" numeric(10, 6) NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fonds_zeichnung_anteil_bereich" CHECK ("fonds_zeichnung"."anteil" > 0 AND "fonds_zeichnung"."anteil" <= 1),
	CONSTRAINT "fonds_zeichnung_zusage_positiv" CHECK ("fonds_zeichnung"."zusage" > 0)
);
--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "beschlussvorschlag" text;--> statement-breakpoint
ALTER TABLE "bericht" ADD CONSTRAINT "bericht_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bericht" ADD CONSTRAINT "bericht_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bericht_abschnitt" ADD CONSTRAINT "bericht_abschnitt_bericht_id_bericht_id_fk" FOREIGN KEY ("bericht_id") REFERENCES "public"."bericht"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bericht_freigabe" ADD CONSTRAINT "bericht_freigabe_bericht_id_bericht_id_fk" FOREIGN KEY ("bericht_id") REFERENCES "public"."bericht"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bericht_freigabestufen" ADD CONSTRAINT "bericht_freigabestufen_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bericht_vorlage" ADD CONSTRAINT "bericht_vorlage_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonds_zeichnung" ADD CONSTRAINT "fonds_zeichnung_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonds_zeichnung" ADD CONSTRAINT "fonds_zeichnung_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bericht_fonds_idx" ON "bericht" USING btree ("fonds_id","stichtag");--> statement-breakpoint
CREATE UNIQUE INDEX "bericht_abschnitt_uq" ON "bericht_abschnitt" USING btree ("bericht_id","schluessel");--> statement-breakpoint
CREATE INDEX "bericht_freigabe_bericht_idx" ON "bericht_freigabe" USING btree ("bericht_id","am");--> statement-breakpoint
CREATE UNIQUE INDEX "bericht_vorlage_fonds_art_uq" ON "bericht_vorlage" USING btree ("fonds_id","art");--> statement-breakpoint
CREATE UNIQUE INDEX "fonds_zeichnung_fonds_organisation_uq" ON "fonds_zeichnung" USING btree ("fonds_id","organisation_id");
--> statement-breakpoint
CREATE FUNCTION bericht_freigegeben_schutz() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'freigegeben' THEN
    RAISE EXCEPTION 'Ein freigegebener Bericht wird nie geändert oder gelöscht (% auf bericht)', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER bericht_freigegeben_schutz BEFORE UPDATE OR DELETE ON "bericht"
  FOR EACH ROW EXECUTE FUNCTION bericht_freigegeben_schutz();--> statement-breakpoint
CREATE FUNCTION bericht_freigabe_nur_anhaengen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Das Freigabeprotokoll ist nur anhängend (% auf bericht_freigabe)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER bericht_freigabe_kein_update_delete BEFORE UPDATE OR DELETE ON "bericht_freigabe"
  FOR EACH ROW EXECUTE FUNCTION bericht_freigabe_nur_anhaengen();--> statement-breakpoint
CREATE FUNCTION bericht_abschnitt_schutz() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  alt_status "bericht_status";
  neu_status "bericht_status";
BEGIN
  -- FOR SHARE: Abschnittsänderung und Freigabe (UPDATE des Berichts) können sich nicht überlappen.
  -- Ein Abschnitt gehört für immer zu seinem Bericht (kein Verschieben zwischen Berichten).
  IF TG_OP = 'UPDATE' AND NEW.bericht_id <> OLD.bericht_id THEN
    RAISE EXCEPTION 'Ein Abschnitt lässt sich nicht einem anderen Bericht zuordnen'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO alt_status FROM "bericht" WHERE id = OLD.bericht_id FOR SHARE;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO neu_status FROM "bericht" WHERE id = NEW.bericht_id FOR SHARE;
  END IF;
  IF alt_status = 'freigegeben' OR neu_status = 'freigegeben' THEN
    RAISE EXCEPTION 'Die Abschnitte eines freigegebenen Berichts werden nicht geändert (% auf bericht_abschnitt)', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER bericht_abschnitt_schutz BEFORE INSERT OR UPDATE OR DELETE ON "bericht_abschnitt"
  FOR EACH ROW EXECUTE FUNCTION bericht_abschnitt_schutz();
