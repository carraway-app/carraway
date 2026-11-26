import { eq, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { buchhaltungAufsetzen, csvDatei, ladeSusaHoch, SUSA_KOPF, susaCsv } from "./hilfen-buchhaltung";
import { aufrufe, grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";
import { erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const { post } = aufrufe(t);
const F1 = ID.fonds;
const F2 = ID.anderer;

const hochlader = person("e14-hochlader", { rollen: { [F1]: "bearbeiter" } });
const pruefer = person("e14-sp-pruefer", { rollen: { [F1]: "bearbeiter" } });
const uebernehmer = person("e14-uebernehmer", { rollen: { [F1]: "freigeber" } });
const betrachter = person("e14-sp-betrachter", { rollen: { [F1]: "betrachter" } });
const fremd = person("e14-sp-fremd", { rollen: { [F2]: "verwalter" } });

const anfrage = (methode: string, pfad: string, als: Testperson, body?: unknown) =>
  t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const lauf = async (datei: File | Buffer, von = "2026-07-01", bis = "2026-09-30", als: Testperson = hochlader) => {
  const antwort = await ladeSusaHoch(t, F1, datei instanceof File ? datei : csvDatei(datei), von, bis, als);
  expect(antwort.status).toBe(201);
  return (await json(antwort)) as { id: string };
};
const pruefen = async (id: string, als: Testperson = pruefer) => json(await anfrage("POST", `/saldenlaeufe/${id}/pruefen`, als));
const uebernehmen = (id: string, als: Testperson = uebernehmer) => anfrage("POST", `/saldenlaeufe/${id}/uebernehmen`, als);
/** Hochladen, prüfen, übernehmen. */
async function bereit(datei: Buffer = susaCsv(), von = "2026-07-01", bis = "2026-09-30") {
  const l = await lauf(datei, von, bis);
  const p = await pruefen(l.id);
  expect(p.status, JSON.stringify(p)).toBe("geprueft");
  expect((await uebernehmen(l.id)).status).toBe(200);
  return l.id;
}
const befunde = async (id: string) => (await json(await anfrage("GET", `/saldenlaeufe/${id}`, betrachter))).befunde as { code: string; schweregrad: string; zeile: number | null; params: Record<string, unknown> }[];

beforeEach(async () => {
  await grundbestand(db);
  await buchhaltungAufsetzen(db, F1);
  for (const p of [hochlader, pruefer, uebernehmer, betrachter, fremd]) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Hochladen und Prüfen", () => {
  it("Rechte, Dateityp, Zeitraum", async () => {
    const hoch = (p: Testperson, datei: File | null, von = "2026-07-01", bis = "2026-09-30") => {
      const f = new FormData();
      if (datei) f.set("datei", datei);
      f.set("zeitraumVon", von);
      f.set("zeitraumBis", bis);
      return t.request(`/fonds/${F1}/saldenlaeufe`, { method: "POST", body: f, als: p });
    };
    expect((await hoch(betrachter, csvDatei(susaCsv()))).status).toBe(403);
    expect((await hoch(fremd, csvDatei(susaCsv()))).status).toBe(403);
    expect((await json(await hoch(hochlader, null))).fehler.code).toBe("DATEI_FEHLT");
    const pdf = await hoch(hochlader, new File([Buffer.from("%PDF-1.7 abc")], "x.pdf"));
    expect(pdf.status).toBe(415);
    expect((await hoch(hochlader, csvDatei(susaCsv()), "2026-10-01", "2026-09-30")).status).toBe(400);
    expect((await hoch(hochlader, csvDatei(susaCsv()), "2025-01-01", "2026-12-31")).status).toBe(400);
    expect((await hoch(hochlader, csvDatei(susaCsv()), "kein-datum", "2026-09-30")).status).toBe(400);
    const ok = await hoch(hochlader, csvDatei(susaCsv()));
    expect(ok.status).toBe(201);
    const neu = await json(ok);
    expect(neu).toMatchObject({ status: "hochgeladen", zeitraumVon: "2026-07-01", zeitraumBis: "2026-09-30", hochgeladenVon: expect.any(String) });
    expect(neu.datei).toBeUndefined();
    expect(neu.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await protokollZeilen(db, "saldenlauf", "hochladen")).length).toBe(1);
  });

  it("liest Windows-1252 mit Dezimalkomma und S/H: Umlaute und Salden stimmen, Summe ist null", async () => {
    const l = await lauf(susaCsv());
    const p = await pruefen(l.id);
    expect(p).toMatchObject({ status: "geprueft", fehlerAnzahl: 0, warnungAnzahl: 0, format: "datev", summe: { konten: 6, saldensumme: "0.00", soll: "1170.00", haben: "1170.00" } });
    const salden = (await json(await anfrage("GET", `/saldenlaeufe/${l.id}/salden`, betrachter))).daten;
    expect(salden.map((x: { konto: string; saldo: string }) => [x.konto, x.saldo])).toEqual([["0100", "800.00"], ["0110", "-50.00"], ["1200", "300.00"], ["2000", "-1000.00"], ["4200", "-120.00"], ["6300", "70.00"]]);
    expect(salden.find((x: { konto: string }) => x.konto === "4200").bezeichnung).toBe("Zinserträge");
    // Prüfen darf der Hochladende auch selbst; die Übernahme nicht
    expect((await json(await uebernehmen(l.id, hochlader))).fehler.code).toBe("KEINE_BERECHTIGUNG");
  });

  it("Saldensumme ungleich null ist ein Fehler, unbekannte Konten und Konten ohne Regel sind Befunde", async () => {
    const ungleich = await lauf(susaCsv([["1200", "Bank", "100.00"], ["2000", "Kapital", "-99.99"]]));
    const p = await pruefen(ungleich.id);
    expect(p).toMatchObject({ status: "hochgeladen", fehlerAnzahl: 1 });
    expect((await befunde(ungleich.id)).map((b) => [b.code, b.schweregrad, b.params.summe])).toContainEqual(["SUSA_SALDENSUMME_UNGLEICH_NULL", "fehler", "0.01"]);
    expect((await uebernehmen(ungleich.id)).status).toBe(409);
    const salden = await db.select().from(s.saldo).where(eq(s.saldo.laufId, ungleich.id));
    expect(salden).toHaveLength(0); // bei Fehlern werden keine Salden übernommen

    const unbekannt = await lauf(susaCsv([["1200", "Bank", "100.00"], ["2000", "Kapital", "-105.00"], ["7000", "Unbekannt A", "5.00"]]));
    const q = await pruefen(unbekannt.id);
    expect(q).toMatchObject({ status: "geprueft", fehlerAnzahl: 0, warnungAnzahl: 2 });
    const b = await befunde(unbekannt.id);
    expect(b.map((x) => x.code).sort()).toEqual(["SUSA_KONTO_OHNE_REGEL", "SUSA_KONTO_UNBEKANNT"]);
    expect(b.find((x) => x.code === "SUSA_KONTO_UNBEKANNT")).toMatchObject({ schweregrad: "warnung", zeile: 4, params: { konto: "7000", saldo: "5.00" } });
  });

  it("Dateifehler: doppelte Konten, ungültige Beträge, abweichender Saldo, fehlende Spalte; keine Zeilen werden stillschweigend verschluckt", async () => {
    const csv = [SUSA_KOPF, "1200;Bank;0,00;S;100,00;0,00;100,00;S", "1200;Bank doppelt;0,00;S;1,00;0,00;1,00;S", "1300;Kasse;0,00;S;abc;0,00;1,00;S", "1400;Falsch;0,00;S;10,00;0,00;99,00;S", "xx;Konto;0,00;S;1,00;0,00;1,00;S"].join("\r\n");
    const l = await lauf(Buffer.from(csv, "latin1"));
    const p = await pruefen(l.id);
    expect(p.status).toBe("hochgeladen");
    expect((await befunde(l.id)).map((b) => b.code).sort()).toEqual(["SUSA_BETRAG_UNGUELTIG", "SUSA_KONTO_DOPPELT", "SUSA_KONTO_UNGUELTIG", "SUSA_SALDENSUMME_UNGLEICH_NULL", "SUSA_SALDO_ABWEICHEND"].sort());
    const ohneSpalte = await lauf(Buffer.from("Bezeichnung;Saldo\nBank;1,00\n", "latin1"));
    await pruefen(ohneSpalte.id);
    expect((await befunde(ohneSpalte.id)).map((b) => b.code)).toContain("SUSA_SPALTE_FEHLT");
  });

  it("Excel und das generische Format; eine kaputte Excel-Datei und eine Zip-Bombe werden abgelehnt", async () => {
    const wb = new ExcelJS.Workbook();
    const blatt = wb.addWorksheet("SuSa");
    blatt.addRow(["Konto", "Bezeichnung", "Saldo"]);
    blatt.addRow([1200, "Bank", 100.5]);
    blatt.addRow([2000, "Kapital", -100.5]);
    const xlsx = new File([Buffer.from(await wb.xlsx.writeBuffer())], "susa.xlsx");
    const l = await lauf(xlsx);
    expect(await pruefen(l.id)).toMatchObject({ status: "geprueft", format: "generisch", summe: { konten: 2, saldensumme: "0.00" } });
    const kaputt = await lauf(new File([Buffer.from("PK\u0003\u0004kaputt-aber-mit-zip-kennung")], "k.xlsx"));
    const antwort = await anfrage("POST", `/saldenlaeufe/${kaputt.id}/pruefen`, pruefer);
    expect([415, 422]).toContain(antwort.status);
    expect(["IMPORT_DATEI_UNLESBAR", "DATEITYP_UNBEKANNT"]).toContain((await json(antwort)).fehler.code);
  });
});

describe("Übernehmen: Vier-Augen, Ersetzen und Verlauf", () => {
  it("Übernahme nur nach fehlerfreier Prüfung durch eine andere Person als Hochladende und Prüfende, mit Rolle Freigeber", async () => {
    const l = await lauf(susaCsv());
    expect((await json(await uebernehmen(l.id))).fehler.code).toBe("SALDENLAUF_NICHT_GEPRUEFT");
    await pruefen(l.id);
    expect((await json(await uebernehmen(l.id, pruefer))).fehler.code).toBe("KEINE_BERECHTIGUNG"); // Bearbeiter
    const selbst = person("e14-selbst", { rollen: { [F1]: "freigeber" } });
    await legePersonAn(db, selbst);
    const l2 = await lauf(susaCsv(), "2026-10-01", "2026-12-31", selbst);
    await pruefen(l2.id, pruefer);
    expect((await json(await uebernehmen(l2.id, selbst))).fehler.code).toBe("VIER_AUGEN_VERLETZT"); // hochgeladen von selbst
    const pruefenderFreigeber = person("e14-pf", { rollen: { [F1]: "freigeber" } });
    await legePersonAn(db, pruefenderFreigeber);
    const l3 = await lauf(susaCsv(), "2027-01-01", "2027-03-31");
    await pruefen(l3.id, pruefenderFreigeber);
    expect((await json(await uebernehmen(l3.id, pruefenderFreigeber))).fehler.code).toBe("VIER_AUGEN_VERLETZT"); // geprüft von derselben Person
    const ok = await json(await uebernehmen(l.id));
    expect(ok).toMatchObject({ status: "uebernommen", uebernommenVon: expect.any(String) });
    expect((await json(await uebernehmen(l.id))).fehler.code).toBe("SALDENLAUF_BEREITS_UEBERNOMMEN");
    expect((await json(await anfrage("POST", `/saldenlaeufe/${l.id}/pruefen`, pruefer))).fehler.code).toBe("SALDENLAUF_BEREITS_UEBERNOMMEN");
    expect((await protokollZeilen(db, "saldenlauf")).map((z) => z.aktion)).toEqual(expect.arrayContaining(["hochladen", "pruefen", "uebernehmen"]));
  });

  it("dieselbe Periode ersetzt die frühere Liste, die Fassung bleibt erhalten; die Auswertung folgt der neuen", async () => {
    const alt = await bereit(susaCsv());
    const neueSalden: [string, string, string][] = [["0100", "Beteiligungen", "900.00"], ["1200", "Bank", "100.00"], ["2000", "Kapital", "-1000.00"]];
    const neu = await lauf(susaCsv(neueSalden));
    const p = await pruefen(neu.id);
    expect(p.status).toBe("geprueft");
    expect((await befunde(neu.id)).map((b) => b.code)).toContain("SUSA_ERSETZT_VORHANDENE");
    expect((await uebernehmen(neu.id)).status).toBe(200);
    const laeufe = (await json(await anfrage("GET", `/fonds/${F1}/saldenlaeufe`, betrachter))).daten;
    expect(laeufe).toHaveLength(2);
    const [vorher] = await db.select().from(s.saldenlauf).where(eq(s.saldenlauf.id, alt));
    expect(vorher).toMatchObject({ status: "uebernommen", ersetztVonLaufId: neu.id });
    expect(vorher!.ersetztAm).not.toBeNull();
    expect((await db.select().from(s.saldo).where(eq(s.saldo.laufId, alt))).length).toBe(6); // Historie unverändert
    const perioden = (await json(await anfrage("GET", `/fonds/${F1}/perioden`, betrachter))).daten;
    expect(perioden.map((x: { laufId: string }) => x.laufId)).toEqual([neu.id]);
    const aktiv = await json(await anfrage("GET", `/fonds/${F1}/auswertung/bilanz?bis=2026-09-30`, betrachter));
    expect(aktiv.lauf.id).toBe(neu.id);
    expect(aktiv.zeilen.find((z: { schluessel: string }) => z.schluessel === "aktiva").wert).toBe("1000.00");
    expect((await protokollZeilen(db, "saldenlauf", "ersetzen")).length).toBe(1);
  });

  it("andere, überlappende Zeiträume sind ein Fehler; angrenzende Zeiträume gehen", async () => {
    await bereit(susaCsv(), "2026-07-01", "2026-09-30");
    const ueberlappt = await lauf(susaCsv(), "2026-09-01", "2026-12-31");
    expect((await pruefen(ueberlappt.id)).status).toBe("hochgeladen");
    expect((await befunde(ueberlappt.id)).map((b) => [b.code, b.schweregrad])).toContainEqual(["SUSA_ZEITRAUM_UEBERLAPPT", "fehler"]);
    const anschluss = await lauf(susaCsv(), "2026-10-01", "2026-12-31");
    expect((await pruefen(anschluss.id)).status).toBe("geprueft");
    expect((await uebernehmen(anschluss.id)).status).toBe(200);
  });

  it("zwei gleichzeitige Übernahmen derselben Periode: genau eine Liste bleibt gültig", async () => {
    const a = await lauf(susaCsv());
    const b = await lauf(susaCsv());
    await pruefen(a.id);
    await pruefen(b.id);
    const antworten = await Promise.all([uebernehmen(a.id), uebernehmen(b.id)]);
    expect(antworten.map((x) => x.status)).toEqual([200, 200]);
    const gueltig = await db.select().from(s.saldenlauf).where(sql`${s.saldenlauf.status} = 'uebernommen' AND ${s.saldenlauf.ersetztAm} IS NULL`);
    expect(gueltig).toHaveLength(1);
  });
});

describe("Auswertungen aus Saldenliste und Kontenregeln", () => {
  it("Bilanz, GuV, Liquidität, Mittelverwendung und Portfolio stimmen mit einer unabhängigen SQL-Rechnung überein", async () => {
    const id = await bereit();
    const summe = async (von: string, bis: string) => Number((await db.execute(sql`SELECT coalesce(sum(saldo), 0)::float AS s FROM saldo WHERE lauf_id = ${id} AND konto_nummer BETWEEN ${von} AND ${bis}`)).rows[0]!.s);
    const sicht = async (name: string) => json(await anfrage("GET", `/fonds/${F1}/auswertung/${name}?bis=2026-09-30`, betrachter));
    const wert = (a: { zeilen: { schluessel: string; wert: string }[] }, k: string) => Number(a.zeilen.find((z) => z.schluessel === k)!.wert);

    const bilanz = await sicht("bilanz");
    const aktiva = (await summe("0100", "0119")) + (await summe("0150", "0199")) + (await summe("1200", "1299")) + (await summe("1400", "1499"));
    const passiva = -(await summe("2000", "2999")) - (await summe("3000", "3999")) - (await summe("4000", "6999"));
    expect(wert(bilanz, "aktiva")).toBe(aktiva);
    expect(wert(bilanz, "passiva")).toBe(passiva);
    expect(aktiva).toBe(1050);
    expect(wert(bilanz, "aktiva")).toBe(wert(bilanz, "passiva")); // Die Bilanz geht auf
    expect(wert(bilanz, "passiva.ergebnis")).toBe(50);
    expect(bilanz.nichtZugeordnet).toEqual([]);

    const guv = await sicht("guv");
    expect(wert(guv, "guv.ertraege")).toBe(-(await summe("4000", "4999")));
    expect(wert(guv, "guv.aufwendungen")).toBe(await summe("6000", "6999"));
    expect(wert(guv, "guv.ergebnis")).toBe(50);
    expect(wert(guv, "guv.ergebnis")).toBe(wert(bilanz, "passiva.ergebnis"));
    expect(wert(await sicht("liquiditaet"), "liq.verfuegbar")).toBe(300);
    const mv = await sicht("mittelverwendung");
    expect(wert(mv, "mv.herkunft")).toBe(1000 + 120);
    expect(wert(mv, "mv.verwendung")).toBe(750 + 70 - 0);
    expect(wert(await sicht("portfolio"), "pf.portfolio")).toBe(750);
  });

  it("Herkunft je Zeile: Konten, Salden und Regel; Konten ohne Regel erscheinen als nicht zugeordnet statt zu fehlen", async () => {
    const id = await bereit(susaCsv([...[["0100", "Beteiligungen", "800.00"], ["0110", "Wertberichtigungen", "-50.00"], ["1200", "Bank", "300.00"], ["2000", "Kapital", "-1050.00"]] as [string, string, string][], ["7000", "Sonstiges", "5.00"], ["7001", "Sonstiges Gegenkonto", "-5.00"]]));
    const bilanz = await json(await anfrage("GET", `/fonds/${F1}/auswertung/bilanz?bis=2026-09-30`, betrachter));
    const zeile = bilanz.zeilen.find((z: { schluessel: string }) => z.schluessel === "aktiva.beteiligungen");
    const regelDb = (await db.select().from(s.kontenregel).where(eq(s.kontenregel.positionSchluessel, "aktiva.beteiligungen")))[0]!;
    expect(zeile.konten).toEqual([
      { konto: "0100", bezeichnung: "Beteiligungen", saldo: "800.00", regelId: regelDb.id, beitrag: "800.00" },
      { konto: "0110", bezeichnung: "Wertberichtigungen", saldo: "-50.00", regelId: regelDb.id, beitrag: "-50.00" },
    ]);
    expect(zeile.schritte.map((x: { zeichen: string; wert: string }) => `${x.zeichen}${x.wert}`)).toEqual(["+800.00", "−50.00", "=750.00"]);
    expect(zeile.schritte[0].quellen).toEqual([regelDb.id]);
    expect(bilanz.nichtZugeordnet).toEqual([{ konto: "7000", bezeichnung: "Sonstiges", saldo: "5.00" }, { konto: "7001", bezeichnung: "Sonstiges Gegenkonto", saldo: "-5.00" }]);
    expect(bilanz.zeilen.find((z: { schluessel: string }) => z.schluessel === "aktiva").schritte.at(-1).wert).toBe("1050.00");
    expect(id).toBeTruthy();
  });

  it("Regeln sind je Periode versioniert: eine später beginnende Regel gilt für frühere Zeiträume nicht", async () => {
    await db.update(s.kontenregel).set({ gueltigAb: "2026-10-01" }).where(eq(s.kontenregel.sicht, "bilanz"));
    await bereit();
    const bilanz = await json(await anfrage("GET", `/fonds/${F1}/auswertung/bilanz?bis=2026-09-30`, betrachter));
    expect(bilanz.zeilen.find((z: { schluessel: string }) => z.schluessel === "aktiva").wert).toBe("0.00");
    expect(bilanz.nichtZugeordnet).toHaveLength(6);
    const guv = await json(await anfrage("GET", `/fonds/${F1}/auswertung/guv?bis=2026-09-30`, betrachter));
    expect(guv.zeilen.find((z: { schluessel: string }) => z.schluessel === "guv.ergebnis").wert).toBe("50.00");
  });

  it("ohne übernommene Liste: 409 SALDENLISTE_FEHLT; Rechte; fremder Fonds", async () => {
    const a = await anfrage("GET", `/fonds/${F1}/auswertung/bilanz?bis=2026-09-30`, betrachter);
    expect(a.status).toBe(409);
    expect((await json(a)).fehler.code).toBe("SALDENLISTE_FEHLT");
    await lauf(susaCsv()); // hochgeladen, nicht übernommen: zählt nicht
    expect((await anfrage("GET", `/fonds/${F1}/auswertung/bilanz?bis=2026-09-30`, betrachter)).status).toBe(409);
    expect((await anfrage("GET", `/fonds/${F1}/auswertung/bilanz?bis=2026-09-30`, fremd)).status).toBe(403);
    expect((await anfrage("GET", `/fonds/${F1}/auswertung/unbekannt?bis=2026-09-30`, betrachter)).status).toBe(400);
  });
});

describe("Abstimmung gegen die Plattform", () => {
  async function aufsetzen() {
    // Alpha (offene Beteiligung): 500.000 investiert, 100.000 wertberichtigt = Buchwert 400.000; Beta (Darlehen): 100.000 = Buchwert 100.000
    await post(`/beteiligungen/${ID.eigen}/vorgaenge`, { art: "zusage", valuta: "2025-01-01", betrag: "1000000" });
    await post(`/beteiligungen/${ID.eigen}/vorgaenge`, { art: "auszahlung", valuta: "2025-02-01", betrag: "500000" });
    await post(`/beteiligungen/${ID.eigen}/vorgaenge`, { art: "wertberichtigung", valuta: "2025-12-31", betrag: "100000" });
    await post(`/beteiligungen/${ID.darlehen}/vorgaenge`, { art: "zusage", valuta: "2026-01-01", betrag: "200000" });
    await post(`/beteiligungen/${ID.darlehen}/vorgaenge`, { art: "auszahlung", valuta: "2026-01-01", betrag: "100000" });
    await db.insert(s.fondsBewegung).values([{ fondsId: F1, art: "abruf", valuta: "2026-02-01", betrag: "700000.00" }, { fondsId: F1, art: "ausschuettung", valuta: "2026-08-01", betrag: "10000.00" }]);
    await db.update(s.sachkonto).set({ beteiligungId: ID.eigen }).where(eq(s.sachkonto.nummer, "0100"));
    await db.update(s.sachkonto).set({ beteiligungId: ID.darlehen }).where(eq(s.sachkonto.nummer, "0150"));
    await bereit(susaCsv([["0100", "Beteiligungen", "400000.00"], ["0150", "Ausleihungen", "90000.00"], ["1200", "Bank", "10000.00"], ["2000", "Kapital", "-500000.00"]]));
  }

  it("Portfolio: Differenzen je verknüpftem Konto und im Gesamtvergleich, nachvollziehbar gerechnet", async () => {
    await aufsetzen();
    const a = await json(await anfrage("GET", `/fonds/${F1}/abstimmung?bis=2026-09-30`, betrachter));
    expect(a.portfolio.gesamt).toMatchObject({ carraway: "500000.00", buchhaltung: "490000.00", differenz: "10000.00" });
    const zeilen = a.portfolio.zeilen as { bezeichnung: string; carraway: string; buchhaltung: string; differenz: string }[];
    expect(zeilen.map((z) => [z.bezeichnung, z.carraway, z.buchhaltung, z.differenz])).toEqual([
      ["Alpha Beispiel (offene_beteiligung)", "400000.00", "400000.00", "0.00"],
      ["Beta Beispiel (darlehen)", "100000.00", "90000.00", "10000.00"],
    ]);
    expect(a.portfolio.ohneKonto).toEqual([]);
    expect(a.portfolio.gesamt.schritte.at(-1)).toMatchObject({ zeichen: "=", wert: "10000.00" });
    // Verknüpfung entfernen: die Beteiligung steht dann unter „ohne Konto“
    await db.update(s.sachkonto).set({ beteiligungId: null }).where(eq(s.sachkonto.nummer, "0150"));
    const b = await json(await anfrage("GET", `/fonds/${F1}/abstimmung?bis=2026-09-30`, betrachter));
    expect(b.portfolio.ohneKonto).toEqual([{ beteiligungId: ID.darlehen, bezeichnung: "Beta Beispiel (darlehen)", buchwert: "100000.00" }]);
  });

  it("Liquidität: Zahlungsstrom der Plattform gegen das Bankguthaben, Differenz mit Rechenweg", async () => {
    await aufsetzen();
    const a = await json(await anfrage("GET", `/fonds/${F1}/abstimmung?bis=2026-09-30`, betrachter));
    // Abrufe 700.000 − Ausschüttungen 10.000 − Auszahlungen 600.000 = 90.000 gegen Bank 10.000
    expect(a.liquiditaet).toMatchObject({ carraway: "90000.00", buchhaltung: "10000.00", differenz: "80000.00" });
    expect(a.liquiditaet.schritte.map((x: { zeichen: string; wert: string }) => `${x.zeichen}${x.wert}`)).toEqual(["700000.00", "−10000.00", "−600000.00", "+0.00", "+0.00", "+0.00", "+0.00", "=90000.00", "−10000.00", "=80000.00"]);
  });

  it("Export: PDF und Excel in beiden Sprachen, nur ab Bearbeiter, mit Zeile `gelesen` im Protokoll", async () => {
    await aufsetzen();
    const pfad = (sicht: string, q = "") => `/fonds/${F1}/auswertung/${sicht}/datei?bis=2026-09-30${q}`;
    expect((await anfrage("GET", pfad("bilanz"), betrachter)).status).toBe(403);
    const pdf = await anfrage("GET", pfad("bilanz"), hochlader);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
    const xlsx = await anfrage("GET", pfad("portfolio", "&format=xlsx&sprache=en"), hochlader);
    expect(xlsx.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()) as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Portfolio", "Origin of the lines", "Unassigned accounts", "Reconciliation"]);
    const blatt = wb.getWorksheet("Portfolio")!;
    expect(blatt.getRow(2).getCell(1).value).toBe("Portfolio at book value");
    expect(blatt.getRow(2).getCell(2).value).toBe(490000);
    const abst = wb.getWorksheet("Reconciliation")!;
    expect(abst.getRow(2).getCell(4).value).toBe(10000);
    expect((await protokollZeilen(db, "saldenlauf", "gelesen")).length).toBe(2);
    expect((await anfrage("GET", pfad("bilanz"), fremd)).status).toBe(403);
  });
});
