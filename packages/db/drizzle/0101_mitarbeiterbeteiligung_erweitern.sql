ALTER TYPE "public"."mitarbeiter_regel" ADD VALUE 'vor_verteilung';--> statement-breakpoint
CREATE TABLE "zuteilung_ausuebung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zuteilung_id" uuid NOT NULL,
	"datum" date NOT NULL,
	"anzahl" numeric(18, 0) NOT NULL,
	"preis" numeric(18, 4) NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zuteilung_ausuebung_anzahl" CHECK ("zuteilung_ausuebung"."anzahl" > 0),
	CONSTRAINT "zuteilung_ausuebung_preis" CHECK ("zuteilung_ausuebung"."preis" >= 0)
);
--> statement-breakpoint
ALTER TABLE "mitarbeiterpool" ADD COLUMN "obergrenze_je_einheit" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD COLUMN "vesting_stufen" jsonb;--> statement-breakpoint
ALTER TABLE "mitarbeiterzuteilung" ADD COLUMN "leaver_stufen" jsonb;--> statement-breakpoint
ALTER TABLE "zuteilung_ausuebung" ADD CONSTRAINT "zuteilung_ausuebung_zuteilung_id_mitarbeiterzuteilung_id_fk" FOREIGN KEY ("zuteilung_id") REFERENCES "public"."mitarbeiterzuteilung"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "zuteilung_ausuebung_zuteilung_datum_idx" ON "zuteilung_ausuebung" USING btree ("zuteilung_id","datum");--> statement-breakpoint
ALTER TABLE "mitarbeiterpool" ADD CONSTRAINT "mitarbeiterpool_obergrenze_vsop" CHECK ("mitarbeiterpool"."obergrenze_je_einheit" IS NULL OR ("mitarbeiterpool"."art" = 'vsop' AND "mitarbeiterpool"."obergrenze_je_einheit" >= 0));