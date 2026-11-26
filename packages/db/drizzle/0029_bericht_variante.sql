CREATE TABLE "bericht_variante" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bericht_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"datei_name" text NOT NULL,
	"datei_schluessel" text NOT NULL,
	"datei_sha256" text NOT NULL,
	"datei_groesse" integer NOT NULL,
	"erzeugt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bericht_variante" ADD CONSTRAINT "bericht_variante_bericht_id_bericht_id_fk" FOREIGN KEY ("bericht_id") REFERENCES "public"."bericht"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bericht_variante" ADD CONSTRAINT "bericht_variante_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bericht_variante_bericht_organisation_uq" ON "bericht_variante" USING btree ("bericht_id","organisation_id");--> statement-breakpoint
CREATE INDEX "bericht_variante_organisation_idx" ON "bericht_variante" USING btree ("organisation_id");--> statement-breakpoint
-- Varianten sind nach dem Anlegen unveränderlich (wie freigegebene Berichtsdateien und Mitteilungen): kein Ändern, kein Löschen.
CREATE FUNCTION bericht_variante_unveraenderlich() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Berichtsvarianten sind unveränderlich (% auf bericht_variante)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER bericht_variante_kein_update_delete BEFORE UPDATE OR DELETE ON "bericht_variante"
  FOR EACH ROW EXECUTE FUNCTION bericht_variante_unveraenderlich();
