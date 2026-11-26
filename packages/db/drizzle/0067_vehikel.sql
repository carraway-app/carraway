CREATE TYPE "public"."vehikel_art" AS ENUM('fonds', 'gesellschaft', 'spv', 'sonstige');--> statement-breakpoint
CREATE TYPE "public"."vehikel_status" AS ENUM('aktiv', 'in_liquidation', 'aufgeloest');--> statement-breakpoint
CREATE TABLE "vehikel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"art" "vehikel_art" DEFAULT 'fonds' NOT NULL,
	"auflagejahr" integer,
	"status" "vehikel_status" DEFAULT 'aktiv' NOT NULL,
	"standard" boolean DEFAULT false NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehikel_auflagejahr" CHECK ("vehikel"."auflagejahr" IS NULL OR "vehikel"."auflagejahr" BETWEEN 1900 AND 2100)
);
--> statement-breakpoint
ALTER TABLE "rundenposition" DROP CONSTRAINT "rundenposition_ein_investor";--> statement-breakpoint
ALTER TABLE "rundenposition" DROP CONSTRAINT "rundenposition_organisation_id_organisation_id_fk";
--> statement-breakpoint
ALTER TABLE "rundenposition" ADD COLUMN "vehikel_id" uuid;--> statement-breakpoint
ALTER TABLE "vehikel" ADD CONSTRAINT "vehikel_investor_id_organisation_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vehikel_investor_name_uq" ON "vehikel" USING btree ("investor_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "vehikel_standard_uq" ON "vehikel" USING btree ("investor_id") WHERE "vehikel"."standard";--> statement-breakpoint
ALTER TABLE "rundenposition" ADD CONSTRAINT "rundenposition_vehikel_id_vehikel_id_fk" FOREIGN KEY ("vehikel_id") REFERENCES "public"."vehikel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rundenposition_vehikel_idx" ON "rundenposition" USING btree ("vehikel_id");--> statement-breakpoint
-- Bestand: je Organisation mit Positionen ein Standard-Vehikel mit ihrem Namen; jede Position zeigt danach auf das Vehikel ihrer bisherigen Organisation.
INSERT INTO "vehikel" ("investor_id", "name", "standard")
SELECT o."id", o."name", true
FROM "organisation" o
WHERE o."id" IN (SELECT DISTINCT "organisation_id" FROM "rundenposition" WHERE "organisation_id" IS NOT NULL);--> statement-breakpoint
UPDATE "rundenposition" p SET "vehikel_id" = v."id"
FROM "vehikel" v
WHERE v."investor_id" = p."organisation_id" AND v."standard";--> statement-breakpoint
ALTER TABLE "rundenposition" DROP COLUMN "organisation_id";--> statement-breakpoint
ALTER TABLE "rundenposition" ADD CONSTRAINT "rundenposition_ein_investor" CHECK (("rundenposition"."fonds_id" IS NULL) <> ("rundenposition"."vehikel_id" IS NULL));