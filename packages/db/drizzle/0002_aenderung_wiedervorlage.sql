CREATE TABLE "aenderung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"am" timestamp with time zone DEFAULT now() NOT NULL,
	"akteur" text NOT NULL,
	"aktion" text NOT NULL,
	"tabelle" text NOT NULL,
	"datensatz_id" uuid NOT NULL,
	"vorher" jsonb,
	"nachher" jsonb
);
--> statement-breakpoint
ALTER TABLE "aktivitaet" ADD COLUMN "wiedervorlage" date;--> statement-breakpoint
ALTER TABLE "aktivitaet" ADD COLUMN "wiedervorlage_erledigt_am" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "aenderung_datensatz_idx" ON "aenderung" USING btree ("tabelle","datensatz_id","am");--> statement-breakpoint
CREATE INDEX "aenderung_am_idx" ON "aenderung" USING btree ("am");--> statement-breakpoint
CREATE INDEX "aktivitaet_wiedervorlage_idx" ON "aktivitaet" USING btree ("wiedervorlage");