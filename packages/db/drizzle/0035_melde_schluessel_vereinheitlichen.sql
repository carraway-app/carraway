-- Förder- und Buchhaltungsschlüssel an einer Stelle (Zusammenführung der Etappen 14 und 15).
-- Schlüssel, Buchungskreis und Förderprogramm einer Beteiligung stehen nur noch in `beteiligung_buchhaltung`; das Förderprogramm ist ein
-- Verweis auf die Tabelle `foerderprogramm`. Die Meldeart (Kategorie für die Meldeberichte) gehört zur Mittelart des Fonds. `beteiligung_meldezuordnung`
-- entfällt: Ihre Werte wandern in `beteiligung_buchhaltung` (vorhandene Werte dort gelten, Lücken füllt die alte Tabelle). Die frühere Mittelart je
-- Beteiligung hat in der Quotenlogik des Fonds keine Entsprechung und entfällt ohne Übernahme.
ALTER TABLE "beteiligung_buchhaltung" ADD COLUMN "foerderprogramm_id" uuid;--> statement-breakpoint
ALTER TABLE "fonds_mittelart" ADD COLUMN "melde_art" "melde_mittelart";--> statement-breakpoint
ALTER TABLE "beteiligung_buchhaltung" ADD CONSTRAINT "beteiligung_buchhaltung_foerderprogramm_id_foerderprogramm_id_fk" FOREIGN KEY ("foerderprogramm_id") REFERENCES "public"."foerderprogramm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Freitext der Buchhaltung auf Förderprogramme abbilden: gleiche Bezeichnung = vorhandenes Programm, sonst neues Programm mit abgeleitetem Schlüssel.
DO $$
DECLARE
  r record;
  pid uuid;
  s text;
BEGIN
  FOR r IN SELECT DISTINCT btrim("foerderprogramm") AS bezeichnung FROM "beteiligung_buchhaltung" WHERE btrim(coalesce("foerderprogramm", '')) <> '' ORDER BY 1 LOOP
    SELECT p."id" INTO pid FROM "foerderprogramm" p WHERE p."bezeichnung" = r.bezeichnung ORDER BY p."erstellt_am", p."id" LIMIT 1;
    IF pid IS NULL THEN
      s := lower(r.bezeichnung);
      s := replace(replace(replace(replace(s, 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss');
      s := btrim(regexp_replace(s, '[^a-z0-9]+', '_', 'g'), '_');
      s := left(s, 50);
      IF s !~ '^[a-z]' THEN s := 'p_' || s; END IF;
      IF EXISTS (SELECT 1 FROM "foerderprogramm" WHERE "schluessel" = s) OR length(s) < 2 THEN
        s := left(s, 50) || '_' || left(md5(r.bezeichnung), 8);
      END IF;
      INSERT INTO "foerderprogramm" ("schluessel", "bezeichnung", "erstellt_von") VALUES (s, r.bezeichnung, 'system:migration') RETURNING "id" INTO pid;
    END IF;
    UPDATE "beteiligung_buchhaltung" SET "foerderprogramm_id" = pid WHERE btrim(coalesce("foerderprogramm", '')) = r.bezeichnung;
  END LOOP;
END;
$$;--> statement-breakpoint
-- Meldeschlüssel der Etappe 15 übernehmen: vorhandene Werte der Buchhaltung behalten Vorrang, leere Felder füllt die alte Tabelle.
INSERT INTO "beteiligung_buchhaltung" ("beteiligung_id", "projektnummer", "vertragsnummer", "partnernummer", "buchungskreis", "foerderprogramm_id", "geaendert_von", "geaendert_am")
SELECT m."beteiligung_id", m."projektnummer", m."vertragsnummer", m."partnernummer", m."buchungskreis", m."foerderprogramm_id", m."geaendert_von", m."geaendert_am"
FROM "beteiligung_meldezuordnung" m
ON CONFLICT ("beteiligung_id") DO UPDATE SET
  "projektnummer" = coalesce("beteiligung_buchhaltung"."projektnummer", EXCLUDED."projektnummer"),
  "vertragsnummer" = coalesce("beteiligung_buchhaltung"."vertragsnummer", EXCLUDED."vertragsnummer"),
  "partnernummer" = coalesce("beteiligung_buchhaltung"."partnernummer", EXCLUDED."partnernummer"),
  "buchungskreis" = coalesce("beteiligung_buchhaltung"."buchungskreis", EXCLUDED."buchungskreis"),
  "foerderprogramm_id" = coalesce("beteiligung_buchhaltung"."foerderprogramm_id", EXCLUDED."foerderprogramm_id");--> statement-breakpoint
ALTER TABLE "beteiligung_buchhaltung" DROP COLUMN "foerderprogramm";--> statement-breakpoint
DROP TABLE "beteiligung_meldezuordnung";
