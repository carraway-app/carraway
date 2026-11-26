CREATE TYPE "public"."runden_rolle" AS ENUM('lead', 'co_lead', 'co');--> statement-breakpoint
CREATE TABLE "finanzierungsrunde" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"bezeichnung" text NOT NULL,
	"datum" date NOT NULL,
	"pre_money" numeric(18, 2) NOT NULL,
	"post_money" numeric(18, 2) NOT NULL,
	"preis_je_anteil" numeric(18, 4) NOT NULL,
	"anteile_gesamt_nach" numeric(18, 0) NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kennzahl_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"stichtag" date NOT NULL,
	"stand_bis" timestamp with time zone,
	"berechnet_am" timestamp with time zone DEFAULT now() NOT NULL,
	"daten" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rundenposition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"runde_id" uuid NOT NULL,
	"fonds_id" uuid,
	"organisation_id" uuid,
	"betrag" numeric(18, 2) NOT NULL,
	"anteile" numeric(18, 0) NOT NULL,
	"rolle" "runden_rolle" NOT NULL,
	CONSTRAINT "rundenposition_ein_investor" CHECK (("rundenposition"."fonds_id" IS NULL) <> ("rundenposition"."organisation_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "snapshot_auftrag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"stichtag" date,
	"angelegt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finanzierungsrunde" ADD CONSTRAINT "finanzierungsrunde_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kennzahl_snapshot" ADD CONSTRAINT "kennzahl_snapshot_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rundenposition" ADD CONSTRAINT "rundenposition_runde_id_finanzierungsrunde_id_fk" FOREIGN KEY ("runde_id") REFERENCES "public"."finanzierungsrunde"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rundenposition" ADD CONSTRAINT "rundenposition_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rundenposition" ADD CONSTRAINT "rundenposition_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_auftrag" ADD CONSTRAINT "snapshot_auftrag_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finanzierungsrunde_organisation_idx" ON "finanzierungsrunde" USING btree ("organisation_id","datum");--> statement-breakpoint
CREATE UNIQUE INDEX "kennzahl_snapshot_fonds_stichtag_uq" ON "kennzahl_snapshot" USING btree ("fonds_id","stichtag");--> statement-breakpoint
CREATE INDEX "rundenposition_runde_idx" ON "rundenposition" USING btree ("runde_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_auftrag_alle_uq" ON "snapshot_auftrag" USING btree ("fonds_id") WHERE "snapshot_auftrag"."stichtag" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_auftrag_stichtag_uq" ON "snapshot_auftrag" USING btree ("fonds_id","stichtag") WHERE "snapshot_auftrag"."stichtag" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "bewertung_beteiligung_erfasst_idx" ON "bewertung" USING btree ("beteiligung_id","erfasst_am");--> statement-breakpoint
CREATE INDEX "fonds_bewegung_fonds_erfasst_idx" ON "fonds_bewegung" USING btree ("fonds_id","erfasst_am");--> statement-breakpoint
CREATE INDEX "vorgang_beteiligung_erfasst_idx" ON "vorgang" USING btree ("beteiligung_id","erfasst_am");