-- KI-Ergänzung von Kontakten: Einstellung der Installation (Standard aus), Freigabe je Person, Vorschläge mit Quelle.
CREATE TABLE "kontakt_ki_einstellung" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"signaturen" boolean DEFAULT false NOT NULL,
	"website" boolean DEFAULT false NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kontakt_ki_einstellung_eine_zeile" CHECK ("kontakt_ki_einstellung"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "kontakt_ki_teilnahme" (
	"benutzer_id" uuid PRIMARY KEY NOT NULL,
	"signaturen" boolean DEFAULT false NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kontakt_ki_vorschlag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"organisation_id" uuid,
	"feld" text NOT NULL,
	"wert" text NOT NULL,
	"bisher" text,
	"quelle" text NOT NULL,
	"quelle_datum" timestamp with time zone NOT NULL,
	"quelle_url" text,
	"zitat" text NOT NULL,
	"benutzer_id" uuid,
	"anbieter" text,
	"status" text DEFAULT 'offen' NOT NULL,
	"entschieden_von" uuid,
	"entschieden_am" timestamp with time zone,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kontakt_ki_vorschlag_ziel" CHECK (("kontakt_ki_vorschlag"."person_id" IS NULL) <> ("kontakt_ki_vorschlag"."organisation_id" IS NULL)),
	CONSTRAINT "kontakt_ki_vorschlag_status" CHECK ("kontakt_ki_vorschlag"."status" IN ('offen', 'uebernommen', 'verworfen')),
	CONSTRAINT "kontakt_ki_vorschlag_quelle" CHECK ("kontakt_ki_vorschlag"."quelle" IN ('signatur', 'website'))
);
--> statement-breakpoint
ALTER TABLE "kontakt_ki_teilnahme" ADD CONSTRAINT "kontakt_ki_teilnahme_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontakt_ki_vorschlag" ADD CONSTRAINT "kontakt_ki_vorschlag_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontakt_ki_vorschlag" ADD CONSTRAINT "kontakt_ki_vorschlag_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontakt_ki_vorschlag" ADD CONSTRAINT "kontakt_ki_vorschlag_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontakt_ki_vorschlag" ADD CONSTRAINT "kontakt_ki_vorschlag_entschieden_von_benutzer_id_fk" FOREIGN KEY ("entschieden_von") REFERENCES "public"."benutzer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kontakt_ki_vorschlag_person_offen_uq" ON "kontakt_ki_vorschlag" USING btree ("person_id","feld") WHERE "kontakt_ki_vorschlag"."status" = 'offen' AND "kontakt_ki_vorschlag"."person_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "kontakt_ki_vorschlag_organisation_offen_uq" ON "kontakt_ki_vorschlag" USING btree ("organisation_id","feld") WHERE "kontakt_ki_vorschlag"."status" = 'offen' AND "kontakt_ki_vorschlag"."organisation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "kontakt_ki_vorschlag_person_idx" ON "kontakt_ki_vorschlag" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "kontakt_ki_vorschlag_organisation_idx" ON "kontakt_ki_vorschlag" USING btree ("organisation_id");