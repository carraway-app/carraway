CREATE TABLE "wandlung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"darlehen_beteiligung_id" uuid NOT NULL,
	"ziel_beteiligung_id" uuid NOT NULL,
	"runde_id" uuid NOT NULL,
	"cutoff" date NOT NULL,
	"zinsen_wandeln" boolean NOT NULL,
	"preisregel" jsonb NOT NULL,
	"nennwert_je_anteil" numeric(18, 2) NOT NULL,
	"anzahl_anteile" numeric(18, 0) NOT NULL,
	"preis_je_anteil" numeric NOT NULL,
	"massgeblich" text NOT NULL,
	"wandlungsbetrag" numeric(18, 2) NOT NULL,
	"nominal" numeric(18, 2) NOT NULL,
	"agio" numeric(18, 2) NOT NULL,
	"spitzenbetrag" numeric(18, 2) NOT NULL,
	"zinsen_gebucht" numeric(18, 2) NOT NULL,
	"ergebnis" jsonb NOT NULL,
	"vorgaenge" jsonb NOT NULL,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wandlung" ADD CONSTRAINT "wandlung_darlehen_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("darlehen_beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wandlung" ADD CONSTRAINT "wandlung_ziel_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("ziel_beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wandlung" ADD CONSTRAINT "wandlung_runde_id_finanzierungsrunde_id_fk" FOREIGN KEY ("runde_id") REFERENCES "public"."finanzierungsrunde"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wandlung_darlehen_uq" ON "wandlung" USING btree ("darlehen_beteiligung_id");