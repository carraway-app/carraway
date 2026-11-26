import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";
import { erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const F1 = ID.fonds;
const F2 = ID.anderer;

const verwalter = person("e14-verwalter", { rollen: { [F1]: "verwalter" } });
const freigeber = person("e14-freigeber", { rollen: { [F1]: "freigeber" } });
const bearbeiter = person("e14-bearbeiter", { rollen: { [F1]: "bearbeiter" } });
const betrachter = person("e14-betrachter", { rollen: { [F1]: "betrachter" } });
const fremd = person("e14-fremd", { rollen: { [F2]: "verwalter" } });

const anfrage = (methode: string, pfad: string, als: Testperson, body?: unknown) =>
  t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeEach(async () => {
  await grundbestand(db);
  for (const p of [verwalter, freigeber, bearbeiter, betrachter, fremd]) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Rechte der Stammdaten", () => {
  const schreibend: [string, string, unknown][] = [
    ["PUT", `/fonds/${F1}/buchhaltung`, { beraternummer: 1001, mandantennummer: 1, wirtschaftsjahrBeginn: 1, sachkontenlaenge: 4, belegpraefix: "B" }],
    ["PUT", `/fonds/${F1}/mittelarten`, { gueltigAb: "2026-01-01", mittelarten: [{ schluessel: "a", bezeichnungDe: "A", bezeichnungEn: "A", quote: "1" }] }],
    ["PUT", `/fonds/${F1}/konten`, { konten: [{ nummer: "1200", bezeichnung: "Bank", art: "aktiv" }] }],
    ["POST", `/fonds/${F1}/gliederung/standard`, undefined],
    ["PUT", `/fonds/${F1}/belegvorlagen/auszahlung`, { felder: [{ schluessel: "betrag", abschnitt: "kopf", pflicht: true }], kopfDe: "", kopfEn: "", fussDe: "", fussEn: "" }],
    ["PUT", `/fonds/${F1}/buchungsregeln/zins`, { konto: "1200", gegenkonto: "4200", richtung: "S", buSchluessel: null, buchungstext: "Zins {organisation}" }],
  ];

  it("ändern: nur verwalter des Fonds; lesen: betrachter; fremde Fonds: 403", async () => {
    for (const [m, pfad, body] of schreibend) {
      for (const p of [freigeber, bearbeiter, betrachter, fremd]) expect((await anfrage(m, pfad, p, body ?? {})).status, `${m} ${pfad} ${p.name}`).toBe(403);
      expect([200, 201], `${m} ${pfad} verwalter`).toContain((await anfrage(m, pfad, verwalter, body ?? {})).status);
    }
    for (const pfad of ["buchhaltung", "mittelarten", "konten", "gliederung", "kontenregeln", "belegvorlagen", "buchungsregeln"]) {
      expect((await anfrage("GET", `/fonds/${F1}/${pfad}`, betrachter)).status, pfad).toBe(200);
      expect((await anfrage("GET", `/fonds/${F1}/${pfad}`, fremd)).status, pfad).toBe(403);
    }
  });

  it("Schlüssel zur Buchhaltung an der Beteiligung: bearbeiter ändert, betrachter liest", async () => {
    const pfad = `/beteiligungen/${ID.darlehen}/buchhaltungsschluessel`;
    expect((await anfrage("PUT", pfad, betrachter, {})).status).toBe(403);
    await db.insert(s.foerderprogramm).values({ schluessel: "test_stamm", bezeichnung: "Programm Beispiel" }).onConflictDoNothing();
    expect((await anfrage("PUT", pfad, bearbeiter, { foerderprogramm: "test_gibtesnicht" })).status).toBe(404);
    const neu = await anfrage("PUT", pfad, bearbeiter, { projektnummer: "P-100", vertragsnummer: "V-7", partnernummer: "PN-3", buchungskreis: "BK1", foerderprogramm: "test_stamm" });
    expect(neu.status).toBe(200);
    expect(await json(await anfrage("GET", pfad, betrachter))).toMatchObject({ projektnummer: "P-100", buchungskreis: "BK1", foerderprogramm: "test_stamm", foerderprogrammBezeichnung: "Programm Beispiel" });
    expect((await protokollZeilen(db, "beteiligung_buchhaltung")).map((z) => z.aktion)).toEqual(["anlegen"]);
    // geleert über null
    const leer = await json(await anfrage("PUT", pfad, bearbeiter, { projektnummer: null }));
    expect(leer.projektnummer).toBeNull();
    expect(leer.vertragsnummer).toBeNull();
  });
});

describe("Konfiguration und Mittelarten", () => {
  it("Konfiguration mit Standardwerten, speichern und Grenzen", async () => {
    expect(await json(await anfrage("GET", `/fonds/${F1}/buchhaltung`, verwalter))).toMatchObject({ konfiguriert: false, sachkontenlaenge: 4, belegpraefix: "B" });
    const ok = { beraternummer: 1234567, mandantennummer: 12345, wirtschaftsjahrBeginn: 7, sachkontenlaenge: 6, belegpraefix: "TF1" };
    expect(await json(await anfrage("PUT", `/fonds/${F1}/buchhaltung`, verwalter, ok))).toMatchObject({ ...ok, konfiguriert: true });
    for (const falsch of [{ ...ok, sachkontenlaenge: 9 }, { ...ok, wirtschaftsjahrBeginn: 13 }, { ...ok, belegpraefix: "zu lang und mit Leerzeichen" }, { ...ok, beraternummer: 12345678 }, { ...ok, beraternummer: 1000 }]) {
      expect((await anfrage("PUT", `/fonds/${F1}/buchhaltung`, verwalter, falsch)).status).toBe(400);
    }
  });

  it("Mittelarten: Quoten ergeben 1, neue Quoten ab Datum lösen den bisherigen Satz ab", async () => {
    const satz = (a: string, b: string) => [
      { schluessel: "land", bezeichnungDe: "Landesmittel", bezeichnungEn: "State funds", quote: a },
      { schluessel: "eigen", bezeichnungDe: "Eigenmittel", bezeichnungEn: "Own funds", quote: b },
    ];
    const falsch = await anfrage("PUT", `/fonds/${F1}/mittelarten`, verwalter, { gueltigAb: "2025-01-01", mittelarten: satz("0.6", "0.3") });
    expect(falsch.status).toBe(409);
    expect((await json(falsch)).fehler.code).toBe("MITTELARTEN_SUMME_UNGUELTIG");
    expect((await anfrage("PUT", `/fonds/${F1}/mittelarten`, verwalter, { gueltigAb: "2025-01-01", mittelarten: satz("0.6", "0.4") })).status).toBe(200);
    expect((await anfrage("PUT", `/fonds/${F1}/mittelarten`, verwalter, { gueltigAb: "2026-01-01", mittelarten: satz("0.5", "0.5") })).status).toBe(200);
    const zeilen = (await json(await anfrage("GET", `/fonds/${F1}/mittelarten`, verwalter))).daten;
    expect(zeilen.map((z: { gueltigAb: string; gueltigBis: string | null; quote: string }) => [z.gueltigAb, z.gueltigBis, z.quote])).toEqual([
      ["2025-01-01", "2025-12-31", "0.400000"],
      ["2025-01-01", "2025-12-31", "0.600000"],
      ["2026-01-01", null, "0.500000"],
      ["2026-01-01", null, "0.500000"],
    ]);
    const frueher = await anfrage("PUT", `/fonds/${F1}/mittelarten`, verwalter, { gueltigAb: "2024-01-01", mittelarten: satz("0.5", "0.5") });
    expect((await json(frueher)).fehler.code).toBe("MITTELARTEN_ZEITRAUM_UNGUELTIG");
  });
});

describe("Kontenrahmen, Gliederung und Kontenregeln", () => {
  it("Konten anlegen und ändern, Beteiligung muss zum Fonds gehören, Löschen nur ohne Saldo", async () => {
    const neu = await anfrage("PUT", `/fonds/${F1}/konten`, verwalter, { konten: [{ nummer: "1200", bezeichnung: "Bank", art: "aktiv" }, { nummer: "0150", bezeichnung: "Ausleihung Beta", art: "aktiv", beteiligungId: ID.darlehen }] });
    expect(neu.status).toBe(200);
    await anfrage("PUT", `/fonds/${F1}/konten`, verwalter, { konten: [{ nummer: "1200", bezeichnung: "Bankkonto", art: "aktiv" }] });
    expect((await json(await anfrage("GET", `/fonds/${F1}/konten`, verwalter))).daten.map((k: { nummer: string; bezeichnung: string }) => [k.nummer, k.bezeichnung])).toEqual([["0150", "Ausleihung Beta"], ["1200", "Bankkonto"]]);
    const [anderer] = await db.insert(s.beteiligung).values({ fondsId: F2, organisationId: ID.orgA, instrument: "darlehen", erstinvestment: "2025-01-01" }).returning();
    const fremdeB = await anfrage("PUT", `/fonds/${F1}/konten`, verwalter, { konten: [{ nummer: "0151", bezeichnung: "X", art: "aktiv", beteiligungId: anderer!.id }] });
    expect((await json(fremdeB)).fehler.code).toBe("KONTO_BETEILIGUNG_FREMD");
    expect((await anfrage("PUT", `/fonds/${F1}/konten`, verwalter, { konten: [{ nummer: "12x", bezeichnung: "X", art: "aktiv" }] })).status).toBe(400);
    expect((await anfrage("DELETE", `/fonds/${F1}/konten/1200`, verwalter)).status).toBe(204);
    expect((await json(await anfrage("DELETE", `/fonds/${F1}/konten/1200`, verwalter))).fehler.code).toBe("KONTO_NICHT_GEFUNDEN");
  });

  it("Standardgliederung anlegen (idempotent), ändern, Position in Verwendung nicht entfernen, Zyklus ablehnen", async () => {
    const erste = await json(await anfrage("POST", `/fonds/${F1}/gliederung/standard`, verwalter));
    expect(erste.neuePositionen).toBeGreaterThan(30);
    expect((await json(await anfrage("POST", `/fonds/${F1}/gliederung/standard`, verwalter))).neuePositionen).toBe(0);
    const liste = (await json(await anfrage("GET", `/fonds/${F1}/gliederung`, betrachter))).daten;
    expect(new Set(liste.map((p: { sicht: string }) => p.sicht))).toEqual(new Set(["bilanz", "guv", "liquiditaet", "mittelverwendung", "portfolio"]));

    const regel = await anfrage("POST", `/fonds/${F1}/kontenregeln`, verwalter, { sicht: "portfolio", kontoVon: "0100", kontoBis: "0199", positionSchluessel: "pf.beteiligungen", gueltigAb: "2026-01-01" });
    expect(regel.status).toBe(201);
    const nurRest = liste.filter((p: { sicht: string; schluessel: string }) => p.sicht === "portfolio" && p.schluessel !== "pf.beteiligungen").map((p: { schluessel: string; elternSchluessel: string | null; bezeichnungDe: string; bezeichnungEn: string; seite: string }) => ({ schluessel: p.schluessel, elternSchluessel: p.elternSchluessel, bezeichnungDe: p.bezeichnungDe, bezeichnungEn: p.bezeichnungEn, seite: p.seite }));
    const verwendet = await anfrage("PUT", `/fonds/${F1}/gliederung/portfolio`, verwalter, { positionen: nurRest });
    expect((await json(verwendet)).fehler.code).toBe("GLIEDERUNG_POSITION_IN_VERWENDUNG");
    const zyklus = await anfrage("PUT", `/fonds/${F1}/gliederung/portfolio`, verwalter, {
      positionen: [
        { schluessel: "a", elternSchluessel: "b", bezeichnungDe: "A", bezeichnungEn: "A", seite: "soll" },
        { schluessel: "b", elternSchluessel: "a", bezeichnungDe: "B", bezeichnungEn: "B", seite: "soll" },
      ],
    });
    expect((await json(zyklus)).fehler.code).toBe("GLIEDERUNG_UNGUELTIG");
    const ok = await anfrage("PUT", `/fonds/${F1}/gliederung/portfolio`, verwalter, { positionen: [...nurRest.filter((p: { schluessel: string }) => p.schluessel !== "pf.portfolio"), { schluessel: "pf.beteiligungen", elternSchluessel: null, bezeichnungDe: "Beteiligungen", bezeichnungEn: "Equity", seite: "soll" }].map((p: { elternSchluessel: string | null }) => ({ ...p, elternSchluessel: null })) });
    expect(ok.status).toBe(200);
  });

  it("Kontenregeln sind versioniert: Überschneidung abgelehnt, Ablösung beendet die alte Regel am Tag davor", async () => {
    await anfrage("POST", `/fonds/${F1}/gliederung/standard`, verwalter);
    const neu = (body: object) => anfrage("POST", `/fonds/${F1}/kontenregeln`, verwalter, { sicht: "bilanz", ...body });
    const erste = await json(await neu({ kontoVon: "1200", kontoBis: "1299", positionSchluessel: "aktiva.liquide", gueltigAb: "2026-01-01" }));
    const ueberschneidet = await neu({ kontoVon: "1250", positionSchluessel: "aktiva.forderungen", gueltigAb: "2026-06-01" });
    expect(ueberschneidet.status).toBe(409);
    expect(await json(ueberschneidet)).toMatchObject({ fehler: { code: "KONTENREGEL_UEBERSCHNEIDET", mitRegelId: erste.id } });
    // anderer Zeitraum oder anderer Bereich: erlaubt
    expect((await neu({ kontoVon: "1300", kontoBis: "1399", positionSchluessel: "aktiva.forderungen", gueltigAb: "2026-01-01" })).status).toBe(201);
    // Oberposition und unbekannte Position
    expect((await json(await neu({ kontoVon: "1500", positionSchluessel: "aktiva", gueltigAb: "2026-01-01" }))).fehler.code).toBe("KONTENREGEL_POSITION_NICHT_BLATT");
    expect((await json(await neu({ kontoVon: "1500", positionSchluessel: "gibt.es.nicht", gueltigAb: "2026-01-01" }))).fehler.code).toBe("KONTENREGEL_POSITION_UNBEKANNT");
    expect((await neu({ kontoVon: "1500", kontoBis: "150", positionSchluessel: "aktiva.forderungen", gueltigAb: "2026-01-01" })).status).toBe(400);
  });

  it("Ablösung einer Regel: alte endet am Tag davor, Verlauf bleibt, Ende nachträglich setzbar", async () => {
    await anfrage("POST", `/fonds/${F1}/gliederung/standard`, verwalter);
    const neu = (body: object) => anfrage("POST", `/fonds/${F1}/kontenregeln`, verwalter, { sicht: "bilanz", ...body });
    const alt = await json(await neu({ kontoVon: "1200", kontoBis: "1299", positionSchluessel: "aktiva.liquide", gueltigAb: "2026-01-01" }));
    const nachfolger = await neu({ kontoVon: "1200", kontoBis: "1299", positionSchluessel: "aktiva.forderungen", gueltigAb: "2026-07-01", ersetzt: alt.id });
    expect(nachfolger.status).toBe(201);
    const [vorher] = await db.select().from(s.kontenregel).where(eq(s.kontenregel.id, alt.id));
    expect(vorher).toMatchObject({ gueltigAb: "2026-01-01", gueltigBis: "2026-06-30" });
    const stichtag = (await json(await anfrage("GET", `/fonds/${F1}/kontenregeln?sicht=bilanz&stichtag=2026-09-30`, betrachter))).daten;
    expect(stichtag.map((r: { positionSchluessel: string }) => r.positionSchluessel)).toEqual(["aktiva.forderungen"]);
    expect((await json(await anfrage("GET", `/fonds/${F1}/kontenregeln?sicht=bilanz&stichtag=2026-03-31`, betrachter))).daten.map((r: { positionSchluessel: string }) => r.positionSchluessel)).toEqual(["aktiva.liquide"]);
    // Ende vor dem Beginn: abgelehnt; sonst beenden
    const neuId = (await json(nachfolger)).id;
    expect((await json(await anfrage("POST", `/kontenregeln/${neuId}/beenden`, verwalter, { gueltigBis: "2026-06-01" }))).fehler.code).toBe("KONTENREGEL_ZEITRAUM_UNGUELTIG");
    expect((await anfrage("POST", `/kontenregeln/${neuId}/beenden`, fremd, { gueltigBis: "2026-12-31" })).status).toBe(403);
    expect((await anfrage("POST", `/kontenregeln/${neuId}/beenden`, verwalter, { gueltigBis: "2026-12-31" })).status).toBe(200);
    // Zeilen derselben Transaktion tragen denselben Zeitpunkt; die Reihenfolge innerhalb ist nicht festgelegt.
    expect((await protokollZeilen(db, "kontenregel")).map((z) => z.aktion).sort()).toEqual(["anlegen", "anlegen", "beenden", "beenden"]);
  });
});

describe("Belegvorlagen", () => {
  it("liefert Standardvorlagen mit Katalog, speichert eine eigene und lehnt unbekannte Felder ab", async () => {
    const liste = (await json(await anfrage("GET", `/fonds/${F1}/belegvorlagen`, betrachter))).daten;
    expect(liste.map((v: { art: string }) => v.art)).toEqual(["vertragsanlage", "auszahlung", "zinsbuchung", "verkauf", "wandlung", "kapitalabruf", "ausschuettung"]);
    const auszahlung = liste.find((v: { art: string }) => v.art === "auszahlung");
    expect(auszahlung.standard).toBe(true);
    expect(auszahlung.katalog.map((k: { schluessel: string }) => k.schluessel)).toContain("projektnummer");
    // Zinsbuchung (Zinslauf über viele Beteiligungen) ohne Felder einer einzelnen Beteiligung
    expect(liste.find((v: { art: string }) => v.art === "zinsbuchung").felder.map((f: { schluessel: string }) => f.schluessel)).not.toContain("organisation_name");

    const eigene = { felder: [{ schluessel: "organisation_name", abschnitt: "kopf", pflicht: true }, { schluessel: "betrag", abschnitt: "kopf", pflicht: true }, { schluessel: "projektnummer", abschnitt: "details", pflicht: true, bezeichnungDe: "Projekt", bezeichnungEn: "Project" }], kopfDe: "Kopf", kopfEn: "Header", fussDe: "Fuß", fussEn: "Footer" };
    expect((await anfrage("PUT", `/fonds/${F1}/belegvorlagen/auszahlung`, verwalter, eigene)).status).toBe(200);
    const danach = (await json(await anfrage("GET", `/fonds/${F1}/belegvorlagen`, betrachter))).daten.find((v: { art: string }) => v.art === "auszahlung");
    expect(danach).toMatchObject({ standard: false, kopfDe: "Kopf", fussEn: "Footer" });
    expect(danach.felder).toHaveLength(3);
    const unbekannt = await anfrage("PUT", `/fonds/${F1}/belegvorlagen/auszahlung`, verwalter, { ...eigene, felder: [{ schluessel: "gibt_es_nicht", abschnitt: "kopf", pflicht: false }] });
    expect(unbekannt.status).toBe(400);
    expect((await json(unbekannt)).fehler.felder[0].code).toBe("unbekannt");
    const zugeordnet = await anfrage("PUT", `/fonds/${F1}/belegvorlagen/zinsbuchung`, verwalter, { ...eigene, felder: [{ schluessel: "kaufpreis", abschnitt: "kopf", pflicht: false }] });
    expect(zugeordnet.status).toBe(400);
  });
});
