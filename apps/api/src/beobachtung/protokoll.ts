/**
 * Strukturierte Logs als eine JSON-Zeile je Ereignis auf der Standardausgabe (API und Worker).
 *
 * Geloggt wird nie: Anfrageinhalt, Abfrageparameter, Adressen, Beträge, Geheimnisse, Namen oder E-Mail-Adressen.
 * Personenbezug hat nur `benutzerId` (die ID aus der Datenbank). `fehlerFelder` schneidet aus Fehlern alles heraus,
 * was Werte enthalten könnte (Drizzle hängt die Abfrageparameter an die Fehlermeldung).
 */

export type Stufe = "debug" | "info" | "warn" | "error";
export type Feldwert = string | number | boolean | null | undefined;
export type Felder = Record<string, Feldwert>;
export type Logger = (stufe: Stufe, meldung: string, felder?: Felder) => void;

const RANG: Record<Stufe, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const istStufe = (wert: string | undefined): wert is Stufe => wert !== undefined && wert in RANG;

/** Erzeugt einen Logger; `ausgabe` nimmt die fertige JSON-Zeile (Standard: Standardausgabe, Tests geben eine Liste mit). */
export function erstelleLogger(dienst: "api" | "worker", optionen: { mindeststufe?: Stufe; ausgabe?: (zeile: string) => void } = {}): Logger {
  const mindest = RANG[optionen.mindeststufe ?? "info"];
  const ausgabe = optionen.ausgabe ?? ((zeile: string) => void process.stdout.write(`${zeile}\n`));
  return (stufe, meldung, felder = {}) => {
    if (RANG[stufe] < mindest) return;
    const bereinigt = Object.fromEntries(Object.entries(felder).filter(([, wert]) => wert !== undefined));
    ausgabe(JSON.stringify({ zeit: new Date().toISOString(), stufe, dienst, meldung, ...bereinigt }));
  };
}

/** Logger aus der Umgebung: `LOG_STUFE` (debug, info, warn, error; Standard info). */
export function loggerAusUmgebung(dienst: "api" | "worker", env: Record<string, string | undefined> = process.env): Logger {
  return erstelleLogger(dienst, { mindeststufe: istStufe(env.LOG_STUFE) ? env.LOG_STUFE : "info" });
}

const URSACHE_TIEFE = 5;
const MELDUNG_MAX = 300;

/** Postgres-Felder aus der Ursachenkette (Drizzle verpackt den Treiberfehler). Ohne `detail`: Es nennt Werte. */
function postgresFelder(fehler: unknown): Felder {
  for (let e: unknown = fehler, tiefe = 0; e && tiefe < URSACHE_TIEFE; tiefe++, e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
      const { constraint, table } = e as { constraint?: unknown; table?: unknown };
      return {
        pgCode: code,
        pgConstraint: typeof constraint === "string" ? constraint : undefined,
        pgTabelle: typeof table === "string" ? table : undefined,
      };
    }
  }
  return {};
}

/** Felder für einen Fehler: Klasse, bereinigte Meldung, Postgres-Code, Aufrufstellen. Keine Parameter, keine Werte. */
export function fehlerFelder(fehler: unknown): Felder {
  if (!(fehler instanceof Error)) return { fehlerArt: typeof fehler };
  const abfrage = /^Failed query/i.test(fehler.message);
  const meldung = abfrage ? "Datenbankabfrage fehlgeschlagen" : (fehler.message.split("\n")[0] ?? "").slice(0, MELDUNG_MAX);
  const stellen = (fehler.stack ?? "")
    .split("\n")
    .filter((zeile) => /^\s+at /.test(zeile))
    .slice(0, 6)
    .map((zeile) => zeile.trim())
    .join(" | ");
  return { fehlerArt: fehler.name, fehlerMeldung: meldung, ...postgresFelder(fehler), stellen: stellen || undefined };
}
