CREATE TYPE "public"."import_lauf_status" AS ENUM('hochgeladen', 'geprueft', 'uebernommen');--> statement-breakpoint
CREATE TABLE "idempotenz_schluessel" (
	"akteur" text NOT NULL,
	"schluessel" text NOT NULL,
	"methode" text NOT NULL,
	"pfad" text NOT NULL,
	"anfrage_hash" text NOT NULL,
	"status" integer,
	"antwort" text,
	"antwort_hash" text,
	"inhaltstyp" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotenz_schluessel_akteur_schluessel_pk" PRIMARY KEY("akteur","schluessel")
);
--> statement-breakpoint
CREATE TABLE "import_befund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lauf_id" uuid NOT NULL,
	"nr" integer NOT NULL,
	"blatt" text,
	"zeile" integer,
	"spalte" text,
	"code" text NOT NULL,
	"schweregrad" text NOT NULL,
	"meldung" text NOT NULL,
	CONSTRAINT "import_befund_schweregrad" CHECK ("import_befund"."schweregrad" IN ('fehler', 'warnung'))
);
--> statement-breakpoint
CREATE TABLE "import_lauf" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dateiname" text NOT NULL,
	"dateityp" text NOT NULL,
	"sprache" text NOT NULL,
	"groesse" integer NOT NULL,
	"sha256" text NOT NULL,
	"datei" "bytea" NOT NULL,
	"status" "import_lauf_status" DEFAULT 'hochgeladen' NOT NULL,
	"hochgeladen_von" text NOT NULL,
	"hochgeladen_von_name" text,
	"hochgeladen_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geprueft_von" text,
	"geprueft_von_name" text,
	"geprueft_am" timestamp with time zone,
	"fehler_anzahl" integer,
	"warnung_anzahl" integer,
	"befunde_gekuerzt" boolean DEFAULT false NOT NULL,
	"fonds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vorschau" jsonb,
	"uebernommen_von" text,
	"uebernommen_von_name" text,
	"uebernommen_am" timestamp with time zone,
	"ergebnis" jsonb
);
--> statement-breakpoint
CREATE TABLE "import_zuordnung" (
	"objekt" text NOT NULL,
	"schluessel" text NOT NULL,
	"datensatz_id" uuid NOT NULL,
	"lauf_id" uuid,
	"angelegt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_zuordnung_objekt_schluessel_pk" PRIMARY KEY("objekt","schluessel")
);
--> statement-breakpoint
ALTER TABLE "aenderung" ADD COLUMN "fonds_id" uuid;--> statement-breakpoint
ALTER TABLE "import_befund" ADD CONSTRAINT "import_befund_lauf_id_import_lauf_id_fk" FOREIGN KEY ("lauf_id") REFERENCES "public"."import_lauf"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_zuordnung" ADD CONSTRAINT "import_zuordnung_lauf_id_import_lauf_id_fk" FOREIGN KEY ("lauf_id") REFERENCES "public"."import_lauf"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotenz_schluessel_am_idx" ON "idempotenz_schluessel" USING btree ("erstellt_am");--> statement-breakpoint
CREATE INDEX "import_befund_lauf_idx" ON "import_befund" USING btree ("lauf_id","nr");--> statement-breakpoint
CREATE INDEX "import_lauf_am_idx" ON "import_lauf" USING btree ("hochgeladen_am");--> statement-breakpoint
CREATE INDEX "import_zuordnung_datensatz_idx" ON "import_zuordnung" USING btree ("objekt","datensatz_id");--> statement-breakpoint
CREATE INDEX "aenderung_fonds_am_idx" ON "aenderung" USING btree ("fonds_id","am","id");