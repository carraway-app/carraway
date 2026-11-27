ALTER TABLE "external_funding_round" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "external_funding_round" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_funding_round" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "provider_suggestion" ADD COLUMN "metric_value_id" uuid;--> statement-breakpoint
ALTER TABLE "provider_suggestion" ADD CONSTRAINT "provider_suggestion_metric_value_id_kennzahl_wert_id_fk" FOREIGN KEY ("metric_value_id") REFERENCES "public"."kennzahl_wert"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- A website has no stable announcement ID. Bind each decision to the reported facts and source.
CREATE FUNCTION funding_mention_id(announced text, kind text, reported_amount numeric, currency text, investors jsonb, source_url text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(announced, lower(btrim(kind)), round(reported_amount, 2),
    currency, (SELECT jsonb_agg(name ORDER BY name COLLATE "C") FROM jsonb_array_elements_text(investors) AS i(name)), source_url)::text, 'UTF8')), 'hex')
$$;
--> statement-breakpoint
UPDATE external_funding_round
SET external_id = funding_mention_id(to_char(announced_on, 'YYYY-MM-DD'), round_type, amount, currency, investors, source_url)
WHERE provider = 'firecrawl';
--> statement-breakpoint
-- The original import wrote both audit entries with the same transaction timestamp.
UPDATE provider_suggestion s SET metric_value_id = w.id
FROM aenderung review
JOIN aenderung creation ON creation.am = review.am AND creation.akteur = review.akteur
  AND creation.tabelle = 'kennzahl_wert' AND creation.aktion = 'anlegen'
JOIN kennzahl_wert w ON w.id = creation.datensatz_id AND w.quelle = 'import'
JOIN beteiligung b ON b.id = w.beteiligung_id
WHERE review.tabelle = 'provider_suggestion' AND review.aktion = 'provider_reviewed'
  AND review.nachher->>'decision' = 'accepted' AND s.status = 'accepted' AND review.datensatz_id = s.id
  AND b.organisation_id = s.organization_id AND w.quellenangabe = concat_ws(' · ', s.provider, s.reference, s.field, s.source_url);
--> statement-breakpoint
UPDATE provider_suggestion s SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, metric_value_id = NULL
FROM kennzahl_wert w WHERE s.metric_value_id = w.id AND s.current AND w.verworfen_am IS NOT NULL;
