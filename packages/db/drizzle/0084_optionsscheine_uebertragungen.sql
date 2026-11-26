CREATE TABLE "anteilsuebertragung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"datum" date NOT NULL,
	"quelle_position_id" uuid,
	"quelle_uebertragung_id" uuid,
	"kaeufer_fonds_id" uuid,
	"kaeufer_vehikel_id" uuid,
	"anzahl" numeric(18, 0) NOT NULL,
	"preis_je_anteil" numeric(18, 6) NOT NULL,
	"kaufpreis" numeric(18, 2) NOT NULL,
	"verkauf_id" uuid,
	"kaeufer_instrument_id" uuid,
	"bemerkung" text,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anteilsuebertragung_ein_kaeufer" CHECK (("anteilsuebertragung"."kaeufer_fonds_id" IS NULL) <> ("anteilsuebertragung"."kaeufer_vehikel_id" IS NULL)),
	CONSTRAINT "anteilsuebertragung_eine_quelle" CHECK ("anteilsuebertragung"."quelle_position_id" IS NULL OR "anteilsuebertragung"."quelle_uebertragung_id" IS NULL),
	CONSTRAINT "anteilsuebertragung_anzahl" CHECK ("anteilsuebertragung"."anzahl" > 0),
	CONSTRAINT "anteilsuebertragung_preis" CHECK ("anteilsuebertragung"."preis_je_anteil" >= 0 AND "anteilsuebertragung"."kaufpreis" >= 0)
);
--> statement-breakpoint
CREATE TABLE "optionsschein_ausuebung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"datum" date NOT NULL,
	"anzahl" numeric(18, 0) NOT NULL,
	"preis_je_anteil" numeric(18, 4) NOT NULL,
	"betrag" numeric(18, 2) NOT NULL,
	"zusage_vorgang_id" uuid,
	"auszahlung_vorgang_id" uuid,
	"bemerkung" text,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "optionsschein_ausuebung_anzahl" CHECK ("optionsschein_ausuebung"."anzahl" > 0),
	CONSTRAINT "optionsschein_ausuebung_betrag" CHECK ("optionsschein_ausuebung"."betrag" >= 0)
);
--> statement-breakpoint
ALTER TABLE "instrument" ADD COLUMN "optionsschein_anzahl" numeric(18, 0);--> statement-breakpoint
ALTER TABLE "instrument" ADD COLUMN "ausuebungspreis" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "instrument" ADD COLUMN "ausgabe_am" date;--> statement-breakpoint
ALTER TABLE "instrument" ADD COLUMN "laufzeit_bis" date;--> statement-breakpoint
ALTER TABLE "anteilsuebertragung" ADD CONSTRAINT "anteilsuebertragung_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anteilsuebertragung" ADD CONSTRAINT "anteilsuebertragung_quelle_position_id_rundenposition_id_fk" FOREIGN KEY ("quelle_position_id") REFERENCES "public"."rundenposition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anteilsuebertragung" ADD CONSTRAINT "anteilsuebertragung_quelle_uebertragung_id_anteilsuebertragung_id_fk" FOREIGN KEY ("quelle_uebertragung_id") REFERENCES "public"."anteilsuebertragung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anteilsuebertragung" ADD CONSTRAINT "anteilsuebertragung_kaeufer_fonds_id_fonds_id_fk" FOREIGN KEY ("kaeufer_fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anteilsuebertragung" ADD CONSTRAINT "anteilsuebertragung_kaeufer_vehikel_id_vehikel_id_fk" FOREIGN KEY ("kaeufer_vehikel_id") REFERENCES "public"."vehikel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anteilsuebertragung" ADD CONSTRAINT "anteilsuebertragung_verkauf_id_verkauf_id_fk" FOREIGN KEY ("verkauf_id") REFERENCES "public"."verkauf"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anteilsuebertragung" ADD CONSTRAINT "anteilsuebertragung_kaeufer_instrument_id_instrument_id_fk" FOREIGN KEY ("kaeufer_instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optionsschein_ausuebung" ADD CONSTRAINT "optionsschein_ausuebung_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optionsschein_ausuebung" ADD CONSTRAINT "optionsschein_ausuebung_zusage_vorgang_id_vorgang_id_fk" FOREIGN KEY ("zusage_vorgang_id") REFERENCES "public"."vorgang"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optionsschein_ausuebung" ADD CONSTRAINT "optionsschein_ausuebung_auszahlung_vorgang_id_vorgang_id_fk" FOREIGN KEY ("auszahlung_vorgang_id") REFERENCES "public"."vorgang"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anteilsuebertragung_organisation_idx" ON "anteilsuebertragung" USING btree ("organisation_id","datum");--> statement-breakpoint
CREATE INDEX "optionsschein_ausuebung_instrument_idx" ON "optionsschein_ausuebung" USING btree ("instrument_id","datum");--> statement-breakpoint
ALTER TABLE "instrument" ADD CONSTRAINT "instrument_optionsschein_anzahl" CHECK ("instrument"."optionsschein_anzahl" IS NULL OR "instrument"."optionsschein_anzahl" > 0);--> statement-breakpoint
ALTER TABLE "instrument" ADD CONSTRAINT "instrument_ausuebungspreis" CHECK ("instrument"."ausuebungspreis" IS NULL OR "instrument"."ausuebungspreis" >= 0);--> statement-breakpoint
ALTER TABLE "instrument" ADD CONSTRAINT "instrument_laufzeit" CHECK ("instrument"."laufzeit_bis" IS NULL OR "instrument"."ausgabe_am" IS NULL OR "instrument"."laufzeit_bis" >= "instrument"."ausgabe_am");