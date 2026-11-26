import type { SzenarioberichtDaten } from "@carraway/berichte";
import { ladeFonds } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { ergebnisVon, vergleiche, type SzenarioZeile } from "./dienst";
import type { SzenarioErgebnis } from "./rechnen";

/** Berichtsdaten aus Szenarien (Ergebnis wie in der Ansicht: festgeschrieben gespeichert, Entwurf frisch gerechnet). */
export async function ladeSzenarioberichtDaten(tx: Tx, fondsId: string, zeilen: SzenarioZeile[], erzeugt: string = new Date().toISOString()): Promise<SzenarioberichtDaten> {
  const f = await ladeFonds(tx, fondsId);
  const ergebnisse: SzenarioErgebnis[] = [];
  for (const z of zeilen) ergebnisse.push((await ergebnisVon(tx, z)).ergebnis);
  return {
    fonds: { name: f.name, kurzname: f.kurzname, waehrung: f.waehrung },
    erzeugt,
    szenarien: zeilen.map((z, i) => {
      const e = ergebnisse[i]!;
      const namen = new Map(e.beteiligungen.map((b) => [b.id, b.name]));
      return {
        name: z.name,
        status: z.status,
        basisStichtag: z.basisStichtag,
        ergebnisHash: z.ergebnisHash,
        jahre: e.jahre.map((j) => ({ jahr: j.jahr, ist: j.ist, abrufe: j.abrufe, ausschuettungenNetto: j.ausschuettungenNetto, navNetto: j.navNetto, dpi: j.dpi, tvpi: j.tvpi, irrNetto: j.irrNetto })),
        beteiligungen: e.beteiligungen.map((b) => ({ name: b.name, ausstiegsJahr: b.ausstiegsJahr, erloesBeiAusstieg: b.erloesBeiAusstieg, wahrscheinlichkeit: b.wahrscheinlichkeit, erwarteterErloes: b.erwarteterErloes, erloesQuelle: b.erloesQuelle })),
        befunde: [
          ...e.befunde.map((b) => ({ code: b.code, schwere: b.schwere, name: b.beteiligungId ? namen.get(b.beteiligungId) : undefined, params: b.params })),
          ...(e.bewertungsszenario?.befunde ?? []).map((b) => ({ code: b.code, schwere: b.schwere, name: b.beteiligungId ? e.bewertungsszenario!.beteiligungen.find((x) => x.id === b.beteiligungId)?.name : undefined, params: b.params })),
        ],
        ...(e.bewertungsszenario
          ? {
              bewertung: {
                beteiligungen: e.bewertungsszenario.beteiligungen.map((x) => ({
                  name: x.name,
                  aktuell: x.aktuell,
                  erwartet: x.erwartet,
                  ...(x.erwartetErloes !== undefined ? { erwartetErloes: x.erwartetErloes } : {}),
                  faelle: x.faelle.map((f) => ({ schluessel: f.schluessel, name: f.name, methode: f.methode, gewicht: f.gewicht, wert: f.wert, abweichung: f.abweichung, ...(f.exit !== undefined ? { exit: f.exit ? { erloesFonds: f.exit.erloesFonds, grund: f.exit.grund } : null } : {}) })),
                })),
                aktuell: e.bewertungsszenario.aktuell,
                faelle: e.bewertungsszenario.faelle,
                erwartet: e.bewertungsszenario.erwartet,
              },
            }
          : {}),
      };
    }),
    vergleich: vergleiche(ergebnisse),
  };
}

