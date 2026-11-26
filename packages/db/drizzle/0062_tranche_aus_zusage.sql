-- Übernommene Zusagen ohne Tranche (siehe 0058): Je Instrument mit wirksamer Zusage > 0 und ohne jede Tranche entsteht „Tranche 1“ über die gesamte Zusage,
-- geplant zur Valuta der ersten nicht stornierten Zusage. Die Auszahlungen des Instruments (samt Stornozeilen) ohne Tranche werden dieser Tranche zugeordnet.
-- Instrumente, die schon Tranchen haben, bleiben unberührt; wiederholt ausgeführt ändert die Migration nichts mehr, weil dann jede Zusage eine Tranche hat.
-- Übersteigen die Auszahlungen die Zusage (kommt wegen der Prüfung AUSZAHLUNG_UEBER_ZUSAGE nicht vor), wird das Instrument übersprungen und gemeldet.
-- Vorgänge sind unveränderlich (Trigger `vorgang_kein_update_delete`, Migration 0001): der Trigger ist nur um das Setzen von `tranche_id` abgeschaltet und
-- danach wieder eingeschaltet; Betrag, Art, Valuta und Verweise bleiben unberührt. Die Periodensperre greift nur beim Einfügen von Vorgängen und ist hier nicht betroffen.
DO $$
DECLARE
  z RECORD;
  neue_tranche uuid;
BEGIN
  ALTER TABLE "vorgang" DISABLE TRIGGER "vorgang_kein_update_delete";
  FOR z IN
    SELECT
      i."id" AS instrument_id,
      i."beteiligung_id",
      sum(v."betrag") AS zusage,
      COALESCE(
        min(v."valuta") FILTER (WHERE v."storniert_vorgang_id" IS NULL AND NOT EXISTS (SELECT 1 FROM "vorgang" s WHERE s."storniert_vorgang_id" = v."id")),
        min(v."valuta")
      ) AS erste_valuta,
      (SELECT COALESCE(sum(a."betrag"), 0) FROM "vorgang" a WHERE a."instrument_id" = i."id" AND a."art" = 'auszahlung') AS auszahlung
    FROM "instrument" i
    JOIN "vorgang" v ON v."instrument_id" = i."id" AND v."art" = 'zusage'
    WHERE NOT EXISTS (SELECT 1 FROM "tranche" t WHERE t."instrument_id" = i."id")
    GROUP BY i."id", i."beteiligung_id"
    HAVING sum(v."betrag") > 0
    ORDER BY i."id"
  LOOP
    IF z.auszahlung > z.zusage THEN
      RAISE NOTICE 'Instrument % übersprungen: Auszahlungen (%) übersteigen die Zusage (%)', z.instrument_id, z.auszahlung, z.zusage;
      CONTINUE;
    END IF;
    INSERT INTO "tranche" ("beteiligung_id", "instrument_id", "nummer", "bezeichnung", "betrag", "geplant_am")
    VALUES (z.beteiligung_id, z.instrument_id, 1, 'Tranche 1', z.zusage, z.erste_valuta)
    RETURNING "id" INTO neue_tranche;
    UPDATE "vorgang" SET "tranche_id" = neue_tranche
    WHERE "instrument_id" = z.instrument_id AND "art" = 'auszahlung' AND "tranche_id" IS NULL;
  END LOOP;
  ALTER TABLE "vorgang" ENABLE TRIGGER "vorgang_kein_update_delete";
END
$$;
