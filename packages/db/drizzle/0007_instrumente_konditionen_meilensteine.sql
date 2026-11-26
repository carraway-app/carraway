CREATE TYPE "public"."zinsmethode" AS ENUM('30E/360', 'act/360', 'act/365', 'act/act');--> statement-breakpoint
CREATE TYPE "public"."zinsperiodenart" AS ENUM('jaehrlich', 'quartalsweise', 'endfaellig');--> statement-breakpoint
CREATE TABLE "darlehen_kondition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beteiligung_id" uuid NOT NULL,
	"gueltig_ab" date NOT NULL,
	"satz_fix" numeric(10, 6) NOT NULL,
	"methode" "zinsmethode" NOT NULL,
	"zinsperiode" "zinsperiodenart" NOT NULL,
	"anker" date NOT NULL,
	"gewinnabhaengig_satz" numeric(10, 6),
	"kappung_satz" numeric(10, 6),
	"stundung_bis" date,
	"kapitalisieren" boolean DEFAULT false NOT NULL,
	"faellig_am" date,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "darlehen_kondition_satz_bereich" CHECK ("darlehen_kondition"."satz_fix" >= 0 AND "darlehen_kondition"."satz_fix" <= 1),
	CONSTRAINT "darlehen_kondition_gewinn_paar" CHECK (("darlehen_kondition"."gewinnabhaengig_satz" IS NULL) = ("darlehen_kondition"."kappung_satz" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "jahresueberschuss" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beteiligung_id" uuid NOT NULL,
	"jahr" integer NOT NULL,
	"betrag" numeric(18, 2) NOT NULL,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meilenstein" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beteiligung_id" uuid NOT NULL,
	"bezeichnung" text NOT NULL,
	"bedingung" text,
	"frist" date,
	"betrag" numeric(18, 2) NOT NULL,
	"erfuellt_am" date,
	"nachweis" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meilenstein_betrag_positiv" CHECK ("meilenstein"."betrag" > 0)
);
--> statement-breakpoint
ALTER TABLE "vorgang" ADD COLUMN "kapitalisiert" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vorgang" ADD COLUMN "meilenstein_id" uuid;--> statement-breakpoint
ALTER TABLE "darlehen_kondition" ADD CONSTRAINT "darlehen_kondition_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jahresueberschuss" ADD CONSTRAINT "jahresueberschuss_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meilenstein" ADD CONSTRAINT "meilenstein_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "darlehen_kondition_beteiligung_ab_uq" ON "darlehen_kondition" USING btree ("beteiligung_id","gueltig_ab");--> statement-breakpoint
CREATE UNIQUE INDEX "jahresueberschuss_beteiligung_jahr_uq" ON "jahresueberschuss" USING btree ("beteiligung_id","jahr");--> statement-breakpoint
CREATE INDEX "meilenstein_beteiligung_idx" ON "meilenstein" USING btree ("beteiligung_id");--> statement-breakpoint
ALTER TABLE "vorgang" ADD CONSTRAINT "vorgang_meilenstein_id_meilenstein_id_fk" FOREIGN KEY ("meilenstein_id") REFERENCES "public"."meilenstein"("id") ON DELETE no action ON UPDATE no action;