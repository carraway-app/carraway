import { erzeugeDemodaten, type DemoOptionen } from "@carraway/db/demo";
import { erzeugeMappe, type Blattzeilen } from "./vorlage";
import { SPALTEN, spaltenkopf, type Blatt, type Sprache } from "./spec";

/**
 * Beispieldatei für den Import, abgeleitet vom Generator der Demo-Daten (erfundene Firmen, Personen und Zahlen). Die
 * Schlüssel sind fortlaufend (`ORG-0001`, `BET-0001`, …); die Kontrollsummen stammen aus den erzeugten Vorgängen und
 * Fondsbewegungen, so dass die Datei sich selbst bestätigt.
 */

const nummer = (prefix: string, i: number) => `${prefix}-${String(i + 1).padStart(4, "0")}`;
const text = (x: string | null | undefined): string | undefined => (x === null || x === undefined || x === "" ? undefined : x);
const mitWerten = (z: Record<string, string | undefined>): Record<string, string> => Object.fromEntries(Object.entries(z).filter(([, v]) => v !== undefined)) as Record<string, string>;
const cent = (betrag: string) => Math.round(Number(betrag) * 100);
const alsBetrag = (c: number) => (c / 100).toFixed(2);

export function beispielZeilen(optionen: DemoOptionen = {}): Blattzeilen {
  const demo = erzeugeDemodaten({ seed: 7, umfang: { beteiligungen: 14, deals: 14, fonds: 3 }, ...optionen });
  const fondsKurz = new Map(demo.fonds.map((f) => [f.id, f.kurzname]));
  const orgKey = new Map(demo.organisationen.map((o, i) => [o.id, nummer("ORG", i)]));
  // Das Blatt „Beteiligungen“ führt eine Zeile je Instrument (der Schlüssel steht für das Instrument); Bewertungen, Vorgänge und Konditionen verweisen darauf.
  // Brückenrunden und Wandlungen kennt das Importformat nicht: Die Brückenrunden entfallen, die Buchungen einer Wandlung stehen als gewöhnliche Vorgänge.
  const betriebe = new Map(demo.beteiligungen.map((b) => [b.id, b]));
  const instrumente = demo.beteiligungen.flatMap((b) => demo.instrumente.filter((i) => i.beteiligungId === b.id));
  const instrumentKey = new Map(instrumente.map((i, n) => [i.id, nummer("BET", n)]));
  const betKey = new Map(demo.beteiligungen.map((b) => [b.id, instrumentKey.get(instrumente.find((i) => i.beteiligungId === b.id)!.id)]));
  const runden = demo.finanzierungsrunden.filter((r) => r.art !== "bruecke");
  const rundeKey = new Map(runden.map((r, i) => [r.id, nummer("RUN", i)]));
  const vorgangKey = new Map(demo.vorgaenge.map((v, i) => [v.id, nummer("VOR", i)]));

  const zeilen: Blattzeilen = {};
  zeilen.fonds = demo.fonds.map((f) => mitWerten({ fonds_kurzname: f.kurzname, name: f.name, vintage: String(f.vintage), zeichnungskapital: f.zeichnungskapital, waehrung: "EUR" }));
  zeilen.organisationen = demo.organisationen.map((o) =>
    mitWerten({ organisation_schluessel: orgKey.get(o.id), name: o.name, art: o.art, sektor: text(o.sektor), ort: text(o.ort), website: text(o.website) }),
  );
  zeilen.personen = demo.personen.map((p, i) =>
    mitWerten({ person_schluessel: nummer("PER", i), vorname: p.vorname, nachname: p.nachname, email: text(p.email), funktion: text(p.funktion), organisation_schluessel: p.organisationId ? orgKey.get(p.organisationId) : undefined }),
  );
  zeilen.beteiligungen = instrumente.map((i) => {
    const b = betriebe.get(i.beteiligungId)!;
    return mitWerten({
      beteiligung_schluessel: instrumentKey.get(i.id),
      fonds_kurzname: fondsKurz.get(b.fondsId),
      organisation_schluessel: orgKey.get(b.organisationId),
      instrument: i.art,
      bezeichnung: i.bezeichnung,
      erstinvestment: b.erstinvestment,
      status: b.status ?? "aktiv",
      optionsschein_anzahl: text(i.optionsscheinAnzahl),
      ausuebungspreis: text(i.ausuebungspreis),
      ausgabe_am: text(i.ausgabeAm),
      laufzeit_bis: text(i.laufzeitBis),
    });
  });
  zeilen.finanzierungsrunden = runden.map((r) =>
    mitWerten({
      runde_schluessel: rundeKey.get(r.id),
      organisation_schluessel: orgKey.get(r.organisationId),
      bezeichnung: r.bezeichnung,
      datum: r.datum,
      pre_money: r.preMoney ?? undefined,
      post_money: r.postMoney ?? undefined,
      preis_je_anteil: r.preisJeAnteil ?? undefined,
      anteile_gesamt_nach: r.anteileGesamtNach ?? undefined,
    }),
  );
  // Das Importformat nennt den Investor; die Datenübernahme hängt die Position an dessen Standard-Vehikel.
  const investorVon = new Map(demo.vehikel.map((v) => [v.id, v.investorId]));
  zeilen.rundenpositionen = demo.rundenpositionen.map((p) =>
    mitWerten({
      runde_schluessel: rundeKey.get(p.rundeId),
      fonds_kurzname: p.fondsId ? fondsKurz.get(p.fondsId) : undefined,
      investor_schluessel: p.vehikelId ? orgKey.get(investorVon.get(p.vehikelId)!) : undefined,
      betrag: p.betrag,
      anteile: p.anteile,
      rolle: p.rolle,
    }),
  );
  zeilen.vorgaenge = demo.vorgaenge.map((v) =>
    mitWerten({
      vorgang_schluessel: vorgangKey.get(v.id),
      beteiligung_schluessel: instrumentKey.get(v.instrumentId),
      art: v.art,
      valuta: v.valuta,
      betrag: v.betrag,
      bemerkung: text(v.bemerkung),
      kapitalisiert: v.kapitalisiert ? "ja" : undefined,
      storniert_vorgang_schluessel: v.storniertVorgangId ? vorgangKey.get(v.storniertVorgangId) : undefined,
    }),
  );
  zeilen.bewertungen = demo.bewertungen
    .filter((w) => (w.status ?? "freigegeben") === "freigegeben")
    .map((w, i) =>
      mitWerten({ bewertung_schluessel: nummer("BEW", i), beteiligung_schluessel: betKey.get(w.beteiligungId), stichtag: w.stichtag, wert: w.wert, methode: w.methode, begruendung: text(w.begruendung), grundlage: text(w.grundlage) }),
    );
  zeilen.konditionen = demo.darlehenKonditionen.map((k) =>
    mitWerten({
      beteiligung_schluessel: instrumentKey.get(k.instrumentId),
      gueltig_ab: k.gueltigAb,
      satz_fix: k.satzFix,
      methode: k.methode,
      zinsperiode: k.zinsperiode,
      anker: k.anker,
      gewinnabhaengig_satz: text(k.gewinnabhaengigSatz),
      kappung_satz: text(k.kappungSatz),
      stundung_bis: text(k.stundungBis),
      kapitalisieren: k.kapitalisieren ? "ja" : undefined,
      faellig_am: text(k.faelligAm),
    }),
  );
  zeilen.fondsbewegungen = demo.fondsBewegungen.map((b, i) =>
    mitWerten({ bewegung_schluessel: nummer("FBW", i), fonds_kurzname: fondsKurz.get(b.fondsId), art: b.art, valuta: b.valuta, betrag: b.betrag, bemerkung: text(b.bemerkung) }),
  );

  // Kontrollsummen aus den erzeugten Daten (netto nach Storno, wie die Summe über alle Vorgänge).
  const fondsVonBet = new Map(demo.beteiligungen.map((b) => [b.id, b.fondsId]));
  zeilen.kontrollsummen = demo.fonds.flatMap((f) => {
    const summe = (art: string) => demo.vorgaenge.filter((v) => v.art === art && fondsVonBet.get(v.beteiligungId) === f.id).reduce((s, v) => s + cent(v.betrag), 0);
    return [
      { fonds_kurzname: f.kurzname, groesse: "zeichnungskapital", betrag: f.zeichnungskapital },
      { fonds_kurzname: f.kurzname, groesse: "zusagen", betrag: alsBetrag(summe("zusage")) },
      { fonds_kurzname: f.kurzname, groesse: "auszahlungen", betrag: alsBetrag(summe("auszahlung")) },
      { fonds_kurzname: f.kurzname, groesse: "rueckfluesse", betrag: alsBetrag(summe("rueckfluss")) },
    ];
  });
  return zeilen;
}

/** Die Beispieldatei als Excel-Arbeitsmappe. */
export const erzeugeBeispiel = (sprache: Sprache = "de", optionen: DemoOptionen = {}): Promise<Buffer> => erzeugeMappe(sprache, beispielZeilen(optionen));

/**
 * Ein Blatt als CSV (für Tests und als Muster): Köpfe der Sprache, `;` oder `,` als Trenner, Beträge mit Dezimalkomma auf Wunsch,
 * Datum wahlweise deutsch. Windows-1252 statt UTF-8 mit `kodierung`.
 */
export function alsCsv(
  blatt: Blatt,
  zeilen: Blattzeilen,
  optionen: { sprache?: Sprache; trenner?: ";" | "," | "\t"; dezimalkomma?: boolean; deutschesDatum?: boolean; kodierung?: "utf-8" | "windows-1252" } = {},
): Buffer {
  const { sprache = "de", trenner = ";", dezimalkomma = true, deutschesDatum = false, kodierung = "utf-8" } = optionen;
  const feld = (t: string) => (t.includes(trenner) || t.includes('"') || t.includes("\n") ? `"${t.replaceAll('"', '""')}"` : t);
  const kopf = SPALTEN[blatt].map((s) => spaltenkopf(s, sprache));
  const zeilenText = (zeilen[blatt] ?? []).map((z) =>
    SPALTEN[blatt]
      .map((s) => {
        let wert = z[s.schluessel] ?? "";
        if (dezimalkomma && /^-?\d+\.\d+$/.test(wert) && ["betrag", "betragOhneNull", "betragVorzeichen", "preis", "satz"].includes(s.typ)) wert = wert.replace(".", ",");
        if (deutschesDatum && s.typ === "datum" && wert) wert = wert.split("-").reverse().join(".");
        return feld(wert);
      })
      .join(trenner),
  );
  const csv = [kopf.map(feld).join(trenner), ...zeilenText].join("\r\n") + "\r\n";
  if (kodierung === "utf-8") return Buffer.from(csv, "utf8");
  return Buffer.from([...csv].map((z) => (z.codePointAt(0)! > 0xff ? "?" : z)).join(""), "latin1");
}
