CREATE TYPE "public"."mitarbeiter_programm_art" AS ENUM('esop', 'vsop');--> statement-breakpoint
CREATE TYPE "public"."mitarbeiter_regel" AS ENUM('wie_anteile', 'anteilig');--> statement-breakpoint
CREATE TYPE "public"."pool_basis" AS ENUM('pre_money', 'post_money');--> statement-breakpoint
CREATE TYPE "public"."zuteilung_kategorie" AS ENUM('gruender', 'fuehrung', 'mitarbeitende', 'beirat', 'sonstige');--> statement-breakpoint
CREATE TYPE "public"."zuteilung_status" AS ENUM('zugeteilt', 'gevestet', 'verfallen', 'ausgeuebt');--> statement-breakpoint
CREATE TABLE "mitarbeiterpool" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"art" "mitarbeiter_programm_art" NOT NULL,
	"bezeichnung" text NOT NULL,
	"regel" "mitarbeiter_regel" DEFAULT 'wie_anteile' NOT NULL,
	"notiz" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mitarbeiterpool_regel_nur_vsop" CHECK ("mitarbeiterpool"."art" = 'vsop' OR "mitarbeiterpool"."regel" = 'wie_anteile')
);
--> statement-breakpoint
CREATE TABLE "mitarbeiterzuteilung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_id" uuid NOT NULL,
	"kategorie" "zuteilung_kategorie" NOT NULL,
	"bezeichnung" text,
	"anzahl" numeric(18, 0) NOT NULL,
	"basispreis" numeric(18, 4) DEFAULT '0' NOT NULL,
	"zugeteilt_am" date NOT NULL,
	"vesting_beginn" date,
	"cliff_monate" integer DEFAULT 12 NOT NULL,
	"vesting_monate" integer DEFAULT 48 NOT NULL,
	"beschleunigung" numeric(5, 4) DEFAULT '0' NOT NULL,
	"status" "zuteilung_status" DEFAULT 'zugeteilt' NOT NULL,
	"status_am" date,
	"leaver_regel" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mitarbeiterzuteilung_anzahl" CHECK ("mitarbeiterzuteilung"."anzahl" > 0),
	CONSTRAINT "mitarbeiterzuteilung_basispreis" CHECK ("mitarbeiterzuteilung"."basispreis" >= 0),
	CONSTRAINT "mitarbeiterzuteilung_vesting" CHECK ("mitarbeiterzuteilung"."cliff_monate" >= 0 AND "mitarbeiterzuteilung"."vesting_monate" >= 0),
	CONSTRAINT "mitarbeiterzuteilung_beschleunigung" CHECK ("mitarbeiterzuteilung"."beschleunigung" >= 0 AND "mitarbeiterzuteilung"."beschleunigung" <= 1),
	CONSTRAINT "mitarbeiterzuteilung_status_am" CHECK ("mitarbeiterzuteilung"."status" NOT IN ('verfallen', 'ausgeuebt') OR "mitarbeiterzuteilung"."status_am" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "pool_aenderung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_id" uuid NOT NULL,
	"datum" date NOT NULL,
	"anzahl" numeric(18, 0) NOT NULL,
	"beschluss" text,
	"runde_id" uuid,
	"basis" "pool_basis",
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_aenderung_anzahl" CHECK ("pool_aenderung"."anzahl" <> 0),
	CONSTRAINT "pool_aenderung_basis_mit_runde" CHECK (("pool_aenderung"."runde_id" IS NULL) = ("pool_aenderung"."basis" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "mitarbeiterpool" ADD CONSTRAINT "mitarbeiterpool_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD CONSTRAINT "mitarbeiterzuteilung_pool_id_mitarbeiterpool_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."mitarbeiterpool"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_aenderung" ADD CONSTRAINT "pool_aenderung_pool_id_mitarbeiterpool_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."mitarbeiterpool"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_aenderung" ADD CONSTRAINT "pool_aenderung_runde_id_finanzierungsrunde_id_fk" FOREIGN KEY ("runde_id") REFERENCES "public"."finanzierungsrunde"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mitarbeiterpool_organisation_bezeichnung_uq" ON "mitarbeiterpool" USING btree ("organisation_id","bezeichnung");--> statement-breakpoint
CREATE INDEX "mitarbeiterzuteilung_pool_idx" ON "mitarbeiterzuteilung" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "pool_aenderung_pool_idx" ON "pool_aenderung" USING btree ("pool_id","datum");