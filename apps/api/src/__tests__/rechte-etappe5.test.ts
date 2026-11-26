import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { behandleFehler, sperrdatumAus } from "../app";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";
import { erstelleTestApp, idVon, legePersonAn, person, STANDARD, type Testperson } from "./hilfen-auth";

/**
 * Rechte, Vier-Augen und Periodensperre der Bewertungen, Bewertungsrunden und Berichte (Etappe 5 auf der Anmeldung).
 * Alle Personen sind erfunden.
 */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);

const F1 = ID.fonds;
const F2 = ID.anderer;
const E = ID.eigen;
const STUFEN = ["Investmentmanager", "Teamleitung", "Geschäftsführung"];

const betrachter = person("betrachter-e5", { rollen: { [F1]: "betrachter" } });
const bearbeiter = person("bearbeiter-e5", { rollen: { [F1]: "bearbeiter" } });
const freigeber = person("freigeber-e5", { rollen: { [F1]: "freigeber" } });
const freigeber2 = person("freigeber2-e5", { rollen: { [F1]: "freigeber" } });
const freigeber3 = person("freigeber3-e5", { rollen: { [F1]: "freigeber" } });
const verwalter = person("verwalter-e5", { rollen: { [F1]: "verwalter" } });
const nurFonds2 = person("freigeber-f2-e5", { rollen: { [F2]: "freigeber" } });
const personen = [betrachter, bearbeiter, freigeber, freigeber2, freigeber3, verwalter, nurFonds2];

const anfrage = (methode: string, pfad: string, als: Testperson | null, body?: unknown) =>
  t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const get = (pfad: string, als: Testperson | null = STANDARD) => anfrage("GET", pfad, als);
const post = (pfad: string, body: unknown, als: Testperson | null = STANDARD) => anfrage("POST", pfad, als, body);
const put = (pfad: string, body: unknown, als: Testperson | null = STANDARD) => anfrage("PUT", pfad, als, body);

const entwurf = (stichtag: string, als: Testperson = bearbeiter, beteiligung = E, wert = "120000.00") =>
  post(`/beteiligungen/${beteiligung}/bewertungen`, { stichtag, wert, methode: "letzte_runde", begruendung: "Runde im Quartal" }, als);
async function entwurfId(stichtag: string, als: Testperson = bearbeiter) {
  const antwort = await entwurf(stichtag, als);
  expect(antwort.status).toBe(201);
  return (await json(antwort)).bewertung.id as string;
}
/** Freigegebene Bewertung ohne die API (Ausgangslage). */
const freigegeben = (stichtag: string, wert = "100000.00") =>
  db.insert(s.bewertung).values({ beteiligungId: E, stichtag, wert, methode: "letzte_runde", begruendung: "Ausgang", status: "freigegeben" }).returning().then((z) => z[0]!);

const gesperrt = async (antwort: Response, bis: string) => {
  expect(antwort.status).toBe(409);
  const { error: fehler } = await json(antwort);
  expect(fehler.code).toBe("period_locked");
  expect(fehler.gesperrtBis).toBe(bis);
};
const sperre = async (bis: string) => expect((await put(`/fonds/${F1}/periodensperre`, { gesperrtBis: bis, grund: "Quartalsabschluss" }, verwalter)).status).toBe(200);

beforeEach(async () => {
  await grundbestand(db);
  for (const p of personen) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await db.execute(sql`DELETE FROM benutzer WHERE technisch`);
  await pool.end();
});

describe("Rechte der Bewertungen, Runden, Berichte und Vorlagen", () => {
  it("jede Route verlangt genau ihre Mindestrolle; Freigaben nur ab freigeber, Vorlagen und Stufen nur als verwalter", async () => {
    await freigegeben("2025-03-31");
    const draft = await entwurfId("2025-06-30");
    const runde = await post(`/fonds/${F1}/bewertungsrunde`, { stichtag: "2025-12-31", vorschlag: "fortschreiben" }, bearbeiter);
    expect(runde.status).toBe(201);
    const rundeId = (await json(runde)).runde.id as string;
    const bericht = await post("/reports", { art: "lp_bericht", fondsId: F1, stichtag: "2025-12-31" }, bearbeiter);
    expect(bericht.status).toBe(201);
    const berichtId = (await json(bericht)).id as string;

    const faelle: [string, string, unknown, 1 | 2 | 3 | 4][] = [
      ["GET", `/beteiligungen/${E}/bewertungen`, undefined, 1],
      ["GET", `/beteiligungen/${E}/runden`, undefined, 1],
      ["POST", `/beteiligungen/${E}/bewertungen`, { stichtag: "2025-02-28", wert: "5.00", methode: "letzte_runde", begruendung: "x" }, 2],
      ["GET", `/bewertungen/${draft}`, undefined, 1],
      ["GET", `/fonds/${F1}/bewertungsrunden`, undefined, 1],
      ["GET", `/fonds/${F1}/bewertungen`, undefined, 1],
      ["POST", `/fonds/${F1}/bewertungsrunde`, { stichtag: "2025-09-30", vorschlag: "fortschreiben" }, 2],
      ["GET", `/bewertungsrunden/${rundeId}`, undefined, 1],
      ["POST", `/beteiligungen/${E}/verkauf/vorschau`, {}, 2],
      ["POST", `/verkaeufe/${randomUUID()}/storno`, { grund: "Test" }, 2],
      ["POST", "/reports", { art: "lp_bericht", fondsId: F1, stichtag: "2025-12-31" }, 2],
      ["GET", `/reports?fondsId=${F1}`, undefined, 1],
      ["GET", `/reports/${berichtId}`, undefined, 1],
      ["GET", `/reports/${berichtId}/file`, undefined, 1],
      ["GET", `/reports/${berichtId}/checks`, undefined, 1],
      ["POST", `/reports/${berichtId}/correction`, { grund: "Rundung berichtigt" }, 2],
      ["PUT", `/reports/${berichtId}/sections/foreword`, { textDe: "Text" }, 2],
      ["GET", `/funds/${F1}/report-templates`, undefined, 1],
      ["GET", `/funds/${F1}/approval-stages`, undefined, 1],
      ["PUT", `/funds/${F1}/report-templates/fund_report`, {}, 4],
      ["PUT", `/funds/${F1}/approval-stages`, { stages: STUFEN }, 4],
      // Freigaben zuletzt: Wer sie ausführen darf, ändert den Zustand der Daten.
      ["POST", `/bewertungen/${draft}/verwerfen`, undefined, 3],
      ["POST", `/bewertungsrunden/${rundeId}/verwerfen`, undefined, 3],
      ["POST", `/reports/${berichtId}/stage`, { stufe: STUFEN[0], ergebnis: "ok" }, 3],
      ["POST", `/bewertungen/${draft}/freigeben`, undefined, 3],
      ["POST", `/bewertungsrunden/${rundeId}/freigeben`, undefined, 3],
    ];
    const stufen: [Testperson, 1 | 2 | 3 | 4][] = [
      [betrachter, 1],
      [bearbeiter, 2],
      [freigeber, 3],
      [verwalter, 4],
    ];
    for (const [methode, pfad, body, mindest] of faelle) {
      for (const [p, rang] of stufen) {
        const antwort = await anfrage(methode, pfad, p, body);
        if (rang < mindest) {
          expect(antwort.status, `${methode} ${pfad} als ${p.name}`).toBe(403);
          expect((await json(antwort)).error.code).toBe("forbidden");
        } else {
          expect(antwort.status, `${methode} ${pfad} als ${p.name}`).not.toBe(403);
        }
      }
      // Wer nur an einem anderen Fonds Freigeber ist, kommt nirgends heran (auch nicht über die ID des Datensatzes).
      if (!pfad.includes("/verkaeufe/")) expect((await anfrage(methode, pfad, nurFonds2, body)).status, `${methode} ${pfad} fremder Fonds`).toBe(403);
    }
  });

  it("Berichte: Liste und Zugriff nur für sichtbare Fonds; Anlegen über beteiligungId prüft den Fonds der Beteiligung", async () => {
    const f1 = await json(await post("/reports", { art: "lp_bericht", fondsId: F1, stichtag: "2025-12-31" }, freigeber));
    const liste = await json(await get("/reports", nurFonds2));
    expect(liste.daten.map((x: { id: string }) => x.id)).not.toContain(f1.id);
    expect((await json(await get("/reports", freigeber))).daten.map((x: { id: string }) => x.id)).toContain(f1.id);
    expect((await get(`/reports/${f1.id}`, nurFonds2)).status).toBe(403);
    expect((await get(`/reports/${f1.id}/file`, nurFonds2)).status).toBe(403);
    expect((await post("/reports", { art: "quartalsbericht", beteiligungId: E, stichtag: "2025-12-31" }, nurFonds2)).status).toBe(403);
    expect((await post("/reports", { art: "lp_bericht", fondsId: F1 }, nurFonds2)).status).toBe(403);
  });

  it("Freigaben (Bewertung, Runde, Berichtsstufe) lehnt ein API-Schlüssel ab; Entwürfe anlegen darf er mit Schreibrecht", async () => {
    const neu = await json(await post("/api-keys", { name: "Import", scopes: [{ fundId: F1, permission: "write" }] }));
    const mit = (methode: string, pfad: string, body?: unknown) =>
      t.app.request(`/api/v1${pfad}`, {
        method: methode,
        headers: { authorization: `Bearer ${neu.key}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    await freigegeben("2025-03-31");
    const angelegt = await mit("POST", `/investments/${E}/valuations`, { asOf: "2025-06-30", value: "1.00", method: "last_round", justification: "Import" });
    expect(angelegt.status).toBe(201);
    const id = (await json(angelegt)).valuation.id as string;
    const rundenEntwurf = await mit("POST", `/funds/${F1}/valuation-rounds`, { asOf: "2025-12-31", proposal: "carry_forward" });
    expect(rundenEntwurf.status).toBe(201);
    const runde = await json(rundenEntwurf);
    const bericht = await json(await mit("POST", "/reports", { art: "lp_bericht", fondsId: F1, stichtag: "2025-12-31" }));
    for (const [pfad, body] of [
      [`/valuations/${id}/approve`, undefined],
      [`/valuations/${id}/discard`, undefined],
      [`/valuation-rounds/${runde.round.id}/approve`, undefined],
      [`/valuation-rounds/${runde.round.id}/discard`, undefined],
      [`/reports/${bericht.id}/stage`, { stufe: STUFEN[0], ergebnis: "ok" }],
    ] as const) {
      const antwort = await mit("POST", pfad, body);
      expect(antwort.status, pfad).toBe(403);
      expect((await json(antwort)).error.code, pfad).toBe("technical_user");
    }
    const lesen = await mit("GET", `/valuations/${id}`);
    expect(lesen.status).toBe(200);
  });

  it("der Download der Datei (Entwurf wie freigegeben) schreibt eine Zeile `gelesen` ins Protokoll", async () => {
    const b = await json(await post("/reports", { art: "lp_bericht", fondsId: F1, stichtag: "2025-12-31" }, bearbeiter));
    expect(await protokollZeilen(db, "bericht", "gelesen")).toHaveLength(0);
    expect((await get(`/reports/${b.id}/file`, betrachter)).status).toBe(200);
    const zeilen = await protokollZeilen(db, "bericht", "gelesen");
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({ akteur: await idVon(db, betrachter), datensatz_id: b.id, vorher: null });
    expect(zeilen[0]!.nachher).toMatchObject({ bericht: "datei", freigegeben: false });
    // Kein Lese-Protokoll, wenn die Berechtigung fehlt
    expect((await get(`/reports/${b.id}/file`, nurFonds2)).status).toBe(403);
    expect(await protokollZeilen(db, "bericht", "gelesen")).toHaveLength(1);
  });
});

describe("Vier-Augen auf angemeldeten Personen", () => {
  it("Bewertung: weder der Ersteller noch ein anderer Zugang derselben Person gibt frei, eine andere Person schon; Ereignisbewertungen bleiben automatisch", async () => {
    const id = await entwurfId("2025-06-30", freigeber);
    const selbst = await post(`/bewertungen/${id}/freigeben`, undefined, freigeber);
    expect(selbst.status).toBe(409);
    expect((await json(selbst)).error.code).toBe("four_eyes_violated");
    const ok = await post(`/bewertungen/${id}/freigeben`, undefined, freigeber2);
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ status: "freigegeben", erstelltVon: await idVon(db, freigeber), freigegebenVon: await idVon(db, freigeber2) });

    // Ein Verkauf legt seine Bewertung selbst an und gibt sie sofort frei (`system:ereignis`).
    await post(`/investments/${ID.darlehen}/transactions`, { type: "commitment", valueDate: "2025-01-01", amount: "100000" }, bearbeiter);
    await post(`/investments/${ID.darlehen}/transactions`, { type: "disbursement", valueDate: "2025-02-01", amount: "100000" }, bearbeiter);
    expect((await post(`/beteiligungen/${ID.darlehen}/insolvenz`, { datum: "2025-09-30" }, bearbeiter)).status).toBe(200);
    const [ereignis] = await db.select().from(s.bewertung).where(eq(s.bewertung.beteiligungId, ID.darlehen));
    expect(ereignis).toMatchObject({ status: "freigegeben", freigegebenVon: "system:ereignis", erstelltVon: await idVon(db, bearbeiter) });
  });

  it("Runde: der Ersteller der Runde gibt sie nicht frei, eine andere Person gibt alle Entwürfe zusammen frei", async () => {
    await freigegeben("2025-03-31");
    const runde = await json(await post(`/fonds/${F1}/bewertungsrunde`, { stichtag: "2025-12-31", vorschlag: "fortschreiben" }, freigeber));
    const nein = await post(`/bewertungsrunden/${runde.runde.id}/freigeben`, undefined, freigeber);
    expect(nein.status).toBe(409);
    expect((await json(nein)).error.code).toBe("four_eyes_violated");
    const ja = await post(`/bewertungsrunden/${runde.runde.id}/freigeben`, undefined, freigeber2);
    expect(ja.status).toBe(200);
    expect(await json(ja)).toMatchObject({ freigegeben: 1 });
  });

  it("Bericht: wer je einen Abschnitt bearbeitet hat, gibt nicht frei, auch nicht, wenn jemand anderes den Text danach überschrieben hat", async () => {
    // Alle Beteiligten sind Freigeber; die Rolle erlaubt die Freigabe, das Vier-Augen-Prinzip nicht.
    const ersteller = freigeber;
    const alt = freigeber2;
    const neu = freigeber3;
    const unbeteiligt = person("freigeber4-e5", { rollen: { [F1]: "freigeber" } });
    const dritte = person("freigeber5-e5", { rollen: { [F1]: "freigeber" } });
    await legePersonAn(db, unbeteiligt);
    await legePersonAn(db, dritte);
    const b = await json(await post("/reports", { art: "lp_bericht", fondsId: F1, stichtag: "2025-12-31" }, ersteller));
    expect((await put(`/reports/${b.id}/sections/foreword`, { textDe: "Erster Text" }, alt)).status).toBe(200);
    expect((await put(`/reports/${b.id}/sections/foreword`, { textDe: "Überschriebener Text" }, neu)).status).toBe(200);
    // Der Abschnitt nennt nur noch den letzten Bearbeiter; der Verlauf steht im Änderungsprotokoll.
    const detail = await json(await get(`/reports/${b.id}`));
    expect(detail.abschnitte[0].geaendertVon).toBe(await idVon(db, neu));
    expect((await protokollZeilen(db, "bericht_abschnitt")).map((z) => z.akteur)).toEqual([await idVon(db, alt), await idVon(db, neu)]);

    for (const p of [ersteller, alt, neu]) {
      const antwort = await post(`/reports/${b.id}/stage`, { stufe: STUFEN[0], ergebnis: "ok" }, p);
      expect(antwort.status, p.name).toBe(409);
      expect((await json(antwort)).error.code, p.name).toBe("four_eyes_violated");
    }
    expect((await post(`/reports/${b.id}/stage`, { stufe: STUFEN[0], ergebnis: "ok" }, unbeteiligt)).status).toBe(200);
    // Auch auf der zweiten Stufe: weder Ersteller noch ein früherer Bearbeiter, noch wer die erste Stufe erteilt hat.
    for (const p of [ersteller, alt, neu, unbeteiligt]) {
      expect((await post(`/reports/${b.id}/stage`, { stufe: STUFEN[1], ergebnis: "ok" }, p)).status, p.name).toBe(409);
    }
    expect((await post(`/reports/${b.id}/stage`, { stufe: STUFEN[1], ergebnis: "ok" }, dritte)).status).toBe(200);
  });

  it("Bericht: eine Rückgabe (`zurueck`) braucht dagegen keine fremde Person, wohl aber einen Kommentar", async () => {
    const b = await json(await post("/reports", { art: "lp_bericht", fondsId: F1, stichtag: "2025-12-31" }, freigeber));
    expect((await post(`/reports/${b.id}/stage`, { stufe: STUFEN[0], ergebnis: "ok" }, freigeber2)).status).toBe(200);
    const ohne = await post(`/reports/${b.id}/stage`, { stufe: STUFEN[1], ergebnis: "zurueck" }, freigeber3);
    expect(ohne.status).toBe(400);
    const mit = await post(`/reports/${b.id}/stage`, { stufe: STUFEN[1], ergebnis: "zurueck", kommentar: "Zahlen prüfen" }, freigeber3);
    expect(mit.status).toBe(200);
    expect(await json(mit)).toMatchObject({ status: "entwurf", naechsteStufe: 0 });
  });
});

describe("Periodensperre bei Bewertungen, Runden und Verkaufs-Storno", () => {
  it("Freigabe, Ersetzung, neue Entwürfe und Runden mit Stichtag in gesperrter Periode scheitern mit gesperrtBis; ein Entwurf lässt sich verwerfen", async () => {
    const r1 = await freigegeben("2025-03-31");
    const ersatz = await entwurfId("2025-03-31"); // ersetzt r1 bei der Freigabe
    const altEntwurf = await entwurfId("2025-02-28");
    const rundeAlt = await json(await post(`/fonds/${F1}/bewertungsrunde`, { stichtag: "2025-06-30", vorschlag: "fortschreiben" }, bearbeiter));
    await sperre("2025-06-30");

    await gesperrt(await post(`/bewertungen/${ersatz}/freigeben`, undefined, freigeber), "2025-06-30");
    await gesperrt(await entwurf("2025-06-30"), "2025-06-30");
    await gesperrt(await post(`/fonds/${F1}/bewertungsrunde`, { stichtag: "2025-05-31", vorschlag: "fortschreiben" }, bearbeiter), "2025-06-30");
    await gesperrt(await post(`/bewertungsrunden/${rundeAlt.runde.id}/freigeben`, undefined, freigeber), "2025-06-30");
    // Nichts hat sich geändert: die freigegebene Bewertung gilt weiter
    const [noch] = await db.select().from(s.bewertung).where(eq(s.bewertung.id, r1.id));
    expect(noch).toMatchObject({ status: "freigegeben", ersetztAm: null });

    // Verwerfen bucht nichts und bleibt möglich (auch in der Datenbank, Migration 0019)
    expect((await post(`/bewertungen/${altEntwurf}/verwerfen`, undefined, freigeber)).status).toBe(200);
    expect((await post(`/bewertungsrunden/${rundeAlt.runde.id}/verwerfen`, undefined, freigeber)).status).toBe(200);
  });

  it("Übergänge außerhalb der gesperrten Periode laufen weiter: Freigabe und Ersetzung einer freigegebenen Bewertung nach dem Sperrdatum, auch per Runde", async () => {
    await freigegeben("2025-03-31");
    await sperre("2025-06-30");
    const a = await entwurfId("2025-09-30");
    expect((await post(`/bewertungen/${a}/freigeben`, undefined, freigeber)).status).toBe(200);
    const b = await entwurfId("2025-09-30"); // ersetzt a
    const ersetzt = await post(`/bewertungen/${b}/freigeben`, undefined, freigeber2);
    expect(ersetzt.status).toBe(200);
    expect(await json(ersetzt)).toMatchObject({ status: "freigegeben", ersetztBewertungId: a });
    const [alte] = await db.select().from(s.bewertung).where(eq(s.bewertung.id, a));
    expect(alte).toMatchObject({ status: "ersetzt" });
    expect(alte!.ersetztAm).not.toBeNull();

    const runde = await json(await post(`/fonds/${F1}/bewertungsrunde`, { stichtag: "2025-12-31", vorschlag: "fortschreiben" }, bearbeiter));
    expect(runde.bewertungen).toHaveLength(1);
    expect((await post(`/bewertungsrunden/${runde.runde.id}/freigeben`, undefined, freigeber)).status).toBe(200);
  });

  it("der Datenbank-Trigger blockiert Ersetzen und Freigeben in gesperrter Periode, auch an der API vorbei, und lässt Entwurf → verworfen zu", async () => {
    const r1 = await freigegeben("2025-03-31");
    const entwurfZeile = await entwurfId("2025-02-28");
    await sperre("2025-06-30");
    const fehler = async (abfrage: string, werte: unknown[]) => {
      try {
        await pool.query(abfrage, werte);
        return null;
      } catch (e) {
        return e as { code: string; detail: string };
      }
    };
    const ersetzen = await fehler("UPDATE bewertung SET status = 'ersetzt', ersetzt_am = now() WHERE id = $1", [r1.id]);
    expect(ersetzen).toMatchObject({ code: "PS001", detail: "2025-06-30" });
    const freigeben = await fehler("UPDATE bewertung SET status = 'freigegeben', freigegeben_von = 'x', freigegeben_am = now() WHERE id = $1", [entwurfZeile]);
    expect(freigeben).toMatchObject({ code: "PS001" });
    expect(await fehler("UPDATE bewertung SET status = 'verworfen' WHERE id = $1", [entwurfZeile])).toBeNull();
    expect(sperrdatumAus({ cause: ersetzen })).toBe("2025-06-30");
    expect(sperrdatumAus(new Error("anders"))).toBeNull();
  });

  it("die Antwort auf den Trigger-Fehler hat 409 period_locked mit gesperrtBis wie die API-Prüfung", async () => {
    const r1 = await freigegeben("2025-03-31");
    await sperre("2025-06-30");
    const app = new Hono().onError(behandleFehler).get("/probe", async () => {
      await db.execute(sql.raw(`UPDATE bewertung SET status = 'ersetzt', ersetzt_am = now() WHERE id = '${r1.id}'`));
      return new Response("ok");
    });
    const antwort = await app.request("/probe");
    await gesperrt(antwort, "2025-06-30");
  });

  it("Storno eines Verkaufs mit Datum in gesperrter Periode ist 409; außerhalb der Sperre gelingt es", async () => {
    await post(`/investments/${E}/transactions`, { type: "commitment", valueDate: "2025-01-01", amount: "1000000" }, bearbeiter);
    await post(`/investments/${E}/transactions`, { type: "disbursement", valueDate: "2025-02-01", amount: "500000" }, bearbeiter);
    const alt = await json(await post(`/beteiligungen/${E}/verkauf`, { datum: "2025-05-31", kaufpreis: "700000", anteilVerkauft: 1 }, bearbeiter));
    expect(alt.verkauf.id).toBeTruthy();
    // Der Verkauf gehört zu Fonds Eins: wer nur an Fonds Zwei Freigeber ist, darf ihn nicht stornieren (Auflösung über den Verkauf).
    expect((await post(`/verkaeufe/${alt.verkauf.id}/storno`, { grund: "Fremd" }, nurFonds2)).status).toBe(403);
    expect((await post(`/verkaeufe/${alt.verkauf.id}/storno`, { grund: "Nur lesen" }, betrachter)).status).toBe(403);
    await sperre("2025-06-30");
    await gesperrt(await post(`/verkaeufe/${alt.verkauf.id}/storno`, { grund: "Versehen" }, bearbeiter), "2025-06-30");
    const [verkauf] = await db.select().from(s.verkauf).where(eq(s.verkauf.id, alt.verkauf.id));
    expect(verkauf!.storniertAm).toBeNull();

    // Sperre zurückgenommen: das Storno geht
    expect((await put(`/fonds/${F1}/periodensperre`, { gesperrtBis: "2025-01-31", grund: "Korrektur" }, verwalter)).status).toBe(200);
    expect((await post(`/verkaeufe/${alt.verkauf.id}/storno`, { grund: "Versehen" }, bearbeiter)).status).toBe(201);
  });
});
