CREATE TABLE "werte_schluessel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"benutzer_id" uuid NOT NULL,
	"fonds_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"ablauf" timestamp with time zone NOT NULL,
	"hash" text NOT NULL,
	"vorschau" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"zuletzt_genutzt" timestamp with time zone,
	"widerrufen_am" timestamp with time zone,
	CONSTRAINT "werte_schluessel_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
ALTER TABLE "werte_schluessel" ADD CONSTRAINT "werte_schluessel_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "werte_schluessel_benutzer_idx" ON "werte_schluessel" USING btree ("benutzer_id");