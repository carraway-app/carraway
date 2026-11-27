ALTER TABLE "provider_item" ADD COLUMN "skip_reason" text;--> statement-breakpoint
ALTER TABLE "provider_run" ADD COLUMN "skip_reasons" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_source" ADD COLUMN "source_stage" text;--> statement-breakpoint
-- Older mode changes released ownership but left the sync archive on the local record.
WITH released AS (
  SELECT s.local_id, s.resource, max(a.am) AS stopped_at
  FROM provider_source s
  JOIN aenderung a ON a.tabelle = 'provider_connection' AND a.datensatz_id = s.connection_id
    AND a.aktion = 'provider_mode' AND a.nachher->>'mode' = 'import'
  WHERE s.archived AND NOT s.mirrored
    AND NOT EXISTS (SELECT 1 FROM provider_source owner WHERE owner.resource = s.resource AND owner.local_id = s.local_id AND owner.mirrored)
  GROUP BY s.resource, s.local_id
), restored_organizations AS (
  UPDATE organisation o SET archiviert_am = NULL FROM released r
  WHERE r.resource = 'organization' AND r.local_id = o.id AND o.archiviert_am <= r.stopped_at AND o.zusammengefuehrt_in IS NULL
    AND NOT EXISTS (SELECT 1 FROM aenderung a WHERE a.tabelle = 'organisation' AND a.datensatz_id = o.id
      AND a.aktion = 'archivieren' AND (a.nachher->>'archiviertAm')::timestamptz = o.archiviert_am)
), restored_people AS (
  UPDATE person p SET archiviert_am = NULL FROM released r
  WHERE r.resource = 'person' AND r.local_id = p.id AND p.archiviert_am <= r.stopped_at AND p.zusammengefuehrt_in IS NULL
    AND NOT EXISTS (SELECT 1 FROM aenderung a WHERE a.tabelle = 'person' AND a.datensatz_id = p.id
      AND a.aktion = 'archivieren' AND (a.nachher->>'archiviertAm')::timestamptz = p.archiviert_am)
)
UPDATE provider_source SET archived = false WHERE archived AND NOT mirrored;
