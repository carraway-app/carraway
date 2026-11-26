import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { anteilsklasse, finanzierungsrunde, instrument, instrumentArt, mitarbeiterpool, poolAenderung, rundenArt, rundenposition, rundenpositionZahlung, rundenRolle, vorgangRunde, wandlung, type Db } from "@carraway/db";
import { Decimal, poolShuffle, poolShuffleKennwerte } from "@carraway/rechenkern";
import { aktuellerAkteur, hatRolle } from "../anmeldung/akteur";
import { Fachfehler } from "../fehler";
import { pruefeDatumsfenster } from "../instrumente/stichtag";
import {
  BRUECKE_OHNE_ANTEILE,
  findeRundenDubletten,
  legeRundenentwurfAn,
  pruefePosition,
  ungueltig,
  wirksam,
  bucheFondsBuchungen,
  ladeRundenAntwort,
  rundenWerte,
  positionVerwendet,
  poolMitAufstockung,
  pruefeRunde,
  sperreRunde,
  verlangeBearbeiterAm,
  verlangeEntwurf,
  verlangeRolleAnAllenPositionen,
  verlangeRundenLeserecht,
  verlangeRundenrecht,
  verwandteFonds,
  type PositionZeile,
  type RundeZeile,
} from "../kapital/runden";
import { ladePoolBestand, poolBeiRunde } from "../kapital/pool";
import { anteileVorRunde } from "../kapital/anteile-vor-runde";
import { ladeRundentransaktionen } from "../kapital/rundentransaktionen";
import { ladeVehikel, vehikelDerPosition } from "../kapital/vehikel";
import { anzahlEingabe, art as poolArt, basis as poolBasis, bestandDesPools, ladePool, legePoolAn, pruefeBestand } from "./mitarbeiterbeteiligung";
import { pruefe } from "../pruefung";
import { betragEingabe, idParam, ladeOrganisation, MINDESTENS_EIN_FELD, mindestensEins, nurGesetzte, optionalerText, schreibe, textEingabe, type Protokollant } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

/**
 * Finanzierungsrunden von Hand, Positionen und Zahlungen der Co-Investoren (Etappe 4b). Die Berechtigungstabelle verlangt bei diesen Routen
 * nur die Mindestrolle an irgendeinem Fonds; die Handler prüfen genauer (`verlangeRundenrecht`): Rolle an einem Fonds, der das Unternehmen
 * hält oder in einer seiner Runden eine Position hat, beim Anlegen auch an einem Fonds, der mit einer Position einsteigt. Eine Position
 * eines Fonds verlangt außerdem die Rolle bearbeiter an diesem Fonds. Schließen = bearbeiter, Wiedereröffnen = verwalter.
 */

const geldEingabe = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "Betrag von null an mit höchstens zwei Nachkommastellen erwartet");
const preisEingabe = z.string().regex(/^(?!0+(\.0+)?$)\d{1,14}(\.\d{1,4})?$/, "Preis größer als null mit höchstens vier Nachkommastellen erwartet");
const anteileEingabe = z.string().regex(/^(?!0+$)\d{1,18}$/, "Ganze Zahl größer als null erwartet");
const valuta = z.iso.date();

const positionBasis = {
  fondsId: z.uuid().optional(),
  /** Vehikel eines Co-Investors (Auswahl `GET /vehikel`). */
  vehikelId: z.uuid().optional(),
  /** Übergangsweise: die Organisation eines Co-Investors; die Position kommt an ihr Standard-Vehikel (es entsteht, wenn es fehlt). */
  organisationId: z.uuid().optional(),
  betrag: betragEingabe,
  anteile: anteileEingabe,
  rolle: z.enum(rundenRolle.enumValues),
  anteilsklasseId: z.uuid().nullable().optional(),
};
const genauEinInvestor = { message: "Genau einer von fondsId, vehikelId und organisationId ist anzugeben", path: ["fondsId"] };
const neuePosition = z.object(positionBasis).refine((p) => [p.fondsId, p.vehikelId, p.organisationId].filter((x) => x !== undefined).length === 1, genauEinInvestor);

const rundeBasis = {
  bezeichnung: textEingabe(200),
  datum: valuta,
  preMoney: geldEingabe,
  preisJeAnteil: preisEingabe,
};
/**
 * Aufstockung des Pools der Mitarbeiterbeteiligung zur neuen Runde (Option Pool Shuffle). Ohne `poolId` nimmt die API den einzigen Pool
 * des Unternehmens; hat es keinen, legt sie mit `neuerPool` einen an (mit der Aufstockung als Schaffung); bei mehreren ist `poolId` Pflicht.
 */
const poolAufstockungEingabe = z.object({
  basis: poolBasis,
  anzahl: anzahlEingabe,
  poolId: z.uuid().optional(),
  neuerPool: z.object({ art: poolArt, bezeichnung: textEingabe(100) }).optional(),
  beschluss: textEingabe(500).nullable().optional(),
});
/** Zielgröße des Pools: größer als 0 und höchstens 0,99 (darüber wächst die Aufstockung über alle Grenzen). */
const zielBruch = z
  .string()
  .regex(/^0\.\d{1,6}$/, "Bruch größer als 0 und kleiner als 1 mit höchstens sechs Nachkommastellen erwartet")
  .refine((x) => !/^0\.0+$/.test(x) && Number(x) <= 0.99, "Bruch größer als 0 und höchstens 0,99 erwartet");
/** Anteile vor der Runde: höchstens 15 Stellen (realistische Größenordnung, begrenzt die Rechnung). */
const anteileVorherEingabe = z.string().regex(/^(?!0+$)\d{1,15}$/, "Ganze Zahl größer als null mit höchstens 15 Stellen erwartet");
/** Vorschlag zum Option Pool Shuffle: reine Rechnung, eigene Eingaben (der Preis ist hier gesucht, nicht gegeben). */
const poolVorschlagEingabe = z.object({
  datum: valuta,
  preMoney: geldEingabe,
  volumen: geldEingabe,
  zielAnteil: zielBruch,
  basis: poolBasis,
  /** Ausgegebene Anteile vor der Runde; sonst aus der letzten abgeschlossenen Runde (ohne Runde Pflicht). */
  anteileVorher: anteileVorherEingabe.optional(),
  /** Überschriebene Werte für die Kennwerte; ohne Angabe gelten die vorgeschlagenen. */
  aufstockung: z.string().regex(/^\d{1,18}$/, "Ganze Zahl erwartet").optional(),
  preisJeAnteil: preisEingabe.optional(),
});

/** Anlegen und Vorschau: Post-Money und Gesamtzahl der Anteile danach sind optional und werden sonst aus den Positionen abgeleitet. */
export const neueRunde = z
  .object({
    /** `bruecke`: Brückenrunde ohne Bewertung und ohne Positionen; nur Bezeichnung und Datum (sie ist sofort abgeschlossen). */
    art: z.enum(rundenArt.enumValues).default("eigenkapital"),
    bezeichnung: rundeBasis.bezeichnung,
    datum: rundeBasis.datum,
    /** Pflicht bei Eigenkapital, bei der Brücke nicht erlaubt. */
    preMoney: rundeBasis.preMoney.optional(),
    preisJeAnteil: rundeBasis.preisJeAnteil.optional(),
    postMoney: geldEingabe.optional(),
    anteileGesamtNach: z.string().regex(/^\d{1,18}$/, "Ganze Zahl erwartet").optional(),
    positionen: z.array(neuePosition).max(200).default([]),
    poolAufstockung: poolAufstockungEingabe.optional(),
  })
  .superRefine((r, ctx) => {
    if (r.art === "bruecke") {
      if (r.poolAufstockung !== undefined) ctx.addIssue({ code: "custom", path: ["poolAufstockung"], message: "Eine Brückenrunde hat keine Aufstockung des Pools" });
      for (const feld of ["preMoney", "postMoney", "preisJeAnteil", "anteileGesamtNach"] as const) {
        if (r[feld] !== undefined) ctx.addIssue({ code: "custom", path: [feld], message: "Eine Brückenrunde hat keine Bewertung" });
      }
      if (r.positionen.length > 0) ctx.addIssue({ code: "custom", path: ["positionen"], message: "Eine Brückenrunde hat keine Positionen mit Anteilen" });
    } else {
      if (r.preMoney === undefined) ctx.addIssue({ code: "custom", path: ["preMoney"], message: "Pre-Money ist bei einer Eigenkapitalrunde erforderlich" });
      if (r.preisJeAnteil === undefined) ctx.addIssue({ code: "custom", path: ["preisJeAnteil"], message: "Preis je Anteil ist bei einer Eigenkapitalrunde erforderlich" });
    }
  });
const rundenAenderung = z
  .object({
    /** Umstellen zwischen Eigenkapital und Brücke: zur Brücke nur ohne Positionen und ohne Eigenkapital-Instrumente, zu Eigenkapital mit `preMoney` und `preisJeAnteil`. */
    art: z.enum(rundenArt.enumValues).optional(),
    bezeichnung: rundeBasis.bezeichnung.optional(),
    datum: rundeBasis.datum.optional(),
    preMoney: rundeBasis.preMoney.optional(),
    preisJeAnteil: rundeBasis.preisJeAnteil.optional(),
    /** `null` leitet den Wert aus den Positionen ab. */
    postMoney: geldEingabe.nullable().optional(),
    anteileGesamtNach: z.string().regex(/^\d{1,18}$/, "Ganze Zahl erwartet").nullable().optional(),
  })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);
const positionAenderung = z
  .object({ betrag: betragEingabe.optional(), anteile: anteileEingabe.optional(), rolle: positionBasis.rolle.optional(), anteilsklasseId: z.uuid().nullable().optional(), vehikelId: z.uuid().optional() })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);
const abschluss = z.object({
  fondsBuchungen: z
    .array(
      z.object({
        positionId: z.uuid(),
        zusage: z.boolean().default(true),
        zusageValuta: valuta.optional(),
        /** Art des Instruments, das aus der Position entsteht (Standard: offene Beteiligung). */
        art: z.enum(instrumentArt.enumValues).optional(),
        bezeichnung: textEingabe(200).optional(),
        auszahlungen: z.array(z.object({ valuta, betrag: betragEingabe })).max(20).default([]),
      }),
    )
    .max(50)
    .default([]),
});
const wiedereroeffnung = z.object({ grund: textEingabe(1000) });
const zahlungEingabe = z.object({ datum: valuta, art: z.enum(["einzahlung", "rueckzahlung"]), betrag: betragEingabe, bemerkung: optionalerText(1000) });

const positionParam = z.object({ id: z.uuid(), positionId: z.uuid() });
const zahlungParam = z.object({ id: z.uuid(), zahlungId: z.uuid() });

/** Je Fonds und je Vehikel höchstens eine Position in der Runde. */
async function verlangeInvestorFrei(tx: Tx, rundeId: string, p: { fondsId: string } | { vehikelId: string }) {
  const [vorhanden] = await tx
    .select({ id: rundenposition.id })
    .from(rundenposition)
    .where(and(eq(rundenposition.rundeId, rundeId), "fondsId" in p ? eq(rundenposition.fondsId, p.fondsId) : eq(rundenposition.vehikelId, p.vehikelId)));
  if (vorhanden) throw new Fachfehler(409, "RUNDENPOSITION_VORHANDEN", "Dieser Investor hat in der Runde bereits eine Position.");
}

async function positionenVon(tx: Tx, rundeId: string): Promise<PositionZeile[]> {
  return tx.select().from(rundenposition).where(eq(rundenposition.rundeId, rundeId)).orderBy(rundenposition.id);
}

const brueckeKeinAbschluss = () => new Fachfehler(409, "RUNDE_ART_BRUECKE", "Eine Brückenrunde wird nicht abgeschlossen oder wieder geöffnet.");

/** Eigenkapital-Instrumente oder eine Wandlung verweisen auf die Runde: Sie lässt sich nicht zur Brückenrunde umstellen. */
async function verlangeKeinEigenkapitalBezug(tx: Tx, rundeId: string) {
  const [i] = await tx.select({ id: instrument.id }).from(instrument).where(and(eq(instrument.rundeId, rundeId), inArray(instrument.art, ["offene_beteiligung", "stille_beteiligung"]))).limit(1);
  const [w] = await tx.select({ id: wandlung.id }).from(wandlung).where(eq(wandlung.rundeId, rundeId)).limit(1);
  if (i || w) throw new Fachfehler(409, "RUNDE_IN_VERWENDUNG", "Der Runde sind Eigenkapital-Instrumente oder eine Wandlung zugeordnet; sie lässt sich nicht zur Brückenrunde umstellen.", { instrumentId: i?.id ?? null, wandlungId: w?.id ?? null });
}

/**
 * Änderungen eines Pools mit Bezug zur Runde (Aufstockung aus dem Option Pool Shuffle oder von Hand zugeordnet) haben ohne Bewertung keine
 * Grundlage: Ein Entwurf mit solchen Änderungen lässt sich nicht zur Brückenrunde umstellen. Der Weg ist, die Änderungen des Pools zu löschen
 * (`DELETE …/aenderungen/:id`, solange die Runde ein Entwurf ist) oder den Entwurf zu löschen (er nimmt seine Aufstockungen mit) und die Brückenrunde neu anzulegen.
 */
async function verlangeKeineAufstockung(tx: Tx, rundeId: string) {
  const [a] = await tx.select({ id: poolAenderung.id }).from(poolAenderung).where(eq(poolAenderung.rundeId, rundeId)).limit(1);
  if (a) throw new Fachfehler(409, "RUNDE_MIT_AUFSTOCKUNG", "Der Runde ist eine Aufstockung des Pools zugeordnet; sie lässt sich nicht zur Brückenrunde umstellen. Den Entwurf löschen (die Aufstockung geht mit) und die Brückenrunde neu anlegen.");
}

/**
 * Das Datum der Runde ändert sich: Änderungen eines Pools mit Bezug zur Runde, die auf das bisherige Rundendatum lauten, ziehen mit (so
 * entstehen Aufstockungen beim Anlegen der Runde). Änderungen mit eigenem Datum (etwa ein späterer Beschluss) bleiben. Recht wie beim Anlegen
 * einer Änderung am Pool (ohne Fonds, deren einzige Verbindung dieser Entwurf ist); jeder betroffene Pool wird gesperrt und muss weiter stimmen.
 */
async function ziehePoolAenderungenMit(tx: Tx, protokoll: Protokollant, akteur: ReturnType<typeof aktuellerAkteur>, runde: RundeZeile, neuesDatum: string) {
  const mitziehen = await tx.select().from(poolAenderung).where(and(eq(poolAenderung.rundeId, runde.id), eq(poolAenderung.datum, runde.datum)));
  if (mitziehen.length === 0) return;
  await verlangeRundenrecht(tx, akteur, runde.organisationId, "bearbeiter");
  const ids = new Set(mitziehen.map((a) => a.id));
  for (const poolId of [...new Set(mitziehen.map((a) => a.poolId))].sort()) {
    await ladePool(tx, runde.organisationId, poolId, true);
    const bestand = await bestandDesPools(tx, poolId);
    pruefeBestand(
      bestand.aenderungen.map((a) => (ids.has(a.id) ? { ...a, datum: neuesDatum } : a)),
      bestand.zuteilungen,
    );
  }
  for (const a of mitziehen) {
    const [nachher] = await tx.update(poolAenderung).set({ datum: neuesDatum }).where(eq(poolAenderung.id, a.id)).returning();
    await protokoll("aendern", "pool_aenderung", a.id, { ...a, organisationId: runde.organisationId }, { ...nachher, organisationId: runde.organisationId });
  }
}

/** Instrumente, Wandlungen oder zugeordnete Vorgänge verweisen auf die Runde: Sie lässt sich nicht löschen. */
async function verlangeUnverwendet(tx: Tx, rundeId: string) {
  const [i] = await tx.select({ id: instrument.id }).from(instrument).where(eq(instrument.rundeId, rundeId)).limit(1);
  const [w] = await tx.select({ id: wandlung.id }).from(wandlung).where(eq(wandlung.rundeId, rundeId)).limit(1);
  const [v] = await tx.select({ id: vorgangRunde.vorgangId }).from(vorgangRunde).where(eq(vorgangRunde.rundeId, rundeId)).limit(1);
  if (i || w || v) throw new Fachfehler(409, "RUNDE_IN_VERWENDUNG", "Der Runde sind Instrumente, Wandlungen oder Vorgänge zugeordnet; sie lässt sich nicht löschen.", { instrumentId: i?.id ?? null, wandlungId: w?.id ?? null, vorgangId: v?.id ?? null });
}

/**
 * Legt die Aufstockung des Pools zur neuen Runde an (dieselbe Transaktion wie die Runde): Änderung mit Datum, Runde und Basis der Runde,
 * geprüft wie jede andere Änderung (`pruefeBestand`). Die Rechte (wie beim Anlegen einer Änderung, ohne einsteigende Fonds) prüft der Aufrufer.
 */
async function legeAufstockungAn(tx: Tx, protokoll: Protokollant, organisationId: string, runde: RundeZeile, a: z.infer<typeof poolAufstockungEingabe>) {
  const bezug = { datum: runde.datum, rundeId: runde.id, basis: a.basis, beschluss: a.beschluss ?? null };
  let poolId = a.poolId;
  if (poolId === undefined) {
    const pools = await tx.select({ id: mitarbeiterpool.id }).from(mitarbeiterpool).where(eq(mitarbeiterpool.organisationId, organisationId)).orderBy(asc(mitarbeiterpool.erstelltAm));
    if (pools.length > 1) ungueltig([{ feld: "poolAufstockung.poolId", code: "pool_waehlen", meldung: "Das Unternehmen hat mehrere Pools; einer ist zu wählen" }]);
    if (pools.length === 0) {
      if (!a.neuerPool) ungueltig([{ feld: "poolAufstockung.neuerPool", code: "pool_fehlt", meldung: "Das Unternehmen hat noch keinen Pool; Art und Bezeichnung des neuen Pools fehlen" }]);
      await legePoolAn(tx, protokoll, organisationId, { art: a.neuerPool.art, bezeichnung: a.neuerPool.bezeichnung, regel: "wie_anteile", groesse: a.anzahl, ...bezug });
      return;
    }
    poolId = pools[0]!.id;
  }
  await ladePool(tx, organisationId, poolId, true);
  const bestand = await bestandDesPools(tx, poolId);
  pruefeBestand([...bestand.aenderungen, { datum: bezug.datum, anzahl: a.anzahl }], bestand.zuteilungen);
  const [zeile] = await tx.insert(poolAenderung).values({ poolId, anzahl: a.anzahl, ...bezug }).returning();
  await protokoll("anlegen", "pool_aenderung", zeile!.id, null, { ...zeile, organisationId });
}

/** Mount unter `/organisationen/:id`. */
export function organisationRundenRouten(db: Db) {
  return new Hono()
    /** Alle Runden des Unternehmens, Entwürfe eingeschlossen, mit Positionen, Zahlungsstand und Prüfung. */
    .get("/finanzierungsrunden", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      const daten = await lese(db, async (tx) => {
        await ladeOrganisation(tx, id);
        const alle = await ladeRundenAntwort(tx, id);
        if (akteur.globalVerwalter) return alle;
        // Rechtsgrundlage am Unternehmen: alle Runden; sonst nur Runden, in denen ein Fonds der Person eine Position hat.
        const grundlage = await verwandteFonds(tx, id);
        if ([...grundlage].some((f) => hatRolle(akteur, f, "betrachter"))) return alle;
        const eigene = alle.filter((r) => r.positionen.some((p) => p.investor.art === "fonds" && hatRolle(akteur, p.investor.id, "betrachter")));
        if (eigene.length === 0) throw new Fachfehler(403, "KEINE_BERECHTIGUNG", "Dafür fehlt die Berechtigung.");
        return eigene;
      });
      return c.json({ daten }, 200);
    })
    /**
     * Alle Fondsvorgänge des Unternehmens nach Runde gruppiert (`runden[].transaktionen`, chronologisch) und `ohneRunde`; nur Vorgänge aus Fonds, an denen die Person
     * mindestens Betrachter ist. Rechte der Runden wie bei der Rundenliste.
     */
    .get("/rundentransaktionen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      const daten = await lese(db, async (tx) => {
        await ladeOrganisation(tx, id);
        return ladeRundentransaktionen(tx, akteur, id);
      });
      return c.json(daten, 200);
    })
    /** Reine Rechnung: abgeleitete Werte und Hinweise zu den eingegebenen Zahlen, ohne etwas zu speichern (für die Eingabemaske). */
    .post("/finanzierungsrunden/vorschau", pruefe("param", idParam), pruefe("json", neueRunde), async (c) => {
      const e = c.req.valid("json");
      pruefeDatumsfenster("datum", e.datum);
      if (e.art === "bruecke" || e.preMoney === undefined || e.preisJeAnteil === undefined) {
        ungueltig([{ feld: "art", code: "keine_vorschau", meldung: "Für eine Brückenrunde gibt es keine Vorschau (keine Bewertung, keine Anteile)" }]);
      }
      const eigenkapital = { ...e, preMoney: e.preMoney!, preisJeAnteil: e.preisJeAnteil! };
      const volumen = e.positionen.reduce((s, p) => s.plus(p.betrag), new Decimal(0));
      const { id } = c.req.valid("param");
      // Den Pool der Mitarbeiterbeteiligung bezieht die Vorschau nur mit Leserecht an den bestehenden Runden ein, und zwar nur über Fonds, die
      // schon mit dem Unternehmen verbunden sind (Fonds aus dem Körper zählen nicht). Ohne dieses Recht rechnet sie wie ohne Pool: Ein
      // einsteigender Fonds kann eine neue Runde weiter vorab prüfen, erfährt aber nichts über den Bestand.
      const pool = await lese(db, async (tx) => {
        const darfLesen = await verlangeRundenLeserecht(tx, aktuellerAkteur(c), id).then(
          () => true,
          (fehler: unknown) => {
            if (fehler instanceof Fachfehler && fehler.status === 403) return false;
            throw fehler;
          },
        );
        return darfLesen ? poolBeiRunde(await ladePoolBestand(tx, id), e.datum, null) : null;
      });
      const mitAufstockung = poolMitAufstockung(pool, e.poolAufstockung);
      const w = wirksam(eigenkapital, volumen, mitAufstockung);
      const pruefung = pruefeRunde({ preMoney: eigenkapital.preMoney, postMoney: w.postMoney, preisJeAnteil: eigenkapital.preisJeAnteil, anteileGesamtNach: w.anteileGesamtNach }, e.positionen, mitAufstockung);
      const dubletten = await lese(db, (tx) => findeRundenDubletten(tx, aktuellerAkteur(c), id, eigenkapital));
      return c.json({ postMoney: w.postMoney, anteileGesamtNach: w.anteileGesamtNach, pruefung, dubletten }, 200);
    })
    /**
     * Option Pool Shuffle: Aufstockung und Preis je Anteil für eine Zielgröße des Pools (Rechenkern `poolShuffle`) und die Kennwerte zu den
     * übernommenen oder überschriebenen Werten. Speichert nichts. Verrät Pool und Anteile vor der Runde und verlangt daher das Leserecht an
     * den Runden (wie der Pool, Entscheidung 486).
     */
    .post("/finanzierungsrunden/pool-vorschlag", pruefe("param", idParam), pruefe("json", poolVorschlagEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      pruefeDatumsfenster("datum", e.datum);
      const { poolVorher, anteileAusRunde } = await lese(db, async (tx) => {
        await ladeOrganisation(tx, id);
        await verlangeRundenLeserecht(tx, aktuellerAkteur(c), id);
        return { poolVorher: poolBeiRunde(await ladePoolBestand(tx, id), e.datum, null) ?? "0", anteileAusRunde: await anteileVorRunde(tx, id, e.datum) };
      });
      const anteileVorher = e.anteileVorher ?? anteileAusRunde;
      const ergebnis = anteileVorher === null ? ({ ok: false, grund: "ohne_anteile" } as const) : poolShuffle({ preMoney: e.preMoney, volumen: e.volumen, anteileVorher, poolVorher, zielAnteil: e.zielAnteil, basis: e.basis });
      const vorschlag = ergebnis.ok ? { aufstockung: ergebnis.vorschlag.aufstockung.toFixed(0), preisJeAnteil: ergebnis.vorschlag.preisJeAnteil.toFixed(4) } : null;
      const aufstockung = e.aufstockung ?? vorschlag?.aufstockung;
      const preis = e.preisJeAnteil ?? vorschlag?.preisJeAnteil;
      const k = anteileVorher !== null && aufstockung !== undefined && preis !== undefined ? poolShuffleKennwerte({ preMoney: e.preMoney, volumen: e.volumen, anteileVorher, poolVorher, aufstockung, basis: e.basis, preisJeAnteil: preis }) : null;
      return c.json(
        {
          anteileVorher,
          anteileVorherQuelle: e.anteileVorher !== undefined ? ("eingabe" as const) : anteileAusRunde !== null ? ("runde" as const) : null,
          poolVorher,
          vorschlag,
          grund: ergebnis.ok ? null : ergebnis.grund,
          kennwerte: k
            ? {
                neueAnteile: k.neueAnteile.toFixed(0),
                poolVorher: k.poolVorher.toFixed(0),
                poolNachher: k.poolNachher.toFixed(0),
                poolAnteilNachher: k.poolAnteilNachher.toDecimalPlaces(6).toFixed(6),
                vollVerwaessertNachher: k.vollVerwaessertNachher.toFixed(0),
                preisJeAnteil: k.preisJeAnteil.toFixed(4),
                effektivePreMoney: k.effektivePreMoney.toFixed(2),
              }
            : null,
        },
        200,
      );
    })
    .post("/finanzierungsrunden", pruefe("param", idParam), pruefe("json", neueRunde), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const antwort = await schreibe(db, c, async (tx, protokoll) => {
        if (e.poolAufstockung) {
          // Die Aufstockung ändert den Pool des Unternehmens: Recht wie beim Anlegen einer Änderung (ohne Fonds, die erst mit der Runde einsteigen).
          await ladeOrganisation(tx, id);
          await verlangeRundenrecht(tx, akteur, id, "bearbeiter");
        }
        const { runde, dubletten } = await legeRundenentwurfAn(tx, protokoll, akteur, id, e);
        if (e.poolAufstockung) await legeAufstockungAn(tx, protokoll, id, runde, e.poolAufstockung);
        return { ...(await ladeRundenAntwort(tx, runde.organisationId, runde.id))[0]!, dubletten };
      });
      return c.json(antwort, 201);
    });
}

/** Mount unter `/finanzierungsrunden`. */
export function rundenRouten(db: Db) {
  /** Gemeinsamer Anfang der Schreibwege: Runde sperren und Recht an ihrem Unternehmen prüfen. */
  const laden = async (tx: Tx, akteur: ReturnType<typeof aktuellerAkteur>, id: string, mindest: Parameters<typeof verlangeRundenrecht>[3], alleFonds = true) => {
    const runde = await sperreRunde(tx, id);
    await verlangeRundenrecht(tx, akteur, runde.organisationId, mindest, [], id);
    // Betroffene Fonds anderer Positionen: ändern, löschen, schließen verlangen bearbeiter, Wiedereröffnen verwalter an jedem.
    if (alleFonds) await verlangeRolleAnAllenPositionen(tx, akteur, id, mindest === "verwalter" ? "verwalter" : "bearbeiter");
    return runde;
  };
  const antwortVon = async (tx: Tx, runde: RundeZeile) => (await ladeRundenAntwort(tx, runde.organisationId, runde.id))[0]!;

  return new Hono()
    .get("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      const antwort = await lese(db, async (tx) => {
        const [runde] = await tx.select().from(finanzierungsrunde).where(eq(finanzierungsrunde.id, id));
        if (!runde) throw new Fachfehler(404, "RUNDE_NICHT_GEFUNDEN", "Finanzierungsrunde nicht gefunden.");
        await verlangeRundenrecht(tx, akteur, runde.organisationId, "betrachter", [], id);
        return antwortVon(tx, runde);
      });
      return c.json(antwort, 200);
    })
    /** Nur Entwürfe: Stammdaten ändern; `postMoney` und `anteileGesamtNach` mit `null` aus den Positionen ableiten. */
    .patch("/:id", pruefe("param", idParam), pruefe("json", rundenAenderung), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      if (e.datum) pruefeDatumsfenster("datum", e.datum);
      const antwort = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await laden(tx, akteur, id, "bearbeiter");
        const zielArt = e.art ?? vorher.art;
        const bewertungGenannt = e.preMoney !== undefined || e.postMoney !== undefined || e.preisJeAnteil !== undefined || e.anteileGesamtNach !== undefined;
        const positionen = await positionenVon(tx, id);
        let werte: Partial<typeof finanzierungsrunde.$inferInsert>;
        if (zielArt === "bruecke") {
          // Brückenrunde (bleibend oder neu umgestellt): nur Bezeichnung und Datum, keine Bewertung, keine Positionen.
          if (bewertungGenannt) throw BRUECKE_OHNE_ANTEILE();
          if (vorher.art === "eigenkapital") {
            verlangeEntwurf(vorher);
            if (positionen.length > 0) throw BRUECKE_OHNE_ANTEILE();
            await verlangeKeinEigenkapitalBezug(tx, id);
            await verlangeKeineAufstockung(tx, id);
            werte = { art: "bruecke", preMoney: null, postMoney: null, preisJeAnteil: null, anteileGesamtNach: null, status: "abgeschlossen", abgeschlossenAm: new Date(), abgeschlossenVon: protokoll.akteur };
          } else werte = {};
          werte = { ...werte, ...nurGesetzte({ bezeichnung: e.bezeichnung, datum: e.datum }) };
        } else if (vorher.art === "bruecke") {
          // Brücke zu Eigenkapital: wird ein Entwurf mit Bewertung.
          if (e.preMoney === undefined) ungueltig([{ feld: "preMoney", code: "erforderlich", meldung: "Pre-Money ist bei einer Eigenkapitalrunde erforderlich" }]);
          if (e.preisJeAnteil === undefined) ungueltig([{ feld: "preisJeAnteil", code: "erforderlich", meldung: "Preis je Anteil ist bei einer Eigenkapitalrunde erforderlich" }]);
          const pool = poolBeiRunde(await ladePoolBestand(tx, vorher.organisationId), e.datum ?? vorher.datum, id);
          const w = wirksam({ preMoney: e.preMoney!, preisJeAnteil: e.preisJeAnteil!, postMoney: e.postMoney ?? null, anteileGesamtNach: e.anteileGesamtNach ?? null }, new Decimal(0), pool);
          werte = { art: "eigenkapital", preMoney: e.preMoney!, preisJeAnteil: e.preisJeAnteil!, postMoney: w.postMoney, anteileGesamtNach: w.anteileGesamtNach, status: "entwurf", abgeschlossenAm: null, abgeschlossenVon: null, ...nurGesetzte({ bezeichnung: e.bezeichnung, datum: e.datum }) };
        } else {
          verlangeEntwurf(vorher);
          const volumen = positionen.reduce((s, p) => s.plus(p.betrag), new Decimal(0));
          const zusammen = { ...vorher, ...nurGesetzte({ bezeichnung: e.bezeichnung, datum: e.datum, preMoney: e.preMoney, preisJeAnteil: e.preisJeAnteil }) };
          const w = wirksam(
            { preMoney: zusammen.preMoney!, preisJeAnteil: zusammen.preisJeAnteil!, postMoney: e.postMoney === undefined ? vorher.postMoney : e.postMoney, anteileGesamtNach: e.anteileGesamtNach === undefined ? vorher.anteileGesamtNach : e.anteileGesamtNach },
            volumen,
            poolBeiRunde(await ladePoolBestand(tx, vorher.organisationId), zusammen.datum, id),
          );
          werte = { bezeichnung: zusammen.bezeichnung, datum: zusammen.datum, preMoney: zusammen.preMoney, preisJeAnteil: zusammen.preisJeAnteil, postMoney: w.postMoney, anteileGesamtNach: w.anteileGesamtNach };
        }
        if (Object.keys(werte).length === 0) return antwortVon(tx, vorher);
        if (werte.datum !== undefined && werte.datum !== vorher.datum) await ziehePoolAenderungenMit(tx, protokoll, akteur, vorher, werte.datum);
        const [nachher] = await tx.update(finanzierungsrunde).set(werte).where(eq(finanzierungsrunde.id, id)).returning();
        await protokoll("aendern", "finanzierungsrunde", id, vorher, nachher);
        return antwortVon(tx, nachher!);
      });
      return c.json(antwort, 200);
    })
    /** Nur Entwürfe ohne Buchungen, Zahlungen oder Instrumente aus den Positionen. */
    .delete("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      await schreibe(db, c, async (tx, protokoll) => {
        const runde = await laden(tx, akteur, id, "bearbeiter");
        if (runde.art === "eigenkapital") verlangeEntwurf(runde);
        await verlangeUnverwendet(tx, id);
        const positionen = await positionenVon(tx, id);
        for (const p of positionen) {
          if (await positionVerwendet(tx, p.id)) throw new Fachfehler(409, "RUNDENPOSITION_GEBUCHT", "Zu einer Position gibt es Buchungen, Zahlungen oder ein Instrument; die Runde lässt sich nicht löschen.");
        }
        for (const p of positionen) {
          await tx.delete(rundenposition).where(eq(rundenposition.id, p.id));
          await protokoll("loeschen", "rundenposition", p.id, p, null);
        }
        // Aufstockungen des Pools zu dieser Runde (Option Pool Shuffle) gehen mit dem Entwurf; der Rest jedes Pools muss weiter stimmen.
        // Sie ändern den Pool des Unternehmens: Recht wie beim Anlegen einer Änderung (ohne Fonds, deren einzige Verbindung dieser Entwurf ist).
        const aufstockungen = await tx.select().from(poolAenderung).where(eq(poolAenderung.rundeId, id));
        if (aufstockungen.length > 0) await verlangeRundenrecht(tx, akteur, runde.organisationId, "bearbeiter");
        const betroffenePools = [...new Set(aufstockungen.map((a) => a.poolId))].sort();
        const leerePools: string[] = [];
        for (const poolId of betroffenePools) {
          await ladePool(tx, runde.organisationId, poolId, true);
          const bestand = await bestandDesPools(tx, poolId);
          const rest = bestand.aenderungen.filter((a) => a.rundeId !== id);
          pruefeBestand(rest, bestand.zuteilungen);
          // Hat erst dieser Entwurf den Pool geschaffen und gibt es sonst nichts darin, geht der Pool mit.
          if (rest.length === 0 && bestand.zuteilungen.length === 0) leerePools.push(poolId);
        }
        for (const a of aufstockungen) {
          await tx.delete(poolAenderung).where(eq(poolAenderung.id, a.id));
          await protokoll("loeschen", "pool_aenderung", a.id, { ...a, organisationId: runde.organisationId }, null);
        }
        for (const poolId of leerePools) {
          const [weg] = await tx.delete(mitarbeiterpool).where(eq(mitarbeiterpool.id, poolId)).returning();
          await protokoll("loeschen", "mitarbeiterpool", poolId, weg, null);
        }
        await tx.delete(finanzierungsrunde).where(eq(finanzierungsrunde.id, id));
        await protokoll("loeschen", "finanzierungsrunde", id, runde, null);
      });
      return c.body(null, 204);
    })
    .post("/:id/positionen", pruefe("param", idParam), pruefe("json", neuePosition), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const antwort = await schreibe(db, c, async (tx, protokoll) => {
        const runde = await laden(tx, akteur, id, "bearbeiter");
        if (runde.art === "bruecke") throw BRUECKE_OHNE_ANTEILE();
        verlangeEntwurf(runde);
        const v = e.fondsId ? null : await vehikelDerPosition(tx, protokoll, e);
        await pruefePosition(tx, akteur, runde.organisationId, e, v);
        await verlangeInvestorFrei(tx, id, v ? { vehikelId: v.id } : { fondsId: e.fondsId! });
        const [zeile] = await tx
          .insert(rundenposition)
          .values({ rundeId: id, fondsId: e.fondsId ?? null, vehikelId: v?.id ?? null, betrag: e.betrag, anteile: e.anteile, rolle: e.rolle, anteilsklasseId: e.anteilsklasseId ?? null })
          .returning();
        await protokoll("anlegen", "rundenposition", zeile!.id, null, zeile);
        return antwortVon(tx, runde);
      });
      return c.json(antwort, 201);
    })
    .patch("/:id/positionen/:positionId", pruefe("param", positionParam), pruefe("json", positionAenderung), async (c) => {
      const { id, positionId } = c.req.valid("param");
      const e = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const antwort = await schreibe(db, c, async (tx, protokoll) => {
        const runde = await laden(tx, akteur, id, "bearbeiter");
        // Das Vehikel ändert weder Anteile noch Beträge: Es lässt sich auch in einer abgeschlossenen Runde umhängen, sonst ändert nichts.
        if (Object.keys(e).some((k) => k !== "vehikelId")) verlangeEntwurf(runde);
        const [vorher] = await tx.select().from(rundenposition).where(and(eq(rundenposition.id, positionId), eq(rundenposition.rundeId, id))).for("update");
        if (!vorher) throw new Fachfehler(404, "RUNDENPOSITION_NICHT_GEFUNDEN", "Rundenposition nicht gefunden.");
        if (vorher.fondsId) verlangeBearbeiterAm(akteur, vorher.fondsId);
        if (e.vehikelId !== undefined) {
          if (!vorher.vehikelId) throw new Fachfehler(409, "RUNDENPOSITION_OHNE_VEHIKEL", "Die Position gehört einem eigenen Fonds und hat kein Vehikel.");
          const [bisher, neu] = [await ladeVehikel(tx, vorher.vehikelId), await ladeVehikel(tx, e.vehikelId)];
          if (neu.investorId !== bisher.investorId) throw new Fachfehler(422, "VEHIKEL_ANDERER_INVESTOR", "Das Vehikel gehört einem anderen Investor als die Position.");
          if (neu.id !== bisher.id) await verlangeInvestorFrei(tx, id, { vehikelId: neu.id });
        }
        if (e.anteilsklasseId) {
          const [k] = await tx.select().from(anteilsklasse).where(eq(anteilsklasse.id, e.anteilsklasseId));
          if (!k) throw new Fachfehler(404, "ANTEILSKLASSE_NICHT_GEFUNDEN", "Anteilsklasse nicht gefunden.");
          if (k.organisationId !== runde.organisationId) throw new Fachfehler(409, "ANTEILSKLASSE_PASST_NICHT", "Die Klasse gehört zu einem anderen Unternehmen als die Runde.");
        }
        const [nachher] = await tx.update(rundenposition).set(nurGesetzte(e)).where(eq(rundenposition.id, positionId)).returning();
        await protokoll("aendern", "rundenposition", positionId, vorher, nachher);
        return antwortVon(tx, runde);
      });
      return c.json(antwort, 200);
    })
    .delete("/:id/positionen/:positionId", pruefe("param", positionParam), async (c) => {
      const { id, positionId } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      const antwort = await schreibe(db, c, async (tx, protokoll) => {
        const runde = await laden(tx, akteur, id, "bearbeiter");
        verlangeEntwurf(runde);
        const [vorher] = await tx.select().from(rundenposition).where(and(eq(rundenposition.id, positionId), eq(rundenposition.rundeId, id))).for("update");
        if (!vorher) throw new Fachfehler(404, "RUNDENPOSITION_NICHT_GEFUNDEN", "Rundenposition nicht gefunden.");
        if (vorher.fondsId) verlangeBearbeiterAm(akteur, vorher.fondsId);
        if (await positionVerwendet(tx, positionId)) throw new Fachfehler(409, "RUNDENPOSITION_GEBUCHT", "Zu dieser Position gibt es Buchungen, Zahlungen oder ein Instrument; sie lässt sich nicht entfernen.");
        await tx.delete(rundenposition).where(eq(rundenposition.id, positionId));
        await protokoll("loeschen", "rundenposition", positionId, vorher, null);
        return antwortVon(tx, runde);
      });
      return c.json(antwort, 200);
    })
    /**
     * Abschließen: Die Prüfung muss grün sein (409 `RUNDE_NICHT_KONSISTENT` mit den Abweichungen). Der Abschluss legt in derselben Transaktion je
     * Position eines eigenen Fonds die Beteiligung (falls nötig), ein Instrument (Art, Runde, Anteilsklasse), die Zusage in Höhe der Position mit einer
     * Tranche und auf Wunsch erste Auszahlungen an. `fondsBuchungen` steuert das je Position (Zusage ab, Art, Auszahlungen); ohne Eintrag gilt der Standard
     * (Zusage an). Alles läuft über dieselbe Funktion wie jede andere Buchung.
     */
    .post("/:id/abschliessen", pruefe("param", idParam), pruefe("json", abschluss), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await laden(tx, akteur, id, "bearbeiter");
        if (vorher.art === "bruecke") throw brueckeKeinAbschluss();
        verlangeEntwurf(vorher);
        const positionen = await positionenVon(tx, id);
        const pruefung = pruefeRunde(rundenWerte(vorher), positionen, poolBeiRunde(await ladePoolBestand(tx, vorher.organisationId), vorher.datum, id));
        if (!pruefung.schliessbar) {
          throw new Fachfehler(409, "RUNDE_NICHT_KONSISTENT", "Die Runde ist nicht stimmig und lässt sich nicht abschließen.", { abweichungen: pruefung.abweichungen });
        }
        const buchungen = await bucheFondsBuchungen(tx, protokoll, akteur, vorher, positionen, e.fondsBuchungen);
        const [nachher] = await tx
          .update(finanzierungsrunde)
          .set({ status: "abgeschlossen", abgeschlossenAm: new Date(), abgeschlossenVon: protokoll.akteur })
          .where(eq(finanzierungsrunde.id, id))
          .returning();
        await protokoll("abschliessen", "finanzierungsrunde", id, vorher, { ...nachher, vorgangIds: buchungen.flatMap((b) => b.vorgangIds) });
        return { runde: await antwortVon(tx, nachher!), buchungen };
      });
      return c.json(ergebnis, 200);
    })
    /** Verwalter: eine abgeschlossene Runde mit Begründung wieder öffnen. Gebuchte Vorgänge bleiben und werden bei Bedarf einzeln storniert. */
    .post("/:id/wiedereroeffnen", pruefe("param", idParam), pruefe("json", wiedereroeffnung), async (c) => {
      const { id } = c.req.valid("param");
      const { grund } = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const antwort = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await laden(tx, akteur, id, "verwalter");
        if (vorher.art === "bruecke") throw brueckeKeinAbschluss();
        if (vorher.status !== "abgeschlossen") throw new Fachfehler(409, "RUNDE_NICHT_ABGESCHLOSSEN", "Die Runde ist noch nicht abgeschlossen.", { status: vorher.status });
        const [verwendet] = await tx.select({ id: wandlung.id }).from(wandlung).where(eq(wandlung.rundeId, id));
        if (verwendet) throw new Fachfehler(409, "RUNDE_VERWENDET", "Die Runde ist Grundlage einer Wandlung und lässt sich nicht wieder öffnen.", { wandlungId: verwendet.id });
        const [nachher] = await tx
          .update(finanzierungsrunde)
          .set({ status: "entwurf", wiedergeoeffnetAm: new Date(), wiedergeoeffnetVon: protokoll.akteur, wiedereroeffnungGrund: grund })
          .where(eq(finanzierungsrunde.id, id))
          .returning();
        await protokoll("wiedereroeffnen", "finanzierungsrunde", id, vorher, { ...nachher, grund });
        return antwortVon(tx, nachher!);
      });
      return c.json(antwort, 200);
    });
}

/** Mount unter `/rundenpositionen`: Zahlungen der Co-Investoren. Rein informativ, sie gehen in keine Kennzahl des eigenen Fonds ein. */
export function positionZahlungRouten(db: Db) {
  /** Position, Runde (abgeschlossen) und Recht; nur Positionen von Organisationen haben Zahlungen. */
  const ladePosition = async (tx: Tx, akteur: ReturnType<typeof aktuellerAkteur>, id: string, mindest: Parameters<typeof verlangeRundenrecht>[3], zahlungErwartet: boolean, sperren = true) => {
    const abfrage = tx
      .select({ p: rundenposition, runde: finanzierungsrunde })
      .from(rundenposition)
      .innerJoin(finanzierungsrunde, eq(finanzierungsrunde.id, rundenposition.rundeId))
      .where(eq(rundenposition.id, id));
    const [zeile] = await (sperren ? abfrage.for("update", { of: rundenposition }) : abfrage);
    if (!zeile) throw new Fachfehler(404, "RUNDENPOSITION_NICHT_GEFUNDEN", "Rundenposition nicht gefunden.");
    await verlangeRundenrecht(tx, akteur, zeile.runde.organisationId, mindest, [], zeile.runde.id);
    if (zeile.p.fondsId) throw new Fachfehler(409, "ZAHLUNG_NUR_FREMDE_POSITION", "Zahlungen gibt es nur für Positionen von Co-Investoren.");
    if (zahlungErwartet && zeile.runde.status !== "abgeschlossen") throw new Fachfehler(409, "RUNDE_NICHT_ABGESCHLOSSEN", "Die Runde ist noch nicht abgeschlossen.");
    return zeile;
  };
  const stand = async (tx: Tx, positionId: string, betrag: string) => {
    const zeilen = await tx.select().from(rundenpositionZahlung).where(eq(rundenpositionZahlung.positionId, positionId)).orderBy(rundenpositionZahlung.datum, rundenpositionZahlung.erfasstAm, rundenpositionZahlung.id);
    const gezahlt = zeilen.reduce((s, z) => s.plus(z.art === "einzahlung" ? z.betrag : new Decimal(z.betrag).neg()), new Decimal(0));
    return { zusage: new Decimal(betrag).toFixed(2), gezahlt: gezahlt.toFixed(2), offen: new Decimal(betrag).minus(gezahlt).toFixed(2), daten: zeilen };
  };

  return new Hono()
    .get("/:id/zahlungen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      const antwort = await lese(db, async (tx) => {
        const z = await ladePosition(tx, akteur, id, "betrachter", false, false);
        return stand(tx, id, z.p.betrag);
      });
      return c.json(antwort, 200);
    })
    .post("/:id/zahlungen", pruefe("param", idParam), pruefe("json", zahlungEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      pruefeDatumsfenster("datum", e.datum);
      const antwort = await schreibe(db, c, async (tx, protokoll) => {
        const z = await ladePosition(tx, akteur, id, "bearbeiter", true);
        const bisher = await stand(tx, id, z.p.betrag);
        if (e.art === "rueckzahlung" && new Decimal(e.betrag).greaterThan(bisher.gezahlt)) {
          ungueltig([{ feld: "betrag", code: "rueckzahlung_ueber_gezahlt", meldung: "Die Rückzahlung übersteigt den gezahlten Betrag" }]);
        }
        const [neu] = await tx.insert(rundenpositionZahlung).values({ positionId: id, datum: e.datum, art: e.art, betrag: e.betrag, bemerkung: e.bemerkung ?? null }).returning();
        await protokoll("anlegen", "rundenposition_zahlung", neu!.id, null, neu);
        return { zahlung: neu!, ...(await stand(tx, id, z.p.betrag)) };
      });
      return c.json(antwort, 201);
    })
    .delete("/:id/zahlungen/:zahlungId", pruefe("param", zahlungParam), async (c) => {
      const { id, zahlungId } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      const antwort = await schreibe(db, c, async (tx, protokoll) => {
        const z = await ladePosition(tx, akteur, id, "bearbeiter", false);
        const [vorher] = await tx.select().from(rundenpositionZahlung).where(and(eq(rundenpositionZahlung.id, zahlungId), eq(rundenpositionZahlung.positionId, id)));
        if (!vorher) throw new Fachfehler(404, "ZAHLUNG_NICHT_GEFUNDEN", "Zahlung nicht gefunden.");
        const ohne = await stand(tx, id, z.p.betrag);
        const danach = new Decimal(ohne.gezahlt).minus(vorher.art === "einzahlung" ? vorher.betrag : new Decimal(vorher.betrag).neg());
        if (danach.isNegative()) ungueltig([{ feld: "zahlungId", code: "rueckzahlung_ueber_gezahlt", meldung: "Ohne diese Einzahlung wären die Rückzahlungen höher als das Gezahlte" }]);
        await tx.delete(rundenpositionZahlung).where(eq(rundenpositionZahlung.id, zahlungId));
        await protokoll("loeschen", "rundenposition_zahlung", zahlungId, vorher, null);
        return stand(tx, id, z.p.betrag);
      });
      return c.json(antwort, 200);
    });
}
