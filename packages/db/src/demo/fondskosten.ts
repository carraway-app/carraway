import { verteileAnteilig } from "@carraway/rechenkern";
import type { schema } from "../index";
import { BUCHHALTUNG_BIS } from "./buchhaltung";
import type { Demodaten } from "./erzeuge";
import { abgeleiteteId } from "./zufall";

/**
 * Verwaltungsvergütung und Fondskosten der Demo (Issue #157): Die Saldenliste des letzten Quartals führt die Verwaltungskosten des
 * Fonds auf Konto 6300; dieselbe Summe steht hier als Buchungen (drei Quartale Verwaltungsvergütung, einmal Fondskosten), verteilt nach
 * dem Anteil am Fonds wie die Abrufe. Ohne Zufallsziehungen, abgeleitete Ids: Fonds-NAV, Kennzahlen und NAV-Anteile bleiben unverändert,
 * die Liquiditätsabstimmung erklärt nun die gebuchten Kosten.
 */

export interface DemoFondskosten {
  fondsKosten: (typeof schema.fondsKosten.$inferInsert & { id: string })[];
  fondsKostenAnteile: (typeof schema.fondsKostenAnteil.$inferInsert)[];
}

const QUARTALE = [
  { von: "2026-01-01", bis: "2026-03-31", valuta: "2026-01-15", q: "Q1" },
  { von: "2026-04-01", bis: "2026-06-30", valuta: "2026-04-15", q: "Q2" },
  { von: "2026-07-01", bis: "2026-09-30", valuta: "2026-07-15", q: "Q3" },
];
const TEXTE = {
  de: { verguetung: (q: string) => `Verwaltungsvergütung ${q} 2026`, kosten: "Prüfung, Verwahrstelle und Rechtsberatung 2026" },
  en: { verguetung: (q: string) => `Management fee ${q} 2026`, kosten: "Audit, depositary and legal advice 2026" },
};

const euro = (c: number) => (c / 100).toFixed(2);

export function erzeugeFondskosten(d: Demodaten, sprache: "de" | "en" = "de"): DemoFondskosten {
  const texte = TEXTE[sprache];
  const aus: DemoFondskosten = { fondsKosten: [], fondsKostenAnteile: [] };
  const namen = new Map(d.organisationen.map((o) => [o.id, o.name]));
  for (const fonds of d.fonds) {
    const lauf = d.saldenlaeufe.find((l) => l.fondsId === fonds.id && l.zeitraumBis === BUCHHALTUNG_BIS);
    const saldo = lauf ? d.salden.find((x) => x.laufId === lauf.id && x.kontoNummer === "6300") : undefined;
    const kosten = Math.round(Number(saldo?.saldo ?? 0) * 100);
    // Wie in der Fondsverwaltung entscheidet bei gleichem Centrest die Reihenfolge der Investoren (Name, Kennung).
    const lp = d.fondsZeichnungen.filter((z) => z.fondsId === fonds.id).sort((a, b) =>
      namen.get(a.organisationId)!.localeCompare(namen.get(b.organisationId)!, "de") || a.organisationId.localeCompare(b.organisationId));
    if (kosten < 100 || lp.length === 0) continue;
    const gewichte = lp.map((z) => (fonds.lpVerteilungNachZusage ? z.zusage : z.anteil));
    const verguetung = Math.round(kosten * 0.75);
    const jeQuartal = Math.floor(verguetung / QUARTALE.length);
    const posten = [
      ...QUARTALE.map((q, i) => ({ art: "verwaltungsverguetung" as const, valuta: q.valuta, zeitraumVon: q.von, zeitraumBis: q.bis, bemerkung: texte.verguetung(q.q),
        cent: i === QUARTALE.length - 1 ? verguetung - jeQuartal * (QUARTALE.length - 1) : jeQuartal })),
      { art: "fondskosten" as const, valuta: BUCHHALTUNG_BIS, zeitraumVon: null, zeitraumBis: null, bemerkung: texte.kosten, cent: kosten - verguetung },
    ];
    posten.forEach((p, n) => {
      if (p.cent <= 0) return;
      const id = abgeleiteteId(fonds.id, `kosten-${n + 1}`);
      const betrag = euro(p.cent);
      aus.fondsKosten.push({ id, fondsId: fonds.id, art: p.art, valuta: p.valuta, betrag, verteilung: "grundlage", zeitraumVon: p.zeitraumVon, zeitraumBis: p.zeitraumBis, bemerkung: p.bemerkung });
      const teile = verteileAnteilig(betrag, gewichte);
      lp.forEach((z, i) => aus.fondsKostenAnteile.push({ kostenId: id, organisationId: z.organisationId, betrag: teile[i]!.toFixed(2) }));
    });
  }
  return aus;
}
