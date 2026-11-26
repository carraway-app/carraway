CREATE TYPE "public"."zielfonds_bewegung_art" AS ENUM('zusage', 'abruf', 'ausschuettung');--> statement-breakpoint
CREATE TABLE "manager_profil" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text,
	"hauswaehrung" text DEFAULT 'EUR' NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manager_profil_eine_zeile" CHECK ("manager_profil"."id" = 1),
	CONSTRAINT "manager_profil_hauswaehrung" CHECK ("manager_profil"."hauswaehrung" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "zielfonds_beteiligung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"name" text NOT NULL,
	"zielfonds_id" uuid,
	"organisation_id" uuid,
	"investor_organisation_id" uuid,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zielfonds_beteiligung_nicht_selbst" CHECK ("zielfonds_beteiligung"."zielfonds_id" IS NULL OR "zielfonds_beteiligung"."zielfonds_id" <> "zielfonds_beteiligung"."fonds_id"),
	CONSTRAINT "zielfonds_beteiligung_investor" CHECK ("zielfonds_beteiligung"."investor_organisation_id" IS NULL OR "zielfonds_beteiligung"."zielfonds_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "zielfonds_bewegung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beteiligung_id" uuid NOT NULL,
	"art" "zielfonds_bewegung_art" NOT NULL,
	"valuta" date NOT NULL,
	"betrag" numeric(18, 2) NOT NULL,
	"bemerkung" text,
	"storniert_bewegung_id" uuid,
	"erfasst_von" text NOT NULL,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zielfonds_bewegung_vorzeichen" CHECK (("zielfonds_bewegung"."storniert_bewegung_id" IS NULL AND "zielfonds_bewegung"."betrag" > 0) OR ("zielfonds_bewegung"."storniert_bewegung_id" IS NOT NULL AND "zielfonds_bewegung"."betrag" < 0))
);
--> statement-breakpoint
CREATE TABLE "zielfonds_meldung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beteiligung_id" uuid NOT NULL,
	"stichtag" date NOT NULL,
	"nav" numeric(18, 2),
	"anteil" numeric(12, 10),
	"bemerkung" text,
	"erfasst_von" text NOT NULL,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zielfonds_meldung_inhalt" CHECK ("zielfonds_meldung"."nav" IS NOT NULL OR "zielfonds_meldung"."anteil" IS NOT NULL),
	CONSTRAINT "zielfonds_meldung_anteil" CHECK ("zielfonds_meldung"."anteil" IS NULL OR ("zielfonds_meldung"."anteil" > 0 AND "zielfonds_meldung"."anteil" <= 1))
);
--> statement-breakpoint
ALTER TABLE "zielfonds_beteiligung" ADD CONSTRAINT "zielfonds_beteiligung_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zielfonds_beteiligung" ADD CONSTRAINT "zielfonds_beteiligung_zielfonds_id_fonds_id_fk" FOREIGN KEY ("zielfonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zielfonds_beteiligung" ADD CONSTRAINT "zielfonds_beteiligung_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zielfonds_beteiligung" ADD CONSTRAINT "zielfonds_beteiligung_investor_organisation_id_organisation_id_fk" FOREIGN KEY ("investor_organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zielfonds_bewegung" ADD CONSTRAINT "zielfonds_bewegung_beteiligung_id_zielfonds_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."zielfonds_beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zielfonds_bewegung" ADD CONSTRAINT "zielfonds_bewegung_storniert_bewegung_id_zielfonds_bewegung_id_fk" FOREIGN KEY ("storniert_bewegung_id") REFERENCES "public"."zielfonds_bewegung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zielfonds_meldung" ADD CONSTRAINT "zielfonds_meldung_beteiligung_id_zielfonds_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."zielfonds_beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "zielfonds_beteiligung_fonds_idx" ON "zielfonds_beteiligung" USING btree ("fonds_id");--> statement-breakpoint
CREATE INDEX "zielfonds_beteiligung_ziel_idx" ON "zielfonds_beteiligung" USING btree ("zielfonds_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zielfonds_beteiligung_ziel_uq" ON "zielfonds_beteiligung" USING btree ("fonds_id","zielfonds_id");--> statement-breakpoint
CREATE INDEX "zielfonds_bewegung_beteiligung_idx" ON "zielfonds_bewegung" USING btree ("beteiligung_id","valuta");--> statement-breakpoint
CREATE UNIQUE INDEX "zielfonds_bewegung_storno_uq" ON "zielfonds_bewegung" USING btree ("storniert_bewegung_id");--> statement-breakpoint
CREATE INDEX "zielfonds_meldung_beteiligung_idx" ON "zielfonds_meldung" USING btree ("beteiligung_id","stichtag");--> statement-breakpoint
-- Bewegungen und Meldungen der Zielfonds sind unveränderlich: Korrektur per Storno bzw. neuer Meldung. TRUNCATE bleibt erlaubt (Demo, Tests).
CREATE FUNCTION zielfonds_unveraenderlich() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Zeilen in % bleiben unveränderlich (%); Korrektur per Storno oder neuer Meldung', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER zielfonds_bewegung_unveraenderlich BEFORE UPDATE OR DELETE ON zielfonds_bewegung
  FOR EACH ROW EXECUTE FUNCTION zielfonds_unveraenderlich();--> statement-breakpoint
CREATE TRIGGER zielfonds_meldung_unveraenderlich BEFORE UPDATE OR DELETE ON zielfonds_meldung
  FOR EACH ROW EXECUTE FUNCTION zielfonds_unveraenderlich();--> statement-breakpoint
-- Ein Storno gleicht genau eine nicht stornierte Bewegung derselben Beteiligung und Art mit negiertem Betrag aus.
CREATE FUNCTION zielfonds_bewegung_storno_pruefen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.storniert_bewegung_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM zielfonds_bewegung o WHERE o.id = NEW.storniert_bewegung_id AND o.storniert_bewegung_id IS NULL
      AND o.beteiligung_id = NEW.beteiligung_id AND o.art = NEW.art AND o.betrag = -NEW.betrag
  ) THEN
    RAISE EXCEPTION 'Das Storno muss eine Bewegung derselben Zielfondsbeteiligung und Art mit negiertem Betrag ausgleichen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER zielfonds_bewegung_storno BEFORE INSERT ON zielfonds_bewegung
  FOR EACH ROW EXECUTE FUNCTION zielfonds_bewegung_storno_pruefen();--> statement-breakpoint
-- Neue Bewegungen und Meldungen ändern die NAV des Dachfonds: Snapshots neu rechnen.
CREATE FUNCTION zielfonds_snapshot_auftrag() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO snapshot_auftrag (fonds_id)
    SELECT DISTINCT b.fonds_id FROM neu JOIN zielfonds_beteiligung b ON b.id = neu.beteiligung_id
    ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER zielfonds_bewegung_snapshot AFTER INSERT ON zielfonds_bewegung
  REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION zielfonds_snapshot_auftrag();--> statement-breakpoint
CREATE TRIGGER zielfonds_meldung_snapshot AFTER INSERT ON zielfonds_meldung
  REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION zielfonds_snapshot_auftrag();