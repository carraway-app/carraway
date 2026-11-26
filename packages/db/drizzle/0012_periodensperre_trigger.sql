CREATE FUNCTION periodensperre_vorgang() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sperre date;
BEGIN
  SELECT p."gesperrt_bis" INTO sperre
  FROM "beteiligung" b JOIN "periodensperre" p ON p."fonds_id" = b."fonds_id"
  WHERE b."id" = NEW."beteiligung_id";
  IF sperre IS NOT NULL AND NEW."valuta" <= sperre THEN
    RAISE EXCEPTION 'PERIODE_GESPERRT: Valuta % liegt in der gesperrten Periode (gesperrt bis %)', NEW."valuta", sperre
      USING ERRCODE = 'PS001', DETAIL = sperre::text;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE FUNCTION periodensperre_bewertung() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sperre date;
BEGIN
  SELECT p."gesperrt_bis" INTO sperre
  FROM "beteiligung" b JOIN "periodensperre" p ON p."fonds_id" = b."fonds_id"
  WHERE b."id" = NEW."beteiligung_id";
  IF sperre IS NOT NULL AND (NEW."stichtag" <= sperre OR (TG_OP = 'UPDATE' AND OLD."stichtag" <= sperre)) THEN
    RAISE EXCEPTION 'PERIODE_GESPERRT: Stichtag % liegt in der gesperrten Periode (gesperrt bis %)', NEW."stichtag", sperre
      USING ERRCODE = 'PS001', DETAIL = sperre::text;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER vorgang_periodensperre BEFORE INSERT ON "vorgang"
  FOR EACH ROW EXECUTE FUNCTION periodensperre_vorgang();--> statement-breakpoint
-- Eine Bewertung in der gesperrten Periode darf weder angelegt noch (per Upsert) überschrieben werden.
CREATE TRIGGER bewertung_periodensperre BEFORE INSERT OR UPDATE ON "bewertung"
  FOR EACH ROW EXECUTE FUNCTION periodensperre_bewertung();
