import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { entschaerfe, formatiereBetragText, rendereVorlage, unbekanntePlatzhalter } from "../beschluss/vorlage";
import { erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";
import { json, oeffneTestdb } from "./hilfen";
import { anzahl, grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";

/** Etappe 7: Beschlussvorlagen (Pflege, Einsetzen, Entschärfen) und globale Suche. Alle Daten sind erfunden. */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const F1 = ID.fonds;
const F2 = ID.anderer;

const verwalter = person("verwalter-vl", { rollen: { [F1]: "verwalter" } });
const freigeber = person("freigeber-vl", { rollen: { [F1]: "freigeber" } });
const bearbeiter = person("bearbeiter-vl", { rollen: { [F1]: "bearbeiter" } });
const betrachter = person("betrachter-vl", { rollen: { [F1]: "betrachter" } });
const nurF2 = person("betrachter-f2-vl", { rollen: { [F2]: "betrachter" } });
const ohneRolle = person("ohne-rolle-vl");
const nutzer = [verwalter, freigeber, bearbeiter, betrachter, nurF2, ohneRolle];

const senden = (methode: string, pfad: string, als?: Testperson, koerper?: unknown) =>
  t.request(pfad, { method: methode, ...(als ? { als } : {}), headers: { "content-type": "application/json" }, ...(koerper === undefined ? {} : { body: JSON.stringify(koerper) }) });

beforeEach(async () => {
  await grundbestand(db);
  for (const p of nutzer) await legePersonAn(db, p);
});
afterAll(async () => {
  await pool.end();
});

describe("Vorlage rendern (Einheit)", () => {
  it("setzt Werte in einem Durchgang ein: ein Wert, der wie ein Platzhalter aussieht, wird nicht noch einmal ersetzt", () => {
    const text = rendereVorlage("A: {{organisation}} / B: {{ fonds }} / C: {{ticket}}", { organisation: "{{fonds}}", fonds: "Fonds Eins", ticket: null });
    expect(text).toBe("A: { {fonds} } / B: Fonds Eins / C: –");
    expect(text).not.toContain("{{");
  });

  it("lässt Markup unverändert als Text stehen, entfernt Steuerzeichen und ersetzt nur bekannte Platzhalter", () => {
    expect(rendereVorlage("<p>{{organisation}}</p> {{unbekannt}}", { organisation: "<script>alert(1)</script> & \u0007x" })).toBe("<p><script>alert(1)</script> & x</p> {{unbekannt}}");
    expect(entschaerfe("a{{b}}c")).toBe("a{ {b} }c");
  });

  it("findet unbekannte Platzhalter, auch leere und mit Leerzeichen im Namen", () => {
    expect(unbekanntePlatzhalter("{{organisation}} {{ ticket }}")).toEqual([]);
    expect(unbekanntePlatzhalter("{{orgnisation}} {{}} {{ zwei worte }}").sort()).toEqual(["(leer)", "orgnisation", "zwei worte"]);
  });

  it("formatiert Beträge ohne Gleitkomma in beiden Sprachen", () => {
    expect(formatiereBetragText("2450000.00", "EUR", "de")).toBe("2.450.000 EUR");
    expect(formatiereBetragText("2450000.00", "EUR", "en")).toBe("2,450,000 EUR");
    expect(formatiereBetragText("1500.50", "EUR", "de")).toBe("1.500,50 EUR");
    expect(formatiereBetragText("12345678901234.5", "EUR", "en")).toBe("12,345,678,901,234.50 EUR");
    expect(formatiereBetragText("999", "EUR", "de")).toBe("999 EUR");
  });
});

describe("Änderungsabfrage (Etappe 6) für die Tabellen der Etappe 7", () => {
  it("Vorlagen eines Fonds erscheinen nur für Personen mit Rolle an diesem Fonds, Kontaktrollen ohne Fonds für jede Person mit Rolle", async () => {
    const seit = new Date(Date.now() - 60_000).toISOString();
    const vorlage = await json(await senden("POST", "/beschlussvorlagen", verwalter, { fondsId: F1, name: "Feed", text: "Antrag {{titel}}" }));
    const org = await json(await senden("POST", "/organisationen", bearbeiter, { name: "Feed Organisation", art: "unternehmen" }));
    const pers = await json(await senden("POST", "/personen", bearbeiter, { vorname: "Fee", nachname: "Dtester", organisationId: org.id }));
    const rolle = await senden("POST", "/kontaktrollen", bearbeiter, { personId: pers.id, organisationId: org.id, rolle: "gruender" });
    expect(rolle.status).toBe(201);
    const lies = async (als: Testperson) => (await json(await senden("GET", `/aenderungen?seit=${encodeURIComponent(seit)}&limit=1000`, als))).daten as { tabelle: string; fondsId: string | null }[];
    const eigene = await lies(betrachter);
    expect(eigene.find((z) => z.tabelle === "beschlussvorlage")).toMatchObject({ fondsId: F1 });
    expect(eigene.some((z) => z.tabelle === "kontaktrolle" && z.fondsId === null)).toBe(true);
    const fremde = await lies(nurF2);
    expect(fremde.some((z) => z.tabelle === "beschlussvorlage")).toBe(false);
    expect(fremde.some((z) => z.tabelle === "kontaktrolle")).toBe(true);
    expect(vorlage.id).toBeTruthy();
  });
});

describe("Änderungsabfrage: gelöschte Fondsdaten bleiben beim Fonds", () => {
  it("eine gelöschte Beziehung zu einem Fonds und eine gelöschte Vorlage sind für Personen ohne diesen Fonds unsichtbar", async () => {
    const seit = new Date(Date.now() - 60_000).toISOString();
    const org = await json(await senden("POST", "/organisationen", bearbeiter, { name: "Leck Organisation", art: "investor" }));
    const bez = await json(await senden("POST", "/organisationsbeziehungen", bearbeiter, { vonOrganisationId: org.id, fondsId: F1, art: "investor" }));
    expect((await senden("DELETE", `/organisationsbeziehungen/${bez.id}`, bearbeiter)).status).toBe(204);
    const vorlage = await json(await senden("POST", "/beschlussvorlagen", verwalter, { fondsId: F1, name: "Leck", text: "x" }));
    expect((await senden("DELETE", `/beschlussvorlagen/${vorlage.id}`, verwalter)).status).toBe(204);
    const lies = async (als: Testperson) => (await json(await senden("GET", `/aenderungen?seit=${encodeURIComponent(seit)}&limit=1000`, als))).daten as { tabelle: string; aktion: string; datensatzId: string; fondsId: string | null }[];
    const eigene = await lies(betrachter);
    for (const id of [bez.id, vorlage.id]) {
      const zeilen = eigene.filter((z) => z.datensatzId === id);
      expect(zeilen.map((z) => z.aktion)).toContain("loeschen");
      expect(zeilen.every((z) => z.fondsId === F1)).toBe(true);
    }
    const fremde = await lies(nurF2);
    expect(fremde.some((z) => z.datensatzId === bez.id || z.datensatzId === vorlage.id)).toBe(false);
  });
});

describe("Beschlussvorlagen (API)", () => {
  const neu = (als: Testperson, extra: Record<string, unknown> = {}) =>
    senden("POST", "/beschlussvorlagen", als, { fondsId: F1, name: "Standard", text: "Antrag: {{organisation}} erhält {{ticket}} aus {{fonds}}.", ...extra });

  it("Verwalter des Fonds pflegen Vorlagen; Freigeber und darunter nicht; Betrachter lesen die Vorlagen ihrer Fonds", async () => {
    for (const als of [freigeber, bearbeiter, betrachter, nurF2, ohneRolle]) expect((await neu(als)).status, als.name).toBe(403);
    const angelegt = await neu(verwalter);
    expect(angelegt.status).toBe(201);
    const v = await json(angelegt);
    expect((await senden("POST", "/beschlussvorlagen", verwalter, { fondsId: F2, name: "Fremd", text: "x" })).status).toBe(403);

    const liste = await json(await senden("GET", "/beschlussvorlagen", betrachter));
    expect(liste.daten).toHaveLength(1);
    expect(liste.daten[0]).toMatchObject({ id: v.id, name: "Standard", fonds: { id: F1 } });
    expect(liste.platzhalter).toContain("organisation");
    expect((await json(await senden("GET", "/beschlussvorlagen", nurF2))).daten).toEqual([]);
    expect((await senden("GET", `/beschlussvorlagen?fondsId=${F1}`, nurF2)).status).toBe(403);

    expect((await senden("PATCH", `/beschlussvorlagen/${v.id}`, freigeber, { name: "Neu" })).status).toBe(403);
    const geaendert = await senden("PATCH", `/beschlussvorlagen/${v.id}`, verwalter, { name: "Zweite Fassung", text: "Neu: {{titel}}" });
    expect(geaendert.status).toBe(200);
    expect(await json(geaendert)).toMatchObject({ name: "Zweite Fassung", text: "Neu: {{titel}}" });
    expect((await senden("PATCH", `/beschlussvorlagen/${v.id}`, verwalter, {})).status).toBe(400);
    expect((await senden("PATCH", `/beschlussvorlagen/${randomUUID()}`, verwalter, { name: "x" })).status).toBe(404);
    expect((await senden("DELETE", `/beschlussvorlagen/${v.id}`, bearbeiter)).status).toBe(403);
    expect((await senden("DELETE", `/beschlussvorlagen/${v.id}`, verwalter)).status).toBe(204);
    expect((await senden("DELETE", `/beschlussvorlagen/${v.id}`, verwalter)).status).toBe(404);
    expect((await protokollZeilen(db, "beschlussvorlage")).map((z) => z.aktion)).toEqual(["anlegen", "aendern", "loeschen"]);
  });

  it("lehnt unbekannte Platzhalter, doppelte Namen und leere Texte ab", async () => {
    const falsch = await neu(verwalter, { text: "{{organisation}} {{gewinn}}" });
    expect(falsch.status).toBe(400);
    expect((await json(falsch)).fehler).toMatchObject({ code: "PLATZHALTER_UNBEKANNT", unbekannt: ["gewinn"] });
    expect((await neu(verwalter)).status).toBe(201);
    const doppelt = await neu(verwalter);
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).fehler.code).toBe("VORLAGE_VORHANDEN");
    expect((await neu(verwalter, { name: "Leer", text: "  " })).status).toBe(400);
    const [v] = await db.select().from(s.beschlussvorlage);
    expect((await senden("PATCH", `/beschlussvorlagen/${v!.id}`, verwalter, { text: "{{x}}" })).status).toBe(400);
  });

  async function dealMit(extra: Partial<typeof s.deal.$inferInsert> = {}) {
    const [d] = await db.insert(s.deal).values({ organisationId: ID.orgA, titel: "Wachstum", ticket: "2450000.00", quelle: "Empfehlung", betreuung: "Anna", fondsId: F1, phase: "pruefung", ...extra }).returning();
    return d!.id;
  }

  it("füllt den Beschlussvorschlag des Deals aus der Vorlage, sprachabhängig, mit Protokoll", async () => {
    const [v] = await db
      .insert(s.beschlussvorlage)
      .values({ fondsId: F1, name: "Standard", text: "{{organisation}} ({{sektor}}): {{ticket}} aus {{fonds}} als {{instrument}}, Phase {{phase}}, Quelle {{quelle}}, Stand {{datum}}." })
      .returning();
    const dealId = await dealMit();
    const antwort = await senden("POST", `/deals/${dealId}/beschlussvorschlag`, bearbeiter, { vorlageId: v!.id, instrument: "wandeldarlehen" });
    expect(antwort.status).toBe(200);
    const ergebnis = await json(antwort);
    expect(ergebnis.beschlussvorschlag).toMatch(/^Alpha Beispiel \(Software\): 2\.450\.000 EUR aus Testfonds Eins als Wandeldarlehen, Phase Prüfung, Quelle Empfehlung, Stand \d{2}\.\d{2}\.\d{4}\.$/);
    const detail = await json(await senden("GET", `/deals/${dealId}`, bearbeiter));
    expect(detail.beschlussvorschlag).toBe(ergebnis.beschlussvorschlag);
    expect((await protokollZeilen(db, "deal", "aendern")).at(-1)!.nachher).toMatchObject({ beschlussvorschlag: ergebnis.beschlussvorschlag });
    const englisch = await json(await senden("POST", `/deals/${dealId}/beschlussvorschlag`, bearbeiter, { vorlageId: v!.id, sprache: "en" }));
    expect(englisch.beschlussvorschlag).toMatch(/^Alpha Beispiel \(Software\): 2,450,000 EUR aus Testfonds Eins als –, Phase Screening, Quelle Empfehlung, Stand \d{2}\/\d{2}\/\d{4}\.$/);
    // Von Hand ändern und wieder leeren
    expect((await senden("PATCH", `/deals/${dealId}`, bearbeiter, { beschlussvorschlag: "Eigener Text" })).status).toBe(200);
    expect((await json(await senden("GET", `/deals/${dealId}`, bearbeiter))).beschlussvorschlag).toBe("Eigener Text");
    expect((await json(await senden("PATCH", `/deals/${dealId}`, bearbeiter, { beschlussvorschlag: null }))).beschlussvorschlag).toBeNull();
  });

  it("setzt Werte aus dem Deal als Text ein: Markup und Platzhalter in Namen bleiben wirkungslos", async () => {
    const [v] = await db.insert(s.beschlussvorlage).values({ fondsId: F1, name: "Standard", text: "<b>{{organisation}}</b> / {{titel}} / {{fonds}}" }).returning();
    await db.update(s.organisation).set({ name: "<img src=x onerror=alert(1)> {{fonds}}" }).where(eq(s.organisation.id, ID.orgA));
    const dealId = await dealMit({ titel: "{{ticket}}\u0007" });
    const text = (await json(await senden("POST", `/deals/${dealId}/beschlussvorschlag`, bearbeiter, { vorlageId: v!.id }))).beschlussvorschlag as string;
    expect(text).toBe("<b><img src=x onerror=alert(1)> { {fonds} }</b> / { {ticket} } / Testfonds Eins");
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\u0000-\u0008]/);
  });

  it("verlangt passende Rechte und denselben Fonds: andere Fonds, fehlende Rolle an der Vorlage, nicht offene Deals", async () => {
    const [v1] = await db.insert(s.beschlussvorlage).values({ fondsId: F1, name: "Standard", text: "{{titel}}" }).returning();
    const [v2] = await db.insert(s.beschlussvorlage).values({ fondsId: F2, name: "Standard", text: "{{titel}}" }).returning();
    const dealId = await dealMit();
    const ohneFonds = await dealMit({ fondsId: null, titel: "Noch ohne Fonds" });

    const abweichend = await senden("POST", `/deals/${dealId}/beschlussvorschlag`, bearbeiter, { vorlageId: v2!.id });
    // Das Wissen um die Vorlage eines fremden Fonds bleibt verborgen (404), ohne Rolle am Fonds der Vorlage
    expect(abweichend.status).toBe(404);
    const beideFonds = person("beide-vl", { rollen: { [F1]: "bearbeiter", [F2]: "betrachter" } });
    await legePersonAn(db, beideFonds);
    const konflikt = await senden("POST", `/deals/${dealId}/beschlussvorschlag`, beideFonds, { vorlageId: v2!.id });
    expect(konflikt.status).toBe(409);
    expect((await json(konflikt)).fehler.code).toBe("VORLAGE_FONDS_ABWEICHEND");
    expect((await senden("POST", `/deals/${ohneFonds}/beschlussvorschlag`, beideFonds, { vorlageId: v2!.id })).status).toBe(200);

    expect((await senden("POST", `/deals/${dealId}/beschlussvorschlag`, betrachter, { vorlageId: v1!.id })).status).toBe(403);
    expect((await senden("POST", `/deals/${dealId}/beschlussvorschlag`, bearbeiter, { vorlageId: randomUUID() })).status).toBe(404);
    expect((await senden("POST", `/deals/${randomUUID()}/beschlussvorschlag`, bearbeiter, { vorlageId: v1!.id })).status).toBe(404);
    await db.update(s.deal).set({ status: "abgesagt" }).where(eq(s.deal.id, dealId));
    expect((await senden("POST", `/deals/${dealId}/beschlussvorschlag`, bearbeiter, { vorlageId: v1!.id })).status).toBe(409);
    expect(await anzahl(db, "deal", "beschlussvorschlag IS NOT NULL")).toBe(1);
  });
});

describe("Suche", () => {
  async function bestand() {
    await db.insert(s.organisation).values([
      { name: "Nordlicht Energie GmbH", art: "unternehmen" },
      { name: "Nordlicht", art: "investor" },
      { name: "Die Nordlicht Beratung", art: "berater" },
      { name: "Sonnenhof Robotik", art: "unternehmen" },
    ]);
    const [p1] = await db.insert(s.person).values({ vorname: "Nora", nachname: "Nordmann", email: "nora@beispiel.example", organisationId: ID.orgA }).returning();
    await db.insert(s.person).values({ vorname: "Max", nachname: "Beispiel", email: "norden@beispiel.example" });
    await db.insert(s.deal).values([
      { organisationId: ID.orgA, titel: "Nordlicht Wachstumsrunde", fondsId: F1 },
      { organisationId: ID.orgB, titel: "Nordlicht Fremdrunde", fondsId: F2 },
      { organisationId: ID.orgC, titel: "Ohne Fonds Nordlicht", fondsId: null },
    ]);
    return p1!.id;
  }

  const suche = async (q: string, als?: Testperson, extra = "") => json(await t.request(`/suche?q=${encodeURIComponent(q)}${extra}`, als ? { als } : {}));

  it("sortiert nach Ähnlichkeit: Gleichheit, Anfang, Teiltreffer; Tippfehler finden trotzdem", async () => {
    await bestand();
    const erg = await suche("nordlicht");
    expect(erg.organisationen.map((o: { name: string }) => o.name)).toEqual(["Nordlicht", "Nordlicht Energie GmbH", "Die Nordlicht Beratung"]);
    const scores = erg.organisationen.map((o: { score: number }) => o.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores[0]).toBeGreaterThan(1);
    // Tippfehler
    expect((await suche("nordlich"))
      .organisationen.map((o: { name: string }) => o.name)[0]).toBe("Nordlicht");
    expect((await suche("Sonenhof Robotic")).organisationen.map((o: { name: string }) => o.name)).toContain("Sonnenhof Robotik");
    // Personen über Name und E-Mail, Deals mit Organisation
    expect((await suche("nordmann")).personen.map((p: { nachname: string }) => p.nachname)).toEqual(["Nordmann"]);
    expect((await suche("norden@beispiel.example")).personen[0]).toMatchObject({ nachname: "Beispiel", vorname: "Max" });
    expect((await suche("nora")).personen[0]).toMatchObject({ organisation: { id: ID.orgA } });
    expect((await suche("wachstumsrunde")).deals[0]).toMatchObject({ titel: "Nordlicht Wachstumsrunde", organisation: { id: ID.orgA } });
    // Keine Treffer, Begrenzung, Eingabeprüfung
    expect(await suche("zzzzqq")).toMatchObject({ organisationen: [], personen: [], deals: [] });
    expect((await suche("nordlicht", undefined, "&limit=1")).organisationen).toHaveLength(1);
    for (const q of ["", "x", "a".repeat(101)]) expect((await t.request(`/suche?q=${q}`)).status, q).toBe(400);
    expect((await t.request("/suche?q=nord&limit=99")).status).toBe(400);
    // Sonderzeichen sind keine Muster
    expect((await suche("100%")).organisationen).toEqual([]);
    expect((await suche("%%")).organisationen).toEqual([]);
    expect((await suche("__")).personen).toEqual([]);
  });

  it("filtert nach Rechten: Deals fremder Fonds erscheinen nicht, ohne Rolle gibt es keinen Zugriff", async () => {
    await bestand();
    const alle = (await suche("nordlicht")).deals.map((d: { titel: string }) => d.titel).sort();
    expect(alle).toEqual(["Nordlicht Fremdrunde", "Nordlicht Wachstumsrunde", "Ohne Fonds Nordlicht"]);
    const nurEins = (await suche("nordlicht", betrachter)).deals.map((d: { titel: string }) => d.titel).sort();
    expect(nurEins).toEqual(["Nordlicht Wachstumsrunde", "Ohne Fonds Nordlicht"]);
    const nurZwei = (await suche("nordlicht", nurF2)).deals.map((d: { titel: string }) => d.titel).sort();
    expect(nurZwei).toEqual(["Nordlicht Fremdrunde", "Ohne Fonds Nordlicht"]);
    expect((await t.request("/suche?q=nordlicht", { als: ohneRolle })).status).toBe(403);
    expect((await t.request("/suche?q=nordlicht", { als: null })).status).toBe(401);
  });

  it("zusammengeführte Organisationen und Personen erscheinen nicht", async () => {
    const pid = await bestand();
    const [weg] = await db.select().from(s.organisation).where(eq(s.organisation.name, "Nordlicht"));
    await db.update(s.organisation).set({ zusammengefuehrtIn: weg!.id === ID.orgA ? ID.orgB : ID.orgA }).where(eq(s.organisation.id, weg!.id));
    await db.update(s.person).set({ zusammengefuehrtIn: pid }).where(eq(s.person.nachname, "Beispiel"));
    const erg = await suche("nordlicht");
    expect(erg.organisationen.map((o: { name: string }) => o.name)).not.toContain("Nordlicht");
    expect((await suche("norden@beispiel.example")).personen).toEqual([]);
  });
});
