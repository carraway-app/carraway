CREATE TABLE "beleg_art_eigen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"basis_art" "beleg_art" NOT NULL,
	"bezeichnung_de" text NOT NULL,
	"bezeichnung_en" text NOT NULL,
	"aktiv" boolean DEFAULT true NOT NULL,
	"erstellt_von" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "beleg_bezug_uq";--> statement-breakpoint
DROP INDEX "beleg_vorlage_fonds_art_uq";--> statement-breakpoint
ALTER TABLE "beleg" ADD COLUMN "eigene_art_id" uuid;--> statement-breakpoint
ALTER TABLE "beleg_vorlage" ADD COLUMN "eigene_art_id" uuid;--> statement-breakpoint
ALTER TABLE "beleg_art_eigen" ADD CONSTRAINT "beleg_art_eigen_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "beleg_art_eigen_name_uq" ON "beleg_art_eigen" USING btree ("fonds_id","bezeichnung_de");--> statement-breakpoint
ALTER TABLE "beleg" ADD CONSTRAINT "beleg_eigene_art_id_beleg_art_eigen_id_fk" FOREIGN KEY ("eigene_art_id") REFERENCES "public"."beleg_art_eigen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beleg_vorlage" ADD CONSTRAINT "beleg_vorlage_eigene_art_id_beleg_art_eigen_id_fk" FOREIGN KEY ("eigene_art_id") REFERENCES "public"."beleg_art_eigen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "beleg_bezug_eigene_uq" ON "beleg" USING btree ("eigene_art_id","bezug_art","bezug_id") WHERE "beleg"."storno_am" IS NULL AND "beleg"."eigene_art_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "beleg_vorlage_eigene_art_uq" ON "beleg_vorlage" USING btree ("fonds_id","eigene_art_id") WHERE "beleg_vorlage"."eigene_art_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "beleg_bezug_uq" ON "beleg" USING btree ("art","bezug_art","bezug_id") WHERE "beleg"."storno_am" IS NULL AND "beleg"."eigene_art_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "beleg_vorlage_fonds_art_uq" ON "beleg_vorlage" USING btree ("fonds_id","art") WHERE "beleg_vorlage"."eigene_art_id" IS NULL;