CREATE TYPE "public"."auslesung_art" AS ENUM('beteiligungsvertrag', 'darlehensvertrag', 'bewertungsnachweis');--> statement-breakpoint
CREATE TYPE "public"."auslesung_status" AS ENUM('wartend', 'eingereiht', 'laeuft', 'bereit', 'fehlgeschlagen', 'bestaetigt', 'verworfen');--> statement-breakpoint
CREATE TYPE "public"."dokument_klassifikation" AS ENUM('vertrag', 'beschluss', 'bewertung', 'bericht', 'beleg', 'sonstiges');--> statement-breakpoint
CREATE TYPE "public"."dokument_status" AS ENUM('aktiv', 'ersetzt', 'geloescht');--> statement-breakpoint
CREATE TYPE "public"."dokument_text_status" AS ENUM('ausstehend', 'vorhanden', 'kein_text', 'nicht_unterstuetzt', 'fehler');--> statement-breakpoint
CREATE TYPE "public"."dokument_ziel_typ" AS ENUM('beteiligung', 'deal', 'vorgang', 'organisation', 'fonds', 'bewertung', 'finanzierungsrunde');--> statement-breakpoint
CREATE TABLE "auslesung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dokument_id" uuid NOT NULL,
	"art" "auslesung_art" NOT NULL,
	"status" "auslesung_status" DEFAULT 'wartend' NOT NULL,
	"seiten" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vertraulich_erlaubt" boolean DEFAULT false NOT NULL,
	"angefordert_von" text NOT NULL,
	"angefordert_von_name" text,
	"angefordert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"anbieter" text,
	"region" text,
	"modell" text,
	"felder" jsonb,
	"fehler_code" text,
	"fertig_am" timestamp with time zone,
	"entschieden_von" text,
	"entschieden_von_name" text,
	"entschieden_am" timestamp with time zone,
	"ergebnis" jsonb
);
--> statement-breakpoint
CREATE TABLE "dokument" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha256" text NOT NULL,
	"dateiname" text NOT NULL,
	"mime" text NOT NULL,
	"groesse" integer NOT NULL,
	"gespeichert_unter" text NOT NULL,
	"hochgeladen_von" text NOT NULL,
	"hochgeladen_von_name" text,
	"hochgeladen_am" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "dokument_status" DEFAULT 'aktiv' NOT NULL,
	"klassifikation" "dokument_klassifikation" DEFAULT 'sonstiges' NOT NULL,
	"vertraulich" boolean DEFAULT false NOT NULL,
	"text_status" "dokument_text_status" DEFAULT 'ausstehend' NOT NULL,
	"seitenzahl" integer,
	"vorgaenger_id" uuid,
	"ersetzt_am" timestamp with time zone,
	"geloescht_am" timestamp with time zone,
	"geloescht_von" text,
	CONSTRAINT "dokument_groesse" CHECK ("dokument"."groesse" > 0)
);
--> statement-breakpoint
CREATE TABLE "dokument_seite" (
	"dokument_id" uuid NOT NULL,
	"seite" integer NOT NULL,
	"text" text NOT NULL,
	"suchvektor" "tsvector" GENERATED ALWAYS AS (to_tsvector('german'::regconfig, "text") || to_tsvector('simple'::regconfig, "text")) STORED,
	CONSTRAINT "dokument_seite_dokument_id_seite_pk" PRIMARY KEY("dokument_id","seite"),
	CONSTRAINT "dokument_seite_nr" CHECK ("dokument_seite"."seite" >= 1)
);
--> statement-breakpoint
CREATE TABLE "dokument_verknuepfung" (
	"dokument_id" uuid NOT NULL,
	"ziel_typ" "dokument_ziel_typ" NOT NULL,
	"ziel_id" uuid NOT NULL,
	"erstellt_von" text DEFAULT 'system' NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dokument_verknuepfung_dokument_id_ziel_typ_ziel_id_pk" PRIMARY KEY("dokument_id","ziel_typ","ziel_id")
);
--> statement-breakpoint
CREATE TABLE "wert_quelle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"objekt_typ" text NOT NULL,
	"objekt_id" uuid NOT NULL,
	"feld" text NOT NULL,
	"wert" text NOT NULL,
	"dokument_id" uuid NOT NULL,
	"seite" integer NOT NULL,
	"zitat" text NOT NULL,
	"auslesung_id" uuid,
	"erstellt_von" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wert_quelle_objekt_typ" CHECK ("wert_quelle"."objekt_typ" IN ('finanzierungsrunde', 'rundenposition', 'anteilsklasse', 'darlehen_kondition', 'bewertung', 'beteiligung')),
	CONSTRAINT "wert_quelle_seite" CHECK ("wert_quelle"."seite" >= 1)
);
--> statement-breakpoint
ALTER TABLE "auslesung" ADD CONSTRAINT "auslesung_dokument_id_dokument_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dokument" ADD CONSTRAINT "dokument_vorgaenger_id_dokument_id_fk" FOREIGN KEY ("vorgaenger_id") REFERENCES "public"."dokument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dokument_seite" ADD CONSTRAINT "dokument_seite_dokument_id_dokument_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dokument_verknuepfung" ADD CONSTRAINT "dokument_verknuepfung_dokument_id_dokument_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wert_quelle" ADD CONSTRAINT "wert_quelle_dokument_id_dokument_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wert_quelle" ADD CONSTRAINT "wert_quelle_auslesung_id_auslesung_id_fk" FOREIGN KEY ("auslesung_id") REFERENCES "public"."auslesung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auslesung_dokument_idx" ON "auslesung" USING btree ("dokument_id","angefordert_am");--> statement-breakpoint
CREATE INDEX "auslesung_status_idx" ON "auslesung" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dokument_sha256_idx" ON "dokument" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "dokument_vorgaenger_idx" ON "dokument" USING btree ("vorgaenger_id");--> statement-breakpoint
CREATE INDEX "dokument_seite_suche_idx" ON "dokument_seite" USING gin ("suchvektor");--> statement-breakpoint
CREATE INDEX "dokument_verknuepfung_ziel_idx" ON "dokument_verknuepfung" USING btree ("ziel_typ","ziel_id");--> statement-breakpoint
CREATE INDEX "wert_quelle_objekt_idx" ON "wert_quelle" USING btree ("objekt_typ","objekt_id");--> statement-breakpoint
CREATE INDEX "wert_quelle_dokument_idx" ON "wert_quelle" USING btree ("dokument_id");