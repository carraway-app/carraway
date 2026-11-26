import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erzeugeSchluessel } from "../anmeldung/akteur";
import { Schluesselring } from "../geheimnis/krypto";
import { BEREICHE } from "../rechte/bereiche";
import { echterSender, pruefeSignatur, signiere, type SendeAnfrage, type Sender } from "../webhooks/senden";
import { pruefeWebhookAdresse, pruefeWebhookZiel, ZielFehler } from "../webhooks/ziel";
import { ABSCHALTEN_NACH, geheimnisAad, stelleZu, verteileWebhooks, type ZustellJob } from "../webhooks/zustellung";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, idVon, legePersonAn, person, type Testperson } from "./hilfen-auth";

/**
 * Webhooks (#154): Ziele nur https mit öffentlicher Adresse (auch nach der Auflösung), Signatur mit Zeitstempel, Geheimnis nur einmal und nur
 * verschlüsselt, Zustellung nur dessen, was der Eigentümer zum Zeitpunkt der Zustellung sieht, Wiederholung und Abschaltung, Protokoll ohne
 * Nutzdaten. Kein Test erreicht einen echten Host: Auflösung und Versand sind Fakes.
 */

const { db, pool } = oeffneTestdb();
const ring = new Schluesselring(randomBytes(32));

const DNS: Record<string, string[]> = {
  "hooks.example.com": ["93.184.216.34"],
  "intern.example.com": ["10.0.0.5"],
  "gemischt.example.com": ["93.184.216.34", "127.0.0.1"],
  "metadaten.example.com": ["169.254.169.254"],
  "v6.example.com": ["::ffff:127.0.0.1"],
};
let dns = { ...DNS };
const aufloeser = async (host: string) => {
  const treffer = dns[host];
  if (!treffer) throw new Error("ENOTFOUND");
  return treffer;
};

const FONDS_A = randomUUID();
const FONDS_B = randomUUID();
const anna = person("wh-anna", { rollen: { [FONDS_A]: "betrachter" } });
const bernd = person("wh-bernd", { rollen: { [FONDS_B]: "betrachter" } });

const t = erstelleTestApp(db, { schluessel: ring, aufloeser });

const post = (pfad: string, koerper: unknown, als?: Testperson) =>
  t.request(pfad, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(koerper), ...(als ? { als } : {}) });

/** Versand-Fake: merkt sich die Anfragen und antwortet mit `status` (oder wirft). */
function fakeSender(antwort: number | Error = 200) {
  const anfragen: SendeAnfrage[] = [];
  const sender: Sender = async (a) => {
    anfragen.push(a);
    if (antwort instanceof Error) throw antwort;
    return { status: antwort };
  };
  return { anfragen, sender };
}

async function aenderung(fondsId: string | null, tabelle = "beteiligung"): Promise<string> {
  const [z] = await db.insert(s.aenderung).values({ akteur: "system", aktion: "anlegen", tabelle, datensatzId: randomUUID(), fondsId, vorher: null, nachher: { name: "Beispiel GmbH", fondsId } }).returning({ id: s.aenderung.id });
  return z!.id;
}

async function verteile(): Promise<ZustellJob[]> {
  const jobs: ZustellJob[] = [];
  await verteileWebhooks(db, async (j) => jobs.push(j));
  return jobs;
}

async function legeWebhookAn(als: Testperson, zusatz: Record<string, unknown> = {}) {
  const antwort = await post("/webhooks", { url: "https://hooks.example.com/eingang", ...zusatz }, als);
  expect(antwort.status).toBe(201);
  return (await json(antwort)) as { id: string; secret: string; apiKeyId: string | null };
}

const zustellungen = (webhookId: string) => db.select().from(s.webhookZustellung).where(eq(s.webhookZustellung.webhookId, webhookId));
const endpunkt = async (id: string) => (await db.select().from(s.webhook).where(eq(s.webhook.id, id)))[0]!;

beforeEach(async () => {
  await leeren(db);
  await db.execute(sql`TRUNCATE TABLE webhook_zustellung, webhook_ausgang, webhook CASCADE`);
  dns = { ...DNS };
  await db.insert(s.fonds).values([
    { id: FONDS_A, name: "Fonds A", kurzname: "WH-A", vintage: 2024, zeichnungskapital: "1000000.00" },
    { id: FONDS_B, name: "Fonds B", kurzname: "WH-B", vintage: 2024, zeichnungskapital: "1000000.00" },
  ]);
  // Rollen neu schreiben (die Test-App legt Personen nur einmal an; `leeren` entfernt die Fonds und damit die Rollen)
  for (const p of [anna, bernd]) {
    const id = await idVon(db, p).catch(() => null);
    if (!id) continue;
    await db.update(s.benutzer).set({ aktiv: true }).where(eq(s.benutzer.id, id));
    await db.insert(s.fondsrolle).values(Object.entries(p.rollen ?? {}).map(([fondsId, rolle]) => ({ benutzerId: id, fondsId, rolle }))).onConflictDoNothing();
  }
});

afterAll(async () => {
  await db.execute(sql`TRUNCATE TABLE webhook_zustellung, webhook_ausgang, webhook CASCADE`);
  await pool.end();
});

describe("Ziele der Webhooks (SSRF)", () => {
  it("lehnt alles außer https mit Hostnamen ab", () => {
    const code = (url: string) => {
      try {
        pruefeWebhookAdresse(url);
        return "ok";
      } catch (e) {
        return (e as ZielFehler).code;
      }
    };
    expect(code("https://hooks.example.com/x")).toBe("ok");
    expect(code("https://hooks.example.com:8443/x")).toBe("ok");
    expect(code("http://hooks.example.com/x")).toBe("webhook_url_invalid");
    expect(code("ftp://hooks.example.com/x")).toBe("webhook_url_invalid");
    expect(code("https://nutzer:pass@hooks.example.com/x")).toBe("webhook_url_invalid");
    expect(code("https://127.0.0.1/x")).toBe("webhook_target_forbidden");
    expect(code("https://[::1]/x")).toBe("webhook_target_forbidden");
    expect(code("https://2130706433/x")).toBe("webhook_target_forbidden"); // Dezimalform von 127.0.0.1
    expect(code("https://localhost/x")).toBe("webhook_target_forbidden");
    expect(code("https://dienst.internal/x")).toBe("webhook_target_forbidden");
    expect(code("https://hooks.example.com:22/x")).toBe("webhook_target_forbidden");
    expect(code("kein url")).toBe("webhook_url_invalid");
  });

  it("prüft jede aufgelöste Adresse und gibt die geprüfte zurück", async () => {
    await expect(pruefeWebhookZiel("https://hooks.example.com/x", { aufloeser })).resolves.toMatchObject({ ip: "93.184.216.34" });
    for (const host of ["intern.example.com", "gemischt.example.com", "metadaten.example.com", "v6.example.com"]) {
      await expect(pruefeWebhookZiel(`https://${host}/x`, { aufloeser }), host).rejects.toMatchObject({ code: "webhook_target_forbidden" });
    }
    await expect(pruefeWebhookZiel("https://unbekannt.example.com/x", { aufloeser })).rejects.toMatchObject({ code: "webhook_target_unresolvable" });
    // Selbsthoster mit `WEBHOOK_PRIVATE_ZIELE=1`: interne Adressen erlaubt, https bleibt Pflicht
    await expect(pruefeWebhookZiel("https://intern.example.com/x", { aufloeser, privateErlaubt: true })).resolves.toMatchObject({ ip: "10.0.0.5" });
    expect(() => pruefeWebhookAdresse("http://intern.example.com/x")).toThrow(ZielFehler);
  });

  it("lehnt verbotene Ziele schon beim Anlegen und Ändern ab", async () => {
    expect((await json(await post("/webhooks", { url: "http://hooks.example.com/x" }, anna))).error.code).toBe("webhook_url_invalid");
    expect((await json(await post("/webhooks", { url: "https://intern.example.com/x" }, anna))).error.code).toBe("webhook_target_forbidden");
    expect((await json(await post("/webhooks", { url: "https://gemischt.example.com/x" }, anna))).error.code).toBe("webhook_target_forbidden");
    const w = await legeWebhookAn(anna);
    const geaendert = await t.request(`/webhooks/${w.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://metadaten.example.com/x" }), als: anna });
    expect(geaendert.status).toBe(400);
    expect((await json(geaendert)).error.code).toBe("webhook_target_forbidden");
  });
});

describe("Versand", () => {
  /** TCP-Server auf 127.0.0.1, der die ersten Bytes (TLS-ClientHello) mitschreibt und dann `verhalten` folgt. */
  async function tcpServer(verhalten: "trennen" | "schweigen") {
    const empfangen: Buffer[] = [];
    const sockets: Socket[] = [];
    const server = createServer((socket) => {
      sockets.push(socket);
      socket.once("data", (d: Buffer) => {
        empfangen.push(d);
        if (verhalten === "trennen") socket.destroy();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;
    const schliessen = () =>
      new Promise((r) => {
        for (const x of sockets) x.destroy();
        server.close(r);
      });
    return { port, empfangen, schliessen };
  }

  it("verbindet mit der geprüften Adresse und nennt den Hostnamen nur als TLS-Servername", async () => {
    const tcp = await tcpServer("trennen");
    // Der Name löst nirgends auf: Verbunden wird ausschließlich mit der übergebenen Adresse.
    const url = new URL(`https://nicht-aufloesbar.example.com:${tcp.port}/eingang`);
    await expect(echterSender({ url, ip: "127.0.0.1", kopf: {}, rumpf: "{}", zeitlimitMs: 2000 })).rejects.toBeTruthy();
    expect(tcp.empfangen).toHaveLength(1);
    expect(tcp.empfangen[0]!.includes(Buffer.from("nicht-aufloesbar.example.com"))).toBe(true); // SNI im ClientHello
    await tcp.schliessen();
  });

  it("bricht nach dem Zeitlimit ab", async () => {
    const tcp = await tcpServer("schweigen");
    const url = new URL(`https://hooks.example.com:${tcp.port}/eingang`);
    const fehler = await echterSender({ url, ip: "127.0.0.1", kopf: {}, rumpf: "{}", zeitlimitMs: 300 }).catch((e: Error) => e);
    expect(["AbortError", "TimeoutError"]).toContain((fehler as Error).name);
    await tcp.schliessen();
  });
});

describe("Signatur", () => {
  it("lässt sich mit dem Geheimnis nachrechnen und verfällt nach fünf Minuten", () => {
    const rumpf = JSON.stringify({ id: "e1", type: "change" });
    const jetzt = 1_800_000_000;
    const kopf = signiere("whsec_test", jetzt, rumpf);
    expect(kopf).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(pruefeSignatur("whsec_test", kopf, rumpf, jetzt)).toBe(true);
    expect(pruefeSignatur("whsec_test", kopf, rumpf, jetzt + 299)).toBe(true);
    expect(pruefeSignatur("whsec_test", kopf, rumpf, jetzt + 301)).toBe(false); // Wiederholung einer alten Nachricht
    expect(pruefeSignatur("whsec_anders", kopf, rumpf, jetzt)).toBe(false);
    expect(pruefeSignatur("whsec_test", kopf, `${rumpf} `, jetzt)).toBe(false);
    expect(pruefeSignatur("whsec_test", kopf.replace(/t=\d+/, `t=${jetzt + 10}`), rumpf, jetzt)).toBe(false); // Zeitstempel ist mitsigniert
  });
});

describe("Endpunkte", () => {
  it("zeigt das Geheimnis nur einmal und speichert es nur verschlüsselt", async () => {
    const w = await legeWebhookAn(anna, { description: "Abgleich", tables: ["beteiligung"] });
    expect(w.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    const zeile = await endpunkt(w.id);
    expect(zeile.geheimnisVerschluesselt).not.toContain(w.secret);
    expect(ring.entschluessele(zeile.geheimnisVerschluesselt, geheimnisAad(w.id))).toBe(w.secret);
    const liste = await json(await t.request("/webhooks", { als: anna }));
    expect(liste.data).toHaveLength(1);
    expect(JSON.stringify(liste)).not.toContain(w.secret);
    expect(liste.data[0]).toMatchObject({ url: "https://hooks.example.com/eingang", description: "Abgleich", tables: ["beteiligung"], active: true, apiKeyId: null });
    const protokoll = await db.select().from(s.aenderung).where(eq(s.aenderung.tabelle, "webhook"));
    expect(protokoll).toHaveLength(1);
    expect(JSON.stringify(protokoll)).not.toContain(w.secret);
    expect(JSON.stringify(protokoll)).not.toContain(zeile.geheimnisVerschluesselt);

    const neu = await json(await post(`/webhooks/${w.id}/rotate-secret`, {}, anna));
    expect(neu.secret).not.toBe(w.secret);
    expect(ring.entschluessele((await endpunkt(w.id)).geheimnisVerschluesselt, geheimnisAad(w.id))).toBe(neu.secret);
  });

  it("sind nur für ihren Eigentümer sichtbar; globale Verwalter können sie nur abschalten", async () => {
    const w = await legeWebhookAn(anna);
    expect((await t.request(`/webhooks/${w.id}`, { als: bernd })).status).toBe(404);
    expect((await t.request(`/webhooks/${w.id}`, { method: "DELETE", als: bernd })).status).toBe(404);
    expect((await json(await t.request("/webhooks", { als: bernd }))).data).toHaveLength(0);
    expect((await t.request(`/webhooks/${w.id}/deliveries`, { als: bernd })).status).toBe(404);
    // globaler Verwalter (Standard der Test-App)
    expect((await json(await t.request("/webhooks"))).data).toHaveLength(1);
    const patch = (koerper: unknown) => t.request(`/webhooks/${w.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(koerper) });
    expect((await patch({ url: "https://hooks.example.com/anders" })).status).toBe(403);
    const aus = await json(await patch({ active: false }));
    expect(aus).toMatchObject({ active: false, disabledReason: "manual" });
    expect((await post(`/webhooks/${w.id}/rotate-secret`, {})).status).toBe(403);
  });

  it("prüft die Tabellen gegen die Änderungsabfrage", async () => {
    const antwort = await post("/webhooks", { url: "https://hooks.example.com/x", tables: ["api_schluessel"] }, anna);
    expect(antwort.status).toBe(400);
    expect((await post("/webhooks", { url: "https://hooks.example.com/x", tables: ["benutzer"] }, anna)).status).toBe(400);
  });

  it("verlangt den Schlüssel zum Verschlüsseln", async () => {
    const ohne = erstelleTestApp(db, { schluessel: undefined, aufloeser });
    const antwort = await ohne.request("/webhooks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://hooks.example.com/x" }), als: anna });
    expect(antwort.status).toBe(503);
    expect((await json(antwort)).error.code).toBe("secret_missing");
  });
});

describe("Zustellung", () => {
  it("stellt nur Änderungen zu, die der Eigentümer sieht, signiert und ohne Nutzdaten im Protokoll", async () => {
    const w = await legeWebhookAn(anna);
    const fremd = await aenderung(FONDS_B);
    const eigen = await aenderung(FONDS_A);
    const jobs = await verteile();
    expect(jobs).toHaveLength(1);
    const [z] = await zustellungen(w.id);
    expect(z!.aenderungId).toBe(eigen);
    expect(z!.aenderungId).not.toBe(fremd);

    const { anfragen, sender } = fakeSender(204);
    expect(await stelleZu(db, jobs[0]!.zustellungId, { ring, sender, aufloeser, letzterVersuch: false })).toBe("delivered");
    expect(anfragen).toHaveLength(1);
    const a = anfragen[0]!;
    expect(a.ip).toBe("93.184.216.34");
    expect(a.url.hostname).toBe("hooks.example.com");
    const koerper = JSON.parse(a.rumpf);
    expect(koerper).toMatchObject({ id: eigen, type: "change", webhookId: w.id, data: { id: eigen, table: "beteiligung", fundId: FONDS_A, action: "anlegen" } });
    expect(a.kopf["carraway-event-id"]).toBe(eigen);
    expect(pruefeSignatur(w.secret, a.kopf["carraway-signature"]!, a.rumpf)).toBe(true);

    const [protokoll] = await zustellungen(w.id);
    expect(protokoll).toMatchObject({ status: "delivered", versuche: 1, httpStatus: 204, fehler: null });
    expect(JSON.stringify(protokoll)).not.toContain("Beispiel GmbH");
    const liste = await json(await t.request(`/webhooks/${w.id}/deliveries`, { als: anna }));
    expect(liste.data[0]).toMatchObject({ eventId: eigen, type: "change", status: "delivered", attempts: 1, httpStatus: 204 });
    expect(JSON.stringify(liste)).not.toContain("Beispiel GmbH");
    // Ein zweiter Job derselben Zustellung stellt nicht noch einmal zu.
    expect(await stelleZu(db, jobs[0]!.zustellungId, { ring, sender, aufloeser, letzterVersuch: false })).toBe("unknown");
    expect(anfragen).toHaveLength(1);
  });

  it("filtert nach abonnierten Tabellen", async () => {
    const w = await legeWebhookAn(anna, { tables: ["vorgang"] });
    await aenderung(FONDS_A, "beteiligung");
    const vorgang = await aenderung(FONDS_A, "vorgang");
    await verteile();
    expect((await zustellungen(w.id)).map((z) => z.aenderungId)).toEqual([vorgang]);
  });

  it("prüft die Rechte zum Zeitpunkt der Zustellung", async () => {
    const w = await legeWebhookAn(anna);
    await aenderung(FONDS_A);
    const [job] = await verteile();
    // Anna verliert die Rolle an Fonds A und bekommt eine an Fonds B: Die schon geplante Zustellung entfällt.
    const annaId = await idVon(db, anna);
    await db.delete(s.fondsrolle).where(eq(s.fondsrolle.benutzerId, annaId));
    await db.insert(s.fondsrolle).values({ benutzerId: annaId, fondsId: FONDS_B, rolle: "betrachter" });
    const { anfragen, sender } = fakeSender();
    expect(await stelleZu(db, job!.zustellungId, { ring, sender, aufloeser, letzterVersuch: false })).toBe("skipped");
    expect(anfragen).toHaveLength(0);
    expect((await zustellungen(w.id))[0]).toMatchObject({ status: "skipped", fehler: "not_visible" });
    expect((await endpunkt(w.id)).aktiv).toBe(true);

    // Person deaktiviert: nichts mehr, Endpunkt aus
    await aenderung(FONDS_B);
    const [zweiter] = await verteile();
    await db.update(s.benutzer).set({ aktiv: false }).where(eq(s.benutzer.id, annaId));
    expect(await stelleZu(db, zweiter!.zustellungId, { ring, sender, aufloeser, letzterVersuch: false })).toBe("skipped");
    expect(anfragen).toHaveLength(0);
    expect(await endpunkt(w.id)).toMatchObject({ aktiv: false, deaktiviertGrund: "owner_inactive" });
  });

  it("wiederholt Fehlschläge und schaltet den Endpunkt nach Dauerfehlern ab", async () => {
    const w = await legeWebhookAn(anna);
    await aenderung(FONDS_A);
    const [job] = await verteile();
    const fehler = fakeSender(500);
    expect(await stelleZu(db, job!.zustellungId, { ring, sender: fehler.sender, aufloeser, letzterVersuch: false })).toBe("retry");
    expect((await zustellungen(w.id))[0]).toMatchObject({ status: "pending", versuche: 1, httpStatus: 500, fehler: "http_status" });
    // Weiterleitungen werden nicht verfolgt
    const umleitung = fakeSender(302);
    expect(await stelleZu(db, job!.zustellungId, { ring, sender: umleitung.sender, aufloeser, letzterVersuch: false })).toBe("retry");
    expect((await zustellungen(w.id))[0]).toMatchObject({ versuche: 2, fehler: "redirect_not_followed" });
    // Zeitlimit und Verbindungsfehler
    const zeit = fakeSender(Object.assign(new Error("Zeitlimit"), { name: "TimeoutError" }));
    expect(await stelleZu(db, job!.zustellungId, { ring, sender: zeit.sender, aufloeser, letzterVersuch: false })).toBe("retry");
    expect((await zustellungen(w.id))[0]).toMatchObject({ versuche: 3, fehler: "timeout", httpStatus: null });
    // DNS-Rebinding: Beim Versuch zeigt der Name auf eine private Adresse; es wird nichts gesendet.
    dns["hooks.example.com"] = ["10.1.2.3"];
    const umgelenkt = fakeSender(200);
    expect(await stelleZu(db, job!.zustellungId, { ring, sender: umgelenkt.sender, aufloeser, letzterVersuch: true })).toBe("failed");
    expect(umgelenkt.anfragen).toHaveLength(0);
    expect((await zustellungen(w.id))[0]).toMatchObject({ status: "failed", versuche: 4, fehler: "webhook_target_forbidden" });
    expect((await endpunkt(w.id)).fehlerInFolge).toBe(1);

    dns = { ...DNS };
    for (let i = 1; i < ABSCHALTEN_NACH; i++) {
      await aenderung(FONDS_A);
      const [j] = await verteile();
      expect(await stelleZu(db, j!.zustellungId, { ring, sender: fehler.sender, aufloeser, letzterVersuch: true })).toBe("failed");
    }
    expect(await endpunkt(w.id)).toMatchObject({ aktiv: false, deaktiviertGrund: "too_many_failures", fehlerInFolge: ABSCHALTEN_NACH });
    // Abgeschaltet: keine neuen Zustellungen; wieder eingeschaltet zählt von vorn
    await aenderung(FONDS_A);
    expect(await verteile()).toHaveLength(0);
    const ein = await t.request(`/webhooks/${w.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: true }), als: anna });
    expect(await json(ein)).toMatchObject({ active: true, consecutiveFailures: 0, disabledReason: null });
  });

  it("sieht für Personen in Nutzergruppen dasselbe wie die Änderungsabfrage (Bereich alle)", async () => {
    const gruppenPerson = person("wh-gruppe");
    const personId = await legePersonAn(db, gruppenPerson);
    const [r] = await db.insert(s.rechterolle).values({ name: "WH alle Bereiche", bereiche: [...BEREICHE] }).returning();
    const [g] = await db.insert(s.nutzergruppe).values({ name: "WH Fonds A", stufe: "betrachter", fondsBeschraenkt: true }).returning();
    await db.insert(s.nutzergruppeRolle).values({ gruppeId: g!.id, rolleId: r!.id });
    await db.insert(s.nutzergruppeFonds).values({ gruppeId: g!.id, fondsId: FONDS_A });
    await db.insert(s.nutzergruppeMitglied).values({ gruppeId: g!.id, benutzerId: personId });

    const w = await legeWebhookAn(gruppenPerson);
    const eigen = await aenderung(FONDS_A);
    const fremd = await aenderung(FONDS_B);
    const feed = await json(await t.request("/changes", { als: gruppenPerson }));
    const ereignisse = (feed.data as { id: string }[]).filter((z) => z.id === eigen || z.id === fremd);
    const jobs = await verteile();
    expect(jobs).toHaveLength(1);
    expect((await zustellungen(w.id)).map((z) => z.aenderungId)).toEqual([eigen]);
    expect(ereignisse.map((z) => z.id)).toEqual([eigen]);
    const { anfragen, sender } = fakeSender();
    expect(await stelleZu(db, jobs[0]!.zustellungId, { ring, sender, aufloeser, letzterVersuch: false })).toBe("delivered");
    expect(JSON.parse(anfragen[0]!.rumpf).data).toEqual(ereignisse[0]);

    // Ohne einen Bereich verweigert die Änderungsabfrage den Zugriff; der Endpunkt bekommt nichts mehr und schaltet sich ab.
    await db.update(s.rechterolle).set({ bereiche: BEREICHE.filter((b) => b !== "finanzen") }).where(eq(s.rechterolle.id, r!.id));
    expect((await t.request("/changes", { als: gruppenPerson })).status).toBe(403);
    expect((await post("/webhooks", { url: "https://hooks.example.com/x" }, gruppenPerson)).status).toBe(403);
    await aenderung(FONDS_A);
    await verteile();
    expect(await zustellungen(w.id)).toHaveLength(1);
    expect(await endpunkt(w.id)).toMatchObject({ aktiv: false, deaktiviertGrund: "owner_inactive" });
  });

  it("endet mit dem API-Schlüssel, mit dem der Endpunkt angelegt wurde", async () => {
    const schluessel = erzeugeSchluessel();
    const [technisch] = await db.insert(s.benutzer).values({ name: "API: Abgleich", email: `schluessel-${randomUUID()}@technisch.invalid`, emailVerified: true, technisch: true }).returning();
    const [zeile] = await db
      .insert(s.apiSchluessel)
      .values({ name: "Abgleich", benutzerId: technisch!.id, scopes: [{ fondsId: FONDS_A, recht: "lesen" }], ablauf: new Date(Date.now() + 86_400_000), hash: schluessel.hash, vorschau: schluessel.vorschau, erstelltVon: "test" })
      .returning();
    const antwort = await t.app.request("/api/v1/webhooks", { method: "POST", headers: { authorization: `Bearer ${schluessel.klartext}`, "content-type": "application/json" }, body: JSON.stringify({ url: "https://hooks.example.com/k" }) });
    expect(antwort.status).toBe(201);
    const w = await json(antwort);
    expect(w.apiKeyId).toBe(zeile!.id);
    await aenderung(FONDS_A);
    await aenderung(FONDS_B);
    const jobs = await verteile();
    expect(jobs).toHaveLength(1); // nur der Fonds aus dem Scope
    await db.update(s.apiSchluessel).set({ widerrufenAm: new Date() }).where(eq(s.apiSchluessel.id, zeile!.id));
    const { anfragen, sender } = fakeSender();
    expect(await stelleZu(db, jobs[0]!.zustellungId, { ring, sender, aufloeser, letzterVersuch: false })).toBe("skipped");
    expect(anfragen).toHaveLength(0);
    expect(await endpunkt(w.id)).toMatchObject({ aktiv: false, deaktiviertGrund: "owner_inactive" });
  });

  it("sendet ein Testereignis über die Warteschlange", async () => {
    const w = await legeWebhookAn(anna);
    const antwort = await post(`/webhooks/${w.id}/test`, {}, anna);
    expect(antwort.status).toBe(202);
    const { deliveryId } = await json(antwort);
    const jobs = await verteile();
    expect(jobs).toEqual([{ zustellungId: deliveryId }]);
    expect(await verteile()).toHaveLength(0); // nur einmal übergeben
    const { anfragen, sender } = fakeSender(200);
    expect(await stelleZu(db, deliveryId, { ring, sender, aufloeser, letzterVersuch: false })).toBe("delivered");
    expect(JSON.parse(anfragen[0]!.rumpf)).toMatchObject({ id: deliveryId, type: "ping", webhookId: w.id });
    expect(pruefeSignatur(w.secret, anfragen[0]!.kopf["carraway-signature"]!, anfragen[0]!.rumpf)).toBe(true);
  });

  it("legt ohne aktive Endpunkte nichts in den Ausgangskorb", async () => {
    await aenderung(FONDS_A);
    const { rows } = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM webhook_ausgang`);
    expect(rows[0]!.n).toBe(0);
  });
});
