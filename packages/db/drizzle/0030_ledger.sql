CREATE TYPE "public"."runde_status" AS ENUM('entwurf', 'abgeschlossen');--> statement-breakpoint
CREATE TYPE "public"."runden_zahlung_art" AS ENUM('einzahlung', 'rueckzahlung');--> statement-breakpoint
CREATE TABLE "runde_buchung" (
	"vorgang_id" uuid PRIMARY KEY NOT NULL,
	"runde_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"art" "vorgang_art" NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rundenposition_zahlung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"datum" date NOT NULL,
	"art" "runden_zahlung_art" NOT NULL,
	"betrag" numeric(18, 2) NOT NULL,
	"bemerkung" text,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rundenposition_zahlung_betrag_positiv" CHECK ("rundenposition_zahlung"."betrag" > 0)
);
--> statement-breakpoint
ALTER TABLE "finanzierungsrunde" ADD COLUMN "status" "runde_status" DEFAULT 'abgeschlossen' NOT NULL;--> statement-breakpoint
ALTER TABLE "finanzierungsrunde" ADD COLUMN "abgeschlossen_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "finanzierungsrunde" ADD COLUMN "abgeschlossen_von" text;--> statement-breakpoint
ALTER TABLE "finanzierungsrunde" ADD COLUMN "wiedergeoeffnet_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "finanzierungsrunde" ADD COLUMN "wiedergeoeffnet_von" text;--> statement-breakpoint
ALTER TABLE "finanzierungsrunde" ADD COLUMN "wiedereroeffnung_grund" text;--> statement-breakpoint
ALTER TABLE "fonds_bewegung" ADD COLUMN "storniert_bewegung_id" uuid;--> statement-breakpoint
ALTER TABLE "runde_buchung" ADD CONSTRAINT "runde_buchung_vorgang_id_vorgang_id_fk" FOREIGN KEY ("vorgang_id") REFERENCES "public"."vorgang"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runde_buchung" ADD CONSTRAINT "runde_buchung_runde_id_finanzierungsrunde_id_fk" FOREIGN KEY ("runde_id") REFERENCES "public"."finanzierungsrunde"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runde_buchung" ADD CONSTRAINT "runde_buchung_position_id_rundenposition_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."rundenposition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rundenposition_zahlung" ADD CONSTRAINT "rundenposition_zahlung_position_id_rundenposition_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."rundenposition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runde_buchung_runde_idx" ON "runde_buchung" USING btree ("runde_id");--> statement-breakpoint
CREATE INDEX "runde_buchung_position_idx" ON "runde_buchung" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "rundenposition_zahlung_position_idx" ON "rundenposition_zahlung" USING btree ("position_id","datum");--> statement-breakpoint
ALTER TABLE "fonds_bewegung" ADD CONSTRAINT "fonds_bewegung_storniert_bewegung_id_fonds_bewegung_id_fk" FOREIGN KEY ("storniert_bewegung_id") REFERENCES "public"."fonds_bewegung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fonds_bewegung_storno_uq" ON "fonds_bewegung" USING btree ("storniert_bewegung_id");--> statement-breakpoint
CREATE INDEX "vorgang_valuta_idx" ON "vorgang" USING btree ("valuta","erfasst_am","id");--> statement-breakpoint
ALTER TABLE "fonds_bewegung" ADD CONSTRAINT "fonds_bewegung_betrag_nicht_null" CHECK ("fonds_bewegung"."betrag" <> 0);