CREATE TYPE "public"."szenario_status" AS ENUM('entwurf', 'festgeschrieben');--> statement-breakpoint
CREATE TABLE "reserve" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beteiligung_id" uuid NOT NULL,
	"betrag" numeric(18, 2) NOT NULL,
	"gueltig_ab" date NOT NULL,
	"bemerkung" text,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	"erfasst_von" text DEFAULT 'system' NOT NULL,
	CONSTRAINT "reserve_betrag" CHECK ("reserve"."betrag" >= 0)
);
--> statement-breakpoint
CREATE TABLE "szenario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"name" text NOT NULL,
	"basis_stichtag" date NOT NULL,
	"status" "szenario_status" DEFAULT 'entwurf' NOT NULL,
	"annahmen" jsonb NOT NULL,
	"ergebnis" jsonb,
	"ergebnis_hash" text,
	"wissensstand" timestamp with time zone,
	"erstellt_von" text DEFAULT 'system' NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"festgeschrieben_am" timestamp with time zone,
	"festgeschrieben_von" text,
	CONSTRAINT "szenario_festschreibung" CHECK (("szenario"."status" = 'entwurf' AND "szenario"."ergebnis" IS NULL AND "szenario"."ergebnis_hash" IS NULL AND "szenario"."festgeschrieben_am" IS NULL) OR ("szenario"."status" = 'festgeschrieben' AND "szenario"."ergebnis" IS NOT NULL AND "szenario"."ergebnis_hash" IS NOT NULL AND "szenario"."festgeschrieben_am" IS NOT NULL AND "szenario"."wissensstand" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "reserve" ADD CONSTRAINT "reserve_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "szenario" ADD CONSTRAINT "szenario_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reserve_beteiligung_idx" ON "reserve" USING btree ("beteiligung_id","gueltig_ab","erfasst_am");--> statement-breakpoint
CREATE UNIQUE INDEX "szenario_fonds_name_uq" ON "szenario" USING btree ("fonds_id","name");--> statement-breakpoint
CREATE INDEX "szenario_fonds_idx" ON "szenario" USING btree ("fonds_id","erstellt_am");--> statement-breakpoint
-- Ein festgeschriebenes Szenario ist unveränderlich. Der Übergang Entwurf -> festgeschrieben ist erlaubt, wenn er nur Status, Ergebnis,
-- Hash, Wissensstand und Festschreibung setzt und Name, Fonds, Basistag und Annahmen unberührt lässt.
CREATE FUNCTION szenario_schutz() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'festgeschrieben' THEN
      RAISE EXCEPTION 'Ein festgeschriebenes Szenario wird nicht gelöscht' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'festgeschrieben' THEN
    RAISE EXCEPTION 'Ein festgeschriebenes Szenario ist unveränderlich' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'festgeschrieben' AND (NEW.fonds_id <> OLD.fonds_id OR NEW.name <> OLD.name OR NEW.basis_stichtag <> OLD.basis_stichtag OR NEW.annahmen <> OLD.annahmen) THEN
    RAISE EXCEPTION 'Beim Festschreiben ändern sich die Eingaben nicht' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER szenario_schutz BEFORE UPDATE OR DELETE ON "szenario"
  FOR EACH ROW EXECUTE FUNCTION szenario_schutz();--> statement-breakpoint
-- Fonds von Szenarien und Reserven im Änderungsprotokoll (eigener Trigger, damit die Migration unabhängig von anderen Erweiterungen bleibt).
CREATE FUNCTION aenderung_fonds_szenario_setzen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fonds_id IS NULL THEN
    NEW.fonds_id := CASE NEW.tabelle
      WHEN 'szenario' THEN (SELECT x.fonds_id FROM szenario x WHERE x.id = NEW.datensatz_id)
      WHEN 'reserve' THEN (SELECT b.fonds_id FROM reserve x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = NEW.datensatz_id)
      ELSE NULL
    END;
    IF NEW.fonds_id IS NULL AND NEW.tabelle = 'szenario' THEN
      NEW.fonds_id := (coalesce(NEW.vorher->>'fondsId', NEW.nachher->>'fondsId'))::uuid;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER aenderung_fonds_szenario_setzen BEFORE INSERT ON "aenderung"
  FOR EACH ROW EXECUTE FUNCTION aenderung_fonds_szenario_setzen();