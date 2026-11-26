import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { benutzer, benutzerEinstellung, deal, organisation, type Db } from "@carraway/db";
import { aktuellerAkteur, sichtbareFonds } from "../anmeldung/akteur";
import { beschreibeFelder } from "../crm/abfrage";
import { Fachfehler } from "../fehler";
import { dealSichtbar } from "../rechte/sichtbarkeit";
import { pruefe } from "../pruefung";
import { ladeFonds, protokolliereLesen, schreibe, KEIN_DATENSATZ } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

const kartenfelderEingabe = z.strictObject({ felder: z.array(z.string().min(1).max(64)).max(40) });

const datumsform = /^\d{4}-\d{2}-\d{2}$/;

const trichterAbfrage = z
  .object({ von: z.iso.date().optional(), bis: z.iso.date().optional(), fondsId: z.uuid().optional() })
  .refine((a) => !a.von || !a.bis || !(datumsform.test(a.von) && datumsform.test(a.bis)) || a.von <= a.bis, {
    message: "von darf nicht nach bis liegen",
    path: ["von"],
  });

const exportAbfrage = z
  .object({ von: z.iso.date().optional(), bis: z.iso.date().optional(), fondsId: z.uuid().optional(), sprache: z.enum(["de", "en"]).default("de") })
  .refine((a) => !a.von || !a.bis || !(datumsform.test(a.von) && datumsform.test(a.bis)) || a.von <= a.bis, {
    message: "von darf nicht nach bis liegen",
    path: ["von"],
  });

const zahl = (wert: unknown) => Number(wert);
/** Verhältnis auf vier Nachkommastellen (0 bis 1); `null`, wenn der Nenner null ist. */
const verhaeltnis = (zaehler: number, nenner: number) => (nenner > 0 ? Math.round((zaehler / nenner) * 10000) / 10000 : null);

interface Filter {
  von?: string | undefined;
  bis?: string | undefined;
  fondsId?: string | undefined;
}

interface Gruppe {
  schluessel: string | null;
  deals: number;
  offen: number;
  abgesagt: number;
  investiert: number;
  /** Anteil der Deals der Gruppe, die investiert wurden (0 bis 1). */
  konversion: number | null;
}

/**
 * Die Auswertung des Trichters. Kohorte: Deals, deren erster Eintrag im Phasenverlauf in [von, bis] liegt (und die zum
 * Fonds gehören, falls angegeben). "Erreicht" heißt: die höchste je erreichte Phase ist mindestens diese, auch wenn Phasen
 * übersprungen wurden. "Aktuell" zählt nur offene Deals in der Phase. Die Zeitreihe zählt je Quartal die Eingänge (erster
 * Eintrag), die Abschlüsse (Übergang ins Portfolio, Datum des letzten Wechsels nach Closing) und die Absagen (Tag der
 * Absage: `aktualisiert_am`, weil abgesagte Deals nicht mehr geändert werden). Die Verweildauer je Phase ist der Mittelwert
 * der abgeschlossenen Aufenthalte (bis zum nächsten Phasenwechsel); die laufende Phase zählt nicht mit.
 */
async function ladeTrichter(tx: Tx, c: Context, { von, bis, fondsId }: Filter) {
  // Ohne Fonds im Filter zählen nur Deals ohne Fonds und Deals der Fonds mit Rolle.
  const fonds = sichtbareFonds(aktuellerAkteur(c));
  const sichtbar =
    fonds === "alle"
      ? sql`true`
      : fonds.length
        ? sql`(d.fonds_id IS NULL OR d.fonds_id IN (${sql.join(fonds.map((f) => sql`${f}::uuid`), sql`, `)}))`
        : sql`d.fonds_id IS NULL`;
  if (fondsId) await ladeFonds(tx, fondsId);
  const kohorte = sql`
    SELECT d.id, d.phase, d.status, d.quelle, d.betreuung, d.absagegrund, max(w.nach_phase) AS hoechste, min(w.am) AS eintritt,
           (d.aktualisiert_am AT TIME ZONE 'Europe/Berlin')::date AS aktualisiert
    FROM deal d
    JOIN deal_phasenwechsel w ON w.deal_id = d.id
    WHERE (${fondsId ?? null}::uuid IS NULL OR d.fonds_id = ${fondsId ?? null}::uuid)
      AND ${sichtbar}
    GROUP BY d.id
    HAVING (${von ?? null}::date IS NULL OR min(w.am) >= ${von ?? null}::date)
       AND (${bis ?? null}::date IS NULL OR min(w.am) <= ${bis ?? null}::date)`;

  const phasen = await tx.execute<{ phase: string; erreicht: string; aktuell: string }>(sql`
    WITH kohorte AS (${kohorte})
    SELECT p.phase::text AS phase,
           count(k.id) FILTER (WHERE k.hoechste >= p.phase) AS erreicht,
           count(k.id) FILTER (WHERE k.status = 'offen' AND k.phase = p.phase) AS aktuell
    FROM unnest(enum_range(NULL::deal_phase)) WITH ORDINALITY AS p(phase, ord)
    LEFT JOIN kohorte k ON true
    GROUP BY p.phase, p.ord
    ORDER BY p.ord`);
  const quellen = await tx.execute<{ quelle: string | null; anzahl: string }>(sql`
    WITH kohorte AS (${kohorte})
    SELECT quelle, count(*) AS anzahl FROM kohorte GROUP BY quelle ORDER BY count(*) DESC, quelle NULLS LAST`);
  const absagegruende = await tx.execute<{ absagegrund: string | null; anzahl: string }>(sql`
    WITH kohorte AS (${kohorte})
    SELECT absagegrund, count(*) AS anzahl FROM kohorte WHERE status = 'abgesagt'
    GROUP BY absagegrund ORDER BY count(*) DESC, absagegrund NULLS LAST`);
  const gesamt = await tx.execute<{ deals: string; offen: string; abgesagt: string; investiert: string }>(sql`
    WITH kohorte AS (${kohorte})
    SELECT count(*) AS deals,
           count(*) FILTER (WHERE status = 'offen') AS offen,
           count(*) FILTER (WHERE status = 'abgesagt') AS abgesagt,
           count(*) FILTER (WHERE status = 'investiert') AS investiert
    FROM kohorte`);
  const gruppen = (spalte: "quelle" | "betreuung") =>
    tx.execute<{ schluessel: string | null; deals: string; offen: string; abgesagt: string; investiert: string }>(sql`
      WITH kohorte AS (${kohorte})
      SELECT ${sql.raw(spalte)} AS schluessel, count(*) AS deals,
             count(*) FILTER (WHERE status = 'offen') AS offen,
             count(*) FILTER (WHERE status = 'abgesagt') AS abgesagt,
             count(*) FILTER (WHERE status = 'investiert') AS investiert
      FROM kohorte GROUP BY ${sql.raw(spalte)}
      ORDER BY count(*) DESC, ${sql.raw(spalte)} NULLS LAST`);
  const nachQuelle = await gruppen("quelle");
  const nachBetreuung = await gruppen("betreuung");

  const zeitreihe = await tx.execute<{ quartal: string; eingang: string; abschluss: string; absage: string }>(sql`
    WITH kohorte AS (${kohorte}),
    ereignis AS (
      SELECT date_trunc('quarter', k.eintritt)::date AS q, 'eingang' AS art FROM kohorte k
      UNION ALL
      SELECT date_trunc('quarter', coalesce((SELECT max(w.am) FROM deal_phasenwechsel w WHERE w.deal_id = k.id AND w.nach_phase = 'closing'), k.aktualisiert))::date, 'abschluss'
      FROM kohorte k WHERE k.status = 'investiert'
      UNION ALL
      SELECT date_trunc('quarter', k.aktualisiert)::date, 'absage' FROM kohorte k WHERE k.status = 'abgesagt'
    ),
    spanne AS (SELECT min(q) AS ab, max(q) AS bis FROM ereignis),
    quartale AS (SELECT g::date AS q FROM spanne, generate_series(spanne.ab, spanne.bis, interval '3 months') AS g WHERE spanne.ab IS NOT NULL)
    SELECT to_char(qu.q, 'YYYY') || '-Q' || to_char(qu.q, 'Q') AS quartal,
           count(e.art) FILTER (WHERE e.art = 'eingang') AS eingang,
           count(e.art) FILTER (WHERE e.art = 'abschluss') AS abschluss,
           count(e.art) FILTER (WHERE e.art = 'absage') AS absage
    FROM quartale qu LEFT JOIN ereignis e ON e.q = qu.q
    GROUP BY qu.q ORDER BY qu.q`);

  const dauer = await tx.execute<{ phase: string; anzahl: string; tage: string | null }>(sql`
    WITH kohorte AS (${kohorte}),
    aufenthalt AS (
      SELECT w.nach_phase AS phase, w.am AS von,
             lead(w.am) OVER (PARTITION BY w.deal_id ORDER BY w.am, w.erfasst_am, w.id) AS bis
      FROM deal_phasenwechsel w WHERE w.deal_id IN (SELECT id FROM kohorte)
    )
    SELECT p.phase::text AS phase, count(a.bis) AS anzahl, avg(a.bis - a.von) AS tage
    FROM unnest(enum_range(NULL::deal_phase)) WITH ORDINALITY AS p(phase, ord)
    LEFT JOIN aufenthalt a ON a.phase = p.phase AND a.bis IS NOT NULL
    GROUP BY p.phase, p.ord ORDER BY p.ord`);

  const stufen = phasen.rows.map((z) => ({ phase: z.phase, erreicht: zahl(z.erreicht), aktuell: zahl(z.aktuell) }));
  const alsGruppen = (zeilen: typeof nachQuelle.rows): Gruppe[] =>
    zeilen.map((z) => {
      const deals = zahl(z.deals);
      const investiert = zahl(z.investiert);
      return { schluessel: z.schluessel, deals, offen: zahl(z.offen), abgesagt: zahl(z.abgesagt), investiert, konversion: verhaeltnis(investiert, deals) };
    });
  return {
    filter: { von: von ?? null, bis: bis ?? null, fondsId: fondsId ?? null },
    gesamt: {
      deals: zahl(gesamt.rows[0]?.deals),
      offen: zahl(gesamt.rows[0]?.offen),
      abgesagt: zahl(gesamt.rows[0]?.abgesagt),
      investiert: zahl(gesamt.rows[0]?.investiert),
    },
    phasen: stufen.map((s, i) => {
      const naechste = stufen[i + 1];
      // Anteil der erreichten Deals, die auch die nächste Phase erreichen (0 bis 1, vier Nachkommastellen)
      return { ...s, konversionZurNaechsten: naechste ? verhaeltnis(naechste.erreicht, s.erreicht) : null };
    }),
    quellen: quellen.rows.map((z) => ({ quelle: z.quelle, anzahl: zahl(z.anzahl) })),
    absagegruende: absagegruende.rows.map((z) => ({ absagegrund: z.absagegrund, anzahl: zahl(z.anzahl) })),
    zeitreihe: zeitreihe.rows.map((z) => ({ quartal: z.quartal, eingang: zahl(z.eingang), abschluss: zahl(z.abschluss), absage: zahl(z.absage) })),
    verweildauer: dauer.rows.map((z) => ({
      phase: z.phase,
      anzahl: zahl(z.anzahl),
      /** Mittelwert der abgeschlossenen Aufenthalte in Tagen, eine Nachkommastelle; `null` ohne abgeschlossenen Aufenthalt. */
      tage: z.tage === null ? null : Math.round(zahl(z.tage) * 10) / 10,
    })),
    konversionNachQuelle: alsGruppen(nachQuelle.rows).map(({ schluessel, ...rest }) => ({ quelle: schluessel, ...rest })),
    konversionNachBetreuung: alsGruppen(nachBetreuung.rows).map(({ schluessel, ...rest }) => ({ betreuung: schluessel, ...rest })),
  };
}

export type TrichterAuswertung = Awaited<ReturnType<typeof ladeTrichter>>;

// CSV ------------------------------------------------------------------------------------------------------------

const KOPF = {
  de: ["Abschnitt", "Schlüssel", "Kennzahl", "Wert"],
  en: ["Section", "Key", "Metric", "Value"],
} as const;

/**
 * Ein Feld der CSV-Datei. Texte aus Daten (Quelle, Betreuung) könnten mit `=`, `+`, `-`, `@` oder Tabulator beginnen und in
 * Tabellenprogrammen als Formel laufen; ihnen wird ein Apostroph vorangestellt. Trennzeichen, Anführungszeichen und
 * Zeilenumbrüche stehen in Anführungszeichen.
 */
export function csvFeld(wert: string | number | null): string {
  if (wert === null) return "";
  let text = String(wert);
  if (typeof wert === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Die Auswertung als lange Tabelle (Abschnitt, Schlüssel, Kennzahl, Wert): Dezimalpunkt, Trennzeichen Semikolon, UTF-8 mit Kennzeichen für Excel. */
export function trichterAlsCsv(a: TrichterAuswertung, sprache: "de" | "en"): string {
  const zeilen: (string | number | null)[][] = [[...KOPF[sprache]]];
  const z = (abschnitt: string, schluessel: string | null, kennzahl: string, wert: string | number | null) => zeilen.push([abschnitt, schluessel ?? "", kennzahl, wert]);
  z("gesamt", null, "deals", a.gesamt.deals);
  z("gesamt", null, "offen", a.gesamt.offen);
  z("gesamt", null, "abgesagt", a.gesamt.abgesagt);
  z("gesamt", null, "investiert", a.gesamt.investiert);
  for (const p of a.phasen) {
    z("phase", p.phase, "erreicht", p.erreicht);
    z("phase", p.phase, "aktuell", p.aktuell);
    z("phase", p.phase, "konversion_zur_naechsten", p.konversionZurNaechsten);
  }
  for (const q of a.zeitreihe) {
    z("quartal", q.quartal, "eingang", q.eingang);
    z("quartal", q.quartal, "abschluss", q.abschluss);
    z("quartal", q.quartal, "absage", q.absage);
  }
  for (const d of a.verweildauer) {
    z("verweildauer", d.phase, "aufenthalte", d.anzahl);
    z("verweildauer", d.phase, "tage_durchschnitt", d.tage);
  }
  for (const [abschnitt, gruppen] of [
    ["quelle", a.konversionNachQuelle.map((g) => ({ ...g, schluessel: g.quelle }))],
    ["betreuung", a.konversionNachBetreuung.map((g) => ({ ...g, schluessel: g.betreuung }))],
  ] as const) {
    for (const g of gruppen) {
      z(abschnitt, g.schluessel, "deals", g.deals);
      z(abschnitt, g.schluessel, "offen", g.offen);
      z(abschnitt, g.schluessel, "abgesagt", g.abgesagt);
      z(abschnitt, g.schluessel, "investiert", g.investiert);
      z(abschnitt, g.schluessel, "konversion", g.konversion);
    }
  }
  return `\uFEFF${zeilen.map((r) => r.map(csvFeld).join(";")).join("\r\n")}\r\n`;
}

export function dealflowRouten(db: Db) {
  const investmentmanager = alias(benutzer, "investmentmanager");
  const projektleiter = alias(benutzer, "projektleiter");
  return new Hono()
    .get("/arbeitsliste", async (c) => {
      const benutzerId = aktuellerAkteur(c).id;
      const deals = await lese(db, (tx) =>
        tx
          .select({
            id: deal.id,
            titel: deal.titel,
            unternehmenName: organisation.name,
            fondsId: deal.fondsId,
            eingangsdatum: deal.eingangsdatum,
            herkunft: deal.herkunft,
            dealtyp: deal.dealtyp,
            quelle: deal.quelle,
            investmentmanagerId: deal.investmentmanagerId,
            investmentmanagerName: investmentmanager.name,
            projektleiterId: deal.projektleiterId,
            projektleiterName: projektleiter.name,
            phase: deal.phase,
            betreuung: deal.betreuung,
          })
          .from(deal)
          .innerJoin(organisation, eq(organisation.id, deal.organisationId))
          .leftJoin(investmentmanager, eq(investmentmanager.id, deal.investmentmanagerId))
          .leftJoin(projektleiter, eq(projektleiter.id, deal.projektleiterId))
          .where(and(eq(deal.status, "offen"), dealSichtbar(c)))
          .orderBy(desc(deal.eingangsdatum), asc(deal.id)),
      );
      return c.json({ deals, benutzerId }, 200);
    })
    .get("/kartenfelder", async (c) => {
      const { id } = aktuellerAkteur(c);
      const [zeile] = await lese(db, (tx) =>
        tx.select({ felder: benutzerEinstellung.dealflowKartenfelder }).from(benutzerEinstellung).where(eq(benutzerEinstellung.benutzerId, id)),
      );
      return c.json({ felder: zeile?.felder ?? ["ticket", "investmentmanager"] }, 200);
    })
    .put("/kartenfelder", pruefe("json", kartenfelderEingabe), async (c) => {
      const { id } = aktuellerAkteur(c);
      const { felder } = c.req.valid("json");
      await schreibe(db, c, async (tx, protokoll) => {
        const verfuegbar = new Set((await beschreibeFelder(tx, "deal", null)).map((feld) => feld.schluessel));
        if (felder.some((feld) => !verfuegbar.has(feld))) {
          throw new Fachfehler(400, "FELD_NICHT_GEFUNDEN", "Kartenfelder müssen für Deals verfügbare Felder sein.");
        }
        const [vorher] = await tx.select().from(benutzerEinstellung).where(eq(benutzerEinstellung.benutzerId, id));
        const [nachher] = await tx
          .insert(benutzerEinstellung)
          .values({ benutzerId: id, dealflowKartenfelder: felder })
          .onConflictDoUpdate({
            target: benutzerEinstellung.benutzerId,
            set: { dealflowKartenfelder: felder, aktualisiertAm: new Date() },
          })
          .returning();
        await protokoll(vorher ? "aendern" : "anlegen", "benutzer_einstellung", id, vorher ?? null, nachher);
      });
      return c.json({ felder }, 200);
    })
    .get("/trichter/export", pruefe("query", exportAbfrage), async (c) => {
      const { sprache, ...filter } = c.req.valid("query");
      const auswertung = await lese(db, (tx) => ladeTrichter(tx, c, filter));
      // Eine Auswertung über Deals verlässt das System: Lese-Protokoll wie bei den Berichten.
      await protokolliereLesen(db, c, "dealflow_trichter", KEIN_DATENSATZ, { ...filter, format: "csv" });
      return c.body(trichterAlsCsv(auswertung, sprache), 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="dealflow-trichter.csv"`,
      });
    })
    .get("/trichter", pruefe("query", trichterAbfrage), async (c) => {
      const filter = c.req.valid("query");
      const auswertung = await lese(db, (tx) => ladeTrichter(tx, c, filter));
      return c.json(auswertung, 200);
    });
}
