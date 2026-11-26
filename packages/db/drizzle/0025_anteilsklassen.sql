CREATE TABLE "anteilsklasse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rang" integer DEFAULT 1 NOT NULL,
	"praeferenz_faktor" numeric(8, 4) DEFAULT '1' NOT NULL,
	"partizipierend" boolean DEFAULT false NOT NULL,
	"cap_faktor" numeric(8, 4),
	"kumulierte_verzinsung" numeric(8, 6),
	"umwandelbar" boolean DEFAULT true NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anteilsklasse_rang" CHECK ("anteilsklasse"."rang" >= 1),
	CONSTRAINT "anteilsklasse_faktor" CHECK ("anteilsklasse"."praeferenz_faktor" >= 0),
	CONSTRAINT "anteilsklasse_cap" CHECK ("anteilsklasse"."cap_faktor" IS NULL OR ("anteilsklasse"."partizipierend" AND "anteilsklasse"."cap_faktor" >= "anteilsklasse"."praeferenz_faktor")),
	CONSTRAINT "anteilsklasse_verzinsung" CHECK ("anteilsklasse"."kumulierte_verzinsung" IS NULL OR "anteilsklasse"."kumulierte_verzinsung" >= 0)
);
--> statement-breakpoint
ALTER TABLE "rundenposition" ADD COLUMN "anteilsklasse_id" uuid;--> statement-breakpoint
ALTER TABLE "anteilsklasse" ADD CONSTRAINT "anteilsklasse_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "anteilsklasse_organisation_name_uq" ON "anteilsklasse" USING btree ("organisation_id","name");--> statement-breakpoint
ALTER TABLE "rundenposition" ADD CONSTRAINT "rundenposition_anteilsklasse_id_anteilsklasse_id_fk" FOREIGN KEY ("anteilsklasse_id") REFERENCES "public"."anteilsklasse"("id") ON DELETE no action ON UPDATE no action;