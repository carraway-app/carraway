import type { Betriebszustand } from "./betrieb";

/**
 * Metriken im Prometheus-Textformat (Version 0.0.4), ohne Fremdbibliothek. Die Anfragedauer wird als Histogramm je
 * Methode, Routenmuster und Statusklasse geführt; Gauges (Datenbank-Verbindungen, Warteschlange, Worker) werden erst
 * beim Abruf gelesen. Labelwerte sind immer Routenmuster (`/fonds/:id`) oder feste Wörter, nie echte Pfade.
 */

const GRENZEN_SEKUNDEN = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface Histogramm {
  zaehler: number[];
  summe: number;
  anzahl: number;
}

const maskiere = (wert: string) => wert.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
const labels = (l: Record<string, string>) =>
  Object.keys(l).length === 0 ? "" : `{${Object.entries(l).map(([k, v]) => `${k}="${maskiere(v)}"`).join(",")}}`;

export interface Poolstand {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

export class Metriken {
  private readonly anfragen = new Map<string, { labels: Record<string, string>; histogramm: Histogramm }>();
  private readonly start = Date.now();

  /** Zeichnet eine abgeschlossene Anfrage auf; `route` ist das Routenmuster, `status` der HTTP-Status. */
  anfrage(methode: string, route: string, status: number, dauerSekunden: number): void {
    const l = { methode, route, status: `${Math.floor(status / 100)}xx` };
    const schluessel = `${l.methode} ${l.route} ${l.status}`;
    let eintrag = this.anfragen.get(schluessel);
    if (!eintrag) {
      eintrag = { labels: l, histogramm: { zaehler: GRENZEN_SEKUNDEN.map(() => 0), summe: 0, anzahl: 0 } };
      this.anfragen.set(schluessel, eintrag);
    }
    const h = eintrag.histogramm;
    GRENZEN_SEKUNDEN.forEach((grenze, i) => {
      if (dauerSekunden <= grenze) h.zaehler[i]!++;
    });
    h.summe += dauerSekunden;
    h.anzahl++;
  }

  /** Rendert alle Metriken; `pool` und `betrieb` kommen vom Aufrufer (Datenbankzustand wird erst beim Abruf gelesen). */
  rendere(pool: Poolstand | undefined, betrieb: Betriebszustand | undefined): string {
    const zeilen: string[] = [];
    const kopf = (name: string, art: "gauge" | "histogram", hilfe: string) => zeilen.push(`# HELP ${name} ${hilfe}`, `# TYPE ${name} ${art}`);
    const wert = (name: string, l: Record<string, string>, v: number) => zeilen.push(`${name}${labels(l)} ${Number.isFinite(v) ? v : 0}`);

    kopf("carraway_http_anfrage_dauer_sekunden", "histogram", "Dauer der HTTP-Anfragen je Methode, Routenmuster und Statusklasse.");
    for (const { labels: l, histogramm: h } of this.anfragen.values()) {
      GRENZEN_SEKUNDEN.forEach((grenze, i) => wert("carraway_http_anfrage_dauer_sekunden_bucket", { ...l, le: String(grenze) }, h.zaehler[i]!));
      wert("carraway_http_anfrage_dauer_sekunden_bucket", { ...l, le: "+Inf" }, h.anzahl);
      wert("carraway_http_anfrage_dauer_sekunden_sum", l, h.summe);
      wert("carraway_http_anfrage_dauer_sekunden_count", l, h.anzahl);
    }

    if (pool) {
      kopf("carraway_db_pool_verbindungen", "gauge", "Verbindungen des Datenbank-Pools der API je Zustand.");
      wert("carraway_db_pool_verbindungen", { zustand: "gesamt" }, pool.totalCount);
      wert("carraway_db_pool_verbindungen", { zustand: "frei" }, pool.idleCount);
      wert("carraway_db_pool_verbindungen", { zustand: "wartend" }, pool.waitingCount);
    }

    if (betrieb?.warteschlange) {
      const w = betrieb.warteschlange;
      kopf("carraway_warteschlange_auftraege", "gauge", "Jobs der Neuberechnung in pg-boss je Zustand.");
      for (const [zustand, anzahl] of Object.entries(w.jeZustand)) wert("carraway_warteschlange_auftraege", { zustand }, anzahl);
      kopf("carraway_warteschlange_verzug_sekunden", "gauge", "Alter des ältesten fälligen, noch nicht gestarteten Jobs (0 = leer).");
      wert("carraway_warteschlange_verzug_sekunden", {}, w.aeltesterWartenderSekunden);
    }
    if (betrieb?.ausgangskorb) {
      kopf("carraway_ausgangskorb_auftraege", "gauge", "Aufträge im Ausgangskorb (snapshot_auftrag), die der Worker noch nicht an pg-boss übergeben hat.");
      wert("carraway_ausgangskorb_auftraege", {}, betrieb.ausgangskorb.anzahl);
      kopf("carraway_ausgangskorb_verzug_sekunden", "gauge", "Alter des ältesten Auftrags im Ausgangskorb (0 = leer).");
      wert("carraway_ausgangskorb_verzug_sekunden", {}, betrieb.ausgangskorb.aeltesterSekunden);
    }
    for (const [name, text, r] of [
      ["mail", "fällige, noch nicht versendete Mails", betrieb?.mail],
      ["auslesung", "KI-Auslesungen, die noch nicht laufen", betrieb?.auslesung],
      ["register", "fällige Läufe der Registerbeobachtung", betrieb?.register],
    ] as const) {
      if (!r) continue;
      kopf(`carraway_rueckstand_${name}_auftraege`, "gauge", `Anzahl: ${text}.`);
      wert(`carraway_rueckstand_${name}_auftraege`, {}, r.anzahl);
      kopf(`carraway_rueckstand_${name}_verzug_sekunden`, "gauge", `Alter des ältesten Eintrags: ${text} (0 = leer).`);
      wert(`carraway_rueckstand_${name}_verzug_sekunden`, {}, r.aeltesterSekunden);
    }
    if (betrieb) {
      kopf("carraway_worker_herzschlag_alter_sekunden", "gauge", "Sekunden seit dem letzten Herzschlag des Workers; fehlt, wenn noch nie einer gemeldet wurde.");
      if (betrieb.worker.herzschlagAlterSekunden !== null) wert("carraway_worker_herzschlag_alter_sekunden", {}, betrieb.worker.herzschlagAlterSekunden);
      kopf("carraway_worker_lebt", "gauge", "1, wenn der letzte Herzschlag des Workers höchstens 30 Sekunden alt ist, sonst 0.");
      wert("carraway_worker_lebt", {}, betrieb.worker.status === "ok" ? 1 : 0);
    }

    kopf("carraway_prozess_laufzeit_sekunden", "gauge", "Laufzeit des API-Prozesses.");
    wert("carraway_prozess_laufzeit_sekunden", {}, (Date.now() - this.start) / 1000);
    kopf("carraway_prozess_speicher_bytes", "gauge", "Resident Set Size des API-Prozesses.");
    wert("carraway_prozess_speicher_bytes", {}, process.memoryUsage().rss);
    return `${zeilen.join("\n")}\n`;
  }
}
