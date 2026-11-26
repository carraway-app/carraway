import { eq } from "drizzle-orm";
import * as s from "@carraway/db";
import { STANDARD_GLIEDERUNG, STANDARD_KONTEN, STANDARD_REGELN, SICHTEN } from "@carraway/rechenkern";
import type { TestApp, Testperson } from "./hilfen-auth";

/** Gemeinsame Bausteine der Tests zu Belegen und Buchhaltung (Etappe 14). Alle Daten sind erfunden. */

type Db = ReturnType<typeof s.erstelleDb>["db"];

/** Konfiguration, Standardgliederung, Standardkontenrahmen und Regeln für einen Fonds direkt in der Datenbank. */
export async function buchhaltungAufsetzen(db: Db, fondsId: string, optionen: { regelnAb?: string } = {}) {
  await db.insert(s.fondsBuchhaltung).values({ fondsId, beraternummer: 1234567, mandantennummer: 12345, wirtschaftsjahrBeginn: 1, sachkontenlaenge: 4, belegpraefix: "B", geaendertVon: "test" }).onConflictDoNothing();
  for (const sicht of SICHTEN) await db.insert(s.gliederungPosition).values(STANDARD_GLIEDERUNG[sicht].map((p) => ({ fondsId, sicht, ...p })));
  await db.insert(s.sachkonto).values(STANDARD_KONTEN.map((k) => ({ fondsId, ...k })));
  await db.insert(s.kontenregel).values(STANDARD_REGELN.map((r) => ({ fondsId, sicht: r.sicht, kontoVon: r.von, kontoBis: r.bis, positionSchluessel: r.position, gueltigAb: optionen.regelnAb ?? "2020-01-01", erstelltVon: "test" })));
}

/** Zwei Mittelarten mit 60 und 40 Prozent ab 2020. */
export async function mittelartenAufsetzen(db: Db, fondsId: string) {
  await db.insert(s.fondsMittelart).values([
    { fondsId, schluessel: "landesmittel", bezeichnungDe: "Landesmittel", bezeichnungEn: "State funds", quote: "0.600000", gueltigAb: "2020-01-01" },
    { fondsId, schluessel: "eigenmittel", bezeichnungDe: "Eigenmittel", bezeichnungEn: "Own funds", quote: "0.400000", gueltigAb: "2020-01-01" },
  ]);
}

export const SUSA_KOPF = "Konto;Kontobeschriftung;EB-Wert;EB-Wert S/H;Soll;Haben;Saldo;Saldo S/H";

/** Ausgeglichene Saldenliste im DATEV-Profil (Soll 1.300,00 + 800,00 + 70,00 = Haben 1.000,00 + 120,00 + 1.050,00 … siehe `SUSA_SALDEN`). */
export const SUSA_SALDEN: [konto: string, bezeichnung: string, saldo: string][] = [
  ["0100", "Beteiligungen", "800.00"],
  ["0110", "Wertberichtigungen auf Beteiligungen", "-50.00"],
  ["1200", "Bank", "300.00"],
  ["2000", "Kapitalanteile der Gesellschafter", "-1000.00"],
  ["4200", "Zinserträge", "-120.00"],
  ["6300", "Verwaltungskosten", "70.00"],
];

const komma = (w: string) => w.replace(".", ",");

/** CSV im DATEV-Profil (Windows-1252, Semikolon, Dezimalkomma, S/H). */
export function susaCsv(salden: [string, string, string][] = SUSA_SALDEN): Buffer {
  const zeilen = salden.map(([k, b, saldo]) => {
    const betrag = komma(Math.abs(Number(saldo)).toFixed(2));
    return `${k};${b};0,00;S;${Number(saldo) > 0 ? betrag : "0,00"};${Number(saldo) < 0 ? betrag : "0,00"};${betrag};${Number(saldo) < 0 ? "H" : "S"}`;
  });
  return Buffer.from([SUSA_KOPF, ...zeilen].join("\r\n"), "latin1");
}

export const csvDatei = (inhalt: Buffer | string, name = "susa.csv") => new File([typeof inhalt === "string" ? Buffer.from(inhalt, "latin1") : inhalt], name, { type: "text/csv" });

/** Lädt eine Saldenliste hoch (multipart). */
export function ladeSusaHoch(t: TestApp, fondsId: string, datei: File, von: string, bis: string, als?: Testperson) {
  const formular = new FormData();
  formular.set("file", datei);
  formular.set("periodFrom", von);
  formular.set("periodTo", bis);
  return t.request(`/funds/${fondsId}/balance-runs`, { method: "POST", body: formular, ...(als ? { als } : {}) });
}

/** Geprüfte Zeilen mit der regulären Statusänderung übernehmen (einschließlich Zuordnung der Bilanzgruppen). */
export async function uebernehmeSalden(db: Db, fondsId: string, stichtag: string, konten: Record<string, string>, stand = new Date()) {
  const [lauf] = await db.insert(s.saldenlauf).values({
    fondsId, zeitraumVon: stichtag, zeitraumBis: stichtag, dateiname: "salden.csv", dateityp: "csv", groesse: 0,
    sha256: "0".repeat(64), datei: Buffer.alloc(0), status: "geprueft", hochgeladenVon: "eingabe",
  }).returning({ id: s.saldenlauf.id });
  const id = lauf!.id;
  await db.insert(s.saldo).values(Object.entries(konten).map(([kontoNummer, wert], i) => ({ laufId: id, zeile: i + 1, kontoNummer, saldo: wert })));
  await db.update(s.saldenlauf).set({ status: "uebernommen", uebernommenAm: stand, uebernommenVon: "freigabe" }).where(eq(s.saldenlauf.id, id));
  return id;
}
