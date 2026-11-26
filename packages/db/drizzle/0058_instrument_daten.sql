-- Daten für das Portfolio-Modell (docs/portfolio-modell.md): je Beteiligung ein Instrument, `instrument_id` überall aus der Beteiligung befüllt,
-- Zinszahlungen für bar gezahlte Zinsen. Die neuen Enum-Werte (0056) sind seit dem Commit der eigenen Migration nutzbar (siehe scripts/migrate.ts).
INSERT INTO "instrument" ("beteiligung_id", "art", "bezeichnung", "status", "felder", "erstellt_am")
SELECT
  b."id",
  b."instrument",
  CASE b."instrument"
    WHEN 'offene_beteiligung' THEN 'Offene Beteiligung'
    WHEN 'stille_beteiligung' THEN 'Stille Beteiligung'
    WHEN 'darlehen' THEN 'Darlehen'
    WHEN 'wandeldarlehen' THEN 'Wandeldarlehen'
    WHEN 'venture_debt' THEN 'Venture Debt'
    ELSE 'Gesellschafterdarlehen'
  END,
  CASE
    WHEN b."status" = 'aktiv' THEN 'aktiv'
    WHEN b."status" = 'exit' AND b."instrument" = 'wandeldarlehen' AND EXISTS (SELECT 1 FROM "wandlung" w WHERE w."darlehen_beteiligung_id" = b."id") THEN 'gewandelt'
    WHEN b."status" = 'exit' THEN 'verkauft'
    ELSE 'abgeschrieben'
  END::"instrument_status",
  b."instrument_felder",
  b."erstellt_am"
FROM "beteiligung" b;--> statement-breakpoint
-- Vorgänge sind unveränderlich (Trigger `vorgang_kein_update_delete`, Migration 0001). Der Trigger wird nur für das einmalige Befüllen von
-- `instrument_id` abgeschaltet und sofort wieder eingeschaltet; die Migration läuft in einer Transaktion, bei einem Fehler bleibt er unverändert aktiv.
-- Betrag, Art, Valuta und Verweise bleiben unberührt.
ALTER TABLE "vorgang" DISABLE TRIGGER "vorgang_kein_update_delete";--> statement-breakpoint
UPDATE "vorgang" v SET "instrument_id" = i."id" FROM "instrument" i WHERE i."beteiligung_id" = v."beteiligung_id";--> statement-breakpoint
ALTER TABLE "vorgang" ENABLE TRIGGER "vorgang_kein_update_delete";--> statement-breakpoint
UPDATE "darlehen_kondition" x SET "instrument_id" = i."id" FROM "instrument" i WHERE i."beteiligung_id" = x."beteiligung_id";--> statement-breakpoint
UPDATE "tranche" x SET "instrument_id" = i."id" FROM "instrument" i WHERE i."beteiligung_id" = x."beteiligung_id";--> statement-breakpoint
UPDATE "tranche" t SET "nummer" = n."nr" FROM (SELECT "id", row_number() OVER (PARTITION BY "instrument_id" ORDER BY "erstellt_am", "id") AS "nr" FROM "tranche") n WHERE n."id" = t."id";--> statement-breakpoint
UPDATE "zinslauf_position" x SET "instrument_id" = i."id" FROM "instrument" i WHERE i."beteiligung_id" = x."beteiligung_id";--> statement-breakpoint
UPDATE "zinsperiode_gebucht" x SET "instrument_id" = i."id" FROM "instrument" i WHERE i."beteiligung_id" = x."beteiligung_id";--> statement-breakpoint
UPDATE "wandlung" x SET "quell_instrument_id" = i."id" FROM "instrument" i WHERE i."beteiligung_id" = x."darlehen_beteiligung_id";--> statement-breakpoint
UPDATE "wandlung" x SET "ziel_instrument_id" = i."id" FROM "instrument" i WHERE i."beteiligung_id" = x."ziel_beteiligung_id";--> statement-breakpoint
UPDATE "verkauf" x SET "instrument_id" = i."id" FROM "instrument" i WHERE i."beteiligung_id" = x."beteiligung_id";--> statement-breakpoint
UPDATE "forderung" x SET "instrument_id" = i."id" FROM "instrument" i WHERE i."beteiligung_id" = x."beteiligung_id";--> statement-breakpoint
-- Eigene Fonds-Positionen einer Runde verweisen auf das Instrument des Fonds im Unternehmen der Runde (falls es eine Beteiligung gibt).
UPDATE "rundenposition" p SET "instrument_id" = i."id"
FROM "finanzierungsrunde" r, "beteiligung" b, "instrument" i
WHERE r."id" = p."runde_id" AND p."fonds_id" IS NOT NULL AND b."fonds_id" = p."fonds_id" AND b."organisation_id" = r."organisation_id" AND i."beteiligung_id" = b."id";--> statement-breakpoint
-- Pflichtangaben und die Eindeutigkeit der gebuchten Zinsperiode je Instrument (statt je Beteiligung).
ALTER TABLE "vorgang" ALTER COLUMN "instrument_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "darlehen_kondition" ALTER COLUMN "instrument_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tranche" ALTER COLUMN "instrument_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "zinsperiode_gebucht" ALTER COLUMN "instrument_id" SET NOT NULL;--> statement-breakpoint
DROP INDEX "zinsperiode_gebucht_beteiligung_bis_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "zinsperiode_gebucht_instrument_bis_uq" ON "zinsperiode_gebucht" USING btree ("instrument_id","periode_bis");--> statement-breakpoint
-- Zinsbuchungen (Forderung) und Zinszahlungen (Geldeingang) sind jetzt getrennt: Für jede gebuchte, nicht kapitalisierte und nicht stornierte Zinsbuchung
-- entsteht eine Zinszahlung zum selben Datum und Betrag, damit Journal und Liquidität unverändert bleiben. Die Periodensperre gilt für neue Erfassungen,
-- nicht für diese Übernahme: sie wird nur für den Einfügeschritt abgeschaltet.
ALTER TABLE "vorgang" DISABLE TRIGGER "vorgang_periodensperre";--> statement-breakpoint
INSERT INTO "vorgang" ("beteiligung_id", "instrument_id", "art", "valuta", "betrag", "bemerkung", "beglichen_vorgang_id", "betrag_lokal", "kurs", "kurs_id")
SELECT z."beteiligung_id", z."instrument_id", 'zinszahlung', z."valuta", z."betrag", 'aus Bestand übernommen', z."id", z."betrag_lokal", z."kurs", z."kurs_id"
FROM "vorgang" z
WHERE z."art" = 'zins' AND z."kapitalisiert" = false AND z."storniert_vorgang_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "vorgang" s WHERE s."storniert_vorgang_id" = z."id");--> statement-breakpoint
ALTER TABLE "vorgang" ENABLE TRIGGER "vorgang_periodensperre";
