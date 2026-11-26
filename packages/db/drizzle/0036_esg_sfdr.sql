CREATE TYPE "public"."kennzahl_abfrage_art" AS ENUM('kennzahlen', 'esg');--> statement-breakpoint
CREATE TYPE "public"."offenlegung_art" AS ENUM('art6', 'art8', 'art9');--> statement-breakpoint
ALTER TYPE "public"."bericht_art" ADD VALUE 'pai_erklaerung';--> statement-breakpoint
CREATE TABLE "fonds_offenlegung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"art" "offenlegung_art" NOT NULL,
	"gueltig_ab" date NOT NULL,
	"bemerkung" text,
	"erfasst_von" text NOT NULL,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "kennzahl_abfrage_aktiv_uq";--> statement-breakpoint
ALTER TABLE "kennzahl_abfrage" ADD COLUMN "art" "kennzahl_abfrage_art" DEFAULT 'kennzahlen' NOT NULL;--> statement-breakpoint
ALTER TABLE "kennzahl_definition" ADD COLUMN "regelwerk" text;--> statement-breakpoint
ALTER TABLE "kennzahl_definition" ADD COLUMN "erlaeuterung_de" text;--> statement-breakpoint
ALTER TABLE "kennzahl_definition" ADD COLUMN "erlaeuterung_en" text;--> statement-breakpoint
ALTER TABLE "kennzahl_definition" ADD COLUMN "fachlich_geprueft" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "kennzahl_wert" ADD COLUMN "geschaetzt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kennzahl_wert" ADD COLUMN "quellenangabe" text;--> statement-breakpoint
ALTER TABLE "organisation" ADD COLUMN "nace_abschnitt" text;--> statement-breakpoint
ALTER TABLE "fonds_offenlegung" ADD CONSTRAINT "fonds_offenlegung_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fonds_offenlegung_fonds_ab_uq" ON "fonds_offenlegung" USING btree ("fonds_id","gueltig_ab");--> statement-breakpoint
CREATE UNIQUE INDEX "kennzahl_abfrage_aktiv_uq" ON "kennzahl_abfrage" USING btree ("beteiligung_id","art","periode_beginn","periode_ende") WHERE "kennzahl_abfrage"."status" IN ('offen', 'eingereicht');--> statement-breakpoint
ALTER TABLE "organisation" ADD CONSTRAINT "organisation_nace_abschnitt" CHECK ("organisation"."nace_abschnitt" IS NULL OR "organisation"."nace_abschnitt" ~ '^[A-U]$');
--> statement-breakpoint
-- Einordnung der Fonds: der Verlauf ist nur anhängend (wie das Freigabeprotokoll der Berichte).
CREATE FUNCTION fonds_offenlegung_nur_anhaengen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Der Verlauf der Einordnung ist nur anhängend (% auf fonds_offenlegung)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER fonds_offenlegung_kein_update_delete BEFORE UPDATE OR DELETE ON "fonds_offenlegung"
  FOR EACH ROW EXECUTE FUNCTION fonds_offenlegung_nur_anhaengen();--> statement-breakpoint
-- ESG-Block des Kennzahlenkatalogs: die Datenpunkte der 14 verpflichtenden Nachhaltigkeitsindikatoren für Unternehmen (Tabelle 1) und eine Auswahl
-- zusätzlicher Indikatoren (Tabellen 2 und 3). Alle Eingangsgrößen je Unternehmen und Berichtsjahr; die Fundstelle nennt nur Verordnung, Anhang, Tabelle und Nummer.
-- Alles bleibt als fachlich zu prüfen markiert (`fachlich_geprueft` = false), bis ein Fachmensch Definition, Einheit und Wortlaut geprüft hat.
-- Die vier Platzhalter der Etappe 11 behalten Schlüssel, Typ und Kategorie (gespeicherte Werte bleiben gültig) und bekommen Fundstelle und Erläuterung.
UPDATE "kennzahl_definition" SET "regelwerk" = 'DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 1', "fachlich_geprueft" = false, "reihenfolge" = 110,
  "erlaeuterung_de" = 'Direkte Treibhausgasemissionen des Unternehmens im Berichtsjahr in Tonnen CO2-Äquivalent (Scope 1).',
  "erlaeuterung_en" = 'Direct greenhouse gas emissions of the company in the reporting year in tonnes of CO2 equivalent (scope 1).'
  WHERE "schluessel" = 'esg_thg_scope1' AND "katalog_version" = 1;--> statement-breakpoint
UPDATE "kennzahl_definition" SET "regelwerk" = 'DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 1', "fachlich_geprueft" = false, "reihenfolge" = 120,
  "erlaeuterung_de" = 'Indirekte Treibhausgasemissionen aus zugekaufter Energie im Berichtsjahr in Tonnen CO2-Äquivalent (Scope 2).',
  "erlaeuterung_en" = 'Indirect greenhouse gas emissions from purchased energy in the reporting year in tonnes of CO2 equivalent (scope 2).'
  WHERE "schluessel" = 'esg_thg_scope2' AND "katalog_version" = 1;--> statement-breakpoint
UPDATE "kennzahl_definition" SET "regelwerk" = 'DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 13', "fachlich_geprueft" = false, "reihenfolge" = 240,
  "erlaeuterung_de" = 'Anteil der Frauen an allen Mitgliedern des Leitungsorgans (Geschäftsführung und Aufsichtsgremium) zum Ende des Berichtsjahres in Prozent.',
  "erlaeuterung_en" = 'Share of women among all members of the management body (management and supervisory board) at the end of the reporting year, in percent.'
  WHERE "schluessel" = 'esg_frauenanteil_leitung' AND "katalog_version" = 1;--> statement-breakpoint
UPDATE "kennzahl_definition" SET "regelwerk" = 'DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 10', "fachlich_geprueft" = false, "reihenfolge" = 210,
  "erlaeuterung_de" = 'War das Unternehmen im Berichtsjahr an Verstößen gegen die Grundsätze des UN Global Compact oder die OECD-Leitsätze für multinationale Unternehmen beteiligt? Antwort ja oder nein.',
  "erlaeuterung_en" = 'Was the company involved in violations of the UN Global Compact principles or the OECD Guidelines for Multinational Enterprises in the reporting year? Answer yes or no.'
  WHERE "schluessel" = 'esg_verstoesse_ungc' AND "katalog_version" = 1;--> statement-breakpoint
INSERT INTO "kennzahl_definition" ("schluessel", "katalog_version", "bezeichnung_de", "bezeichnung_en", "einheit", "typ", "kategorie", "periodizitaet", "aggregation", "pflicht", "reihenfolge", "gueltig_ab", "regelwerk", "erlaeuterung_de", "erlaeuterung_en", "fachlich_geprueft") VALUES
  ('esg_evic', 1, 'Unternehmenswert inkl. Barmittel (EVIC)', 'Enterprise value including cash (EVIC)', 'EUR', 'betrag', 'finanzen', 'jahr', 'stand', false, 100, '2026-01-01',
    'DelVO (EU) 2022/1288 Anhang I Tabelle 1 (Berechnungsgrundlage)',
    'Marktwert des Eigenkapitals plus Buchwert der Schulden (ohne Abzug von Barmitteln) zum Ende des Berichtsjahres in Euro. Grundlage für den Anteil des Fonds an den Emissionen. Bei nicht börsennotierten Unternehmen ein geschätzter Wert; bitte als geschätzt kennzeichnen.',
    'Market value of equity plus book value of debt (without deducting cash) at the end of the reporting year, in euro. Basis for the fund''s share of emissions. For unlisted companies an estimated value; please mark it as estimated.', false),
  ('esg_thg_scope3', 1, 'Treibhausgasemissionen Scope 3', 'Greenhouse gas emissions scope 3', 't CO2e', 'zahl', 'esg_umwelt', 'jahr', 'summe', false, 130, '2026-01-01',
    'DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 1',
    'Übrige indirekte Treibhausgasemissionen der Wertschöpfungskette im Berichtsjahr in Tonnen CO2-Äquivalent (Scope 3).',
    'Other indirect greenhouse gas emissions of the value chain in the reporting year in tonnes of CO2 equivalent (scope 3).', false),
  ('esg_fossile_brennstoffe', 1, 'Tätigkeit im Sektor fossiler Brennstoffe', 'Activity in the fossil fuel sector', '', 'ja_nein', 'esg_umwelt', 'jahr', 'stand', false, 150, '2026-01-01',
    'DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 4',
    'Ist das Unternehmen im Sektor fossiler Brennstoffe tätig (Gewinnung, Verarbeitung, Lagerung oder Transport von Kohle, Erdöl oder Erdgas)? Antwort ja oder nein.',
    'Is the company active in the fossil fuel sector (extraction, processing, storage or transport of coal, oil or natural gas)? Answer yes or no.', false),
  ('esg_nicht_erneuerbare_energie_anteil', 1, 'Anteil nicht erneuerbarer Energie', 'Share of non-renewable energy', 'Prozent', 'prozent', 'esg_umwelt', 'jahr', 'stand', false, 160, '2026-01-01',
    'DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 5',
    'Anteil der nicht erneuerbaren Quellen an der verbrauchten und erzeugten Energie des Unternehmens im Berichtsjahr in Prozent der gesamten Energie.',
    'Share of non-renewable sources in the energy consumed and produced by the company in the reporting year, in percent of total energy.', false),
  ('esg_energieverbrauch_gwh', 1, 'Energieverbrauch', 'Energy consumption', 'GWh', 'zahl', 'esg_umwelt', 'jahr', 'summe', false, 170, '2026-01-01',
    'DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 6',
    'Gesamter Energieverbrauch des Unternehmens im Berichtsjahr in Gigawattstunden. Die Intensität je Umsatz berechnet die Plattform.',
    'Total energy consumption of the company in the reporting year in gigawatt hours. The platform calculates the intensity per revenue.', false),
  ('esg_biodiversitaet', 1, 'Tätigkeiten in oder nahe schutzbedürftigen Gebieten', 'Activities in or near biodiversity-sensitive areas', '', 'ja_nein', 'esg_umwelt', 'jahr', 'stand', false, 180, '2026-01-01',
    'DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 7',
    'Hat das Unternehmen Standorte oder Tätigkeiten in oder nahe biodiversitätssensiblen Gebieten, die diese Gebiete nachteilig beeinflussen? Antwort ja oder nein.',
    'Does the company have sites or activities in or near biodiversity-sensitive areas that negatively affect those areas? Answer yes or no.', false),
  ('esg_emissionen_wasser', 1, 'Emissionen in Wasser', 'Emissions to water', 't', 'zahl', 'esg_umwelt', 'jahr', 'summe', false, 190, '2026-01-01',
    'DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 8',
    'Im Berichtsjahr in Gewässer abgegebene Emissionen des Unternehmens in Tonnen.',
    'Emissions released by the company into water in the reporting year, in tonnes.', false),
  ('esg_gefaehrliche_abfaelle', 1, 'Gefährliche und radioaktive Abfälle', 'Hazardous and radioactive waste', 't', 'zahl', 'esg_umwelt', 'jahr', 'summe', false, 200, '2026-01-01',
    'DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 9',
    'Im Berichtsjahr angefallene gefährliche und radioaktive Abfälle des Unternehmens zusammen in Tonnen.',
    'Hazardous and radioactive waste generated by the company in the reporting year, combined, in tonnes.', false),
  ('esg_prozesse_ungc_fehlen', 1, 'Fehlende Verfahren zur Überwachung der Einhaltung', 'Lack of processes to monitor compliance', '', 'ja_nein', 'esg_governance', 'jahr', 'stand', false, 220, '2026-01-01',
    'DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 11',
    'Fehlen im Unternehmen Richtlinien zur Überwachung der Einhaltung der Grundsätze des UN Global Compact und der OECD-Leitsätze oder Verfahren zur Bearbeitung von Beschwerden? Antwort ja (es fehlt) oder nein.',
    'Does the company lack policies to monitor compliance with the UN Global Compact principles and the OECD Guidelines or grievance handling mechanisms? Answer yes (missing) or no.', false),
  ('esg_lohngefaelle_unbereinigt', 1, 'Unbereinigtes geschlechtsspezifisches Lohngefälle', 'Unadjusted gender pay gap', 'Prozent', 'prozent', 'esg_sozial', 'jahr', 'stand', false, 230, '2026-01-01',
    'DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 12',
    'Durchschnittlicher unbereinigter Unterschied zwischen dem Bruttostundenverdienst von Männern und Frauen im Unternehmen im Berichtsjahr in Prozent des Verdienstes der Männer.',
    'Average unadjusted difference between the gross hourly earnings of men and women in the company in the reporting year, in percent of men''s earnings.', false),
  ('esg_umstrittene_waffen', 1, 'Beteiligung an umstrittenen Waffen', 'Involvement in controversial weapons', '', 'ja_nein', 'esg_governance', 'jahr', 'stand', false, 250, '2026-01-01',
    'DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 14',
    'Ist das Unternehmen an der Herstellung oder dem Verkauf umstrittener Waffen beteiligt (Antipersonenminen, Streumunition, chemische und biologische Waffen)? Antwort ja oder nein.',
    'Is the company involved in the manufacture or sale of controversial weapons (anti-personnel mines, cluster munitions, chemical and biological weapons)? Answer yes or no.', false),
  ('esg_zus_ohne_reduktionsinitiativen', 1, 'Zusatz: Keine Initiativen zur Verringerung der CO2-Emissionen', 'Additional: No carbon emission reduction initiatives', '', 'ja_nein', 'esg_umwelt', 'jahr', 'stand', false, 300, '2026-01-01',
    'DelVO (EU) 2022/1288 Anhang I Tabelle 2 Nr. 4',
    'Hat das Unternehmen keine Initiativen zur Verringerung der CO2-Emissionen, die auf die Ziele des Übereinkommens von Paris ausgerichtet sind? Antwort ja (keine Initiativen) oder nein.',
    'Does the company have no carbon emission reduction initiatives aimed at aligning with the Paris Agreement? Answer yes (no initiatives) or no.', false),
  ('esg_zus_hinweisgeberschutz', 1, 'Zusatz: Unzureichender Schutz von Hinweisgebern', 'Additional: Insufficient whistleblower protection', '', 'ja_nein', 'esg_sozial', 'jahr', 'stand', false, 310, '2026-01-01',
    'DelVO (EU) 2022/1288 Anhang I Tabelle 3 Nr. 6',
    'Fehlen im Unternehmen Richtlinien zum Schutz von Hinweisgebern? Antwort ja (es fehlen Richtlinien) oder nein.',
    'Does the company lack policies on the protection of whistleblowers? Answer yes (policies missing) or no.', false),
  ('esg_zus_antikorruption', 1, 'Zusatz: Fehlende Richtlinien gegen Korruption und Bestechung', 'Additional: Lack of anti-corruption and anti-bribery policies', '', 'ja_nein', 'esg_governance', 'jahr', 'stand', false, 320, '2026-01-01',
    'DelVO (EU) 2022/1288 Anhang I Tabelle 3 Nr. 15',
    'Fehlen im Unternehmen Richtlinien zur Bekämpfung von Korruption und Bestechung? Antwort ja (es fehlen Richtlinien) oder nein.',
    'Does the company lack policies against corruption and bribery? Answer yes (policies missing) or no.', false);
