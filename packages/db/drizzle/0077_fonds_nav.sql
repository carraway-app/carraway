ALTER TABLE "saldo" ADD COLUMN "nav_gruppe" text;
--> statement-breakpoint
-- Die engste gültige Blattregel gewinnt wie in rechneSicht. Die nächste fachliche
-- Oberposition bestimmt die NAV-Gruppe, auch bei fondsspezifischen Unterkonten.
CREATE FUNCTION saldo_nav_gruppe(lauf uuid, konto text) RETURNS text LANGUAGE sql STABLE AS $$
  WITH RECURSIVE positionen AS (
    SELECT p.* FROM gliederung_position p JOIN saldenlauf l ON l.fonds_id = p.fonds_id
    WHERE l.id = lauf AND p.sicht = 'bilanz'
  ), blatt AS (
    SELECT r.position_schluessel FROM kontenregel r JOIN saldenlauf l ON l.fonds_id = r.fonds_id
    JOIN positionen p ON p.schluessel = r.position_schluessel
    WHERE l.id = lauf AND r.sicht = 'bilanz' AND r.gueltig_ab <= l.zeitraum_bis
      AND (r.gueltig_bis IS NULL OR r.gueltig_bis >= l.zeitraum_bis)
      AND length(konto) = length(r.konto_von) AND konto BETWEEN r.konto_von AND r.konto_bis
      AND NOT EXISTS (SELECT 1 FROM positionen k WHERE k.eltern_schluessel = p.schluessel)
    ORDER BY r.konto_bis::bigint - r.konto_von::bigint, r.id LIMIT 1
  ), pfad(schluessel) AS (
    SELECT position_schluessel FROM blatt UNION
    SELECT p.eltern_schluessel FROM positionen p JOIN pfad ON p.schluessel = pfad.schluessel
  )
  SELECT CASE
    WHEN 'aktiva.finanzanlagen' IN (SELECT * FROM pfad) THEN 'portfolio'
    WHEN 'aktiva.liquide' IN (SELECT * FROM pfad) THEN 'bank'
    WHEN 'passiva.eigenkapital' IN (SELECT * FROM pfad) THEN 'eigenkapital'
    WHEN 'aktiva' IN (SELECT * FROM pfad) THEN 'sonstiges'
    WHEN 'passiva' IN (SELECT * FROM pfad) THEN 'schulden'
  END
$$;
--> statement-breakpoint
UPDATE saldo s SET nav_gruppe = saldo_nav_gruppe(s.lauf_id, s.konto_nummer)
FROM saldenlauf l WHERE l.id = s.lauf_id AND l.status = 'uebernommen';
--> statement-breakpoint
CREATE FUNCTION saldenlauf_nav_uebernehmen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE saldo SET nav_gruppe = saldo_nav_gruppe(NEW.id, konto_nummer) WHERE lauf_id = NEW.id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER saldenlauf_nav_uebernehmen AFTER UPDATE OF status ON saldenlauf
FOR EACH ROW WHEN (NEW.status = 'uebernommen' AND OLD.status <> NEW.status)
EXECUTE FUNCTION saldenlauf_nav_uebernehmen();
--> statement-breakpoint
-- Direkt übernommene Bestände (Demo und Datenübernahme) erhalten dieselbe Zuordnung.
CREATE FUNCTION saldo_nav_einfuegen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM saldenlauf WHERE id = NEW.lauf_id AND status = 'uebernommen') THEN
    NEW.nav_gruppe := saldo_nav_gruppe(NEW.lauf_id, NEW.konto_nummer);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER saldo_nav_einfuegen BEFORE INSERT ON saldo
FOR EACH ROW EXECUTE FUNCTION saldo_nav_einfuegen();
