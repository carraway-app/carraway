CREATE TYPE "public"."bewertung_status" AS ENUM('entwurf', 'freigegeben', 'ersetzt', 'verworfen');--> statement-breakpoint
CREATE TYPE "public"."bewertungsrunde_status" AS ENUM('entwurf', 'freigegeben', 'verworfen');--> statement-breakpoint
CREATE TYPE "public"."runden_vorschlag" AS ENUM('fortschreiben', 'letzte_runde');--> statement-breakpoint
CREATE TABLE "bewertungsrunde" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"stichtag" date NOT NULL,
	"vorschlag" "runden_vorschlag" NOT NULL,
	"status" "bewertungsrunde_status" DEFAULT 'entwurf' NOT NULL,
	"erstellt_von" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"freigegeben_von" text,
	"freigegeben_am" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "bewertung_beteiligung_stichtag_uq";--> statement-breakpoint
ALTER TABLE "bewertung" ADD COLUMN "grundlage" text;--> statement-breakpoint
ALTER TABLE "bewertung" ADD COLUMN "status" "bewertung_status" DEFAULT 'entwurf' NOT NULL;--> statement-breakpoint
ALTER TABLE "bewertung" ADD COLUMN "erstellt_von" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "bewertung" ADD COLUMN "freigegeben_von" text;--> statement-breakpoint
ALTER TABLE "bewertung" ADD COLUMN "freigegeben_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bewertung" ADD COLUMN "ersetzt_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bewertung" ADD COLUMN "ersetzt_bewertung_id" uuid;--> statement-breakpoint
ALTER TABLE "bewertung" ADD COLUMN "bewertungsrunde_id" uuid;--> statement-breakpoint
ALTER TABLE "bewertungsrunde" ADD CONSTRAINT "bewertungsrunde_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bewertungsrunde_fonds_idx" ON "bewertungsrunde" USING btree ("fonds_id","stichtag");--> statement-breakpoint
ALTER TABLE "bewertung" ADD CONSTRAINT "bewertung_ersetzt_bewertung_id_bewertung_id_fk" FOREIGN KEY ("ersetzt_bewertung_id") REFERENCES "public"."bewertung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bewertung" ADD CONSTRAINT "bewertung_bewertungsrunde_id_bewertungsrunde_id_fk" FOREIGN KEY ("bewertungsrunde_id") REFERENCES "public"."bewertungsrunde"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bewertung_freigegeben_uq" ON "bewertung" USING btree ("beteiligung_id","stichtag") WHERE "bewertung"."status" = 'freigegeben';--> statement-breakpoint
CREATE UNIQUE INDEX "bewertung_entwurf_uq" ON "bewertung" USING btree ("beteiligung_id","stichtag") WHERE "bewertung"."status" = 'entwurf';--> statement-breakpoint
CREATE INDEX "bewertung_beteiligung_stichtag_idx" ON "bewertung" USING btree ("beteiligung_id","stichtag");--> statement-breakpoint
CREATE INDEX "bewertung_runde_idx" ON "bewertung" USING btree ("bewertungsrunde_id");
--> statement-breakpoint
-- Bestehende Bewertungen gelten als freigegeben. Der Trigger der Periodensperre (0012) würde das Umstellen von Bewertungen in
-- bereits gesperrten Perioden abweisen; die Migration ändert dort keinen Wert, nur den Status, und darf deshalb durch.
ALTER TABLE "bewertung" DISABLE TRIGGER "bewertung_periodensperre";--> statement-breakpoint
UPDATE "bewertung" SET "status" = 'freigegeben', "erstellt_von" = 'migration', "freigegeben_von" = 'migration', "freigegeben_am" = "erfasst_am";--> statement-breakpoint
ALTER TABLE "bewertung" ENABLE TRIGGER "bewertung_periodensperre";--> statement-breakpoint
CREATE FUNCTION bewertung_vor_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Direkt freigegeben angelegte Zeilen (Systembuchungen, Import, Tests) gelten ab ihrer Erfassung.
  IF NEW.status = 'freigegeben' AND NEW.freigegeben_am IS NULL THEN
    NEW.freigegeben_am := NEW.erfasst_am;
    NEW.freigegeben_von := coalesce(NEW.freigegeben_von, NEW.erstellt_von);
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER bewertung_vor_insert BEFORE INSERT ON "bewertung"
  FOR EACH ROW EXECUTE FUNCTION bewertung_vor_insert();--> statement-breakpoint
CREATE FUNCTION bewertung_schutz() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('freigegeben', 'ersetzt') THEN
      RAISE EXCEPTION 'Eine freigegebene Bewertung wird nie gelöscht; Korrektur nur durch eine neue Bewertung'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('freigegeben', 'ersetzt', 'verworfen') THEN
    -- Einzig erlaubter Übergang: freigegeben -> ersetzt, ohne weitere Änderung.
    IF OLD.status = 'freigegeben' AND NEW.status = 'ersetzt' AND NEW.ersetzt_am IS NOT NULL
       AND (NEW.id, NEW.beteiligung_id, NEW.stichtag, NEW.wert, NEW.methode, NEW.begruendung, NEW.grundlage, NEW.erstellt_von,
            NEW.freigegeben_von, NEW.freigegeben_am, NEW.ersetzt_bewertung_id, NEW.bewertungsrunde_id, NEW.erfasst_am)
          IS NOT DISTINCT FROM
          (OLD.id, OLD.beteiligung_id, OLD.stichtag, OLD.wert, OLD.methode, OLD.begruendung, OLD.grundlage, OLD.erstellt_von,
           OLD.freigegeben_von, OLD.freigegeben_am, OLD.ersetzt_bewertung_id, OLD.bewertungsrunde_id, OLD.erfasst_am) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Eine freigegebene Bewertung wird nie geändert; Korrektur nur durch eine neue Bewertung'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER bewertung_schutz BEFORE UPDATE OR DELETE ON "bewertung"
  FOR EACH ROW EXECUTE FUNCTION bewertung_schutz();--> statement-breakpoint
CREATE TRIGGER bewertung_snapshot_auftrag_aktualisiert AFTER UPDATE ON "bewertung"
  REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION snapshot_auftrag_aus_bewertung();
