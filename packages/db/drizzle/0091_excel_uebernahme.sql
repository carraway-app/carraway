CREATE TABLE "excel_uebernahme" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schluessel_id" uuid NOT NULL,
	"benutzer_id" uuid NOT NULL,
	"benutzer_name" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"eingabe" jsonb NOT NULL,
	"vorschau" jsonb NOT NULL,
	"uebernommen_am" timestamp with time zone,
	"uebernommen_von" uuid,
	"uebernommen_von_name" text,
	"ergebnis" jsonb
);
--> statement-breakpoint
ALTER TABLE "werte_schluessel" ADD COLUMN "darf_schreiben" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "excel_uebernahme_schluessel_idx" ON "excel_uebernahme" USING btree ("schluessel_id","erstellt_am");