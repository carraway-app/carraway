CREATE TYPE "public"."beziehung_art" AS ENUM('co_investor', 'berater', 'investor', 'sonstige');--> statement-breakpoint
CREATE TYPE "public"."kontakt_rolle" AS ENUM('gruender', 'geschaeftsfuehrung', 'co_investor', 'berater', 'investor_lp', 'sonstige');--> statement-breakpoint
CREATE TABLE "beschlussvorlage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"name" text NOT NULL,
	"text" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"aktualisiert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kontaktrolle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"rolle" "kontakt_rolle" NOT NULL,
	"von" date,
	"bis" date,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kontaktrolle_zeitraum" CHECK ("kontaktrolle"."von" IS NULL OR "kontaktrolle"."bis" IS NULL OR "kontaktrolle"."bis" >= "kontaktrolle"."von")
);
--> statement-breakpoint
CREATE TABLE "organisationsbeziehung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"von_organisation_id" uuid NOT NULL,
	"zu_organisation_id" uuid,
	"fonds_id" uuid,
	"art" "beziehung_art" NOT NULL,
	"bemerkung" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisationsbeziehung_ein_ziel" CHECK (("organisationsbeziehung"."zu_organisation_id" IS NULL) <> ("organisationsbeziehung"."fonds_id" IS NULL)),
	CONSTRAINT "organisationsbeziehung_nicht_selbst" CHECK ("organisationsbeziehung"."zu_organisation_id" IS NULL OR "organisationsbeziehung"."zu_organisation_id" <> "organisationsbeziehung"."von_organisation_id")
);
--> statement-breakpoint
ALTER TABLE "aktivitaet" ADD COLUMN "zustaendig" uuid;--> statement-breakpoint
ALTER TABLE "organisation" ADD COLUMN "zusammengefuehrt_in" uuid;--> statement-breakpoint
ALTER TABLE "organisation" ADD COLUMN "zusammengefuehrt_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "zusammengefuehrt_in" uuid;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "zusammengefuehrt_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "beschlussvorlage" ADD CONSTRAINT "beschlussvorlage_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontaktrolle" ADD CONSTRAINT "kontaktrolle_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontaktrolle" ADD CONSTRAINT "kontaktrolle_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisationsbeziehung" ADD CONSTRAINT "organisationsbeziehung_von_organisation_id_organisation_id_fk" FOREIGN KEY ("von_organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisationsbeziehung" ADD CONSTRAINT "organisationsbeziehung_zu_organisation_id_organisation_id_fk" FOREIGN KEY ("zu_organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisationsbeziehung" ADD CONSTRAINT "organisationsbeziehung_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "beschlussvorlage_fonds_name_uq" ON "beschlussvorlage" USING btree ("fonds_id","name");--> statement-breakpoint
CREATE INDEX "kontaktrolle_person_idx" ON "kontaktrolle" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "kontaktrolle_organisation_idx" ON "kontaktrolle" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "organisationsbeziehung_von_idx" ON "organisationsbeziehung" USING btree ("von_organisation_id");--> statement-breakpoint
CREATE INDEX "organisationsbeziehung_zu_idx" ON "organisationsbeziehung" USING btree ("zu_organisation_id");--> statement-breakpoint
ALTER TABLE "aktivitaet" ADD CONSTRAINT "aktivitaet_zustaendig_benutzer_id_fk" FOREIGN KEY ("zustaendig") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation" ADD CONSTRAINT "organisation_zusammengefuehrt_in_organisation_id_fk" FOREIGN KEY ("zusammengefuehrt_in") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_zusammengefuehrt_in_person_id_fk" FOREIGN KEY ("zusammengefuehrt_in") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aktivitaet_zustaendig_idx" ON "aktivitaet" USING btree ("zustaendig");