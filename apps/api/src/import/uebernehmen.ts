import { sql } from "drizzle-orm";
import {
  aenderung,
  beteiligung,
  bewertung,
  darlehenKondition,
  finanzierungsrunde,
  fonds,
  fondsBewegung,
  importZuordnung,
  INSTRUMENT_BEZEICHNUNG,
  instrument,
  organisation,
  person,
  rundenposition,
  vorgang,
} from "@carraway/db";
import { BLAETTER, type Blatt } from "@carraway/import";
import { Decimal } from "@carraway/rechenkern";
import { berechneFondsUebersicht, standardStichtag } from "../kennzahlen/fonds";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { hauptinstrumentIds } from "../instrumente/hauptinstrument";
import { ordneStandardRundenZu } from "../instrumente/vorgang-runde";
import { standardVehikel } from "../kapital/vehikel";
import { liste } from "./sql";
import type { Plan, Zaehler } from "./pruefen";

/**
 * Schreibt den Plan einer Prüfung in die Datenbank. Der Aufrufer hat die Transaktion (über `schreibe()`) und prüft vorher Rechte,
 * Vier-Augen und Fehlerfreiheit. Alles oder nichts: Jeder Fehler hier bricht die ganze Transaktion ab. Zeilen kommen in Blöcken
 * hinein (Leistung), Protokollzeilen je Datensatz mit Aktion `anlegen`.
 */

const BLOCK = 1000;

/** Hebel für Tests: läuft nach dem Schreiben, vor dem Abschluss der Transaktion (ein später Fehler muss alles zurückrollen). */
export const importHaken: { vorAbschluss?: () => Promise<void> | void } = {};

async function blockweise<T>(zeilen: T[], einfuegen: (teil: T[]) => Promise<unknown>) {
  for (let i = 0; i < zeilen.length; i += BLOCK) await einfuegen(zeilen.slice(i, i + BLOCK));
}

export interface FondsSummen {
  kurzname: string;
  name: string;
  beteiligungen: number;
  zusagen: string;
  auszahlungen: string;
  rueckfluesse: string;
  tilgungen: string;
  abrufe: string;
  ausschuettungen: string;
  zeichnungskapital: string;
  nav: string | null;
  navStichtag: string | null;
  kontrollsummen: { groesse: string; quelle: string; ist: string | null; differenz: string | null; status: "ok" | "abweichung" | "nicht_berechnet"; stichtag: string | null }[];
}

export interface UebernahmeErgebnis {
  zaehler: Record<Blatt, Zaehler>;
  fonds: FondsSummen[];
}

/** Summen je Fonds aus der Datenbank (unabhängig vom Plan) samt NAV und Vergleich mit den Kontrollsummen der Quelle. */
export async function summenJeFonds(tx: Tx, kurznamen: string[], kontrollsummen: Plan["kontrollsummen"]): Promise<FondsSummen[]> {
  if (kurznamen.length === 0) return [];
  const { rows: fondsZeilen } = await tx.execute<{ id: string; kurzname: string; name: string; zeichnungskapital: string }>(
    sql`SELECT id, kurzname, name, zeichnungskapital::text FROM fonds WHERE kurzname = ANY(${liste(kurznamen, "text")}) ORDER BY kurzname`,
  );
  const aus: FondsSummen[] = [];
  for (const f of fondsZeilen) {
    const { rows: v } = await tx.execute<{ art: string; summe: string }>(sql`SELECT v.art::text, sum(v.betrag)::text AS summe FROM vorgang v JOIN beteiligung b ON b.id = v.beteiligung_id WHERE b.fonds_id = ${f.id} GROUP BY v.art`);
    const { rows: m } = await tx.execute<{ art: string; summe: string }>(sql`SELECT art::text, sum(betrag)::text AS summe FROM fonds_bewegung WHERE fonds_id = ${f.id} GROUP BY art`);
    const { rows: n } = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM beteiligung WHERE fonds_id = ${f.id}`);
    const nachArt = (zeilen: { art: string; summe: string }[], art: string) => new Decimal(zeilen.find((z) => z.art === art)?.summe ?? 0).toFixed(2);
    let nav: string | null;
    let navStichtag: string | null = null;
    try {
      navStichtag = kontrollsummen.find((k) => k.fondsKurzname === f.kurzname && k.groesse === "nav")?.stichtag ?? (await standardStichtag(tx, f.id));
      const uebersicht = await berechneFondsUebersicht(tx, f.id, navStichtag);
      nav = uebersicht.kennzahlen.nav.wert === null ? null : new Decimal(uebersicht.kennzahlen.nav.wert).toFixed(2);
    } catch {
      nav = null;
    }
    const summen: FondsSummen = {
      kurzname: f.kurzname,
      name: f.name,
      beteiligungen: n[0]?.n ?? 0,
      zusagen: nachArt(v, "zusage"),
      auszahlungen: nachArt(v, "auszahlung"),
      rueckfluesse: nachArt(v, "rueckfluss"),
      tilgungen: nachArt(v, "tilgung"),
      abrufe: nachArt(m, "abruf"),
      ausschuettungen: nachArt(m, "ausschuettung"),
      zeichnungskapital: new Decimal(f.zeichnungskapital).toFixed(2),
      nav,
      navStichtag,
      kontrollsummen: [],
    };
    const ist: Record<string, string | null> = { zusagen: summen.zusagen, auszahlungen: summen.auszahlungen, rueckfluesse: summen.rueckfluesse, zeichnungskapital: summen.zeichnungskapital, nav };
    for (const k of kontrollsummen.filter((x) => x.fondsKurzname === f.kurzname)) {
      const wert = ist[k.groesse] ?? null;
      summen.kontrollsummen.push({
        groesse: k.groesse,
        quelle: new Decimal(k.betrag).toFixed(2),
        ist: wert,
        differenz: wert === null ? null : new Decimal(wert).minus(k.betrag).toFixed(2),
        status: wert === null ? "nicht_berechnet" : new Decimal(wert).equals(k.betrag) ? "ok" : "abweichung",
        stichtag: k.stichtag,
      });
    }
    aus.push(summen);
  }
  return aus;
}

/**
 * Führt den Plan aus. `uebernehmer` ist der Akteur (Freigabe der Bewertungen), `erstelltVon` der Hochladende.
 * Gibt die Zähler (angelegt, unverändert, abweichend) und die Summen je Fonds zurück.
 */
export async function schreibePlan(tx: Tx, protokoll: Protokollant, plan: Plan, laufId: string, erstelltVon: string): Promise<UebernahmeErgebnis> {
  const zeilen: { aktion: string; tabelle: string; datensatzId: string; nachher: unknown }[] = [];
  const anlegen = (tabelle: string, daten: { id: string }[]) => {
    for (const x of daten) zeilen.push({ aktion: "anlegen", tabelle, datensatzId: x.id, nachher: { ...x, importLaufId: laufId } });
  };

  // Fonds (nur neue)
  const neueFonds = [...plan.fonds.values()].filter((f) => f.neu).map((f) => ({ id: f.id, name: f.name, kurzname: f.kurzname, vintage: f.vintage, zeichnungskapital: f.zeichnungskapital, waehrung: f.waehrung }));
  if (neueFonds.length) await tx.insert(fonds).values(neueFonds);
  anlegen("fonds", neueFonds);

  const orgs = plan.organisationen.map((o) => ({ id: o.id, name: o.w.name!, art: o.w.art as "unternehmen", sektor: o.w.sektor ?? null, ort: o.w.ort ?? null, website: o.w.website ?? null }));
  await blockweise(orgs, (t) => tx.insert(organisation).values(t));
  anlegen("organisation", orgs);

  const personen = plan.personen.map((p) => ({ id: p.id, vorname: p.w.vorname!, nachname: p.w.nachname!, email: p.w.email ?? null, funktion: p.w.funktion ?? null, organisationId: p.w.organisation_id ?? null }));
  await blockweise(personen, (t) => tx.insert(person).values(t));
  anlegen("person", personen);

  const bet = plan.beteiligungen.map((b) => ({
    id: b.id,
    fondsId: b.w.fonds_id!,
    organisationId: b.w.organisation_id!,
    instrument: b.w.instrument as "darlehen",
    erstinvestment: b.w.erstinvestment!,
    status: b.w.status as "aktiv",
  }));
  await blockweise(bet, (t) => tx.insert(beteiligung).values(t));
  anlegen("beteiligung", bet);
  // Jede Zeile des Blatts Beteiligungen ist ein Instrument (an der neuen oder an der vorhandenen Beteiligung). Konditionen und Vorgänge buchen auf das
  // Instrument, das die Prüfung aufgelöst hat (`w.instrument_id`); ohne Angabe auf das Hauptinstrument der Beteiligung.
  // Die Zeitstempel steigen in der Reihenfolge der Zeilen (sonst haben alle denselben Transaktionszeitpunkt): Das Hauptinstrument ist das erste aktive.
  const beginn = Date.now();
  const neueInstrumente = plan.instrumente.map((i, nr) => ({
    id: i.id,
    erstelltAm: new Date(beginn + nr),
    beteiligungId: i.w.beteiligung_id!,
    art: i.w.art as "darlehen",
    bezeichnung: i.w.bezeichnung ?? INSTRUMENT_BEZEICHNUNG[i.w.art as "darlehen"],
    status: i.w.status as "aktiv",
    optionsscheinAnzahl: i.w.optionsschein_anzahl ?? null,
    ausuebungspreis: i.w.ausuebungspreis ?? null,
    ausgabeAm: i.w.ausgabe_am ?? null,
    laufzeitBis: i.w.laufzeit_bis ?? null,
  }));
  await blockweise(neueInstrumente, (t) => tx.insert(instrument).values(t));
  anlegen("instrument", neueInstrumente);
  const instrumentVon = new Map<string, string>();
  for (const i of neueInstrumente) if (!instrumentVon.has(i.beteiligungId)) instrumentVon.set(i.beteiligungId, i.id);
  const bestehende = [...new Set([...plan.konditionen.filter((k) => !k.w.instrument_id).map((k) => k.w.beteiligung_id!), ...plan.vorgaenge.filter((v) => !v.w.instrument_id).map((v) => v.w.beteiligung_id!)])].filter((id) => !instrumentVon.has(id));
  for (const [beteiligungId, instrumentId] of await hauptinstrumentIds(tx, bestehende)) instrumentVon.set(beteiligungId, instrumentId);

  const runden = plan.runden.map((r) => ({
    id: r.id,
    organisationId: r.w.organisation_id!,
    bezeichnung: r.w.bezeichnung!,
    datum: r.w.datum!,
    preMoney: r.w.pre_money!,
    postMoney: r.w.post_money!,
    preisJeAnteil: r.w.preis_je_anteil!,
    anteileGesamtNach: r.w.anteile_gesamt_nach!,
  }));
  await blockweise(runden, (t) => tx.insert(finanzierungsrunde).values(t));
  anlegen("finanzierungsrunde", runden);

  // Das Importformat nennt den Investor; die Position kommt an sein Standard-Vehikel (es entsteht, wenn es fehlt).
  const vehikelJeInvestor = new Map<string, string>();
  for (const oid of new Set(plan.positionen.flatMap((p) => (p.w.organisation_id ? [p.w.organisation_id] : [])))) vehikelJeInvestor.set(oid, (await standardVehikel(tx, protokoll, oid)).id);
  const positionen = plan.positionen.map((p) => ({
    id: p.id,
    rundeId: p.w.runde_id!,
    fondsId: p.w.fonds_id ?? null,
    vehikelId: p.w.organisation_id ? vehikelJeInvestor.get(p.w.organisation_id)! : null,
    betrag: p.w.betrag!,
    anteile: p.w.anteile!,
    rolle: p.w.rolle as "lead",
  }));
  await blockweise(positionen, (t) => tx.insert(rundenposition).values(t));
  anlegen("rundenposition", positionen);

  const konditionen = plan.konditionen.map((k) => ({
    id: k.id,
    beteiligungId: k.w.beteiligung_id!,
    instrumentId: k.w.instrument_id ?? instrumentVon.get(k.w.beteiligung_id!)!,
    gueltigAb: k.w.gueltig_ab!,
    satzFix: k.w.satz_fix!,
    methode: k.w.methode as "act/365",
    zinsperiode: k.w.zinsperiode as "jaehrlich",
    anker: k.w.anker!,
    gewinnabhaengigSatz: k.w.gewinnabhaengig_satz ?? null,
    kappungSatz: k.w.kappung_satz ?? null,
    stundungBis: k.w.stundung_bis ?? null,
    kapitalisieren: k.w.kapitalisieren === "ja",
    faelligAm: k.w.faellig_am ?? null,
  }));
  await blockweise(konditionen, (t) => tx.insert(darlehenKondition).values(t));
  anlegen("darlehen_kondition", konditionen);

  // Vorgänge: Originale vor Stornos (der Trigger prüft den Verweis).
  const vorgaenge = plan.vorgaenge.map((v) => ({
    id: v.id,
    beteiligungId: v.w.beteiligung_id!,
    instrumentId: v.w.instrument_id ?? instrumentVon.get(v.w.beteiligung_id!)!,
    art: v.w.art as "zusage",
    valuta: v.w.valuta!,
    betrag: v.w.betrag!,
    bemerkung: v.w.bemerkung ?? null,
    kapitalisiert: v.w.kapitalisiert === "ja",
    storniertVorgangId: v.w.storniert_vorgang_id ?? null,
  }));
  const originale = vorgaenge.filter((v) => v.storniertVorgangId === null);
  const stornos = vorgaenge.filter((v) => v.storniertVorgangId !== null);
  await blockweise(originale, (t) => tx.insert(vorgang).values(t));
  await blockweise(stornos, (t) => tx.insert(vorgang).values(t));
  anlegen("vorgang", vorgaenge);
  // Runde des Instruments bzw. des stornierten Originals (der Import legt Instrumente ohne Runde an; ein Storno kann ein Altbuchung treffen).
  await ordneStandardRundenZu(tx, protokoll, vorgaenge.map((v) => v.id));

  // Bewertungen: der Import selbst ist die Vier-Augen-Freigabe (Hochladender erstellt, übernehmende Person gibt frei).
  const jetzt = new Date();
  const bewertungen = plan.bewertungen.map((b) => ({
    id: b.id,
    beteiligungId: b.w.beteiligung_id!,
    stichtag: b.w.stichtag!,
    wert: b.w.wert!,
    methode: b.w.methode as "dcf",
    begruendung: b.w.begruendung ?? null,
    grundlage: b.w.grundlage ?? null,
    status: "freigegeben" as const,
    erstelltVon,
    freigegebenVon: protokoll.akteur,
    freigegebenAm: jetzt,
  }));
  await blockweise(bewertungen, (t) => tx.insert(bewertung).values(t));
  anlegen("bewertung", bewertungen);

  const bewegungen = plan.bewegungen.map((b) => ({ id: b.id, fondsId: b.w.fonds_id!, art: b.w.art as "abruf", valuta: b.w.valuta!, betrag: b.w.betrag!, bemerkung: b.w.bemerkung ?? null }));
  await blockweise(bewegungen, (t) => tx.insert(fondsBewegung).values(t));
  anlegen("fonds_bewegung", bewegungen);

  // Zuordnung der Schlüssel (macht die Wiederholung möglich).
  const zuordnungen = [
    ...plan.zuordnungen,
    ...plan.organisationen.map((x) => ({ objekt: "organisation" as const, schluessel: x.schluessel, datensatzId: x.id })),
    ...plan.personen.map((x) => ({ objekt: "person" as const, schluessel: x.schluessel, datensatzId: x.id })),
    ...plan.beteiligungen.map((x) => ({ objekt: "beteiligung" as const, schluessel: x.schluessel, datensatzId: x.id })),
    ...plan.instrumente.map((x) => ({ objekt: "instrument" as const, schluessel: x.schluessel, datensatzId: x.id })),
    ...plan.runden.map((x) => ({ objekt: "runde" as const, schluessel: x.schluessel, datensatzId: x.id })),
    ...plan.vorgaenge.map((x) => ({ objekt: "vorgang" as const, schluessel: x.schluessel, datensatzId: x.id })),
    ...plan.bewertungen.map((x) => ({ objekt: "bewertung" as const, schluessel: x.schluessel, datensatzId: x.id })),
    ...plan.bewegungen.map((x) => ({ objekt: "bewegung" as const, schluessel: x.schluessel, datensatzId: x.id })),
  ].map((z) => ({ ...z, laufId }));
  // Verwaiste Zuordnungen (Datensatz gelöscht) werden überschrieben, damit der Schlüssel wieder frei ist.
  await blockweise(zuordnungen, (t) =>
    tx
      .insert(importZuordnung)
      .values(t)
      .onConflictDoUpdate({ target: [importZuordnung.objekt, importZuordnung.schluessel], set: { datensatzId: sql`excluded.datensatz_id`, laufId: sql`excluded.lauf_id`, angelegtAm: sql`now()` } }),
  );

  await protokoll.mehrere(zeilen);
  void aenderung;
  if (importHaken.vorAbschluss) await importHaken.vorAbschluss();

  const kurznamen = [...plan.fonds.keys()];
  return { zaehler: plan.zaehler, fonds: await summenJeFonds(tx, kurznamen, plan.kontrollsummen) };
}

export const BLATT_REIHENFOLGE = BLAETTER;
