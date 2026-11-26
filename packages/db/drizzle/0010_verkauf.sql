CREATE TABLE "forderung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beteiligung_id" uuid NOT NULL,
	"verkauf_id" uuid NOT NULL,
	"art" text NOT NULL,
	"betrag" numeric(18, 2) NOT NULL,
	"faellig_am" date NOT NULL,
	"erfuellt_am" date,
	"vorgang_id" uuid,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forderung_betrag_positiv" CHECK ("forderung"."betrag" > 0)
);
--> statement-breakpoint
CREATE TABLE "kaufpreisanpassung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"verkauf_id" uuid NOT NULL,
	"datum" date NOT NULL,
	"betrag" numeric(18, 2) NOT NULL,
	"grund" text NOT NULL,
	"vorgang_id" uuid NOT NULL,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verkauf" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beteiligung_id" uuid NOT NULL,
	"datum" date NOT NULL,
	"anteil_verkauft" numeric(10, 6) NOT NULL,
	"kaufpreis" numeric(18, 2) NOT NULL,
	"kosten" numeric(18, 2) NOT NULL,
	"treuhand_betrag" numeric(18, 2),
	"verkaeuferdarlehen_betrag" numeric(18, 2),
	"verkaeuferdarlehen_beteiligung_id" uuid,
	"buchwert_vorher" numeric(18, 2) NOT NULL,
	"buchwert_abgang" numeric(18, 2) NOT NULL,
	"erloes" numeric(18, 2) NOT NULL,
	"ergebnis" numeric(18, 2) NOT NULL,
	"barzufluss" numeric(18, 2) NOT NULL,
	"schritte" jsonb NOT NULL,
	"rueckfluss_vorgang_id" uuid,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forderung" ADD CONSTRAINT "forderung_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forderung" ADD CONSTRAINT "forderung_verkauf_id_verkauf_id_fk" FOREIGN KEY ("verkauf_id") REFERENCES "public"."verkauf"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forderung" ADD CONSTRAINT "forderung_vorgang_id_vorgang_id_fk" FOREIGN KEY ("vorgang_id") REFERENCES "public"."vorgang"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kaufpreisanpassung" ADD CONSTRAINT "kaufpreisanpassung_verkauf_id_verkauf_id_fk" FOREIGN KEY ("verkauf_id") REFERENCES "public"."verkauf"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kaufpreisanpassung" ADD CONSTRAINT "kaufpreisanpassung_vorgang_id_vorgang_id_fk" FOREIGN KEY ("vorgang_id") REFERENCES "public"."vorgang"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verkauf" ADD CONSTRAINT "verkauf_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verkauf" ADD CONSTRAINT "verkauf_verkaeuferdarlehen_beteiligung_id_beteiligung_id_fk" FOREIGN KEY ("verkaeuferdarlehen_beteiligung_id") REFERENCES "public"."beteiligung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verkauf" ADD CONSTRAINT "verkauf_rueckfluss_vorgang_id_vorgang_id_fk" FOREIGN KEY ("rueckfluss_vorgang_id") REFERENCES "public"."vorgang"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "forderung_beteiligung_idx" ON "forderung" USING btree ("beteiligung_id");--> statement-breakpoint
CREATE INDEX "kaufpreisanpassung_verkauf_idx" ON "kaufpreisanpassung" USING btree ("verkauf_id");--> statement-breakpoint
CREATE INDEX "verkauf_beteiligung_idx" ON "verkauf" USING btree ("beteiligung_id","datum");