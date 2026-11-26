CREATE TABLE "zuteilung_austritt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zuteilung_id" uuid NOT NULL,
	"art" "leaver_art" NOT NULL,
	"austritt_am" date NOT NULL,
	"anzahl" numeric(18, 0) NOT NULL,
	"gevestet" "leaver_gevestet" NOT NULL,
	"rueckkaufpreis" numeric(18, 4),
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zuteilung_austritt_anzahl" CHECK ("zuteilung_austritt"."anzahl" > 0),
	CONSTRAINT "zuteilung_austritt_rueckkaufpreis" CHECK ("zuteilung_austritt"."rueckkaufpreis" IS NULL OR ("zuteilung_austritt"."gevestet" = 'rueckkauf' AND "zuteilung_austritt"."rueckkaufpreis" >= 0))
);
--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" DROP CONSTRAINT "mitarbeiterzuteilung_leaver_vollstaendig";--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" DROP CONSTRAINT "mitarbeiterzuteilung_austritt_anzahl";--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" DROP CONSTRAINT "mitarbeiterzuteilung_rueckkaufpreis";--> statement-breakpoint
ALTER TABLE "zuteilung_austritt" ADD CONSTRAINT "zuteilung_austritt_zuteilung_id_mitarbeiterzuteilung_id_fk" FOREIGN KEY ("zuteilung_id") REFERENCES "public"."mitarbeiterzuteilung"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "zuteilung_austritt_zuteilung_idx" ON "zuteilung_austritt" USING btree ("zuteilung_id");--> statement-breakpoint
-- Datenmigration: die bisherige Leaver-Regel je Zuteilung wird ein Austritt (betroffene Einheiten ohne Angabe: alle).
INSERT INTO "zuteilung_austritt" ("zuteilung_id", "art", "austritt_am", "anzahl", "gevestet", "rueckkaufpreis") SELECT "id", "leaver_art", "austritt_am", COALESCE("austritt_anzahl", "anzahl"), "leaver_gevestet", "rueckkaufpreis" FROM "mitarbeiterzuteilung" WHERE "leaver_art" IS NOT NULL AND "austritt_am" IS NOT NULL AND "leaver_gevestet" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" DROP COLUMN "leaver_art";--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" DROP COLUMN "austritt_am";--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" DROP COLUMN "austritt_anzahl";--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" DROP COLUMN "leaver_gevestet";--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" DROP COLUMN "rueckkaufpreis";