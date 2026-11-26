ALTER TYPE "public"."beleg_status" ADD VALUE 'storniert';--> statement-breakpoint
ALTER TABLE "beleg" DROP CONSTRAINT "beleg_nummer_status";--> statement-breakpoint
DROP INDEX "beleg_bezug_uq";--> statement-breakpoint
ALTER TABLE "beleg" ADD COLUMN "storno_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "beleg" ADD COLUMN "storno_von" text;--> statement-breakpoint
ALTER TABLE "beleg" ADD COLUMN "storno_grund" text;--> statement-breakpoint
CREATE UNIQUE INDEX "beleg_bezug_uq" ON "beleg" USING btree ("art","bezug_art","bezug_id") WHERE "beleg"."storno_am" IS NULL;--> statement-breakpoint
ALTER TABLE "beleg" ADD CONSTRAINT "beleg_storno_angaben" CHECK (("beleg"."storno_am" IS NULL) = ("beleg"."storno_von" IS NULL) AND ("beleg"."storno_am" IS NULL) = ("beleg"."storno_grund" IS NULL) AND ("beleg"."storno_am" IS NULL OR "beleg"."belegnummer" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "beleg" ADD CONSTRAINT "beleg_nummer_status" CHECK (("beleg"."belegnummer" IS NOT NULL) = ("beleg"."status"::text IN ('freigegeben', 'storniert')));--> statement-breakpoint
-- Ein freigegebener Beleg wird nie geändert oder gelöscht; einzig zulässig ist seine Stornierung (Status, Zeitpunkt, Person und Grund,
-- alles andere gleich). Ein stornierter Beleg ändert sich danach nicht mehr.
CREATE OR REPLACE FUNCTION beleg_freigegeben_schutz() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'storniert' THEN
    RAISE EXCEPTION 'Ein stornierter Beleg wird nie geändert oder gelöscht (% auf beleg)', TG_OP;
  END IF;
  IF OLD.status = 'freigegeben' THEN
    IF TG_OP = 'UPDATE' AND NEW.status = 'storniert' AND NEW.storno_am IS NOT NULL
       AND (to_jsonb(NEW) - 'status' - 'storno_am' - 'storno_von' - 'storno_grund') = (to_jsonb(OLD) - 'status' - 'storno_am' - 'storno_von' - 'storno_grund') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Ein freigegebener Beleg wird nie geändert oder gelöscht (% auf beleg)', TG_OP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;