import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { SICHTEN, STANDARD_GLIEDERUNG, STANDARD_KONTEN, STANDARD_REGELN } from "@carraway/rechenkern";
import type { Db } from "../index";
import * as s from "../schema";
import type { DemoSprache } from "./texte";

/**
 * Demo-Daten für Dachfonds und Manager-Profil (alles erfunden): ein eigener Dachfonds mit drei Zielfondsbeteiligungen. Eine davon ist ein Fonds derselben
 * Installation (der Fonds mit dem jüngsten Auflagejahr; Durchrechnung über den gemeldeten Anteil), zwei sind fremde Zielfonds mit Abrufen, Ausschüttungen und
 * NAV-Meldungen. Dazu Investoren, zwei Kapitalabrufe mit Zahlungen und eine Saldenliste zum Quartalsende, damit der Dachfonds eine NAV hat. Der Dachfonds hat
 * das jüngste Auflagejahr und steht damit in allen Listen zuletzt; die übrigen Fonds und ihre Zahlen bleiben unverändert. Eigener Aufruf am Ende des Seeds
 * (`schreibeDemoDachfonds`), nicht Teil von `schreibeDemodaten`.
 */

const STICHTAG = "2026-09-30";

const festeId = (name: string): string => {
  const h = createHash("sha1").update(`demo:dachfonds:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export async function schreibeDemoDachfonds(db: Db, optionen: { sprache?: DemoSprache } = {}): Promise<{ fondsId: string; zielfonds: number } | null> {
  const de = (optionen.sprache ?? "de") === "de";
  // Zielfonds derselben Installation: der jüngste vorhandene Fonds (vor dem Dachfonds angelegt).
  const alle = await db.select().from(s.fonds).orderBy(asc(s.fonds.vintage), asc(s.fonds.name));
  const intern = alle.at(-1);
  if (!intern) return null;
  const investoren = await db.select({ id: s.organisation.id }).from(s.organisation).where(eq(s.organisation.art, "investor")).orderBy(asc(s.organisation.name)).limit(3);
  if (investoren.length === 0) return null;

  const fondsId = festeId("fonds");
  await db.transaction(async (tx) => {
    await tx.insert(s.managerProfil).values({ id: 1, name: de ? "Beispiel Kapitalverwaltung" : "Example Capital Management", hauswaehrung: "EUR" }).onConflictDoNothing();
    await tx.insert(s.fonds).values({ id: fondsId, name: de ? "Beispiel-Dachfonds" : "Example Fund of Funds", kurzname: "BF Dach", vintage: Math.max(2025, intern.vintage + 1), zeichnungskapital: "40000000.00", waehrung: "EUR" });

    // Investoren und Kapitalabrufe des Dachfonds (gleiche Anteile; die Zahlungen gehen vollständig ein).
    const zusagen = ["20000000.00", "12000000.00", "8000000.00"];
    const anteile = ["0.500000", "0.300000", "0.200000"];
    await tx.insert(s.fondsZeichnung).values(investoren.map((o, i) => ({ fondsId, organisationId: o.id, zusage: zusagen[i]!, anteil: anteile[i]! })));
    const abrufe = [
      { id: festeId("abruf-1"), valuta: "2025-03-14", betrag: "6000000.00" },
      { id: festeId("abruf-2"), valuta: "2026-02-13", betrag: "4000000.00" },
    ];
    await tx.insert(s.fondsBewegung).values(abrufe.map((a) => ({ id: a.id, fondsId, art: "abruf" as const, valuta: a.valuta, faelligAm: a.valuta, betrag: a.betrag, bemerkung: de ? "Kapitalabruf" : "Capital call" })));
    for (const a of abrufe) {
      const teile = anteile.map((q) => (Math.round(Number(a.betrag) * Number(q) * 100) / 100).toFixed(2));
      await tx.insert(s.abrufAnteil).values(investoren.map((o, i) => ({ bewegungId: a.id, organisationId: o.id, betrag: teile[i]! })));
      await tx.insert(s.lpZahlung).values(investoren.map((o, i) => ({ bewegungId: a.id, organisationId: o.id, valuta: a.valuta, betrag: teile[i]! })));
    }

    // Zielfonds: einer derselben Installation (Durchrechnung), zwei fremde (fortgeschriebene NAV-Meldungen).
    const zIntern = festeId("ziel-intern");
    const zNord = festeId("ziel-nord");
    const zAlpin = festeId("ziel-alpin");
    await tx.insert(s.zielfondsBeteiligung).values([
      { id: zIntern, fondsId, name: intern.name, zielfondsId: intern.id },
      { id: zNord, fondsId, name: de ? "Beispiel-Zielfonds Nord III" : "Example Target Fund North III" },
      { id: zAlpin, fondsId, name: de ? "Beispiel-Zielfonds Wachstum II" : "Example Target Fund Growth II" },
    ]);
    const b = (beteiligungId: string, art: "zusage" | "abruf" | "ausschuettung", valuta: string, betrag: string) => ({ beteiligungId, art, valuta, betrag, erfasstVon: "demo" });
    await tx.insert(s.zielfondsBewegung).values([
      b(zIntern, "zusage", "2025-02-01", "4000000.00"),
      b(zIntern, "abruf", "2025-04-01", "1200000.00"),
      b(zIntern, "abruf", "2026-03-02", "800000.00"),
      b(zNord, "zusage", "2025-01-20", "5000000.00"),
      b(zNord, "abruf", "2025-03-20", "1500000.00"),
      b(zNord, "abruf", "2025-11-03", "1000000.00"),
      b(zNord, "ausschuettung", "2026-06-15", "300000.00"),
      b(zNord, "abruf", "2026-08-17", "500000.00"),
      b(zAlpin, "zusage", "2025-05-05", "3000000.00"),
      b(zAlpin, "abruf", "2025-06-02", "900000.00"),
      b(zAlpin, "abruf", "2026-04-01", "600000.00"),
    ]);
    const m = (beteiligungId: string, stichtag: string, nav: string | null, anteil: string | null) => ({ beteiligungId, stichtag, nav, anteil, erfasstVon: "demo" });
    await tx.insert(s.zielfondsMeldung).values([
      m(zIntern, "2025-12-31", null, "0.1600000000"),
      m(zNord, "2025-12-31", "2610000.00", null),
      m(zNord, "2026-06-30", "2840000.00", null),
      m(zAlpin, "2025-12-31", "870000.00", null),
    ]);

    // Buchhaltung des Dachfonds: Standardgliederung und eine übernommene Saldenliste zum Quartalsende (Bank und Kapital).
    for (const sicht of SICHTEN) await tx.insert(s.gliederungPosition).values(STANDARD_GLIEDERUNG[sicht].map((p) => ({ fondsId, sicht, ...p })));
    await tx.insert(s.sachkonto).values(STANDARD_KONTEN.map((k) => ({ fondsId, ...k })));
    await tx.insert(s.kontenregel).values(STANDARD_REGELN.map((r) => ({ fondsId, sicht: r.sicht, kontoVon: r.von, kontoBis: r.bis, positionSchluessel: r.position, gueltigAb: "2020-01-01", erstelltVon: "demo" })));
    const eingezahlt = 1_000_000_000; // Cent: 10.000.000,00
    const anZielfonds = (120 + 80 + 150 + 100 + 50 + 90 + 60) * 1_000_000 - 30_000_000; // Abrufe minus Ausschüttung, Cent
    const kosten = 18_000_000;
    const bank = eingezahlt - anZielfonds - kosten;
    const zeilen: [string, string, number][] = [
      ["0100", de ? "Anteile an Zielfonds" : "Interests in target funds", anZielfonds],
      ["1200", "Bank", bank],
      ["2000", de ? "Kapitalanteile der Gesellschafter" : "Partners' capital", -eingezahlt],
      ["6300", de ? "Verwaltungskosten" : "Administrative expenses", kosten],
    ];
    const euro = (c: number) => (c / 100).toFixed(2);
    const komma = (c: number) => euro(Math.abs(c)).replace(".", ",");
    const csv = ["Konto;Kontobeschriftung;EB-Wert;EB-Wert S/H;Soll;Haben;Saldo;Saldo S/H", ...zeilen.map(([k, t, c]) => `${k};${t};0,00;S;${c > 0 ? komma(c) : "0,00"};${c < 0 ? komma(c) : "0,00"};${komma(c)};${c < 0 ? "H" : "S"}`)].join("\r\n");
    const datei = Buffer.from(csv, "latin1");
    const laufId = festeId("saldenlauf");
    await tx.insert(s.saldenlauf).values({
      id: laufId, fondsId, zeitraumVon: "2026-07-01", zeitraumBis: STICHTAG, dateiname: "susa-bf-dach-2026-q3.csv", dateityp: "csv", format: "datev",
      groesse: datei.length, sha256: createHash("sha256").update(datei).digest("hex"), datei, status: "uebernommen",
      hochgeladenVon: "demo", hochgeladenAm: new Date("2026-10-06T08:00:00Z"), geprueftVon: "demo", geprueftAm: new Date("2026-10-06T08:10:00Z"),
      fehlerAnzahl: 0, warnungAnzahl: 0,
      summe: { konten: zeilen.length, saldensumme: "0.00", soll: euro(zeilen.filter((z) => z[2] > 0).reduce((x, z) => x + z[2], 0)), haben: euro(-zeilen.filter((z) => z[2] < 0).reduce((x, z) => x + z[2], 0)) },
      uebernommenVon: "demo", uebernommenAm: new Date("2026-10-06T09:00:00Z"),
    });
    await tx.insert(s.saldo).values(zeilen.map(([konto, bezeichnung, c], n) => ({ laufId, zeile: n + 2, kontoNummer: konto, bezeichnung, ebWert: "0.00", soll: c > 0 ? euro(c) : "0.00", haben: c < 0 ? euro(-c) : "0.00", saldo: euro(c) })));
  });
  const anzahl = await db.select({ id: s.zielfondsBeteiligung.id }).from(s.zielfondsBeteiligung).where(and(eq(s.zielfondsBeteiligung.fondsId, fondsId)));
  return { fondsId, zielfonds: anzahl.length };
}
