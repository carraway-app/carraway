-- Suche und Dublettenerkennung (Etappe 7): Trigramm-Indizes auf den kleingeschriebenen Namen, exakte Suche nach E-Mail.
CREATE INDEX "organisation_name_lower_trgm_idx" ON "organisation" USING gin ((lower("name")) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "person_name_trgm_idx" ON "person" USING gin ((lower("vorname" || ' ' || "nachname")) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "person_email_lower_idx" ON "person" USING btree ((lower("email"))) WHERE "email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "deal_titel_trgm_idx" ON "deal" USING gin ((lower("titel")) gin_trgm_ops);--> statement-breakpoint
-- Änderungsabfrage (Etappe 6): Beschlussvorlagen und Beziehungen zu einem Fonds gehören zu diesem Fonds. Rollen und Beziehungen zwischen Organisationen bleiben ohne Fonds.
CREATE OR REPLACE FUNCTION aenderung_fonds_von(tabelle text, datensatz uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT CASE tabelle
    WHEN 'fonds' THEN datensatz
    WHEN 'periodensperre' THEN datensatz
    WHEN 'fonds_bewegung' THEN (SELECT x.fonds_id FROM fonds_bewegung x WHERE x.id = datensatz)
    WHEN 'fonds_zeichnung' THEN (SELECT x.fonds_id FROM fonds_zeichnung x WHERE x.id = datensatz)
    WHEN 'beteiligung' THEN (SELECT x.fonds_id FROM beteiligung x WHERE x.id = datensatz)
    WHEN 'vorgang' THEN (SELECT b.fonds_id FROM vorgang x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'meilenstein' THEN (SELECT b.fonds_id FROM meilenstein x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'forderung' THEN (SELECT b.fonds_id FROM forderung x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'darlehen_kondition' THEN (SELECT b.fonds_id FROM darlehen_kondition x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'jahresueberschuss' THEN (SELECT b.fonds_id FROM jahresueberschuss x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'bewertung' THEN (SELECT b.fonds_id FROM bewertung x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'verkauf' THEN (SELECT b.fonds_id FROM verkauf x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = datensatz)
    WHEN 'kaufpreisanpassung' THEN (SELECT b.fonds_id FROM kaufpreisanpassung x JOIN verkauf v ON v.id = x.verkauf_id JOIN beteiligung b ON b.id = v.beteiligung_id WHERE x.id = datensatz)
    WHEN 'wandlung' THEN (SELECT b.fonds_id FROM wandlung x JOIN beteiligung b ON b.id = x.darlehen_beteiligung_id WHERE x.id = datensatz)
    WHEN 'zinslauf' THEN (SELECT x.fonds_id FROM zinslauf x WHERE x.id = datensatz)
    WHEN 'bewertungsrunde' THEN (SELECT x.fonds_id FROM bewertungsrunde x WHERE x.id = datensatz)
    WHEN 'bericht' THEN (SELECT coalesce(x.fonds_id, (SELECT b.fonds_id FROM beteiligung b WHERE b.id = x.beteiligung_id)) FROM bericht x WHERE x.id = datensatz)
    WHEN 'deal' THEN (SELECT x.fonds_id FROM deal x WHERE x.id = datensatz)
    WHEN 'deal_phasenwechsel' THEN (SELECT d.fonds_id FROM deal_phasenwechsel x JOIN deal d ON d.id = x.deal_id WHERE x.id = datensatz)
    WHEN 'beschluss' THEN (SELECT d.fonds_id FROM beschluss x JOIN deal d ON d.id = x.deal_id WHERE x.id = datensatz)
    WHEN 'aktivitaet' THEN (SELECT d.fonds_id FROM aktivitaet x JOIN deal d ON d.id = x.deal_id WHERE x.id = datensatz)
    WHEN 'rundenposition' THEN (SELECT x.fonds_id FROM rundenposition x WHERE x.id = datensatz)
    WHEN 'beschlussvorlage' THEN (SELECT x.fonds_id FROM beschlussvorlage x WHERE x.id = datensatz)
    WHEN 'organisationsbeziehung' THEN (SELECT x.fonds_id FROM organisationsbeziehung x WHERE x.id = datensatz)
    ELSE NULL
  END
$$;--> statement-breakpoint
-- Gelöschte Datensätze finden über die Tabelle keinen Fonds mehr: dann gilt die Fonds-ID aus dem protokollierten Stand (vorher, sonst nachher),
-- als `fondsId` (Drizzle) oder `fonds_id` (SQL). Ohne diese Rückfalllösung wären gelöschte Fondsdaten für jede Person sichtbar.
CREATE FUNCTION aenderung_fonds_aus_staenden(vorher jsonb, nachher jsonb) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN w ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN w::uuid END
  FROM (SELECT coalesce(vorher->>'fondsId', vorher->>'fonds_id', nachher->>'fondsId', nachher->>'fonds_id') AS w) x
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION aenderung_fonds_setzen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fonds_id IS NULL THEN
    NEW.fonds_id := coalesce(aenderung_fonds_von(NEW.tabelle, NEW.datensatz_id), aenderung_fonds_aus_staenden(NEW.vorher, NEW.nachher));
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
ALTER TABLE "aenderung" DISABLE TRIGGER "aenderung_kein_update_delete";--> statement-breakpoint
UPDATE "aenderung" SET "fonds_id" = coalesce(aenderung_fonds_von("tabelle", "datensatz_id"), aenderung_fonds_aus_staenden("vorher", "nachher")) WHERE "fonds_id" IS NULL;--> statement-breakpoint
ALTER TABLE "aenderung" ENABLE TRIGGER "aenderung_kein_update_delete";
