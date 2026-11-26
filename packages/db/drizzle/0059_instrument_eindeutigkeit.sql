-- Eindeutigkeit je (Fonds, Unternehmen) statt je (Fonds, Unternehmen, Instrument), Konditionen und Wandlung je Instrument (docs/portfolio-modell.md, Phase 2).
-- Bis hierher legte die Wandlung eine zweite Beteiligung (Eigenkapital) desselben Fonds und Unternehmens an. Solche Dubletten werden vor dem neuen
-- Index zusammengeführt: Instrumente, Vorgänge, Bewertungen, Dokumente und alle weiteren Verweise (jede Spalte mit Fremdschlüssel auf `beteiligung`)
-- wandern zur ältesten Beteiligung, die übrigen werden gelöscht. Die Wandlung nennt danach auf beiden Seiten dieselbe Beteiligung. Gibt es keine
-- Dubletten, tut der Block nichts. Ein Konflikt (z. B. zwei freigegebene Bewertungen zum selben Stichtag) bricht die Migration mit einer klaren
-- Meldung ab; dann sind die Beteiligungen von Hand zusammenzuführen, bevor die Migration erneut läuft.
DROP INDEX "beteiligung_fonds_organisation_instrument_uq";--> statement-breakpoint
DROP INDEX "darlehen_kondition_beteiligung_ab_uq";--> statement-breakpoint
DROP INDEX "wandlung_darlehen_uq";--> statement-breakpoint
DO $$
DECLARE
  g record;
  d record;
  fk record;
  behalten uuid;
  hauptart "instrument_art";
  hauptfelder jsonb;
BEGIN
  FOR g IN SELECT "fonds_id", "organisation_id" FROM "beteiligung" GROUP BY "fonds_id", "organisation_id" HAVING count(*) > 1 LOOP
    SELECT "id" INTO behalten FROM "beteiligung" WHERE "fonds_id" = g."fonds_id" AND "organisation_id" = g."organisation_id" ORDER BY "erstellt_am", "id" LIMIT 1;
    FOR d IN SELECT "id" FROM "beteiligung" WHERE "fonds_id" = g."fonds_id" AND "organisation_id" = g."organisation_id" AND "id" <> behalten ORDER BY "erstellt_am", "id" LOOP
      -- Die frühere Wandlung bewertete beide Beteiligungen am Cut-off (Darlehen 0, Eigenkapital zu Anschaffungskosten). In einer Beteiligung zählt nur
      -- die des Eigenkapitals: Die Bewertung des erloschenen Darlehens wird als ersetzt markiert, damit der Index je Stichtag nicht verletzt wird.
      UPDATE "bewertung" w SET "status" = 'ersetzt', "ersetzt_am" = now()
      FROM "wandlung" wl
      WHERE wl."darlehen_beteiligung_id" IN (behalten, d."id") AND wl."ziel_beteiligung_id" IN (behalten, d."id") AND wl."darlehen_beteiligung_id" <> wl."ziel_beteiligung_id"
        AND w."beteiligung_id" = wl."darlehen_beteiligung_id" AND w."stichtag" = wl."cutoff" AND w."status" = 'freigegeben'
        AND EXISTS (SELECT 1 FROM "bewertung" z WHERE z."beteiligung_id" = wl."ziel_beteiligung_id" AND z."stichtag" = wl."cutoff" AND z."status" = 'freigegeben');
      FOR fk IN
        SELECT con.conrelid::regclass::text AS tabelle, att.attname AS spalte
        FROM pg_constraint con
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
        WHERE con.contype = 'f' AND con.confrelid = 'public.beteiligung'::regclass AND array_length(con.conkey, 1) = 1
      LOOP
        -- Unveränderliche Tabellen (Vorgänge, freigegebene Bewertungen) schützen Trigger; sie werden nur für diese Umhängung abgeschaltet.
        EXECUTE format('ALTER TABLE %s DISABLE TRIGGER USER', fk.tabelle);
        BEGIN
          EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', fk.tabelle, fk.spalte, fk.spalte) USING behalten, d."id";
        EXCEPTION WHEN unique_violation THEN
          RAISE EXCEPTION 'Beteiligungen (Fonds %, Unternehmen %) lassen sich nicht zusammenführen: Konflikt in %.%. Bitte von Hand zusammenführen und die Migration wiederholen.', g."fonds_id", g."organisation_id", fk.tabelle, fk.spalte;
        END;
        EXECUTE format('ALTER TABLE %s ENABLE TRIGGER USER', fk.tabelle);
      END LOOP;
      UPDATE "beteiligung" k SET
        "felder" = (SELECT x."felder" FROM "beteiligung" x WHERE x."id" = d."id") || k."felder",
        "erstinvestment" = least(k."erstinvestment", (SELECT x."erstinvestment" FROM "beteiligung" x WHERE x."id" = d."id")),
        "deal_id" = coalesce(k."deal_id", (SELECT x."deal_id" FROM "beteiligung" x WHERE x."id" = d."id")),
        "waehrung" = coalesce(k."waehrung", (SELECT x."waehrung" FROM "beteiligung" x WHERE x."id" = d."id"))
      WHERE k."id" = behalten;
      DELETE FROM "beteiligung" WHERE "id" = d."id";
    END LOOP;
    -- Status der Beteiligung und Spiegel des Hauptinstruments (erstes aktives, sonst zuletzt angelegtes) nachziehen.
    SELECT i."art", i."felder" INTO hauptart, hauptfelder FROM "instrument" i WHERE i."beteiligung_id" = behalten
      ORDER BY (i."status" <> 'aktiv'), CASE WHEN i."status" = 'aktiv' THEN i."erstellt_am" END ASC, i."erstellt_am" DESC, i."id" LIMIT 1;
    UPDATE "beteiligung" k SET
      "status" = CASE WHEN EXISTS (SELECT 1 FROM "instrument" i WHERE i."beteiligung_id" = k."id" AND i."status" = 'aktiv') THEN 'aktiv'::"beteiligung_status" ELSE k."status" END,
      "instrument" = coalesce(hauptart, k."instrument"),
      "instrument_felder" = coalesce(hauptfelder, k."instrument_felder")
    WHERE k."id" = behalten;
  END LOOP;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "beteiligung_fonds_organisation_uq" ON "beteiligung" USING btree ("fonds_id","organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "darlehen_kondition_instrument_ab_uq" ON "darlehen_kondition" USING btree ("instrument_id","gueltig_ab");--> statement-breakpoint
CREATE UNIQUE INDEX "wandlung_quell_instrument_uq" ON "wandlung" USING btree ("quell_instrument_id");
