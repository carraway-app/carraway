import { describe, expect, it } from "vitest";
import { buchwert, Decimal, istRueckfluss, xirr } from "@carraway/rechenkern";
import { erzeugeDemodaten } from "../demo/index";
import { plusTage } from "../demo/zufall";

const daten = erzeugeDemodaten({ seed: 1 });
const DARLEHENSARTIG = new Set(["darlehen", "wandeldarlehen", "stille_beteiligung", "venture_debt", "gesellschafterdarlehen"]);
const summe = (zeilen: { betrag: string }[]) => zeilen.reduce((s, v) => s.plus(v.betrag), new Decimal(0));
const exits = daten.beteiligungen.filter((b) => b.status === "exit");

/** Multiple und IRR der Exits je Fonds aus den Zahlungen (Auszahlungen negativ; Rückflüsse, Tilgungen, Zinsen und Dividenden positiv). */
function exitKennzahlen() {
  return daten.fonds.map((f) => {
    const ids = new Set(exits.filter((b) => b.fondsId === f.id).map((b) => b.id));
    const stroeme = daten.vorgaenge
      .filter((v) => ids.has(v.beteiligungId) && (v.art === "auszahlung" || istRueckfluss(v.art ?? "")))
      .map((v) => ({ datum: v.valuta, betrag: v.art === "auszahlung" ? new Decimal(v.betrag).neg() : new Decimal(v.betrag) }));
    const aus = stroeme.filter((s) => s.betrag.isNegative()).reduce((s, x) => s.minus(x.betrag), new Decimal(0));
    const ein = stroeme.filter((s) => s.betrag.isPositive()).reduce((s, x) => s.plus(x.betrag), new Decimal(0));
    return { fonds: f.kurzname, exits: ids.size, eingezahlt: aus.toFixed(2), rueckfluesse: ein.toFixed(2), multiple: aus.isZero() ? null : ein.div(aus).toFixed(6), irr: xirr(stroeme)?.toFixed(6) ?? null };
  });
}

describe("Demo-Generator: Exits über Verkauf oder Rückzahlung (Issue #193)", () => {
  it("Multiple und IRR der Exits sind dieselben wie vor der Umstellung (Stand Seed 1, nur Rückflüsse)", () => {
    expect(exitKennzahlen()).toEqual([
      { fonds: "BF I", exits: 4, eingezahlt: "9729000.00", rueckfluesse: "16098800.00", multiple: "1.654723", irr: "0.193187" },
      { fonds: "BF II", exits: 1, eingezahlt: "5300000.00", rueckfluesse: "21121100.00", multiple: "3.985113", irr: "0.469073" },
      { fonds: "BF Seed", exits: 0, eingezahlt: "0.00", rueckfluesse: "0.00", multiple: null, irr: null },
    ]);
  });

  it("ein Exit mit Eigenkapital ist ein vollständiger Verkauf, ein Exit nur aus Darlehensartigen eine Rückzahlung; danach sind Buchwert und offenes Kapital null", () => {
    expect(exits.length).toBeGreaterThanOrEqual(2);
    let verkauft = 0;
    let zurueckgezahlt = 0;
    for (const b of exits) {
      const instrumente = daten.instrumente.filter((x) => x.beteiligungId === b.id);
      const nurDarlehen = instrumente.every((i) => DARLEHENSARTIG.has(i.art));
      const verkaeufe = daten.verkaeufe.filter((v) => v.beteiligungId === b.id);
      expect(verkaeufe, b.id).toHaveLength(nurDarlehen ? 0 : 1);
      const v = verkaeufe[0];
      const datum = v?.datum ?? daten.vorgaenge.filter((x) => x.beteiligungId === b.id && x.art === "tilgung").map((x) => x.valuta).sort().at(-1)!;
      const bis = daten.vorgaenge.filter((x) => x.beteiligungId === b.id && x.valuta <= datum);
      // Buchwert zum Exit-Stichtag wie in der Anwendung: Rechenkern mit dem Abgang aus dem Verkauf.
      const buch = buchwert({
        investiert: summe(bis.filter((x) => x.art === "auszahlung")),
        kapitalisiert: summe(bis.filter((x) => x.art === "zins" && x.kapitalisiert === true)),
        tilgungen: summe(bis.filter((x) => x.art === "tilgung")),
        wertberichtigungen: summe(bis.filter((x) => x.art === "wertberichtigung")),
        abgang: v?.buchwertAbgang ?? 0,
      });
      expect(buch.wert.toFixed(2), b.id).toBe("0.00");
      for (const i of instrumente.filter((x) => DARLEHENSARTIG.has(x.art))) {
        const eigene = bis.filter((x) => x.instrumentId === i.id);
        const offen = summe(eigene.filter((x) => x.art === "auszahlung")).plus(summe(eigene.filter((x) => x.art === "zins" && x.kapitalisiert === true))).minus(summe(eigene.filter((x) => x.art === "tilgung")));
        expect(offen.toFixed(2), i.id).toBe("0.00");
      }
      for (const i of instrumente) expect(i.status).toBe("verkauft");
      if (!v) {
        // Rückzahlung: Tilgung der Einlage und Rückfluss des Ergebnisses am selben Tag, keine Bewertung danach.
        expect(bis.filter((x) => x.valuta === datum).map((x) => x.art).sort()).toEqual(["rueckfluss", "tilgung"]);
        zurueckgezahlt++;
        continue;
      }
      expect(v).toMatchObject({ anteilVerkauft: "1", instrumentId: null, kosten: "0.00" });
      // Rechenweg des Verkaufs: Abgang = Buchwert vorher, Ergebnis = Kaufpreis − Abgang, Barzufluss als Rückfluss gebucht.
      expect(v.buchwertAbgang).toBe(v.buchwertVorher);
      expect(new Decimal(v.kaufpreis).minus(v.buchwertAbgang).toFixed(2)).toBe(v.ergebnis);
      expect((v.schritte as { bezeichnung: string }[]).map((x) => x.bezeichnung)).toContain("Buchwertabgang (auf Cent, kaufmännisch)");
      const rueck = daten.vorgaenge.find((x) => x.id === v.rueckflussVorgangId);
      expect(rueck).toMatchObject({ art: "rueckfluss", valuta: v.datum, betrag: v.barzufluss });
      // Bewertung null am Verkaufstag, wie die Anwendung sie setzt.
      expect(daten.bewertungen.find((x) => x.id === v.bewertungId)).toMatchObject({ beteiligungId: b.id, stichtag: v.datum, wert: "0.00", methode: "sonstige" });
      // Der Verkauf erfasst alle Instrumente der Beteiligung: Sie sind vor ihm angelegt.
      for (const i of instrumente) expect(i.erstelltAm!.toISOString().slice(0, 10) <= v.datum).toBe(true);
      verkauft++;
    }
    expect(verkauft).toBeGreaterThanOrEqual(1);
    expect(zurueckgezahlt).toBeGreaterThanOrEqual(1);
  });

  it("Tilgung und Rückfluss am Exit-Tag ergeben zusammen den Erlös, den die Ausschüttung weitergibt", () => {
    for (const b of exits) {
      const datum = daten.vorgaenge.filter((x) => x.beteiligungId === b.id && x.art === "rueckfluss").map((x) => x.valuta).sort().at(-1)!;
      const zufluss = summe(daten.vorgaenge.filter((x) => x.beteiligungId === b.id && x.valuta === datum && (x.art === "rueckfluss" || x.art === "tilgung")));
      const ausschuettung = daten.fondsBewegungen.find((x) => x.fondsId === b.fondsId && x.art === "ausschuettung" && x.valuta === plusTage(datum, 14) && x.betrag === zufluss.toFixed(2));
      expect(ausschuettung, b.id).toBeDefined();
    }
  });
});
