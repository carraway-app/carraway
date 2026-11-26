CREATE TYPE "public"."register_art" AS ENUM('HRA', 'HRB', 'GnR', 'PR', 'VR');--> statement-breakpoint
CREATE TYPE "public"."register_ereignis_art" AS ENUM('neueintragung', 'aenderung_geschaeftsfuehrung', 'kapitalerhoehung', 'sitzverlegung', 'insolvenz', 'loeschung', 'sonstiges');--> statement-breakpoint
CREATE TABLE "register_beobachtung" (
	"organisation_id" uuid PRIMARY KEY NOT NULL,
	"aktiv" boolean DEFAULT false NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_von" text DEFAULT 'system' NOT NULL,
	"letzte_pruefung_am" timestamp with time zone,
	"letztes_ergebnis" text
);
--> statement-breakpoint
CREATE TABLE "register_ereignis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"registereintrag_id" uuid,
	"datum" date NOT NULL,
	"art" "register_ereignis_art" NOT NULL,
	"text" text NOT NULL,
	"quelle" text NOT NULL,
	"externe_id" text,
	"erledigt_am" timestamp with time zone,
	"erledigt_von" text,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "register_ereignis_quelle" CHECK ("register_ereignis"."quelle" ~ '^(manuell|dokument|import|anbieter:[a-z0-9_-]{1,40})$')
);
--> statement-breakpoint
CREATE TABLE "register_meldung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"ereignis_id" uuid,
	"art" text NOT NULL,
	"text" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"gelesen_am" timestamp with time zone,
	"gelesen_von" text,
	CONSTRAINT "register_meldung_art" CHECK ("register_meldung"."art" IN ('ereignis', 'eintrag'))
);
--> statement-breakpoint
CREATE TABLE "registereintrag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"gericht" text NOT NULL,
	"registerart" "register_art" NOT NULL,
	"nummer" text NOT NULL,
	"firma" text NOT NULL,
	"rechtsform" text,
	"sitz" text,
	"anschrift" text,
	"gegenstand" text,
	"kapital" numeric(18, 2),
	"kapital_waehrung" text DEFAULT 'EUR' NOT NULL,
	"vertretung" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prokura" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stand_datum" date NOT NULL,
	"quelle" text NOT NULL,
	"dokument_id" uuid,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	"erfasst_von" text DEFAULT 'system' NOT NULL,
	CONSTRAINT "registereintrag_quelle" CHECK ("registereintrag"."quelle" ~ '^(manuell|dokument|import|anbieter:[a-z0-9_-]{1,40})$')
);
--> statement-breakpoint
ALTER TABLE "organisation" ADD COLUMN "rechtsform" text;--> statement-breakpoint
ALTER TABLE "register_beobachtung" ADD CONSTRAINT "register_beobachtung_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_ereignis" ADD CONSTRAINT "register_ereignis_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_ereignis" ADD CONSTRAINT "register_ereignis_registereintrag_id_registereintrag_id_fk" FOREIGN KEY ("registereintrag_id") REFERENCES "public"."registereintrag"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_meldung" ADD CONSTRAINT "register_meldung_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_meldung" ADD CONSTRAINT "register_meldung_ereignis_id_register_ereignis_id_fk" FOREIGN KEY ("ereignis_id") REFERENCES "public"."register_ereignis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registereintrag" ADD CONSTRAINT "registereintrag_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registereintrag" ADD CONSTRAINT "registereintrag_dokument_id_dokument_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "register_ereignis_organisation_idx" ON "register_ereignis" USING btree ("organisation_id","datum");--> statement-breakpoint
CREATE UNIQUE INDEX "register_ereignis_extern_uq" ON "register_ereignis" USING btree ("organisation_id","quelle","externe_id") WHERE "register_ereignis"."externe_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "register_meldung_organisation_idx" ON "register_meldung" USING btree ("organisation_id","erstellt_am");--> statement-breakpoint
CREATE INDEX "registereintrag_organisation_idx" ON "registereintrag" USING btree ("organisation_id","stand_datum","erfasst_am");--> statement-breakpoint
-- Registereinträge sind unveränderlich: jede Änderung ist eine neue Zeile. TRUNCATE bleibt erlaubt (Demo-Daten und Tests).
CREATE FUNCTION registereintrag_unveraenderlich() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registereinträge sind unveränderlich (% auf registereintrag); jede Änderung ist ein neuer Eintrag', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER registereintrag_kein_update_delete BEFORE UPDATE OR DELETE ON "registereintrag"
  FOR EACH ROW EXECUTE FUNCTION registereintrag_unveraenderlich();--> statement-breakpoint
-- Registerereignisse: nur die Erledigung (erledigt_am, erledigt_von) darf sich ändern, und nur einmal.
CREATE FUNCTION register_ereignis_schutz() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Registerereignisse werden nicht gelöscht' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'erledigt_am' - 'erledigt_von') IS DISTINCT FROM (to_jsonb(OLD) - 'erledigt_am' - 'erledigt_von') THEN
    RAISE EXCEPTION 'Registerereignisse sind unveränderlich, nur die Erledigung ist änderbar' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.erledigt_am IS NOT NULL AND NEW.erledigt_am IS DISTINCT FROM OLD.erledigt_am THEN
    RAISE EXCEPTION 'Das Ereignis ist bereits erledigt' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER register_ereignis_schutz BEFORE UPDATE OR DELETE ON "register_ereignis"
  FOR EACH ROW EXECUTE FUNCTION register_ereignis_schutz();