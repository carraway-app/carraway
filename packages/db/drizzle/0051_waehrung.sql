-- Währungssicht (Etappe 21): Kurstabelle (nur anhängend), lokale Währung der Beteiligung, lokale Beträge mit festgehaltenem Kurs an Vorgängen und Bewertungen.
CREATE TYPE "public"."kurs_quelle" AS ENUM('manuell', 'import');--> statement-breakpoint
CREATE TABLE "wechselkurs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"datum" date NOT NULL,
	"basis" text NOT NULL,
	"quote" text NOT NULL,
	"kurs" numeric(20, 8) NOT NULL,
	"quelle" "kurs_quelle" NOT NULL,
	"quelle_datei" text,
	"korrigiert_kurs_id" uuid,
	"grund" text,
	"erfasst_von" text DEFAULT 'system' NOT NULL,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wechselkurs_codes" CHECK ("wechselkurs"."basis" ~ '^[A-Z]{3}$' AND "wechselkurs"."quote" ~ '^[A-Z]{3}$' AND "wechselkurs"."basis" <> "wechselkurs"."quote"),
	CONSTRAINT "wechselkurs_positiv" CHECK ("wechselkurs"."kurs" > 0)
);
--> statement-breakpoint
ALTER TABLE "beteiligung" ADD COLUMN "waehrung" text;--> statement-breakpoint
ALTER TABLE "bewertung" ADD COLUMN "wert_lokal" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "bewertung" ADD COLUMN "kurs" numeric(24, 12);--> statement-breakpoint
ALTER TABLE "bewertung" ADD COLUMN "kurs_id" uuid;--> statement-breakpoint
ALTER TABLE "vorgang" ADD COLUMN "betrag_lokal" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "vorgang" ADD COLUMN "kurs" numeric(24, 12);--> statement-breakpoint
ALTER TABLE "vorgang" ADD COLUMN "kurs_id" uuid;--> statement-breakpoint
ALTER TABLE "wechselkurs" ADD CONSTRAINT "wechselkurs_korrigiert_kurs_id_wechselkurs_id_fk" FOREIGN KEY ("korrigiert_kurs_id") REFERENCES "public"."wechselkurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wechselkurs_paar_idx" ON "wechselkurs" USING btree ("basis","quote","datum","erfasst_am");--> statement-breakpoint
CREATE INDEX "wechselkurs_erfasst_idx" ON "wechselkurs" USING btree ("erfasst_am");--> statement-breakpoint
ALTER TABLE "bewertung" ADD CONSTRAINT "bewertung_kurs_id_wechselkurs_id_fk" FOREIGN KEY ("kurs_id") REFERENCES "public"."wechselkurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vorgang" ADD CONSTRAINT "vorgang_kurs_id_wechselkurs_id_fk" FOREIGN KEY ("kurs_id") REFERENCES "public"."wechselkurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beteiligung" ADD CONSTRAINT "beteiligung_waehrung" CHECK ("beteiligung"."waehrung" IS NULL OR "beteiligung"."waehrung" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "bewertung" ADD CONSTRAINT "bewertung_lokal" CHECK (("bewertung"."wert_lokal" IS NULL) = ("bewertung"."kurs" IS NULL));--> statement-breakpoint
ALTER TABLE "vorgang" ADD CONSTRAINT "vorgang_lokal" CHECK (("vorgang"."betrag_lokal" IS NULL) = ("vorgang"."kurs" IS NULL));--> statement-breakpoint
-- Wechselkurse sind unveränderlich: Eine Korrektur ist ein neuer Eintrag für denselben Tag und dasselbe Paar.
CREATE FUNCTION wechselkurs_unveraenderlich() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Wechselkurse sind unveränderlich (% auf wechselkurs); Korrektur nur als neuer Eintrag', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER wechselkurs_kein_update_delete BEFORE UPDATE OR DELETE ON "wechselkurs"
  FOR EACH ROW EXECUTE FUNCTION wechselkurs_unveraenderlich();
