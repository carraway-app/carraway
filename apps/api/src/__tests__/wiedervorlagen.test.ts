import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { heute } from "../schreiben";
import { erstelleTestApp, idVon, legePersonAn, person, type Testperson } from "./hilfen-auth";
import { json, oeffneTestdb } from "./hilfen";
import { grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";

/** Etappe 7: Wiedervorlagen je zuständiger Person, Zähler, Zurückstellen und Tageszusammenfassung. Alle Daten sind erfunden. */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);

const F1 = ID.fonds;
const F2 = ID.anderer;
const anna = person("anna-wv", { rollen: { [F1]: "bearbeiter" } });
const bernd = person("bernd-wv", { rollen: { [F1]: "bearbeiter" } });
const nurF2 = person("nur-f2-wv", { rollen: { [F2]: "bearbeiter" } });
const betrachter = person("betrachter-wv", { rollen: { [F1]: "betrachter" } });

const tag = (n: number) => {
  const d = new Date(`${heute()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const senden = (methode: string, pfad: string, als: Testperson, koerper?: unknown) =>
  t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(koerper === undefined ? {} : { body: JSON.stringify(koerper) }) });
const lege = (als: Testperson, titel: string, wiedervorlage: string | undefined, extra: Record<string, unknown> = {}) =>
  senden("POST", "/aktivitaeten", als, { art: "notiz", datum: tag(-30), titel, organisationId: ID.orgA, ...(wiedervorlage ? { wiedervorlage } : {}), ...extra });

beforeEach(async () => {
  await grundbestand(db);
  for (const p of [anna, bernd, nurF2, betrachter]) await legePersonAn(db, p);
});
afterAll(async () => {
  await pool.end();
});

describe("Zuständigkeit", () => {
  it("setzt die anlegende Person als zuständig, wenn nichts genannt wird, und nimmt eine andere aktive Person, wenn genannt", async () => {
    const annaId = await idVon(db, anna);
    const berndId = await idVon(db, bernd);
    const eigene = await json(await lege(anna, "Eigene", tag(1)));
    expect(eigene.zustaendig).toBe(annaId);
    const delegiert = await json(await lege(anna, "Für Bernd", tag(1), { zustaendigId: berndId }));
    expect(delegiert.zustaendig).toBe(berndId);
    // ohne Wiedervorlage gibt es keine Zuständigkeit
    expect((await json(await lege(anna, "Nur Notiz", undefined))).zustaendig).toBeNull();
    expect((await lege(anna, "Zuständig ohne Termin", undefined, { zustaendigId: berndId })).status).toBe(400);

    // unbekannt, gesperrt und technisch sind keine gültigen Zuständigen
    expect((await lege(anna, "X", tag(1), { zustaendigId: randomUUID() })).status).toBe(400);
    expect((await json(await lege(anna, "X", tag(1), { zustaendigId: randomUUID() }))).error.code).toBe("assignee_invalid");
    const gesperrt = person("gesperrt-wv", { aktiv: false });
    await legePersonAn(db, gesperrt);
    expect((await lege(anna, "X", tag(1), { zustaendigId: await idVon(db, gesperrt) })).status).toBe(400);
    const [technisch] = await db.insert(s.benutzer).values({ name: "Technisch", email: "technisch-wv@test.example", technisch: true }).returning();
    expect((await lege(anna, "X", tag(1), { zustaendigId: technisch!.id })).status).toBe(400);
  });
});

describe("Liste, Zähler und Zusammenfassung", () => {
  it("filtert nach Zuständigkeit (ich oder alle) und Datum und zählt überfällig und heute je angemeldeter Person", async () => {
    const berndId = await idVon(db, bernd);
    await lege(anna, "Überfällig", tag(-3));
    await lege(anna, "Heute", tag(0));
    await lege(anna, "Morgen", tag(1));
    await lege(anna, "Später", tag(20));
    await lege(anna, "Für Bernd überfällig", tag(-1), { zustaendigId: berndId });
    await lege(bernd, "Berndheute", tag(0));

    const ich = await json(await senden("GET", "/wiedervorlagen?zustaendig=ich", anna));
    expect(ich.daten.map((z: { titel: string }) => z.titel)).toEqual(["Überfällig", "Heute"]);
    expect(ich.daten[0]).toMatchObject({ ueberfaellig: true, zustaendigId: await idVon(db, anna) });
    expect(ich.daten[1].ueberfaellig).toBe(false);
    const alle = await json(await senden("GET", "/wiedervorlagen", anna));
    // gleiche Tage in beliebiger Reihenfolge, sonst nach Datum
    expect(alle.daten.map((z: { titel: string }) => z.titel).slice(0, 2)).toEqual(["Überfällig", "Für Bernd überfällig"]);
    expect(alle.daten.map((z: { titel: string }) => z.titel).slice(2).sort()).toEqual(["Berndheute", "Heute"]);
    const bis = await json(await senden("GET", `/wiedervorlagen?zustaendig=ich&bis=${tag(1)}`, anna));
    expect(bis.daten.map((z: { titel: string }) => z.titel)).toEqual(["Überfällig", "Heute", "Morgen"]);

    expect(await json(await senden("GET", "/wiedervorlagen/anzahl", anna))).toEqual({ ueberfaellig: 1, heute: 1, gesamt: 2 });
    expect(await json(await senden("GET", "/wiedervorlagen/anzahl", bernd))).toEqual({ ueberfaellig: 1, heute: 1, gesamt: 2 });
    expect(await json(await senden("GET", "/wiedervorlagen/anzahl", betrachter))).toEqual({ ueberfaellig: 0, heute: 0, gesamt: 0 });

    const digest = await json(await senden("GET", "/wiedervorlagen/zusammenfassung", anna));
    expect(digest).toMatchObject({ datum: heute(), benutzer: { name: "Testperson anna-wv" }, anzahl: { ueberfaellig: 1, heute: 1, kommende: 1 } });
    expect(digest.ueberfaellig.map((z: { titel: string }) => z.titel)).toEqual(["Überfällig"]);
    expect(digest.heute.map((z: { titel: string }) => z.titel)).toEqual(["Heute"]);
    // "Später" liegt jenseits der sieben Tage
    expect(digest.kommende.map((z: { titel: string }) => z.titel)).toEqual(["Morgen"]);
  });

  it("zeigt Wiedervorlagen zu Deals fremder Fonds nicht", async () => {
    const [d2] = await db.insert(s.deal).values({ organisationId: ID.orgB, fondsId: F2, titel: "Deal Fonds Zwei" }).returning();
    await db.insert(s.aktivitaet).values({ art: "notiz", datum: tag(-5), titel: "Fremd", dealId: d2!.id, wiedervorlage: tag(0), zustaendig: await idVon(db, anna) });
    await lege(anna, "Eigen", tag(0));
    const meine = await json(await senden("GET", "/wiedervorlagen?zustaendig=ich", anna));
    expect(meine.daten.map((z: { titel: string }) => z.titel)).toEqual(["Eigen"]);
    expect((await json(await senden("GET", "/wiedervorlagen/anzahl", anna))).gesamt).toBe(1);
    expect((await json(await senden("GET", "/wiedervorlagen", nurF2))).daten.map((z: { titel: string }) => z.titel)).toContain("Fremd");
  });
});

describe("Erledigen und Zurückstellen", () => {
  it("stellt auf ein neues Datum zurück (Protokoll), erledigt und weist unpassende Fälle ab", async () => {
    const a = await json(await lege(anna, "Zurückstellen", tag(-2)));
    expect((await json(await senden("GET", "/wiedervorlagen/anzahl", anna))).ueberfaellig).toBe(1);

    const neu = await senden("POST", `/aktivitaeten/${a.id}/zurueckstellen`, anna, { datum: tag(7) });
    expect(neu.status).toBe(200);
    expect((await json(neu)).wiedervorlage).toBe(tag(7));
    expect(await json(await senden("GET", "/wiedervorlagen/anzahl", anna))).toEqual({ ueberfaellig: 0, heute: 0, gesamt: 0 });
    const protokoll = await protokollZeilen(db, "aktivitaet", "zurueckstellen");
    expect(protokoll).toHaveLength(1);
    expect(protokoll[0]).toMatchObject({ vorher: expect.objectContaining({ wiedervorlage: tag(-2) }), nachher: expect.objectContaining({ wiedervorlage: tag(7) }) });

    expect((await senden("POST", `/aktivitaeten/${a.id}/zurueckstellen`, anna, { datum: tag(-1) })).status).toBe(400);
    expect((await senden("POST", `/aktivitaeten/${a.id}/zurueckstellen`, anna, { datum: "kein Datum" })).status).toBe(400);
    expect((await senden("POST", `/aktivitaeten/${randomUUID()}/zurueckstellen`, anna, { datum: tag(1) })).status).toBe(404);
    expect((await senden("POST", `/aktivitaeten/${a.id}/zurueckstellen`, betrachter, { datum: tag(8) })).status).toBe(403);

    expect((await senden("POST", `/aktivitaeten/${a.id}/erledigt`, anna)).status).toBe(200);
    const erledigt = await senden("POST", `/aktivitaeten/${a.id}/zurueckstellen`, anna, { datum: tag(9) });
    expect(erledigt.status).toBe(409);
    expect((await json(erledigt)).error.code).toBe("no_follow_up");
    const ohneTermin = await json(await lege(anna, "Ohne Termin", undefined));
    expect((await senden("POST", `/aktivitaeten/${ohneTermin.id}/zurueckstellen`, anna, { datum: tag(1) })).status).toBe(409);
  });

  it("Zurückstellen verlangt Bearbeiter am Fonds des Deals", async () => {
    const [d2] = await db.insert(s.deal).values({ organisationId: ID.orgB, fondsId: F2, titel: "Deal Fonds Zwei" }).returning();
    const [a] = await db.insert(s.aktivitaet).values({ art: "notiz", datum: tag(-5), titel: "Fremd", dealId: d2!.id, wiedervorlage: tag(0) }).returning();
    expect((await senden("POST", `/aktivitaeten/${a!.id}/zurueckstellen`, anna, { datum: tag(3) })).status).toBe(403);
    expect((await senden("POST", `/aktivitaeten/${a!.id}/zurueckstellen`, nurF2, { datum: tag(3) })).status).toBe(200);
  });
});

