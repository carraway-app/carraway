import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { REGELN, findeRegel } from "../rechte/tabelle";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, auftraege, grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";
import { erstelleTestApp, idVon, legePersonAn, person, STANDARD, type Testperson } from "./hilfen-auth";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const { post } = aufrufe(t);

const F1 = ID.fonds;
const F2 = ID.anderer;
const B2 = "00000000-0000-4000-8000-0000000000c2"; // Beteiligung im zweiten Fonds
const DEAL_F1 = "00000000-0000-4000-8000-0000000000d1";
const DEAL_F2 = "00000000-0000-4000-8000-0000000000d2";
const DEAL_OHNE = "00000000-0000-4000-8000-0000000000d3";
const LAUF_F1 = "00000000-0000-4000-8000-0000000000e1";
const LAUF_F2 = "00000000-0000-4000-8000-0000000000e2";

const betrachter = person("betrachter-f1", { rollen: { [F1]: "betrachter" } });
const bearbeiter = person("bearbeiter-f1", { rollen: { [F1]: "bearbeiter" } });
const freigeber = person("freigeber-f1", { rollen: { [F1]: "freigeber" } });
const freigeber2 = person("freigeber2-f1", { rollen: { [F1]: "freigeber" } });
const verwalter = person("verwalter-f1", { rollen: { [F1]: "verwalter" } });
const nurFonds2 = person("freigeber-f2", { rollen: { [F2]: "freigeber" } });
const ohneRolle = person("ohne-rolle");
const alle = [betrachter, bearbeiter, freigeber, freigeber2, verwalter, nurFonds2, ohneRolle];

const RANG = { betrachter: 1, bearbeiter: 2, freigeber: 3, verwalter: 4 } as const;
const stufe: [Testperson, 1 | 2 | 3 | 4][] = [
  [betrachter, 1],
  [bearbeiter, 2],
  [freigeber, 3],
  [verwalter, 4],
];

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.beteiligung).values({ id: B2, fondsId: F2, organisationId: ID.orgA, instrument: "offene_beteiligung", erstinvestment: "2025-01-01" });
  await db.insert(s.deal).values([
    { id: DEAL_F1, organisationId: ID.orgA, fondsId: F1, titel: "Deal im Fonds Eins" },
    { id: DEAL_F2, organisationId: ID.orgB, fondsId: F2, titel: "Deal im Fonds Zwei" },
    { id: DEAL_OHNE, organisationId: ID.orgC, fondsId: null, titel: "Deal ohne Fonds" },
  ]);
  await db.insert(s.aktivitaet).values([
    { art: "notiz", datum: "2026-01-01", titel: "Notiz Fonds Eins", dealId: DEAL_F1, wiedervorlage: "2026-01-02" },
    { art: "notiz", datum: "2026-01-01", titel: "Notiz Fonds Zwei", dealId: DEAL_F2, wiedervorlage: "2026-01-02" },
    { art: "notiz", datum: "2026-01-01", titel: "Notiz ohne Deal", organisationId: ID.orgA, wiedervorlage: "2026-01-02" },
  ]);
  await db.insert(s.zinslauf).values([
    { id: LAUF_F1, fondsId: F1, stichtag: "2026-12-31", berechnetVon: "x" },
    { id: LAUF_F2, fondsId: F2, stichtag: "2026-12-31", berechnetVon: "x" },
  ]);
  await db.execute(sql`DELETE FROM snapshot_auftrag`);
  for (const p of alle) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const anfrage = (methode: string, pfad: string, als: Testperson | null, body?: unknown) =>
  t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

describe("Berechtigungstabelle", () => {
  it("jede Route der App ist klassifiziert und jede Regel gehört zu einer Route", () => {
    const alle = t.app.routes.filter((r) => r.method !== "ALL");
    // Außerhalb von /api/v1 gilt die Berechtigungstabelle nicht: `/metriken` hat ein eigenes Token (betrieb.test.ts), sonst gibt es nichts.
    expect(alle.filter((r) => !r.path.startsWith("/api/v1")).map((r) => `${r.method} ${r.path}`)).toEqual(["GET /metriken"]);
    const routen = alle.filter((r) => r.path.startsWith("/api/v1")).map((r) => `${r.method} ${r.path.replace(/^\/api\/v1/, "") || "/"}`);
    const regeln = REGELN.map((r) => `${r.methode} ${r.muster}`);
    const unklassifiziert = routen.filter((r) => !regeln.includes(r));
    const verwaist = regeln.filter((r) => !routen.includes(r));
    expect(unklassifiziert, "Routen ohne Eintrag in rechte/tabelle.ts").toEqual([]);
    expect(verwaist, "Regeln ohne Route").toEqual([]);
    expect(new Set(regeln).size).toBe(regeln.length);
  });

  it("jede Route findet zur Laufzeit genau ihre eigene Regel (kein Muster überdeckt ein anderes)", () => {
    for (const r of REGELN) {
      const pfad = r.muster.replace(/:\w+/g, "x").replace("*", "x");
      expect(findeRegel(r.methode, pfad)?.muster, `${r.methode} ${pfad}`).toBe(r.muster);
    }
  });

  it("nicht angemeldet: 401 NICHT_ANGEMELDET; ohne Rolle an irgendeinem Fonds: 403 KEINE_BERECHTIGUNG (außer den offenen Routen und /ich)", async () => {
    for (const r of REGELN.filter((x) => x.zugriff !== "oeffentlich")) {
      const pfad = r.muster.replace(/:jahr/, "2025").replace(/:\w+/g, () => randomUUID());
      const anonym = await anfrage(r.methode, pfad, null, r.methode === "GET" ? undefined : {});
      expect(anonym.status, `${r.methode} ${r.muster} anonym`).toBe(401);
      expect((await json(anonym)).fehler.code).toBe("NICHT_ANGEMELDET");
      const ohne = await anfrage(r.methode, pfad, ohneRolle, r.methode === "GET" ? undefined : {});
      if (r.zugriff === "angemeldet") {
        // Lesen antwortet 200; eine Änderung mit leerem Körper erreicht den Handler (400 der Eingabeprüfung, 404 bei unbekannter Kennung, 200 bei
        // Aktionen ohne Körper wie „andere Sitzungen beenden“), nicht die Rechteprüfung.
        if (r.methode === "GET") expect(ohne.status, `${r.methode} ${r.muster} angemeldet`).toBe(200);
        else expect([200, 400, 404], `${r.methode} ${r.muster} angemeldet`).toContain(ohne.status);
        continue;
      }
      expect(ohne.status, `${r.methode} ${r.muster} ohne Rolle`).toBe(403);
      expect((await json(ohne)).fehler.code).toBe("KEINE_BERECHTIGUNG");
    }
  });

  it("alle öffentlichen Routen sind bewusst öffentlich: Gesundheit, Umgebung, Anmeldung, Ersteinrichtung und die API-Beschreibung und der Link der Kennzahlen-Abfrage", () => {
    expect(REGELN.filter((r) => r.zugriff === "oeffentlich").map((r) => `${r.methode} ${r.muster}`)).toEqual([
      "GET /gesundheit",
      "GET /umgebung",
      "GET /auth/*",
      "POST /auth/*",
      "POST /einrichtung",
      // Passwort zurücksetzen per Mail: gleiche Antwort für jede Adresse, begrenzt je IP und Adresse, siehe `passwort-zuruecksetzen.test.ts`.
      "POST /passwort/vergessen",
      "GET /openapi.json",
      "GET /docs",
      // Link ohne Konto der Kennzahlen-Abfrage (Etappe 11): der Zugang ist das Token, siehe `kennzahlen-abfrage.test.ts`.
      "GET /extern/abfragen/:token",
      "PUT /extern/abfragen/:token",
      "POST /extern/abfragen/:token/einreichen",
      // Kalenderabonnement (ICS) einer Person (Etappe 17): Das Token vor `.ics` ist der Zugang, siehe `kalender-ics.test.ts`.
      "GET /kalender/:datei",
    ]);
  });
});

describe("Rollenmatrix (Fonds Eins)", () => {
  /** Eine Route und die Mindestrolle; `falls403` ist die Rolle, ab der die Berechtigung reicht. */
  const faelle = (ids: { vorgang: string; meilenstein: string }): [string, string, unknown, 1 | 2 | 3 | 4][] => [
    ["GET", `/fonds/${F1}/uebersicht`, undefined, 1],
    ["GET", `/fonds/${F1}/abgrenzung`, undefined, 1],
    ["GET", `/fonds/${F1}/berichte/portfolioliste`, undefined, 1],
    ["POST", `/fonds/${F1}/neuberechnen`, undefined, 2],
    ["GET", `/beteiligungen/${ID.eigen}`, undefined, 1],
    ["GET", `/beteiligungen/${ID.eigen}/instrumentdaten`, undefined, 1],
    ["POST", `/beteiligungen/${ID.eigen}/vorgaenge`, { art: "zusage", valuta: "2025-01-01", betrag: "1000" }, 2],
    ["POST", `/beteiligungen/${ID.darlehen}/meilensteine`, { bezeichnung: "M", betrag: "1000" }, 2],
    ["PUT", `/beteiligungen/${ID.darlehen}/jahresueberschuss/2025`, { betrag: "100" }, 2],
    ["POST", `/beteiligungen/${ID.eigen}/insolvenz`, { datum: "2999-01-01" }, 2],
    ["POST", `/vorgaenge/${ids.vorgang}/storno`, { grund: "Test" }, 2],
    ["POST", `/meilensteine/${ids.meilenstein}/erfuellt`, {}, 2],
    ["GET", `/zinslaeufe/${LAUF_F1}`, undefined, 1],
    ["GET", `/zinslaeufe/${LAUF_F1}/kontrolle`, undefined, 1],
    ["POST", `/zinslaeufe`, { fondsId: F1, stichtag: "2026-12-31" }, 2],
    ["GET", `/deals/${DEAL_F1}`, undefined, 1],
    ["POST", `/deals/${DEAL_F1}/phase`, { nachPhase: "erstgespraech" }, 2],
    ["POST", `/deals/${DEAL_F1}/beschluesse`, { gremium: "IA", datum: "2026-01-01", ergebnis: "vertagt" }, 2],
    ["GET", `/fonds/${F1}/periodensperre`, undefined, 4],
    ["PUT", `/fonds/${F1}/periodensperre`, { gesperrtBis: "2020-01-01" }, 4],
    ["GET", `/fonds/${F1}/rollen`, undefined, 4],
    ["POST", `/aktivitaeten`, { art: "notiz", datum: "2026-01-01", titel: "Neu", dealId: DEAL_F1 }, 2],
  ];

  it("unterhalb der Mindestrolle 403 KEINE_BERECHTIGUNG, ab der Mindestrolle nie 403 (betrachter < bearbeiter < freigeber < verwalter)", async () => {
    const vorgang = (await json(await post(`/beteiligungen/${ID.eigen}/vorgaenge`, { art: "zusage", valuta: "2025-01-01", betrag: "100000" }))).vorgang.id as string;
    const meilenstein = (await json(await post(`/beteiligungen/${ID.darlehen}/meilensteine`, { bezeichnung: "Erster Schritt", betrag: "1000" }))).id as string;
    for (const [methode, pfad, body, min] of faelle({ vorgang, meilenstein })) {
      for (const [p, rang] of stufe) {
        const antwort = await anfrage(methode, pfad, p, body);
        if (rang < min) {
          expect(antwort.status, `${methode} ${pfad} als ${p.name}`).toBe(403);
          expect((await json(antwort)).fehler.code).toBe("KEINE_BERECHTIGUNG");
        } else {
          expect(antwort.status, `${methode} ${pfad} als ${p.name}`).not.toBe(403);
          expect(antwort.status, `${methode} ${pfad} als ${p.name}`).toBeLessThan(500);
        }
      }
    }
  });

  it("die Rangfolge ist zusammenhängend: eine höhere Rolle darf alles, was eine niedrigere darf", () => {
    expect(RANG.betrachter < RANG.bearbeiter && RANG.bearbeiter < RANG.freigeber && RANG.freigeber < RANG.verwalter).toBe(true);
  });

  it("der Betrachter schreibt nichts: kein Vorgang, keine Änderung am Deal, kein neuer Kontakt", async () => {
    const vorher = (await db.execute(sql`SELECT (SELECT count(*) FROM vorgang)::int AS v, (SELECT count(*) FROM organisation)::int AS o, (SELECT count(*) FROM aenderung)::int AS a`)).rows[0];
    expect((await anfrage("POST", `/beteiligungen/${ID.eigen}/vorgaenge`, betrachter, { art: "zusage", valuta: "2025-01-01", betrag: "1000" })).status).toBe(403);
    expect((await anfrage("PATCH", `/deals/${DEAL_F1}`, betrachter, { titel: "Umbenannt" })).status).toBe(403);
    expect((await anfrage("POST", `/organisationen`, betrachter, { name: "Nordwind Technik", art: "unternehmen" })).status).toBe(403);
    expect((await db.execute(sql`SELECT (SELECT count(*) FROM vorgang)::int AS v, (SELECT count(*) FROM organisation)::int AS o, (SELECT count(*) FROM aenderung)::int AS a`)).rows[0]).toEqual(vorher);
  });

  it("Kontakte (ohne Fonds): Lesen ab Betrachter irgendwo, Schreiben ab Bearbeiter irgendwo", async () => {
    expect((await anfrage("GET", `/organisationen`, betrachter)).status).toBe(200);
    expect((await anfrage("GET", `/personen`, nurFonds2)).status).toBe(200);
    expect((await anfrage("POST", `/personen`, betrachter, { vorname: "Eva", nachname: "Beispiel" })).status).toBe(403);
    expect((await anfrage("POST", `/personen`, bearbeiter, { vorname: "Eva", nachname: "Beispiel" })).status).toBe(201);
    expect((await anfrage("POST", `/organisationen`, nurFonds2, { name: "Nordwind Technik", art: "unternehmen" })).status).toBe(201);
  });
});

describe("Fonds trennen: die Rolle an Fonds Eins gilt nicht an Fonds Zwei", () => {
  it("die Freigeberin von Fonds Eins kann einen Zinslauf von Fonds Zwei weder lesen noch prüfen, freigeben, verwerfen oder buchen", async () => {
    for (const [methode, pfad] of [
      ["GET", `/zinslaeufe/${LAUF_F2}`],
      ["GET", `/zinslaeufe/${LAUF_F2}/kontrolle`],
      ["POST", `/zinslaeufe/${LAUF_F2}/pruefen`],
      ["POST", `/zinslaeufe/${LAUF_F2}/freigeben`],
      ["POST", `/zinslaeufe/${LAUF_F2}/verwerfen`],
      ["POST", `/zinslaeufe/${LAUF_F2}/buchen`],
    ] as const) {
      const antwort = await anfrage(methode, pfad, freigeber, methode === "POST" ? {} : undefined);
      expect(antwort.status, `${methode} ${pfad}`).toBe(403);
    }
    expect((await anfrage("POST", `/zinslaeufe/${LAUF_F2}/pruefen`, nurFonds2, {})).status).toBe(200);
    expect((await anfrage("POST", `/zinslaeufe/${LAUF_F1}/pruefen`, nurFonds2, {})).status).toBe(403);
    expect((await anfrage("POST", `/zinslaeufe`, freigeber, { fondsId: F2, stichtag: "2026-12-31" })).status).toBe(403);
  });

  it("Beteiligung, Fondsübersicht, Berichte, Periodensperre und Rollen anderer Fonds sind verschlossen", async () => {
    for (const [methode, pfad] of [
      ["GET", `/beteiligungen/${B2}`],
      ["GET", `/beteiligungen/${B2}/instrumentdaten`],
      ["POST", `/beteiligungen/${B2}/vorgaenge`],
      ["GET", `/fonds/${F2}/uebersicht`],
      ["GET", `/fonds/${F2}/abgrenzung`],
      ["GET", `/fonds/${F2}/berichte/portfolioliste`],
      ["PUT", `/fonds/${F2}/periodensperre`],
      ["GET", `/fonds/${F2}/rollen`],
    ] as const) {
      const antwort = await anfrage(methode, pfad, verwalter, methode === "GET" ? undefined : {});
      expect(antwort.status, `${methode} ${pfad}`).toBe(403);
    }
  });

  it("Vorgang und Meilenstein eines anderen Fonds lassen sich nicht stornieren oder erfüllen", async () => {
    const vorgang = (await json(await post(`/beteiligungen/${B2}/vorgaenge`, { art: "zusage", valuta: "2025-01-01", betrag: "1000" }))).vorgang.id as string;
    expect((await anfrage("POST", `/vorgaenge/${vorgang}/storno`, bearbeiter, { grund: "Test" })).status).toBe(403);
    expect((await anfrage("POST", `/vorgaenge/${vorgang}/storno`, nurFonds2, { grund: "Test" })).status).toBe(201);
    const meilenstein = (await json(await post(`/beteiligungen/${B2}/meilensteine`, { bezeichnung: "Schritt", betrag: "1000" }))).id as string;
    expect((await anfrage("POST", `/meilensteine/${meilenstein}/erfuellt`, bearbeiter, {})).status).toBe(403);
    expect((await anfrage("POST", `/meilensteine/${meilenstein}/erfuellt`, nurFonds2, {})).status).toBe(200);
  });

  it("zwei Fonds in einer Anfrage: ein Deal lässt sich nicht in einen Fonds ohne Schreibrecht verschieben oder dorthin übernehmen", async () => {
    expect((await anfrage("PATCH", `/deals/${DEAL_F1}`, bearbeiter, { fondsId: F2 })).status).toBe(403);
    expect((await anfrage("PATCH", `/deals/${DEAL_F2}`, bearbeiter, { titel: "Fremd" })).status).toBe(403);
    expect((await anfrage("POST", `/deals`, bearbeiter, { titel: "Neu", organisation: { name: "Südlicht Medien" }, fondsId: F2 })).status).toBe(403);
    expect((await anfrage("POST", `/deals`, bearbeiter, { titel: "Neu", organisation: { name: "Südlicht Medien" }, fondsId: F1 })).status).toBe(201);
    expect((await anfrage("POST", `/deals/${DEAL_F1}/beteiligung`, bearbeiter, { fondsId: F2, instrument: "offene_beteiligung", erstinvestment: "2026-01-01" })).status).toBe(403);
    // Ein Deal ohne Fonds darf jede Person mit Schreibrecht irgendwo anfassen.
    expect((await anfrage("PATCH", `/deals/${DEAL_OHNE}`, bearbeiter, { titel: "Ohne Fonds, neu" })).status).toBe(200);
    expect((await anfrage("PATCH", `/deals/${DEAL_OHNE}`, betrachter, { titel: "Nein" })).status).toBe(403);
    expect((await anfrage("POST", `/aktivitaeten`, bearbeiter, { art: "notiz", datum: "2026-01-01", titel: "Fremd", dealId: DEAL_F2 })).status).toBe(403);
    const erledigt = await db.select({ id: s.aktivitaet.id }).from(s.aktivitaet).where(sql`${s.aktivitaet.dealId} = ${DEAL_F2}`);
    expect((await anfrage("POST", `/aktivitaeten/${erledigt[0]!.id}/erledigt`, bearbeiter)).status).toBe(403);
  });
});

describe("Listen und eingebettete Daten zeigen nur, was die Person sehen darf", () => {
  const namen = (antwort: { daten: { name?: string; titel?: string }[] }) => antwort.daten.map((d) => d.name ?? d.titel).sort();

  it("Fondsliste: nur Fonds mit Rolle; globale Verwalter sehen alle", async () => {
    expect(namen(await json(await anfrage("GET", "/fonds", bearbeiter)))).toEqual(["Testfonds Eins"]);
    expect(namen(await json(await anfrage("GET", "/fonds", nurFonds2)))).toEqual(["Testfonds Zwei"]);
    expect(namen(await json(await anfrage("GET", "/fonds", STANDARD)))).toEqual(["Testfonds Eins", "Testfonds Zwei"]);
  });

  it("Deals: Deals ohne Fonds und Deals der eigenen Fonds", async () => {
    expect(namen(await json(await anfrage("GET", "/deals", betrachter)))).toEqual(["Deal im Fonds Eins", "Deal ohne Fonds"]);
    expect(namen(await json(await anfrage("GET", "/deals", nurFonds2)))).toEqual(["Deal im Fonds Zwei", "Deal ohne Fonds"]);
    expect(namen(await json(await anfrage("GET", "/deals", STANDARD)))).toHaveLength(3);
  });

  it("Zinsläufe: nur die eigenen Fonds, auch mit fondsId im Filter eines fremden Fonds → 403", async () => {
    const eigene = await json(await anfrage("GET", "/zinslaeufe", freigeber));
    expect(eigene.daten.map((z: { fondsId: string }) => z.fondsId)).toEqual([F1]);
    expect((await anfrage("GET", `/zinslaeufe?fondsId=${F2}`, freigeber)).status).toBe(403);
    expect((await json(await anfrage("GET", `/zinslaeufe?fondsId=${F1}`, freigeber))).daten).toHaveLength(1);
  });

  it("Organisation: eingebettete Deals und Beteiligungen anderer Fonds fehlen", async () => {
    // orgA hat eine Beteiligung in Fonds Eins (ID.eigen) und eine in Fonds Zwei (B2), Deals in Fonds Eins; DEAL_F2 gehört orgB.
    const voll = await json(await anfrage("GET", `/organisationen/${ID.orgA}`, STANDARD));
    expect(voll.beteiligungen.map((b: { fonds: { kurzname: string } }) => b.fonds.kurzname).sort()).toEqual(["TF1", "TF2"]);
    const fonds1 = await json(await anfrage("GET", `/organisationen/${ID.orgA}`, betrachter));
    expect(fonds1.beteiligungen.map((b: { fonds: { kurzname: string } }) => b.fonds.kurzname)).toEqual(["TF1"]);
    const fremd = await json(await anfrage("GET", `/organisationen/${ID.orgB}`, betrachter));
    expect(fremd.deals).toEqual([]);
    expect((await json(await anfrage("GET", `/organisationen/${ID.orgB}`, nurFonds2))).deals.map((d: { titel: string }) => d.titel)).toEqual(["Deal im Fonds Zwei"]);
  });

  it("Deal-Detail: Beteiligungen anderer Fonds sind ausgeblendet; ein Deal eines fremden Fonds ist 403", async () => {
    expect((await anfrage("GET", `/deals/${DEAL_F2}`, betrachter)).status).toBe(403);
    expect((await anfrage("GET", `/deals/${DEAL_OHNE}`, betrachter)).status).toBe(200);
    await db.update(s.beteiligung).set({ dealId: DEAL_F1 }).where(sql`${s.beteiligung.id} IN (${ID.eigen}, ${B2})`);
    const detail = await json(await anfrage("GET", `/deals/${DEAL_F1}`, betrachter));
    expect(detail.beteiligungen.map((b: { fonds: { kurzname: string } }) => b.fonds.kurzname)).toEqual(["TF1"]);
  });

  it("Aktivitäten und Wiedervorlagen: Aktivitäten zu Deals fremder Fonds fehlen", async () => {
    const aktivitaeten = await json(await anfrage("GET", "/aktivitaeten", betrachter));
    expect(aktivitaeten.daten.map((a: { titel: string }) => a.titel).sort()).toEqual(["Notiz Fonds Eins", "Notiz ohne Deal"]);
    const wiedervorlagen = await json(await anfrage("GET", "/wiedervorlagen?bis=2026-12-31", nurFonds2));
    expect(wiedervorlagen.daten.map((a: { titel: string }) => a.titel).sort()).toEqual(["Notiz Fonds Zwei", "Notiz ohne Deal"]);
    expect((await json(await anfrage("GET", "/wiedervorlagen?bis=2026-12-31", STANDARD))).daten).toHaveLength(3);
  });

  it("Trichter ohne Fonds zählt nur sichtbare Deals; mit fremdem Fonds → 403", async () => {
    for (const d of [DEAL_F1, DEAL_F2, DEAL_OHNE]) await db.insert(s.dealPhasenwechsel).values({ dealId: d, nachPhase: "anfrage", am: "2026-01-01" });
    expect((await json(await anfrage("GET", "/dealflow/trichter", betrachter))).gesamt.deals).toBe(2);
    expect((await json(await anfrage("GET", "/dealflow/trichter", STANDARD))).gesamt.deals).toBe(3);
    expect((await anfrage("GET", `/dealflow/trichter?fondsId=${F2}`, betrachter)).status).toBe(403);
  });

  it("Gremienvorlage: nur Deals in sichtbaren Fonds", async () => {
    await db.update(s.deal).set({ phase: "investitionsausschuss" });
    const antwort = await anfrage("GET", "/berichte/gremienvorlage", betrachter);
    expect(antwort.status).toBe(200);
    const alles = await anfrage("GET", "/berichte/gremienvorlage", STANDARD);
    expect(alles.status).toBe(200);
    expect((await antwort.arrayBuffer()).byteLength).toBeLessThan((await alles.arrayBuffer()).byteLength);
  });
});

describe("Vier-Augen-Prinzip mit echten Benutzern", () => {
  const stufen = async (lauf: string, ...schritte: [string, Testperson][]) => {
    const ergebnisse = [];
    for (const [aktion, als] of schritte) ergebnisse.push(await anfrage("POST", `/zinslaeufe/${lauf}/${aktion}`, als, {}));
    return ergebnisse;
  };

  it("zwei verschiedene Freigeber: prüfen und freigeben gelingt; dieselbe Person scheitert mit VIER_AUGEN_VERLETZT", async () => {
    const [geprueft, gleiche] = await stufen(LAUF_F1, ["pruefen", freigeber], ["freigeben", freigeber]);
    expect(geprueft!.status).toBe(200);
    expect(gleiche!.status).toBe(409);
    expect((await json(gleiche!)).fehler.code).toBe("VIER_AUGEN_VERLETZT");

    const [anderer] = await stufen(LAUF_F1, ["freigeben", freigeber2]);
    expect(anderer!.status).toBe(200);
    expect(await json(anderer!)).toMatchObject({ status: "freigegeben", geprueftVon: await idVon(db, freigeber), freigegebenVon: await idVon(db, freigeber2) });
    const [gebucht] = await stufen(LAUF_F1, ["buchen", verwalter]);
    expect(gebucht!.status).toBe(200);
    const akteure = (await protokollZeilen(db, "zinslauf")).map((z) => [z.aktion, z.akteur_name]);
    expect(akteure).toEqual([
      ["pruefen", freigeber.name],
      ["freigeben", freigeber2.name],
      ["buchen", verwalter.name],
    ]);
  });

  it("Bearbeiter und Betrachter dürfen nicht prüfen, freigeben, verwerfen oder buchen", async () => {
    for (const aktion of ["pruefen", "freigeben", "verwerfen", "buchen"]) {
      for (const p of [betrachter, bearbeiter]) {
        const antwort = await anfrage("POST", `/zinslaeufe/${LAUF_F1}/${aktion}`, p, {});
        expect(antwort.status, `${aktion} als ${p.name}`).toBe(403);
      }
    }
  });

  it("die Vier-Augen-Prüfung vergleicht Benutzer-IDs: zwei Konten derselben Rolle zählen als zwei Personen, ein Verwalter für beide Schritte nicht", async () => {
    await stufen(LAUF_F1, ["pruefen", STANDARD]);
    const nochmal = await stufen(LAUF_F1, ["freigeben", STANDARD]);
    expect((await json(nochmal[0]!)).fehler.code).toBe("VIER_AUGEN_VERLETZT");
    expect((await stufen(LAUF_F1, ["freigeben", verwalter]))[0]!.status).toBe(200);
  });
});

describe("Benutzer und Rollen verwalten", () => {
  it("nur globale Verwalter legen Benutzer an; der neue Benutzer meldet sich an und muss erst den zweiten Faktor einrichten", async () => {
    expect((await anfrage("POST", "/benutzer", verwalter, { name: "Neu Person", email: "neu@test.example", passwort: "Startpasswort-123" })).status).toBe(403);
    expect((await anfrage("GET", "/benutzer", verwalter)).status).toBe(403);
    const angelegt = await anfrage("POST", "/benutzer", STANDARD, { name: "Neu Person", email: " Neu@Test.example ", passwort: "Startpasswort-123" });
    expect(angelegt.status).toBe(201);
    const neu = await json(angelegt);
    expect(neu).toMatchObject({ name: "Neu Person", email: "neu@test.example", aktiv: true, globalVerwalter: false });
    expect(JSON.stringify(neu)).not.toContain("Startpasswort");

    const doppelt = await anfrage("POST", "/benutzer", STANDARD, { name: "Nochmal", email: "neu@test.example", passwort: "Startpasswort-123" });
    expect((await json(doppelt)).fehler.code).toBe("BENUTZER_VORHANDEN");
    expect((await anfrage("POST", "/benutzer", STANDARD, { name: "Kurz", email: "kurz@test.example", passwort: "kurz" })).status).toBe(400);

    const anmeldung = await t.app.request("/api/v1/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      body: JSON.stringify({ email: "neu@test.example", password: "Startpasswort-123" }),
    });
    expect(anmeldung.status).toBe(200);
    const cookie = anmeldung.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const fonds = await t.app.request("/api/v1/fonds", { headers: { cookie } });
    expect(fonds.status).toBe(403);
    // Ein von Verwaltern angelegter Benutzer muss zuerst das Startpasswort ändern (danach den zweiten Faktor einrichten).
    expect((await json(fonds)).fehler.code).toBe("PASSWORT_AENDERN");
    expect((await protokollZeilen(db, "benutzer", "anlegen"))[0]?.nachher).not.toHaveProperty("passwort");
    await db.execute(sql`DELETE FROM benutzer WHERE email = 'neu@test.example'`);
  });

  it("Verwalter eines Fonds weisen Rollen an diesem Fonds zu und entziehen sie; die Änderung wirkt sofort und steht im Protokoll", async () => {
    const ziel = person("ziel", { zweiFaktor: true });
    const zielId = await legePersonAn(db, ziel);
    expect((await anfrage("GET", `/fonds/${F1}`, ziel)).status).toBe(403);
    expect((await anfrage("GET", `/fonds/${F1}/uebersicht`, ziel)).status).toBe(403);

    const setzen = await anfrage("PUT", `/fonds/${F1}/rollen/${zielId}`, verwalter, { rolle: "bearbeiter" });
    expect(setzen.status).toBe(200);
    expect(await json(setzen)).toEqual({ benutzerId: zielId, fondsId: F1, rolle: "bearbeiter" });
    expect((await anfrage("GET", `/fonds/${F1}/uebersicht`, ziel)).status).toBe(200);
    expect((await anfrage("POST", `/zinslaeufe/${LAUF_F1}/pruefen`, ziel, {})).status).toBe(403);

    expect((await anfrage("PUT", `/fonds/${F1}/rollen/${zielId}`, verwalter, { rolle: "freigeber" })).status).toBe(200);
    expect((await anfrage("POST", `/zinslaeufe/${LAUF_F1}/pruefen`, ziel, {})).status).toBe(200);

    const liste = await json(await anfrage("GET", `/fonds/${F1}/rollen`, verwalter));
    expect(liste.daten.find((r: { benutzerId: string }) => r.benutzerId === zielId)).toMatchObject({ rolle: "freigeber", name: ziel.name });
    expect((await anfrage("PUT", `/fonds/${F2}/rollen/${zielId}`, verwalter, { rolle: "betrachter" })).status).toBe(403); // fremder Fonds
    expect((await anfrage("PUT", `/fonds/${F1}/rollen/${zielId}`, bearbeiter, { rolle: "verwalter" })).status).toBe(403);
    expect((await anfrage("PUT", `/fonds/${F1}/rollen/${zielId}`, verwalter, { rolle: "chef" })).status).toBe(400);

    expect((await anfrage("DELETE", `/fonds/${F1}/rollen/${zielId}`, verwalter)).status).toBe(204);
    expect((await anfrage("GET", `/fonds/${F1}/uebersicht`, ziel)).status).toBe(403);
    expect((await anfrage("DELETE", `/fonds/${F1}/rollen/${zielId}`, verwalter)).status).toBe(404);
    expect((await protokollZeilen(db, "fondsrolle")).map((z) => z.aktion)).toEqual(["rolle_setzen", "rolle_setzen", "rolle_entziehen"]);
  });

  it("Rollen für technische Benutzer und unbekannte Benutzer werden abgelehnt", async () => {
    expect((await anfrage("PUT", `/fonds/${F1}/rollen/${randomUUID()}`, verwalter, { rolle: "betrachter" })).status).toBe(404);
    const [technisch] = await db.insert(s.benutzer).values({ name: "API: Test", email: `t-${randomUUID()}@technisch.invalid`, technisch: true }).returning();
    const antwort = await anfrage("PUT", `/fonds/${F1}/rollen/${technisch!.id}`, verwalter, { rolle: "betrachter" });
    expect(antwort.status).toBe(403);
    expect((await json(antwort)).fehler.code).toBe("TECHNISCHER_BENUTZER");
    await db.delete(s.benutzer).where(sql`${s.benutzer.id} = ${technisch!.id}`);
  });

  it("Sperren: ein gesperrter Benutzer verliert sofort seine Sitzungen; man sperrt sich nicht selbst", async () => {
    const opfer = person("sperre-opfer", { rollen: { [F1]: "bearbeiter" } }); // eigene Person: die Sperre löscht ihre Sitzungen
    const id = await legePersonAn(db, opfer);
    expect((await anfrage("GET", `/fonds`, opfer)).status).toBe(200); // legt die Sitzung an
    expect((await anfrage("PATCH", `/benutzer/${id}`, opfer, { aktiv: false })).status).toBe(403);
    const gesperrt = await anfrage("PATCH", `/benutzer/${id}`, STANDARD, { aktiv: false });
    expect(gesperrt.status).toBe(200);
    expect((await anfrage("GET", `/fonds`, opfer)).status).toBe(401);
    // Allein ist STANDARD der letzte aktive Verwalter (409); mit einer zweiten Verwalterperson greift der Selbstschutz (403).
    const standardId = await idVon(db, STANDARD);
    const andere = (await db.execute<{ id: string }>(sql`UPDATE benutzer SET global_verwalter = false WHERE global_verwalter AND id <> ${standardId} RETURNING id`)).rows;
    const letzter = await anfrage("PATCH", `/benutzer/${standardId}`, STANDARD, { aktiv: false });
    expect(letzter.status).toBe(409);
    expect((await json(letzter)).fehler.code).toBe("LETZTER_VERWALTER");
    await legePersonAn(db, person("zweiter-verwalter", { globalVerwalter: true }));
    expect((await anfrage("PATCH", `/benutzer/${standardId}`, STANDARD, { aktiv: false })).status).toBe(403);
    await db.execute(sql`DELETE FROM benutzer WHERE email = 'zweiter-verwalter@test.example'`);
    for (const { id: anderer } of andere) await db.execute(sql`UPDATE benutzer SET global_verwalter = true WHERE id = ${anderer}`);
    expect((await anfrage("PATCH", `/benutzer/${id}`, STANDARD, {})).status).toBe(400);
    expect((await anfrage("PATCH", `/benutzer/${randomUUID()}`, STANDARD, { aktiv: true })).status).toBe(404);
    const entsperrt = await anfrage("PATCH", `/benutzer/${id}`, STANDARD, { aktiv: true });
    expect(entsperrt.status).toBe(200);
    expect((await protokollZeilen(db, "benutzer", "aendern")).length).toBe(2);
  });

  it("Benutzerliste zeigt Rollen und Zwei-Faktor-Stand, nie Passwort oder Geheimnisse", async () => {
    const liste = await json(await anfrage("GET", "/benutzer", STANDARD));
    const eintrag = liste.daten.find((b: { email: string }) => b.email === bearbeiter.email);
    expect(eintrag).toMatchObject({ rollen: [{ fondsId: F1, rolle: "bearbeiter" }], zweiFaktorAktiv: true, aktiv: true, technisch: false });
    expect(JSON.stringify(liste)).not.toMatch(/password|secret|hash/i);
  });
});

describe("Akteur im Änderungsprotokoll", () => {
  it("Schreibzugriffe tragen die Benutzer-ID und den Namen der angemeldeten Person; ein X-Akteur-Header ändert daran nichts", async () => {
    const antwort = await t.request(`/beteiligungen/${ID.eigen}/vorgaenge`, {
      method: "POST",
      als: bearbeiter,
      headers: { "content-type": "application/json", "X-Akteur": "Jemand anderes" },
      body: JSON.stringify({ art: "zusage", valuta: "2025-01-01", betrag: "1000" }),
    });
    expect(antwort.status).toBe(201);
    const [zeile] = await protokollZeilen(db, "vorgang", "anlegen");
    expect(zeile).toMatchObject({ akteur: await idVon(db, bearbeiter), akteur_name: bearbeiter.name });
    expect(await auftraege(db)).toBe(1);
  });

  it("GET /ich nennt Person, Verwalterstatus und Rollen", async () => {
    const ich = await json(await anfrage("GET", "/ich", freigeber));
    expect(ich).toMatchObject({ name: freigeber.name, technisch: false, globalVerwalter: false, zweiFaktorAktiv: true, zweiFaktorErforderlich: false, rollen: [{ fondsId: F1, rolle: "freigeber" }] });
    expect((await json(await anfrage("GET", "/ich", STANDARD))).globalVerwalter).toBe(true);
  });
});

