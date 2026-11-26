CREATE TABLE "webhook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benutzer_id" uuid NOT NULL,
	"api_schluessel_id" uuid,
	"url" text NOT NULL,
	"beschreibung" text,
	"tabellen" text[] DEFAULT '{}'::text[] NOT NULL,
	"geheimnis_verschluesselt" text NOT NULL,
	"aktiv" boolean DEFAULT true NOT NULL,
	"fehler_in_folge" integer DEFAULT 0 NOT NULL,
	"deaktiviert_am" timestamp with time zone,
	"deaktiviert_grund" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_ausgang" (
	"nr" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "webhook_ausgang_nr_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"aenderung_id" uuid NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_zustellung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"aenderung_id" uuid,
	"art" text DEFAULT 'change' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"versuche" integer DEFAULT 0 NOT NULL,
	"letzter_versuch_am" timestamp with time zone,
	"http_status" integer,
	"fehler" text,
	"dauer_ms" integer,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"eingereiht_am" timestamp with time zone,
	"zugestellt_am" timestamp with time zone,
	CONSTRAINT "webhook_zustellung_status" CHECK ("webhook_zustellung"."status" IN ('pending', 'delivered', 'failed', 'skipped')),
	CONSTRAINT "webhook_zustellung_art" CHECK ("webhook_zustellung"."art" IN ('change', 'ping'))
);
--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_api_schluessel_id_api_schluessel_id_fk" FOREIGN KEY ("api_schluessel_id") REFERENCES "public"."api_schluessel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_zustellung" ADD CONSTRAINT "webhook_zustellung_webhook_id_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_benutzer_idx" ON "webhook" USING btree ("benutzer_id");--> statement-breakpoint
CREATE INDEX "webhook_aktiv_idx" ON "webhook" USING btree ("aktiv");--> statement-breakpoint
CREATE INDEX "webhook_zustellung_webhook_idx" ON "webhook_zustellung" USING btree ("webhook_id","erstellt_am");--> statement-breakpoint
CREATE INDEX "webhook_zustellung_offen_idx" ON "webhook_zustellung" USING btree ("erstellt_am") WHERE "webhook_zustellung"."eingereiht_am" IS NULL;--> statement-breakpoint
CREATE INDEX "webhook_zustellung_erstellt_idx" ON "webhook_zustellung" USING btree ("erstellt_am");--> statement-breakpoint
-- Gemeinsame Ereignisquelle für Webhooks und Live-Aktualisierung: Nach jedem Einfügen ins Änderungsprotokoll (außer Lesezugriffen)
-- legt der Trigger Einträge im Ausgangskorb der Webhooks an (nur solange ein Endpunkt aktiv ist) und meldet die IDs über NOTIFY an die
-- API-Prozesse (Kanal carraway_aenderung, je Meldung höchstens 200 IDs, zugestellt erst beim Festschreiben der Transaktion).
CREATE OR REPLACE FUNCTION aenderung_ereignis_melden() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  gruppe record;
BEGIN
  IF EXISTS (SELECT 1 FROM webhook WHERE aktiv) THEN
    INSERT INTO webhook_ausgang (aenderung_id) SELECT id FROM neu WHERE aktion <> 'gelesen' ORDER BY am, id;
  END IF;
  FOR gruppe IN SELECT string_agg(id::text, ',') AS ids FROM (SELECT id, (row_number() OVER () - 1) / 200 AS g FROM neu WHERE aktion <> 'gelesen') s GROUP BY g LOOP
    PERFORM pg_notify('carraway_aenderung', gruppe.ids);
  END LOOP;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER aenderung_ereignis_melden AFTER INSERT ON "aenderung" REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION aenderung_ereignis_melden();
