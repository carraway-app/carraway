-- Ein Entwurf bucht nichts: Auch in einer inzwischen gesperrten Periode darf er verworfen werden (z. B. eine offene Bewertungsrunde
-- aufräumen). Anlegen, Freigeben und Ersetzen von Bewertungen mit Stichtag am oder vor dem Sperrdatum bleiben gesperrt, ebenso jede
-- Änderung einer freigegebenen Bewertung in gesperrter Periode; Übergänge außerhalb der Sperre sind nicht betroffen.
CREATE OR REPLACE FUNCTION periodensperre_bewertung() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sperre date;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."status" = 'entwurf' AND NEW."status" = 'verworfen' AND NEW."stichtag" = OLD."stichtag" THEN
    RETURN NEW;
  END IF;
  SELECT p."gesperrt_bis" INTO sperre
  FROM "beteiligung" b JOIN "periodensperre" p ON p."fonds_id" = b."fonds_id"
  WHERE b."id" = NEW."beteiligung_id";
  IF sperre IS NOT NULL AND (NEW."stichtag" <= sperre OR (TG_OP = 'UPDATE' AND OLD."stichtag" <= sperre)) THEN
    RAISE EXCEPTION 'PERIODE_GESPERRT: Stichtag % liegt in der gesperrten Periode (gesperrt bis %)', NEW."stichtag", sperre
      USING ERRCODE = 'PS001', DETAIL = sperre::text;
  END IF;
  RETURN NEW;
END;
$$;
