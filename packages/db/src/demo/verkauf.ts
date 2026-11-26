import { buchwert, Decimal, verkaufsergebnis } from "@carraway/rechenkern";
import type { schema } from "../index";
import type { Demodaten } from "./erzeuge";
import type { DemoTexte } from "./texte";
import { abgeleiteteId } from "./zufall";

/** Markiert den Erlös, den der Generator für einen Exit bucht; dieser Durchlauf macht daraus den Barzufluss des Verkaufs. */
export const EXIT_ERLOES_BEMERKUNG = "Verkaufserlös";

/** Darlehensartige Instrumente (wie `DARLEHENSARTIG` in der API): Ihre Einlage kommt beim Exit als Tilgung zurück. */
const DARLEHENSARTIG = new Set(["darlehen", "wandeldarlehen", "stille_beteiligung", "venture_debt", "gesellschafterdarlehen"]);

const summe = (zeilen: { betrag: string }[]) => zeilen.reduce((s, v) => s.plus(v.betrag), new Decimal(0));

/**
 * Exits der Demo über dieselben Wege wie die Anwendung. Darlehensartige Instrumente (Darlehen, stille Beteiligung usw.) werden zum Exit getilgt.
 * Besteht die Beteiligung nur aus solchen, ist der Exit eine Rückzahlung: Tilgung der Einlage plus Rückfluss des Ergebnisses (Zinsen und Aufschlag).
 * Sonst verkauft der Fonds die ganze Beteiligung (Anteil 1) zum restlichen Erlös (`POST /beteiligungen/:id/verkauf`): voller Buchwert als Abgang,
 * Barzufluss als Rückfluss, Bewertung null. Danach sind Buchwert und offenes Kapital null.
 *
 * Läuft nach dem Portfolio-Modell (das Instrumente und Vorgänge noch umhängt). Ohne Zufallsziehungen und mit abgeleiteten Ids, damit die übrigen
 * Demo-Daten gleich bleiben. Die Summe der Zahlungen am Exit-Tag (Tilgung plus Rückfluss) bleibt der ursprüngliche Erlös; Multiple und IRR ändern sich
 * dadurch nicht (Tilgungen zählen wie Rückflüsse zu den Zuflüssen).
 */
export function bucheExits(d: Demodaten, tx: DemoTexte) {
  for (const b of d.beteiligungen.filter((x) => x.status === "exit")) {
    const vorgaenge = d.vorgaenge.filter((v) => v.beteiligungId === b.id);
    const erloes = vorgaenge.find((v) => v.art === "rueckfluss" && v.bemerkung === EXIT_ERLOES_BEMERKUNG);
    if (!erloes) throw new Error(`Demo: Exit ohne Erlös (${b.id})`);
    const datum = erloes.valuta;
    const instrumente = d.instrumente.filter((i) => i.beteiligungId === b.id);
    const bisExit = vorgaenge.filter((v) => v.valuta <= datum && v.id !== erloes.id);

    // Tilgung des offenen Kapitals je darlehensartigem Instrument (Auszahlungen plus kapitalisierte Zinsen minus Tilgungen, netto nach Storno).
    const tilgungen: (typeof d.vorgaenge)[number][] = [];
    for (const i of instrumente.filter((x) => DARLEHENSARTIG.has(x.art))) {
      const eigene = bisExit.filter((v) => v.instrumentId === i.id);
      const offen = summe(eigene.filter((v) => v.art === "auszahlung"))
        .plus(summe(eigene.filter((v) => v.art === "zins" && v.kapitalisiert === true)))
        .minus(summe(eigene.filter((v) => v.art === "tilgung")));
      if (!offen.greaterThan(0)) continue;
      tilgungen.push({ id: abgeleiteteId(erloes.id, `tilgung-${i.id}`), beteiligungId: b.id, instrumentId: i.id, art: "tilgung", valuta: datum, betrag: offen.toFixed(2), bemerkung: "Rückzahlung beim Exit" });
    }
    const getilgt = summe(tilgungen);
    const kaufpreis = new Decimal(erloes.betrag).minus(getilgt);
    if (!kaufpreis.greaterThan(0)) throw new Error(`Demo: Erlös des Exits deckt die Tilgung nicht (${b.id})`);
    d.vorgaenge.splice(d.vorgaenge.indexOf(erloes), 0, ...tilgungen);

    // Nur Darlehensartige: Rückzahlung ohne Verkauf (wie in der Exitliste „Rückzahlung“). Die Tilgung bringt Buchwert und offenes Kapital auf null,
    // der Rest des Erlöses (Zinsen und Aufschlag) bleibt Rückfluss.
    if (instrumente.every((i) => DARLEHENSARTIG.has(i.art))) {
      erloes.betrag = kaufpreis.toFixed(2);
      erloes.bemerkung = "Zinsen und Aufschlag bei Rückzahlung";
      continue;
    }

    // Buchwert vor dem Verkauf (nach der Tilgung) und Verkauf der ganzen Beteiligung, wie `planeVerkauf`.
    const alle = [...bisExit, ...tilgungen];
    const buch = buchwert({
      investiert: summe(alle.filter((v) => v.art === "auszahlung")),
      kapitalisiert: summe(alle.filter((v) => v.art === "zins" && v.kapitalisiert === true)),
      tilgungen: summe(alle.filter((v) => v.art === "tilgung")),
      wertberichtigungen: summe(alle.filter((v) => v.art === "wertberichtigung")),
    });
    const rechnung = verkaufsergebnis({ buchwert: buch.wert, anteilVerkauft: 1, kaufpreis, kosten: 0 });

    erloes.betrag = kaufpreis.toFixed(2);
    erloes.bemerkung = `Verkauf zum ${datum} (Anteil 1): Barzufluss`;

    const bewertungId = abgeleiteteId(erloes.id, "verkauf-bewertung");
    d.bewertungen.push({ id: bewertungId, beteiligungId: b.id, stichtag: datum, wert: "0.00", methode: "sonstige", begruendung: tx.bewertung.verkauft, status: "freigegeben", erstelltVon: "demo", freigegebenVon: "demo" });

    // Der Verkauf erfasst die Instrumente, die vor ihm angelegt wurden (`vollausstiegDurchVerkauf`). Er selbst ist wie die Vorgänge beim Schreiben
    // erfasst; die Instrumente tragen ein Anlagedatum aus der Vergangenheit (sonst fielen beide auf denselben Zeitpunkt der Transaktion).
    for (const i of instrumente) {
      i.erstelltAm ??= new Date(`${b.erstinvestment}T08:00:00Z`);
      if (i.erstelltAm.toISOString().slice(0, 10) > datum) throw new Error(`Demo: Instrument nach dem Verkauf angelegt (${i.id})`);
    }
    d.verkaeufe.push({
      id: abgeleiteteId(erloes.id, "verkauf"),
      beteiligungId: b.id,
      instrumentId: null,
      datum,
      anteilVerkauft: "1",
      kaufpreis: kaufpreis.toFixed(2),
      kosten: "0.00",
      buchwertVorher: buch.wert.toFixed(2),
      buchwertAbgang: rechnung.wert.buchwertAbgang.toFixed(2),
      erloes: rechnung.wert.erloes.toFixed(2),
      ergebnis: rechnung.wert.ergebnis.toFixed(2),
      barzufluss: kaufpreis.toFixed(2),
      schritte: [...buch.schritte, ...rechnung.schritte],
      rueckflussVorgangId: erloes.id,
      bewertungId,
    });
  }
}

export type DemoVerkauf = typeof schema.verkauf.$inferInsert & { id: string };
