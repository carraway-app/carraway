import { verteileAnteilig } from "@carraway/rechenkern";
import type { Demodaten } from "./erzeuge";
import { abgeleiteteId, euro, plusTage } from "./zufall";

function wochentagAb(datum: string, tage: number): string {
  const tag = plusTage(datum, tage);
  const wochentag = new Date(tag).getUTCDay();
  if (wochentag === 6) return plusTage(tag, 2);
  if (wochentag === 0) return plusTage(tag, 1);
  return tag;
}

/** Abrufanteile und Wertstellungen für die Kapitalkonten und die Quartalsbilanz. */
export function erzeugeLpZahlungen(d: Demodaten) {
  const abrufe = d.fondsBewegungen.filter((b) => b.art === "abruf").sort((a, b) => a.valuta.localeCompare(b.valuta));
  const beispiel = abrufe.at(-1);
  const namen = new Map(d.organisationen.map((o) => [o.id, o.name]));
  for (const fonds of d.fonds) {
    // Wie in der Fondsverwaltung entscheidet bei gleichem Centrest die Reihenfolge der Investoren.
    const lp = d.fondsZeichnungen.filter((z) => z.fondsId === fonds.id).sort((a, b) =>
      namen.get(a.organisationId)!.localeCompare(namen.get(b.organisationId)!, "de") || a.organisationId.localeCompare(b.organisationId));
    const gewichte = lp.map((z) => fonds.lpVerteilungNachZusage ? z.zusage : z.anteil);
    for (const abruf of abrufe.filter((b) => b.fondsId === fonds.id)) {
      abruf.faelligAm = wochentagAb(abruf.valuta, 10);
      const teile = verteileAnteilig(abruf.betrag, gewichte);
      lp.forEach(({ organisationId }, i) => {
        const anteil = { bewegungId: abruf.id, organisationId, betrag: teile[i]!.toFixed(2) };
        d.abrufAnteile.push(anteil);
        const cent = teile[i]!.times(100).toNumber();
        if (cent === 0) return;

        // Beim jüngsten Abruf zahlen zwei LPs zunächst die Hälfte. Nur der erste begleicht später den Rest.
        const geteilt = abruf === beispiel && i < 2 && cent >= 2;
        const ersteRate = geteilt ? Math.floor(cent / 2) : cent;
        const id = abgeleiteteId(abruf.id, organisationId);
        d.lpZahlungen.push({ id, bewegungId: abruf.id, organisationId, valuta: wochentagAb(abruf.valuta, 4 + i), betrag: euro(ersteRate) });
        if (geteilt && i === 0) {
          d.lpZahlungen.push({ id: abgeleiteteId(id, "rest"), bewegungId: abruf.id, organisationId, valuta: wochentagAb(abruf.valuta, 17), betrag: euro(cent - ersteRate) });
        }
      });
    }
  }
}
