ALTER TABLE "finanzierungsrunde" ADD CONSTRAINT "finanzierungsrunde_post_nicht_unter_pre" CHECK ("post_money" >= "pre_money");--> statement-breakpoint
CREATE FUNCTION snapshot_auftrag_aus_vorgang() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "snapshot_auftrag" ("fonds_id")
  SELECT DISTINCT b."fonds_id" FROM neu n JOIN "beteiligung" b ON b."id" = n."beteiligung_id"
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE FUNCTION snapshot_auftrag_aus_bewertung() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "snapshot_auftrag" ("fonds_id")
  SELECT DISTINCT b."fonds_id" FROM neu n JOIN "beteiligung" b ON b."id" = n."beteiligung_id"
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE FUNCTION snapshot_auftrag_aus_bewegung() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "snapshot_auftrag" ("fonds_id")
  SELECT DISTINCT n."fonds_id" FROM neu n
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER vorgang_snapshot_auftrag AFTER INSERT ON "vorgang"
  REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION snapshot_auftrag_aus_vorgang();--> statement-breakpoint
CREATE TRIGGER bewertung_snapshot_auftrag AFTER INSERT ON "bewertung"
  REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION snapshot_auftrag_aus_bewertung();--> statement-breakpoint
CREATE TRIGGER fonds_bewegung_snapshot_auftrag AFTER INSERT ON "fonds_bewegung"
  REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION snapshot_auftrag_aus_bewegung();--> statement-breakpoint
CREATE FUNCTION snapshot_auftrag_aus_beteiligung() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "snapshot_auftrag" ("fonds_id")
  SELECT DISTINCT n."fonds_id" FROM neu n
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER beteiligung_snapshot_auftrag AFTER INSERT ON "beteiligung"
  REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION snapshot_auftrag_aus_beteiligung();
