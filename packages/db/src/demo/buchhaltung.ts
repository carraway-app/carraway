import { createHash } from "node:crypto";
import { STANDARD_GLIEDERUNG, STANDARD_KONTEN, STANDARD_REGELN, SICHTEN } from "@carraway/rechenkern";
import type { schema } from "../index";
import type { Demodaten } from "./erzeuge";
import { erzeugeRng } from "./zufall";

/** Buchhaltung der Demo-Daten (Etappe 14): Kontenrahmen, Regeln, Kontenzuordnung des Exports, Schlüssel und je Fonds eine Saldenliste für das letzte Quartal. Alles erfunden. */

export interface DemoBuchhaltung {
  foerderprogramme: (typeof schema.foerderprogramm.$inferInsert)[];
  fondsBuchhaltung: (typeof schema.fondsBuchhaltung.$inferInsert)[];
  beteiligungBuchhaltung: (typeof schema.beteiligungBuchhaltung.$inferInsert)[];
  fondsMittelarten: (typeof schema.fondsMittelart.$inferInsert)[];
  gliederungPositionen: (typeof schema.gliederungPosition.$inferInsert)[];
  sachkonten: (typeof schema.sachkonto.$inferInsert)[];
  kontenregeln: (typeof schema.kontenregel.$inferInsert)[];
  buchungsregeln: (typeof schema.buchungsregel.$inferInsert)[];
  saldenlaeufe: (typeof schema.saldenlauf.$inferInsert)[];
  salden: (typeof schema.saldo.$inferInsert)[];
}

export const BUCHHALTUNG_VON = "2026-07-01";
export const BUCHHALTUNG_BIS = "2026-09-30";

/** Förderprogramme der Demo (erfunden); feste Kennungen, damit der Bestand bei gleicher Saat gleich bleibt. */
const festeId = (name: string): string => {
  const h = createHash("sha1").update(`demo:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export const DEMO_PROGRAMME = [
  { id: festeId("foerderprogramm:demo_wachstum"), schluessel: "demo_wachstum", bezeichnung: "Beispielprogramm Wachstum", erstelltVon: "demo" },
  { id: festeId("foerderprogramm:demo_innovation"), schluessel: "demo_innovation", bezeichnung: "Beispielprogramm Innovation", erstelltVon: "demo" },
];

const cent = (w: string | null | undefined): number => Math.round(Number(w ?? 0) * 100);
const euro = (c: number): string => (c / 100).toFixed(2);
const komma = (c: number): string => euro(Math.abs(c)).replace(".", ",");

export function erzeugeBuchhaltung(d: Demodaten, seed: number): DemoBuchhaltung {
  const rng = erzeugeRng(((seed * 2654435761 + 30) >>> 0) as number);
  const aus: DemoBuchhaltung = { foerderprogramme: DEMO_PROGRAMME.map((p) => ({ ...p })), fondsBuchhaltung: [], beteiligungBuchhaltung: [], fondsMittelarten: [], gliederungPositionen: [], sachkonten: [], kontenregeln: [], buchungsregeln: [], saldenlaeufe: [], salden: [] };

  d.fonds.forEach((f, i) => {
    const fondsId = f.id;
    aus.fondsBuchhaltung.push({ fondsId, beraternummer: 1000001 + i, mandantennummer: 20001 + i, wirtschaftsjahrBeginn: 1, sachkontenlaenge: 4, belegpraefix: `BF${i + 1}`, geaendertVon: "demo" });
    aus.fondsMittelarten.push(
      { fondsId, schluessel: "landesmittel", bezeichnungDe: "Landesmittel", bezeichnungEn: "State funds", quote: "0.500000", meldeArt: "kofinanzierung", gueltigAb: `${f.vintage}-01-01` },
      { fondsId, schluessel: "eu_mittel", bezeichnungDe: "EU-Mittel", bezeichnungEn: "EU funds", quote: "0.300000", meldeArt: "foerdermittel", gueltigAb: `${f.vintage}-01-01` },
      { fondsId, schluessel: "eigenmittel", bezeichnungDe: "Eigenmittel", bezeichnungEn: "Own funds", quote: "0.200000", meldeArt: "eigenmittel", gueltigAb: `${f.vintage}-01-01` },
    );
    for (const sicht of SICHTEN) for (const p of STANDARD_GLIEDERUNG[sicht]) aus.gliederungPositionen.push({ fondsId, sicht, ...p });
    for (const k of STANDARD_KONTEN) aus.sachkonten.push({ fondsId, ...k });
    for (const r of STANDARD_REGELN) aus.kontenregeln.push({ fondsId, sicht: r.sicht, kontoVon: r.von, kontoBis: r.bis, positionSchluessel: r.position, gueltigAb: "2020-01-01", erstelltVon: "demo" });
    // Die Demo-Bilanz zeigt den Zeitwert. Die separate Portfolio-Abstimmung vergleicht die Buchwerte aus den Vorgängen.
    const bewertungskonto = "0120";
    const bezeichnung = "Bewertungsdifferenz der Finanzanlagen";
    aus.sachkonten.push({ fondsId, nummer: bewertungskonto, bezeichnung, art: "aktiv" });
    aus.gliederungPositionen.push({
      fondsId, sicht: "bilanz", schluessel: "aktiva.bewertungsdifferenz", elternSchluessel: "aktiva.finanzanlagen",
      bezeichnungDe: bezeichnung, bezeichnungEn: "Fair value adjustment", reihenfolge: 45, seite: "soll",
    });
    aus.kontenregeln.push({
      fondsId, sicht: "bilanz", kontoVon: bewertungskonto, kontoBis: bewertungskonto,
      positionSchluessel: "aktiva.bewertungsdifferenz", gueltigAb: BUCHHALTUNG_BIS, erstelltVon: "demo",
    });
    aus.buchungsregeln.push(
      { fondsId, quelle: "zins", konto: "1400", gegenkonto: "4200", richtung: "S", buSchluessel: null, buchungstext: "Zins {organisation} {valuta}", geaendertVon: "demo" },
      { fondsId, quelle: "auszahlung", konto: "0150", gegenkonto: "1200", richtung: "S", buSchluessel: null, buchungstext: "Auszahlung {organisation}", geaendertVon: "demo" },
      { fondsId, quelle: "rueckfluss", konto: "1200", gegenkonto: "4900", richtung: "S", buSchluessel: null, buchungstext: "Rückfluss {organisation}", geaendertVon: "demo" },
      { fondsId, quelle: "tilgung", konto: "1200", gegenkonto: "0150", richtung: "S", buSchluessel: null, buchungstext: "Tilgung {organisation}", geaendertVon: "demo" },
      { fondsId, quelle: "zinszahlung", konto: "1200", gegenkonto: "1400", richtung: "S", buSchluessel: null, buchungstext: "Zinszahlung {organisation}", geaendertVon: "demo" },
      { fondsId, quelle: "dividende", konto: "1200", gegenkonto: "4900", richtung: "S", buSchluessel: null, buchungstext: "Dividende {organisation}", geaendertVon: "demo" },
    );

    // Schlüssel zur Buchhaltung für die ersten fünf Beteiligungen des Fonds
    const bets = d.beteiligungen.filter((b) => b.fondsId === fondsId);
    bets.slice(0, 5).forEach((b, n) =>
      aus.beteiligungBuchhaltung.push({
        beteiligungId: b.id!,
        projektnummer: `P-${i + 1}${String(n + 1).padStart(3, "0")}`,
        vertragsnummer: `V-${f.vintage}-${String(n + 1).padStart(3, "0")}`,
        partnernummer: String(70000 + i * 100 + n),
        buchungskreis: `BK${i + 1}`,
        foerderprogrammId: n % 3 === 2 ? null : DEMO_PROGRAMME[(i + n) % DEMO_PROGRAMME.length]!.id,
        geaendertVon: "demo",
      }),
    );

    // Saldenliste des letzten Quartals aus den Daten der Plattform (Stand 30.09.2026)
    const imStand = bets.filter((b) => b.erstinvestment <= BUCHHALTUNG_BIS);
    const art = new Map(imStand.map((b) => [b.id, b.instrument]));
    const vs = d.vorgaenge.filter((v) => art.has(v.beteiligungId) && v.valuta <= BUCHHALTUNG_BIS);
    const summe = (filter: (v: (typeof vs)[number]) => boolean) => vs.filter(filter).reduce((s, v) => s + cent(v.betrag), 0);
    const eigen = (v: (typeof vs)[number]) => art.get(v.beteiligungId) === "offene_beteiligung";
    const eigenInvestiert = summe((v) => v.art === "auszahlung" && eigen(v));
    const darlehenInvestiert = summe((v) => v.art === "auszahlung" && !eigen(v));
    const kapitalisiert = summe((v) => v.art === "zins" && v.kapitalisiert === true);
    const tilgungen = summe((v) => v.art === "tilgung");
    const wertberichtigung = summe((v) => v.art === "wertberichtigung");
    const zinsGesamt = summe((v) => v.art === "zins");
    // Bar fließen nur gezahlte Zinsen; die Zinsbuchung ist eine Forderung.
    const zinsBar = summe((v) => v.art === "zinszahlung");
    const rueckfluesse = summe((v) => v.art === "rueckfluss");
    const auszahlungen = eigenInvestiert + darlehenInvestiert;
    const bew = d.fondsBewegungen.filter((x) => x.fondsId === fondsId && x.valuta <= BUCHHALTUNG_BIS);
    const kapitalabrufe = bew.filter((x) => x.art === "abruf");
    const abrufe = kapitalabrufe.reduce((s, x) => s + cent(x.betrag), 0);
    const abrufIds = new Set(kapitalabrufe.map((x) => x.id));
    const eingezahlt = d.lpZahlungen.filter((z) => abrufIds.has(z.bewegungId) && z.valuta <= BUCHHALTUNG_BIS).reduce((s, z) => s + cent(z.betrag), 0);
    const offeneAbrufe = abrufe - eingezahlt;
    const ausschuettungen = bew.filter((x) => x.art === "ausschuettung").reduce((s, x) => s + cent(x.betrag), 0);
    const kosten = Math.round(auszahlungen * 0.08);
    let bank = eingezahlt - ausschuettungen - auszahlungen + rueckfluesse + tilgungen + zinsBar - kosten;
    let ausleihungen = darlehenInvestiert + kapitalisiert - tilgungen;
    // Bewusste Abweichung beim ersten Fonds: 1.000,00 Euro Ausleihungen sind als Bankbewegung gebucht, die Abstimmung zeigt sie.
    if (i === 0) {
      ausleihungen -= 100_000;
      bank += 100_000;
    }
    const zeilen: [string, string, number][] = [
      ["0100", "Beteiligungen", eigenInvestiert],
      ["0110", "Wertberichtigungen auf Beteiligungen", -wertberichtigung],
      ["0150", "Ausleihungen an Beteiligungsunternehmen", ausleihungen],
      ["1200", "Bank", bank],
      ["1400", "Sonstige Forderungen", zinsGesamt - kapitalisiert - zinsBar + offeneAbrufe],
      ["2000", "Kapitalanteile der Gesellschafter", -(abrufe - ausschuettungen)],
      ["4200", "Zinserträge", -zinsGesamt],
      ["6300", "Verwaltungskosten", kosten],
    ];
    // Der Seed bewertet den Bestand zu jedem Quartalsende. Nach einem vollständigen Ausstieg entfallen die Folgebewertungen.
    const zeitwert = d.bewertungen
      .filter((b) => art.has(b.beteiligungId) && b.status === "freigegeben" && b.stichtag === BUCHHALTUNG_BIS)
      .reduce((summe, b) => summe + cent(b.wert), 0);
    const bewertungsdifferenz = zeitwert - (eigenInvestiert - wertberichtigung + ausleihungen);
    if (bewertungsdifferenz !== 0) {
      zeilen.push([bewertungskonto, bezeichnung, bewertungsdifferenz]);
      zeilen.push(bewertungsdifferenz > 0
        ? ["4100", "Erträge aus Beteiligungen", -bewertungsdifferenz]
        : ["6800", "Abschreibungen auf Finanzanlagen", -bewertungsdifferenz]);
    }
    // Ausgleich: die Differenz steht als sonstiger Ertrag (Haben) oder sonstiger Aufwand (Soll); so ist die Liste immer ausgeglichen.
    const ausgleich = -zeilen.reduce((s, z) => s + z[2], 0);
    if (ausgleich < 0) zeilen.push(["4900", "Sonstige Erträge", ausgleich]);
    else if (ausgleich > 0) zeilen.push(["6900", "Sonstige Aufwendungen", ausgleich]);
    const kopf = "Konto;Kontobeschriftung;EB-Wert;EB-Wert S/H;Soll;Haben;Saldo;Saldo S/H";
    const csv = [kopf, ...zeilen.map(([k, b, c]) => `${k};${b};0,00;S;${c > 0 ? komma(c) : "0,00"};${c < 0 ? komma(c) : "0,00"};${komma(c)};${c < 0 ? "H" : "S"}`)].join("\r\n");
    const datei = Buffer.from(csv, "latin1");
    const laufId = rng.uuid();
    aus.saldenlaeufe.push({
      id: laufId,
      fondsId,
      zeitraumVon: BUCHHALTUNG_VON,
      zeitraumBis: BUCHHALTUNG_BIS,
      dateiname: `susa-${f.kurzname.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-2026-q3.csv`,
      dateityp: "csv",
      format: "datev",
      groesse: datei.length,
      sha256: createHash("sha256").update(datei).digest("hex"),
      datei,
      status: "uebernommen",
      hochgeladenVon: "demo",
      hochgeladenAm: new Date("2026-10-05T08:00:00Z"),
      geprueftVon: "demo",
      geprueftAm: new Date("2026-10-05T08:10:00Z"),
      fehlerAnzahl: 0,
      warnungAnzahl: 0,
      summe: { konten: zeilen.length, saldensumme: "0.00", soll: euro(zeilen.filter((z) => z[2] > 0).reduce((s, z) => s + z[2], 0)), haben: euro(-zeilen.filter((z) => z[2] < 0).reduce((s, z) => s + z[2], 0)) },
      uebernommenVon: "demo",
      uebernommenAm: new Date("2026-10-05T09:00:00Z"),
    });
    zeilen.forEach(([konto, bezeichnung, c], n) =>
      aus.salden.push({ laufId, zeile: n + 2, kontoNummer: konto, bezeichnung, ebWert: "0.00", soll: c > 0 ? euro(c) : "0.00", haben: c < 0 ? euro(-c) : "0.00", saldo: euro(c) }),
    );
  });
  return aus;
}
