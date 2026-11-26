-- Fondsbewegungen sind unveränderlich wie Vorgänge: Korrektur nur per Storno (Gegenbuchung mit negiertem Betrag).
-- UPDATE und DELETE sind gesperrt, TRUNCATE bleibt erlaubt (Demo-Daten und Tests dürfen leeren, Entscheidung 14).
CREATE FUNCTION fonds_bewegung_unveraenderlich() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Fondsbewegungen sind unveränderlich (% auf fonds_bewegung); Korrektur nur per Storno', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER fonds_bewegung_kein_update_delete BEFORE UPDATE OR DELETE ON "fonds_bewegung"
  FOR EACH ROW EXECUTE FUNCTION fonds_bewegung_unveraenderlich();--> statement-breakpoint
-- Ein Storno zeigt auf ein existierendes Original, das selbst kein Storno ist, im selben Fonds, mit gleicher Art und negiertem Betrag.
CREATE FUNCTION fonds_bewegung_storno_pruefen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  original "fonds_bewegung"%ROWTYPE;
BEGIN
  IF NEW.storniert_bewegung_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO original FROM "fonds_bewegung" WHERE id = NEW.storniert_bewegung_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Storno verweist auf eine unbekannte Fondsbewegung';
  END IF;
  IF original.storniert_bewegung_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ein Storno kann nicht selbst storniert werden';
  END IF;
  IF NEW.fonds_id <> original.fonds_id THEN
    RAISE EXCEPTION 'Storno muss zum selben Fonds gehören wie die Original-Bewegung';
  END IF;
  IF NEW.art <> original.art THEN
    RAISE EXCEPTION 'Storno muss dieselbe Art haben wie die Original-Bewegung';
  END IF;
  IF NEW.betrag <> -original.betrag THEN
    RAISE EXCEPTION 'Storno-Betrag muss das Negative des Original-Betrags sein';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER fonds_bewegung_storno_pruefen BEFORE INSERT ON "fonds_bewegung"
  FOR EACH ROW EXECUTE FUNCTION fonds_bewegung_storno_pruefen();--> statement-breakpoint
-- Periodensperre auch für Fondsbewegungen (0012 deckt Vorgänge und Bewertungen ab).
CREATE FUNCTION periodensperre_fonds_bewegung() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sperre date;
BEGIN
  SELECT p."gesperrt_bis" INTO sperre FROM "periodensperre" p WHERE p."fonds_id" = NEW."fonds_id";
  IF sperre IS NOT NULL AND NEW."valuta" <= sperre THEN
    RAISE EXCEPTION 'PERIODE_GESPERRT: Valuta % liegt in der gesperrten Periode (gesperrt bis %)', NEW."valuta", sperre
      USING ERRCODE = 'PS001', DETAIL = sperre::text;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER fonds_bewegung_periodensperre BEFORE INSERT ON "fonds_bewegung"
  FOR EACH ROW EXECUTE FUNCTION periodensperre_fonds_bewegung();--> statement-breakpoint
-- Das Journal findet Insolvenzen eines Fonds über das Änderungsprotokoll (Aktion `insolvenz`); der Teilindex hält die Suche klein.
CREATE INDEX "aenderung_insolvenz_idx" ON "aenderung" ("fonds_id", "am") WHERE "aktion" = 'insolvenz';
