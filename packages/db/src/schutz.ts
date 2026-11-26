/**
 * Schutz vor der falschen Datenbank. Befehle, die Daten schreiben oder löschen (Migration, Seed, Testaufbau, Tests), laufen nie
 * gegen eine stillschweigend angenommene Vorgabe: Die Verbindung muss ausdrücklich gesetzt sein. Die Tests leeren Tabellen
 * (`TRUNCATE`); darum muss der Name der Test-Datenbank das Wort `test` enthalten.
 */

type Umgebung = Record<string, string | undefined>;

/** Name der Datenbank aus einer Verbindungsadresse. */
export function datenbankNameAusUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1));
  } catch {
    throw new Error("Die Datenbankadresse ist keine gültige URL (erwartet: postgres://Benutzer:Passwort@Host:Port/Datenbank).");
  }
}

/** Liefert den ersten gesetzten Wert aus `namen`; ohne einen wird abgebrochen, statt eine Vorgabe zu raten. */
export function verlangeDatenbankUrl(namen: readonly string[], zweck: string, env: Umgebung = process.env): string {
  for (const name of namen) {
    const wert = env[name]?.trim();
    if (wert) return wert;
  }
  throw new Error(
    `${zweck}: ${namen.join(" oder ")} ist nicht gesetzt. Abbruch, damit nichts gegen eine versehentlich angenommene Datenbank läuft. ` +
      `Beispiel: ${namen[0]}=postgres://carraway:carraway@localhost:5432/<datenbank> (siehe README, Abschnitt Schutz vor der falschen Datenbank).`,
  );
}

/** Test-Datenbank: ausdrücklich gesetzt und mit `test` im Namen, weil die Tests Tabellen leeren. */
export function testDatenbankUrl(env: Umgebung = process.env, zweck = "Tests"): string {
  const url = verlangeDatenbankUrl(["DATABASE_URL_TEST"], zweck, env);
  const name = datenbankNameAusUrl(url);
  if (!/test/i.test(name)) {
    throw new Error(
      `${zweck}: Die Datenbank "${name}" in DATABASE_URL_TEST wird abgelehnt, weil ihr Name nicht "test" enthält. ` +
        `Die Tests leeren Tabellen (TRUNCATE); nutze eine eigene Test-Datenbank, z. B. carraway_test.`,
    );
  }
  return url;
}

/** Die Ziele von `db:setup` ohne `--nur-test`. */
export interface SetupZiele {
  quelle: "umgebung" | "lokal-standard";
  entwicklung: string;
  test: string;
}

const LOKAL = (name: string) => `postgres://carraway:carraway@localhost:5432/${name}`;

/**
 * Bestimmt, welche Datenbanken `db:setup` (ohne `--nur-test`) anlegt und migriert. Nie stillschweigend: Entweder nennen
 * `DATABASE_URL` und `DATABASE_URL_TEST` die Ziele ausdrücklich (die Test-Adresse braucht `test` im Namen), oder der Aufruf
 * trägt `--lokal-standard` und nimmt bewusst `carraway_dev` und `carraway_test`. Sonst Abbruch ohne jeden Zugriff.
 */
export function setupZiele(argv: readonly string[], env: Umgebung = process.env): SetupZiele {
  if (argv.includes("--lokal-standard")) {
    return { quelle: "lokal-standard", entwicklung: LOKAL("carraway_dev"), test: LOKAL("carraway_test") };
  }
  const fehlend = ["DATABASE_URL", "DATABASE_URL_TEST"].filter((name) => !env[name]?.trim());
  if (fehlend.length > 0) {
    throw new Error(
      `db:setup: ${fehlend.join(" und ")} ${fehlend.length > 1 ? "sind" : "ist"} nicht gesetzt. Abbruch, damit nicht stillschweigend die gemeinsamen lokalen Datenbanken angelegt oder migriert werden. ` +
        `Entweder beide Ziele nennen (DATABASE_URL=postgres://carraway:carraway@localhost:5432/<datenbank> und DATABASE_URL_TEST=...), ` +
        `oder bewusst mit --lokal-standard die Datenbanken carraway_dev und carraway_test verwenden (pnpm db:setup --lokal-standard).`,
    );
  }
  return {
    quelle: "umgebung",
    entwicklung: verlangeDatenbankUrl(["DATABASE_URL"], "db:setup", env),
    test: testDatenbankUrl(env, "db:setup"),
  };
}
