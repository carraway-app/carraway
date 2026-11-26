import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db, schema } from "../index";
import * as s from "../schema";
import type { Demodaten } from "./erzeuge";
import { slug } from "./namen";
import type { DemoSprache } from "./texte";
import { erzeugeRng } from "./zufall";

/**
 * CRM der Demo-Daten (Etappe 20): eigene Felder mit Werten, Beschäftigungen (auch frühere), Kontakte an Deals, Listen mit Listenfeldern und Aufgaben.
 * Alles erfunden; eigener Zufallsstrom und feste Kennungen, damit die übrigen Demo-Daten unverändert bleiben und der Bestand bei gleicher Saat gleich ist.
 * Namen und Optionen der Felder, Listen, Ansichten und die Aufgabentitel folgen `DEMO_SPRACHE` (Standard Deutsch); die Schlüssel der Felder sind in beiden Sprachen gleich.
 */

export interface DemoCrm {
  feldDefinitionen: (typeof schema.feldDefinition.$inferInsert)[];
  beschaeftigungen: (typeof schema.beschaeftigung.$inferInsert)[];
  dealKontakte: (typeof schema.dealKontakt.$inferInsert)[];
  listen: (typeof schema.liste.$inferInsert)[];
  listenEintraege: (typeof schema.listeEintrag.$inferInsert)[];
  aufgaben: (typeof schema.aufgabe.$inferInsert)[];
  /** Rückverweise der Verknüpfungsfelder (damit „Verknüpft“ auf der Datensatzseite etwas zeigt). */
  datensatzLinks: (typeof schema.datensatzLink.$inferInsert)[];
}

const festeId = (name: string): string => {
  const h = createHash("sha1").update(`demo-crm:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

type Farbe = "grau" | "signal" | "blau" | "violett" | "tuerkis" | "rose" | "sand";
const opt = (schluessel: string, label: string, farbe: Farbe) => ({ schluessel, label, farbe });

export const DEMO_FELD = {
  interesse: festeId("feld:interesse"),
  tags: festeId("feld:tags"),
  mitarbeiter: festeId("feld:mitarbeiter"),
  letzterKontakt: festeId("feld:letzter_kontakt"),
  kanal: festeId("feld:kanal"),
  newsletter: festeId("feld:newsletter"),
  wahrscheinlichkeit: festeId("feld:wahrscheinlichkeit"),
  naechsterSchritt: festeId("feld:naechster_schritt"),
  gespraech: festeId("feld:gespraech"),
  umsatz: festeId("feld:umsatz"),
  hauptkontakt: festeId("feld:hauptkontakt"),
  betreuung: festeId("feld:betreuung"),
  stufe: festeId("feld:stufe"),
  volumen: festeId("feld:volumen"),
};
export const DEMO_LISTE = { coInvestoren: festeId("liste:co_investoren_2026"), pipeline: festeId("liste:pipeline_deals"), lpPipeline: festeId("liste:lp_pipeline") };

const TAGS = ["energie", "mobilitaet", "gesundheit", "software"] as const;

/** Texte der Demo-Daten des CRM je Sprache (Feldnamen, Optionen, Listen, Ansichten, Aufgaben). */
const TEXT = {
  de: {
    interesse: ["Interesse", "Hoch", "Mittel", "Niedrig"],
    tags: ["Schwerpunkte", "Energie", "Mobilität", "Gesundheit", "Software"],
    mitarbeiter: "Mitarbeitende",
    letzterKontakt: "Letzter Kontakt",
    kanal: ["Bevorzugter Kanal", "E-Mail", "Telefon", "Persönlich"],
    newsletter: "Newsletter",
    wahrscheinlichkeit: "Wahrscheinlichkeit in Prozent",
    naechsterSchritt: "Nächster Schritt",
    schritte: ["Unterlagen anfordern", "Termin mit Gründern", "Bewertung abstimmen", "Gremienvorlage vorbereiten"],
    gespraech: ["Status Gespräch", "Offen", "Terminiert", "Geführt"],
    umsatz: "Jahresumsatz",
    hauptkontakt: "Hauptkontakt",
    betreuung: "Betreuung",
    stufe: ["Stufe", "Erstkontakt", "Gespräch", "Prüfung", "Zusage"],
    volumen: "Geplantes Volumen",
    frueher: ["Beirat", "Mitgründung", "Beratung"],
    rollen: ["Gründung", "Finanzen", "Technik"],
    listen: {
      coInvestoren: ["Co-Investoren 2026", "Mögliche Co-Investoren für laufende Runden"],
      pipeline: ["Deals in der Prüfung", "Offene Deals ab der Prüfung"],
      lpPipeline: ["LP-Pipeline", "Mögliche Investoren (LP) nach Stufe der Ansprache"],
    },
    ansichten: { interesse: "Nach Interesse", gespraeche: "Gespräche nach Status", lp: "LP-Pipeline nach Stufe", kanal: "Kontakte nach Kanal", phase: "Deals nach Phase" },
    aufgaben: ["Unterlagen anfordern", "Rückruf vereinbaren", "Gremienvorlage prüfen", "Referenzen einholen", "Termin bestätigen"],
    aufgabeRunde: "Beteiligung an der nächsten Runde besprechen",
  },
  en: {
    interesse: ["Interest", "High", "Medium", "Low"],
    tags: ["Focus areas", "Energy", "Mobility", "Health", "Software"],
    mitarbeiter: "Employees",
    letzterKontakt: "Last contact",
    kanal: ["Preferred channel", "Email", "Phone", "In person"],
    newsletter: "Newsletter",
    wahrscheinlichkeit: "Probability in percent",
    naechsterSchritt: "Next step",
    schritte: ["Request documents", "Meeting with founders", "Align valuation", "Prepare committee paper"],
    gespraech: ["Conversation status", "Open", "Scheduled", "Held"],
    umsatz: "Annual revenue",
    hauptkontakt: "Main contact",
    betreuung: "Account owner",
    stufe: ["Stage", "First contact", "Conversation", "Review", "Commitment"],
    volumen: "Planned volume",
    frueher: ["Advisory board", "Co-founder", "Consulting"],
    rollen: ["Founder", "Finance", "Technology"],
    listen: {
      coInvestoren: ["Co-investors 2026", "Possible co-investors for current rounds"],
      pipeline: ["Deals in review", "Open deals from review onwards"],
      lpPipeline: ["LP pipeline", "Prospective investors (LPs) by stage of outreach"],
    },
    ansichten: { interesse: "By interest", gespraeche: "Conversations by status", lp: "LP pipeline by stage", kanal: "Contacts by channel", phase: "Deals by phase" },
    aufgaben: ["Request documents", "Arrange a call back", "Review committee paper", "Collect references", "Confirm appointment"],
    aufgabeRunde: "Discuss participation in the next round",
  },
} as const;

/** Schreibt Werte in die Zeilen der Demo-Daten und gibt die neuen Tabellen zurück. */
export function erzeugeCrm(d: Demodaten, seed: number, sprache: DemoSprache = "de"): DemoCrm {
  const tx = TEXT[sprache];
  const rng = erzeugeRng(((seed * 2654435761 + 200) >>> 0) as number);
  // Zweiter Zufallsstrom für das, was später dazukam: die Werte des ersten bleiben dadurch bei gleicher Saat gleich.
  const rng2 = erzeugeRng(((seed * 2654435761 + 201) >>> 0) as number);
  const heute = "2026-11-20";
  const tage = (n: number) => {
    const t = new Date(`${heute}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };

  const feldDefinitionen: DemoCrm["feldDefinitionen"] = [
    { id: DEMO_FELD.interesse, objekt: "organisation", schluessel: "interesse", name: tx.interesse[0], typ: "auswahl", optionen: { optionen: [opt("hoch", tx.interesse[1], "signal"), opt("mittel", tx.interesse[2], "blau"), opt("niedrig", tx.interesse[3], "grau")] }, position: 0 },
    { id: DEMO_FELD.tags, objekt: "organisation", schluessel: "tags", name: tx.tags[0], typ: "mehrfachauswahl", optionen: { optionen: [opt("energie", tx.tags[1], "tuerkis"), opt("mobilitaet", tx.tags[2], "violett"), opt("gesundheit", tx.tags[3], "rose"), opt("software", tx.tags[4], "blau")] }, position: 1 },
    { id: DEMO_FELD.mitarbeiter, objekt: "organisation", schluessel: "mitarbeiter", name: tx.mitarbeiter, typ: "zahl", optionen: {}, position: 2 },
    { id: DEMO_FELD.letzterKontakt, objekt: "organisation", schluessel: "letzter_kontakt", name: tx.letzterKontakt, typ: "datum", optionen: {}, position: 3 },
    { id: DEMO_FELD.umsatz, objekt: "organisation", schluessel: "umsatz", name: tx.umsatz, typ: "betrag", optionen: {}, position: 4 },
    { id: DEMO_FELD.hauptkontakt, objekt: "organisation", schluessel: "hauptkontakt", name: tx.hauptkontakt, typ: "verknuepfung", optionen: { ziel: "person" }, position: 5 },
    { id: DEMO_FELD.betreuung, objekt: "organisation", schluessel: "betreuung", name: tx.betreuung, typ: "benutzer", optionen: {}, position: 6 },
    { id: DEMO_FELD.kanal, objekt: "person", schluessel: "kanal", name: tx.kanal[0], typ: "auswahl", optionen: { optionen: [opt("mail", tx.kanal[1], "blau"), opt("telefon", tx.kanal[2], "tuerkis"), opt("persoenlich", tx.kanal[3], "sand")] }, position: 0 },
    { id: DEMO_FELD.newsletter, objekt: "person", schluessel: "newsletter", name: tx.newsletter, typ: "kontrollkaestchen", optionen: {}, position: 1 },
    { id: DEMO_FELD.wahrscheinlichkeit, objekt: "deal", schluessel: "wahrscheinlichkeit", name: tx.wahrscheinlichkeit, typ: "zahl", optionen: {}, position: 0 },
    { id: DEMO_FELD.naechsterSchritt, objekt: "deal", schluessel: "naechster_schritt", name: tx.naechsterSchritt, typ: "text", optionen: {}, position: 1 },
    { id: DEMO_FELD.gespraech, objekt: "organisation", listeId: DEMO_LISTE.coInvestoren, schluessel: "status_gespraech", name: tx.gespraech[0], typ: "auswahl", optionen: { optionen: [opt("offen", tx.gespraech[1], "signal"), opt("terminiert", tx.gespraech[2], "blau"), opt("gefuehrt", tx.gespraech[3], "grau")] }, position: 0 },
    { id: DEMO_FELD.stufe, objekt: "organisation", listeId: DEMO_LISTE.lpPipeline, schluessel: "stufe", name: tx.stufe[0], typ: "auswahl", optionen: { optionen: [opt("erstkontakt", tx.stufe[1], "grau"), opt("gespraech", tx.stufe[2], "blau"), opt("pruefung", tx.stufe[3], "violett"), opt("zusage", tx.stufe[4], "signal")] }, position: 0 },
    { id: DEMO_FELD.volumen, objekt: "organisation", listeId: DEMO_LISTE.lpPipeline, schluessel: "volumen", name: tx.volumen, typ: "betrag", optionen: {}, position: 1 },
  ];

  const datensatzLinks: DemoCrm["datensatzLinks"] = [];
  // Kontaktwege und eigene Felder der Unternehmen
  for (const o of d.organisationen) {
    const slugName = slug(o.name);
    if (rng.next() < 0.7) o.email = `kontakt@${slugName}.example`;
    if (rng.next() < 0.5) o.telefon = `+49 30 ${rng.int(100000, 999999)}`;
    if (rng.next() < 0.4) o.linkedin = `https://www.linkedin.com/company/${slugName}-beispiel`;
    const felder: Record<string, unknown> = {};
    if (rng.next() < 0.8) felder[DEMO_FELD.interesse] = rng.gewichtet([["hoch", 3], ["mittel", 4], ["niedrig", 2]] as const);
    const tags = TAGS.filter(() => rng.next() < 0.3);
    if (tags.length) felder[DEMO_FELD.tags] = tags;
    if (rng.next() < 0.7) felder[DEMO_FELD.mitarbeiter] = String(rng.int(5, 400));
    if (rng.next() < 0.6) felder[DEMO_FELD.letzterKontakt] = tage(-rng.int(3, 200));
    if (rng2.next() < 0.75) felder[DEMO_FELD.umsatz] = String(rng2.int(40, 4800) * 10_000);
    const hauptkontakt = d.personen.find((p) => p.organisationId === o.id);
    if (hauptkontakt?.id) {
      felder[DEMO_FELD.hauptkontakt] = hauptkontakt.id;
      datensatzLinks.push({ vonTyp: "organisation", vonId: o.id!, zuTyp: "person", zuId: hauptkontakt.id, art: "relation", quelleId: DEMO_FELD.hauptkontakt });
    }
    o.felder = felder;
  }
  for (const p of d.personen) {
    if (rng.next() < 0.5) p.telefon = `+49 170 ${rng.int(1000000, 9999999)}`;
    if (rng.next() < 0.3) p.linkedin = `https://www.linkedin.com/in/${slug(p.vorname)}-${slug(p.nachname)}-beispiel`;
    const felder: Record<string, unknown> = {};
    if (rng.next() < 0.7) felder[DEMO_FELD.kanal] = rng.wahl(["mail", "telefon", "persoenlich"] as const);
    if (rng.next() < 0.5) felder[DEMO_FELD.newsletter] = rng.next() < 0.6;
    p.felder = felder;
  }
  for (const dl of d.deals) {
    const felder: Record<string, unknown> = {};
    if (dl.status === "offen") felder[DEMO_FELD.wahrscheinlichkeit] = String(rng.wahl([10, 25, 40, 60, 80]));
    if (dl.status === "offen" && rng.next() < 0.6) felder[DEMO_FELD.naechsterSchritt] = rng.wahl(tx.schritte);
    dl.felder = felder;
  }

  // Beschäftigungen: Hauptzeile je Person mit Unternehmen, bei einem Teil zusätzlich eine frühere Station
  const beschaeftigungen: DemoCrm["beschaeftigungen"] = [];
  const orgIds = d.organisationen.map((o) => o.id);
  for (const p of d.personen) {
    if (!p.organisationId) continue;
    beschaeftigungen.push({ personId: p.id, organisationId: p.organisationId, funktion: p.funktion ?? null, haupt: true, von: tage(-rng.int(400, 2000)) });
    if (rng.next() < 0.15) {
      const frueher = rng.wahl(orgIds.filter((id) => id !== p.organisationId));
      beschaeftigungen.push({ personId: p.id, organisationId: frueher, funktion: rng.wahl(tx.frueher), haupt: false, von: tage(-rng.int(2200, 3600)), bis: tage(-rng.int(2100, 2190)) });
    }
  }

  // Kontakte an Deals: eine Person des Unternehmens
  const dealKontakte: DemoCrm["dealKontakte"] = [];
  for (const dl of d.deals) {
    const kandidaten = d.personen.filter((p) => p.organisationId === dl.organisationId);
    const p = kandidaten[0];
    if (p) dealKontakte.push({ dealId: dl.id, personId: p.id, rolle: rng.wahl(tx.rollen) });
  }

  // Listen
  const investoren = d.organisationen.filter((o) => o.art === "investor").slice(0, 6);
  const lpKandidaten = d.organisationen.filter((o) => o.art === "investor").slice(0, 10);
  const listen: DemoCrm["listen"] = [
    { id: DEMO_LISTE.coInvestoren, name: tx.listen.coInvestoren[0], beschreibung: tx.listen.coInvestoren[1], objekt: "organisation" },
    { id: DEMO_LISTE.pipeline, name: tx.listen.pipeline[0], beschreibung: tx.listen.pipeline[1], objekt: "deal" },
    { id: DEMO_LISTE.lpPipeline, name: tx.listen.lpPipeline[0], beschreibung: tx.listen.lpPipeline[1], objekt: "organisation" },
  ];
  const stufen = ["erstkontakt", "gespraech", "pruefung", "zusage"] as const;
  const listenEintraege: DemoCrm["listenEintraege"] = [
    ...investoren.map((o, i) => ({ listeId: DEMO_LISTE.coInvestoren, datensatzId: o.id, felder: { [DEMO_FELD.gespraech]: ["offen", "terminiert", "gefuehrt"][i % 3] } })),
    ...d.deals
      .filter((dl) => dl.status === "offen" && ["pruefung", "due_diligence", "investitionsausschuss"].includes(dl.phase ?? ""))
      .slice(0, 8)
      .map((dl) => ({ listeId: DEMO_LISTE.pipeline, datensatzId: dl.id, felder: {} })),
    ...lpKandidaten.map((o, i) => ({ listeId: DEMO_LISTE.lpPipeline, datensatzId: o.id, felder: { [DEMO_FELD.stufe]: stufen[(i + rng2.int(0, 1)) % stufen.length], ...(rng2.next() < 0.8 ? { [DEMO_FELD.volumen]: String(rng2.int(2, 40) * 250_000) } : {}) } })),
  ];

  // Aufgaben (ohne Zuständige: Demo-Benutzer gibt es erst mit dem Anmelden; `schreibeDemoCrmNachZugaengen` verteilt sie danach)
  const aufgaben: DemoCrm["aufgaben"] = [];
  const offeneDeals = d.deals.filter((dl) => dl.status === "offen").slice(0, 5);
  offeneDeals.forEach((dl, i) => {
    aufgaben.push({ titel: tx.aufgaben[i % 5]!, faellig: tage(i * 3 - 4), dealId: dl.id, erstelltVon: "demo" });
  });
  for (const o of investoren.slice(0, 2)) aufgaben.push({ titel: tx.aufgabeRunde, faellig: tage(10), organisationId: o.id, erstelltVon: "demo" });

  return { feldDefinitionen, beschaeftigungen, dealKontakte, listen, listenEintraege, aufgaben, datensatzLinks };
}

/** Gemeinsame Ansichten der Demo-Daten: Tabelle in Gruppen, Gruppierung in einer Liste, Kanban nach einem Listenfeld, dazu Kontakte und Deals gruppiert. */
export function demoAnsichten(sprache: DemoSprache = "de") {
  const a = TEXT[sprache].ansichten;
  const sp = (...felder: string[]) => felder.map((feld) => ({ feld }));
  return [
    { objekt: "organisation" as const, listeId: null, name: a.interesse, art: "tabelle" as const, konfig: { sortierung: [{ feld: "name", richtung: "auf" }], spalten: sp("name", DEMO_FELD.umsatz, "ort", DEMO_FELD.tags, DEMO_FELD.hauptkontakt, DEMO_FELD.betreuung), gruppierung: DEMO_FELD.interesse } },
    { objekt: "organisation" as const, listeId: DEMO_LISTE.coInvestoren, name: a.gespraeche, art: "tabelle" as const, konfig: { sortierung: [{ feld: "name", richtung: "auf" }], spalten: sp("name", DEMO_FELD.gespraech, DEMO_FELD.interesse, "email"), gruppierung: DEMO_FELD.gespraech } },
    { objekt: "organisation" as const, listeId: DEMO_LISTE.lpPipeline, name: a.lp, art: "kanban" as const, konfig: { sortierung: [{ feld: "name", richtung: "auf" }], spalten: sp("name", DEMO_FELD.volumen, "ort"), gruppierung: DEMO_FELD.stufe } },
    { objekt: "person" as const, listeId: null, name: a.kanal, art: "tabelle" as const, konfig: { sortierung: [{ feld: "nachname", richtung: "auf" }], spalten: sp("name", "unternehmen", DEMO_FELD.kanal, "email", "telefon"), gruppierung: DEMO_FELD.kanal } },
    { objekt: "deal" as const, listeId: null, name: a.phase, art: "tabelle" as const, konfig: { sortierung: [{ feld: "aktualisiertAm", richtung: "ab" }], spalten: sp("titel", "unternehmen", "phase", "ticket", DEMO_FELD.wahrscheinlichkeit), gruppierung: "phase" } },
  ];
}

/**
 * Teil des CRM, der Benutzer braucht und deshalb erst nach den Demo-Zugängen entsteht: gemeinsame Ansichten (Besitzer ist die verwaltende Person),
 * die Betreuung der Unternehmen und die Zuständigkeit der Aufgaben, reihum auf die genannten Personen verteilt.
 */
export async function schreibeDemoCrmNachZugaengen(db: Db, optionen: { besitzerId: string; betreuerIds: string[]; sprache?: DemoSprache }): Promise<{ ansichten: number }> {
  const { besitzerId, betreuerIds, sprache = "de" } = optionen;
  const ansichten = demoAnsichten(sprache);
  await db.transaction(async (tx) => {
    await tx.delete(s.ansicht);
    await tx.insert(s.ansicht).values(ansichten.map((a) => ({ ...a, konfig: a.konfig as Record<string, unknown>, besitzerId, geteilt: true })));
    if (betreuerIds.length === 0) return;
    const orgs = await tx.execute<{ id: string }>(sql`SELECT id FROM organisation WHERE felder ? ${DEMO_FELD.interesse} ORDER BY name, id`);
    for (const [i, o] of orgs.rows.entries()) {
      // Jede dritte Organisation bleibt ohne Betreuung (zeigt „Ohne Wert“ in der Gruppierung).
      if (i % 3 === 2) continue;
      await tx.execute(sql`UPDATE organisation SET felder = felder || jsonb_build_object(${DEMO_FELD.betreuung}::text, ${betreuerIds[i % betreuerIds.length]!}::text) WHERE id = ${o.id}`);
    }
    const aufgaben = await tx.execute<{ id: string }>(sql`SELECT id FROM aufgabe ORDER BY faellig NULLS LAST, id`);
    for (const [i, t] of aufgaben.rows.entries()) {
      if (i % 4 === 3) continue;
      await tx.execute(sql`UPDATE aufgabe SET zustaendig = ${betreuerIds[i % betreuerIds.length]!}::uuid WHERE id = ${t.id}`);
    }
  });
  return { ansichten: ansichten.length };
}
