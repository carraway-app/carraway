// Alte Fachbegriffe in Szenarien und Mock-Daten bleiben lesbar; die Anfragen und Antworten auf
// der Leitung verwenden den öffentlichen Vertrag. Vertragstests verwenden rohe HTTP-Anfragen.
import { kapitalQuelleAnApi, kapitalQuelleVonApi, portfolioAnApi, portfolioFeldVonApi, portfolioVonApi } from "../portfolio-vertrag";

const PFADSEGMENTE: Record<string, string> = {
  "abfragen": "metric-requests",
  "abruf": "fetch",
  "abschliessen": "close",
  "aenderungen": "changes",
  "anteilsklassen": "share-classes",
  "austritte": "departures",
  "auswahl": "selection",
  "beobachtung": "monitoring",
  "bestaetigen": "confirm",
  "beteiligungen": "investments",
  "bewertungen": "valuations",
  "bewertungsrunde": "valuation-rounds",
  "bewertungsrunden": "valuation-rounds",
  "eintraege": "entries",
  "ereignisse": "events",
  "erfuellt": "fulfill",
  "erledigen": "resolve",
  "finanzierungsrunden": "financing-rounds",
  "freigeben": "approve",
  "gelesen": "mark-read",
  "insolvenz": "insolvency",
  "instrumentdaten": "instrument-data",
  "instrumente": "instruments",
  "jahresueberschuss": "net-income",
  "kapitaltabelle": "cap-table",
  "katalog": "catalog",
  "kaufpreisanpassung": "purchase-price-adjustment",
  "kennzahlen": "metrics",
  "konditionen": "terms",
  "kurve": "curve",
  "mandate": "board-mandates",
  "meilensteine": "milestones",
  "meldungen": "notifications",
  "mitarbeiterpools": "employee-pools",
  "neuer-link": "renew-link",
  "per-mail": "send-email",
  "pool-vorschlag": "pool-suggestion",
  "positionen": "positions",
  "register-hinweise": "register-notices",
  "runden": "rounds",
  "rundenpositionen": "round-positions",
  "rundentransaktionen": "round-transactions",
  "storno": "reverse",
  "suche": "search",
  "tranchen": "tranches",
  "uebernehmen": "apply",
  "uebersicht": "overview",
  "verkaeufe": "sales",
  "verkauf": "sale",
  "versionen": "versions",
  "verwerfen": "discard",
  "vorschau": "preview",
  "wandlung": "conversion",
  "wasserfall": "waterfall",
  "werte": "values",
  "widerrufen": "revoke",
  "wiedereroeffnen": "reopen",
  "zahlungen": "payments",
  "zinsen": "interest",
  "zuteilungen": "grants"
};

type Format = "fachlich" | "portfolio" | "exercise" | "transfer";

export function portfolioFixturePfad(pfad: string, oeffentlich = false): { pfad: string; format: Format } {
  const [basis = "", query] = pfad.split("?", 2);
  const praefix = basis.startsWith("/api/v1/") ? "/api/v1" : "";
  const teile = basis.slice(praefix.length).split("/");
  const [, wurzel, , unter] = teile;
  const legacyMount = wurzel === "beteiligungen" || wurzel === "finanzierungsrunden";
  const istBeteiligung = wurzel === (oeffentlich ? "investments" : "beteiligungen");
  const istRunde = wurzel === (oeffentlich ? "financing-rounds" : "finanzierungsrunden");
  const namen = (...de: string[]) => oeffentlich ? de.map((x) => PFADSEGMENTE[x] ?? x) : de;
  const organisationsRoute = wurzel === (oeffentlich ? "organizations" : "organisationen");
  const uebertragung = organisationsRoute && unter === "share-transfers";
  const ausuebung = wurzel === (oeffentlich ? "instruments" : "instrumente") && unter === "exercises";
  const artikel = namen("instrumente", "rundenpositionen", "bewertungen", "bewertungsrunden", "kennzahlen", "meilensteine", "verkaeufe", "register");
  const mitPortfolio = istBeteiligung && !["waehrung", "waehrungssicht", "reserve", "vorgaenge", "transactions", "buchhaltungsschluessel", "accounting-keys", "berichte", "felder", "instrumentfelder", "fields", "instrument-fields"].includes(unter ?? "")
    || istRunde && unter !== "felder" && unter !== "fields"
    || artikel.includes(wurzel ?? "")
    || (wurzel === "fonds" || wurzel === "funds") && namen("bewertungsrunde", "bewertungsrunden", "bewertungen", "kennzahlen").includes(unter ?? "")
    || organisationsRoute && namen("finanzierungsrunden", "anteilsklassen", "rundentransaktionen", "mitarbeiterpools", "register").includes(unter ?? "");
  const format: Format = uebertragung ? "transfer" : ausuebung ? "exercise" : mitPortfolio ? "portfolio" : "fachlich";
  if (oeffentlich) return { pfad, format };
  if (mitPortfolio) {
    // Ressourcen und Aktionen stehen in festen Segmenten; IDs können beliebige Kennungen sein.
    const unterWurzel = wurzel === "fonds" || wurzel === "funds" || wurzel === "organisationen" || istBeteiligung || istRunde || wurzel === "instrumente" || wurzel === "rundenpositionen";
    const feste = unterWurzel ? [1, 3] : [1, 2];
    if (wurzel === "register" && teile[2] === "meldungen") feste.push(4);
    if (wurzel === "kennzahlen") feste.push(4);
    if (wurzel === "bewertungen" || wurzel === "bewertungsrunden" || wurzel === "meilensteine" || wurzel === "verkaeufe") feste.push(3);
    if (istBeteiligung || wurzel === "fonds" || wurzel === "funds" || wurzel === "organisationen") feste.push(4);
    if (wurzel === "organisationen" && teile[3] === "mitarbeiterpools") feste.push(5, 7);
    if (wurzel === "organisationen" && teile[3] === "register") feste.push(6);
    if (istBeteiligung && teile[3] === "esg" && teile[4] === "abfragen") teile[4] = "metric-requests";
    for (const i of feste) {
      const segment = teile[i];
      if (segment && Object.hasOwn(PFADSEGMENTE, segment)) teile[i] = PFADSEGMENTE[segment]!;
    }
    if (wurzel === "kennzahlen" && teile[2] === "catalog" && teile[3]) {
      teile[3] = portfolioAnApi({ schluessel: teile[3] }).metricKey;
    }
  } else if (legacyMount) teile[1] = PFADSEGMENTE[wurzel!]!;
  if (organisationsRoute && (mitPortfolio || uebertragung)) teile[1] = "organizations";
  const parameter = new URLSearchParams(query);
  const abfrage = mitPortfolio && query ? new URLSearchParams(portfolioAnApi(Object.fromEntries(parameter))).toString() : query;
  return { pfad: praefix + teile.join("/") + (abfrage ? "?" + abfrage : ""), format };
}

export function portfolioFixtureAnApi(wert: unknown, format: Format, eingabe = false): unknown {
  if (format === "portfolio") return portfolioAnApi(wert);
  if (!wert || typeof wert !== "object") return wert;
  if (format === "transfer") {
    if ("source" in wert && typeof wert.source === "string") return { ...wert, source: kapitalQuelleAnApi(wert.source) };
    if ("data" in wert && Array.isArray(wert.data)) return { ...wert, data: wert.data.map((x) => portfolioFixtureAnApi(x, format)) };
  }
  if (format === "exercise" && !eingabe && "instrument" in wert) return { ...wert, instrument: portfolioAnApi(wert.instrument) };
  return wert;
}

export function portfolioFixtureVonApi(wert: unknown, format: Format): unknown {
  if (format === "fachlich" || !wert || typeof wert !== "object") return wert;
  if ("error" in wert && wert.error && typeof wert.error === "object") {
    const { fields, code, message, ...rest } = wert.error as { fields?: { field: string; code: string; message: string }[]; code: string; message: string };
    return { ...wert, error: {
      ...portfolioVonApi(rest), code, message,
      ...(fields ? { fields: fields.map((f) => ({ ...f, field: f.field.split(".").map(portfolioFeldVonApi).join(".") })) } : {}),
    } };
  }
  if (format === "portfolio") return portfolioVonApi(wert);
  if (format === "exercise" && "instrument" in wert) return { ...wert, instrument: portfolioVonApi(wert.instrument) };
  if (format === "transfer") {
    if ("source" in wert && typeof wert.source === "string") return { ...wert, source: kapitalQuelleVonApi(wert.source) };
    if ("data" in wert && Array.isArray(wert.data)) return { ...wert, data: wert.data.map((x) => portfolioFixtureVonApi(x, format)) };
  }
  return wert;
}
