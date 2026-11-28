import { createHash } from "node:crypto";
import type { Db } from "@carraway/db";
import type { Speicher } from "../berichte/speicher";
import { erzeugeRechenregeln } from "./rechenregeln";
import { zipStrom, type ZipEintrag } from "./zip";

/**
 * Vollexport: ein ZIP mit einer CSV je Tabelle (UTF-8, Komma, Kopfzeile, Werte als Text wie in der Datenbank, leer = NULL), den
 * freigegebenen Berichtsdateien, `schema.json` (Spalten und Typen), `rechenregeln.md`, `README.md` und `manifest.json` (Schemaversion, Zeitpunkt,
 * Zeilenzahlen und SHA-256 je Datei). Alles liest eine einzige Transaktion mit festem Stand (Repeatable Read), der Strom
 * hält höchstens einen Block im Speicher.
 */

export const EXPORT_SCHEMAVERSION = 1;
const BLOCK = 2000;

interface Tabelle {
  name: string;
  /** Sortierung (Schlüssel) für stabile Blöcke. */
  ordnung: string[];
  /** Nur diese Spalten (Whitelist), sonst alle außer `ohne`. */
  nur?: string[];
  ohne?: string[];
}

/**
 * Exportierte Tabellen. Nicht dabei: Sitzungen, Konten (Passwort-Hashes), zweiter Faktor, Verifizierung, Anmeldeversuche, gespeicherte
 * Idempotenz-Antworten und die abgeleiteten Snapshots (sie lassen sich aus den Daten neu rechnen). Von Benutzern und API-Schlüsseln
 * stehen nur Angaben ohne Geheimnisse im Export.
 */
export const EXPORT_TABELLEN: readonly Tabelle[] = [
  { name: "fonds", ordnung: ["id"] },
  { name: "organisation", ordnung: ["id"] },
  { name: "person", ordnung: ["id"] },
  { name: "beschaeftigung", ordnung: ["id"] },
  { name: "feld_definition", ordnung: ["id"] },
  { name: "liste", ordnung: ["id"] },
  { name: "liste_eintrag", ordnung: ["id"] },
  { name: "ansicht", ordnung: ["id"] },
  { name: "aufgabe", ordnung: ["id"] },
  { name: "datensatz_link", ordnung: ["id"] },
  { name: "deal_kontakt", ordnung: ["deal_id", "person_id"] },
  { name: "kontaktrolle", ordnung: ["id"] },
  { name: "gremienmandat", ordnung: ["id"] },
  { name: "organisationsbeziehung", ordnung: ["id"] },
  { name: "beschlussvorlage", ordnung: ["id"] },
  { name: "fonds_zeichnung", ordnung: ["id"] },
  { name: "fonds_closing", ordnung: ["id"] },
  { name: "fonds_closing_zusage", ordnung: ["id"] },
  { name: "fonds_closing_basis", ordnung: ["closing_id", "organisation_id"] },
  { name: "fonds_closing_stand", ordnung: ["closing_id", "organisation_id"] },
  { name: "fonds_closing_storno", ordnung: ["closing_id"] },
  { name: "fonds_bewegung", ordnung: ["id"] },
  { name: "abruf_anteil", ordnung: ["bewegung_id", "organisation_id"] },
  { name: "lp_zahlung", ordnung: ["id"] },
  { name: "fonds_kosten", ordnung: ["id"] },
  { name: "fonds_kosten_anteil", ordnung: ["kosten_id", "organisation_id"] },
  { name: "fonds_offenlegung", ordnung: ["id"] },
  { name: "periodensperre", ordnung: ["fonds_id"] },
  { name: "deal", ordnung: ["id"] },
  { name: "deal_phasenwechsel", ordnung: ["id"] },
  { name: "aktivitaet", ordnung: ["id"] },
  { name: "beschluss", ordnung: ["id"] },
  { name: "beteiligung", ordnung: ["id"] },
  { name: "instrument", ordnung: ["id"] },
  { name: "darlehen_verzicht", ordnung: ["id"] },
  { name: "vorgang", ordnung: ["id"] },
  { name: "bewertungsrunde", ordnung: ["id"] },
  { name: "bewertung", ordnung: ["id"] },
  { name: "anteilsklasse", ordnung: ["id"] },
  { name: "finanzierungsrunde", ordnung: ["id"] },
  { name: "vehikel", ordnung: ["id"] },
  { name: "rundenposition", ordnung: ["id"] },
  { name: "rundenposition_zahlung", ordnung: ["id"] },
  { name: "mitarbeiterpool", ordnung: ["id"] },
  { name: "pool_aenderung", ordnung: ["id"] },
  // Namen von Begünstigten bleiben im Unternehmen: der Export trägt nur die Kennung (Pseudonym).
  { name: "mitarbeiterzuteilung", ordnung: ["id"], ohne: ["name"] },
  { name: "zuteilung_austritt", ordnung: ["id"] },
  { name: "zuteilung_ausuebung", ordnung: ["id"] },
  { name: "runde_buchung", ordnung: ["vorgang_id"] },
  { name: "vorgang_runde", ordnung: ["vorgang_id"] },
  { name: "darlehen_kondition", ordnung: ["id"] },
  { name: "jahresueberschuss", ordnung: ["id"] },
  { name: "tranche", ordnung: ["id"] },
  { name: "zinslauf", ordnung: ["id"] },
  { name: "zinslauf_position", ordnung: ["id"] },
  { name: "zinsperiode_gebucht", ordnung: ["id"] },
  { name: "wandlung", ordnung: ["id"] },
  { name: "verkauf", ordnung: ["id"] },
  { name: "forderung", ordnung: ["id"] },
  { name: "kaufpreisanpassung", ordnung: ["id"] },
  { name: "optionsschein_ausuebung", ordnung: ["id"] },
  { name: "anteilsuebertragung", ordnung: ["id"] },
  { name: "bericht", ordnung: ["id"] },
  { name: "bericht_freigabe", ordnung: ["id"] },
  { name: "bericht_abschnitt", ordnung: ["id"] },
  { name: "bericht_variante", ordnung: ["id"] },
  { name: "bericht_vorlage", ordnung: ["id"] },
  { name: "bericht_freigabestufen", ordnung: ["fonds_id"] },
  { name: "benutzer", ordnung: ["id"], nur: ["id", "name", "email", "aktiv", "technisch", "global_verwalter", "two_factor_enabled", "created_at"] },
  { name: "fondsrolle", ordnung: ["benutzer_id", "fonds_id"] },
  { name: "rechterolle", ordnung: ["id"] },
  { name: "nutzergruppe", ordnung: ["id"] },
  { name: "nutzergruppe_rolle", ordnung: ["gruppe_id", "rolle_id"] },
  { name: "nutzergruppe_fonds", ordnung: ["gruppe_id", "fonds_id"] },
  { name: "nutzergruppe_mitglied", ordnung: ["gruppe_id", "benutzer_id"] },
  { name: "rechte_einstellung", ordnung: ["id"] },
  { name: "investor_benutzer", ordnung: ["benutzer_id"] },
  { name: "investor_zugang", ordnung: ["benutzer_id", "organisation_id"] },
  { name: "fonds_mitteilung", ordnung: ["id"] },
  { name: "api_schluessel", ordnung: ["id"], nur: ["id", "name", "benutzer_id", "scopes", "ablauf", "vorschau", "erstellt_von", "erstellt_am", "zuletzt_genutzt", "widerrufen_am"] },
  { name: "aenderung", ordnung: ["am", "id"] },
  { name: "import_lauf", ordnung: ["id"], ohne: ["datei"] },
  { name: "import_befund", ordnung: ["id"] },
  { name: "import_zuordnung", ordnung: ["objekt", "schluessel"] },
  { name: "kennzahl_definition", ordnung: ["id"] },
  { name: "fonds_kennzahl", ordnung: ["fonds_id", "schluessel"] },
  // Vom Link-Token steht nur der Hash in der Datenbank; er verlässt sie auch im Export nicht.
  { name: "kennzahl_abfrage", ordnung: ["id"], ohne: ["token_hash"] },
  { name: "kennzahl_abfrage_position", ordnung: ["abfrage_id", "definition_id"] },
  { name: "kennzahl_wert", ordnung: ["id"] },
  // Dokumente: Metadaten und Verknüpfungen mit Verweis auf die Datei in der Dateiablage (`gespeichert_unter`, SHA-256). Die Dateien selbst
  // und der daraus gezogene Text (`dokument_seite`) sowie die KI-Vorschläge (`auslesung`) sind nicht im Export; sie liegen in der Sicherung.
  { name: "dokument", ordnung: ["id"] },
  { name: "dokument_verknuepfung", ordnung: ["dokument_id", "ziel_typ", "ziel_id"] },
  { name: "wert_quelle", ordnung: ["id"] },
  { name: "fonds_buchhaltung", ordnung: ["fonds_id"] },
  { name: "beteiligung_buchhaltung", ordnung: ["beteiligung_id"] },
  { name: "fonds_mittelart", ordnung: ["id"] },
  { name: "beleg_art_eigen", ordnung: ["id"] },
  { name: "beleg_vorlage", ordnung: ["id"] },
  { name: "beleg", ordnung: ["id"] },
  { name: "beleg_stufe", ordnung: ["id"] },
  { name: "beleg_nummernkreis", ordnung: ["fonds_id"] },
  { name: "sachkonto", ordnung: ["id"] },
  { name: "gliederung_position", ordnung: ["id"] },
  { name: "kontenregel", ordnung: ["id"] },
  { name: "saldenlauf", ordnung: ["id"], ohne: ["datei"] },
  { name: "saldenlauf_befund", ordnung: ["id"] },
  { name: "saldo", ordnung: ["id"] },
  { name: "buchungsregel", ordnung: ["id"] },
  { name: "buchungsexport", ordnung: ["id"] },
  { name: "buchungsexport_position", ordnung: ["id"] },
  // Meldewesen: Programme, Definitionen (versioniert), Aktivierung, Läufe mit Werten, Freigabeprotokoll und Verweise auf die unveränderlichen Dateien (`schluessel`, SHA-256).
  // Die Dateien liegen in der Dateiablage und in der Sicherung.
  { name: "foerderprogramm", ordnung: ["id"] },
  { name: "organisation_meldedaten", ordnung: ["organisation_id"] },
  { name: "melde_definition", ordnung: ["id"] },
  { name: "melde_aktivierung", ordnung: ["fonds_id", "schluessel"] },
  { name: "melde_lauf", ordnung: ["id"] },
  { name: "melde_wert", ordnung: ["id"] },
  { name: "melde_freigabe", ordnung: ["id"] },
  { name: "melde_datei", ordnung: ["id"] },
  // Mail und Kalender (Etappe 17): Herkunft synchronisierter Aktivitäten (Hash statt Nachrichten-ID) und persönliche Einstellungen. Nicht dabei: Verbindungen mit
  // verschlüsselten Zugängen, OAuth-Zustände, Ausschlüsse, Kalender-Token und der Mail-Ausgangskorb (enthalten Geheimnisse oder Mailadressen und sind kurzlebig).
  { name: "aktivitaet_sync", ordnung: ["aktivitaet_id"] },
  { name: "benutzer_einstellung", ordnung: ["benutzer_id"] },
  // Registerdaten, Szenarien und Reserven (Etappe 18)
  { name: "provider_suggestion", ordnung: ["id"] },
  { name: "external_funding_round", ordnung: ["id"] },
  { name: "registereintrag", ordnung: ["id"] },
  { name: "register_ereignis", ordnung: ["id"] },
  { name: "register_beobachtung", ordnung: ["organisation_id"] },
  { name: "register_meldung", ordnung: ["id"] },
  { name: "wechselkurs", ordnung: ["id"] },
  { name: "szenario", ordnung: ["id"] },
  { name: "reserve", ordnung: ["id"] },
  // Manager-Profil und Dachfonds (Zielfondsbeteiligungen mit Bewegungen und Meldungen)
  { name: "manager_profil", ordnung: ["id"] },
  { name: "zielfonds_beteiligung", ordnung: ["id"] },
  { name: "zielfonds_bewegung", ordnung: ["id"] },
  { name: "zielfonds_meldung", ordnung: ["id"] },
];

const csvFeld = (wert: string | null): string => {
  if (wert === null) return "";
  return /[",\r\n]/.test(wert) ? `"${wert.replaceAll('"', '""')}"` : wert;
};

interface Spalte {
  name: string;
  typ: string;
  nullbar: boolean;
}

export interface ExportDatei {
  pfad: string;
  zeilen: number | null;
  sha256: string;
  bytes: number;
}

const README = (zeit: string) => `# Carraway Vollexport

Exportiert am ${zeit} (UTC), Schemaversion ${EXPORT_SCHEMAVERSION}.

Inhalt
- \`tabellen/<name>.csv\`: eine Datei je Tabelle. UTF-8 ohne Kennung, Trennzeichen Komma, Zeilenende LF, Kopfzeile mit den Spaltennamen,
  Felder mit Komma, Anführungszeichen oder Zeilenumbruch in Anführungszeichen (verdoppelt). Leeres Feld = kein Wert (NULL).
  Zahlen und Beträge exakt als Dezimalzahl mit Punkt, Zeitpunkte als ISO-Text mit Zeitzone, Datum als \`JJJJ-MM-TT\`, Wahrheitswerte \`true\`/\`false\`,
  JSON-Spalten als JSON-Text. Hinweis: Tabellenprogramme können Werte, die mit \`=\`, \`+\`, \`-\` oder \`@\` beginnen, als Formel deuten; die Daten sind unverändert.
- \`berichte/<id>/<sha256>.<endung>\`: freigegebene Berichtsdateien (PDF, Excel) unverändert.
- \`berichte/<id>/varianten/<organisation-id>/<sha256>.pdf\`: LP-Berichte mit dem Kapitalkonto nur eines Investors (je freigegebenem LP-Bericht mit Abschnitt Kapitalkonten) unverändert.
- \`mitteilungen/<id>/<sha256>.pdf\`: freigegebene Mitteilungen an die Investoren (Kapitalabruf, Ausschüttung) unverändert.
- \`schema.json\`: je Tabelle Spalten mit Typ, ob leer erlaubt, und Sortierschlüssel.
- \`rechenregeln.md\`: wie Zinsen, Buchwert, NAV, TVPI, DPI und IRR berechnet werden.
- \`manifest.json\`: Schemaversion, Exportzeitpunkt, Zeilenzahl und SHA-256 je Datei. Prüfen: SHA-256 der Datei im Archiv gegen den Eintrag.

Der Export enthält keine Passwort-Hashes, Sitzungen, zweiten Faktoren und API-Schlüssel-Hashes.
Fremdschlüssel verweisen über \`id\`-Spalten (UUID) auf die Zeilen der anderen Tabellen.
`;

/** Liefert die Einträge des Exports nacheinander; `fertig` erhält die Dateiliste, damit das Manifest sie am Ende schreiben kann. */
async function* eintraege(db: Db, speicher: Speicher | null, zeit: Date): AsyncGenerator<ZipEintrag> {
  const client = await db.$client.connect();
  const dateien: ExportDatei[] = [];
  const schema: Record<string, { ordnung: string[]; spalten: Spalte[] }> = {};
  const aufnehmen = (pfad: string, hash: ReturnType<typeof createHash>, bytes: number, zeilen: number | null) => dateien.push({ pfad, zeilen, sha256: hash.digest("hex"), bytes });
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = 60000");

    for (const tabelle of EXPORT_TABELLEN) {
      const { rows: spaltenZeilen } = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
        [tabelle.name],
      );
      const spalten: Spalte[] = spaltenZeilen
        .filter((s) => (tabelle.nur ? tabelle.nur.includes(s.column_name) : !(tabelle.ohne ?? []).includes(s.column_name)))
        .map((s) => ({ name: s.column_name, typ: s.data_type, nullbar: s.is_nullable === "YES" }));
      if (spalten.length === 0) throw new Error(`Export: Tabelle ${tabelle.name} nicht gefunden`);
      schema[tabelle.name] = { ordnung: tabelle.ordnung, spalten };
      const auswahl = spalten.map((s) => `"${s.name}"::text AS "${s.name}"`).join(", ");
      const ordnung = tabelle.ordnung.map((o) => `"${o}"`).join(", ");
      const hash = createHash("sha256");
      let bytes = 0;
      let zeilen = 0;
      const kodieren = new TextEncoder();
      const pfad = `tabellen/${tabelle.name}.csv`;
      async function* csv(): AsyncGenerator<Uint8Array> {
        const kopf = kodieren.encode(`${spalten.map((s) => csvFeld(s.name)).join(",")}\n`);
        hash.update(kopf);
        bytes += kopf.length;
        yield kopf;
        for (let versatz = 0; ; versatz += BLOCK) {
          const { rows } = await client.query<Record<string, string | null>>(`SELECT ${auswahl} FROM "${tabelle.name}" ORDER BY ${ordnung} LIMIT ${BLOCK} OFFSET ${versatz}`);
          if (rows.length === 0) break;
          const text = rows.map((r) => `${spalten.map((s) => csvFeld(r[s.name] ?? null)).join(",")}\n`).join("");
          const block = kodieren.encode(text);
          hash.update(block);
          bytes += block.length;
          zeilen += rows.length;
          yield block;
          if (rows.length < BLOCK) break;
        }
      }
      yield { name: pfad, daten: csv(), zeit };
      aufnehmen(pfad, hash, bytes, zeilen);
    }

    // Freigegebene Berichtsdateien unverändert; die Prüfsumme steht schon in der Datenbank und wird beim Lesen geprüft.
    if (speicher) {
      const { rows } = await client.query<{ datei_schluessel: string; datei_sha256: string }>(`SELECT datei_schluessel, datei_sha256 FROM bericht WHERE datei_schluessel IS NOT NULL ORDER BY id`);
      for (const r of rows) {
        const daten = await speicher.lese(r.datei_schluessel);
        const hash = createHash("sha256").update(daten);
        const hex = createHash("sha256").update(daten).digest("hex");
        if (hex !== r.datei_sha256) throw new Error(`Export: Berichtsdatei ${r.datei_schluessel} stimmt nicht mit der gespeicherten Prüfsumme überein`);
        yield { name: r.datei_schluessel, daten: [daten], zeit };
        aufnehmen(r.datei_schluessel, hash, daten.length, null);
      }
      // Varianten des LP-Berichts je Investor (nur das eigene Kapitalkonto), unverändert und mit geprüfter Summe.
      const varianten = await client.query<{ datei_schluessel: string; datei_sha256: string }>(`SELECT datei_schluessel, datei_sha256 FROM bericht_variante ORDER BY id`);
      for (const r of varianten.rows) {
        const daten = await speicher.lese(r.datei_schluessel);
        const hash = createHash("sha256").update(daten);
        if (createHash("sha256").update(daten).digest("hex") !== r.datei_sha256) throw new Error(`Export: Berichtsvariante ${r.datei_schluessel} stimmt nicht mit der gespeicherten Prüfsumme überein`);
        yield { name: r.datei_schluessel, daten: [daten], zeit };
        aufnehmen(r.datei_schluessel, hash, daten.length, null);
      }
      // Mitteilungen an die Investoren (Etappe 12): ebenfalls unverändert, Prüfsumme wie bei den Berichten.
      const mitteilungen = await client.query<{ datei_schluessel: string; datei_sha256: string }>(`SELECT datei_schluessel, datei_sha256 FROM fonds_mitteilung ORDER BY id`);
      for (const r of mitteilungen.rows) {
        const daten = await speicher.lese(r.datei_schluessel);
        const hash = createHash("sha256").update(daten);
        if (createHash("sha256").update(daten).digest("hex") !== r.datei_sha256) throw new Error(`Export: Mitteilung ${r.datei_schluessel} stimmt nicht mit der gespeicherten Prüfsumme überein`);
        yield { name: r.datei_schluessel, daten: [daten], zeit };
        aufnehmen(r.datei_schluessel, hash, daten.length, null);
      }
    }
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }

  const kodiert = new TextEncoder();
  const einzel = (pfad: string, text: string): ZipEintrag => {
    const daten = kodiert.encode(text);
    aufnehmen(pfad, createHash("sha256").update(daten), daten.length, null);
    return { name: pfad, daten: [daten], zeit };
  };
  yield einzel("schema.json", `${JSON.stringify({ schemaversion: EXPORT_SCHEMAVERSION, tabellen: schema }, null, 2)}\n`);
  yield einzel("rechenregeln.md", erzeugeRechenregeln(zeit));
  yield einzel("README.md", README(zeit.toISOString()));
  const manifest = {
    schemaversion: EXPORT_SCHEMAVERSION,
    exportiertAm: zeit.toISOString(),
    anwendung: "Carraway",
    tabellen: Object.fromEntries(dateien.filter((d) => d.pfad.startsWith("tabellen/")).map((d) => [d.pfad.slice(9, -4), d.zeilen])),
    dateien: dateien.map((d) => ({ pfad: d.pfad, bytes: d.bytes, sha256: d.sha256, ...(d.zeilen === null ? {} : { zeilen: d.zeilen }) })),
    hinweis: "Die SHA-256-Summen gelten für den entpackten Inhalt der Dateien. manifest.json selbst steht nicht in der Liste.",
  };
  yield { name: "manifest.json", daten: [kodiert.encode(`${JSON.stringify(manifest, null, 2)}\n`)], zeit };
}

/** Der Export als Strom von ZIP-Bytes. */
export function vollexport(db: Db, speicher: Speicher | null, zeit = new Date()): AsyncGenerator<Uint8Array> {
  return zipStrom(eintraege(db, speicher, zeit));
}
