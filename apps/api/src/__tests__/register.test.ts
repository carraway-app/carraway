import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { pruefeBeobachtung } from "../register/beobachtung";
import { TestAnbieter, type RegisterAbruf } from "../register/anbieter";
import { vergleiche } from "../register/abgleich";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { aufrufe, grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";

/** Handelsregister (Etappe 18): Historie, Abgleich, Übernahme, Hinweise, Beobachtung, Import. Alle Daten und Registernummern sind erfunden. */

const { db, pool } = oeffneTestdb();
const anbieter = new TestAnbieter(new Map());
const t = erstelleTestApp(db, { registerAnbieter: anbieter });
const { get, post, put } = aufrufe(t);
const keinAnbieter = aufrufe(erstelleTestApp(db, { registerAnbieter: null }));

const betrachter = person("reg-betrachter", { rollen: { [ID.fonds]: "betrachter" } });
const bearbeiter = person("reg-bearbeiter", { rollen: { [ID.fonds]: "bearbeiter" } });
const verwalter = person("reg-verwalter", { rollen: { [ID.fonds]: "verwalter", [ID.anderer]: "verwalter" } });
const fremd = person("reg-fremd", { rollen: { [ID.anderer]: "bearbeiter" } });

const eintrag = (zusatz: Record<string, unknown> = {}) => ({
  gericht: "Amtsgericht Beispielstadt",
  registerart: "HRB",
  nummer: "HRB 99001",
  firma: "Alpha Beispiel GmbH",
  rechtsform: "GmbH",
  sitz: "Beispielstadt",
  kapital: "25000.00",
  vertretung: [{ name: "Erika Beispiel", funktion: "Geschäftsführerin" }],
  prokura: [],
  standDatum: "2026-03-01",
  ...zusatz,
});

beforeEach(async () => {
  await grundbestand(db);
  for (const p of [betrachter, bearbeiter, verwalter, fremd]) await legePersonAn(db, p);
  anbieter.abrufe = 0;
  anbieter["daten"].clear();
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Registerstand und Historie", () => {
  it("legt Einträge an, hält die Historie und überspringt unveränderte Stände", async () => {
    const a = await post(`/organisationen/${ID.orgA}/register/eintraege`, eintrag(), bearbeiter);
    expect(a.status).toBe(201);
    const gleich = await post(`/organisationen/${ID.orgA}/register/eintraege`, eintrag({ standDatum: "2026-04-01" }), bearbeiter);
    expect(gleich.status).toBe(200);
    expect((await json(gleich)).neu).toBe(false);
    const neu = await post(`/organisationen/${ID.orgA}/register/eintraege`, eintrag({ standDatum: "2026-06-01", sitz: "Musterhausen" }), bearbeiter);
    expect(neu.status).toBe(201);
    const r = await json(await get(`/organisationen/${ID.orgA}/register`, betrachter));
    expect(r.aktuell.sitz).toBe("Musterhausen");
    expect(r.aktuell.quelle).toBe("manuell");
    expect(r.historie).toHaveLength(1);
    expect(r.historie[0].sitz).toBe("Beispielstadt");
    expect(r.anbieterEingerichtet).toBe(true);
  });

  it("verbietet Ändern und Löschen in der Datenbank", async () => {
    await post(`/organisationen/${ID.orgA}/register/eintraege`, eintrag(), bearbeiter);
    await expect(db.execute(sql`UPDATE registereintrag SET firma = 'x'`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM registereintrag`)).rejects.toThrow();
  });

  it("verknüpft einen Registerauszug als Dokument und lehnt ein unbekanntes ab", async () => {
    const fehl = await post(`/organisationen/${ID.orgA}/register/eintraege`, eintrag({ dokumentId: "00000000-0000-4000-8000-0000000000d9" }), bearbeiter);
    expect(fehl.status).toBe(404);
    expect((await json(fehl)).fehler.code).toBe("DOKUMENT_NICHT_GEFUNDEN");
    const [d] = await db
      .insert(s.dokument)
      .values({ sha256: "a".repeat(64), dateiname: "auszug.pdf", mime: "application/pdf", groesse: 10, gespeichertUnter: "test/auszug", hochgeladenVon: "test" })
      .returning();
    // Ein Dokument ohne Verknüpfung zu dieser Organisation darf nicht am Eintrag hängen (sonst ließe sich der Dateiname lesen).
    const fremdes = await post(`/organisationen/${ID.orgA}/register/eintraege`, eintrag({ dokumentId: d!.id }), bearbeiter);
    expect(fremdes.status).toBe(409);
    expect((await json(fremdes)).fehler.code).toBe("ZIEL_NICHT_AM_DOKUMENT");
    await db.insert(s.dokumentVerknuepfung).values({ dokumentId: d!.id, zielTyp: "organisation", zielId: ID.orgB });
    expect((await post(`/organisationen/${ID.orgA}/register/eintraege`, eintrag({ dokumentId: d!.id }), bearbeiter)).status).toBe(409);
    await db.insert(s.dokumentVerknuepfung).values({ dokumentId: d!.id, zielTyp: "organisation", zielId: ID.orgA });
    const ok = await post(`/organisationen/${ID.orgA}/register/eintraege`, eintrag({ dokumentId: d!.id }), bearbeiter);
    expect(ok.status).toBe(201);
    const r = await json(await get(`/organisationen/${ID.orgA}/register`, betrachter));
    expect(r.aktuell.quelle).toBe("dokument");
    expect(r.auszug).toEqual({ id: d!.id, dateiname: "auszug.pdf" });
  });
});

describe("Abgleich und Übernahme", () => {
  it("meldet Unterschiede in Firma, Sitz, Rechtsform und Geschäftsführung", async () => {
    await db.insert(s.person).values({ id: "00000000-0000-4000-8000-0000000000e1", vorname: "Karl", nachname: "Altmann", organisationId: ID.orgA });
    await db.insert(s.kontaktrolle).values({ personId: "00000000-0000-4000-8000-0000000000e1", organisationId: ID.orgA, rolle: "geschaeftsfuehrung" });
    await post(`/organisationen/${ID.orgA}/register/eintraege`, eintrag({ firma: "Alpha Beispielwerke GmbH", sitz: "Beispielstadt" }), bearbeiter);
    const r = await json(await get(`/organisationen/${ID.orgA}/register`, betrachter));
    const codes = r.abweichungen.map((a: { code: string }) => a.code).sort();
    expect(codes).toEqual(["FIRMA_ABWEICHEND", "GESCHAEFTSFUEHRUNG_ABWEICHEND", "RECHTSFORM_FEHLT_IM_CRM", "SITZ_FEHLT_IM_CRM"]);
    const gf = r.abweichungen.find((a: { feld: string }) => a.feld === "geschaeftsfuehrung");
    expect(gf.fehltImCrm).toEqual(["Erika Beispiel"]);
    expect(gf.nichtImRegister).toEqual(["Karl Altmann"]);
  });

  it("zählt Rechtsform im Firmennamen nicht als Unterschied, auch Umlaute und Titel nicht", () => {
    const stamm = { name: "Alpha Beispiel", ort: "Köln", rechtsform: "GmbH", geschaeftsfuehrung: ["Erika Müller"] };
    const reg = { firma: "Alpha Beispiel GmbH", sitz: "Koeln", rechtsform: "G.m.b.H", vertretung: [{ name: "Dr. Müller, Erika", funktion: "Geschäftsführerin" }] };
    expect(vergleiche(stamm, reg)).toEqual([]);
  });

  it("übernimmt Felder einzeln, protokolliert mit Akteur und lässt die Übrigen unverändert", async () => {
    await post(`/organisationen/${ID.orgA}/register/eintraege`, eintrag({ firma: "Alpha Beispielwerke GmbH" }), bearbeiter);
    const ok = await post(`/organisationen/${ID.orgA}/register/uebernehmen`, { felder: ["firma", "rechtsform"] }, bearbeiter);
    expect(ok.status).toBe(200);
    const [o] = await db.select().from(s.organisation).where(eq(s.organisation.id, ID.orgA));
    expect(o).toMatchObject({ name: "Alpha Beispielwerke GmbH", rechtsform: "GmbH", ort: null });
    const z = await protokollZeilen(db, "organisation", "register_uebernehmen");
    expect(z).toHaveLength(1);
    expect(z[0]!.akteur).not.toBe("system");
    expect(z[0]!.akteur_name).toBe(bearbeiter.name);
    expect((z[0]!.vorher as { name: string }).name).toBe("Alpha Beispiel");
    const nochmal = await post(`/organisationen/${ID.orgA}/register/uebernehmen`, { felder: ["firma"] }, bearbeiter);
    expect(nochmal.status).toBe(409);
    expect((await json(nochmal)).fehler.code).toBe("REGISTER_KEIN_UNTERSCHIED");
  });

  it("übernimmt die Geschäftsführung: legt Personen und Rollen an, beendet fehlende Rollen", async () => {
    await db.insert(s.person).values({ id: "00000000-0000-4000-8000-0000000000e1", vorname: "Karl", nachname: "Altmann", organisationId: ID.orgA });
    await db.insert(s.kontaktrolle).values({ personId: "00000000-0000-4000-8000-0000000000e1", organisationId: ID.orgA, rolle: "geschaeftsfuehrung", von: "2020-01-01" });
    await post(`/organisationen/${ID.orgA}/register/eintraege`, eintrag(), bearbeiter);
    const ok = await post(`/organisationen/${ID.orgA}/register/uebernehmen`, { felder: ["geschaeftsfuehrung"] }, bearbeiter);
    expect(ok.status).toBe(200);
    const rollen = await db.select().from(s.kontaktrolle).where(eq(s.kontaktrolle.organisationId, ID.orgA));
    expect(rollen).toHaveLength(2);
    expect(rollen.find((r) => r.personId === "00000000-0000-4000-8000-0000000000e1")!.bis).toBe("2026-03-01");
    const neu = await db.select().from(s.person).where(eq(s.person.nachname, "Beispiel"));
    expect(neu).toHaveLength(1);
    expect(neu[0]!.vorname).toBe("Erika");
    const r = await json(await get(`/organisationen/${ID.orgA}/register`, betrachter));
    expect(r.abweichungen.find((a: { feld: string }) => a.feld === "geschaeftsfuehrung")).toBeUndefined();
  });

  it("übernimmt keine gleichnamige Person eines anderen Unternehmens als Geschäftsführung", async () => {
    await db.insert(s.person).values({ vorname: "Erika", nachname: "Beispiel", organisationId: ID.orgB });
    await post(`/organisationen/${ID.orgA}/register/eintraege`, eintrag(), bearbeiter);
    await post(`/organisationen/${ID.orgA}/register/uebernehmen`, { felder: ["geschaeftsfuehrung"] }, bearbeiter);
    const rollen = await db.select().from(s.kontaktrolle).where(eq(s.kontaktrolle.organisationId, ID.orgA));
    expect(rollen).toHaveLength(1);
    const personen = await db.select().from(s.person).where(eq(s.person.nachname, "Beispiel"));
    expect(personen).toHaveLength(2);
    expect(personen.find((p) => p.id === rollen[0]!.personId)!.organisationId).toBe(ID.orgA);
  });

  it("verlangt für die Übernahme mindestens bearbeiter und ohne Eintrag 404", async () => {
    await post(`/organisationen/${ID.orgA}/register/eintraege`, eintrag({ firma: "Alpha Beispielwerke GmbH" }), bearbeiter);
    expect((await post(`/organisationen/${ID.orgA}/register/uebernehmen`, { felder: ["firma"] }, betrachter)).status).toBe(403);
    const ohne = await post(`/organisationen/${ID.orgB}/register/uebernehmen`, { felder: ["firma"] }, bearbeiter);
    expect(ohne.status).toBe(404);
    expect((await json(ohne)).fehler.code).toBe("REGISTER_EINTRAG_FEHLT");
  });
});

describe("Ereignisse und Hinweise an der Beteiligung", () => {
  it("erzeugt für Insolvenz und Kapitalerhöhung Hinweise, bucht aber nichts", async () => {
    await post(`/organisationen/${ID.orgA}/register/eintraege`, eintrag(), bearbeiter);
    const vorher = await db.select().from(s.vorgang);
    await post(`/organisationen/${ID.orgA}/register/ereignisse`, { datum: "2026-05-01", art: "insolvenz", text: "Eröffnung des Insolvenzverfahrens (erfundener Beispieltext)." }, bearbeiter);
    await post(`/organisationen/${ID.orgA}/register/ereignisse`, { datum: "2026-04-01", art: "sonstiges", text: "Zweigniederlassung." }, bearbeiter);
    await post(`/organisationen/${ID.orgA}/register/ereignisse`, { datum: "2026-02-01", art: "kapitalerhoehung", text: "Erhöhung des Stammkapitals." }, bearbeiter);
    const h = await json(await get(`/beteiligungen/${ID.eigen}/register-hinweise`, betrachter));
    expect(h.daten.map((x: { art: string; aktion: string }) => [x.art, x.aktion])).toEqual([
      ["insolvenz", "insolvenz"],
      ["kapitalerhoehung", "runde"],
    ]);
    expect(await db.select().from(s.vorgang)).toEqual(vorher);
    const e = h.daten[0];
    const erledigt = await post(`/organisationen/${ID.orgA}/register/ereignisse/${e.ereignisId}/erledigen`, undefined, bearbeiter);
    expect(erledigt.status).toBe(200);
    expect((await post(`/organisationen/${ID.orgA}/register/ereignisse/${e.ereignisId}/erledigen`, undefined, bearbeiter)).status).toBe(409);
    const danach = await json(await get(`/beteiligungen/${ID.eigen}/register-hinweise`, betrachter));
    expect(danach.daten).toHaveLength(1);
  });

  it("zeigt Hinweise nur für Fonds mit Rolle und hält Ereignisse unveränderlich", async () => {
    await post(`/organisationen/${ID.orgA}/register/eintraege`, eintrag(), bearbeiter);
    await post(`/organisationen/${ID.orgA}/register/ereignisse`, { datum: "2026-05-01", art: "loeschung", text: "Löschung." }, bearbeiter);
    expect((await get(`/beteiligungen/${ID.eigen}/register-hinweise`, fremd)).status).toBe(403);
    const r = await json(await get(`/organisationen/${ID.orgA}/register`, fremd));
    expect(r.hinweise).toEqual([]);
    await expect(db.execute(sql`UPDATE register_ereignis SET text = 'x'`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM register_ereignis`)).rejects.toThrow();
  });
});

describe("Anbieter, Beobachtung und Meldungen", () => {
  const abruf = (zusatz: Partial<RegisterAbruf["eintrag"]> = {}, ereignisse: RegisterAbruf["ereignisse"] = []): RegisterAbruf => ({
    eintrag: { ...eintrag(), registerart: "HRB", kapitalWaehrung: "EUR", vertretung: [{ name: "Erika Beispiel", funktion: "Geschäftsführerin" }], prokura: [], ...zusatz } as RegisterAbruf["eintrag"],
    ereignisse,
  });

  it("ohne Anbieter antworten Suche und Abruf mit 409", async () => {
    const r = await keinAnbieter.get("/register/suche?firma=Alpha", bearbeiter);
    expect(r.status).toBe(409);
    expect((await json(r)).fehler.code).toBe("REGISTER_ANBIETER_FEHLT");
    expect((await keinAnbieter.post(`/organisationen/${ID.orgA}/register/abruf`, {}, bearbeiter)).status).toBe(409);
    expect((await json(await keinAnbieter.get("/register/status", betrachter))).anbieterEingerichtet).toBe(false);
  });

  it("sucht und ruft ab, mit Referenz aus dem letzten Eintrag", async () => {
    anbieter.setze(abruf({}, [{ datum: "2026-05-02", art: "kapitalerhoehung", text: "Erhöhung." }]));
    const such = await json(await get("/register/suche?firma=alpha", betrachter));
    expect(such.daten).toHaveLength(1);
    const ohneRef = await post(`/organisationen/${ID.orgA}/register/abruf`, {}, bearbeiter);
    expect(ohneRef.status).toBe(409);
    expect((await json(ohneRef)).fehler.code).toBe("REGISTER_REFERENZ_FEHLT");
    const ok = await post(`/organisationen/${ID.orgA}/register/abruf`, { gericht: "Amtsgericht Beispielstadt", registerart: "HRB", nummer: "HRB 99001" }, bearbeiter);
    expect(ok.status).toBe(200);
    const k = await json(ok);
    expect(k).toMatchObject({ neu: true, ereignisse: 1 });
    expect(k.eintrag.quelle).toBe("anbieter:test");
    const nochmal = await json(await post(`/organisationen/${ID.orgA}/register/abruf`, {}, bearbeiter));
    expect(nochmal).toMatchObject({ neu: false, ereignisse: 0 });
    const unbekannt = await post(`/organisationen/${ID.orgA}/register/abruf`, { gericht: "x", registerart: "HRB", nummer: "HRB 1" }, bearbeiter);
    expect(unbekannt.status).toBe(404);
  });

  it("Beobachtung: nur verwalter schaltet, der Lauf legt Änderungen und Ereignisse an und meldet sie", async () => {
    await post(`/organisationen/${ID.orgA}/register/eintraege`, eintrag(), bearbeiter);
    expect((await put(`/organisationen/${ID.orgA}/register/beobachtung`, { aktiv: true }, bearbeiter)).status).toBe(403);
    const an = await put(`/organisationen/${ID.orgA}/register/beobachtung`, { aktiv: true }, verwalter);
    expect(an.status).toBe(200);
    expect((await json(an)).aktiv).toBe(true);
    anbieter.setze(abruf({ sitz: "Musterhausen", standDatum: "2026-07-01" }, [{ datum: "2026-07-02", art: "sitzverlegung", text: "Sitzverlegung nach Musterhausen.", externeId: "bk-1" }]));
    const lauf = await pruefeBeobachtung(db, anbieter);
    expect(lauf).toEqual({ geprueft: 1, neueEintraege: 1, neueEreignisse: 1, fehler: 0 });
    const zweiter = await pruefeBeobachtung(db, anbieter);
    expect(zweiter).toEqual({ geprueft: 1, neueEintraege: 0, neueEreignisse: 0, fehler: 0 });
    const meldungen = await json(await get("/register/meldungen", betrachter));
    expect(meldungen.daten.map((m: { art: string }) => m.art).sort()).toEqual(["eintrag", "ereignis"]);
    expect(meldungen.daten[0].organisation).toBe("Alpha Beispiel");
    const gelesen = await post(`/register/meldungen/${meldungen.daten[0].id}/gelesen`, undefined, betrachter);
    expect(gelesen.status).toBe(200);
    expect((await json(await get("/register/meldungen?ungelesen=true", betrachter))).daten).toHaveLength(1);
    const r = await json(await get(`/organisationen/${ID.orgA}/register`, betrachter));
    expect(r.beobachtung).toMatchObject({ aktiv: true, letztesErgebnis: "ok" });
    expect(r.aktuell.quelle).toBe("anbieter:test");
  });

  it("Beobachtung legt bei älterem Stand des Anbieters nicht bei jedem Lauf dieselbe Zeile und Meldung an", async () => {
    await post(`/organisationen/${ID.orgA}/register/eintraege`, eintrag({ standDatum: "2026-09-01", sitz: "Musterhausen" }), bearbeiter);
    await put(`/organisationen/${ID.orgA}/register/beobachtung`, { aktiv: true }, verwalter);
    anbieter.setze(abruf({ standDatum: "2026-03-01" })); // älterer Stand als der manuelle Eintrag, anderer Inhalt
    const erster = await pruefeBeobachtung(db, anbieter);
    expect(erster.neueEintraege).toBe(1);
    const zweiter = await pruefeBeobachtung(db, anbieter);
    const dritter = await pruefeBeobachtung(db, anbieter);
    expect(zweiter.neueEintraege + dritter.neueEintraege).toBe(0);
    expect(await db.select().from(s.registereintrag)).toHaveLength(2);
    expect(await db.select().from(s.registerMeldung)).toHaveLength(1);
  });

  it("Beobachtung begrenzt die Abrufe je Lauf, ignoriert abgeschaltete und meldet Fehler des Anbieters", async () => {
    for (const org of [ID.orgA, ID.orgB, ID.orgC]) {
      await post(`/organisationen/${org}/register/eintraege`, eintrag({ nummer: `HRB 9900${org.slice(-1)}` }), bearbeiter);
    }
    await put(`/organisationen/${ID.orgA}/register/beobachtung`, { aktiv: true }, verwalter);
    await put(`/organisationen/${ID.orgB}/register/beobachtung`, { aktiv: true }, verwalter);
    anbieter.setze(abruf({ nummer: "HRB 9900a" }));
    const lauf = await pruefeBeobachtung(db, anbieter, { max: 1 });
    expect(lauf.geprueft).toBe(1);
    expect(anbieter.abrufe).toBe(1);
    const fehler = new TestAnbieter(new Map());
    fehler.abruf = async () => {
      throw new Error("Zeitüberschreitung");
    };
    const l2 = await pruefeBeobachtung(db, fehler, { max: 5 });
    expect(l2).toMatchObject({ geprueft: 2, fehler: 2 });
    const [b] = await db.select().from(s.registerBeobachtung).where(eq(s.registerBeobachtung.organisationId, ID.orgB));
    expect(b!.letztesErgebnis).toContain("fehler");
  });
});

describe("Zusammenführen von Organisationen", () => {
  it("zeigt Register und Hinweise der zusammengeführten Organisation am Ziel und übernimmt die Rechtsform", async () => {
    await post(`/organisationen/${ID.orgB}/register/eintraege`, eintrag({ nummer: "HRB 99002" }), bearbeiter);
    await post(`/organisationen/${ID.orgB}/register/ereignisse`, { datum: "2026-05-01", art: "insolvenz", text: "Antrag." }, bearbeiter);
    await db.update(s.organisation).set({ rechtsform: "GmbH" }).where(eq(s.organisation.id, ID.orgB));
    // Je Fonds und Unternehmen gibt es eine Beteiligung: Die Organisationen dürfen nicht vom selben Fonds gehalten werden.
    await db.update(s.beteiligung).set({ fondsId: ID.anderer }).where(eq(s.beteiligung.id, ID.darlehen));
    const merge = await post(`/organisationen/${ID.orgA}/zusammenfuehren`, { quelleId: ID.orgB, felder: {} }, verwalter);
    expect(merge.status).toBe(200);
    const [ziel] = await db.select().from(s.organisation).where(eq(s.organisation.id, ID.orgA));
    expect(ziel!.rechtsform).toBe("GmbH");
    const r = await json(await get(`/organisationen/${ID.orgA}/register`, betrachter));
    expect(r.aktuell.nummer).toBe("HRB 99002");
    expect(r.ereignisse).toHaveLength(1);
    const h = await json(await get(`/beteiligungen/${ID.eigen}/register-hinweise`, betrachter));
    expect(h.daten).toHaveLength(1);
  });
});

describe("Import aus einer Datei", () => {
  const csv = [
    "organisationName;gericht;registerart;nummer;firma;rechtsform;sitz;kapital;standDatum;vertretung",
    "Alpha Beispiel;Amtsgericht Beispielstadt;HRB;HRB 99001;Alpha Beispiel GmbH;GmbH;Beispielstadt;25000;2026-03-01;Erika Beispiel (Geschäftsführerin) | Paul Muster (Prokurist)",
    "Beta Beispiel;Amtsgericht Beispielstadt;HRB;HRB 99002;Beta Beispiel AG;AG;Musterhausen;120000.50;2026-03-02;",
  ].join("\n");

  it("prüft nur, ohne zu übernehmen", async () => {
    const r = await json(await post("/register/import", { format: "csv", inhalt: csv, nurPruefen: true }, bearbeiter));
    expect(r).toEqual({ zeilen: 2, uebernommen: false });
    expect(await db.select().from(s.registereintrag)).toHaveLength(0);
  });

  it("übernimmt CSV wiederholbar und protokolliert die Quelle", async () => {
    const r = await json(await post("/register/import", { format: "csv", inhalt: csv }, bearbeiter));
    expect(r).toMatchObject({ zeilen: 2, uebernommen: true, angelegt: 2, unveraendert: 0 });
    const wieder = await json(await post("/register/import", { format: "csv", inhalt: csv }, bearbeiter));
    expect(wieder).toMatchObject({ angelegt: 0, unveraendert: 2 });
    const alle = await db.select().from(s.registereintrag).where(eq(s.registereintrag.organisationId, ID.orgA));
    expect(alle).toHaveLength(1);
    expect(alle[0]!.quelle).toBe("import");
    expect(alle[0]!.vertretung).toEqual([
      { name: "Erika Beispiel", funktion: "Geschäftsführerin" },
      { name: "Paul Muster", funktion: "Prokurist" },
    ]);
  });

  it("übernimmt JSON mit Ereignissen genau einmal", async () => {
    const inhalt = JSON.stringify({ eintraege: [{ organisationId: ID.orgA, ...eintrag(), ereignisse: [{ datum: "2026-05-01", art: "insolvenz", text: "Antrag gestellt.", externeId: "x1" }] }] });
    const r = await json(await post("/register/import", { format: "json", inhalt }, bearbeiter));
    expect(r.ereignisse).toBe(1);
    const w = await json(await post("/register/import", { format: "json", inhalt }, bearbeiter));
    expect(w.ereignisse).toBe(0);
    expect(await db.select().from(s.registerMeldung)).toHaveLength(2);
  });

  it("lehnt eine Datei mit Fehlern vollständig ab und nennt alle Zeilenfehler", async () => {
    const schlecht = [
      "organisationName;gericht;registerart;nummer;firma;standDatum",
      "Alpha Beispiel;AG Beispielstadt;HRB;HRB 1;Alpha GmbH;2026-03-01",
      "Unbekannte Firma;AG Beispielstadt;HRB;HRB 2;X;2026-03-01",
      "Beta Beispiel;AG Beispielstadt;XYZ;HRB 3;Beta;31.12.2026",
    ].join("\n");
    const r = await post("/register/import", { format: "csv", inhalt: schlecht }, bearbeiter);
    expect(r.status).toBe(422);
    const k = await json(r);
    expect(k.fehler.code).toBe("REGISTER_IMPORT_UNGUELTIG");
    expect(k.fehler.zeilen.map((z: { zeile: number; feld: string }) => `${z.zeile}:${z.feld}`).sort()).toEqual(["3:organisationName", "4:registerart", "4:standDatum"]);
    expect(await db.select().from(s.registereintrag)).toHaveLength(0);
    const kaputt = await post("/register/import", { format: "json", inhalt: "{" }, bearbeiter);
    expect(kaputt.status).toBe(422);
  });

  it("verlangt bearbeiter", async () => {
    expect((await post("/register/import", { format: "csv", inhalt: csv }, betrachter)).status).toBe(403);
  });
});
