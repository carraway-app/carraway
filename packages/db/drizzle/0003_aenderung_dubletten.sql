-- Änderungsprotokoll: nur anhängend, wie bei "vorgang". TRUNCATE bleibt erlaubt (Tests, Demo-Daten).
CREATE FUNCTION aenderung_unveraenderlich() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Das Änderungsprotokoll ist nur anhängend (% auf aenderung)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER aenderung_kein_update_delete BEFORE UPDATE OR DELETE ON "aenderung"
  FOR EACH ROW EXECUTE FUNCTION aenderung_unveraenderlich();--> statement-breakpoint
-- Dublettenprüfung: Trigramm-Ähnlichkeit auf dem normalisierten Namen.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
-- Kleinbuchstaben, Rechtsformen und Satzzeichen entfernt, Leerraum vereinheitlicht.
CREATE FUNCTION organisation_name_normalisiert(name text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
    regexp_replace(
      regexp_replace(lower(name), 'haftungsbeschränkt', ' ', 'g'),
      '[^a-z0-9äöüß]+', ' ', 'g'),
    '\m(gmbh|mbh|ag|ug|se|kg|ltd|inc|co)\M', ' ', 'g'), '\s+', ' ', 'g'))
$$;--> statement-breakpoint
CREATE INDEX "organisation_name_trgm_idx" ON "organisation"
  USING gin ((organisation_name_normalisiert("name")) gin_trgm_ops);
