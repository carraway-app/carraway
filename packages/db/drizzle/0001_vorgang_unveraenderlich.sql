ALTER TABLE "vorgang" ADD CONSTRAINT "vorgang_betrag_nicht_null" CHECK ("betrag" <> 0);--> statement-breakpoint
CREATE FUNCTION vorgang_unveraenderlich() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Vorgänge sind unveränderlich (% auf vorgang); Korrektur nur per Storno', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER vorgang_kein_update_delete BEFORE UPDATE OR DELETE ON "vorgang"
  FOR EACH ROW EXECUTE FUNCTION vorgang_unveraenderlich();--> statement-breakpoint
CREATE FUNCTION vorgang_storno_pruefen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  original "vorgang"%ROWTYPE;
BEGIN
  IF NEW.storniert_vorgang_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO original FROM "vorgang" WHERE id = NEW.storniert_vorgang_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Storno verweist auf einen unbekannten Vorgang';
  END IF;
  IF original.storniert_vorgang_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ein Storno kann nicht selbst storniert werden';
  END IF;
  IF NEW.beteiligung_id <> original.beteiligung_id THEN
    RAISE EXCEPTION 'Storno muss zur selben Beteiligung gehören wie der Original-Vorgang';
  END IF;
  IF NEW.art <> original.art THEN
    RAISE EXCEPTION 'Storno muss dieselbe Art haben wie der Original-Vorgang';
  END IF;
  IF NEW.betrag <> -original.betrag THEN
    RAISE EXCEPTION 'Storno-Betrag muss das Negative des Original-Betrags sein';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER vorgang_storno_pruefen BEFORE INSERT ON "vorgang"
  FOR EACH ROW EXECUTE FUNCTION vorgang_storno_pruefen();
