CREATE TYPE "public"."runden_art" AS ENUM('eigenkapital', 'bruecke');--> statement-breakpoint
CREATE TYPE "public"."vorgang_runde_quelle" AS ENUM('automatisch', 'manuell');--> statement-breakpoint
CREATE TABLE "vorgang_runde" (
	"vorgang_id" uuid PRIMARY KEY NOT NULL,
	"runde_id" uuid NOT NULL,
	"quelle" "vorgang_runde_quelle" NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_von" text
);
--> statement-breakpoint
ALTER TABLE "finanzierungsrunde" ALTER COLUMN "pre_money" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "finanzierungsrunde" ALTER COLUMN "post_money" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "finanzierungsrunde" ALTER COLUMN "preis_je_anteil" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "finanzierungsrunde" ALTER COLUMN "anteile_gesamt_nach" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "finanzierungsrunde" ADD COLUMN "art" "runden_art" DEFAULT 'eigenkapital' NOT NULL;--> statement-breakpoint
ALTER TABLE "vorgang_runde" ADD CONSTRAINT "vorgang_runde_vorgang_id_vorgang_id_fk" FOREIGN KEY ("vorgang_id") REFERENCES "public"."vorgang"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vorgang_runde" ADD CONSTRAINT "vorgang_runde_runde_id_finanzierungsrunde_id_fk" FOREIGN KEY ("runde_id") REFERENCES "public"."finanzierungsrunde"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vorgang_runde_runde_idx" ON "vorgang_runde" USING btree ("runde_id");--> statement-breakpoint
ALTER TABLE "finanzierungsrunde" ADD CONSTRAINT "finanzierungsrunde_bewertung_je_art" CHECK ("finanzierungsrunde"."art" <> 'eigenkapital' OR ("finanzierungsrunde"."pre_money" IS NOT NULL AND "finanzierungsrunde"."post_money" IS NOT NULL AND "finanzierungsrunde"."preis_je_anteil" IS NOT NULL AND "finanzierungsrunde"."anteile_gesamt_nach" IS NOT NULL));
--> statement-breakpoint
-- Bestand: Zuordnung der Vorgänge zu Runden (Vorrang: Buchung beim Rundenabschluss, Wandlung, Runde des Instruments; Stornos erben vom Original).
INSERT INTO "vorgang_runde" ("vorgang_id", "runde_id", "quelle", "geaendert_von")
SELECT rb."vorgang_id", rb."runde_id", 'automatisch', 'Migration' FROM "runde_buchung" rb
ON CONFLICT ("vorgang_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "vorgang_runde" ("vorgang_id", "runde_id", "quelle", "geaendert_von")
SELECT DISTINCT ON (v."id") v."id", w."runde_id", 'automatisch', 'Migration'
FROM "wandlung" w
CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(w."vorgaenge") = 'object' THEN w."vorgaenge" ELSE '{}'::jsonb END) AS e(schluessel, wert)
JOIN "vorgang" v ON v."id"::text = e.wert
ORDER BY v."id", w."erfasst_am"
ON CONFLICT ("vorgang_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "vorgang_runde" ("vorgang_id", "runde_id", "quelle", "geaendert_von")
SELECT v."id", i."runde_id", 'automatisch', 'Migration'
FROM "vorgang" v
JOIN "instrument" i ON i."id" = v."instrument_id"
WHERE i."runde_id" IS NOT NULL AND v."storniert_vorgang_id" IS NULL
ON CONFLICT ("vorgang_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "vorgang_runde" ("vorgang_id", "runde_id", "quelle", "geaendert_von")
SELECT s."id", vr."runde_id", 'automatisch', 'Migration'
FROM "vorgang" s
JOIN "vorgang_runde" vr ON vr."vorgang_id" = s."storniert_vorgang_id"
WHERE s."storniert_vorgang_id" IS NOT NULL
ON CONFLICT ("vorgang_id") DO NOTHING;
