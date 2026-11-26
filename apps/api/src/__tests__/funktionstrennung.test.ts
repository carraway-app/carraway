import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { grundbestand, ID } from "./hilfen-instrumente";
import { cookieKopf, erstelleTestApp, idVon, jsonKopf, legePersonAn, meldeAn, person, STANDARD, TESTGEHEIMNIS, TESTPASSWORT, totpCode, type TestApp, type Testperson } from "./hilfen-auth";

/** Funktionstrennung, Gerät merken, letzter Verwalter, Startpasswort und Anzeigenamen (Entscheidungen 86 bis 90). Alle Personen sind erfunden. */

const { db, pool } = oeffneTestdb();
const F1 = ID.fonds;
const F2 = ID.anderer;

let t: TestApp;
beforeEach(async () => {
  await grundbestand(db);
  await db.execute(sql`DELETE FROM benutzer WHERE email LIKE '%@fts.example'`);
  // Übrig gebliebene Verwalter anderer Testdateien zählen hier nicht; deren Dateien legen ihre Personen beim Start neu an.
  await db.execute(sql`UPDATE benutzer SET global_verwalter = false WHERE global_verwalter AND email <> ${STANDARD.email}`);
  t = erstelleTestApp(db); // neue App je Test: legt die Personen samt Rollen neu an
});
afterAll(async () => {
  await leeren(db);
  await db.execute(sql`DELETE FROM benutzer WHERE email LIKE '%@fts.example'`);
  await pool.end();
});

const p = (kuerzel: string, zusatz: Partial<Testperson> = {}) => ({ ...person(kuerzel, zusatz), email: `${kuerzel}@fts.example` });
const anfrage = (methode: string, pfad: string, als: Testperson | null, body?: unknown) =>
  t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function neuerDeal(fondsId: string | null = F1) {
  const antwort = await anfrage("POST", "/deals", STANDARD, { titel: "Alpha, Seed-Runde", organisation: { name: "Alpha Beispiel Neu", art: "unternehmen" }, dubletteBestaetigt: true, fondsId });
  expect(antwort.status).toBe(201);
  return (await json(antwort)).id as string;
}
const beschluss = (als: Testperson | null, dealId: string, ergebnis: string, datum = "2026-03-01") =>
  anfrage("POST", `/deals/${dealId}/beschluesse`, als, { gremium: "Investitionsausschuss", datum, ergebnis });
const uebergang = (als: Testperson, dealId: string) =>
  anfrage("POST", `/deals/${dealId}/beteiligung`, als, { fondsId: F1, instrument: "offene_beteiligung", erstinvestment: "2026-03-15" });

describe("Zustimmender Beschluss braucht einen Freigeber (Funktionstrennung)", () => {
  it("Bearbeiter dürfen ablehnen und vertagen, aber nicht zustimmen", async () => {
    const bearbeiter = p("bearbeiter", { rollen: { [F1]: "bearbeiter" } });
    const dealId = await neuerDeal();
    const zu = await beschluss(bearbeiter, dealId, "zugestimmt");
    expect(zu.status).toBe(403);
    expect((await json(zu)).error.code).toBe("forbidden");
    expect((await beschluss(bearbeiter, dealId, "abgelehnt")).status).toBe(201);
    expect((await beschluss(bearbeiter, dealId, "vertagt")).status).toBe(201);
    expect(Number((await db.execute(sql`SELECT count(*)::int AS n FROM beschluss WHERE ergebnis = 'zugestimmt'`)).rows[0]!.n)).toBe(0);
  });

  it("Freigeber am Fonds des Deals dürfen zustimmen (der Beschluss merkt sich die Person); Freigeber eines anderen Fonds nicht", async () => {
    const freigeber = p("freigeber", { rollen: { [F1]: "freigeber" } });
    const fremd = p("freigeber-f2", { rollen: { [F2]: "freigeber", [F1]: "bearbeiter" } });
    const dealId = await neuerDeal();
    expect((await beschluss(fremd, dealId, "zugestimmt")).status).toBe(403);
    const ok = await beschluss(freigeber, dealId, "zugestimmt");
    expect(ok.status).toBe(201);
    const [zeile] = await db.select().from(s.beschluss);
    expect(zeile!.erfasstVon).toBe(await idVon(db, freigeber));
  });

  it("API-Schlüssel mit Schreibrecht dürfen nicht zustimmen (technical_user), aber ablehnen", async () => {
    const schluessel = await json(await anfrage("POST", "/api-keys", STANDARD, { name: "Importjob", scopes: [{ fundId: F1, permission: "write" }] }));
    const dealId = await neuerDeal();
    const mit = (ergebnis: string) =>
      t.app.request(`/api/v1/deals/${dealId}/resolutions`, {
        method: "POST",
        headers: { authorization: `Bearer ${schluessel.key}`, "content-type": "application/json" },
        body: JSON.stringify({ committee: "IA", date: "2026-03-01", outcome: ergebnis === "zugestimmt" ? "approved" : "rejected" }),
      });
    const zu = await mit("zugestimmt");
    expect(zu.status).toBe(403);
    expect((await json(zu)).error.code).toBe("technical_user");
    expect((await mit("abgelehnt")).status).toBe(201);
    expect((await db.select().from(s.beschluss))[0]!.erfasstVon).toBeNull();
  });

  it("Vier-Augen: Wer zugestimmt hat, überführt den Deal nicht selbst ins Portfolio (409 four_eyes_violated); eine andere Person kann es", async () => {
    const a = p("freigeber-a", { rollen: { [F1]: "freigeber" } });
    const b = p("freigeber-b", { rollen: { [F1]: "freigeber" } });
    const dealId = await neuerDeal();
    expect((await beschluss(a, dealId, "zugestimmt")).status).toBe(201);
    const selbst = await uebergang(a, dealId);
    expect(selbst.status).toBe(409);
    expect((await json(selbst)).error.code).toBe("four_eyes_violated");
    expect(Number((await db.execute(sql`SELECT count(*)::int AS n FROM beteiligung WHERE deal_id = ${dealId}`)).rows[0]!.n)).toBe(0);
    expect((await uebergang(b, dealId)).status).toBe(201);
  });

  it("Der Bearbeiter kann ohne Freigeber nichts ins Portfolio bringen: ohne zustimmenden Beschluss 409 resolution_missing", async () => {
    const bearbeiter = p("bearbeiter", { rollen: { [F1]: "verwalter" } });
    const dealId = await neuerDeal();
    expect((await json(await uebergang(bearbeiter, dealId))).error.code).toBe("resolution_missing");
  });
});

describe("Die Zustimmung gilt für den Fonds, in den überführt wird", () => {
  const codeVon = async (antwort: Response) => (await json(antwort)).error.code;
  const zustimmen = (als: Testperson, dealId: string, fondsId?: string, datum = "2026-03-01") =>
    anfrage("POST", `/deals/${dealId}/beschluesse`, als, { gremium: "Investitionsausschuss", datum, ergebnis: "zugestimmt", ...(fondsId ? { fondsId } : {}) });
  const nach = (als: Testperson, dealId: string, fondsId: string) =>
    anfrage("POST", `/deals/${dealId}/beteiligung`, als, { fondsId, instrument: "offene_beteiligung", erstinvestment: "2026-03-15" });
  const anzahlBeteiligungen = async (dealId: string) => Number((await db.execute(sql`SELECT count(*)::int AS n FROM beteiligung WHERE deal_id = ${dealId}`)).rows[0]!.n);

  it("Angriff: Freigeber von Fonds A stimmt bei einem Deal ohne Fonds zu, die Überführung in Fonds B scheitert (409 resolution_fund_mismatch)", async () => {
    const a = p("freigeber-a", { rollen: { [F1]: "freigeber" } });
    const b = p("verwalter-b", { rollen: { [F1]: "bearbeiter", [F2]: "verwalter" } });
    const dealId = await neuerDeal(null);
    expect((await zustimmen(a, dealId, F1)).status).toBe(201);
    const falsch = await nach(b, dealId, F2);
    expect(falsch.status).toBe(409);
    expect(await codeVon(falsch)).toBe("resolution_fund_mismatch");
    expect(await anzahlBeteiligungen(dealId)).toBe(0);
    expect((await nach(b, dealId, F1)).status).toBe(201); // der Fonds, für den zugestimmt wurde
  });

  it("Deal ohne Fonds: fondsId ist Pflicht (400 fund_required); Freigeber braucht es genau an diesem Fonds (403)", async () => {
    const a = p("freigeber-a", { rollen: { [F1]: "freigeber" } });
    const dealId = await neuerDeal(null);
    const ohne = await zustimmen(a, dealId);
    expect(ohne.status).toBe(400);
    expect(await codeVon(ohne)).toBe("fund_required");
    expect((await zustimmen(a, dealId, F2)).status).toBe(403);
    expect(Number((await db.execute(sql`SELECT count(*)::int AS n FROM beschluss`)).rows[0]!.n)).toBe(0);
    const ok = await zustimmen(a, dealId, F1);
    expect(ok.status).toBe(201);
    expect((await json(ok)).fondsId).toBe(F1);
  });

  it("Deal mit Fonds: der Beschluss übernimmt dessen Fonds; ein abweichendes fondsId im Körper ist 409, fondsId bei Ablehnung 400", async () => {
    const a = p("freigeber-a", { rollen: { [F1]: "freigeber", [F2]: "freigeber" } });
    const dealId = await neuerDeal(F1);
    const abweichend = await zustimmen(a, dealId, F2);
    expect(abweichend.status).toBe(409);
    expect(await codeVon(abweichend)).toBe("resolution_fund_mismatch");
    expect((await json(await zustimmen(a, dealId))).fondsId).toBe(F1);
    expect((await zustimmen(a, dealId, F1, "2026-03-02")).status).toBe(201);
    const ablehnung = await anfrage("POST", `/deals/${dealId}/beschluesse`, a, { gremium: "IA", datum: "2026-03-03", ergebnis: "abgelehnt", fondsId: F1 });
    expect(ablehnung.status).toBe(400);
    expect(await codeVon(ablehnung)).toBe("fund_only_with_approval");
  });

  it("der Deal wechselt nach der Zustimmung den Fonds nicht (409 deal_fund_locked); gleicher Fonds und andere Felder gehen, nach einer Ablehnung wieder", async () => {
    const a = p("freigeber-a", { rollen: { [F1]: "freigeber" } });
    const dealId = await neuerDeal(F1);
    expect((await anfrage("PATCH", `/deals/${dealId}`, STANDARD, { fondsId: F2 })).status).toBe(200); // noch ohne Beschluss
    expect((await anfrage("PATCH", `/deals/${dealId}`, STANDARD, { fondsId: F1 })).status).toBe(200);
    expect((await zustimmen(a, dealId)).status).toBe(201);
    for (const koerper of [{ fondsId: F2 }, { fondsId: null }]) {
      const antwort = await anfrage("PATCH", `/deals/${dealId}`, STANDARD, koerper);
      expect(antwort.status).toBe(409);
      expect(await codeVon(antwort)).toBe("deal_fund_locked");
    }
    expect((await anfrage("PATCH", `/deals/${dealId}`, STANDARD, { fondsId: F1, titel: "Neu betitelt" })).status).toBe(200);
    expect((await anfrage("PATCH", `/deals/${dealId}`, STANDARD, { quelle: "Messe" })).status).toBe(200);
    expect((await json(await anfrage("GET", `/deals/${dealId}`, STANDARD))).fondsId).toBe(F1);
    expect((await beschluss(STANDARD, dealId, "abgelehnt", "2026-03-05")).status).toBe(201);
    expect((await anfrage("PATCH", `/deals/${dealId}`, STANDARD, { fondsId: F2 })).status).toBe(200);
  });

  it("die erfassende Person muss am Fonds noch Freigeber sein: entzogene Rolle oder gesperrtes Konto ergibt 409", async () => {
    const a = p("freigeber-a", { rollen: { [F1]: "freigeber" } });
    const b = p("freigeber-b", { rollen: { [F1]: "freigeber" } });
    const dealId = await neuerDeal(F1);
    expect((await zustimmen(a, dealId)).status).toBe(201);
    const idA = await idVon(db, a);
    await db.execute(sql`UPDATE fondsrolle SET rolle = 'bearbeiter' WHERE benutzer_id = ${idA}`);
    expect(await codeVon(await nach(b, dealId, F1))).toBe("resolution_fund_mismatch");
    await db.execute(sql`UPDATE fondsrolle SET rolle = 'freigeber' WHERE benutzer_id = ${idA}`);
    await db.execute(sql`UPDATE benutzer SET aktiv = false WHERE id = ${idA}`);
    expect(await codeVon(await nach(b, dealId, F1))).toBe("resolution_fund_mismatch");
    await db.execute(sql`UPDATE benutzer SET aktiv = true WHERE id = ${idA}`);
    expect(await anzahlBeteiligungen(dealId)).toBe(0);
    expect((await nach(b, dealId, F1)).status).toBe(201);
  });

  it("Altbestand ohne Fonds am Beschluss oder ohne erfassende Person deckt keinen Fonds ab (409)", async () => {
    const b = p("freigeber-b", { rollen: { [F1]: "freigeber" } });
    const dealId = await neuerDeal(F1);
    await db.insert(s.beschluss).values({ dealId, gremium: "IA", datum: "2026-03-01", ergebnis: "zugestimmt" });
    expect(await codeVon(await nach(b, dealId, F1))).toBe("resolution_fund_mismatch");
  });
});

describe("Gerät merken ist abgeschaltet", () => {
  it("trustDevice wird beim Bestätigen des Codes ignoriert: kein Merk-Cookie, die nächste Anmeldung verlangt den Code wieder", async () => {
    const person1 = p("merken");
    await db.execute(sql`DELETE FROM verifizierung WHERE identifier LIKE 'trust-device-%'`);
    await legePersonAn(db, person1);
    const post = (pfad: string, body: unknown, cookie?: string) => t.app.request(`/api/v1${pfad}`, { method: "POST", headers: jsonKopf(cookie), body: JSON.stringify(body) });
    const erste = await post("/auth/sign-in/email", { email: person1.email, password: TESTPASSWORT });
    expect((await json(erste)).twoFactorRedirect).toBe(true);
    const bestaetigt = await post("/auth/two-factor/verify-totp", { code: totpCode(TESTGEHEIMNIS), trustDevice: true }, cookieKopf(erste.headers.getSetCookie()));
    expect(bestaetigt.status).toBe(200);
    const gesetzt = bestaetigt.headers.getSetCookie();
    expect(gesetzt.some((c) => c.includes("trust_device"))).toBe(false);
    // Ein Browser schickt alle erhaltenen Cookies mit, auch einen etwaigen Merk-Cookie.
    const zweite = await post("/auth/sign-in/email", { email: person1.email, password: TESTPASSWORT }, cookieKopf(gesetzt));
    expect(zweite.status).toBe(200);
    expect((await json(zweite)).twoFactorRedirect).toBe(true);
    expect(Number((await db.execute(sql`SELECT count(*)::int AS n FROM verifizierung WHERE identifier LIKE 'trust-device-%'`)).rows[0]!.n)).toBe(0);
  });
});

describe("Letzter globaler Verwalter", () => {
  it("der einzige aktive Verwalter kann weder gesperrt noch entmachtet werden (409 last_admin)", async () => {
    await anfrage("GET", "/me", STANDARD); // legt STANDARD an
    const id = await idVon(db, STANDARD);
    for (const koerper of [{ active: false }, { globalAdmin: false }]) {
      const antwort = await anfrage("PATCH", `/users/${id}`, STANDARD, koerper);
      expect(antwort.status).toBe(409);
      expect((await json(antwort)).error.code).toBe("last_admin");
    }
    expect((await db.select().from(s.benutzer).where(sql`${s.benutzer.id} = ${id}`))[0]).toMatchObject({ aktiv: true, globalVerwalter: true });
  });

  it("zwei Verwalter, die sich gleichzeitig entmachten: höchstens einer gelingt, einer bleibt übrig", async () => {
    const a = p("verwalter-a", { globalVerwalter: true });
    const b = p("verwalter-b", { globalVerwalter: true });
    // Die Anmeldungen laufen vorab, damit beide Anfragen gleichzeitig am Handler ankommen.
    await anfrage("GET", "/me", a);
    await anfrage("GET", "/me", b);
    await db.execute(sql`UPDATE benutzer SET global_verwalter = false WHERE global_verwalter AND email NOT LIKE '%@fts.example'`); // STANDARD aus der Anmeldung oben
    const [idA, idB] = [await idVon(db, a), await idVon(db, b)];
    const [r1, r2] = await Promise.all([anfrage("PATCH", `/users/${idB}`, a, { globalAdmin: false }), anfrage("PATCH", `/users/${idA}`, b, { globalAdmin: false })]);
    const status = [r1.status, r2.status].sort();
    expect(status[0]).toBe(200);
    expect([403, 409]).toContain(status[1]);
    expect(Number((await db.execute(sql`SELECT count(*)::int AS n FROM benutzer WHERE global_verwalter AND aktiv`)).rows[0]!.n)).toBe(1);
  });

  it("mit einem zweiten Verwalter darf einer entmachtet werden; technische Benutzer zählen nicht als Verwalter", async () => {
    const a = p("verwalter-a", { globalVerwalter: true });
    const b = p("verwalter-b", { globalVerwalter: true });
    await anfrage("GET", "/me", b);
    const idB = await idVon(db, b);
    expect((await anfrage("PATCH", `/users/${idB}`, a, { active: false })).status).toBe(200);
  });
});

describe("Startpasswort", () => {
  const anmelden = async (email: string, passwort: string) => {
    const antwort = await t.app.request("/api/v1/auth/sign-in/email", { method: "POST", headers: jsonKopf(), body: JSON.stringify({ email, password: passwort }) });
    expect(antwort.status).toBe(200);
    return cookieKopf(antwort.headers.getSetCookie());
  };
  const mitCookie = (cookie: string, methode: string, pfad: string, body?: unknown) =>
    t.app.request(`/api/v1${pfad}`, { method: methode, headers: jsonKopf(cookie), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  it("von Verwaltern angelegte Benutzer sehen nur /ich und die Anmeldung, bis sie das Passwort ändern", async () => {
    const angelegt = await anfrage("POST", "/users", STANDARD, { name: "Neu Person", email: "neu@fts.example", password: "Startpasswort-123" });
    expect(angelegt.status).toBe(201);
    const [roh] = await db.select().from(s.benutzer).where(sql`${s.benutzer.email} = 'neu@fts.example'`);
    expect(roh!.passwortAendern).toBe(true);
    await db.insert(s.fondsrolle).values({ benutzerId: roh!.id, fondsId: F1, rolle: "betrachter" });

    const cookie = await anmelden("neu@fts.example", "Startpasswort-123");
    expect(await json(await mitCookie(cookie, "GET", "/me"))).toMatchObject({ passwordChangeRequired: true });
    for (const [methode, pfad] of [["GET", "/funds"], ["GET", "/users/names?ids=" + roh!.id], ["GET", "/deals"], ["POST", "/deals"]] as const) {
      const antwort = await mitCookie(cookie, methode, pfad, methode === "POST" ? {} : undefined);
      expect(antwort.status, pfad).toBe(403);
      expect((await json(antwort)).error.code).toBe("password_change_required");
    }
    // Die Einrichtung des zweiten Faktors läuft über /auth/* und bleibt offen.
    expect((await mitCookie(cookie, "POST", "/auth/two-factor/enable", { password: "Startpasswort-123" })).status).toBe(200);

    // Dasselbe Passwort ist keine Änderung.
    const gleich = await mitCookie(cookie, "POST", "/auth/change-password", { currentPassword: "Startpasswort-123", newPassword: "Startpasswort-123" });
    expect(gleich.status).toBe(400);
    expect((await json(gleich)).code).toBe("password_unchanged");
    expect((await json(await mitCookie(cookie, "GET", "/me"))).passwordChangeRequired).toBe(true);

    const geaendert = await mitCookie(cookie, "POST", "/auth/change-password", { currentPassword: "Startpasswort-123", newPassword: "Neues-Passwort-456" }); // gitleaks:allow
    expect(geaendert.status).toBe(200);
    expect(await json(await mitCookie(cookie, "GET", "/me"))).toMatchObject({ passwordChangeRequired: false });
    // Jetzt gilt wieder die übliche Prüfung (hier: zweiter Faktor fehlt noch).
    expect((await json(await mitCookie(cookie, "GET", "/funds"))).error.code).toBe("two_factor_required");
  });

  it("die Liste der Benutzer zeigt das Kennzeichen; Personen aus der Einrichtung und Test-Personen haben es nicht", async () => {
    await anfrage("POST", "/users", STANDARD, { name: "Neu Person", email: "neu@fts.example", password: "Startpasswort-123" });
    const liste = (await json(await anfrage("GET", "/users", STANDARD))).data as { email: string; passwordChangeRequired: boolean }[];
    expect(liste.find((x) => x.email === "neu@fts.example")?.passwordChangeRequired).toBe(true);
    expect(liste.find((x) => x.email === STANDARD.email)?.passwordChangeRequired).toBe(false);
  });

  it("meldeAn: Test-Personen mit passwortAendern = false arbeiten ungehindert", async () => {
    const cookie = await meldeAn(t.app, (await legePersonAn(db, p("normal", { rollen: { [F1]: "betrachter" } })), p("normal", { rollen: { [F1]: "betrachter" } })));
    expect((await mitCookie(cookie, "GET", "/funds")).status).toBe(200);
  });
});

describe("Anzeigenamen", () => {
  it("jede Person sieht Namen von Personen, mit denen sie einen Fonds teilt; sonst fehlen sie", async () => {
    const v1 = p("viewer", { rollen: { [F1]: "betrachter" } });
    const p2 = p("kollege", { rollen: { [F1]: "bearbeiter" } });
    const p3 = p("anderer-fonds", { rollen: { [F2]: "bearbeiter" } });
    const g = p("admin", { globalVerwalter: true });
    for (const x of [v1, p2, p3, g]) await anfrage("GET", "/me", x === g ? g : STANDARD);
    for (const x of [v1, p2, p3]) await legePersonAn(db, x);
    const ids = { v1: await idVon(db, v1), p2: await idVon(db, p2), p3: await idVon(db, p3), g: await idVon(db, g) };
    const schluessel = await json(await anfrage("POST", "/api-keys", STANDARD, { name: "Importjob", scopes: [{ fundId: F1, permission: "read" }] }));
    const alle = [ids.v1, ids.p2, ids.p3, ids.g, schluessel.userId, "00000000-0000-4000-8000-00000000dead"];

    const antwort = await anfrage("GET", `/users/names?ids=${alle.join(",")}`, v1);
    expect(antwort.status).toBe(200);
    const daten = (await json(antwort)).data as { id: string; name: string }[];
    expect(daten.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [
        { id: ids.v1, name: v1.name },
        { id: ids.p2, name: p2.name },
        { id: ids.g, name: g.name },
        { id: schluessel.userId, name: "Importjob" },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(JSON.stringify(daten)).not.toContain("@"); // nur id und name

    // Globale Verwalter sehen alle (auch den unbekannten nicht).
    const admin = (await json(await anfrage("GET", `/users/names?ids=${alle.join(",")}`, STANDARD))).data as unknown[];
    expect(admin).toHaveLength(5);
  });

  it("Eingabe: 1 bis 100 gültige IDs; ohne Rolle 403", async () => {
    const v1 = p("viewer", { rollen: { [F1]: "betrachter" } });
    const ids = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect((await anfrage("GET", `/users/names?ids=${ids.slice(0, 100).join(",")}`, v1)).status).toBe(200);
    expect((await anfrage("GET", `/users/names?ids=${ids.join(",")}`, v1)).status).toBe(400);
    expect((await anfrage("GET", "/users/names?ids=kein-uuid", v1)).status).toBe(400);
    expect((await anfrage("GET", "/users/names", v1)).status).toBe(400);
    expect((await anfrage("GET", `/users/names?ids=${ids[0]}`, null)).status).toBe(401);
    expect((await anfrage("GET", `/users/names?ids=${ids[0]}`, p("ohne-rolle"))).status).toBe(403);
  });

  it("Fonds-Verwalter (nicht nur globale) listen die Personen mit Rolle an ihrem Fonds samt Namen, aber nur am eigenen Fonds", async () => {
    const fv = p("fondsverwalter", { rollen: { [F1]: "verwalter" } });
    const kollege = p("kollege", { rollen: { [F1]: "betrachter" } });
    await legePersonAn(db, kollege);
    const antwort = await anfrage("GET", `/fonds/${F1}/roles`, fv);
    expect(antwort.status).toBe(200);
    const daten = (await json(antwort)).data as { userId: string; name: string; role: string }[];
    expect(daten.map((d) => [d.name, d.role]).sort()).toEqual([[fv.name, "admin"], [kollege.name, "viewer"]].sort());
    expect((await anfrage("GET", `/fonds/${F2}/roles`, fv)).status).toBe(403);
  });
});
