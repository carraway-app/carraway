CREATE TYPE "public"."ansicht_art" AS ENUM('tabelle', 'kanban');--> statement-breakpoint
CREATE TYPE "public"."crm_objekt" AS ENUM('organisation', 'person', 'deal');--> statement-breakpoint
CREATE TYPE "public"."feld_typ" AS ENUM('text', 'langtext', 'zahl', 'betrag', 'datum', 'auswahl', 'mehrfachauswahl', 'kontrollkaestchen', 'url', 'email', 'telefon', 'benutzer', 'verknuepfung');--> statement-breakpoint
CREATE TABLE "ansicht" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"objekt" "crm_objekt" NOT NULL,
	"liste_id" uuid,
	"name" text NOT NULL,
	"art" "ansicht_art" DEFAULT 'tabelle' NOT NULL,
	"konfig" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"besitzer_id" uuid NOT NULL,
	"geteilt" boolean DEFAULT false NOT NULL,
	"standard" boolean DEFAULT false NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"aktualisiert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aufgabe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"titel" text NOT NULL,
	"notiz" text,
	"faellig" date,
	"zustaendig" uuid,
	"erledigt_am" timestamp with time zone,
	"organisation_id" uuid,
	"person_id" uuid,
	"deal_id" uuid,
	"erstellt_von" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aufgabe_ein_bezug" CHECK ("aufgabe"."organisation_id" IS NOT NULL OR "aufgabe"."person_id" IS NOT NULL OR "aufgabe"."deal_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "beschaeftigung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"funktion" text,
	"von" date,
	"bis" date,
	"haupt" boolean DEFAULT false NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beschaeftigung_zeitraum" CHECK ("beschaeftigung"."von" IS NULL OR "beschaeftigung"."bis" IS NULL OR "beschaeftigung"."bis" >= "beschaeftigung"."von")
);
--> statement-breakpoint
CREATE TABLE "datensatz_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"von_typ" "crm_objekt" NOT NULL,
	"von_id" uuid NOT NULL,
	"zu_typ" "crm_objekt" NOT NULL,
	"zu_id" uuid NOT NULL,
	"art" text NOT NULL,
	"quelle_id" uuid NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "datensatz_link_art" CHECK ("datensatz_link"."art" IN ('relation', 'erwaehnung'))
);
--> statement-breakpoint
CREATE TABLE "deal_kontakt" (
	"deal_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"rolle" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_kontakt_deal_id_person_id_pk" PRIMARY KEY("deal_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "feld_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"objekt" "crm_objekt" NOT NULL,
	"liste_id" uuid,
	"schluessel" text NOT NULL,
	"name" text NOT NULL,
	"typ" "feld_typ" NOT NULL,
	"optionen" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archiviert_am" timestamp with time zone,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feld_definition_schluessel" CHECK ("feld_definition"."schluessel" ~ '^[a-z][a-z0-9_]{0,39}$')
);
--> statement-breakpoint
CREATE TABLE "liste" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"beschreibung" text,
	"objekt" "crm_objekt" NOT NULL,
	"besitzer_id" uuid,
	"archiviert_am" timestamp with time zone,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "liste_eintrag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"liste_id" uuid NOT NULL,
	"datensatz_id" uuid NOT NULL,
	"felder" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "felder" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organisation" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "organisation" ADD COLUMN "telefon" text;--> statement-breakpoint
ALTER TABLE "organisation" ADD COLUMN "linkedin" text;--> statement-breakpoint
ALTER TABLE "organisation" ADD COLUMN "felder" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organisation" ADD COLUMN "archiviert_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "telefon" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "linkedin" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "felder" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "archiviert_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ansicht" ADD CONSTRAINT "ansicht_liste_id_liste_id_fk" FOREIGN KEY ("liste_id") REFERENCES "public"."liste"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ansicht" ADD CONSTRAINT "ansicht_besitzer_id_benutzer_id_fk" FOREIGN KEY ("besitzer_id") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe" ADD CONSTRAINT "aufgabe_zustaendig_benutzer_id_fk" FOREIGN KEY ("zustaendig") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe" ADD CONSTRAINT "aufgabe_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe" ADD CONSTRAINT "aufgabe_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe" ADD CONSTRAINT "aufgabe_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beschaeftigung" ADD CONSTRAINT "beschaeftigung_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beschaeftigung" ADD CONSTRAINT "beschaeftigung_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_kontakt" ADD CONSTRAINT "deal_kontakt_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_kontakt" ADD CONSTRAINT "deal_kontakt_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feld_definition" ADD CONSTRAINT "feld_definition_liste_id_liste_id_fk" FOREIGN KEY ("liste_id") REFERENCES "public"."liste"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liste" ADD CONSTRAINT "liste_besitzer_id_benutzer_id_fk" FOREIGN KEY ("besitzer_id") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liste_eintrag" ADD CONSTRAINT "liste_eintrag_liste_id_liste_id_fk" FOREIGN KEY ("liste_id") REFERENCES "public"."liste"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ansicht_objekt_idx" ON "ansicht" USING btree ("objekt","liste_id");--> statement-breakpoint
CREATE INDEX "ansicht_besitzer_idx" ON "ansicht" USING btree ("besitzer_id");--> statement-breakpoint
CREATE INDEX "aufgabe_zustaendig_idx" ON "aufgabe" USING btree ("zustaendig","faellig");--> statement-breakpoint
CREATE INDEX "aufgabe_organisation_idx" ON "aufgabe" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "aufgabe_person_idx" ON "aufgabe" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "aufgabe_deal_idx" ON "aufgabe" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "beschaeftigung_person_idx" ON "beschaeftigung" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "beschaeftigung_organisation_idx" ON "beschaeftigung" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "beschaeftigung_haupt_idx" ON "beschaeftigung" USING btree ("person_id") WHERE "beschaeftigung"."haupt";--> statement-breakpoint
CREATE UNIQUE INDEX "datensatz_link_eindeutig_idx" ON "datensatz_link" USING btree ("von_typ","von_id","zu_typ","zu_id","art","quelle_id");--> statement-breakpoint
CREATE INDEX "datensatz_link_zu_idx" ON "datensatz_link" USING btree ("zu_typ","zu_id");--> statement-breakpoint
CREATE INDEX "deal_kontakt_person_idx" ON "deal_kontakt" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feld_definition_global_idx" ON "feld_definition" USING btree ("objekt","schluessel") WHERE "feld_definition"."liste_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "feld_definition_liste_idx" ON "feld_definition" USING btree ("liste_id","schluessel") WHERE "feld_definition"."liste_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "liste_name_idx" ON "liste" USING btree (lower("name")) WHERE "liste"."archiviert_am" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "liste_eintrag_eindeutig_idx" ON "liste_eintrag" USING btree ("liste_id","datensatz_id");--> statement-breakpoint
CREATE INDEX "liste_eintrag_datensatz_idx" ON "liste_eintrag" USING btree ("datensatz_id");
--> statement-breakpoint
-- Bestehende Zuordnungen Person → Unternehmen werden Hauptbeschäftigungen (kein Datenverlust; die Spalte bleibt als Spiegel erhalten).
INSERT INTO "beschaeftigung" ("person_id", "organisation_id", "funktion", "haupt")
SELECT "id", "organisation_id", "funktion", true FROM "person" WHERE "organisation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "organisation_felder_idx" ON "organisation" USING gin ("felder" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "person_felder_idx" ON "person" USING gin ("felder" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "deal_felder_idx" ON "deal" USING gin ("felder" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "person_sortierung_idx" ON "person" (lower("nachname"), lower("vorname"), "id");--> statement-breakpoint
CREATE INDEX "organisation_sortierung_idx" ON "organisation" (lower("name"), "id");--> statement-breakpoint
CREATE INDEX "deal_aktualisiert_idx" ON "deal" ("aktualisiert_am" DESC, "id");
