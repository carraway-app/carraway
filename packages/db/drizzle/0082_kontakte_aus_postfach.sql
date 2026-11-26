-- Kontakte aus Postfach und Kalender: Einstellung der Installation (Standard aus), Teilnahme je Person, Vorschläge mit Quellen, ein Unternehmen je Domain, Herkunft.
CREATE TABLE "kontakt_domain" (
	"domain" text PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kontakt_domain_klein" CHECK ("kontakt_domain"."domain" = lower("kontakt_domain"."domain"))
);
--> statement-breakpoint
CREATE TABLE "kontakt_herkunft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"organisation_id" uuid,
	"benutzer_id" uuid,
	"bereich" "postfach_bereich" NOT NULL,
	"angelegt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kontakt_herkunft_ziel" CHECK (("kontakt_herkunft"."person_id" IS NULL) <> ("kontakt_herkunft"."organisation_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "kontakt_vorschlag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adresse" text NOT NULL,
	"name" text,
	"status" text DEFAULT 'offen' NOT NULL,
	"person_id" uuid,
	"entschieden_von" uuid,
	"entschieden_am" timestamp with time zone,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kontakt_vorschlag_status" CHECK ("kontakt_vorschlag"."status" IN ('offen', 'uebernommen', 'zusammengefuehrt')),
	CONSTRAINT "kontakt_vorschlag_adresse_klein" CHECK ("kontakt_vorschlag"."adresse" = lower("kontakt_vorschlag"."adresse"))
);
--> statement-breakpoint
CREATE TABLE "kontakt_vorschlag_quelle" (
	"vorschlag_id" uuid NOT NULL,
	"benutzer_id" uuid NOT NULL,
	"bereich" "postfach_bereich" NOT NULL,
	"verworfen" boolean DEFAULT false NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kontakt_vorschlag_quelle_vorschlag_id_benutzer_id_bereich_pk" PRIMARY KEY("vorschlag_id","benutzer_id","bereich")
);
--> statement-breakpoint
CREATE TABLE "kontaktabgleich_einstellung" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"modus" text DEFAULT 'aus' NOT NULL,
	"eigene_domains" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"sperrliste" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kontaktabgleich_einstellung_eine_zeile" CHECK ("kontaktabgleich_einstellung"."id" = 1),
	CONSTRAINT "kontaktabgleich_einstellung_modus" CHECK ("kontaktabgleich_einstellung"."modus" IN ('aus', 'vorschlag', 'direkt'))
);
--> statement-breakpoint
CREATE TABLE "kontaktabgleich_teilnahme" (
	"benutzer_id" uuid PRIMARY KEY NOT NULL,
	"teilnehmen" boolean DEFAULT false NOT NULL,
	"sperrliste" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "postfach_verbindung" ADD COLUMN "nachholen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kontakt_domain" ADD CONSTRAINT "kontakt_domain_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontakt_herkunft" ADD CONSTRAINT "kontakt_herkunft_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontakt_herkunft" ADD CONSTRAINT "kontakt_herkunft_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontakt_herkunft" ADD CONSTRAINT "kontakt_herkunft_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontakt_vorschlag" ADD CONSTRAINT "kontakt_vorschlag_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontakt_vorschlag" ADD CONSTRAINT "kontakt_vorschlag_entschieden_von_benutzer_id_fk" FOREIGN KEY ("entschieden_von") REFERENCES "public"."benutzer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontakt_vorschlag_quelle" ADD CONSTRAINT "kontakt_vorschlag_quelle_vorschlag_id_kontakt_vorschlag_id_fk" FOREIGN KEY ("vorschlag_id") REFERENCES "public"."kontakt_vorschlag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontakt_vorschlag_quelle" ADD CONSTRAINT "kontakt_vorschlag_quelle_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontaktabgleich_teilnahme" ADD CONSTRAINT "kontaktabgleich_teilnahme_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kontakt_herkunft_person_uq" ON "kontakt_herkunft" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kontakt_herkunft_organisation_uq" ON "kontakt_herkunft" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kontakt_vorschlag_adresse_uq" ON "kontakt_vorschlag" USING btree ("adresse");--> statement-breakpoint
CREATE INDEX "kontakt_vorschlag_status_idx" ON "kontakt_vorschlag" USING btree ("status");--> statement-breakpoint
CREATE INDEX "kontakt_vorschlag_quelle_benutzer_idx" ON "kontakt_vorschlag_quelle" USING btree ("benutzer_id");