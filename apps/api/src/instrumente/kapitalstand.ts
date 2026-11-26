import { sql } from "drizzle-orm";
import { Decimal } from "@carraway/rechenkern";
import { bisStand, ohneStornoPaare } from "../kennzahlen/zeitstand";
import type { Tx } from "../zeitlimit";
import { ladeVerteilungsgrundlagen, verteileAufGrundlage } from "./lp-verteilung";
import { ladeKostenbuchungen } from "../kapital/fondskosten";

type Abfrage = Pick<Tx, "execute" | "select">;
type Anteil = { organisationId: string; betrag: string };
type Bewegung = {
  id: string; art: "abruf" | "ausschuettung"; valuta: string; betrag: string; faelligAm: string | null;
  festeTeile: Anteil[] | null;
};
export type Eingang = {
  id: string; bewegungId: string; organisationId: string; valuta: string; betrag: string;
  storniertZahlungId: string | null; grund: string | null; belegreferenz: string | null;
};

export interface Abrufposition {
  bewegungId: string;
  organisationId: string | null;
  valuta: string;
  faelligAm: string;
  abgerufen: string;
  eingezahlt: string;
  offen: string;
  ueberfaellig: string;
  /** Offener Betrag aus Abrufbuchungen ohne separat erfassten Zahlungsstand. */
  ungeklaert: string;
}

type Summen = Pick<Abrufposition, "abgerufen" | "eingezahlt" | "offen" | "ueberfaellig" | "ungeklaert">;
function summiere(positionen: Abrufposition[]): Summen {
  const summe = (feld: keyof Summen) => positionen.reduce((s, p) => s.plus(p[feld]), new Decimal(0)).toFixed(2);
  return { abgerufen: summe("abgerufen"), eingezahlt: summe("eingezahlt"), offen: summe("offen"), ueberfaellig: summe("ueberfaellig"), ungeklaert: summe("ungeklaert") };
}

/** Gemeinsamer Bestand für Kennzahlen, LP-Konten und Berichte. Die Einzelpositionen behalten die IDs der Buchungen. */
export async function ladeKapitalstand(tx: Abfrage, fondsId: string, stichtag: string, stand?: string, bewegungId?: string) {
  const grundlagen = await ladeVerteilungsgrundlagen(tx, fondsId, stand);
  const { zeichnungen, gewichte } = grundlagen.zum(stichtag);
  const { rows } = await tx.execute<Bewegung>(sql`
    SELECT fb.id, fb.art, fb.valuta::text, fb.betrag::text, fb.faellig_am::text AS "faelligAm",
      coalesce(
        (SELECT jsonb_agg(jsonb_build_object('organisationId', m.organisation_id, 'betrag', m.betrag::text))
         FROM fonds_mitteilung m WHERE m.bewegung_id = fb.id${bisStand(sql.raw("m.freigegeben_am"), stand)}),
        (SELECT jsonb_agg(jsonb_build_object('organisationId', a.organisation_id, 'betrag', a.betrag::text))
         FROM abruf_anteil a WHERE a.bewegung_id = fb.id${bisStand(sql.raw("a.erfasst_am"), stand)})
      ) AS "festeTeile"
    FROM fonds_bewegung fb WHERE fb.fonds_id = ${fondsId}
      ${bewegungId ? sql`AND fb.id = ${bewegungId}` : sql``} AND fb.valuta <= ${stichtag}::date
      ${bisStand(sql.raw("fb.erfasst_am"), stand)} AND ${ohneStornoPaare("fb", stichtag, stand)}
    ORDER BY fb.valuta, fb.id`);
  const { rows: zahlungen } = await tx.execute<Eingang>(sql`
    SELECT z.id, z.bewegung_id AS "bewegungId", z.organisation_id AS "organisationId", z.valuta::text, z.betrag::text,
      z.storniert_zahlung_id AS "storniertZahlungId", z.grund, z.belegreferenz
    FROM lp_zahlung z JOIN fonds_bewegung fb ON fb.id = z.bewegung_id
    WHERE fb.fonds_id = ${fondsId}
      ${bewegungId ? sql`AND z.bewegung_id = ${bewegungId}` : sql``} AND z.valuta <= ${stichtag}::date${bisStand(sql.raw("z.erfasst_am"), stand)}
    ORDER BY z.valuta, z.erfasst_am, z.id`);
  const aufgehoben = new Set(zahlungen.map((z) => z.storniertZahlungId));
  const aktiveAbrufe = new Set(rows.filter((b) => b.art === "abruf").map((b) => b.id));
  const eingaenge = zahlungen.filter((z) => aktiveAbrufe.has(z.bewegungId) && !z.storniertZahlungId && !aufgehoben.has(z.id));
  const bezahlt = new Map<string, Decimal>();
  for (const z of eingaenge) {
    const key = z.bewegungId + z.organisationId;
    bezahlt.set(key, (bezahlt.get(key) ?? new Decimal(0)).plus(z.betrag));
  }
  const positionen: Abrufposition[] = [];
  const bewegungen = rows.map(({ festeTeile, ...b }) => {
    const basis = grundlagen.zum(b.valuta);
    const verteilteBetraege = festeTeile ? [] : verteileAufGrundlage(b.betrag, basis, basis.zeichnungen);
    const anteile = festeTeile ?? basis.zeichnungen.map((z, i) => ({ organisationId: z.organisationId, betrag: verteilteBetraege[i]! }));
    const je = new Map(anteile.map((a) => [a.organisationId, a.betrag]));
    if (b.art === "abruf") {
      const faelligAm = b.faelligAm ?? b.valuta;
      // Ein Altbestand ohne Zeichnungen zählt auf Fondsebene mit.
      for (const a of anteile.length ? anteile : [{ organisationId: null, betrag: b.betrag }]) {
        const eingezahlt = bezahlt.get(b.id + a.organisationId) ?? new Decimal(0);
        const offen = new Decimal(a.betrag).minus(eingezahlt).toFixed(2);
        positionen.push({ bewegungId: b.id, organisationId: a.organisationId, valuta: b.valuta, faelligAm,
          abgerufen: a.betrag, eingezahlt: eingezahlt.toFixed(2), offen,
          ueberfaellig: faelligAm < stichtag ? offen : "0.00", ungeklaert: b.faelligAm === null ? offen : "0.00" });
      }
    }
    return { ...b, teile: zeichnungen.map((z) => je.get(z.organisationId) ?? "0.00") };
  });
  const nachInvestor = new Map<string, Abrufposition[]>();
  for (const p of positionen) {
    if (!p.organisationId) continue;
    const liste = nachInvestor.get(p.organisationId) ?? [];
    liste.push(p);
    nachInvestor.set(p.organisationId, liste);
  }
  const jeLp = new Map(zeichnungen.map((z) => [z.organisationId, summiere(nachInvestor.get(z.organisationId) ?? [])]));
  const ausschuettungen = bewegungen.filter((b) => b.art === "ausschuettung");
  const zahlungsstrom = [
    ...eingaenge.map((z) => ({ datum: z.valuta, betrag: new Decimal(z.betrag).neg().toFixed(2) })),
    ...ausschuettungen.map((b) => ({ datum: b.valuta, betrag: b.betrag })),
  ];
  // Verwaltungsvergütung und Fondskosten (Issue #157): festgeschriebene Anteile in der Reihenfolge der Zeichnungen; kein Zahlungsstrom.
  const kosten = bewegungId ? [] : (await ladeKostenbuchungen(tx, fondsId, stichtag, stand)).map((k) => {
    const je = new Map(k.anteile.map((a) => [a.organisationId, a.betrag]));
    return { id: k.id, art: k.art, valuta: k.valuta, betrag: k.betrag, storniertKostenId: k.storniertKostenId, teile: zeichnungen.map((z) => je.get(z.organisationId) ?? "0.00") };
  });
  return { stichtag, zeichnungen, gewichte, bewegungen, zahlungen, eingaenge, zahlungsstrom, positionen, jeLp, kosten, fonds: summiere(positionen) };
}
