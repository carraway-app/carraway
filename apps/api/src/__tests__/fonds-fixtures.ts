import { journalTypenAnApi } from "../journal-vertrag";
import { fondsAnApi, fondsFeldAnApi, fondsFeldVonApi, fondsVonApi } from "../fonds-vertrag";

const MOUNTS: Record<string, string> = {
  fondsbewegungen: "fund-movements",
  forderungen: "receivables",
  investoren: "investors",
  szenarien: "scenarios",
  tranchen: "tranches",
  vehikel: "vehicles",
  wechselkurse: "exchange-rates",
  zinslaeufe: "interest-runs",
  portal: "portal",
};
const UNTER_FONDS: Record<string, string> = {
  abgrenzung: "accruals",
  bewegungen: "movements",
  investorenzugaenge: "investor-access",
  journal: "journal",
  kapitalkonten: "capital-accounts",
  kosten: "fees-and-expenses",
  mandate: "board-mandates",
  "nav-einzelwerte": "nav-components",
  neuberechnen: "recalculate",
  periodensperre: "period-lock",
  reserven: "reserves",
  szenarien: "scenarios",
  uebersicht: "overview",
  waehrungssicht: "currency-view",
  zinsen: "interest",
};
const SEGMENTE: Record<string, string> = {
  bericht: "report",
  berichte: "reports",
  datei: "file",
  dokumente: "documents",
  duplizieren: "duplicate",
  einladung: "invite",
  erfuellt: "fulfill",
  festschreiben: "lock",
  freigeben: "approve",
  herkunft: "sources",
  ich: "me",
  kapitalstand: "capital-position",
  kapitalkonto: "capital-accounts",
  kontrolle: "checks",
  korrektur: "correct",
  mitteilungen: "notices",
  organisationen: "organizations",
  pruefen: "review",
  storno: "reverse",
  vergleich: "comparison",
  verknuepfung: "link",
  verwerfen: "discard",
  vorlage: "template",
  vorschau: "preview",
  waehrungen: "currencies",
  zahlungen: "payments",
  zeichnungen: "subscriptions",
  zugaenge: "access",
  zusageaenderungen: "commitment-changes",
  buchen: "post",
};
const WAEHRUNG: Record<string, string> = { waehrung: "currency", waehrungssicht: "currency-view", reserve: "reserve" };
const EN_MOUNTS = new Set(Object.values(MOUNTS));
const EN_UNTER_FONDS = new Set(Object.values(UNTER_FONDS));
const EN_INVESTMENT = new Set(Object.values(WAEHRUNG));
const name = (liste: Record<string, string>, segment: string) => Object.hasOwn(liste, segment) ? liste[segment]! : segment;

/** Die Fixtures beschreiben die Fachwerte. Vertragstests senden die englischen HTTP-Anfragen direkt. */
export function fondsFixturePfad(pfad: string) {
  const [basis = "", query] = pfad.split("?", 2);
  const prefix = basis.startsWith("/api/v1/") ? "/api/v1" : "";
  const teile = basis.slice(prefix.length).split("/");
  const [, wurzel = "", , unter = ""] = teile;
  let fonds = false;
  if (wurzel === "fonds" || wurzel === "funds") {
    teile[1] = "funds";
    if (unter) teile[3] = name(UNTER_FONDS, unter);
    fonds = !unter || EN_UNTER_FONDS.has(teile[3]!);
    if (fonds && unter) {
      for (let i = 4; i < teile.length; i++) teile[i] = name(SEGMENTE, teile[i]!);
    }
  } else if (Object.hasOwn(MOUNTS, wurzel) || EN_MOUNTS.has(wurzel)) {
    fonds = true;
    teile[1] = name(MOUNTS, wurzel);
    for (let i = 2; i < teile.length; i++) teile[i] = name(SEGMENTE, teile[i]!);
    if (teile[1] === "portal" && teile[2] === "fonds") teile[2] = "funds";
    if (teile[1] === "receivables" && teile[3] === "fulfill") teile[3] = "settle";
  } else if (["organisationen", "organizations"].includes(wurzel) && ["vehikel", "vehicles"].includes(unter)) {
    fonds = true;
    teile[1] = "organizations";
    teile[3] = "vehicles";
  } else if (["beteiligungen", "investments"].includes(wurzel) && (Object.hasOwn(WAEHRUNG, unter) || EN_INVESTMENT.has(unter))) {
    fonds = true;
    teile[1] = "investments";
    teile[3] = name(WAEHRUNG, unter);
  }
  const parameter = new URLSearchParams(query);
  if (fonds && query) {
    const intern = Object.fromEntries(parameter);
    const englisch = new URLSearchParams();
    for (const [feld, wert] of Object.entries(fondsAnApi(intern))) {
      englisch.set(feld, feld === "entryType" ? journalTypenAnApi(wert) : wert);
    }
    return { pfad: prefix + teile.join("/") + "?" + englisch, fonds };
  }
  return { pfad: prefix + teile.join("/").replace(/\/$/, "") + (query ? "?" + query : ""), fonds };
}

export function fondsFixtureAnApi(wert: unknown) {
  if (wert && typeof wert === "object" && "error" in wert && wert.error && typeof wert.error === "object") {
    const { fields, code, message, ...rest } = wert.error as { fields?: { field: string; code: string; message: string }[]; code: string; message: string };
    return { error: { ...fondsAnApi(rest), code, message, ...(fields ? { fields: fields.map((f) => ({ ...f, field: f.field.split(".").map(fondsFeldAnApi).join(".") })) } : {}) } };
  }
  return fondsAnApi(wert);
}

export function fondsFixtureVonApi(wert: unknown) {
  if (wert && typeof wert === "object" && "error" in wert && wert.error && typeof wert.error === "object") {
    const { fields, code, message, ...rest } = wert.error as { fields?: { field: string; code: string; message: string }[]; code: string; message: string };
    return { error: { ...fondsVonApi(rest), code, message, ...(fields ? { fields: fields.map((f) => ({ ...f, field: f.field.split(".").map(fondsFeldVonApi).join(".") })) } : {}) } };
  }
  return fondsVonApi(wert);
}
