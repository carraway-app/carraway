import type { FondsAuszug, Quellbestand, QuellOrganisation } from "./modell";

/**
 * Führt die Auszüge mehrerer Fonds zu einem Bestand zusammen. Jedes Objekt erscheint genau einmal: Ein Unternehmen, an dem mehrere
 * Fonds beteiligt sind (Cross-Investment), bleibt ein Unternehmen mit einer Beteiligung je Fonds. Führt das Quellsystem dasselbe
 * Unternehmen unter zwei IDs (gleiche Website-Domain oder gleicher Name ohne Rechtsform), zeigt die spätere ID auf die frühere
 * (`umgeleitet`); Personen mit derselben E-Mail ebenso. Jede Umleitung wird als Hinweis gemeldet, damit die Abnahme sie sieht.
 */

export interface Umleitung {
  art: "organisation" | "person";
  von: string;
  nach: string;
  grund: "domain" | "name" | "email";
}

export interface ZusammenfuehrOptionen {
  /** Quell-IDs von Unternehmen, die nie mit einem anderen zusammengeführt werden. */
  getrennt?: readonly string[];
}

/** Domain einer Website ohne Schema, `www.` und Pfad, klein geschrieben; `null` ohne verwertbare Angabe. */
export function domainVon(website: string | undefined): string | null {
  if (!website) return null;
  const roh = website.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  const host = roh.split(/[/?#:]/)[0] ?? "";
  return host.includes(".") ? host : null;
}

const RECHTSFORMEN = /\b(gmbh|ag|se|kg|kgaa|ug|ohg|gbr|mbh|co|ltd|limited|inc|llc|plc|bv|nv|sa|sas|sarl|ab|oy|as|aps|spa|srl)\b/g;

/** Name zum Vergleich: klein, ohne Rechtsform, Satzzeichen und doppelte Leerzeichen; `null`, wenn nichts übrig bleibt. */
export function nameZumVergleich(name: string): string | null {
  const n = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(RECHTSFORMEN, " ")
    .replace(/\s+/g, " ")
    .trim();
  return n === "" ? null : n;
}

/** Ergänzt fehlende Angaben eines Objekts aus einem späteren Vorkommen (das erste Vorkommen behält seine Werte). */
function ergaenze<T extends object>(ziel: T, quelle: T) {
  for (const [k, v] of Object.entries(quelle)) if (v !== undefined && (ziel as Record<string, unknown>)[k] === undefined) (ziel as Record<string, unknown>)[k] = v;
}

function eindeutig<T extends { quellId: string }>(listen: T[][]): T[] {
  const nachId = new Map<string, T>();
  for (const liste of listen)
    for (const x of liste) {
      const vorhanden = nachId.get(x.quellId);
      if (vorhanden) ergaenze(vorhanden, x);
      else nachId.set(x.quellId, { ...x });
    }
  return [...nachId.values()];
}

export function fuehreZusammen(auszuege: readonly FondsAuszug[], optionen: ZusammenfuehrOptionen = {}): { bestand: Quellbestand; umleitungen: Umleitung[] } {
  const getrennt = new Set(optionen.getrennt ?? []);
  const umleitungen: Umleitung[] = [];
  const umgeleitet: Record<string, string> = {};

  // Unternehmen: erst je Quell-ID, dann gleiche Domain oder gleicher Name auf das erste Vorkommen.
  const alleOrganisationen = eindeutig(auszuege.map((a) => a.organisationen));
  const organisationen: QuellOrganisation[] = [];
  const nachDomain = new Map<string, string>();
  const nachName = new Map<string, string>();
  for (const o of alleOrganisationen) {
    const domain = domainVon(o.website);
    const name = nameZumVergleich(o.name);
    const ziel = getrennt.has(o.quellId) ? undefined : (domain ? nachDomain.get(domain) : undefined) ?? (name ? nachName.get(name) : undefined);
    if (ziel && !getrennt.has(ziel)) {
      umgeleitet[o.quellId] = ziel;
      umleitungen.push({ art: "organisation", von: o.quellId, nach: ziel, grund: domain && nachDomain.get(domain) === ziel ? "domain" : "name" });
      ergaenze(organisationen.find((x) => x.quellId === ziel)!, { ...o, quellId: ziel });
      continue;
    }
    organisationen.push(o);
    if (getrennt.has(o.quellId)) continue;
    if (domain && !nachDomain.has(domain)) nachDomain.set(domain, o.quellId);
    if (name && !nachName.has(name)) nachName.set(name, o.quellId);
  }
  const org = (id: string) => umgeleitet[id] ?? id;

  // Personen: je Quell-ID, dann gleiche E-Mail.
  const personen: Quellbestand["personen"] = [];
  const nachEmail = new Map<string, string>();
  for (const p of eindeutig(auszuege.map((a) => a.personen))) {
    const email = p.email?.trim().toLowerCase();
    const ziel = email ? nachEmail.get(email) : undefined;
    if (ziel) {
      umgeleitet[p.quellId] = ziel;
      umleitungen.push({ art: "person", von: p.quellId, nach: ziel, grund: "email" });
      continue;
    }
    if (email) nachEmail.set(email, p.quellId);
    personen.push({ ...p, ...(p.organisationId ? { organisationId: org(p.organisationId) } : {}) });
  }

  const runden = eindeutig(auszuege.map((a) => a.runden)).map((r) => ({
    ...r,
    organisationId: org(r.organisationId),
    positionen: r.positionen.map((p) => (p.investorId ? { ...p, investorId: org(p.investorId) } : p)),
  }));

  const summenSchluessel = new Set<string>();
  const kontrollsummen = auszuege.flatMap((a) => a.kontrollsummen).filter((s) => {
    const k = [s.fondsId, s.beteiligungId ?? "", s.groesse, s.stichtag ?? ""].join("|");
    if (summenSchluessel.has(k)) return false;
    summenSchluessel.add(k);
    return true;
  });

  return {
    bestand: {
      fonds: eindeutig(auszuege.map((a) => [a.fonds])),
      organisationen,
      personen,
      beteiligungen: eindeutig(auszuege.map((a) => a.beteiligungen)).map((b) => ({ ...b, organisationId: org(b.organisationId) })),
      runden,
      vorgaenge: eindeutig(auszuege.map((a) => a.vorgaenge)),
      kennzahlen: eindeutig(auszuege.map((a) => a.kennzahlen)).map((k) => ({ ...k, organisationId: org(k.organisationId) })),
      bewertungen: eindeutig(auszuege.map((a) => a.bewertungen)),
      kontrollsummen,
      umgeleitet,
    },
    umleitungen,
  };
}
