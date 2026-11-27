-- Neuer Bereich `einzelzuteilungen` (Einzelzuteilungen der Mitarbeiterbeteiligung, Entscheidung 522). Rollen mit allen bisherigen Bereichen
-- bekommen ihn dazu: Sie sahen die Zuteilungen schon bisher, und der Änderungsabruf (`alle`) verlangt jeden Bereich. Alle übrigen Rollen
-- bekommen ihn nicht (Datensparsamkeit); Verwalter können ihn je Rolle zuschalten.
UPDATE "rechterolle"
SET "bereiche" = array_append("bereiche", 'einzelzuteilungen')
WHERE "bereiche" @> ARRAY['portfolio', 'finanzen', 'kennzahlen', 'berichte', 'meldewesen', 'dealflow', 'kontakte', 'dokumente', 'daten', 'fondsverwaltung']::text[]
  AND NOT ('einzelzuteilungen' = ANY ("bereiche"));--> statement-breakpoint
-- Bereichsauswahl je Fonds: eine Gruppe, die an einem Fonds alle bisherigen Bereiche gewählt hat, behält dort ebenfalls alles.
UPDATE "nutzergruppe_fonds"
SET "bereiche" = array_append("bereiche", 'einzelzuteilungen')
WHERE "bereiche" IS NOT NULL
  AND "bereiche" @> ARRAY['portfolio', 'finanzen', 'kennzahlen', 'berichte', 'meldewesen', 'dealflow', 'kontakte', 'dokumente', 'daten', 'fondsverwaltung']::text[]
  AND NOT ('einzelzuteilungen' = ANY ("bereiche"));
