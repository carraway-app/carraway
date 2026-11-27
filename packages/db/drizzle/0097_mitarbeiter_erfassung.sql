CREATE TYPE "public"."beschleunigung_ausloeser" AS ENUM('einfach', 'doppelt');--> statement-breakpoint
CREATE TYPE "public"."pool_erfassung" AS ENUM('grob', 'einzeln');--> statement-breakpoint
ALTER TABLE "mitarbeiterpool" ADD COLUMN "erfassung" "pool_erfassung" DEFAULT 'grob' NOT NULL;--> statement-breakpoint
ALTER TABLE "mitarbeiterpool" ADD COLUMN "vergeben" numeric(18, 0);--> statement-breakpoint
ALTER TABLE "mitarbeiterpool" ADD COLUMN "basispreis_mittel" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD COLUMN "kennung" text;--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD COLUMN "anonymisiert_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD COLUMN "vesting_takt_monate" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD COLUMN "beschleunigung_ausloeser" "beschleunigung_ausloeser" DEFAULT 'einfach' NOT NULL;--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD COLUMN "ausuebungsfrist_monate" integer;--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD COLUMN "laufzeit_bis" date;--> statement-breakpoint
ALTER TABLE "mitarbeiterpool" ADD CONSTRAINT "mitarbeiterpool_vergeben" CHECK ("mitarbeiterpool"."vergeben" IS NULL OR "mitarbeiterpool"."vergeben" >= 0);--> statement-breakpoint
ALTER TABLE "mitarbeiterpool" ADD CONSTRAINT "mitarbeiterpool_basispreis_mittel" CHECK ("mitarbeiterpool"."basispreis_mittel" IS NULL OR "mitarbeiterpool"."basispreis_mittel" >= 0);--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD CONSTRAINT "mitarbeiterzuteilung_takt" CHECK ("mitarbeiterzuteilung"."vesting_takt_monate" IN (1, 3, 6, 12));--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD CONSTRAINT "mitarbeiterzuteilung_ausuebungsfrist" CHECK ("mitarbeiterzuteilung"."ausuebungsfrist_monate" IS NULL OR ("mitarbeiterzuteilung"."ausuebungsfrist_monate" >= 0 AND "mitarbeiterzuteilung"."ausuebungsfrist_monate" <= 240));--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD CONSTRAINT "mitarbeiterzuteilung_anonymisiert" CHECK ("mitarbeiterzuteilung"."anonymisiert_am" IS NULL OR ("mitarbeiterzuteilung"."name" IS NULL AND "mitarbeiterzuteilung"."kennung" IS NULL));--> statement-breakpoint
-- Überführung: Pools mit Zuteilungen rechnen weiter mit ihren Zuteilungen (einzeln), die übrigen sind grob ohne vergebene Einheiten.
-- Beides ergibt dieselben Zahlen wie bisher (ohne Zuteilungen ist der ganze Pool frei).
UPDATE "mitarbeiterpool" p SET "erfassung" = 'einzeln' WHERE EXISTS (SELECT 1 FROM "mitarbeiterzuteilung" z WHERE z."pool_id" = p."id");
