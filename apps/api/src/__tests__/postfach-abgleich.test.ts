import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { Schluesselring } from "../geheimnis/krypto";
import { berlinerTag, externHash, externHashNeu, ladeBekannte, ordneZu } from "../postfach/abgleich";
import { FakeAnbieter } from "../postfach/fake";
import { gleicheAb, gleicheVerbindungAb, type SyncOptionen } from "../postfach/sync";
import type { MailKopf, Termin, Zugang } from "../postfach/typen";
import { verschluesseleZugang } from "../postfach/zugang";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, idVon, legePersonAn, person, type Testperson } from "./hilfen-auth";
import { grundbestand, ID } from "./hilfen-instrumente";
import { postfachKonfig } from "./hilfen-postfach";

/**
 * Abgleich von Mails und Terminen: nur bekannte Kontakte werden gespeichert, Dubletten und Ausschlüsse, Aktualisierung und Absage von Terminen,
 * Sichtbarkeit nach den CRM-Regeln, Protokoll ohne Inhalt. Anbieter sind Fakes; kein Test erreicht einen echten Dienst. Alle Adressen sind erfunden.
 */

const { db, pool } = oeffneTestdb();
const ring = new Schluesselring(randomBytes(32));
const t = erstelleTestApp(db, { schluessel: ring, postfach: postfachKonfig() });

const vera = person("ab-vera", { rollen: { [ID.fonds]: "bearbeiter" } });
const bernd = person("ab-bernd", { rollen: { [ID.fonds]: "bearbeiter" } });
const nurAnderer = person("ab-anderer", { rollen: { [ID.anderer]: "bearbeiter" } });
const EIGENE = "vera@fonds.example.org";

const P_ANNA = "00000000-0000-4000-8000-0000000000a1";
const P_ALT = "00000000-0000-4000-8000-0000000000a2"; // in Anna zusammengeführt
const ORG_FONDS = "00000000-0000-4000-8000-0000000000a3";
const ORG_FREI = "00000000-0000-4000-8000-0000000000a4";
const DEAL_B = "00000000-0000-4000-8000-0000000000d1";
const DEAL_A1 = "00000000-0000-4000-8000-0000000000d2";
const DEAL_A2 = "00000000-0000-4000-8000-0000000000d3";
const DEAL_ANDERER_FONDS = "00000000-0000-4000-8000-0000000000d4";
const ORG_D = "00000000-0000-4000-8000-0000000000a5";

const jetzt = new Date();
const vor = (tage: number, stunde = 10) => {
  const d = new Date(jetzt.getTime() - tage * 86_400_000);
  d.setUTCHours(stunde, 0, 0, 0);
  return d;
};
const nach = (tage: number, stunde = 9) => vor(-tage, stunde);

let nr = 0;
const mail = (zusatz: Partial<MailKopf> & Pick<MailKopf, "von" | "an">): MailKopf => {
  nr++;
  return { id: `m${nr}`, nachrichtenId: `<m${nr}@sync.example>`, datum: vor(1), betreff: `Betreff ${nr}`, cc: [], ...zusatz };
};
const termin = (zusatz: Partial<Termin> & Pick<Termin, "teilnehmer">): Termin => {
  nr++;
  return { id: `t${nr}@sync.example`, instanz: null, titel: `Termin ${nr}`, beginn: nach(2), ende: nach(2, 10), abgesagt: false, ...zusatz };
};

async function crm() {
  await grundbestand(db);
  await db.update(s.organisation).set({ website: "https://www.alpha.example.com" }).where(eq(s.organisation.id, ID.orgA));
  await db.update(s.organisation).set({ website: "https://beta.example.com/start" }).where(eq(s.organisation.id, ID.orgB));
  await db.insert(s.organisation).values([
    { id: ORG_FONDS, name: "Fonds Beispiel", art: "sonstige", website: "https://fonds.example.org" },
    { id: ORG_FREI, name: "Freemail Beispiel", art: "sonstige", website: "https://gmail.com" },
    { id: ORG_D, name: "Delta Beispiel", art: "unternehmen", website: "https://delta.example.com" },
  ]);
  await db.insert(s.person).values([
    { id: P_ANNA, vorname: "Anna", nachname: "Alpha", email: "anna@alpha.example.com", organisationId: ID.orgA },
    { id: P_ALT, vorname: "Anna", nachname: "Alpha (alt)", email: "alt@alpha.example.com", organisationId: ID.orgA },
  ]);
  await db.update(s.person).set({ zusammengefuehrtIn: P_ANNA }).where(eq(s.person.id, P_ALT));
  await db.insert(s.deal).values([
    { id: DEAL_B, organisationId: ID.orgB, titel: "Runde Beta", fondsId: ID.fonds },
    { id: DEAL_A1, organisationId: ID.orgA, titel: "Runde Alpha 1", fondsId: ID.fonds },
    { id: DEAL_A2, organisationId: ID.orgA, titel: "Runde Alpha 2", fondsId: ID.fonds },
    { id: DEAL_ANDERER_FONDS, organisationId: ORG_D, titel: "Runde Delta", fondsId: ID.anderer },
  ]);
  for (const p of [vera, bernd, nurAnderer]) await legePersonAn(db, p);
}

async function verbinde(als: Testperson, bereich: "mail" | "kalender", opt: Partial<typeof s.postfachVerbindung.$inferInsert> = {}, adresse = EIGENE) {
  const id = crypto.randomUUID();
  const zugang: Zugang = { art: "oauth", accessToken: "a", refreshToken: "r", ablaufMs: Date.now() + 3_600_000, adresse };
  await db.insert(s.postfachVerbindung).values({ id, benutzerId: await idVon(db, als), bereich, anbieter: "microsoft", zugangVerschluesselt: verschluesseleZugang(ring, id, zugang), ...opt });
  return id;
}

const syncOpt = (anbieter: FakeAnbieter, zusatz: Partial<SyncOptionen> = {}): SyncOptionen => ({ ring, konfig: postfachKonfig(), abrufer: fetch, anbieter: async () => anbieter, ...zusatz });
const faellig = () => db.update(s.postfachVerbindung).set({ naechsterAbgleichAm: new Date(Date.now() - 60_000), gesperrtBis: null });
const aktivitaeten = () => db.select().from(s.aktivitaet).orderBy(s.aktivitaet.titel);
const herkunft = () => db.select().from(s.aktivitaetSync);

beforeEach(crm);
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Zuordnung zu bekannten Kontakten (Positivliste)", () => {
  it("bekannte Person → gespeichert; unbekannte Kontakte → nichts gespeichert, auch nicht in der Herkunft", async () => {
    await verbinde(vera, "mail");
    const a = new FakeAnbieter();
    a.mails = [
      mail({ von: "anna@alpha.example.com", an: [EIGENE], betreff: "Von Anna" }),
      mail({ von: EIGENE, an: ["unbekannt@nirgendwo.example.net"], betreff: "An Unbekannt" }),
      mail({ von: "newsletter@example.net", an: [EIGENE], cc: ["anna@alpha.example.com"], betreff: "Anna nur in Kopie" }),
      mail({ von: "freund@gmail.com", an: [EIGENE], betreff: "Freemail" }),
    ];
    const e = await gleicheAb(db, syncOpt(a));
    expect(e).toMatchObject({ verbindungen: 1, mails: 2, fehler: 0 });
    const liste = await aktivitaeten();
    expect(liste.map((x) => x.titel)).toEqual(["Anna nur in Kopie", "Von Anna"]);
    // Nichts von den unbekannten Kontakten, weder Betreff noch Adresse, ist irgendwo gelandet.
    const alles = JSON.stringify([liste, await herkunft(), (await db.execute(sql`SELECT vorher, nachher FROM aenderung`)).rows]);
    expect(alles).not.toMatch(/nirgendwo|newsletter@|freund@|Freemail|An Unbekannt/);
    const [von] = liste.filter((x) => x.titel === "Von Anna");
    expect(von).toMatchObject({ art: "mail", personId: P_ANNA, organisationId: ID.orgA, dealId: null, notiz: null });
    const [h] = (await herkunft()).filter((x) => x.aktivitaetId === von!.id);
    expect(h).toMatchObject({ anbieter: "microsoft", richtung: "eingehend", personIds: [P_ANNA], benutzerId: await idVon(db, vera) });
    expect(h!.externHash).toBe(externHashNeu("mail", "microsoft", "<m1@sync.example>"));
    expect(h!.absenderHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h!.teilnehmerHashes.length).toBeGreaterThan(1);
  });

  it("Domain einer Organisation (Website) reicht für eine Aktivität an der Organisation; Freemail und die eigene Domain nie; Unterdomains nur bei eigener Eintragung", async () => {
    await verbinde(vera, "mail");
    const a = new FakeAnbieter();
    a.mails = [
      mail({ von: "info@beta.example.com", an: [EIGENE], betreff: "Domain Beta" }),
      mail({ von: "buero@mail.beta.example.com", an: [EIGENE], betreff: "Unterdomain Beta" }), // nur die eingetragene Domain zählt
      mail({ von: "kollege@fonds.example.org", an: [EIGENE, "kollege2@fonds.example.org"], betreff: "Intern" }),
      mail({ von: "jemand@gmail.com", an: [EIGENE], betreff: "Gmail" }),
    ];
    expect(await gleicheAb(db, syncOpt(a))).toMatchObject({ mails: 1 });
    const liste = await aktivitaeten();
    expect(liste.map((x) => x.titel)).toEqual(["Domain Beta"]);
    for (const x of liste) expect(x).toMatchObject({ organisationId: ID.orgB, personId: null, dealId: DEAL_B }); // genau ein offener Deal → verknüpft
  });

  it("Domains: Unterdomains nur bei eigener Eintragung; Freemail, Mehrmandanten-Hosts, öffentliche Suffixe und einzelne Labels bezeichnen nie eine Organisation; Personenadresse hat Vorrang", async () => {
    await db.insert(s.organisation).values([
      { id: "00000000-0000-4000-8000-0000000000b1", name: "Tenant", art: "sonstige", website: "https://firma.github.io" },
      { id: "00000000-0000-4000-8000-0000000000b2", name: "Suffix", art: "sonstige", website: "https://co.uk" },
      { id: "00000000-0000-4000-8000-0000000000b3", name: "Label", art: "sonstige", website: "http://intranet" },
      { id: "00000000-0000-4000-8000-0000000000b4", name: "Mail-Unterdomain", art: "unternehmen", website: "https://mail.gamma.example.com" },
    ]);
    const b = await db.transaction((tx) => ladeBekannte(tx));
    expect([...b.domains.keys()].sort()).toEqual(["alpha.example.com", "beta.example.com", "delta.example.com", "fonds.example.org", "mail.gamma.example.com"]);
    expect(ordneZu(["x@firma.github.io", "y@co.uk", "z@intranet", "q@gmail.com", "w@sub.gmail.com"], EIGENE, b)).toBeNull();
    expect(ordneZu(["x@gamma.example.com"], EIGENE, b)).toBeNull(); // Oberdomain gehört nicht dazu
    expect(ordneZu(["x@mail.gamma.example.com"], EIGENE, b)).toMatchObject({ organisationId: "00000000-0000-4000-8000-0000000000b4", personId: null });
    expect(ordneZu(["x@sub.alpha.example.com"], EIGENE, b)).toBeNull();
    // die Person gewinnt vor der Domain einer anderen Organisation
    expect(ordneZu(["info@beta.example.com", "anna@alpha.example.com"], EIGENE, b)).toMatchObject({ personId: P_ANNA, organisationId: ID.orgA });
  });

  it("zusammengeführte Personen zeigen auf ihr Ziel; bei mehreren offenen Deals bleibt der Deal leer", async () => {
    await verbinde(vera, "mail");
    const a = new FakeAnbieter();
    a.mails = [mail({ von: "alt@alpha.example.com", an: [EIGENE], betreff: "Alte Adresse" })];
    await gleicheAb(db, syncOpt(a));
    const [x] = await aktivitaeten();
    expect(x).toMatchObject({ personId: P_ANNA, organisationId: ID.orgA, dealId: null });
  });

  it("Datum in Berliner Ortszeit; Betreff leer ergibt einen Platzhalter, lange Betreffs werden gekürzt", async () => {
    await verbinde(vera, "mail");
    const a = new FakeAnbieter();
    a.mails = [
      mail({ von: "anna@alpha.example.com", an: [EIGENE], betreff: "", datum: new Date("2026-03-10T23:30:00Z") }),
      mail({ von: "anna@alpha.example.com", an: [EIGENE], betreff: "x".repeat(500), datum: new Date("2026-03-11T09:00:00Z") }),
    ];
    await gleicheAb(db, syncOpt(a));
    const liste = await aktivitaeten();
    expect(liste.find((x) => x.titel === "(ohne Betreff)")!.datum).toBe("2026-03-11"); // 23:30 UTC ist in Berlin schon der 11.
    expect(liste.find((x) => x.titel.startsWith("xxx"))!.titel).toHaveLength(300);
    expect(berlinerTag(new Date("2026-07-01T22:30:00Z"))).toBe("2026-07-02");
  });

  it("ordneZu: eigene Adresse zählt nie, Groß- und Kleinschreibung egal, ohne Treffer null", async () => {
    const b = await db.transaction((tx) => ladeBekannte(tx));
    expect(ordneZu([EIGENE.toUpperCase(), "Anna@Alpha.Example.com"], EIGENE, b)).toMatchObject({ personIds: [P_ANNA], organisationId: ID.orgA });
    expect(ordneZu([EIGENE], EIGENE, b)).toBeNull();
    expect(ordneZu(["x@unbekannt.example.net", "kaputt"], EIGENE, b)).toBeNull();
  });
});

describe("Textauszug und Datenschutz-Schalter", () => {
  it("ohne Erlaubnis nur der Betreff, und der Text wird nicht einmal geholt; mit Erlaubnis die ersten 500 Zeichen, aber nur für passende Nachrichten", async () => {
    const a = new FakeAnbieter();
    a.mails = [mail({ id: "passt", von: "anna@alpha.example.com", an: [EIGENE] }), mail({ id: "fremd", von: "x@unbekannt.example.net", an: [EIGENE] })];
    a.texte.set("passt", `Zeile eins.\n\n${"abc ".repeat(300)}`);
    a.texte.set("fremd", "geheim und fremd");
    const id = await verbinde(vera, "mail");
    await gleicheAb(db, syncOpt(a));
    expect((await aktivitaeten())[0]!.notiz).toBeNull();
    expect(a.textAbrufe).toEqual([]);

    // Person erlaubt den Textauszug; neue Nachricht kommt an.
    await db.update(s.postfachVerbindung).set({ inhaltSpeichern: true, abgleichStand: null }).where(eq(s.postfachVerbindung.id, id));
    await db.delete(s.aktivitaet);
    await faellig();
    await gleicheAb(db, syncOpt(a));
    const [x] = await aktivitaeten();
    expect(x!.notiz!.length).toBeLessThanOrEqual(500); // Leerraum wird zusammengezogen
    expect(x!.notiz!.length).toBeGreaterThan(480);
    expect(x!.notiz).toMatch(/^Zeile eins\. abc abc/);
    expect(a.textAbrufe).toEqual(["passt"]); // „fremd“ wurde nie nachgeladen
    expect(JSON.stringify((await db.execute(sql`SELECT vorher, nachher FROM aenderung WHERE tabelle = 'aktivitaet'`)).rows)).not.toContain("Zeile eins"); // nie im Protokoll
  });

  it("ein Fehler beim Nachladen des Textes hält den Abgleich nicht auf (Betreff genügt)", async () => {
    const a = new FakeAnbieter();
    a.mails = [mail({ id: "kaputt", von: "anna@alpha.example.com", an: [EIGENE] })];
    a.holeMailText = async () => {
      throw new Error("Anbieter kaputt");
    };
    await verbinde(vera, "mail", { inhaltSpeichern: true });
    expect(await gleicheAb(db, syncOpt(a))).toMatchObject({ mails: 1, fehler: 0 });
    expect((await aktivitaeten())[0]!.notiz).toBeNull();
  });
});

describe("Gesperrte Personen", () => {
  it("die Verbindungen gesperrter Personen werden nicht abgeglichen (auch nicht bei direktem Aufruf); nach der Entsperrung läuft es weiter", async () => {
    const verbindungId = await verbinde(vera, "mail");
    const a = new FakeAnbieter();
    a.mails = [mail({ von: "anna@alpha.example.com", an: [EIGENE], betreff: "Von Anna" })];
    await db.update(s.benutzer).set({ aktiv: false }).where(eq(s.benutzer.id, await idVon(db, vera)));
    expect(await gleicheAb(db, syncOpt(a))).toMatchObject({ verbindungen: 0, mails: 0 });
    expect(await gleicheVerbindungAb(db, verbindungId, syncOpt(a))).toEqual({ mails: 0, termine: 0, fehler: null });
    expect(await aktivitaeten()).toHaveLength(0);
    expect(a.mails).toHaveLength(1);
    await db.update(s.benutzer).set({ aktiv: true }).where(eq(s.benutzer.id, await idVon(db, vera)));
    expect(await gleicheAb(db, syncOpt(a))).toMatchObject({ verbindungen: 1, mails: 1 });
  });
});

describe("Dubletten, Ausschluss, Löschen", () => {
  it("dieselbe Nachricht entsteht nie zweimal: nicht beim zweiten Lauf, nicht bei einer zweiten Person mit derselben Message-ID", async () => {
    await verbinde(vera, "mail");
    await verbinde(bernd, "mail");
    const a = new FakeAnbieter();
    a.mails = [mail({ von: "anna@alpha.example.com", an: [EIGENE, "bernd@fonds.example.org"], betreff: "Zu zweit" })];
    const e = await gleicheAb(db, syncOpt(a));
    expect(e.verbindungen).toBe(2);
    expect(e.mails).toBe(1);
    expect(await aktivitaeten()).toHaveLength(1);
    await faellig();
    a.mails.push(mail({ von: "anna@alpha.example.com", an: [EIGENE], betreff: "Neu", datum: new Date() }));
    expect((await gleicheAb(db, syncOpt(a))).mails).toBe(1);
    expect(await aktivitaeten()).toHaveLength(2);
  });

  it("Nutzer entfernt eine Mail: sie verschwindet, kommt nicht wieder, Protokoll ohne Betreff; nur die Besitzerin darf entfernen", async () => {
    await verbinde(vera, "mail");
    const a = new FakeAnbieter();
    a.mails = [mail({ von: "info@beta.example.com", an: [EIGENE], betreff: "Privat gemeint" })];
    await gleicheAb(db, syncOpt(a));
    const [x] = await aktivitaeten();
    const entfernen = (als: Testperson, id: string) => t.request(`/aktivitaeten/${id}/sync-entfernen`, { method: "POST", als });

    const fremd = await entfernen(bernd, x!.id);
    expect(fremd.status).toBe(403);
    expect((await json(fremd)).error.code).toBe("synced_activity_foreign");
    expect((await entfernen(person("ab-ohne-rolle", { rollen: {} }), x!.id)).status).toBe(403);
    expect(await aktivitaeten()).toHaveLength(1);

    expect((await entfernen(vera, x!.id)).status).toBe(204);
    expect((await db.execute(sql`SELECT fonds_id FROM aenderung WHERE aktion = 'loeschen' AND datensatz_id = ${x!.id}`)).rows).toEqual([{ fonds_id: ID.fonds }]);
    expect(await aktivitaeten()).toHaveLength(0);
    expect(await herkunft()).toHaveLength(0);
    expect(await db.select().from(s.syncAusschluss)).toHaveLength(1);
    expect(JSON.stringify(await db.select().from(s.syncAusschluss))).not.toMatch(/Privat|<m\d+@/);
    expect((await entfernen(vera, x!.id)).status).toBe(404);

    // Der nächste Lauf holt sie nicht erneut, auch nicht mit ganz neuem Stand.
    await db.update(s.postfachVerbindung).set({ abgleichStand: null });
    await faellig();
    expect((await gleicheAb(db, syncOpt(a))).mails).toBe(0);
    expect(await aktivitaeten()).toHaveLength(0);

    // Im Protokoll steht weder Betreff noch Textauszug.
    const protokoll = JSON.stringify((await db.execute(sql`SELECT aktion, vorher, nachher FROM aenderung WHERE tabelle = 'aktivitaet' ORDER BY am, id`)).rows);
    expect(protokoll).toContain("loeschen");
    expect(protokoll).not.toMatch(/Privat gemeint/);
  });

  it("ordnet frühere Löschzeilen ohne Fonds-ID dem protokollierten Deal zu", async () => {
    const datensatz = crypto.randomUUID();
    await db.execute(sql`INSERT INTO aenderung (akteur, aktion, tabelle, datensatz_id, vorher)
      VALUES ('test', 'loeschen', 'aktivitaet', ${datensatz}, jsonb_build_object('dealId', ${DEAL_B}::text))`);
    const sichtbar = async (als: Testperson) => {
      const feed = await t.request("/changes?table=aktivitaet", { als });
      expect(feed.status).toBe(200);
      return (await json(feed)).data.some((e: { recordId: string }) => e.recordId === datensatz);
    };
    expect(await sichtbar(vera)).toBe(true);
    expect(await sichtbar(nurAnderer)).toBe(false);
  });

  it("manuell angelegte Aktivitäten lassen sich so nicht entfernen (409 not_synced_activity)", async () => {
    const r = await t.request("/aktivitaeten", { method: "POST", als: vera, headers: { "content-type": "application/json" }, body: JSON.stringify({ art: "notiz", datum: "2026-01-01", titel: "Handnotiz", organisationId: ID.orgA }) });
    const { id } = await json(r);
    const antwort = await t.request(`/aktivitaeten/${id}/sync-entfernen`, { method: "POST", als: vera });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("not_synced_activity");
  });

  it("Trennen während des Abgleichs: danach wird nichts mehr geschrieben", async () => {
    const id = await verbinde(vera, "mail");
    const a = new FakeAnbieter();
    a.mails = [mail({ von: "anna@alpha.example.com", an: [EIGENE] })];
    const urspruenglich = a.holeMailKoepfe.bind(a);
    a.holeMailKoepfe = async (z, stand) => {
      const r = await urspruenglich(z, stand);
      await db.delete(s.postfachVerbindung).where(eq(s.postfachVerbindung.id, id)); // Person trennt mittendrin
      return r;
    };
    expect(await gleicheAb(db, syncOpt(a))).toMatchObject({ verbindungen: 1, mails: 0 });
    expect(await aktivitaeten()).toHaveLength(0);
  });
});

describe("Kalender", () => {
  it("Termin mit bekanntem Teilnehmer wird gespeichert (Titel, Zeit, Teilnehmer); ohne bekannte Teilnehmer nicht", async () => {
    await verbinde(vera, "kalender");
    const a = new FakeAnbieter();
    const beginn = nach(2, 9);
    a.termine = [
      termin({ titel: "Gespräch Alpha", beginn, ende: new Date(beginn.getTime() + 3_600_000), teilnehmer: [EIGENE, "anna@alpha.example.com", "extern@unbekannt.example.net"] }),
      termin({ titel: "Privater Termin", teilnehmer: [EIGENE, "arzt@praxis.example.net"] }),
      termin({ titel: "Nur ich", teilnehmer: [EIGENE] }),
    ];
    expect(await gleicheAb(db, syncOpt(a))).toMatchObject({ termine: 1, mails: 0 });
    const [x] = await aktivitaeten();
    expect(x).toMatchObject({ art: "termin", titel: "Gespräch Alpha", personId: P_ANNA, organisationId: ID.orgA, notiz: null });
    const [h] = await herkunft();
    expect(h!.beginn.getTime()).toBe(beginn.getTime());
    expect(h!.ende!.getTime()).toBe(beginn.getTime() + 3_600_000);
    expect(h!.personIds).toEqual([P_ANNA]);
    expect(JSON.stringify([x, h])).not.toMatch(/extern@unbekannt|arzt@praxis|Privater/);
  });

  it("Änderungen am Termin aktualisieren dieselbe Aktivität (kein zweiter Eintrag); Absage entfernt sie", async () => {
    await verbinde(vera, "kalender");
    const a = new FakeAnbieter();
    const t1 = termin({ titel: "Erstgespräch", teilnehmer: [EIGENE, "info@beta.example.com"] });
    a.termine = [t1];
    await gleicheAb(db, syncOpt(a));
    const [erste] = await aktivitaeten();

    t1.titel = "Erstgespräch (verschoben)";
    t1.beginn = nach(5, 14);
    t1.ende = nach(5, 15);
    await faellig();
    expect(await gleicheAb(db, syncOpt(a))).toMatchObject({ termine: 1 });
    const liste = await aktivitaeten();
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ id: erste!.id, titel: "Erstgespräch (verschoben)" });
    expect((await herkunft())[0]!.beginn.getTime()).toBe(nach(5, 14).getTime());
    // Ohne Änderung nichts zu tun.
    await faellig();
    expect((await gleicheAb(db, syncOpt(a))).termine).toBe(0);
    const aenderungen = (await db.execute(sql`SELECT aktion FROM aenderung WHERE tabelle = 'aktivitaet' AND datensatz_id = ${erste!.id} ORDER BY am, id`)).rows.map((r) => r.aktion);
    expect(aenderungen).toEqual(["anlegen", "aendern"]);

    t1.abgesagt = true;
    await faellig();
    await gleicheAb(db, syncOpt(a));
    expect((await db.execute(sql`SELECT fonds_id FROM aenderung WHERE aktion = 'loeschen' AND datensatz_id = ${erste!.id}`)).rows).toEqual([{ fonds_id: ID.fonds }]);
    expect(await aktivitaeten()).toHaveLength(0);
    expect(await herkunft()).toHaveLength(0);
  });

  it("derselbe Termin bei zwei Personen: Titeländerung und Absage der zweiten Person ändern oder löschen die Aktivität der ersten nie", async () => {
    await verbinde(vera, "kalender");
    const av = new FakeAnbieter();
    const tv = termin({ id: "gemeinsam@sync.example", titel: "Gemeinsames Gespräch", teilnehmer: [EIGENE, "bernd@fonds.example.org", "anna@alpha.example.com"] });
    av.termine = [tv];
    await gleicheAb(db, syncOpt(av));
    const [erste] = await aktivitaeten();
    const besitzerin = await idVon(db, vera);
    expect((await herkunft())[0]!.benutzerId).toBe(besitzerin);

    // Bernd sieht denselben Termin (gleiche Ereignis-ID), ändert aber den Titel und die Zeit, später sagt er ab.
    await verbinde(bernd, "kalender", {}, "bernd@fonds.example.org");
    const ab = new FakeAnbieter();
    const tb = { ...tv, titel: "Von Bernd umbenannt", beginn: nach(6, 14), ende: nach(6, 15) };
    ab.termine = [tb];
    const nurBernd = syncOpt(av, { anbieter: async (_art, zugang) => (zugang.adresse === "bernd@fonds.example.org" ? ab : av) });
    await faellig();
    await gleicheAb(db, nurBernd);
    let liste = await aktivitaeten();
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ id: erste!.id, titel: "Gemeinsames Gespräch", datum: erste!.datum });
    expect((await herkunft())[0]).toMatchObject({ benutzerId: besitzerin, beginn: tv.beginn });

    tb.abgesagt = true;
    await faellig();
    await gleicheAb(db, nurBernd);
    liste = await aktivitaeten();
    expect(liste).toHaveLength(1);
    expect(liste[0]!.id).toBe(erste!.id);
    expect(await herkunft()).toHaveLength(1);
    const protokoll = (await db.execute(sql`SELECT aktion FROM aenderung WHERE tabelle = 'aktivitaet' AND datensatz_id = ${erste!.id} ORDER BY am, id`)).rows.map((r) => r.aktion);
    expect(protokoll).toEqual(["anlegen"]);

    // Die Besitzerin selbst aktualisiert und löscht weiterhin.
    tv.titel = "Gemeinsames Gespräch (neu)";
    await faellig();
    await gleicheAb(db, nurBernd);
    expect((await aktivitaeten())[0]).toMatchObject({ id: erste!.id, titel: "Gemeinsames Gespräch (neu)" });
    tv.abgesagt = true;
    await faellig();
    await gleicheAb(db, nurBernd);
    expect(await aktivitaeten()).toHaveLength(0);
  });

  it("Serientermine zählen je Instanz; ein entfernter Termin kommt nicht wieder", async () => {
    await verbinde(vera, "kalender");
    const a = new FakeAnbieter();
    const gemeinsam = { id: "serie@sync.example", teilnehmer: [EIGENE, "anna@alpha.example.com"] };
    a.termine = [termin({ ...gemeinsam, instanz: nach(1).toISOString(), beginn: nach(1), ende: nach(1, 10) }), termin({ ...gemeinsam, instanz: nach(8).toISOString(), beginn: nach(8), ende: nach(8, 10) })];
    expect((await gleicheAb(db, syncOpt(a))).termine).toBe(2);
    const [x] = await aktivitaeten();
    expect((await t.request(`/aktivitaeten/${x!.id}/sync-entfernen`, { method: "POST", als: vera })).status).toBe(204);
    await faellig();
    expect((await gleicheAb(db, syncOpt(a))).termine).toBe(0);
    expect(await aktivitaeten()).toHaveLength(1);
  });

  it("nächste Termine: kommende, zeitlich geordnet, Filter, eigene; fremde Fonds bleiben unsichtbar", async () => {
    await verbinde(vera, "kalender");
    await verbinde(bernd, "kalender", {}, "bernd@fonds.example.org");
    const a = new FakeAnbieter();
    a.termine = [
      termin({ titel: "Später", beginn: nach(6), ende: nach(6, 10), teilnehmer: [EIGENE, "anna@alpha.example.com"] }),
      termin({ titel: "Bald Beta", beginn: nach(1), ende: nach(1, 10), teilnehmer: [EIGENE, "info@beta.example.com"] }),
      termin({ titel: "Vorbei", beginn: vor(3), ende: vor(3, 11), teilnehmer: [EIGENE, "anna@alpha.example.com"] }),
      termin({ titel: "Delta (anderer Fonds)", beginn: nach(2), ende: nach(2, 10), teilnehmer: [EIGENE, "info@delta.example.com"] }),
    ];
    await gleicheAb(db, syncOpt(a, { max: 1 })); // eine Verbindung je Lauf: erst Veras
    await faellig();
    const veraTermine = await json(await t.request("/termine", { als: vera }));
    expect(veraTermine.daten.map((x: { titel: string }) => x.titel)).toEqual(["Bald Beta", "Später"]); // „Vorbei“ nicht, Delta (anderer Fonds) nicht
    expect(veraTermine.daten[0]).toMatchObject({ organisation: { name: "Beta Beispiel" }, deal: { titel: "Runde Beta" }, eigene: true, anbieter: "microsoft" });
    expect(Object.keys(veraTermine.daten[0]).sort()).toEqual(["anbieter", "beginn", "datum", "deal", "eigene", "ende", "id", "organisation", "person", "titel"]);

    // Filter nach Organisation, Person, Deal
    const nachOrg = await json(await t.request(`/termine?organisationId=${ID.orgB}`, { als: vera }));
    expect(nachOrg.daten.map((x: { titel: string }) => x.titel)).toEqual(["Bald Beta"]);
    const nachPerson = await json(await t.request(`/termine?personId=${P_ANNA}`, { als: vera }));
    expect(nachPerson.daten.map((x: { titel: string }) => x.titel)).toEqual(["Später"]);
    const nachDeal = await json(await t.request(`/termine?dealId=${DEAL_B}`, { als: vera }));
    expect(nachDeal.daten).toHaveLength(1);
    expect((await json(await t.request("/termine?limit=1", { als: vera }))).daten).toHaveLength(1);
    expect((await t.request("/termine?limit=0", { als: vera })).status).toBe(400);

    // Bernd sieht dieselben Termine nach CRM-Regeln, aber nicht als eigene; mit `eigene=true` nur seine.
    const bernds = await json(await t.request("/termine", { als: bernd }));
    expect(bernds.daten.every((x: { eigene: boolean }) => x.eigene === false)).toBe(true);
    expect((await json(await t.request("/termine?eigene=true", { als: bernd }))).daten).toEqual([]);
    // Wer nur den anderen Fonds sieht, sieht den Delta-Termin (Deal im anderen Fonds), aber nicht den Termin zum Deal von Fonds eins.
    const anderer = await json(await t.request("/termine", { als: nurAnderer }));
    expect(anderer.daten.map((x: { titel: string }) => x.titel)).not.toContain("Bald Beta");
    expect(anderer.daten.map((x: { titel: string }) => x.titel)).toContain("Delta (anderer Fonds)");
  });
});

describe("Verwaiste synchronisierte Aktivitäten", () => {
  const BERND = "bernd@fonds.example.org";
  const ANDERER = "anderer@fonds.example.org";
  const trenne = (id: string) => db.delete(s.postfachVerbindung).where(eq(s.postfachVerbindung.id, id));
  const protokollVon = async (id: string) => (await db.execute(sql`SELECT aktion, vorher, nachher FROM aenderung WHERE tabelle = 'aktivitaet' AND datensatz_id = ${id} ORDER BY am, id`)).rows as { aktion: string; vorher: unknown; nachher: unknown }[];
  const aktionen = async (id: string) => (await protokollVon(id)).map((z) => z.aktion).sort();

  it("Termin: Solange die Besitzerin verbunden ist, überschreibt nie jemand; nach dem Trennen übernimmt eine echte Teilnehmerin, ändert im selben Lauf nichts und pflegt ihn erst in späteren Läufen", async () => {
    const veraVerbindung = await verbinde(vera, "kalender");
    const av = new FakeAnbieter();
    const tv = termin({ id: "waise@sync.example", titel: "Gespräch über Alpha", teilnehmer: [EIGENE, BERND, "anna@alpha.example.com"] });
    av.termine = [tv];
    await gleicheAb(db, syncOpt(av));
    const [erste] = await aktivitaeten();
    const vera_ = await idVon(db, vera);
    const bernd_ = await idVon(db, bernd);

    await verbinde(bernd, "kalender", {}, BERND);
    const ab = new FakeAnbieter();
    const tb = { ...tv, titel: "Von Bernd umbenannt" };
    ab.termine = [tb];
    const nurBernd = syncOpt(av, { anbieter: async (_art, zugang) => (zugang.adresse === BERND ? ab : av) });
    await faellig();
    await gleicheAb(db, nurBernd);
    // Besitzerin verbunden: unverändert
    expect((await herkunft())[0]!.benutzerId).toBe(vera_);
    expect((await aktivitaeten())[0]).toMatchObject({ id: erste!.id, titel: "Gespräch über Alpha" });

    // Vera trennt ihren Kalender: Die Aktivität bleibt, gehört aber niemandem mehr, der sie abgleicht.
    await trenne(veraVerbindung);
    expect(await aktivitaeten()).toHaveLength(1);
    await faellig();
    await gleicheAb(db, nurBernd);
    // Übernommen, aber im selben Lauf nichts umgeschrieben (Titel bleibt), keine Anbieter-ID
    expect(await aktivitaeten()).toHaveLength(1);
    expect((await herkunft())[0]).toMatchObject({ benutzerId: bernd_, anbieter: "microsoft", anbieterId: null });
    expect((await herkunft())[0]!.uebernommenAm).toBeInstanceOf(Date);
    expect((await aktivitaeten())[0]).toMatchObject({ id: erste!.id, titel: "Gespräch über Alpha" });
    expect(await aktionen(erste!.id)).toEqual(["anlegen", "uebernehmen"]);
    const uebernahme = (await protokollVon(erste!.id)).find((z) => z.aktion === "uebernehmen");
    expect(uebernahme).toMatchObject({ vorher: { besitzer: vera_ }, nachher: { besitzer: bernd_ } });
    expect(JSON.stringify(await protokollVon(erste!.id))).not.toContain("Von Bernd umbenannt");

    // Ein späterer Lauf der neuen Besitzerin darf aktualisieren.
    await faellig();
    await gleicheAb(db, nurBernd);
    expect((await aktivitaeten())[0]).toMatchObject({ id: erste!.id, titel: "Von Bernd umbenannt" });

    // Verbindet sich Vera wieder, gehört der Termin weiter Bernd: Veras Abgleich überschreibt nichts.
    await verbinde(vera, "kalender");
    tv.titel = "Veras Titel";
    await faellig();
    await gleicheAb(db, nurBernd);
    expect((await herkunft())[0]!.benutzerId).toBe(bernd_);
    expect((await aktivitaeten())[0]).toMatchObject({ id: erste!.id, titel: "Von Bernd umbenannt" });

    // Absage (bei beiden): Ein übernommener Termin wird nie gelöscht, die Absage wird nur vermerkt.
    tb.abgesagt = true;
    tv.abgesagt = true;
    await faellig();
    await gleicheAb(db, nurBernd);
    expect(await aktivitaeten()).toHaveLength(1);
    expect((await herkunft())[0]!.absageGemeldetAm).toBeInstanceOf(Date);
    expect(await aktionen(erste!.id)).toEqual(expect.arrayContaining(["absage_melden"]));
    expect(await aktionen(erste!.id)).not.toContain("loeschen");
  });

  it("die Absage des Übernehmenden löscht den Termin nicht im selben Lauf, in dem er ihn übernimmt", async () => {
    const veraVerbindung = await verbinde(vera, "kalender");
    const av = new FakeAnbieter();
    const tv = termin({ id: "gleichzeitig@sync.example", titel: "Gespräch", teilnehmer: [EIGENE, BERND, "anna@alpha.example.com"] });
    av.termine = [tv];
    await gleicheAb(db, syncOpt(av));
    await verbinde(bernd, "kalender", {}, BERND);
    await trenne(veraVerbindung);
    const ab = new FakeAnbieter();
    ab.termine = [{ ...tv, abgesagt: true }];
    await faellig();
    await gleicheAb(db, syncOpt(av, { anbieter: async () => ab }));
    // übernommen, nicht gelöscht, noch nicht einmal als abgesagt vermerkt (nichts im selben Lauf)
    expect(await aktivitaeten()).toHaveLength(1);
    expect((await herkunft())[0]!.absageGemeldetAm).toBeNull();
    // erst der nächste Lauf vermerkt die Absage, löscht aber nichts
    await faellig();
    await gleicheAb(db, syncOpt(av, { anbieter: async () => ab }));
    expect(await aktivitaeten()).toHaveLength(1);
    expect((await herkunft())[0]!.absageGemeldetAm).toBeInstanceOf(Date);
  });

  it("Mail: Solange die Besitzerin verbunden ist, bleibt die Nachricht bei ihr; nach dem Trennen übernimmt eine echte Empfängerin (ohne Anbieter-ID, keine zweite Aktivität)", async () => {
    const veraMail = await verbinde(vera, "mail");
    await verbinde(vera, "kalender");
    const a = new FakeAnbieter();
    a.mails = [mail({ von: "anna@alpha.example.com", an: [EIGENE, BERND], betreff: "Zu zweit" })];
    await gleicheAb(db, syncOpt(a));
    const [erste] = await aktivitaeten();
    const vera_ = await idVon(db, vera);
    const bernd_ = await idVon(db, bernd);
    expect((await herkunft())[0]!.benutzerId).toBe(vera_);
    expect((await herkunft())[0]!.anbieterId).toBe(a.mails[0]!.id);

    // Bernd verbindet seine Mails, während Vera noch verbunden ist: Die Nachricht bleibt bei ihr.
    const berndMail = await verbinde(bernd, "mail", {}, BERND);
    await faellig();
    expect((await gleicheAb(db, syncOpt(a))).mails).toBe(0);
    expect((await herkunft())[0]!.benutzerId).toBe(vera_);
    expect(await aktionen(erste!.id)).toEqual(["anlegen"]);

    // Vera trennt die Mails (ihr Kalender bleibt), Bernd verbindet neu und sieht die Nachricht wieder: Sie gehört jetzt ihm.
    await trenne(veraMail);
    await trenne(berndMail);
    await verbinde(bernd, "mail", {}, BERND);
    const e = await gleicheAb(db, syncOpt(a));
    expect(e.mails).toBe(0);
    expect(await aktivitaeten()).toHaveLength(1);
    expect((await herkunft())[0]).toMatchObject({ benutzerId: bernd_, aktivitaetId: erste!.id, anbieterId: null });
    expect(await aktionen(erste!.id)).toEqual(["anlegen", "uebernehmen"]);
    // wiederholter Lauf: nichts mehr zu übernehmen
    await faellig();
    await gleicheAb(db, syncOpt(a));
    expect(await aktionen(erste!.id)).toEqual(["anlegen", "uebernehmen"]);
  });

  it("eine gefälschte Message-ID übernimmt nichts: andere Angaben oder keine Beteiligung am Original genügen nicht", async () => {
    const veraMail = await verbinde(vera, "mail");
    const a = new FakeAnbieter();
    const original = mail({ von: "anna@alpha.example.com", an: [EIGENE, BERND], betreff: "Vertrauliches Original" });
    a.mails = [original];
    await gleicheAb(db, syncOpt(a));
    const vera_ = await idVon(db, vera);
    await trenne(veraMail);

    // Eine Person, die nicht zu den Empfängern gehörte, sieht eine Mail mit derselben Message-ID, aber anderem Inhalt (Fälschung)
    await verbinde(nurAnderer, "mail", {}, ANDERER);
    const faelschung = new FakeAnbieter();
    faelschung.mails = [{ ...original, id: "x-gefaelscht", betreff: "Etwas ganz anderes", datum: vor(3), an: [ANDERER] }];
    await gleicheAb(db, syncOpt(faelschung));
    expect((await herkunft())[0]).toMatchObject({ benutzerId: vera_, anbieterId: original.id });

    // Gleicher Inhalt, aber die eigene Adresse stand nicht unter den Beteiligten des Originals: keine Übernahme
    await faellig();
    const gleich = new FakeAnbieter();
    gleich.mails = [{ ...original, id: "x-gleich", an: [EIGENE, BERND, ANDERER] }];
    await gleicheAb(db, syncOpt(gleich));
    expect((await herkunft())[0]).toMatchObject({ benutzerId: vera_, anbieterId: original.id });
    expect(await aktivitaeten()).toHaveLength(1);
    expect(await aktionen((await aktivitaeten())[0]!.id)).toEqual(["anlegen"]);
  });

  it("neue Zeilen haben einen Hash je Anbieter: dieselbe Message-ID bei einem anderen Anbieter verdrängt die echte Nachricht nicht", async () => {
    await verbinde(vera, "mail", { anbieter: "microsoft" });
    await verbinde(nurAnderer, "mail", { anbieter: "google" }, ANDERER);
    const echt = new FakeAnbieter();
    echt.mails = [mail({ von: "anna@alpha.example.com", an: [EIGENE], betreff: "Echt" })];
    const fremd = new FakeAnbieter();
    // dieselbe Nachrichten-ID, aber eine andere Nachricht an die andere Person
    fremd.mails = [{ ...echt.mails[0]!, id: "g1", betreff: "Fremd", an: [ANDERER] }];
    await gleicheAb(db, syncOpt(echt, { anbieter: async (_art, zugang) => (zugang.adresse === ANDERER ? fremd : echt) }));
    expect((await aktivitaeten()).map((x) => x.titel).sort()).toEqual(["Echt", "Fremd"]);
    expect(new Set((await herkunft()).map((h) => h.externHash)).size).toBe(2);
  });

  it("schon gespeicherte Zeilen mit dem früheren Hash (ohne Anbieter) werden weiter als bekannt erkannt, es entsteht keine Dublette", async () => {
    await verbinde(vera, "kalender");
    const a = new FakeAnbieter();
    const tv = termin({ id: "alt@sync.example", titel: "Alter Termin", teilnehmer: [EIGENE, "anna@alpha.example.com"] });
    a.termine = [tv];
    await gleicheAb(db, syncOpt(a));
    await db.update(s.aktivitaetSync).set({ externHash: externHash("kalender", tv.id) });
    await faellig();
    await gleicheAb(db, syncOpt(a));
    expect(await aktivitaeten()).toHaveLength(1);
    expect(await herkunft()).toHaveLength(1);
  });

  it("wer das Element selbst entfernt hat, übernimmt es nicht; ohne andere Verbindung bleibt es beim bisherigen Eintrag", async () => {
    const veraMail = await verbinde(vera, "mail");
    const a = new FakeAnbieter();
    a.mails = [mail({ von: "anna@alpha.example.com", an: [EIGENE, BERND], betreff: "Entfernt" })];
    await gleicheAb(db, syncOpt(a));
    const bernd_ = await idVon(db, bernd);
    const vera_ = await idVon(db, vera);
    await db.insert(s.syncAusschluss).values({ benutzerId: bernd_, externHash: (await herkunft())[0]!.externHash });
    await trenne(veraMail);
    await verbinde(bernd, "mail", {}, BERND);
    await gleicheAb(db, syncOpt(a));
    expect((await herkunft())[0]!.benutzerId).toBe(vera_);
    expect(await aktivitaeten()).toHaveLength(1);
  });
});

describe("Sichtbarkeit nach den CRM-Regeln und Rechte", () => {
  it("synchronisierte Aktivitäten zu Deals fremder Fonds sind in der Liste unsichtbar; ohne Deal sichtbar für alle mit Rolle; `sync.eigene` je Person", async () => {
    await verbinde(vera, "mail");
    const a = new FakeAnbieter();
    a.mails = [
      mail({ von: "info@delta.example.com", an: [EIGENE], betreff: "Zu Delta (anderer Fonds)" }),
      mail({ von: "anna@alpha.example.com", an: [EIGENE], betreff: "Zu Alpha ohne Deal" }),
    ];
    await gleicheAb(db, syncOpt(a));
    const sicht = async (als: Testperson) => (await json(await t.request(`/aktivitaeten?organisationId=${ID.orgA}`, { als }))).daten as { titel: string; sync: { eigene: boolean; anbieter: string } | null }[];
    const veras = await sicht(vera);
    expect(veras.map((x) => x.titel)).toEqual(["Zu Alpha ohne Deal"]);
    expect(veras[0]!.sync).toMatchObject({ eigene: true, anbieter: "microsoft" });
    expect((await sicht(bernd))[0]!.sync!.eigene).toBe(false);
    expect((await sicht(nurAnderer)).map((x) => x.titel)).toEqual(["Zu Alpha ohne Deal"]);
    const delta = async (als: Testperson) => ((await json(await t.request(`/aktivitaeten?organisationId=${ORG_D}`, { als }))).daten as { titel: string }[]).map((x) => x.titel);
    expect(await delta(vera)).toEqual([]); // Fonds eins sieht den Deal des zweiten Fonds nicht
    expect(await delta(nurAnderer)).toEqual(["Zu Delta (anderer Fonds)"]);
    // Aktivitäten an der Person erscheinen auch, wenn die Person nur Teilnehmerin ist.
    expect((await json(await t.request(`/aktivitaeten?personId=${P_ANNA}`, { als: vera }))).daten).toHaveLength(1);
  });

  it("Verwalter und andere Personen sehen keine nicht abgeglichenen Daten und keine fremden Verbindungen (die API gibt es nicht)", async () => {
    await verbinde(vera, "mail");
    const global = person("ab-global", { globalVerwalter: true });
    const liste = await json(await t.request("/postfach", { als: global }));
    expect(liste.verbindungen).toEqual([]);
    const text = JSON.stringify(await json(await t.request("/changes?limit=1000", { als: global })));
    expect(text).not.toContain("zugang");
  });

  it("ein fehlgeschlagener Abgleich meldet nur einen Code, keine Adressen, keine Betreffs im Log", async () => {
    await verbinde(vera, "mail");
    const a = new FakeAnbieter();
    a.mails = [mail({ von: "anna@alpha.example.com", an: [EIGENE], betreff: "Streng vertraulich" })];
    a.holeMailKoepfe = async () => {
      throw new Error(`Antwort des Anbieters mit ${EIGENE} und Streng vertraulich`);
    };
    const zeilen: string[] = [];
    const e = await gleicheAb(db, syncOpt(a, { logger: (stufe, meldung, f) => zeilen.push(JSON.stringify({ stufe, meldung, ...f })) }));
    expect(e.fehler).toBe(1);
    expect((await db.select().from(s.postfachVerbindung))[0]).toMatchObject({ status: "fehler", letzterFehler: "ABGLEICH_FEHLER" });
    expect(zeilen.join("\n")).not.toMatch(/vera@|Streng vertraulich/);
  });
});
