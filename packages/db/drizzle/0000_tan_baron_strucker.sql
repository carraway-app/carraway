CREATE TYPE "public"."aktivitaet_art" AS ENUM('gespraech', 'termin', 'notiz', 'mail');--> statement-breakpoint
CREATE TYPE "public"."beschluss_ergebnis" AS ENUM('zugestimmt', 'abgelehnt', 'vertagt');--> statement-breakpoint
CREATE TYPE "public"."beteiligung_status" AS ENUM('aktiv', 'exit', 'insolvent', 'abgeschrieben');--> statement-breakpoint
CREATE TYPE "public"."bewertung_methode" AS ENUM('anschaffungskosten', 'letzte_runde', 'multiplikator', 'dcf', 'sonstige');--> statement-breakpoint
CREATE TYPE "public"."deal_phase" AS ENUM('anfrage', 'erstgespraech', 'pruefung', 'due_diligence', 'investitionsausschuss', 'closing');--> statement-breakpoint
CREATE TYPE "public"."deal_status" AS ENUM('offen', 'abgesagt', 'investiert');--> statement-breakpoint
CREATE TYPE "public"."fonds_bewegung_art" AS ENUM('abruf', 'ausschuettung');--> statement-breakpoint
CREATE TYPE "public"."instrument" AS ENUM('offene_beteiligung', 'stille_beteiligung', 'darlehen', 'wandeldarlehen');--> statement-breakpoint
CREATE TYPE "public"."organisation_art" AS ENUM('unternehmen', 'investor', 'berater', 'sonstige');--> statement-breakpoint
CREATE TYPE "public"."vorgang_art" AS ENUM('zusage', 'auszahlung', 'rueckfluss', 'zins', 'tilgung', 'wertberichtigung');--> statement-breakpoint
CREATE TABLE "aktivitaet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"art" "aktivitaet_art" NOT NULL,
	"datum" date NOT NULL,
	"titel" text NOT NULL,
	"notiz" text,
	"organisation_id" uuid,
	"person_id" uuid,
	"deal_id" uuid,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beschluss" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"gremium" text NOT NULL,
	"datum" date NOT NULL,
	"ergebnis" "beschluss_ergebnis" NOT NULL,
	"betrag" numeric(18, 2),
	"auflagen" text,
	"protokoll" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beteiligung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"deal_id" uuid,
	"instrument" "instrument" NOT NULL,
	"erstinvestment" date NOT NULL,
	"status" "beteiligung_status" DEFAULT 'aktiv' NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bewertung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beteiligung_id" uuid NOT NULL,
	"stichtag" date NOT NULL,
	"wert" numeric(18, 2) NOT NULL,
	"methode" "bewertung_methode" NOT NULL,
	"begruendung" text,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"fonds_id" uuid,
	"titel" text NOT NULL,
	"phase" "deal_phase" DEFAULT 'anfrage' NOT NULL,
	"status" "deal_status" DEFAULT 'offen' NOT NULL,
	"quelle" text,
	"ticket" numeric(18, 2),
	"betreuung" text,
	"absagegrund" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"aktualisiert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_phasenwechsel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"von_phase" "deal_phase",
	"nach_phase" "deal_phase" NOT NULL,
	"am" date NOT NULL,
	"bemerkung" text
);
--> statement-breakpoint
CREATE TABLE "fonds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kurzname" text NOT NULL,
	"vintage" integer NOT NULL,
	"zeichnungskapital" numeric(18, 2) NOT NULL,
	"waehrung" text DEFAULT 'EUR' NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fonds_kurzname_unique" UNIQUE("kurzname")
);
--> statement-breakpoint
CREATE TABLE "fonds_bewegung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"art" "fonds_bewegung_art" NOT NULL,
	"valuta" date NOT NULL,
	"betrag" numeric(18, 2) NOT NULL,
	"bemerkung" text,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"art" "organisation_art" NOT NULL,
	"sektor" text,
	"ort" text,
	"website" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vorname" text NOT NULL,
	"nachname" text NOT NULL,
	"email" text,
	"funktion" text,
	"organisation_id" uuid,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vorgang" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beteiligung_id" uuid NOT NULL,
	"art" "vorgang_art" NOT NULL,
	"valuta" date NOT NULL,
	"betrag" numeric(18, 2) NOT NULL,
	"bemerkung" text,
	"storniert_vorgang_id" uuid,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aktivitaet" ADD CONSTRAINT "aktivitaet_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aktivitaet" ADD CONSTRAINT "aktivitaet_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aktivitaet" ADD CONSTRAINT "aktivitaet_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beschluss" ADD CONSTRAINT "beschluss_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beteiligung" ADD CONSTRAINT "beteiligung_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beteiligung" ADD CONSTRAINT "beteiligung_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beteiligung" ADD CONSTRAINT "beteiligung_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bewertung" ADD CONSTRAINT "bewertung_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_phasenwechsel" ADD CONSTRAINT "deal_phasenwechsel_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonds_bewegung" ADD CONSTRAINT "fonds_bewegung_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vorgang" ADD CONSTRAINT "vorgang_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vorgang" ADD CONSTRAINT "vorgang_storniert_vorgang_id_vorgang_id_fk" FOREIGN KEY ("storniert_vorgang_id") REFERENCES "public"."vorgang"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aktivitaet_deal_idx" ON "aktivitaet" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "aktivitaet_organisation_idx" ON "aktivitaet" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "beschluss_deal_idx" ON "beschluss" USING btree ("deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "beteiligung_fonds_organisation_instrument_uq" ON "beteiligung" USING btree ("fonds_id","organisation_id","instrument");--> statement-breakpoint
CREATE INDEX "beteiligung_organisation_idx" ON "beteiligung" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bewertung_beteiligung_stichtag_uq" ON "bewertung" USING btree ("beteiligung_id","stichtag");--> statement-breakpoint
CREATE INDEX "deal_phase_status_idx" ON "deal" USING btree ("status","phase");--> statement-breakpoint
CREATE INDEX "deal_organisation_idx" ON "deal" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "deal_phasenwechsel_deal_idx" ON "deal_phasenwechsel" USING btree ("deal_id","am");--> statement-breakpoint
CREATE INDEX "fonds_bewegung_fonds_valuta_idx" ON "fonds_bewegung" USING btree ("fonds_id","valuta");--> statement-breakpoint
CREATE INDEX "organisation_name_idx" ON "organisation" USING btree ("name");--> statement-breakpoint
CREATE INDEX "person_organisation_idx" ON "person" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "vorgang_beteiligung_valuta_idx" ON "vorgang" USING btree ("beteiligung_id","valuta");--> statement-breakpoint
CREATE UNIQUE INDEX "vorgang_storno_uq" ON "vorgang" USING btree ("storniert_vorgang_id");