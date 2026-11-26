CREATE TYPE "public"."zinslauf_status" AS ENUM('berechnet', 'geprueft', 'freigegeben', 'gebucht', 'verworfen');--> statement-breakpoint
CREATE TABLE "zinslauf" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"stichtag" date NOT NULL,
	"status" "zinslauf_status" DEFAULT 'berechnet' NOT NULL,
	"berechnet_von" text NOT NULL,
	"berechnet_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geprueft_von" text,
	"geprueft_am" timestamp with time zone,
	"freigegeben_von" text,
	"freigegeben_am" timestamp with time zone,
	"gebucht_von" text,
	"gebucht_am" timestamp with time zone,
	"verworfen_von" text,
	"verworfen_am" timestamp with time zone,
	"abgedeckt" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zinslauf_position" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zinslauf_id" uuid NOT NULL,
	"beteiligung_id" uuid NOT NULL,
	"kondition_id" uuid,
	"von" date NOT NULL,
	"bis" date NOT NULL,
	"faellig_am" date NOT NULL,
	"gestundet" boolean NOT NULL,
	"betrag_fix" numeric NOT NULL,
	"betrag_gewinn" numeric NOT NULL,
	"betrag_gesamt" numeric NOT NULL,
	"betrag_gebucht" numeric(18, 2) NOT NULL,
	"kapitalisiert" boolean NOT NULL,
	"kapitalien" jsonb NOT NULL,
	"schritte" jsonb NOT NULL,
	"vorgang_id" uuid
);
--> statement-breakpoint
CREATE TABLE "zinsperiode_gebucht" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beteiligung_id" uuid NOT NULL,
	"periode_bis" date NOT NULL,
	"zinslauf_position_id" uuid,
	"vorgang_id" uuid
);
--> statement-breakpoint
ALTER TABLE "zinslauf" ADD CONSTRAINT "zinslauf_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zinslauf_position" ADD CONSTRAINT "zinslauf_position_zinslauf_id_zinslauf_id_fk" FOREIGN KEY ("zinslauf_id") REFERENCES "public"."zinslauf"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zinslauf_position" ADD CONSTRAINT "zinslauf_position_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zinslauf_position" ADD CONSTRAINT "zinslauf_position_kondition_id_darlehen_kondition_id_fk" FOREIGN KEY ("kondition_id") REFERENCES "public"."darlehen_kondition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zinslauf_position" ADD CONSTRAINT "zinslauf_position_vorgang_id_vorgang_id_fk" FOREIGN KEY ("vorgang_id") REFERENCES "public"."vorgang"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zinsperiode_gebucht" ADD CONSTRAINT "zinsperiode_gebucht_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zinsperiode_gebucht" ADD CONSTRAINT "zinsperiode_gebucht_zinslauf_position_id_zinslauf_position_id_fk" FOREIGN KEY ("zinslauf_position_id") REFERENCES "public"."zinslauf_position"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zinsperiode_gebucht" ADD CONSTRAINT "zinsperiode_gebucht_vorgang_id_vorgang_id_fk" FOREIGN KEY ("vorgang_id") REFERENCES "public"."vorgang"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "zinslauf_fonds_stichtag_idx" ON "zinslauf" USING btree ("fonds_id","stichtag","berechnet_am");--> statement-breakpoint
CREATE INDEX "zinslauf_position_lauf_idx" ON "zinslauf_position" USING btree ("zinslauf_id");--> statement-breakpoint
CREATE INDEX "zinslauf_position_beteiligung_idx" ON "zinslauf_position" USING btree ("beteiligung_id","bis");--> statement-breakpoint
CREATE UNIQUE INDEX "zinsperiode_gebucht_beteiligung_bis_uq" ON "zinsperiode_gebucht" USING btree ("beteiligung_id","periode_bis");