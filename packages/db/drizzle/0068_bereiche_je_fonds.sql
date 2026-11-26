ALTER TABLE "nutzergruppe" ADD COLUMN "bereiche_je_fonds" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "nutzergruppe_fonds" ADD COLUMN "bereiche" text[];--> statement-breakpoint
ALTER TABLE "rechterolle" ADD COLUMN "bereich_stufen" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rechterolle" ADD CONSTRAINT "rechterolle_bereich_stufen_gueltig" CHECK (jsonb_typeof("rechterolle"."bereich_stufen") = 'object' AND NOT jsonb_path_exists("rechterolle"."bereich_stufen", '$.* ? (@ != "betrachter" && @ != "bearbeiter" && @ != "freigeber" && @ != "verwalter")'));--> statement-breakpoint
-- Überführung: Es ändern sich keine Rechte. Bestehende Gruppen behalten `bereiche_je_fonds = false` (Bereiche gelten fondsübergreifend wie bisher),
-- bestehende Rollen haben keine Grenze je Bereich (`bereich_stufen = {}`), und an `nutzergruppe_fonds` steht keine Auswahl von Bereichen.
-- Wirksame Stufe je Person, Fonds und Bereich (docs/rechte-modell.md, „Auflösung“). `bereich` leer = alle Bereiche (Person ohne Gruppe).
-- 1. Fondsübergreifende Gruppen (wie bisher): Stufe am Fonds = eigene Fondsrolle, sonst höchste Stufe dieser Gruppen am Fonds; Bereiche =
--    Vereinigung ihrer Rollen, jeweils höchstens bis zur Grenze der Rolle für den Bereich.
-- 2. Gruppen mit Bereichen je Fonds: nur an ihren Fonds, je Fonds die gewählten Bereiche, Stufe = Minimum aus Stufe der Gruppe und Grenze der Rolle.
-- 3. Eine eigene Fondsrolle (Ausnahme) setzt die Stufe am Fonds, auch wenn sie niedriger ist; sie bringt keine Bereiche mit, sondern gilt für die
--    Bereiche aus 1 und die Bereiche aus 2 an diesem Fonds, jeweils bis zur Grenze der Rolle. Globale Verwalter stehen nicht in der Sicht.
CREATE VIEW "wirksames_bereichsrecht" AS
WITH
  gruppe_fonds AS NOT MATERIALIZED (
    SELECT nf."gruppe_id", nf."fonds_id", nf."bereiche" FROM "nutzergruppe_fonds" nf
    UNION ALL
    SELECT ng."id", f."id", NULL::text[]
    FROM "nutzergruppe" ng CROSS JOIN "fonds" f
    WHERE NOT ng."fonds_beschraenkt"
      AND COALESCE((SELECT e."fonds_offen" FROM "rechte_einstellung" e WHERE e."id" = 1), true)
      AND NOT EXISTS (SELECT 1 FROM "nutzergruppe_fonds" nf WHERE nf."gruppe_id" = ng."id" AND nf."fonds_id" = f."id")
  ),
  rolle_bereich AS NOT MATERIALIZED (
    SELECT gr."gruppe_id", b."bereich", max(COALESCE((r."bereich_stufen" ->> b."bereich")::"fonds_rolle", 'verwalter'::"fonds_rolle")) AS "deckel"
    FROM "nutzergruppe_rolle" gr
    JOIN "rechterolle" r ON r."id" = gr."rolle_id"
    CROSS JOIN LATERAL unnest(r."bereiche") AS b("bereich")
    GROUP BY gr."gruppe_id", b."bereich"
  ),
  mitglied AS NOT MATERIALIZED (
    SELECT m."benutzer_id", ng."id" AS "gruppe_id", ng."stufe", ng."bereiche_je_fonds"
    FROM "nutzergruppe_mitglied" m JOIN "nutzergruppe" ng ON ng."id" = m."gruppe_id"
  ),
  pool AS NOT MATERIALIZED (
    SELECT m."benutzer_id", rb."bereich", max(rb."deckel") AS "deckel"
    FROM mitglied m JOIN rolle_bereich rb ON rb."gruppe_id" = m."gruppe_id"
    WHERE NOT m."bereiche_je_fonds"
    GROUP BY m."benutzer_id", rb."bereich"
  ),
  stufe_alt AS NOT MATERIALIZED (
    SELECT m."benutzer_id", gf."fonds_id", max(m."stufe") AS "stufe"
    FROM mitglied m JOIN gruppe_fonds gf ON gf."gruppe_id" = m."gruppe_id"
    WHERE NOT m."bereiche_je_fonds"
    GROUP BY m."benutzer_id", gf."fonds_id"
  ),
  genau AS NOT MATERIALIZED (
    SELECT m."benutzer_id", gf."fonds_id", rb."bereich", max(LEAST(m."stufe", rb."deckel")) AS "stufe", max(rb."deckel") AS "deckel"
    FROM mitglied m
    JOIN gruppe_fonds gf ON gf."gruppe_id" = m."gruppe_id"
    JOIN rolle_bereich rb ON rb."gruppe_id" = m."gruppe_id"
    WHERE m."bereiche_je_fonds" AND (gf."bereiche" IS NULL OR rb."bereich" = ANY(gf."bereiche"))
    GROUP BY m."benutzer_id", gf."fonds_id", rb."bereich"
  )
SELECT r."benutzer_id", r."fonds_id", NULL::text AS "bereich", r."rolle"
FROM "fondsrolle" r
WHERE NOT EXISTS (SELECT 1 FROM "nutzergruppe_mitglied" m WHERE m."benutzer_id" = r."benutzer_id")
UNION ALL
SELECT r."benutzer_id", r."fonds_id", k."bereich", LEAST(r."rolle", max(k."deckel")) AS "rolle"
FROM "fondsrolle" r
JOIN (
  SELECT p."benutzer_id", NULL::uuid AS "fonds_id", p."bereich", p."deckel" FROM pool p
  UNION ALL
  SELECT g."benutzer_id", g."fonds_id", g."bereich", g."deckel" FROM genau g
) k ON k."benutzer_id" = r."benutzer_id" AND (k."fonds_id" IS NULL OR k."fonds_id" = r."fonds_id")
GROUP BY r."benutzer_id", r."fonds_id", k."bereich", r."rolle"
UNION ALL
SELECT x."benutzer_id", x."fonds_id", x."bereich", max(x."stufe") AS "rolle"
FROM (
  SELECT s."benutzer_id", s."fonds_id", p."bereich", LEAST(s."stufe", p."deckel") AS "stufe"
  FROM stufe_alt s JOIN pool p ON p."benutzer_id" = s."benutzer_id"
  UNION ALL
  SELECT g."benutzer_id", g."fonds_id", g."bereich", g."stufe" FROM genau g
) x
WHERE NOT EXISTS (SELECT 1 FROM "fondsrolle" d WHERE d."benutzer_id" = x."benutzer_id" AND d."fonds_id" = x."fonds_id")
GROUP BY x."benutzer_id", x."fonds_id", x."bereich";
