ALTER TABLE "import_befund" ADD COLUMN "blatt_name" text;--> statement-breakpoint
ALTER TABLE "import_befund" ADD COLUMN "params" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Bestehende Befunde: der bisherige Wert in `blatt` war der Name aus der Datei; er wandert nach `blatt_name`, `blatt` wird der Schlüssel (wo erkennbar).
UPDATE "import_befund" SET "blatt_name" = "blatt" WHERE "blatt" IS NOT NULL;--> statement-breakpoint
UPDATE "import_befund" SET "blatt" = CASE lower("blatt_name")
  WHEN 'fonds' THEN 'fonds' WHEN 'funds' THEN 'fonds'
  WHEN 'organisationen' THEN 'organisationen' WHEN 'organisations' THEN 'organisationen'
  WHEN 'personen' THEN 'personen' WHEN 'persons' THEN 'personen'
  WHEN 'beteiligungen' THEN 'beteiligungen' WHEN 'holdings' THEN 'beteiligungen'
  WHEN 'finanzierungsrunden' THEN 'finanzierungsrunden' WHEN 'financing rounds' THEN 'finanzierungsrunden'
  WHEN 'rundenpositionen' THEN 'rundenpositionen' WHEN 'round positions' THEN 'rundenpositionen'
  WHEN 'vorgänge' THEN 'vorgaenge' WHEN 'vorgaenge' THEN 'vorgaenge' WHEN 'transactions' THEN 'vorgaenge'
  WHEN 'bewertungen' THEN 'bewertungen' WHEN 'valuations' THEN 'bewertungen'
  WHEN 'konditionen' THEN 'konditionen' WHEN 'terms' THEN 'konditionen'
  WHEN 'fondsbewegungen' THEN 'fondsbewegungen' WHEN 'fund movements' THEN 'fondsbewegungen'
  WHEN 'kontrollsummen' THEN 'kontrollsummen' WHEN 'control totals' THEN 'kontrollsummen'
  ELSE NULL END
WHERE "blatt_name" IS NOT NULL;
