import { buchhaltungAufsetzen, uebernehmeSalden } from "./hilfen-buchhaltung";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Decimal, multiples, xirr } from "@carraway/rechenkern";
import * as s from "@carraway/db";
import { erstelleTestApp } from "./hilfen-auth";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { vorgaengeEinfuegen } from "./instrument-hilfen";

const { db, pool } = oeffneTestdb();
const app = erstelleTestApp(db);

const ID = {
  f1: "00000000-0000-4000-8000-0000000000f1",
  f2: "00000000-0000-4000-8000-0000000000f2",
  orgA: "00000000-0000-4000-8000-00000000000a",
  orgB: "00000000-0000-4000-8000-00000000000b",
  orgC: "00000000-0000-4000-8000-00000000000c",
  orgI: "00000000-0000-4000-8000-0000000000a1",
  b1: "00000000-0000-4000-8000-0000000000b1",
  b2: "00000000-0000-4000-8000-0000000000b2",
  b3: "00000000-0000-4000-8000-0000000000b3",
  b4: "00000000-0000-4000-8000-0000000000b4",
  v2falsch: "00000000-0000-4000-8000-0000000000d1",
};
const FREMD = "00000000-0000-4000-8000-0000000000ff";

const uebersicht = (fonds: string, stichtag?: string) =>
  app.request(`/api/v1/fonds/${fonds}/uebersicht${stichtag ? `?stichtag=${stichtag}` : ""}`);

beforeAll(async () => {
  await leeren(db);
  await db.insert(s.organisation).values([
    { id: ID.orgA, name: "Alpha Beispiel", art: "unternehmen", sektor: "Software" },
    { id: ID.orgB, name: "Beta Beispiel", art: "unternehmen", sektor: "Energie" },
    { id: ID.orgC, name: "Gamma Beispiel", art: "unternehmen", sektor: "Medizin" },
    { id: ID.orgI, name: "Investor_100% Beispiel", art: "investor" },
  ]);
  await db.insert(s.person).values({ vorname: "Erika", nachname: "Muster", organisationId: ID.orgA, funktion: "Geschäftsführung" });
  await db.insert(s.fonds).values([
    { id: ID.f1, name: "Testfonds Eins", kurzname: "TF1", vintage: 2022, zeichnungskapital: "10000000.00" },
    { id: ID.f2, name: "Testfonds Zwei", kurzname: "TF2", vintage: 2024, zeichnungskapital: "5000000.00" },
  ]);
  await db.insert(s.beteiligung).values([
    { id: ID.b1, fondsId: ID.f1, organisationId: ID.orgA, instrument: "offene_beteiligung", erstinvestment: "2023-01-01" },
    { id: ID.b2, fondsId: ID.f1, organisationId: ID.orgB, instrument: "darlehen", erstinvestment: "2023-03-01" },
    { id: ID.b3, fondsId: ID.f1, organisationId: ID.orgC, instrument: "offene_beteiligung", erstinvestment: "2023-01-01", status: "exit" },
    { id: ID.b4, fondsId: ID.f2, organisationId: ID.orgA, instrument: "offene_beteiligung", erstinvestment: "2024-02-01" },
  ]);
  const v = (beteiligungId: string, art: s.Vorgang["art"], valuta: string, betrag: string, extra: Partial<s.NeuerVorgang> = {}) => ({
    beteiligungId,
    art,
    valuta,
    betrag,
    ...extra,
  });
  await vorgaengeEinfuegen(db, [
    v(ID.b1, "zusage", "2023-01-01", "1000000.00"),
    v(ID.b1, "auszahlung", "2023-02-01", "400000.00"),
    v(ID.b1, "auszahlung", "2024-06-01", "200000.00"),
    v(ID.b2, "zusage", "2023-03-01", "500000.00"),
    v(ID.b2, "auszahlung", "2023-04-01", "300000.00", { id: ID.v2falsch }),
    v(ID.b2, "auszahlung", "2023-04-05", "-300000.00", { storniertVorgangId: ID.v2falsch }),
    v(ID.b2, "auszahlung", "2023-04-05", "250000.00"),
    v(ID.b2, "zins", "2023-12-31", "15000.00"),
    v(ID.b3, "zusage", "2023-01-01", "600000.00"),
    v(ID.b3, "auszahlung", "2023-02-01", "300000.00"),
    v(ID.b3, "rueckfluss", "2024-03-01", "900000.00"),
    v(ID.b4, "zusage", "2024-02-01", "200000.00"),
    v(ID.b4, "auszahlung", "2024-03-01", "100000.00"),
  ]);
  const w = (beteiligungId: string, stichtag: string, wert: string) => ({ beteiligungId, stichtag, wert, methode: "letzte_runde" as const, status: "freigegeben" as const });
  await db.insert(s.bewertung).values([
    w(ID.b1, "2023-03-31", "450000.00"),
    w(ID.b1, "2023-12-31", "500000.00"),
    w(ID.b1, "2024-06-30", "700000.00"),
    w(ID.b2, "2023-06-30", "260000.00"),
    w(ID.b3, "2023-12-31", "350000.00"),
    w(ID.b4, "2024-06-30", "120000.00"),
  ]);
  const bewegungen = await db.insert(s.fondsBewegung).values([
    { fondsId: ID.f1, art: "abruf", valuta: "2023-01-15", betrag: "600000.00" },
    { fondsId: ID.f1, art: "abruf", valuta: "2023-04-10", betrag: "400000.00" },
    { fondsId: ID.f1, art: "abruf", valuta: "2024-07-01", betrag: "200000.00" },
    { fondsId: ID.f1, art: "ausschuettung", valuta: "2024-03-15", betrag: "900000.00" },
  ]).returning();
  for (const b of bewegungen.filter((b) => b.art === "abruf")) {
    const anteil = { bewegungId: b.id, organisationId: ID.orgI, betrag: b.betrag };
    await db.insert(s.abrufAnteil).values(anteil);
    await db.insert(s.lpZahlung).values({ ...anteil, valuta: b.valuta });
  }
  await buchhaltungAufsetzen(db, ID.f1);
  await uebernehmeSalden(db, ID.f1, "2023-12-31", { "1200": "0.00" });
  await uebernehmeSalden(db, ID.f1, "2024-06-30", { "1200": "0.00" });
  await db.insert(s.deal).values([
    { organisationId: ID.orgA, titel: "Runde A", phase: "pruefung", status: "offen", ticket: "1000000.00", betreuung: "Person X", quelle: "Empfehlung" },
    { organisationId: ID.orgB, titel: "Runde B", phase: "anfrage", status: "abgesagt", absagegrund: "Passt nicht" },
    { organisationId: ID.orgC, titel: "Runde C", phase: "closing", status: "investiert" },
  ]);
});

afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Allgemein", () => {
  it("Gesundheit meldet die Datenbank", async () => {
    const antwort = await app.request("/api/v1/gesundheit");
    expect(antwort.status).toBe(200);
    expect(await json(antwort)).toMatchObject({ ok: true, datenbank: true, worker: { status: expect.any(String) } });
  });

  it("jede Antwort trägt Server-Timing", async () => {
    for (const pfad of ["/api/v1/gesundheit", "/api/v1/fonds", "/api/v1/gibt-es-nicht", `/api/v1/fonds/${ID.f1}/uebersicht?stichtag=kaputt`]) {
      const antwort = await app.request(pfad);
      expect(antwort.headers.get("Server-Timing"), pfad).toMatch(/^app;dur=\d+(\.\d+)?$/);
    }
  });

  it("außerhalb von /api/v1 gibt es 404 im Fehlerformat; unbekannte Pfade darin sind verschlossen (401 ohne, 403 mit Anmeldung)", async () => {
    for (const pfad of ["/", "/api/v2/fonds"]) {
      const antwort = await app.app.request(pfad);
      expect(antwort.status).toBe(404);
      expect(antwort.headers.get("content-type")).toContain("application/json");
      expect(await json(antwort)).toEqual({ fehler: { code: "NICHT_GEFUNDEN", meldung: expect.any(String) } });
    }
    const anonym = await app.request("/api/v1/gibt-es-nicht", { als: null });
    expect(anonym.status).toBe(401);
    expect((await json(anonym)).fehler.code).toBe("NICHT_ANGEMELDET");
    const angemeldet = await app.request("/api/v1/gibt-es-nicht");
    expect(angemeldet.status).toBe(403);
    expect((await json(angemeldet)).fehler.code).toBe("KEINE_BERECHTIGUNG");
  });

  it("statement_timeout gilt nur innerhalb der Transaktion", async () => {
    const lang = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = 50`);
      return tx.execute(sql`SELECT pg_sleep(1)`).then(
        () => "kein Abbruch",
        (e: { cause?: { code?: string }; code?: string }) => e.cause?.code ?? e.code,
      );
    });
    expect(lang).toBe("57014");
    const { rows } = await db.execute<{ statement_timeout: string }>(sql`SHOW statement_timeout`);
    expect(rows[0]?.statement_timeout).toBe("0");
  });
});

describe("GET /fonds", () => {
  it("listet die Fonds mit den vereinbarten Feldern", async () => {
    const antwort = await app.request("/api/v1/fonds");
    expect(antwort.status).toBe(200);
    const { daten } = await json(antwort);
    expect(daten).toEqual([
      { id: ID.f1, name: "Testfonds Eins", kurzname: "TF1", vintage: 2022, zeichnungskapital: "10000000.00", waehrung: "EUR" },
      { id: ID.f2, name: "Testfonds Zwei", kurzname: "TF2", vintage: 2024, zeichnungskapital: "5000000.00", waehrung: "EUR" },
    ]);
  });
});

describe("GET /fonds/:id/uebersicht", () => {
  it("liefert Form, Kennzahlen als Zeichenketten und Herkunft", async () => {
    const antwort = await uebersicht(ID.f1, "2023-12-31");
    expect(antwort.status).toBe(200);
    const k = await json(antwort);
    expect(k.stichtag).toBe("2023-12-31");
    for (const name of ["abgerufen", "ausschuettungen", "nav", "tvpi", "dpi", "rvpi", "irr"]) {
      const kennzahl = k.kennzahlen[name];
      expect(kennzahl.wert === null || typeof kennzahl.wert === "string", name).toBe(true);
      expect(Array.isArray(kennzahl.schritte), name).toBe(true);
      expect(kennzahl.schritte.length, name).toBeGreaterThan(0);
    }
    expect(k.beteiligungen).toHaveLength(3);
    const zeile = k.beteiligungen.find((b: { id: string }) => b.id === ID.b1);
    expect(zeile).toMatchObject({
      organisation: { id: ID.orgA, name: "Alpha Beispiel", sektor: "Software" },
      instrument: "offene_beteiligung",
      status: "aktiv",
      erstinvestment: "2023-01-01",
      zusage: "1000000.00",
      investiert: "400000.00",
      rueckfluesse: "0.00",
      letzteBewertung: { stichtag: "2023-12-31", wert: "500000.00", methode: "letzte_runde" },
    });
    expect(zeile.multiple.wert).toBe("1.25");
    expect(zeile.multiple.schritte.at(-1)).toMatchObject({ zeichen: "=", bezeichnung: "Multiple" });
  });

  it("Stichtag 31.12.2023: Handwerte", async () => {
    const k = (await json(await uebersicht(ID.f1, "2023-12-31"))).kennzahlen;
    expect(k.abgerufen.wert).toBe("1000000");
    expect(k.ausschuettungen.wert).toBe("0");
    expect(k.nav.wert).toBe("1110000"); // 500.000 + 260.000 + 350.000
    expect(k.tvpi.wert).toBe("1.11");
    expect(k.dpi.wert).toBe("0");
    expect(k.rvpi.wert).toBe("1.11");
  });

  it("Vorgänge nach dem Stichtag zählen nicht", async () => {
    const frueh = await json(await uebersicht(ID.f1, "2023-12-31"));
    const spaet = await json(await uebersicht(ID.f1, "2024-06-30"));
    const b1 = (k: typeof frueh) => k.beteiligungen.find((b: { id: string }) => b.id === ID.b1);
    expect(b1(frueh).investiert).toBe("400000.00"); // Auszahlung vom 01.06.2024 fehlt noch
    expect(b1(spaet).investiert).toBe("600000.00");
    expect(b1(frueh).letzteBewertung.wert).toBe("500000.00"); // Bewertung vom 30.06.2024 fehlt noch
    expect(b1(spaet).letzteBewertung.wert).toBe("700000.00");
    // Abruf vom 01.07.2024 liegt nach dem Stichtag 30.06.2024
    expect(spaet.kennzahlen.abgerufen.wert).toBe("1000000");
    expect((await json(await uebersicht(ID.f1, "2024-07-01"))).kennzahlen.abgerufen.wert).toBe("1200000");
    // Beteiligungen mit späterem Erstinvestment fehlen, solange sie nicht existieren
    expect((await json(await uebersicht(ID.f1, "2023-02-01"))).beteiligungen.map((b: { id: string }) => b.id).sort()).toEqual([ID.b1, ID.b3].sort());
  });

  it("nach einem Exit trägt die Beteiligung 0 zum NAV bei", async () => {
    const k = await json(await uebersicht(ID.f1, "2024-06-30"));
    expect(k.kennzahlen.nav.wert).toBe("960000"); // 700.000 + 260.000 + 0 (Exit am 01.03.2024)
    expect(k.kennzahlen.ausschuettungen.wert).toBe("900000");
    expect(k.kennzahlen.tvpi.wert).toBe("1.86");
    const exit = k.beteiligungen.find((b: { id: string }) => b.id === ID.b3);
    expect(exit.rueckfluesse).toBe("900000.00");
    expect(exit.multiple.wert).toBe("3"); // (0 + 900.000) ÷ 300.000
    // vor dem Exit zählt die Bewertung
    const vorher = await json(await uebersicht(ID.f1, "2023-12-31"));
    expect(vorher.beteiligungen.find((b: { id: string }) => b.id === ID.b3).multiple.wert).toMatch(/^1\.1666666666/); // 350.000 ÷ 300.000
  });

  it("Storno hebt die stornierte Auszahlung auf, Zinsen zählen nicht als Rückfluss", async () => {
    const k = await json(await uebersicht(ID.f1, "2023-12-31"));
    const b2 = k.beteiligungen.find((b: { id: string }) => b.id === ID.b2);
    expect(b2.investiert).toBe("250000.00"); // 300.000 − 300.000 + 250.000
    expect(b2.rueckfluesse).toBe("0.00");
    // Vor dem Storno ist die Fehlbuchung noch gültig
    const davor = await json(await uebersicht(ID.f1, "2023-04-02"));
    expect(davor.beteiligungen.find((b: { id: string }) => b.id === ID.b2).investiert).toBe("300000.00");
    expect(davor.beteiligungen.find((b: { id: string }) => b.id === ID.b2).letzteBewertung).toBeNull();
  });

  it("TVPI, DPI, RVPI und IRR entsprechen dem Rechenkern für unabhängig per SQL ermittelte Summen", async () => {
    const stichtag = "2024-06-30";
    const summen = await db.execute<{ eingezahlt: string; ausschuettungen: string; nav: string }>(sql`
      SELECT
        (SELECT coalesce(sum(z.betrag), 0) FROM lp_zahlung z JOIN fonds_bewegung b ON b.id = z.bewegung_id WHERE b.fonds_id = ${ID.f1} AND z.valuta <= ${stichtag}::date)::text AS eingezahlt,
        (SELECT coalesce(sum(betrag), 0) FROM fonds_bewegung WHERE fonds_id = ${ID.f1} AND art = 'ausschuettung' AND valuta <= ${stichtag}::date)::text AS ausschuettungen,
        (SELECT coalesce(sum(wert), 0) FROM (
           SELECT DISTINCT ON (w.beteiligung_id) w.wert
           FROM bewertung w JOIN beteiligung b ON b.id = w.beteiligung_id
           WHERE b.fonds_id = ${ID.f1} AND w.stichtag <= ${stichtag}::date
             AND NOT EXISTS (SELECT 1 FROM vorgang v WHERE v.beteiligung_id = b.id AND b.status = 'exit' AND v.art = 'rueckfluss' AND v.valuta <= ${stichtag}::date)
           ORDER BY w.beteiligung_id, w.stichtag DESC) x)::text AS nav`);
    const erwartet = multiples(summen.rows[0]!);
    const k = (await json(await uebersicht(ID.f1, stichtag))).kennzahlen;
    expect(k.tvpi.wert).toBe(erwartet.tvpi.wert?.toString());
    expect(k.dpi.wert).toBe(erwartet.dpi.wert?.toString());
    expect(k.rvpi.wert).toBe(erwartet.rvpi.wert?.toString());
    expect(k.nav.wert).toBe(new Decimal(summen.rows[0]!.nav).toString());

    const bewegungen = await db.execute<{ art: string; valuta: string; betrag: string }>(
      sql`SELECT 'einzahlung' AS art, z.valuta::text, z.betrag::text FROM lp_zahlung z JOIN fonds_bewegung b ON b.id = z.bewegung_id
          WHERE b.fonds_id = ${ID.f1} AND z.valuta <= ${stichtag}::date
          UNION ALL SELECT art::text, valuta::text, betrag::text FROM fonds_bewegung
          WHERE fonds_id = ${ID.f1} AND art = 'ausschuettung' AND valuta <= ${stichtag}::date`,
    );
    const irr = xirr([
      ...bewegungen.rows.map((b) => ({ datum: b.valuta, betrag: b.art === "einzahlung" ? new Decimal(b.betrag).neg() : b.betrag })),
      { datum: stichtag, betrag: summen.rows[0]!.nav },
    ]);
    expect(irr).not.toBeNull();
    expect(k.irr.wert).toBe(irr!.toString());
    expect(k.irr.schritte.map((x: { bezeichnung: string }) => x.bezeichnung).join(" ")).toContain("NAV als Endwert");
  });

  it("ohne Stichtag zählen auch spätere Kapitalbewegungen des Fonds", async () => {
    expect((await json(await uebersicht(ID.f1))).stichtag).toBe("2024-07-01");
    expect((await json(await uebersicht(ID.f2))).stichtag).toBe("2024-06-30");
  });

  it("Fonds ohne Abrufe: Multiples nicht definiert, IRR null", async () => {
    const k = (await json(await uebersicht(ID.f2, "2024-06-30"))).kennzahlen;
    expect(k.abgerufen.wert).toBe("0");
    expect(k.tvpi.wert).toBeNull();
    expect(k.irr.wert).toBeNull();
  });

  it("ungültiger Stichtag: 400 mit Feldfehler", async () => {
    for (const stichtag of ["2024-13-45", "morgen", "2024-02-30"]) {
      const antwort = await uebersicht(ID.f1, stichtag);
      expect(antwort.status, stichtag).toBe(400);
      const { fehler } = await json(antwort);
      expect(fehler.code).toBe("EINGABE_UNGUELTIG");
      expect(fehler.felder).toEqual([expect.objectContaining({ feld: "stichtag", code: expect.any(String), meldung: expect.any(String) })]);
    }
  });

  it("sammelt Fehler mehrerer Felder in einer Antwort", async () => {
    const antwort = await app.request("/api/v1/fonds/keine-uuid/uebersicht?stichtag=morgen");
    expect(antwort.status).toBe(400);
    const { fehler } = await json(antwort);
    expect(fehler.felder.map((f: { feld: string }) => f.feld).sort()).toEqual(["id", "stichtag"]);

    const liste = await app.request("/api/v1/organisationen?limit=500&art=unbekannt&cursor=xyz");
    expect(liste.status).toBe(400);
    expect((await json(liste)).fehler.felder.map((f: { feld: string }) => f.feld).sort()).toEqual(["art", "cursor", "limit"]);
  });

  it("unbekannter Fonds: 404 mit Code", async () => {
    const antwort = await uebersicht(FREMD);
    expect(antwort.status).toBe(404);
    expect((await json(antwort)).fehler.code).toBe("FONDS_NICHT_GEFUNDEN");
  });
});

describe("GET /deals", () => {
  it("listet Deals mit Organisationsname", async () => {
    const { daten } = await json(await app.request("/api/v1/deals"));
    expect(daten).toHaveLength(3);
    const a = daten.find((d: { titel: string }) => d.titel === "Runde A");
    expect(a).toMatchObject({
      organisation: { id: ID.orgA, name: "Alpha Beispiel" },
      phase: "pruefung",
      status: "offen",
      ticket: "1000000.00",
      betreuung: "Person X",
      quelle: "Empfehlung",
    });
    expect(typeof a.aktualisiertAm).toBe("string");
  });

  it("filtert nach Status und Phase", async () => {
    const abgesagt = (await json(await app.request("/api/v1/deals?status=abgesagt"))).daten;
    expect(abgesagt.map((d: { titel: string }) => d.titel)).toEqual(["Runde B"]);
    const closing = (await json(await app.request("/api/v1/deals?phase=closing&status=investiert"))).daten;
    expect(closing.map((d: { titel: string }) => d.titel)).toEqual(["Runde C"]);
    expect((await json(await app.request("/api/v1/deals?phase=closing&status=offen"))).daten).toEqual([]);
    expect((await app.request("/api/v1/deals?status=quatsch")).status).toBe(400);
  });
});

describe("GET /organisationen", () => {
  it("sucht unabhängig von Groß- und Kleinschreibung", async () => {
    const { daten } = await json(await app.request("/api/v1/organisationen?suche=aLPHa"));
    expect(daten.map((o: { name: string }) => o.name)).toEqual(["Alpha Beispiel"]);
  });

  it("behandelt Platzhalterzeichen in der Suche als Text", async () => {
    expect((await json(await app.request("/api/v1/organisationen?suche=%25"))).daten.map((o: { name: string }) => o.name)).toEqual(["Investor_100% Beispiel"]);
    expect((await json(await app.request("/api/v1/organisationen?suche=_"))).daten).toHaveLength(1);
  });

  it("filtert nach Art", async () => {
    const { daten } = await json(await app.request("/api/v1/organisationen?art=investor"));
    expect(daten.map((o: { name: string }) => o.name)).toEqual(["Investor_100% Beispiel"]);
  });

  it("blättert mit Cursor ohne Lücken und Doppelte", async () => {
    const erste = await json(await app.request("/api/v1/organisationen?limit=3"));
    expect(erste.daten.map((o: { name: string }) => o.name)).toEqual(["Alpha Beispiel", "Beta Beispiel", "Gamma Beispiel"]);
    expect(typeof erste.naechsterCursor).toBe("string");
    const zweite = await json(await app.request(`/api/v1/organisationen?limit=3&cursor=${encodeURIComponent(erste.naechsterCursor)}`));
    expect(zweite.daten.map((o: { name: string }) => o.name)).toEqual(["Investor_100% Beispiel"]);
    expect(zweite.naechsterCursor).toBeNull();
  });
});

describe("GET /organisationen/:id", () => {
  it("zeigt Querbeteiligungen: zwei Beteiligungen in zwei Fonds", async () => {
    const antwort = await app.request(`/api/v1/organisationen/${ID.orgA}`);
    expect(antwort.status).toBe(200);
    const o = await json(antwort);
    expect(o).toMatchObject({ id: ID.orgA, name: "Alpha Beispiel", art: "unternehmen", sektor: "Software" });
    expect(o.personen).toEqual([expect.objectContaining({ vorname: "Erika", nachname: "Muster", funktion: "Geschäftsführung" })]);
    expect(o.deals).toEqual([expect.objectContaining({ titel: "Runde A", phase: "pruefung" })]);
    expect(o.beteiligungen).toHaveLength(2);
    expect(o.beteiligungen.map((b: { fonds: { kurzname: string } }) => b.fonds.kurzname).sort()).toEqual(["TF1", "TF2"]);
  });

  it("404 für unbekannte, 400 für ungültige Id", async () => {
    const unbekannt = await app.request(`/api/v1/organisationen/${FREMD}`);
    expect(unbekannt.status).toBe(404);
    expect((await json(unbekannt)).fehler.code).toBe("ORGANISATION_NICHT_GEFUNDEN");
    expect((await app.request("/api/v1/organisationen/abc")).status).toBe(400);
  });
});
