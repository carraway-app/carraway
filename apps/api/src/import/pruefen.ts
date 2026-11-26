import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  AUSWAHL,
  auswahlWert,
  BLAETTER,
  BLATT_NAMEN,
  kappeParams,
  leseDatei,
  normalisiere as normalisiereText,
  pruefeInhalt,
  sammleExterneVerweise,
  typisiere,
  type Befund,
  type BefundParams,
  type Blatt,
  type Extern,
  type Gelesen,
  type Schweregrad,
  type Typisiert,
  type Zeile,
} from "@carraway/import";
import { Decimal } from "@carraway/rechenkern";
import { hatRolle, type Akteur } from "../anmeldung/akteur";
import { INSTRUMENT_BEZEICHNUNG, type FondsRolle } from "@carraway/db";
import { liste } from "./sql";
import { Fachfehler } from "../fehler";
import { DUBLETTEN_SCHWELLE } from "../dubletten";
import { berechneZustand, istDarlehensartig, pruefeInstrumentInvarianten, type BeteiligungZeile, type VorgangDaten } from "../instrumente/zustand";
import { pruefeDatumsfenster } from "../instrumente/stichtag";
import type { Tx } from "../zeitlimit";

/**
 * Prüfung eines Import-Laufs gegen den Bestand, ohne etwas zu schreiben. Sie liest die Datei, wendet die Regeln des Pakets an
 * und prüft zusätzlich alles, was den Bestand braucht: Dubletten, abweichende Vorgänge, Auszahlungen gegen Zusage, Kapitalverlauf,
 * Rundenpositionen, Abrufe gegen Zeichnungskapital, Periodensperre, Kontrollsummen. Von Hand angelegte Runden, Positionen und Fondsbewegungen (Etappe 4b)
 * haben keinen Eintrag in `import_zuordnung`: Der Import findet nur, was er selbst über einen Fachschlüssel angelegt hat, und ändert nie etwas anderes.
 * Importierte Runden sind abgeschlossen (Standard der Spalte `status`). Das Ergebnis enthält neben den Befunden den
 * Plan der Übernahme (was angelegt wird, was schon da ist); die Übernahme führt genau diesen Plan aus.
 */

/** Objektarten in `import_zuordnung`. */
/** `instrument`: der Schlüssel einer Zeile des Blatts Beteiligungen zeigt auf die Beteiligung (`beteiligung`) und auf ihr Instrument (`instrument`). */
export type Objekt = "organisation" | "person" | "beteiligung" | "instrument" | "runde" | "vorgang" | "bewertung" | "bewegung";

const TABELLE: Record<Objekt, string> = {
  organisation: "organisation",
  person: "person",
  beteiligung: "beteiligung",
  instrument: "instrument",
  runde: "finanzierungsrunde",
  vorgang: "vorgang",
  bewertung: "bewertung",
  bewegung: "fonds_bewegung",
};

type W = Record<string, string>;
interface Neu<T = W> {
  id: string;
  schluessel: string;
  zeile: Zeile;
  w: T;
}

export interface FondsInfo {
  id: string;
  kurzname: string;
  name: string;
  vintage: number;
  zeichnungskapital: string;
  waehrung: string;
  neu: boolean;
  zeile: Zeile | null;
}

export interface Zaehler {
  zeilen: number;
  neu: number;
  unveraendert: number;
  abweichend: number;
}

export interface Plan {
  fonds: Map<string, FondsInfo>;
  organisationen: Neu[];
  personen: Neu[];
  beteiligungen: Neu[];
  /**
   * Neue Instrumente (eine Zeile des Blatts Beteiligungen je Instrument): `w.beteiligung_id` (neue oder vorhandene Beteiligung), `w.art`, `w.bezeichnung`,
   * `w.status`. Die Beteiligung selbst entsteht nur einmal je Fonds und Unternehmen (`beteiligungen`).
   */
  instrumente: Neu[];
  runden: Neu[];
  /** Rundenposition: `w.runde_id` und `w.fonds_id` bzw. `w.organisation_id` sind aufgelöst. */
  positionen: Neu[];
  konditionen: Neu[];
  vorgaenge: Neu[];
  bewertungen: Neu[];
  bewegungen: Neu[];
  /** Neue Zuordnungen von Schlüssel zu Datensatz (auch für gebundene bestehende Organisationen). */
  zuordnungen: { objekt: Objekt; schluessel: string; datensatzId: string }[];
  zaehler: Record<Blatt, Zaehler>;
  /** Kontrollsummen der Quelle je Fonds und Größe. */
  kontrollsummen: { fondsKurzname: string; groesse: string; betrag: string; stichtag: string | null; zeile: number }[];
}

export interface Pruefergebnis {
  gelesen: Gelesen;
  typisiert: Typisiert;
  befunde: Befund[];
  plan: Plan;
  /** IDs aller bestehenden Fonds, die der Lauf berührt: benannte Fonds und die Fonds jedes aufgelösten Datensatzes (auch solcher, die der Akteur nicht sehen darf). */
  fondsIds: string[];
  /** Kurznamen der Fonds, die erst mit der Übernahme entstehen. */
  neueFonds: string[];
}

const leereZaehler = (): Record<Blatt, Zaehler> => Object.fromEntries(BLAETTER.map((b) => [b, { zeilen: 0, neu: 0, unveraendert: 0, abweichend: 0 }])) as Record<Blatt, Zaehler>;

const d = (x: string | number | null | undefined) => new Decimal(x ?? 0);
const gleich = (a: string | null | undefined, b: string | null | undefined) => (a == null || b == null ? a == b : d(a).equals(d(b)));


/** Zeilen aus einer Abfrage mit uuid-Feldern. */
async function abfrage<T>(tx: Tx, q: ReturnType<typeof sql>): Promise<T[]> {
  return (await tx.execute<Record<string, unknown>>(q)).rows as T[];
}

const alsListe = (werte: Iterable<string>): string[] => [...new Set(werte)];

/**
 * `akteur` und `mindest` bestimmen, was die Prüfung sehen darf: Datensätze (Beteiligungen, Vorgänge, Bewertungen, Fondsbewegungen,
 * Runden mit Positionen), die zu einem Fonds ohne `mindest`-Rolle gehören, werden nicht geladen und nicht verglichen; jede Zeile, die
 * sich über ihren Schlüssel darauf bezieht, bekommt den Befund `KEINE_BERECHTIGUNG_FONDS` ohne Werte aus dem Datensatz.
 * Die Prüfung vor dem Hochladen/Prüfen läuft mit `bearbeiter`, die Übernahme mit `freigeber`.
 */
export async function pruefeLauf(tx: Tx, daten: Uint8Array, dateiname: string, akteur: Akteur, mindest: FondsRolle): Promise<Pruefergebnis> {
  const optionen = { globalVerwalter: akteur.globalVerwalter };
  const gelesen = await leseDatei(daten, { dateiname });
  const befunde: Befund[] = [...gelesen.befunde];
  const typisiert = typisiere(gelesen, befunde);
  const namen = Object.fromEntries(BLAETTER.map((b) => [b, gelesen.blaetter[b]?.name ?? BLATT_NAMEN[b].de])) as Record<Blatt, string>;
  const plan: Plan = {
    fonds: new Map(),
    organisationen: [],
    personen: [],
    beteiligungen: [],
    instrumente: [],
    runden: [],
    positionen: [],
    konditionen: [],
    vorgaenge: [],
    bewertungen: [],
    bewegungen: [],
    zuordnungen: [],
    zaehler: leereZaehler(),
    kontrollsummen: [],
  };
  for (const b of BLAETTER) plan.zaehler[b].zeilen = typisiert[b].length;

  const melde = (blatt: Blatt, zeile: Zeile | null, spalte: string | null, code: string, meldung: string, params: BefundParams = {}, grad: Schweregrad = "fehler") =>
    befunde.push({ blatt, blattName: namen[blatt], zeile: zeile?.zeile ?? null, spalte, code, schweregrad: grad, meldung, params: kappeParams(params) });
  const gueltige = (blatt: Blatt) => typisiert[blatt].filter((z) => z.gueltig);

  // Bestand: Fonds und Zuordnungen -------------------------------------------------------------------------------------
  const fondsNamen = alsListe([
    ...typisiert.fonds.map((z) => z.w.fonds_kurzname),
    ...typisiert.beteiligungen.map((z) => z.w.fonds_kurzname),
    ...typisiert.rundenpositionen.map((z) => z.w.fonds_kurzname),
    ...typisiert.fondsbewegungen.map((z) => z.w.fonds_kurzname),
    ...typisiert.kontrollsummen.map((z) => z.w.fonds_kurzname),
  ].filter((x): x is string => x !== undefined));
  const fondsZeilen = fondsNamen.length
    ? await abfrage<{ id: string; kurzname: string; name: string; vintage: number; zeichnungskapital: string; waehrung: string }>(
        tx,
        sql`SELECT id, kurzname, name, vintage, zeichnungskapital::text, waehrung FROM fonds WHERE kurzname = ANY(${liste(fondsNamen, "text")})`,
      )
    : [];
  const fondsImBestand = new Map(fondsZeilen.map((f) => [f.kurzname, f]));

  const schluesselVon = (blatt: Blatt, spalte: string) => typisiert[blatt].map((z) => z.w[spalte]).filter((x): x is string => x !== undefined);
  const referenziert = sammleExterneVerweise(typisiert);
  const gesucht: Record<Objekt, string[]> = {
    organisation: alsListe([...schluesselVon("organisationen", "organisation_schluessel"), ...referenziert.organisationen]),
    person: alsListe(schluesselVon("personen", "person_schluessel")),
    beteiligung: alsListe([...schluesselVon("beteiligungen", "beteiligung_schluessel"), ...referenziert.beteiligungen]),
    instrument: alsListe([...schluesselVon("beteiligungen", "beteiligung_schluessel"), ...referenziert.beteiligungen]),
    runde: alsListe([...schluesselVon("finanzierungsrunden", "runde_schluessel"), ...referenziert.finanzierungsrunden]),
    vorgang: alsListe([...schluesselVon("vorgaenge", "vorgang_schluessel"), ...referenziert.vorgaenge]),
    bewertung: alsListe(schluesselVon("bewertungen", "bewertung_schluessel")),
    bewegung: alsListe(schluesselVon("fondsbewegungen", "bewegung_schluessel")),
  };
  const bekannt = {} as Record<Objekt, Map<string, string>>;
  for (const objekt of Object.keys(gesucht) as Objekt[]) {
    const zeilen = gesucht[objekt].length
      ? await abfrage<{ schluessel: string; datensatz_id: string }>(
          tx,
          sql`SELECT z.schluessel, z.datensatz_id FROM import_zuordnung z JOIN ${sql.raw(`"${TABELLE[objekt]}"`)} t ON t.id = z.datensatz_id WHERE z.objekt = ${objekt} AND z.schluessel = ANY(${liste(gesucht[objekt], "text")})`,
        )
      : [];
    bekannt[objekt] = new Map(zeilen.map((z) => [z.schluessel, z.datensatz_id]));
  }

  // Rechte: Fonds der bekannten Datensätze ermitteln; fremde Fonds werden ausgeblendet, bevor etwas geladen oder verglichen wird.
  const fondsVon = new Map<string, string>(); // `${objekt}|${id}` → Fonds
  const idsVon = (objekt: Objekt) => [...bekannt[objekt].values()];
  if (idsVon("beteiligung").length) for (const r of await abfrage<{ id: string; fonds_id: string }>(tx, sql`SELECT id, fonds_id FROM beteiligung WHERE id = ANY(${liste(idsVon("beteiligung"), "uuid")})`)) fondsVon.set(`beteiligung|${r.id}`, r.fonds_id);
  if (idsVon("vorgang").length) for (const r of await abfrage<{ id: string; fonds_id: string }>(tx, sql`SELECT v.id, b.fonds_id FROM vorgang v JOIN beteiligung b ON b.id = v.beteiligung_id WHERE v.id = ANY(${liste(idsVon("vorgang"), "uuid")})`)) fondsVon.set(`vorgang|${r.id}`, r.fonds_id);
  if (idsVon("bewertung").length) for (const r of await abfrage<{ id: string; fonds_id: string }>(tx, sql`SELECT w.id, b.fonds_id FROM bewertung w JOIN beteiligung b ON b.id = w.beteiligung_id WHERE w.id = ANY(${liste(idsVon("bewertung"), "uuid")})`)) fondsVon.set(`bewertung|${r.id}`, r.fonds_id);
  if (idsVon("bewegung").length) for (const r of await abfrage<{ id: string; fonds_id: string }>(tx, sql`SELECT id, fonds_id FROM fonds_bewegung WHERE id = ANY(${liste(idsVon("bewegung"), "uuid")})`)) fondsVon.set(`bewegung|${r.id}`, r.fonds_id);
  const rundenFonds = new Map<string, string[]>();
  if (idsVon("runde").length) for (const r of await abfrage<{ runde_id: string; fonds_id: string }>(tx, sql`SELECT DISTINCT runde_id, fonds_id FROM rundenposition WHERE fonds_id IS NOT NULL AND runde_id = ANY(${liste(idsVon("runde"), "uuid")})`)) (rundenFonds.get(r.runde_id) ?? rundenFonds.set(r.runde_id, []).get(r.runde_id)!).push(r.fonds_id);
  // Bereiche je Fonds: Die Übernahme schreibt Portfolio und Finanzen des Fonds; die Stufe muss in beiden Bereichen an diesem Fonds reichen.
  const darf = (fid: string) => hatRolle(akteur, fid, mindest) && hatRolle(akteur, fid, mindest, "portfolio") && hatRolle(akteur, fid, mindest, "finanzen");
  const gesperrteSchluessel: Record<Objekt, Set<string>> = { organisation: new Set(), person: new Set(), beteiligung: new Set(), instrument: new Set(), runde: new Set(), vorgang: new Set(), bewertung: new Set(), bewegung: new Set() };
  for (const objekt of ["beteiligung", "vorgang", "bewertung", "bewegung", "runde"] as Objekt[]) {
    for (const [schluessel, id] of [...bekannt[objekt]]) {
      const verboten = objekt === "runde" ? (rundenFonds.get(id)?.length ?? 0) > 0 && !rundenFonds.get(id)!.some(darf) : (fondsVon.get(`${objekt}|${id}`) ?? null) !== null && !darf(fondsVon.get(`${objekt}|${id}`)!);
      if (verboten) {
        gesperrteSchluessel[objekt].add(schluessel);
        bekannt[objekt].delete(schluessel);
      }
    }
  }
  const verbotenFonds = new Set<string>();
  for (const [kurz, f] of [...fondsImBestand]) {
    if (!darf(f.id)) {
      verbotenFonds.add(kurz);
      fondsImBestand.delete(kurz);
    }
  }
  const sperrBefund = (blatt: Blatt, z: Zeile, spalte: string) => melde(blatt, z, spalte, "KEINE_BERECHTIGUNG_FONDS", `Für den Fonds, zu dem „${z.w[spalte]}“ gehört, fehlt die Berechtigung (${mindest}). Der Datensatz wird nicht geprüft.`, { wert: z.w[spalte] ?? "", rolle: mindest });
  const SPERR_SPALTEN: { blatt: Blatt; spalte: string; objekt: Objekt }[] = [
    { blatt: "beteiligungen", spalte: "beteiligung_schluessel", objekt: "beteiligung" },
    { blatt: "vorgaenge", spalte: "beteiligung_schluessel", objekt: "beteiligung" },
    { blatt: "vorgaenge", spalte: "vorgang_schluessel", objekt: "vorgang" },
    { blatt: "vorgaenge", spalte: "storniert_vorgang_schluessel", objekt: "vorgang" },
    { blatt: "bewertungen", spalte: "beteiligung_schluessel", objekt: "beteiligung" },
    { blatt: "bewertungen", spalte: "bewertung_schluessel", objekt: "bewertung" },
    { blatt: "konditionen", spalte: "beteiligung_schluessel", objekt: "beteiligung" },
    { blatt: "fondsbewegungen", spalte: "bewegung_schluessel", objekt: "bewegung" },
    { blatt: "finanzierungsrunden", spalte: "runde_schluessel", objekt: "runde" },
    { blatt: "rundenpositionen", spalte: "runde_schluessel", objekt: "runde" },
  ];
  for (const { blatt, spalte, objekt } of SPERR_SPALTEN) {
    for (const z of typisiert[blatt]) if (z.w[spalte] !== undefined && gesperrteSchluessel[objekt].has(z.w[spalte]!)) sperrBefund(blatt, z, spalte);
  }
  for (const [blatt, spalte] of [["fonds", "fonds_kurzname"], ["beteiligungen", "fonds_kurzname"], ["rundenpositionen", "fonds_kurzname"], ["fondsbewegungen", "fonds_kurzname"], ["kontrollsummen", "fonds_kurzname"]] as const) {
    for (const z of typisiert[blatt]) if (z.w[spalte] !== undefined && verbotenFonds.has(z.w[spalte]!)) sperrBefund(blatt, z, spalte);
  }

  const extern: Extern = {
    fonds: new Set(fondsImBestand.keys()),
    organisationen: new Set(bekannt.organisation.keys()),
    beteiligungen: new Set([...bekannt.beteiligung.keys(), ...gesperrteSchluessel.beteiligung]),
    finanzierungsrunden: new Set([...bekannt.runde.keys(), ...gesperrteSchluessel.runde]),
    vorgaenge: new Set([...bekannt.vorgang.keys(), ...gesperrteSchluessel.vorgang]),
  };
  for (const k of verbotenFonds) extern.fonds = new Set([...extern.fonds, k]);
  befunde.push(...pruefeInhalt(typisiert, namen, extern));

  // Fonds ----------------------------------------------------------------------------------------------------------------
  for (const [kurzname, f] of fondsImBestand) {
    plan.fonds.set(kurzname, { id: f.id, kurzname, name: f.name, vintage: f.vintage, zeichnungskapital: f.zeichnungskapital, waehrung: f.waehrung, neu: false, zeile: null });
  }
  for (const z of gueltige("fonds")) {
    const kurz = z.w.fonds_kurzname!;
    if (verbotenFonds.has(kurz)) continue;
    const bestand = plan.fonds.get(kurz);
    if (bestand && !bestand.neu) {
      bestand.zeile = z;
      const abweichend = bestand.name !== z.w.name || bestand.vintage !== Number(z.w.vintage) || !gleich(bestand.zeichnungskapital, z.w.zeichnungskapital) || bestand.waehrung !== (z.w.waehrung ?? "EUR");
      if (abweichend) {
        plan.zaehler.fonds.abweichend++;
        melde("fonds", z, null, "FONDS_ABWEICHEND", `Der Fonds „${kurz}“ gibt es schon mit anderen Stammdaten; sie werden nicht überschrieben.`, { schluessel: kurz }, "warnung");
      } else plan.zaehler.fonds.unveraendert++;
    } else if (!bestand) {
      plan.zaehler.fonds.neu++;
      if (!optionen.globalVerwalter) melde("fonds", z, "fonds_kurzname", "FONDS_NEU_NUR_VERWALTER", "Neue Fonds legen nur globale Verwalter an.", {});
      plan.fonds.set(kurz, { id: randomUUID(), kurzname: kurz, name: z.w.name!, vintage: Number(z.w.vintage), zeichnungskapital: z.w.zeichnungskapital!, waehrung: z.w.waehrung ?? "EUR", neu: true, zeile: z });
    }
  }
  const fondsId = (kurz: string | undefined) => (kurz === undefined ? undefined : plan.fonds.get(kurz)?.id);

  // Organisationen -------------------------------------------------------------------------------------------------------
  const orgIds = new Map(bekannt.organisation);
  const orgNeu: Neu[] = [];
  const orgBestandIds = [...bekannt.organisation.values()];
  const orgBestand = orgBestandIds.length
    ? new Map((await abfrage<{ id: string; name: string; art: string }>(tx, sql`SELECT id, name, art::text FROM organisation WHERE id = ANY(${liste(orgBestandIds, "uuid")})`)).map((o) => [o.id, o]))
    : new Map<string, { id: string; name: string; art: string }>();
  const zuBinden = alsListe(gueltige("organisationen").map((z) => z.w.bestehende_id).filter((x): x is string => x !== undefined));
  const vorhandeneIds = zuBinden.length ? new Set((await abfrage<{ id: string }>(tx, sql`SELECT id FROM organisation WHERE id = ANY(${liste(zuBinden, "uuid")})`)).map((o) => o.id)) : new Set<string>();
  for (const z of gueltige("organisationen")) {
    const k = z.w.organisation_schluessel!;
    const id = bekannt.organisation.get(k);
    if (id) {
      const o = orgBestand.get(id);
      if (o && (o.name !== z.w.name || o.art !== z.w.art)) {
        plan.zaehler.organisationen.abweichend++;
        melde("organisationen", z, null, "ORGANISATION_ABWEICHEND", `Die Organisation „${k}“ gibt es schon mit anderen Stammdaten; sie werden nicht überschrieben.`, { schluessel: k }, "warnung");
      } else plan.zaehler.organisationen.unveraendert++;
    } else if (z.w.bestehende_id !== undefined) {
      if (!vorhandeneIds.has(z.w.bestehende_id)) melde("organisationen", z, "bestehende_id", "BESTEHENDE_ID_UNBEKANNT", "Eine Organisation mit dieser ID gibt es nicht.", {});
      else {
        orgIds.set(k, z.w.bestehende_id);
        plan.zuordnungen.push({ objekt: "organisation", schluessel: k, datensatzId: z.w.bestehende_id });
        plan.zaehler.organisationen.unveraendert++;
      }
    } else {
      const neu = { id: randomUUID(), schluessel: k, zeile: z, w: z.w };
      orgNeu.push(neu);
      orgIds.set(k, neu.id);
    }
  }
  plan.organisationen = orgNeu;
  plan.zaehler.organisationen.neu = orgNeu.length;

  // Dubletten: gegen den Bestand und untereinander (pg_trgm auf dem normalisierten Namen, wie bei der Anlage).
  if (orgNeu.length > 0) {
    const nNamen = orgNeu.map((o) => o.w.name!);
    const gegenBestand = await abfrage<{ ord: number; id: string; name: string; score: number }>(
      tx,
      sql`WITH e AS (SELECT ord::int AS ord, organisation_name_normalisiert(n) AS nn FROM unnest(${liste(nNamen, "text")}) WITH ORDINALITY AS t(n, ord))
          SELECT e.ord, o.id, o.name, similarity(organisation_name_normalisiert(o.name), e.nn)::float8 AS score
          FROM e JOIN organisation o ON organisation_name_normalisiert(o.name) % e.nn
          WHERE e.nn <> '' AND similarity(organisation_name_normalisiert(o.name), e.nn) >= ${DUBLETTEN_SCHWELLE}
          ORDER BY e.ord, score DESC, o.name`,
    );
    const nachZeile = new Map<number, { name: string; id: string; score: number }[]>();
    for (const r of gegenBestand) (nachZeile.get(r.ord) ?? nachZeile.set(r.ord, []).get(r.ord)!).push(r);
    for (const [ord, kandidaten] of nachZeile) {
      const o = orgNeu[ord - 1]!;
      if (o.w.dublette_bestaetigt === "ja") continue;
      const liste = kandidaten.slice(0, 3).map((x) => `„${x.name}“ (${x.id})`).join(", ");
      melde("organisationen", o.zeile, "name", "ORGANISATION_DUBLETTE_MOEGLICH", `Ähnlich wie ${liste}. Mit „bestehende_id“ die vorhandene Organisation verwenden oder mit „dublette_bestaetigt = ja“ bestätigen.`, { kandidaten: kandidaten.slice(0, 3).map((x) => `${x.name} (${x.id})`).join("; ") });
    }
    if (orgNeu.length <= 3000) {
      const innen = await abfrage<{ a: number; b: number; score: number }>(
        tx,
        sql`WITH e AS (SELECT ord::int AS ord, organisation_name_normalisiert(n) AS nn FROM unnest(${liste(nNamen, "text")}) WITH ORDINALITY AS t(n, ord))
            SELECT a.ord AS a, b.ord AS b, similarity(a.nn, b.nn)::float8 AS score FROM e a JOIN e b ON a.ord < b.ord AND a.nn % b.nn
            WHERE a.nn <> '' AND similarity(a.nn, b.nn) >= ${DUBLETTEN_SCHWELLE}`,
      );
      const gemeldet = new Set<number>();
      for (const r of innen) {
        const spaeter = orgNeu[r.b - 1]!;
        const frueher = orgNeu[r.a - 1]!;
        if (spaeter.w.dublette_bestaetigt === "ja" || gemeldet.has(r.b) || nachZeile.has(r.b)) continue;
        gemeldet.add(r.b);
        melde("organisationen", spaeter.zeile, "name", "ORGANISATION_DOPPELT_IN_DATEI", `Ähnlich wie „${frueher.w.name}“ in Zeile ${frueher.zeile.zeile} derselben Datei. Mit „dublette_bestaetigt = ja“ bestätigen.`, { name: frueher.w.name ?? "", zeile: frueher.zeile.zeile });
      }
    }
  }

  // Personen --------------------------------------------------------------------------------------------------------------
  for (const z of gueltige("personen")) {
    const k = z.w.person_schluessel!;
    if (bekannt.person.has(k)) plan.zaehler.personen.unveraendert++;
    else plan.personen.push({ id: randomUUID(), schluessel: k, zeile: z, w: { ...z.w, ...(z.w.organisation_schluessel && orgIds.get(z.w.organisation_schluessel) ? { organisation_id: orgIds.get(z.w.organisation_schluessel)! } : {}) } });
  }
  plan.zaehler.personen.neu = plan.personen.length;

  // Beteiligungen und ihre Instrumente ------------------------------------------------------------------------------------
  // Eine Zeile des Blatts ist ein Instrument. Die Beteiligung gibt es einmal je Fonds und Unternehmen: Ist sie schon da (im Bestand oder weiter oben
  // in der Datei), kommt das Instrument an sie, sonst entsteht sie mit der Zeile.
  const betIds = new Map(bekannt.beteiligung);
  const betBestandIds = [...bekannt.beteiligung.values()];
  interface BetBestand { id: string; fonds_id: string; organisation_id: string; instrument: string; status: string; erstinvestment: string }
  const betBestand = new Map<string, BetBestand>();
  if (betBestandIds.length) {
    for (const b of await abfrage<BetBestand>(tx, sql`SELECT id, fonds_id, organisation_id, instrument::text, status::text, erstinvestment::text FROM beteiligung WHERE id = ANY(${liste(betBestandIds, "uuid")})`)) betBestand.set(b.id, b);
  }
  const betInfo = new Map<string, { fondsId: string; instrument: string; status: string; neu: boolean; schluessel: string }>();
  for (const [k, id] of bekannt.beteiligung) {
    const b = betBestand.get(id);
    if (b) betInfo.set(k, { fondsId: b.fonds_id, instrument: b.instrument, status: b.status, neu: false, schluessel: k });
  }
  // Vorhandene Beteiligungen der Fonds aus dem Blatt (Fonds und Unternehmen), mit Instrumenten.
  const zeilenFonds = alsListe(gueltige("beteiligungen").map((z) => fondsId(z.w.fonds_kurzname)).filter((x): x is string => x !== undefined));
  const vorhandeneFO = zeilenFonds.length ? await abfrage<BetBestand>(tx, sql`SELECT id, fonds_id, organisation_id, instrument::text, status::text, erstinvestment::text FROM beteiligung WHERE fonds_id = ANY(${liste(zeilenFonds, "uuid")})`) : [];
  /** Ein Instrument einer Beteiligung im Bestand oder im Plan; `id` fehlt bei einer Beteiligung, die noch kein Instrument hat (es entsteht bei der Übernahme aus ihrer Art). */
  interface InstrumentInfo { id: string | null; art: string; bezeichnung: string; status: string }
  const instrumenteJe = new Map<string, InstrumentInfo[]>();
  const betArt = new Map<string, string>();
  for (const b of [...betBestand.values(), ...vorhandeneFO]) betArt.set(b.id, b.instrument);
  {
    const ids = alsListe([...betBestand.keys(), ...vorhandeneFO.map((b) => b.id)]);
    if (ids.length) {
      for (const i of await abfrage<{ id: string; beteiligung_id: string; art: string; bezeichnung: string; status: string }>(tx, sql`SELECT id, beteiligung_id, art::text, bezeichnung, status::text FROM instrument WHERE beteiligung_id = ANY(${liste(ids, "uuid")}) ORDER BY erstellt_am, id`)) {
        (instrumenteJe.get(i.beteiligung_id) ?? instrumenteJe.set(i.beteiligung_id, []).get(i.beteiligung_id)!).push({ id: i.id, art: i.art, bezeichnung: i.bezeichnung, status: i.status });
      }
      for (const id of ids) if (!instrumenteJe.has(id)) instrumenteJe.set(id, [{ id: null, art: betArt.get(id)!, bezeichnung: INSTRUMENT_BEZEICHNUNG[betArt.get(id)! as keyof typeof INSTRUMENT_BEZEICHNUNG] ?? betArt.get(id)!, status: "aktiv" }]);
    }
  }
  /** Der Schlüssel einer Zeile des Blatts Beteiligungen steht für ihr Instrument: Vorgänge und Konditionen ohne Angabe buchen darauf. */
  const instrumentDesSchluessels = new Map<string, InstrumentInfo>();
  // Schlüssel aus früheren Importen: Sie zeigen auch auf ihr Instrument (`import_zuordnung`, Objekt `instrument`).
  for (const [k, instrumentId] of bekannt.instrument) {
    const info = [...instrumenteJe.values()].flat().find((i) => i.id === instrumentId);
    if (info && bekannt.beteiligung.has(k)) instrumentDesSchluessels.set(k, info);
  }
  const bezeichnungDer = (z: Zeile) => z.w.bezeichnung ?? INSTRUMENT_BEZEICHNUNG[z.w.instrument as keyof typeof INSTRUMENT_BEZEICHNUNG] ?? z.w.instrument!;
  for (const z of gueltige("beteiligungen")) {
    const k = z.w.beteiligung_schluessel!;
    const fid = fondsId(z.w.fonds_kurzname);
    const oid = orgIds.get(z.w.organisation_schluessel!);
    const id = bekannt.beteiligung.get(k);
    if (id) {
      const b = betBestand.get(id);
      if (b) {
        const eigene = instrumenteJe.get(id) ?? [];
        const gefunden = eigene.find((i) => i.art === z.w.instrument && (z.w.bezeichnung === undefined || normalisiereText(i.bezeichnung) === normalisiereText(z.w.bezeichnung)));
        const passt = gefunden !== undefined;
        if (gefunden) instrumentDesSchluessels.set(k, gefunden);
        if (fid !== b.fonds_id || oid !== b.organisation_id || !passt) {
          plan.zaehler.beteiligungen.abweichend++;
          melde("beteiligungen", z, null, "BETEILIGUNG_ABWEICHEND", `Die Beteiligung „${k}“ gibt es schon mit anderem Fonds, anderer Organisation oder anderem Instrument; Beteiligungen werden nicht umgehängt.`, { schluessel: k });
        } else {
          plan.zaehler.beteiligungen.unveraendert++;
          const status = z.w.status ?? "aktiv";
          if (status !== b.status) melde("beteiligungen", z, "status", "BETEILIGUNG_STATUS_ABWEICHEND", `Der Stand der Beteiligung ist im Bestand „${b.status}“, die Datei sagt „${status}“; er wird nicht geändert.`, { bestand: b.status, datei: status }, "warnung");
        }
      }
      continue;
    }
    if (fid === undefined || oid === undefined) continue; // Verweisfehler sind schon gemeldet
    const status = z.w.status ?? "aktiv";
    const art = z.w.instrument!;
    const bezeichnung = bezeichnungDer(z);
    const geplant = plan.beteiligungen.find((p) => p.w.fonds_id === fid && p.w.organisation_id === oid);
    const bestehend = vorhandeneFO.find((v) => v.fonds_id === fid && v.organisation_id === oid);
    let zielId: string;
    if (geplant) zielId = geplant.id;
    else if (bestehend) zielId = bestehend.id;
    else {
      const neu: Neu = { id: randomUUID(), schluessel: k, zeile: z, w: { ...z.w, fonds_id: fid, organisation_id: oid, status } };
      plan.beteiligungen.push(neu);
      zielId = neu.id;
    }
    const bisher = instrumenteJe.get(zielId) ?? [];
    const treffer = bisher.find((i) => i.art === art && normalisiereText(i.bezeichnung) === normalisiereText(bezeichnung));
    if (treffer && bestehend) {
      melde("beteiligungen", z, null, "BETEILIGUNG_VORHANDEN", `Diese Beteiligung (Fonds, Organisation) gibt es schon (${bestehend.id}) mit demselben Instrument, aber ohne diesen Schlüssel.`, { id: bestehend.id });
      continue;
    }
    const instr: Neu = { id: randomUUID(), schluessel: k, zeile: z, w: { beteiligung_id: zielId, art, bezeichnung, status: status === "aktiv" ? "aktiv" : status === "exit" ? "verkauft" : "abgeschrieben" } };
    plan.instrumente.push(instr);
    const info: InstrumentInfo = { id: instr.id, art, bezeichnung, status: instr.w.status! };
    (instrumenteJe.get(zielId) ?? instrumenteJe.set(zielId, []).get(zielId)!).push(info);
    instrumentDesSchluessels.set(k, info);
    betIds.set(k, zielId);
    betInfo.set(k, { fondsId: fid, instrument: art, status, neu: !bestehend, schluessel: k });
    // Weitere Zeile zur selben (neuen oder vorhandenen) Beteiligung: Der Schlüssel zeigt auf sie.
    if (bestehend || (geplant && geplant.schluessel !== k)) plan.zuordnungen.push({ objekt: "beteiligung", schluessel: k, datensatzId: zielId });
  }
  plan.zaehler.beteiligungen.neu = plan.instrumente.length;

  // Das Instrument einer Vorgangs- oder Konditionszeile: genannt (Art oder Bezeichnung) oder das Hauptinstrument (erstes aktives, sonst das letzte).
  const gewarnt = new Set<string>();
  const loeseInstrumentZeile = (blatt: Blatt, z: Zeile, bid: string): InstrumentInfo | null => {
    const alle = instrumenteJe.get(bid) ?? [{ id: null, art: betArt.get(bid) ?? betInfo.get(z.w.beteiligung_schluessel!)?.instrument ?? "offene_beteiligung", bezeichnung: "", status: "aktiv" }];
    const wunsch = z.w.instrument;
    if (wunsch === undefined) {
      const vomSchluessel = instrumentDesSchluessels.get(z.w.beteiligung_schluessel!);
      if (vomSchluessel) return vomSchluessel;
      // Mehrere Instrumente und keine Angabe: Es gilt das Hauptinstrument; die Zeile sollte das Instrument nennen.
      const warnSchluessel = `${blatt}|${z.w.beteiligung_schluessel}`;
      if (alle.length > 1 && !gewarnt.has(warnSchluessel)) {
        gewarnt.add(warnSchluessel);
        melde(blatt, z, "instrument", "INSTRUMENT_MEHRDEUTIG", `Die Beteiligung hat mehrere Instrumente; ohne Angabe gilt das Hauptinstrument (${(alle.find((i) => i.status === "aktiv") ?? alle[alle.length - 1]!).bezeichnung}).`, { wert: z.w.beteiligung_schluessel ?? "" }, "warnung");
      }
      return alle.find((i) => i.status === "aktiv") ?? alle[alle.length - 1]!;
    }
    const n = normalisiereText(wunsch);
    const nachBezeichnung = alle.filter((i) => normalisiereText(i.bezeichnung) === n);
    if (nachBezeichnung.length === 1) return nachBezeichnung[0]!;
    const art = nachBezeichnung.length === 0 ? auswahlWert(AUSWAHL.instrument, wunsch) : undefined;
    const nachArt = art === undefined ? nachBezeichnung : alle.filter((i) => i.art === art);
    if (nachArt.length === 1) return nachArt[0]!;
    if (nachArt.length === 0) melde(blatt, z, "instrument", "INSTRUMENT_UNBEKANNT", `Die Beteiligung hat kein Instrument „${wunsch}“.`, { wert: wunsch });
    else melde(blatt, z, "instrument", "INSTRUMENT_MEHRDEUTIG", `„${wunsch}“ passt auf mehrere Instrumente der Beteiligung; bitte die Bezeichnung angeben.`, { wert: wunsch });
    return null;
  };

  // Finanzierungsrunden und Positionen -------------------------------------------------------------------------------------
  const rundeIds = new Map(bekannt.runde);
  interface RundeBestand { id: string; organisation_id: string; datum: string; pre_money: string; post_money: string; art: string }
  const rundeBestand = new Map<string, RundeBestand>();
  const rundeBestandIds = [...bekannt.runde.values()];
  if (rundeBestandIds.length) for (const r of await abfrage<RundeBestand>(tx, sql`SELECT id, organisation_id, datum::text, pre_money::text, post_money::text, art::text FROM finanzierungsrunde WHERE id = ANY(${liste(rundeBestandIds, "uuid")})`)) rundeBestand.set(r.id, r);
  for (const z of gueltige("finanzierungsrunden")) {
    const k = z.w.runde_schluessel!;
    const id = bekannt.runde.get(k);
    const oid = orgIds.get(z.w.organisation_schluessel!);
    if (id) {
      const r = rundeBestand.get(id);
      if (r && (r.organisation_id !== oid || r.datum !== z.w.datum || !gleich(r.pre_money, z.w.pre_money) || !gleich(r.post_money, z.w.post_money))) {
        plan.zaehler.finanzierungsrunden.abweichend++;
        melde("finanzierungsrunden", z, null, "RUNDE_ABWEICHEND", `Die Runde „${k}“ gibt es schon mit anderen Werten; sie wird nicht geändert.`, { schluessel: k }, "warnung");
      } else plan.zaehler.finanzierungsrunden.unveraendert++;
    } else if (oid !== undefined) {
      const neu: Neu = { id: randomUUID(), schluessel: k, zeile: z, w: { ...z.w, organisation_id: oid } };
      plan.runden.push(neu);
      rundeIds.set(k, neu.id);
    }
  }
  plan.zaehler.finanzierungsrunden.neu = plan.runden.length;
  // Positionen: je Runde und Investor höchstens eine (gleich über welches Vehikel); vorhandene Positionen werden verglichen, nicht geändert.
  const posBestand = rundeBestandIds.length
    ? await abfrage<{ runde_id: string; fonds_id: string | null; organisation_id: string | null; betrag: string; anteile: string; rolle: string }>(
        tx,
        sql`SELECT p.runde_id, p.fonds_id, v.investor_id AS organisation_id, p.betrag::text, p.anteile::text, p.rolle::text FROM rundenposition p LEFT JOIN vehikel v ON v.id = p.vehikel_id WHERE p.runde_id = ANY(${liste(rundeBestandIds, "uuid")})`,
      )
    : [];
  for (const z of gueltige("rundenpositionen")) {
    const rid = rundeIds.get(z.w.runde_schluessel!);
    const fid = fondsId(z.w.fonds_kurzname);
    const oid = z.w.investor_schluessel ? orgIds.get(z.w.investor_schluessel) : undefined;
    if (rid === undefined || (fid === undefined && oid === undefined) || (fid !== undefined && oid !== undefined)) continue;
    if (rundeBestand.get(rid)?.art === "bruecke") {
      melde("rundenpositionen", z, null, "RUNDE_BRUECKE_OHNE_ANTEILE", "Die Runde ist eine Brückenrunde ohne Bewertung und ohne Positionen mit Anteilen.", {});
      continue;
    }
    const vorhanden = posBestand.find((p) => p.runde_id === rid && (fid ? p.fonds_id === fid : p.organisation_id === oid));
    if (vorhanden) {
      if (!gleich(vorhanden.betrag, z.w.betrag) || vorhanden.anteile !== z.w.anteile || vorhanden.rolle !== z.w.rolle) {
        plan.zaehler.rundenpositionen.abweichend++;
        melde("rundenpositionen", z, null, "POSITION_ABWEICHEND", "Diese Position gibt es schon mit anderen Werten; sie wird nicht geändert.", {}, "warnung");
      } else plan.zaehler.rundenpositionen.unveraendert++;
    } else plan.positionen.push({ id: randomUUID(), schluessel: "", zeile: z, w: { ...z.w, runde_id: rid, ...(fid ? { fonds_id: fid } : { organisation_id: oid! }) } });
  }
  plan.zaehler.rundenpositionen.neu = plan.positionen.length;

  // Sperren der Periode ------------------------------------------------------------------------------------------------------
  const alleFondsIds = alsListe([...plan.fonds.values()].filter((f) => !f.neu).map((f) => f.id));
  const sperren = new Map<string, string>();
  if (alleFondsIds.length) for (const s of await abfrage<{ fonds_id: string; gesperrt_bis: string }>(tx, sql`SELECT fonds_id, gesperrt_bis::text FROM periodensperre WHERE fonds_id = ANY(${liste(alleFondsIds, "uuid")})`)) sperren.set(s.fonds_id, s.gesperrt_bis);
  const gesperrt = (fid: string, datum: string) => {
    const bis = sperren.get(fid);
    return bis !== undefined && datum <= bis ? bis : null;
  };

  // Vorgänge ------------------------------------------------------------------------------------------------------------------
  const vorgangIds = new Map(bekannt.vorgang);
  interface VorgangBestand { id: string; beteiligung_id: string; art: string; valuta: string; betrag: string; kapitalisiert: boolean; storniert_vorgang_id: string | null }
  const vorgangBestand = new Map<string, VorgangBestand>();
  const vorgangBestandIds = [...bekannt.vorgang.values()];
  if (vorgangBestandIds.length) for (const v of await abfrage<VorgangBestand>(tx, sql`SELECT id, beteiligung_id, art::text, valuta::text, betrag::text, kapitalisiert, storniert_vorgang_id FROM vorgang WHERE id = ANY(${liste(vorgangBestandIds, "uuid")})`)) vorgangBestand.set(v.id, v);
  const betKeyVonId = new Map([...betIds].map(([k, id]) => [id, k]));
  const vorgangNeu: Neu[] = [];
  const dateiVorgang = new Map<string, Zeile>(); // Schlüssel → Zeile für neue Vorgänge
  // Originale vor Stornos, sonst nach Valuta (stabil), damit die Stornoprüfung des Triggers erfüllt ist.
  const vorgangsZeilen = [...gueltige("vorgaenge")].sort((a, b) => Number(a.w.storniert_vorgang_schluessel !== undefined) - Number(b.w.storniert_vorgang_schluessel !== undefined) || a.zeile - b.zeile);
  for (const z of vorgangsZeilen) {
    const k = z.w.vorgang_schluessel!;
    const bid = betIds.get(z.w.beteiligung_schluessel!);
    const id = bekannt.vorgang.get(k);
    if (id) {
      const v = vorgangBestand.get(id);
      const zielId = z.w.storniert_vorgang_schluessel ? vorgangIds.get(z.w.storniert_vorgang_schluessel) : null;
      if (v && (v.beteiligung_id !== bid || v.art !== z.w.art || v.valuta !== z.w.valuta || !gleich(v.betrag, z.w.betrag) || v.kapitalisiert !== (z.w.kapitalisiert === "ja") || (v.storniert_vorgang_id ?? null) !== (zielId ?? null))) {
        plan.zaehler.vorgaenge.abweichend++;
        melde(
          "vorgaenge",
          z,
          null,
          "VORGANG_ABWEICHEND",
          `Der Vorgang „${k}“ ist schon übernommen, aber anders gebucht (Bestand: ${v.art} ${v.betrag} am ${v.valuta}). Übernommene Vorgänge werden nie geändert; die Korrektur ist ein Storno des bestehenden Vorgangs mit neuem Schlüssel.`,
          { schluessel: k, art: v.art, betrag: v.betrag, valuta: v.valuta },
          "warnung",
        );
      } else plan.zaehler.vorgaenge.unveraendert++;
      continue;
    }
    if (bid === undefined) continue;
    const instr = loeseInstrumentZeile("vorgaenge", z, bid);
    if (!instr) continue;
    const neu: Neu = { id: randomUUID(), schluessel: k, zeile: z, w: { ...z.w, beteiligung_id: bid, instrument_art: instr.art, ...(instr.id ? { instrument_id: instr.id } : {}) } };
    vorgangNeu.push(neu);
    vorgangIds.set(k, neu.id);
    dateiVorgang.set(k, z);
  }
  plan.vorgaenge = vorgangNeu;
  plan.zaehler.vorgaenge.neu = vorgangNeu.length;

  // Stornos gegen den Bestand: Original liegt schon in der Datenbank.
  const storniert = alsListe(vorgangNeu.map((v) => v.w.storniert_vorgang_schluessel).filter((x): x is string => x !== undefined && bekannt.vorgang.has(x)).map((x) => bekannt.vorgang.get(x)!));
  if (storniert.length) {
    const originale = new Map((await abfrage<VorgangBestand>(tx, sql`SELECT id, beteiligung_id, art::text, valuta::text, betrag::text, kapitalisiert, storniert_vorgang_id FROM vorgang WHERE id = ANY(${liste(storniert, "uuid")})`)).map((v) => [v.id, v]));
    const schonStorniert = new Set((await abfrage<{ storniert_vorgang_id: string }>(tx, sql`SELECT storniert_vorgang_id FROM vorgang WHERE storniert_vorgang_id = ANY(${liste(storniert, "uuid")})`)).map((r) => r.storniert_vorgang_id));
    for (const v of vorgangNeu) {
      const ziel = v.w.storniert_vorgang_schluessel;
      const oid = ziel ? bekannt.vorgang.get(ziel) : undefined;
      const o = oid ? originale.get(oid) : undefined;
      if (!ziel || !o) continue;
      if (schonStorniert.has(o.id)) melde("vorgaenge", v.zeile, "storniert_vorgang_schluessel", "BEREITS_STORNIERT", `Der Vorgang „${ziel}“ ist im Bestand schon storniert.`, { schluessel: ziel });
      if (o.storniert_vorgang_id) melde("vorgaenge", v.zeile, "storniert_vorgang_schluessel", "STORNO_UNGUELTIG", "Ein Storno kann nicht selbst storniert werden.", { grund: "storno_von_storno" });
      if (!d(v.w.betrag).equals(d(o.betrag).neg())) melde("vorgaenge", v.zeile, "betrag", "STORNO_UNGUELTIG", `Der Betrag eines Storno muss ${d(o.betrag).neg().toFixed(2)} sein.`, { grund: "betrag", erwartet: d(o.betrag).neg().toFixed(2) });
      if (o.art !== v.w.art) melde("vorgaenge", v.zeile, "art", "STORNO_UNGUELTIG", "Ein Storno hat dieselbe Art wie das Original.", { grund: "art" });
      if (o.beteiligung_id !== v.w.beteiligung_id) melde("vorgaenge", v.zeile, "beteiligung_schluessel", "STORNO_UNGUELTIG", "Ein Storno gehört zur selben Beteiligung wie das Original.", { grund: "beteiligung" });
      if (v.w.valuta! < o.valuta) melde("vorgaenge", v.zeile, "valuta", "STORNO_UNGUELTIG", `Die Valuta des Storno darf nicht vor der des Originals (${o.valuta}) liegen.`, { grund: "valuta", erwartet: o.valuta });
      v.w.storniert_vorgang_id = o.id;
    }
  }
  for (const v of vorgangNeu) {
    const ziel = v.w.storniert_vorgang_schluessel;
    if (ziel && !v.w.storniert_vorgang_id && vorgangIds.has(ziel)) v.w.storniert_vorgang_id = vorgangIds.get(ziel)!;
  }

  // Invarianten je Beteiligung (Endstand: Bestand plus neue Vorgänge), Instrument und Stand, Periodensperre.
  const betMitNeuenVorgaengen = alsListe(vorgangNeu.map((v) => v.w.beteiligung_id!));
  const bestandVorgaenge = new Map<string, VorgangDaten[]>();
  const abgaenge = new Map<string, Decimal>();
  const betDaten = new Map<string, BeteiligungZeile>();
  const echteBeteiligungen = betMitNeuenVorgaengen.filter((id) => !plan.beteiligungen.some((b) => b.id === id));
  if (echteBeteiligungen.length) {
    for (const v of await abfrage<{ id: string; beteiligung_id: string; instrument_id: string; art: VorgangDaten["art"]; valuta: string; betrag: string; kapitalisiert: boolean; storniert_vorgang_id: string | null; tranche_id: string | null; bemerkung: string | null }>(
      tx,
      sql`SELECT id, beteiligung_id, instrument_id, art::text, valuta::text, betrag::text, kapitalisiert, storniert_vorgang_id, tranche_id, bemerkung FROM vorgang WHERE beteiligung_id = ANY(${liste(echteBeteiligungen, "uuid")})`,
    )) {
      (bestandVorgaenge.get(v.beteiligung_id) ?? bestandVorgaenge.set(v.beteiligung_id, []).get(v.beteiligung_id)!).push({ id: v.id, beteiligungId: v.beteiligung_id, instrumentId: v.instrument_id, art: v.art, valuta: v.valuta, betrag: v.betrag, kapitalisiert: v.kapitalisiert, storniertVorgangId: v.storniert_vorgang_id, trancheId: v.tranche_id, bemerkung: v.bemerkung, erfasstAm: new Date() });
    }
    for (const r of await abfrage<{ beteiligung_id: string; summe: string }>(tx, sql`SELECT beteiligung_id, sum(buchwert_abgang)::text AS summe FROM verkauf WHERE beteiligung_id = ANY(${liste(echteBeteiligungen, "uuid")}) AND storniert_am IS NULL GROUP BY beteiligung_id`)) abgaenge.set(r.beteiligung_id, d(r.summe));
    for (const b of await abfrage<{ id: string; fonds_id: string; organisation_id: string; instrument: BeteiligungZeile["instrument"]; status: BeteiligungZeile["status"]; erstinvestment: string }>(tx, sql`SELECT id, fonds_id, organisation_id, instrument::text, status::text, erstinvestment::text FROM beteiligung WHERE id = ANY(${liste(echteBeteiligungen, "uuid")})`)) {
      betDaten.set(b.id, { id: b.id, fondsId: b.fonds_id, organisationId: b.organisation_id, dealId: null, instrument: b.instrument, erstinvestment: b.erstinvestment, status: b.status, erstelltAm: new Date() });
    }
  }
  for (const p of plan.beteiligungen) {
    betDaten.set(p.id, { id: p.id, fondsId: p.w.fonds_id!, organisationId: p.w.organisation_id!, dealId: null, instrument: p.w.instrument as BeteiligungZeile["instrument"], erstinvestment: p.w.erstinvestment!, status: p.w.status as BeteiligungZeile["status"], erstelltAm: new Date() });
  }
  for (const bid of betMitNeuenVorgaengen) {
    const b = betDaten.get(bid);
    const neue = vorgangNeu.filter((v) => v.w.beteiligung_id === bid);
    if (!b) continue;
    const neueDaten: VorgangDaten[] = neue.map((v) => ({
      id: v.id,
      beteiligungId: bid,
      art: v.w.art as VorgangDaten["art"],
      valuta: v.w.valuta!,
      betrag: v.w.betrag!,
      kapitalisiert: v.w.kapitalisiert === "ja",
      storniertVorgangId: v.w.storniert_vorgang_id ?? null,
      trancheId: null,
      bemerkung: v.w.bemerkung ?? null,
      erfasstAm: new Date(),
      ...(v.w.instrument_id ? { instrumentId: v.w.instrument_id } : {}),
    }));
    for (const v of neue) {
      const sperre = gesperrt(b.fondsId, v.w.valuta!);
      if (sperre) melde("vorgaenge", v.zeile, "valuta", "PERIODE_GESPERRT", `Die Periode ist bis ${sperre} gesperrt; die Valuta ${v.w.valuta} ist nicht buchbar.`, { bis: sperre, datum: v.w.valuta ?? "" });
      const instrumentArt = v.w.instrument_art ?? b.instrument;
      if ((v.w.art === "tilgung" || v.w.art === "zins" || v.w.art === "zinszahlung") && !istDarlehensartig(instrumentArt)) melde("vorgaenge", v.zeile, "art", "INSTRUMENT_PASST_NICHT", `Das Instrument (${instrumentArt}) erlaubt diesen Vorgang nicht.`, { instrument: instrumentArt });
      if (v.w.art === "dividende" && instrumentArt !== "offene_beteiligung") melde("vorgaenge", v.zeile, "art", "INSTRUMENT_PASST_NICHT", `Eine Dividende gibt es nur auf Eigenkapital (${instrumentArt}).`, { instrument: instrumentArt });
      if (!plan.beteiligungen.some((p) => p.id === bid) && b.status !== "aktiv" && (v.w.art === "zusage" || v.w.art === "auszahlung") && !v.w.storniert_vorgang_schluessel) {
        melde("vorgaenge", v.zeile, "art", "BETEILIGUNG_NICHT_AKTIV", `Die Beteiligung ist nicht aktiv (${b.status}).`, { status: b.status });
      }
    }
    // Invarianten je Instrument (Zusage, Kapitalverlauf, Berichtigung); der Buchwert gilt je Beteiligung.
    const alle = [...(bestandVorgaenge.get(bid) ?? []), ...neueDaten];
    const gesamt = berechneZustand(alle, abgaenge.get(bid) ?? 0);
    const instrumentSchluessel = (v: VorgangDaten) => v.instrumentId ?? "ohne";
    for (const ik of new Set(neueDaten.map(instrumentSchluessel))) {
      const art = neue.find((v) => (v.w.instrument_id ?? "ohne") === ik)?.w.instrument_art ?? b.instrument;
      try {
        pruefeInstrumentInvarianten(bid, art, berechneZustand(alle.filter((v) => instrumentSchluessel(v) === ik)), gesamt);
      } catch (fehler) {
        if (!(fehler instanceof Fachfehler)) throw fehler;
        const zeile = neue.find((v) => (v.w.instrument_id ?? "ohne") === ik)!.zeile;
        melde("vorgaenge", zeile, null, fehler.code, `${fehler.message} (Beteiligung „${betKeyVonId.get(bid) ?? bid}“)`, { beteiligung: betKeyVonId.get(bid) ?? bid, meldung: fehler.message });
      }
    }
  }

  // Bewertungen -----------------------------------------------------------------------------------------------------------------
  const bewBestandIds = [...bekannt.bewertung.values()];
  const bewBestand = new Map<string, { id: string; beteiligung_id: string; stichtag: string; wert: string; methode: string }>();
  if (bewBestandIds.length) for (const b of await abfrage<{ id: string; beteiligung_id: string; stichtag: string; wert: string; methode: string }>(tx, sql`SELECT id, beteiligung_id, stichtag::text, wert::text, methode::text FROM bewertung WHERE id = ANY(${liste(bewBestandIds, "uuid")})`)) bewBestand.set(b.id, b);
  const bewBetIds = alsListe(gueltige("bewertungen").map((z) => betIds.get(z.w.beteiligung_schluessel!)).filter((x): x is string => x !== undefined));
  const freigegeben = bewBetIds.length ? await abfrage<{ beteiligung_id: string; stichtag: string }>(tx, sql`SELECT beteiligung_id, stichtag::text FROM bewertung WHERE status = 'freigegeben' AND beteiligung_id = ANY(${liste(bewBetIds, "uuid")})`) : [];
  const bewImLauf = new Map<string, Zeile>();
  for (const z of gueltige("bewertungen")) {
    const k = z.w.bewertung_schluessel!;
    const bid = betIds.get(z.w.beteiligung_schluessel!);
    const id = bekannt.bewertung.get(k);
    if (id) {
      const b = bewBestand.get(id);
      if (b && (b.beteiligung_id !== bid || b.stichtag !== z.w.stichtag || !gleich(b.wert, z.w.wert) || b.methode !== z.w.methode)) {
        plan.zaehler.bewertungen.abweichend++;
        melde("bewertungen", z, null, "BEWERTUNG_ABWEICHEND", `Die Bewertung „${k}“ ist schon übernommen, aber anders (Bestand: ${b.wert} am ${b.stichtag}); freigegebene Bewertungen werden nicht geändert, eine Korrektur geht über eine neue Bewertung.`, { schluessel: k, wert: b.wert, stichtag: b.stichtag }, "warnung");
      } else plan.zaehler.bewertungen.unveraendert++;
      continue;
    }
    if (bid === undefined) continue;
    const schluesselTag = `${bid}|${z.w.stichtag}`;
    if (bewImLauf.has(schluesselTag)) {
      melde("bewertungen", z, "stichtag", "BEWERTUNG_STICHTAG_DOPPELT", `Für diese Beteiligung und diesen Stichtag steht schon in Zeile ${bewImLauf.get(schluesselTag)!.zeile} eine Bewertung.`, { zeile: bewImLauf.get(schluesselTag)!.zeile });
      continue;
    }
    bewImLauf.set(schluesselTag, z);
    if (freigegeben.some((f) => f.beteiligung_id === bid && f.stichtag === z.w.stichtag)) {
      melde("bewertungen", z, "stichtag", "BEWERTUNG_VORHANDEN", "Für diese Beteiligung und diesen Stichtag gibt es schon eine freigegebene Bewertung ohne diesen Schlüssel.", {});
      continue;
    }
    const b = betDaten.get(bid) ?? (betInfo.get(z.w.beteiligung_schluessel!) ? { fondsId: betInfo.get(z.w.beteiligung_schluessel!)!.fondsId } : undefined);
    const bFonds = b?.fondsId ?? betInfo.get(z.w.beteiligung_schluessel!)?.fondsId;
    const sperre = bFonds ? gesperrt(bFonds, z.w.stichtag!) : null;
    if (sperre) melde("bewertungen", z, "stichtag", "PERIODE_GESPERRT", `Die Periode ist bis ${sperre} gesperrt; der Stichtag ${z.w.stichtag} ist nicht buchbar.`, { bis: sperre, datum: z.w.stichtag ?? "" });
    plan.bewertungen.push({ id: randomUUID(), schluessel: k, zeile: z, w: { ...z.w, beteiligung_id: bid } });
  }
  plan.zaehler.bewertungen.neu = plan.bewertungen.length;

  // Konditionen -----------------------------------------------------------------------------------------------------------------
  const kondBetIds = alsListe(gueltige("konditionen").map((z) => betIds.get(z.w.beteiligung_schluessel!)).filter((x): x is string => x !== undefined));
  const kondBestand = kondBetIds.length
    ? await abfrage<{ beteiligung_id: string; instrument_id: string | null; gueltig_ab: string; satz_fix: string; methode: string; zinsperiode: string; anker: string }>(tx, sql`SELECT beteiligung_id, instrument_id, gueltig_ab::text, satz_fix::text, methode::text, zinsperiode::text, anker::text FROM darlehen_kondition WHERE beteiligung_id = ANY(${liste(kondBetIds, "uuid")}) ORDER BY gueltig_ab`)
    : [];
  const kondInfoBestand = kondBetIds.filter((id) => !betDaten.has(id));
  if (kondInfoBestand.length) {
    for (const b of await abfrage<{ id: string; instrument: string; fonds_id: string }>(tx, sql`SELECT id, instrument::text, fonds_id FROM beteiligung WHERE id = ANY(${liste(kondInfoBestand, "uuid")})`)) {
      betInfo.set(betKeyVonId.get(b.id) ?? b.id, { fondsId: b.fonds_id, instrument: b.instrument, status: "aktiv", neu: false, schluessel: betKeyVonId.get(b.id) ?? b.id });
    }
  }
  const raster = new Map<string, { zinsperiode: string; anker: string }>();
  for (const k of kondBestand) if (!raster.has(k.instrument_id ?? `b:${k.beteiligung_id}`)) raster.set(k.instrument_id ?? `b:${k.beteiligung_id}`, { zinsperiode: k.zinsperiode, anker: k.anker });
  for (const z of [...gueltige("konditionen")].sort((a, b) => (a.w.gueltig_ab! < b.w.gueltig_ab! ? -1 : 1))) {
    const bid = betIds.get(z.w.beteiligung_schluessel!);
    if (bid === undefined) continue;
    const instr = loeseInstrumentZeile("konditionen", z, bid);
    if (!instr) continue;
    const instrument = instr.art;
    // Konditionen gehören zum Instrument; bei einer Beteiligung ohne Instrument im Bestand gilt die Beteiligung.
    const instrumentSchluessel = instr.id ?? `b:${bid}`;
    const vorhanden = kondBestand.find((k) => (instr.id ? k.instrument_id === instr.id : k.beteiligung_id === bid) && k.gueltig_ab === z.w.gueltig_ab);
    if (vorhanden) {
      if (!gleich(vorhanden.satz_fix, z.w.satz_fix) || vorhanden.methode !== z.w.methode || vorhanden.zinsperiode !== z.w.zinsperiode || vorhanden.anker !== z.w.anker) {
        plan.zaehler.konditionen.abweichend++;
        melde("konditionen", z, null, "KONDITION_ABWEICHEND", "Für dieses Datum gibt es schon andere Konditionen; eine Änderung ist eine neue Version mit neuem Datum.", {}, "warnung");
      } else plan.zaehler.konditionen.unveraendert++;
      continue;
    }
    if (instrument !== undefined && !istDarlehensartig(instrument)) melde("konditionen", z, "beteiligung_schluessel", "INSTRUMENT_PASST_NICHT", `Das Instrument (${instrument}) hat keine Konditionen.`, { instrument });
    for (const [spalte, datum] of [["gueltig_ab", z.w.gueltig_ab], ["anker", z.w.anker], ["faellig_am", z.w.faellig_am], ["stundung_bis", z.w.stundung_bis]] as const) {
      if (!datum) continue;
      try {
        pruefeDatumsfenster(spalte, datum);
      } catch (fehler) {
        if (fehler instanceof Fachfehler) melde("konditionen", z, spalte, "DATUM_AUSSERHALB", String((fehler.zusatz?.felder as { meldung: string }[] | undefined)?.[0]?.meldung ?? fehler.message), { datum });
        else throw fehler;
      }
    }
    const erste = raster.get(instrumentSchluessel);
    if (erste) {
      if (z.w.zinsperiode !== erste.zinsperiode) melde("konditionen", z, "zinsperiode", "KONDITION_RASTER_UNGLEICH", `Die Zinsperiode darf sich in späteren Versionen nicht ändern (${erste.zinsperiode}).`, { grund: "zinsperiode", wert: erste.zinsperiode });
      else if (z.w.zinsperiode !== "endfaellig" && z.w.anker !== erste.anker) melde("konditionen", z, "anker", "KONDITION_RASTER_UNGLEICH", `Der Anker darf sich nur bei endfälliger Verzinsung ändern (${erste.anker}).`, { grund: "anker", wert: erste.anker });
    } else raster.set(instrumentSchluessel, { zinsperiode: z.w.zinsperiode!, anker: z.w.anker! });
    plan.konditionen.push({ id: randomUUID(), schluessel: "", zeile: z, w: { ...z.w, beteiligung_id: bid, ...(instr.id ? { instrument_id: instr.id } : {}) } });
  }
  plan.zaehler.konditionen.neu = plan.konditionen.length;

  // Fondsbewegungen --------------------------------------------------------------------------------------------------------------
  const bewegBestandIds = [...bekannt.bewegung.values()];
  const bewegBestand = new Map<string, { id: string; fonds_id: string; art: string; valuta: string; betrag: string }>();
  if (bewegBestandIds.length) for (const b of await abfrage<{ id: string; fonds_id: string; art: string; valuta: string; betrag: string }>(tx, sql`SELECT id, fonds_id, art::text, valuta::text, betrag::text FROM fonds_bewegung WHERE id = ANY(${liste(bewegBestandIds, "uuid")})`)) bewegBestand.set(b.id, b);
  for (const z of gueltige("fondsbewegungen")) {
    const k = z.w.bewegung_schluessel!;
    const fid = fondsId(z.w.fonds_kurzname);
    const id = bekannt.bewegung.get(k);
    if (id) {
      const b = bewegBestand.get(id);
      if (b && (b.fonds_id !== fid || b.art !== z.w.art || b.valuta !== z.w.valuta || !gleich(b.betrag, z.w.betrag))) {
        plan.zaehler.fondsbewegungen.abweichend++;
        melde("fondsbewegungen", z, null, "FONDSBEWEGUNG_ABWEICHEND", `Die Bewegung „${k}“ ist schon übernommen, aber anders; sie wird nicht geändert.`, { schluessel: k }, "warnung");
      } else plan.zaehler.fondsbewegungen.unveraendert++;
    } else if (fid !== undefined) plan.bewegungen.push({ id: randomUUID(), schluessel: k, zeile: z, w: { ...z.w, fonds_id: fid } });
  }
  plan.zaehler.fondsbewegungen.neu = plan.bewegungen.length;
  for (const z of plan.bewegungen) {
    const sperre = gesperrt(z.w.fonds_id!, z.w.valuta!);
    if (sperre) melde("fondsbewegungen", z.zeile, "valuta", "PERIODE_GESPERRT", `Die Periode ist bis ${sperre} gesperrt; die Valuta ${z.w.valuta} ist nicht buchbar.`, { bis: sperre, datum: z.w.valuta ?? "" });
  }

  // Summen je Fonds: Abrufe gegen Zeichnungskapital, Zusagen (Warnung), Kontrollsummen ----------------------------------------------
  const fondsMitSummen = alsListe([...plan.fonds.values()].map((f) => f.id));
  const sumVorgang = new Map<string, Decimal>(); // fondsId|art
  const sumAbruf = new Map<string, Decimal>();
  const bestandFonds = fondsMitSummen.filter((id) => ![...plan.fonds.values()].some((f) => f.id === id && f.neu));
  if (bestandFonds.length) {
    for (const r of await abfrage<{ fonds_id: string; art: string; summe: string }>(tx, sql`SELECT b.fonds_id, v.art::text, sum(v.betrag)::text AS summe FROM vorgang v JOIN beteiligung b ON b.id = v.beteiligung_id WHERE b.fonds_id = ANY(${liste(bestandFonds, "uuid")}) GROUP BY b.fonds_id, v.art`)) sumVorgang.set(`${r.fonds_id}|${r.art}`, d(r.summe));
    for (const r of await abfrage<{ fonds_id: string; summe: string }>(tx, sql`SELECT fonds_id, sum(betrag)::text AS summe FROM fonds_bewegung WHERE art = 'abruf' AND fonds_id = ANY(${liste(bestandFonds, "uuid")}) GROUP BY fonds_id`)) sumAbruf.set(r.fonds_id, d(r.summe));
  }
  for (const v of vorgangNeu) {
    const fid = betDaten.get(v.w.beteiligung_id!)?.fondsId;
    if (fid) sumVorgang.set(`${fid}|${v.w.art}`, (sumVorgang.get(`${fid}|${v.w.art}`) ?? d(0)).plus(v.w.betrag!));
  }
  for (const b of plan.bewegungen) if (b.w.art === "abruf") sumAbruf.set(b.w.fonds_id!, (sumAbruf.get(b.w.fonds_id!) ?? d(0)).plus(b.w.betrag!));
  for (const f of plan.fonds.values()) {
    const kapital = d(f.zeichnungskapital);
    const abrufe = sumAbruf.get(f.id) ?? d(0);
    const zeile = plan.bewegungen.find((b) => b.w.fonds_id === f.id && b.w.art === "abruf")?.zeile ?? null;
    if (abrufe.greaterThan(kapital) && zeile) melde("fondsbewegungen", zeile, "betrag", "ABRUFE_UEBER_ZEICHNUNGSKAPITAL", `Die Abrufe des Fonds „${f.kurzname}“ (${abrufe.toFixed(2)}) übersteigen das Zeichnungskapital (${kapital.toFixed(2)}).`, { fonds: f.kurzname, summe: abrufe.toFixed(2), kapital: kapital.toFixed(2) });
    const zusagen = sumVorgang.get(`${f.id}|zusage`) ?? d(0);
    const zusageZeile = vorgangNeu.find((v) => betDaten.get(v.w.beteiligung_id!)?.fondsId === f.id && v.w.art === "zusage")?.zeile ?? null;
    if (zusagen.greaterThan(kapital) && zusageZeile) melde("vorgaenge", zusageZeile, "betrag", "ZUSAGEN_UEBER_ZEICHNUNGSKAPITAL", `Die Zusagen des Fonds „${f.kurzname}“ (${zusagen.toFixed(2)}) übersteigen das Zeichnungskapital (${kapital.toFixed(2)}).`, { fonds: f.kurzname, summe: zusagen.toFixed(2), kapital: kapital.toFixed(2) }, "warnung");
  }
  for (const z of gueltige("kontrollsummen")) {
    const f = plan.fonds.get(z.w.fonds_kurzname!);
    if (!f) continue;
    plan.kontrollsummen.push({ fondsKurzname: f.kurzname, groesse: z.w.groesse!, betrag: z.w.betrag!, stichtag: z.w.stichtag ?? null, zeile: z.zeile });
    const nachUebernahme: Record<string, Decimal | undefined> = {
      zusagen: sumVorgang.get(`${f.id}|zusage`) ?? d(0),
      auszahlungen: sumVorgang.get(`${f.id}|auszahlung`) ?? d(0),
      rueckfluesse: sumVorgang.get(`${f.id}|rueckfluss`) ?? d(0),
      zeichnungskapital: d(f.zeichnungskapital),
    };
    const ist = nachUebernahme[z.w.groesse!];
    if (ist && !ist.equals(z.w.betrag!)) {
      melde("kontrollsummen", z, "betrag", "KONTROLLSUMME_ABWEICHEND", `Die Summe laut Quelle (${d(z.w.betrag).toFixed(2)}) weicht von der Summe nach der Übernahme (${ist.toFixed(2)}) ab (${z.w.groesse}, Fonds „${f.kurzname}“).`, { quelle: d(z.w.betrag).toFixed(2), uebernahme: ist.toFixed(2), groesse: z.w.groesse ?? "", fonds: f.kurzname });
    }
  }

  const fondsIds = new Set<string>([...fondsZeilen.map((f) => f.id), ...fondsVon.values(), ...[...rundenFonds.values()].flat()]);
  return { gelesen, typisiert, befunde, plan, fondsIds: [...fondsIds], neueFonds: [...plan.fonds.values()].filter((f) => f.neu).map((f) => f.kurzname) };
}
