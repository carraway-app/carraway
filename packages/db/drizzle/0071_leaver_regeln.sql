CREATE TYPE "public"."leaver_art" AS ENUM('good_leaver', 'bad_leaver');--> statement-breakpoint
CREATE TYPE "public"."leaver_gevestet" AS ENUM('bleiben', 'verfallen', 'rueckkauf');--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD COLUMN "leaver_art" "leaver_art";--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD COLUMN "austritt_am" date;--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD COLUMN "austritt_anzahl" numeric(18, 0);--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD COLUMN "leaver_gevestet" "leaver_gevestet";--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD COLUMN "rueckkaufpreis" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD CONSTRAINT "mitarbeiterzuteilung_leaver_vollstaendig" CHECK (("mitarbeiterzuteilung"."leaver_art" IS NULL) = ("mitarbeiterzuteilung"."austritt_am" IS NULL) AND ("mitarbeiterzuteilung"."leaver_art" IS NULL) = ("mitarbeiterzuteilung"."leaver_gevestet" IS NULL));--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD CONSTRAINT "mitarbeiterzuteilung_austritt_anzahl" CHECK ("mitarbeiterzuteilung"."austritt_anzahl" IS NULL OR ("mitarbeiterzuteilung"."leaver_art" IS NOT NULL AND "mitarbeiterzuteilung"."austritt_anzahl" > 0 AND "mitarbeiterzuteilung"."austritt_anzahl" <= "mitarbeiterzuteilung"."anzahl"));--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD CONSTRAINT "mitarbeiterzuteilung_rueckkaufpreis" CHECK ("mitarbeiterzuteilung"."rueckkaufpreis" IS NULL OR ("mitarbeiterzuteilung"."leaver_gevestet" = 'rueckkauf' AND "mitarbeiterzuteilung"."rueckkaufpreis" >= 0));