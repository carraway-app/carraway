CREATE TABLE "nutzergruppe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"beschreibung" text,
	"stufe" "fonds_rolle" DEFAULT 'betrachter' NOT NULL,
	"fonds_beschraenkt" boolean DEFAULT false NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutzergruppe_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "nutzergruppe_fonds" (
	"gruppe_id" uuid NOT NULL,
	"fonds_id" uuid NOT NULL,
	CONSTRAINT "nutzergruppe_fonds_gruppe_id_fonds_id_pk" PRIMARY KEY("gruppe_id","fonds_id")
);
--> statement-breakpoint
CREATE TABLE "nutzergruppe_mitglied" (
	"gruppe_id" uuid NOT NULL,
	"benutzer_id" uuid NOT NULL,
	CONSTRAINT "nutzergruppe_mitglied_gruppe_id_benutzer_id_pk" PRIMARY KEY("gruppe_id","benutzer_id")
);
--> statement-breakpoint
CREATE TABLE "nutzergruppe_rolle" (
	"gruppe_id" uuid NOT NULL,
	"rolle_id" uuid NOT NULL,
	CONSTRAINT "nutzergruppe_rolle_gruppe_id_rolle_id_pk" PRIMARY KEY("gruppe_id","rolle_id")
);
--> statement-breakpoint
CREATE TABLE "rechte_einstellung" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"fonds_offen" boolean DEFAULT true NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rechte_einstellung_eine_zeile" CHECK ("rechte_einstellung"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "rechterolle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"beschreibung" text,
	"bereiche" text[] DEFAULT '{}'::text[] NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rechterolle_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "nutzergruppe_fonds" ADD CONSTRAINT "nutzergruppe_fonds_gruppe_id_nutzergruppe_id_fk" FOREIGN KEY ("gruppe_id") REFERENCES "public"."nutzergruppe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutzergruppe_fonds" ADD CONSTRAINT "nutzergruppe_fonds_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutzergruppe_mitglied" ADD CONSTRAINT "nutzergruppe_mitglied_gruppe_id_nutzergruppe_id_fk" FOREIGN KEY ("gruppe_id") REFERENCES "public"."nutzergruppe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutzergruppe_mitglied" ADD CONSTRAINT "nutzergruppe_mitglied_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutzergruppe_rolle" ADD CONSTRAINT "nutzergruppe_rolle_gruppe_id_nutzergruppe_id_fk" FOREIGN KEY ("gruppe_id") REFERENCES "public"."nutzergruppe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutzergruppe_rolle" ADD CONSTRAINT "nutzergruppe_rolle_rolle_id_rechterolle_id_fk" FOREIGN KEY ("rolle_id") REFERENCES "public"."rechterolle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nutzergruppe_fonds_fonds_idx" ON "nutzergruppe_fonds" USING btree ("fonds_id");--> statement-breakpoint
CREATE INDEX "nutzergruppe_mitglied_benutzer_idx" ON "nutzergruppe_mitglied" USING btree ("benutzer_id");--> statement-breakpoint
CREATE INDEX "nutzergruppe_rolle_rolle_idx" ON "nutzergruppe_rolle" USING btree ("rolle_id");--> statement-breakpoint
-- Überführung: Die bisherigen Fondsrollen bleiben unverändert gültig und sind ab jetzt die Ausnahme je Person und Fonds, die vor jeder Gruppe gilt.
-- Personen ohne Gruppe behalten alle Bereiche; es entsteht keine Gruppe und keine Rolle. Die zentrale Einstellung beginnt mit „Fonds offen“.
INSERT INTO "rechte_einstellung" ("id", "fonds_offen") VALUES (1, true) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- Wirksame Fondsrolle je Person und Fonds: die eigene Fondsrolle, sonst die höchste Stufe der Gruppen, deren Fondszugriff den Fonds umfasst
-- (die Fonds der Gruppe; ohne Beschränkung und bei „Fonds offen“ alle Fonds). Globale Verwalter stehen nicht darin, sie sind überall Verwalter.
CREATE VIEW "wirksame_fondsrolle" AS
  SELECT r."benutzer_id", r."fonds_id", r."rolle" FROM "fondsrolle" r
  UNION ALL
  SELECT g."benutzer_id", g."fonds_id", max(g."stufe") AS "rolle"
  FROM (
    SELECT m."benutzer_id", nf."fonds_id", ng."stufe"
    FROM "nutzergruppe_mitglied" m
    JOIN "nutzergruppe" ng ON ng."id" = m."gruppe_id"
    JOIN "nutzergruppe_fonds" nf ON nf."gruppe_id" = ng."id"
    UNION ALL
    SELECT m."benutzer_id", f."id", ng."stufe"
    FROM "nutzergruppe_mitglied" m
    JOIN "nutzergruppe" ng ON ng."id" = m."gruppe_id" AND NOT ng."fonds_beschraenkt"
    CROSS JOIN "fonds" f
    WHERE COALESCE((SELECT e."fonds_offen" FROM "rechte_einstellung" e WHERE e."id" = 1), true)
  ) g
  WHERE NOT EXISTS (SELECT 1 FROM "fondsrolle" d WHERE d."benutzer_id" = g."benutzer_id" AND d."fonds_id" = g."fonds_id")
  GROUP BY g."benutzer_id", g."fonds_id";--> statement-breakpoint
-- Investor-Benutzer des LP-Portals gehören zu keiner Gruppe (wie sie keine Fondsrolle haben).
CREATE FUNCTION investor_keine_gruppe() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "investor_benutzer" WHERE benutzer_id = NEW.benutzer_id) THEN
    RAISE EXCEPTION 'Investor-Benutzer gehören zu keiner Nutzergruppe' USING ERRCODE = 'IV001';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER investor_keine_gruppe BEFORE INSERT OR UPDATE ON "nutzergruppe_mitglied"
  FOR EACH ROW EXECUTE FUNCTION investor_keine_gruppe();
--> statement-breakpoint
-- Umgekehrt wird niemand Investor-Benutzer, der einer Gruppe angehört (Fassung aus 0028 plus Gruppen).
CREATE OR REPLACE FUNCTION investor_benutzer_pruefen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "fondsrolle" WHERE benutzer_id = NEW.benutzer_id)
    OR EXISTS (SELECT 1 FROM "nutzergruppe_mitglied" WHERE benutzer_id = NEW.benutzer_id)
    OR EXISTS (SELECT 1 FROM "benutzer" WHERE id = NEW.benutzer_id AND (global_verwalter OR technisch)) THEN
    RAISE EXCEPTION 'Ein Investor-Benutzer darf keine Fondsrolle haben, keiner Gruppe angehören, nicht Verwalter und nicht technisch sein'
      USING ERRCODE = 'IV001';
  END IF;
  RETURN NEW;
END;
$$;
