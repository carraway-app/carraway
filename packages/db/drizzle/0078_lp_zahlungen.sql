CREATE TABLE "abruf_anteil" (
	"bewegung_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"betrag" numeric(18, 2) NOT NULL,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "abruf_anteil_bewegung_id_organisation_id_pk" PRIMARY KEY("bewegung_id","organisation_id"),
	CONSTRAINT "abruf_anteil_nicht_negativ" CHECK ("abruf_anteil"."betrag" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lp_zahlung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bewegung_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"valuta" date NOT NULL,
	"betrag" numeric(18, 2) NOT NULL,
	"belegreferenz" text,
	"grund" text,
	"storniert_zahlung_id" uuid,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lp_zahlung_vorzeichen" CHECK (("lp_zahlung"."storniert_zahlung_id" IS NULL AND "lp_zahlung"."betrag" > 0) OR ("lp_zahlung"."storniert_zahlung_id" IS NOT NULL AND "lp_zahlung"."betrag" < 0 AND "lp_zahlung"."grund" IS NOT NULL AND length(trim("lp_zahlung"."grund")) > 0))
);
--> statement-breakpoint
ALTER TABLE "fonds_bewegung" ADD COLUMN "faellig_am" date;--> statement-breakpoint
ALTER TABLE "abruf_anteil" ADD CONSTRAINT "abruf_anteil_bewegung_id_fonds_bewegung_id_fk" FOREIGN KEY ("bewegung_id") REFERENCES "public"."fonds_bewegung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abruf_anteil" ADD CONSTRAINT "abruf_anteil_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lp_zahlung" ADD CONSTRAINT "lp_zahlung_storniert_zahlung_id_lp_zahlung_id_fk" FOREIGN KEY ("storniert_zahlung_id") REFERENCES "public"."lp_zahlung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lp_zahlung" ADD CONSTRAINT "lp_zahlung_anteil_fk" FOREIGN KEY ("bewegung_id","organisation_id") REFERENCES "public"."abruf_anteil"("bewegung_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lp_zahlung_abruf_idx" ON "lp_zahlung" USING btree ("bewegung_id","organisation_id","valuta");--> statement-breakpoint
CREATE UNIQUE INDEX "lp_zahlung_storno_uq" ON "lp_zahlung" USING btree ("storniert_zahlung_id");--> statement-breakpoint
ALTER TABLE "fonds_bewegung" ADD CONSTRAINT "fonds_bewegung_faelligkeit" CHECK ("fonds_bewegung"."faellig_am" IS NULL OR ("fonds_bewegung"."art" = 'abruf' AND "fonds_bewegung"."storniert_bewegung_id" IS NULL AND "fonds_bewegung"."faellig_am" >= "fonds_bewegung"."valuta"));--> statement-breakpoint
CREATE FUNCTION lp_buchung_unveraenderlich() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Buchungen in % bleiben unveränderlich', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER abruf_anteil_unveraenderlich BEFORE UPDATE OR DELETE ON abruf_anteil
  FOR EACH ROW EXECUTE FUNCTION lp_buchung_unveraenderlich();--> statement-breakpoint
CREATE TRIGGER lp_zahlung_unveraenderlich BEFORE UPDATE OR DELETE ON lp_zahlung
  FOR EACH ROW EXECUTE FUNCTION lp_buchung_unveraenderlich();--> statement-breakpoint
CREATE FUNCTION lp_zahlung_snapshot_auftrag() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO snapshot_auftrag (fonds_id)
    SELECT DISTINCT b.fonds_id FROM neu JOIN fonds_bewegung b ON b.id = neu.bewegung_id
    ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER lp_zahlung_snapshot AFTER INSERT ON lp_zahlung
  REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION lp_zahlung_snapshot_auftrag();--> statement-breakpoint
CREATE FUNCTION lp_zahlung_storno_pruefen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM lp_zahlung z WHERE z.id = NEW.storniert_zahlung_id
      AND z.storniert_zahlung_id IS NULL AND z.bewegung_id = NEW.bewegung_id
      AND z.organisation_id = NEW.organisation_id AND z.betrag = -NEW.betrag AND z.valuta <= NEW.valuta
  ) THEN
    RAISE EXCEPTION 'Das Storno muss die ursprüngliche Einzahlung zum selben Abruf und Investor ausgleichen'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER lp_zahlung_storno_pruefen BEFORE INSERT ON lp_zahlung
  FOR EACH ROW WHEN (NEW.storniert_zahlung_id IS NOT NULL) EXECUTE FUNCTION lp_zahlung_storno_pruefen();
