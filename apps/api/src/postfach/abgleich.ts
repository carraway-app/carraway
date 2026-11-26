import { createHash } from "node:crypto";
import { getTableColumns, isNotNull, sql } from "drizzle-orm";
import { aktivitaet, aktivitaetSync, organisation, person } from "@carraway/db";
import type { Tx } from "../zeitlimit";
import type { MailKopf, Termin } from "./typen";

/**
 * Zuordnung zu bekannten Kontakten (Positivliste): Eine Nachricht oder ein Termin wird nur gespeichert, wenn mindestens ein Beteiligter eine
 * bekannte Person (Mailadresse im CRM) ist oder seine Adresse zur Domain einer Organisation passt (Domain der Website). Alles andere wird verworfen,
 * bevor es gespeichert wird; Adressen unbekannter Kontakte stehen nirgends (Ausnahme mit eingeschalteten Kontakten aus Postfach und Kalender:
 * Adresse und Name echter Gegenüber als Vorschlag, siehe `kontakte.ts`). Die eigene Adresse des Postfachs zählt nie, ihre Domain nie als Organisation.
 * Zusammengeführte Personen und Organisationen zeigen auf ihr Ziel.
 */

/** Freemail-Anbieter: Ihre Domain sagt nichts über eine Organisation aus, auch wenn eine Website so eingetragen wäre. */
const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "yahoo.de", "icloud.com", "me.com", "mac.com", "aol.com",
  "gmx.de", "gmx.net", "gmx.at", "gmx.ch", "web.de", "t-online.de", "freenet.de", "posteo.de", "mailbox.org", "proton.me", "protonmail.com", "mail.com", "online.de", "arcor.de",
]);

/** Freemail-Domain (Adressen dort gehören Personen, nicht einer Organisation)? */
export const istFreemail = (d: string) => FREEMAIL.has(d);

/**
 * Mehrmandanten-Hosts (jede Person bekommt eine Unterdomain) und häufige öffentliche Suffixe: Eine Website darunter sagt nichts über eine Organisation aus,
 * und ein Treffer würde Mails Fremder erfassen. Die Liste ist klein und bewusst vorsichtig; fehlt ein Anbieter, bleibt der Treffer über die Mailadresse der
 * Person (bevorzugt) der sichere Weg.
 */
const MEHRMANDANT = [
  "github.io", "gitlab.io", "azurewebsites.net", "herokuapp.com", "vercel.app", "netlify.app", "pages.dev", "web.app", "firebaseapp.com", "appspot.com",
  "blogspot.com", "wordpress.com", "wixsite.com", "weebly.com", "squarespace.com", "notion.site", "myshopify.com", "cloudfront.net", "amazonaws.com", "onrender.com",
  "fly.dev", "workers.dev", "ngrok.io", "glitch.me", "repl.co", "carrd.co", "webflow.io", "jimdofree.com", "sites.google.com",
];
const OEFFENTLICHE_SUFFIXE = new Set(["co.uk", "org.uk", "ac.uk", "com.au", "co.nz", "co.jp", "com.br", "co.za", "com.cn", "co.in", "com.tr", "com.mx", "gv.at", "co.at", "or.at"]);

/** Darf die Domain einer Website eine Organisation bezeichnen? Nein bei einem Label, Freemail, Mehrmandanten-Hosts und öffentlichen Suffixen. */
export function istUnzulaessigeOrganisationsDomain(d: string): boolean {
  if (!d.includes(".") || d.split(".").some((l) => l === "")) return true;
  if (FREEMAIL.has(d) || OEFFENTLICHE_SUFFIXE.has(d)) return true;
  return MEHRMANDANT.some((m) => d === m || d.endsWith(`.${m}`));
}

export interface BekanntePerson {
  id: string;
  organisationId: string | null;
}
export interface Bekannte {
  /** Kleingeschriebene Mailadresse → Person (zusammengeführte zeigen auf das Ziel). */
  personen: Map<string, BekanntePerson>;
  /** Domain (kleingeschrieben, ohne `www.`) → Organisation. */
  domains: Map<string, string>;
}

function domainAusWebsite(website: string | null): string | null {
  if (!website) return null;
  try {
    const host = new URL(website).hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

export async function ladeBekannte(tx: Tx): Promise<Bekannte> {
  const personenZeilen = await tx
    .select({ id: person.id, email: person.email, organisationId: person.organisationId, zusammen: person.zusammengefuehrtIn })
    .from(person)
    .where(isNotNull(person.email));
  const alle = await tx.select({ id: person.id, organisationId: person.organisationId, zusammen: person.zusammengefuehrtIn }).from(person);
  const nachId = new Map(alle.map((p) => [p.id, p]));
  const ziel = (id: string): BekanntePerson => {
    let aktuell = nachId.get(id);
    for (let i = 0; i < 5 && aktuell?.zusammen; i++) aktuell = nachId.get(aktuell.zusammen) ?? aktuell;
    return { id: aktuell?.id ?? id, organisationId: aktuell?.organisationId ?? null };
  };
  const personen = new Map<string, BekanntePerson>();
  for (const p of personenZeilen) if (p.email) personen.set(p.email.trim().toLowerCase(), ziel(p.id));

  const orgs = await tx.select({ id: organisation.id, website: organisation.website, zusammen: organisation.zusammengefuehrtIn }).from(organisation);
  const orgNachId = new Map(orgs.map((o) => [o.id, o]));
  const domains = new Map<string, string>();
  for (const o of orgs) {
    const d = domainAusWebsite(o.website);
    if (!d || istUnzulaessigeOrganisationsDomain(d)) continue;
    let ziel = o;
    for (let i = 0; i < 5 && ziel.zusammen; i++) ziel = orgNachId.get(ziel.zusammen) ?? ziel;
    domains.set(d, ziel.id);
  }
  return { personen, domains };
}

const domainVon = (adresse: string) => adresse.slice(adresse.lastIndexOf("@") + 1);

/** Nur die genau eingetragene Domain: `mail.firma.example` gehört nicht zur Organisation `firma.example` (Unterdomains nur, wenn sie selbst als Website eingetragen sind). */
function organisationZuDomain(bekannte: Bekannte, domain: string): string | null {
  return bekannte.domains.get(domain) ?? null;
}

export interface Zuordnung {
  /** Bekannte Personen unter den Beteiligten (ohne Duplikate, in der Reihenfolge der Adressen). */
  personIds: string[];
  /** Die Person, an der die Aktivität hängt (erste Gegenseite). */
  personId: string | null;
  organisationId: string | null;
}

/** Ordnet Adressen zu; `null`, wenn kein Beteiligter bekannt ist (dann wird nichts gespeichert). */
export function ordneZu(adressen: string[], eigene: string, bekannte: Bekannte): Zuordnung | null {
  const ich = eigene.trim().toLowerCase();
  const eigeneDomain = ich.includes("@") ? domainVon(ich) : "";
  const personIds: string[] = [];
  let domainOrg: string | null = null;
  let ersteOrgDerPerson: string | null = null;
  const gesehen = new Set<string>();
  for (const roh of adressen) {
    const a = roh.trim().toLowerCase();
    if (!a.includes("@") || a === ich || gesehen.has(a)) continue;
    gesehen.add(a);
    const p = bekannte.personen.get(a);
    if (p) {
      if (!personIds.includes(p.id)) personIds.push(p.id);
      if (p.organisationId) ersteOrgDerPerson ??= p.organisationId;
      continue;
    }
    const d = domainVon(a);
    if (d === eigeneDomain) continue;
    domainOrg ??= organisationZuDomain(bekannte, d);
  }
  if (personIds.length === 0 && !domainOrg) return null;
  return { personIds, personId: personIds[0] ?? null, organisationId: ersteOrgDerPerson ?? domainOrg };
}

/** Kennung eines Elements für Dublettenprüfung und Ausschlüsse (kein Klartext der Nachrichten-ID in der Datenbank). */
/** Früherer Hash (nur Bereich und ID): bleibt für die Suche nach schon gespeicherten Zeilen gültig. */
export const externHash = (bereich: "mail" | "kalender", schluessel: string) => createHash("sha256").update(`${bereich}:${schluessel}`).digest("hex");

/**
 * Hash für neue Zeilen: zusätzlich nach Anbieter (und beim Kalender nach Organisator) getrennt. Die Nachrichten- oder Termin-ID bestimmt der Absender oder
 * Organisator selbst; ohne Namensraum könnte ein anderer mit gleicher ID die echte Nachricht eines Dritten als „schon bekannt“ verdrängen.
 */
export const externHashNeu = (bereich: "mail" | "kalender", anbieter: string, schluessel: string, organisator?: string | null) =>
  createHash("sha256").update(`${bereich}|${anbieter}|${(organisator ?? "").toLowerCase()}|${schluessel}`).digest("hex");

/** Prüfwert einer Adresse für eine Aktivität: SHA-256 aus Aktivitäts-ID und Adresse; die Adresse selbst wird nicht gespeichert. */
export const adressHash = (aktivitaetId: string, adresse: string) => createHash("sha256").update(`${aktivitaetId}|${adresse.trim().toLowerCase()}`).digest("hex");

export function mailSchluessel(k: MailKopf, anbieter: string): string {
  return (k.nachrichtenId ?? `${anbieter}:${k.id}`).trim().toLowerCase();
}

export function terminSchluessel(t: Termin): string {
  return t.instanz ? `${t.id}#${t.instanz}` : t.id;
}

/** Datum in Berliner Ortszeit als `JJJJ-MM-TT` (die Aktivität kennt nur ein Datum). */
export const berlinerTag = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);

/**
 * Spalten einer Aktivität samt Herkunft synchronisierter Mails und Termine (Anbieter, Beginn, Ende, Richtung, ob sie der Person gehören); für Listen und
 * die Dealansicht. Die Abfrage verbindet `aktivitaet_sync` per Left Join.
 */
export const aktivitaetMitHerkunft = (akteurId: string) => ({
  ...getTableColumns(aktivitaet),
  sync: { anbieter: aktivitaetSync.anbieter, beginn: aktivitaetSync.beginn, ende: aktivitaetSync.ende, richtung: aktivitaetSync.richtung, absageGemeldet: sql<boolean>`${aktivitaetSync.absageGemeldetAm} IS NOT NULL`, eigene: sql<boolean>`${aktivitaetSync.benutzerId} = ${akteurId}` },
});
