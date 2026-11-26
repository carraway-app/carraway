import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { Schluesselring } from "../geheimnis/krypto";
import { ladeBekannte } from "../postfach/abgleich";
import { FakeAnbieter } from "../postfach/fake";
import {
  istGesperrt,
  istNoReply,
  kandidatenAusMails,
  kandidatenAusTerminen,
  namensteile,
  normalisiereListe,
  unternehmensDomain,
  unternehmensname,
  type KontaktRegeln,
} from "../postfach/kontakte";
import { gleicheAb, gleicheVerbindungAb, type SyncOptionen } from "../postfach/sync";
import type { MailKopf, Termin, Zugang } from "../postfach/typen";
import { verschluesseleZugang } from "../postfach/zugang";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, idVon, legePersonAn, person, type Testperson } from "./hilfen-auth";
import { grundbestand, ID } from "./hilfen-instrumente";
import { postfachKonfig } from "./hilfen-postfach";

/**
 * Kontakte aus Postfach und Kalender: Filter (nur echte Gegenüber), Zuordnung zu Unternehmen je Domain, keine Dubletten bei gleichzeitigen Abgleichen, Vorschläge
 * (übernehmen, zusammenführen, verwerfen), Nachholen, Trennen, Rechte und der Aus-Zustand. Anbieter sind Fakes; alle Adressen und Namen sind erfunden.
 */

const { db, pool } = oeffneTestdb();
const ring = new Schluesselring(randomBytes(32));
const t = erstelleTestApp(db, { schluessel: ring, postfach: postfachKonfig() });

const vera = person("kp-vera", { rollen: { [ID.fonds]: "bearbeiter" } });
const bernd = person("kp-bernd", { rollen: { [ID.fonds]: "bearbeiter" } });
const leser = person("kp-leser", { rollen: { [ID.fonds]: "betrachter" } });
const chefin = person("kp-chefin", { globalVerwalter: true });
const geht = person("kp-geht", { rollen: { [ID.fonds]: "bearbeiter" } });
const VERA = "vera@fonds.example.org";
const BERND = "bernd@fonds.example.org";
const EIGENE_ADRESSEN = new Set([VERA, BERND, "geht@fonds.example.org", "ich@gmail.com"]);
const P_ANNA = "00000000-0000-4000-8000-0000000001a1";

const jetzt = new Date();
const vor = (tage: number, stunde = 10) => {
  const d = new Date(jetzt.getTime() - tage * 86_400_000);
  d.setUTCHours(stunde, 0, 0, 0);
  return d;
};

let nr = 0;
const mail = (zusatz: Partial<MailKopf> & Pick<MailKopf, "von" | "an">): MailKopf => {
  nr++;
  // Gesendet ist ein Anbieterfakt (Ordner „Gesendet“); hier vorbelegt für Mails mit eigener Adresse als Absender, Tests zu Fälschungen setzen es ausdrücklich.
  return { id: `k${nr}`, nachrichtenId: `<k${nr}@kontakte.example>`, datum: vor(1), betreff: `Betreff ${nr}`, cc: [], ...(EIGENE_ADRESSEN.has(zusatz.von) ? { gesendet: true } : {}), ...zusatz };
};
const termin = (zusatz: Partial<Termin> & Pick<Termin, "teilnehmer">): Termin => {
  nr++;
  return { id: `kt${nr}@kontakte.example`, instanz: null, titel: `Termin ${nr}`, beginn: vor(-2, 9), ende: vor(-2, 10), eigeneAntwort: "angenommen", abgesagt: false, ...zusatz };
};

const ohneAntwort = (x: Termin): Termin => {
  const kopie = { ...x };
  delete kopie.eigeneAntwort;
  return kopie;
};

async function verbinde(als: Testperson, bereich: "mail" | "kalender", adresse: string) {
  const id = crypto.randomUUID();
  const zugang: Zugang = { art: "oauth", accessToken: "a", refreshToken: "r", ablaufMs: Date.now() + 3_600_000, adresse };
  await db.insert(s.postfachVerbindung).values({ id, benutzerId: await idVon(db, als), bereich, anbieter: "microsoft", zugangVerschluesselt: verschluesseleZugang(ring, id, zugang) });
  return id;
}

const syncOpt = (anbieter: FakeAnbieter | ((zugang: Zugang) => FakeAnbieter)): SyncOptionen => ({
  ring,
  konfig: postfachKonfig(),
  abrufer: fetch,
  anbieter: async (_a, zugang) => (typeof anbieter === "function" ? anbieter(zugang) : anbieter),
});
const faellig = () => db.update(s.postfachVerbindung).set({ naechsterAbgleichAm: new Date(Date.now() - 60_000), gesperrtBis: null });

async function einstellen(modus: "aus" | "vorschlag" | "direkt", zusatz: { eigeneDomains?: string[]; sperrliste?: string[] } = {}) {
  await db
    .insert(s.kontaktabgleichEinstellung)
    .values({ id: 1, modus, eigeneDomains: zusatz.eigeneDomains ?? [], sperrliste: zusatz.sperrliste ?? [] })
    .onConflictDoUpdate({ target: s.kontaktabgleichEinstellung.id, set: { modus, eigeneDomains: zusatz.eigeneDomains ?? [], sperrliste: zusatz.sperrliste ?? [] } });
}
async function teilnehmen(als: Testperson, sperrliste: string[] = []) {
  const benutzerId = await idVon(db, als);
  await db.insert(s.kontaktabgleichTeilnahme).values({ benutzerId, teilnehmen: true, sperrliste }).onConflictDoUpdate({ target: s.kontaktabgleichTeilnahme.benutzerId, set: { teilnehmen: true, sperrliste } });
}

const personen = () => db.select().from(s.person).orderBy(s.person.email);
const organisationen = () => db.select().from(s.organisation).orderBy(s.organisation.name);
const vorschlaege = () => db.select().from(s.kontaktVorschlag).orderBy(s.kontaktVorschlag.adresse);

beforeEach(async () => {
  await leeren(db);
  await grundbestand(db);
  await db.update(s.organisation).set({ website: "https://www.alpha.example.com" }).where(eq(s.organisation.id, ID.orgA));
  await db.insert(s.person).values({ id: P_ANNA, vorname: "Anna", nachname: "Alpha", email: "anna@alpha.example.com", organisationId: ID.orgA });
  for (const p of [vera, bernd, leser, chefin, geht]) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Filter: nur echte Gegenüber", () => {
  const regeln = (zusatz: Partial<KontaktRegeln> = {}): KontaktRegeln => ({ modus: "vorschlag", eigeneDomains: ["fonds.example.org"], sperrliste: [], interneAdressen: new Set(), ...zusatz });

  it("Mails: nur Empfänger eigener gesendeter Mails; eingehende, intern, Sperrliste, no-reply, Massenmail, viele Empfänger und bekannte Personen nie", async () => {
    const bekannte = await db.transaction((tx) => ladeBekannte(tx));
    const koepfe = [
      mail({ von: VERA, an: ["max.muster@neu.example.com"], namen: { "max.muster@neu.example.com": "Max Muster" } }),
      mail({ von: "eingehend@fremd.example.com", an: [VERA] }), // eingehend allein: nie
      mail({ von: VERA, an: ["kollege@fonds.example.org", "kollegin@buero.fonds.example.org"] }), // eigene Domain samt Unterdomain
      mail({ von: VERA, an: ["privat@gmail.com", "x@gesperrt.example.net", "y@sub.gesperrt.example.net", "genau@frei.example.net"] }),
      mail({ von: VERA, an: ["noreply@dienst.example.com", "do-not-reply@dienst.example.com", "mailer-daemon@dienst.example.com", "news+abc@dienst.example.com"] }),
      mail({ von: VERA, an: ["liste@verteiler.example.com"], massenmail: true }),
      mail({ von: VERA, an: Array.from({ length: 11 }, (_, i) => `empfaenger${i}@viele.example.com`) }),
      mail({ von: VERA, an: ["anna@alpha.example.com", "Anna@Alpha.Example.com"] }), // bekannte Person
      mail({ von: "rundbrief@kanal.example.com", an: [VERA], massenmail: true }),
      mail({ von: VERA, an: ["rundbrief@kanal.example.com"] }), // Absender einer Massenmail im selben Abruf
      mail({ von: VERA, an: ["benutzerin@extern.example.com"] }), // Adresse einer Benutzerin der Installation
      mail({ von: VERA, cc: ["kopie@neu.example.com"], an: [] }),
      // Gefälschter Absender: From ist die eigene Adresse, die Mail liegt aber nicht im Ordner „Gesendet“
      mail({ von: VERA, an: ["gefaelscht@angreifer.example.com"], gesendet: false }),
      mail({ von: "Vera@Fonds.Example.org", an: ["auch-gefaelscht@angreifer.example.com"] }), // ohne Anbieterfakt
    ];
    const r = regeln({ sperrliste: normalisiereListe(["@gesperrt.example.net", "privat@gmail.com", "genau@frei.example.net"]), interneAdressen: new Set(["benutzerin@extern.example.com"]) });
    expect(kandidatenAusMails(koepfe, VERA, bekannte, r)).toEqual([
      { adresse: "kopie@neu.example.com", name: null },
      { adresse: "max.muster@neu.example.com", name: "Max Muster" },
    ]);
  });

  it("Termine: Teilnehmer gemeinsamer Termine (auch Organisator); abgesagte, fremde und große Termine nie; eigene Freemail-Domain ist nicht intern", async () => {
    const bekannte = await db.transaction((tx) => ladeBekannte(tx));
    const termine = [
      termin({ teilnehmer: [VERA, "gast@neu.example.com"], organisator: "orga@neu.example.com", namen: { "orga@neu.example.com": "Muster, Erika" } }),
      termin({ teilnehmer: [VERA, "abgesagt@neu.example.com"], abgesagt: true }),
      termin({ teilnehmer: ["ohne-mich@neu.example.com", "jemand@neu.example.com"] }),
      termin({ teilnehmer: [VERA, ...Array.from({ length: 20 }, (_, i) => `webinar${i}@gross.example.com`)] }),
      // Einladungen kann jeder Fremde schicken: offen, mit Vorbehalt und abgelehnt zählen nicht, ebenso ohne Angabe
      termin({ teilnehmer: [VERA, "eingeladen@angreifer.example.com"], eigeneAntwort: "offen" }),
      termin({ teilnehmer: [VERA, "vorbehalt@angreifer.example.com"], eigeneAntwort: "vorbehalt" }),
      termin({ teilnehmer: [VERA, "abgelehnt@angreifer.example.com"], eigeneAntwort: "abgelehnt" }),
      ohneAntwort(termin({ teilnehmer: [VERA, "ohne-antwort@angreifer.example.com"] })),
      termin({ teilnehmer: [VERA, "selbst-organisiert@neu.example.com"], eigeneAntwort: "organisator" }),
    ];
    expect(kandidatenAusTerminen(termine, VERA, bekannte, regeln())).toEqual([
      { adresse: "gast@neu.example.com", name: null },
      { adresse: "orga@neu.example.com", name: "Muster, Erika" },
      { adresse: "selbst-organisiert@neu.example.com", name: null },
    ]);
    // Wer selbst eine Freemail-Adresse nutzt: Andere Adressen bei demselben Anbieter sind Fremde, keine Kollegen.
    expect(kandidatenAusMails([mail({ von: "ich@gmail.com", an: ["freundin@gmail.com"] })], "ich@gmail.com", bekannte, regeln({ eigeneDomains: [] }))).toEqual([{ adresse: "freundin@gmail.com", name: null }]);
  });

  it("Bausteine: Namen, Unternehmensdomain und -name, Sperrliste, no-reply, Normalisierung", () => {
    expect(namensteile("Max Muster", "x@y.example")).toEqual({ vorname: "Max", nachname: "Muster" });
    expect(namensteile("Muster, Erika", "x@y.example")).toEqual({ vorname: "Erika", nachname: "Muster" });
    expect(namensteile(null, "erika.maria.muster@y.example")).toEqual({ vorname: "Erika Maria", nachname: "Muster" });
    expect(namensteile(null, "kontakt@y.example")).toEqual({ vorname: "", nachname: "Kontakt" });
    expect(unternehmensDomain("a@Neu.Example.com")).toBe("neu.example.com");
    for (const a of ["a@gmail.com", "a@web.de", "a@firma.github.io", "a@co.uk", "a@intranet"]) expect(unternehmensDomain(a), a).toBeNull();
    expect(unternehmensname("beispiel-gmbh.de")).toBe("Beispiel-gmbh");
    expect(unternehmensname("mail.firma.co.uk")).toBe("Firma");
    expect(istGesperrt("a@sub.privat.example", ["privat.example"])).toBe(true);
    expect(istGesperrt("a@privat.example.net", ["privat.example"])).toBe(false);
    expect(istGesperrt("A@x.example", ["a@x.example"])).toBe(true);
    expect(istNoReply("noreply-123@x.example")).toBe(true);
    expect(istNoReply("norbert@x.example")).toBe(false);
    expect(normalisiereListe([" @Privat.Example ", "https://www.firma.example/pfad", "a@B.example", "kein eintrag", "", "a@b.example"])).toEqual(["a@b.example", "privat.example", "www.firma.example"]);
  });
});

describe("Aus-Zustand", () => {
  it("Standard aus, ohne Teilnahme oder mit Modus aus: kein Kontakt, kein Vorschlag, Abgleich wie bisher", async () => {
    await verbinde(vera, "mail", VERA);
    const a = new FakeAnbieter();
    a.mails = [mail({ von: VERA, an: ["neu@neu.example.com"], betreff: "An Neu" }), mail({ von: "anna@alpha.example.com", an: [VERA], betreff: "Von Anna" })];
    // Ohne Zeile der Einstellung (Standard)
    expect(await gleicheAb(db, syncOpt(a))).toMatchObject({ mails: 1, fehler: 0 });
    // Modus vorschlag, Person nimmt aber nicht teil
    await einstellen("vorschlag");
    a.mails.push(mail({ von: VERA, an: ["zwei@neu.example.com"], datum: new Date(jetzt.getTime() - 3_600_000) }));
    await faellig();
    await gleicheAb(db, syncOpt(a));
    // Modus aus, Person nimmt teil
    await einstellen("aus");
    await teilnehmen(vera);
    a.mails.push(mail({ von: VERA, an: ["drei@neu.example.com"], datum: new Date(jetzt.getTime() - 60_000) }));
    await faellig();
    await gleicheAb(db, syncOpt(a));
    expect(await vorschlaege()).toEqual([]);
    expect((await personen()).map((p) => p.email)).toEqual(["anna@alpha.example.com"]);
    expect(await db.select().from(s.kontaktHerkunft)).toEqual([]);
    expect((await db.select().from(s.aktivitaet)).map((x) => x.titel)).toEqual(["Von Anna"]);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM aenderung WHERE tabelle LIKE 'kontakt%'`)).rows[0]).toEqual({ n: 0 });
  });
});

describe("Vorschläge", () => {
  beforeEach(async () => {
    await einstellen("vorschlag", { eigeneDomains: ["fonds.example.org"] });
    await teilnehmen(vera);
    await teilnehmen(bernd);
  });

  it("Vorschlag entsteht nur aus gesendeter Mail, ohne Aktivität; nur die Quelle sieht ihn; Übernehmen legt Person und Unternehmen an und holt Mails nach", async () => {
    const id = await verbinde(vera, "mail", VERA);
    const a = new FakeAnbieter();
    a.mails = [
      mail({ von: "max@neu.example.com", an: [VERA], betreff: "Erste Anfrage", datum: vor(5) }),
      mail({ von: VERA, an: ["max@neu.example.com"], betreff: "Antwort", namen: { "max@neu.example.com": "Max Neumann" }, datum: vor(4) }),
    ];
    await gleicheAb(db, syncOpt(a));
    expect(await db.select().from(s.aktivitaet)).toEqual([]);
    const [v] = await vorschlaege();
    expect(v).toMatchObject({ adresse: "max@neu.example.com", name: "Max Neumann", status: "offen", personId: null });
    // Protokoll ohne Adresse und Name
    expect(JSON.stringify((await db.execute(sql`SELECT vorher, nachher FROM aenderung WHERE tabelle = 'kontakt_vorschlag'`)).rows)).not.toMatch(/max@|Neumann/);

    const liste = await json(await t.request("/kontaktvorschlaege", { als: vera }));
    expect(liste).toMatchObject({ modus: "vorschlag", daten: [{ id: v!.id, adresse: "max@neu.example.com", name: "Max Neumann", bereiche: ["mail"], unternehmen: { id: null, name: "Example", neu: true } }] });
    expect((await json(await t.request("/kontaktvorschlaege", { als: bernd }))).daten).toEqual([]);
    expect((await t.request("/kontaktvorschlaege", { als: leser })).status).toBe(403);
    expect((await t.request(`/kontaktvorschlaege/${v!.id}/uebernehmen`, { method: "POST", als: bernd })).status).toBe(404);

    const r = await t.request(`/kontaktvorschlaege/${v!.id}/uebernehmen`, { method: "POST", als: vera });
    expect(r.status).toBe(200);
    const { personId } = await json(r);
    const [p] = await db.select().from(s.person).where(eq(s.person.id, personId));
    expect(p).toMatchObject({ vorname: "Max", nachname: "Neumann", email: "max@neu.example.com" });
    const [org] = await db.select().from(s.organisation).where(eq(s.organisation.id, p!.organisationId!));
    expect(org).toMatchObject({ name: "Example", art: "unternehmen", website: "https://neu.example.com" });
    expect(await db.select().from(s.kontaktDomain)).toMatchObject([{ domain: "neu.example.com", organisationId: org!.id }]);
    expect(await db.select().from(s.beschaeftigung).where(eq(s.beschaeftigung.personId, personId))).toMatchObject([{ organisationId: org!.id, haupt: true }]);
    // Herkunft an der Person: aus wessen Postfach, wann; keine Mails
    const detail = await json(await t.request(`/personen/${personId}`, { als: leser }));
    expect(detail.herkunft).toMatchObject({ bereich: "mail", von: vera.name });
    expect(JSON.stringify(detail.herkunft)).not.toMatch(/Antwort|Anfrage/);
    expect((await json(await t.request(`/organisationen/${org!.id}`, { als: leser }))).herkunft).toMatchObject({ bereich: "mail", von: vera.name });
    expect((await json(await t.request("/kontaktvorschlaege", { als: vera }))).daten).toEqual([]);

    // Nachholen: Der nächste Lauf schaut wieder den ersten Zeitraum zurück und findet auch die frühere eingehende Mail.
    expect((await db.select().from(s.postfachVerbindung).where(eq(s.postfachVerbindung.id, id)))[0]!.nachholen).toBe(true);
    await faellig();
    await gleicheAb(db, syncOpt(a));
    expect((await db.select().from(s.aktivitaet).orderBy(s.aktivitaet.titel)).map((x) => [x.titel, x.personId])).toEqual([
      ["Antwort", personId],
      ["Erste Anfrage", personId],
    ]);
    expect((await db.select().from(s.postfachVerbindung).where(eq(s.postfachVerbindung.id, id)))[0]!.nachholen).toBe(false);
  });

  it("Verwerfen gilt dauerhaft je Person; stammt der Vorschlag auch aus einem anderen Postfach, sieht die andere Person ihn weiter", async () => {
    await verbinde(vera, "mail", VERA);
    await verbinde(bernd, "kalender", BERND);
    const a = new FakeAnbieter();
    a.mails = [mail({ von: VERA, an: ["gast@neu.example.com"] })];
    a.termine = [termin({ teilnehmer: [BERND, "gast@neu.example.com"] })];
    await gleicheAb(db, syncOpt(a));
    const [v] = await vorschlaege();
    expect((await json(await t.request("/kontaktvorschlaege", { als: bernd }))).daten).toMatchObject([{ id: v!.id, bereiche: ["kalender"] }]);
    expect((await t.request(`/kontaktvorschlaege/${v!.id}/verwerfen`, { method: "POST", als: vera })).status).toBe(204);
    a.mails.push(mail({ von: VERA, an: ["gast@neu.example.com"], datum: new Date(jetzt.getTime() - 60_000) }));
    await faellig();
    await gleicheAb(db, syncOpt(a));
    expect((await json(await t.request("/kontaktvorschlaege", { als: vera }))).daten).toEqual([]);
    expect((await json(await t.request("/kontaktvorschlaege", { als: bernd }))).daten).toHaveLength(1);
    expect(JSON.stringify((await db.execute(sql`SELECT vorher, nachher FROM aenderung WHERE tabelle = 'kontakt_vorschlag'`)).rows)).not.toMatch(/gast@/);
  });

  it("Zusammenführen: Person ohne Adresse bekommt sie; Person mit Adresse bekommt einen zusammengeführten Datensatz, und spätere Mails landen bei ihr", async () => {
    await verbinde(vera, "mail", VERA);
    const P_OHNE = "00000000-0000-4000-8000-0000000001a2";
    await db.insert(s.person).values({ id: P_OHNE, vorname: "Ohne", nachname: "Adresse" });
    const a = new FakeAnbieter();
    a.mails = [mail({ von: VERA, an: ["anna.privat@neu.example.com", "ohne@neu.example.com"] })];
    await gleicheAb(db, syncOpt(a));
    const v = await vorschlaege();
    const zuAnna = v.find((x) => x.adresse === "anna.privat@neu.example.com")!;
    const zuOhne = v.find((x) => x.adresse === "ohne@neu.example.com")!;
    expect((await t.request(`/kontaktvorschlaege/${zuAnna.id}/zusammenfuehren`, { method: "POST", als: vera, headers: { "content-type": "application/json" }, body: JSON.stringify({ personId: P_ANNA }) })).status).toBe(200);
    expect((await t.request(`/kontaktvorschlaege/${zuOhne.id}/zusammenfuehren`, { method: "POST", als: vera, headers: { "content-type": "application/json" }, body: JSON.stringify({ personId: P_OHNE }) })).status).toBe(200);
    expect((await db.select().from(s.person).where(eq(s.person.id, P_OHNE)))[0]!.email).toBe("ohne@neu.example.com");
    const [anna] = await db.select().from(s.person).where(eq(s.person.id, P_ANNA));
    expect(anna!.email).toBe("anna@alpha.example.com");
    const [alias] = await db.select().from(s.person).where(eq(s.person.email, "anna.privat@neu.example.com"));
    expect(alias).toMatchObject({ zusammengefuehrtIn: P_ANNA });
    expect(await vorschlaege()).toMatchObject([
      { adresse: "anna.privat@neu.example.com", status: "zusammengefuehrt", personId: P_ANNA },
      { adresse: "ohne@neu.example.com", status: "zusammengefuehrt", personId: P_OHNE },
    ]);
    // Kein neues Unternehmen beim Zusammenführen
    expect((await organisationen()).some((o) => o.website === "https://neu.example.com")).toBe(false);
    a.mails.push(mail({ von: "anna.privat@neu.example.com", an: [VERA], betreff: "Von der zweiten Adresse", datum: new Date(jetzt.getTime() - 60_000) }));
    await faellig();
    await gleicheAb(db, syncOpt(a));
    expect((await db.select().from(s.aktivitaet).where(eq(s.aktivitaet.titel, "Von der zweiten Adresse")))[0]).toMatchObject({ personId: P_ANNA });
  });

  it("Trennen entfernt nur offene Vorschläge aus diesem Postfach; übernommene Kontakte und Vorschläge anderer Quellen bleiben", async () => {
    const id = await verbinde(vera, "mail", VERA);
    await verbinde(bernd, "mail", BERND);
    // Jedes Postfach sieht nur seine eigenen gesendeten Mails.
    const a = new FakeAnbieter();
    a.mails = [mail({ von: VERA, an: ["nur-vera@neu.example.com", "beide@neu.example.com", "uebernommen@neu.example.com"] })];
    const b = new FakeAnbieter();
    b.mails = [mail({ von: BERND, an: ["beide@neu.example.com"] })];
    await gleicheAb(db, syncOpt((zugang) => (zugang.adresse === VERA ? a : b)));
    const uebernommen = (await vorschlaege()).find((x) => x.adresse === "uebernommen@neu.example.com")!;
    expect((await t.request(`/kontaktvorschlaege/${uebernommen.id}/uebernehmen`, { method: "POST", als: vera })).status).toBe(200);
    expect((await t.request(`/postfach/${id}`, { method: "DELETE", als: vera })).status).toBe(204);
    expect((await vorschlaege()).map((x) => [x.adresse, x.status])).toEqual([
      ["beide@neu.example.com", "offen"],
      ["uebernommen@neu.example.com", "uebernommen"],
    ]);
    expect((await personen()).map((p) => p.email)).toContain("uebernommen@neu.example.com");
    expect((await json(await t.request("/kontaktvorschlaege", { als: bernd }))).daten.map((x: { adresse: string }) => x.adresse)).toEqual(["beide@neu.example.com"]);
  });

  it("Wer die Installation verlässt (gesperrt), nimmt seine offenen Vorschläge mit; angelegte Kontakte bleiben", async () => {
    await teilnehmen(geht);
    await verbinde(geht, "mail", "geht@fonds.example.org");
    const a = new FakeAnbieter();
    a.mails = [mail({ von: "geht@fonds.example.org", an: ["offen@neu.example.com", "angelegt@neu.example.com"] })];
    await gleicheAb(db, syncOpt(a));
    const angelegt = (await vorschlaege()).find((x) => x.adresse === "angelegt@neu.example.com")!;
    expect((await t.request(`/kontaktvorschlaege/${angelegt.id}/uebernehmen`, { method: "POST", als: geht })).status).toBe(200);
    const r = await t.request(`/users/${await idVon(db, geht)}`, { method: "PATCH", als: chefin, headers: { "content-type": "application/json" }, body: JSON.stringify({ active: false }) });
    expect(r.status).toBe(200);
    expect((await vorschlaege()).map((x) => [x.adresse, x.status])).toEqual([["angelegt@neu.example.com", "uebernommen"]]);
    expect((await personen()).map((p) => p.email)).toContain("angelegt@neu.example.com");
  });

  it("Trennen während des Abgleichs: keine Vorschläge und keine Kontakte mehr aus dieser Verbindung", async () => {
    const id = await verbinde(vera, "mail", VERA);
    const a = new FakeAnbieter();
    a.mails = [mail({ von: VERA, an: ["spaet@neu.example.com"] })];
    const abruf = a.holeMailKoepfe.bind(a);
    a.holeMailKoepfe = async (zugang, stand) => {
      const r = await abruf(zugang, stand);
      await t.request(`/postfach/${id}`, { method: "DELETE", als: vera }); // getrennt, während der Abgleich läuft
      return r;
    };
    await gleicheAb(db, syncOpt(a));
    expect(await vorschlaege()).toEqual([]);
    await einstellen("direkt");
    const id2 = await verbinde(vera, "mail", VERA);
    a.holeMailKoepfe = async (zugang, stand) => {
      const r = await abruf(zugang, stand);
      await t.request(`/postfach/${id2}`, { method: "DELETE", als: vera });
      return r;
    };
    await gleicheAb(db, syncOpt(a));
    expect((await personen()).map((p) => p.email)).not.toContain("spaet@neu.example.com");
  });

  it("ohne Recht, Kontakte anzulegen (nur Betrachter), nimmt das Postfach nicht teil", async () => {
    await teilnehmen(leser);
    await verbinde(leser, "mail", "leser@fonds.example.org");
    const a = new FakeAnbieter();
    a.mails = [mail({ von: "leser@fonds.example.org", an: ["kunde@neu.example.com"], gesendet: true })];
    await gleicheAb(db, syncOpt(a));
    expect(await vorschlaege()).toEqual([]);
    expect(await json(await t.request("/postfach/kontakte", { als: leser }))).toMatchObject({ teilnehmen: true, darfAnlegen: false });
    await einstellen("direkt");
    a.mails.push(mail({ von: "leser@fonds.example.org", an: ["kunde@neu.example.com"], gesendet: true, datum: new Date(jetzt.getTime() - 60_000) }));
    await faellig();
    await gleicheAb(db, syncOpt(a));
    expect((await personen()).map((p) => p.email)).not.toContain("kunde@neu.example.com");
  });

  it("Eigene Sperrliste und Teilnahme je Person über die eigenen Einstellungen; nur die Person selbst sieht sie", async () => {
    await verbinde(vera, "mail", VERA);
    const r = await t.request("/postfach/kontakte", { method: "PUT", als: vera, headers: { "content-type": "application/json" }, body: JSON.stringify({ teilnehmen: true, sperrliste: ["@Familie.example", "freundin@neu.example.com"] }) });
    expect(await json(r)).toEqual({ modus: "vorschlag", teilnehmen: true, sperrliste: ["familie.example", "freundin@neu.example.com"], darfAnlegen: true });
    expect(await json(await t.request("/postfach/kontakte", { als: bernd }))).toMatchObject({ teilnehmen: true, sperrliste: [] });
    const a = new FakeAnbieter();
    a.mails = [mail({ von: VERA, an: ["onkel@familie.example", "freundin@neu.example.com", "kunde@neu.example.com"] })];
    await gleicheAb(db, syncOpt(a));
    expect((await vorschlaege()).map((x) => x.adresse)).toEqual(["kunde@neu.example.com"]);
    expect(JSON.stringify((await db.execute(sql`SELECT vorher, nachher FROM aenderung WHERE tabelle = 'kontaktabgleich_teilnahme'`)).rows)).not.toMatch(/familie|freundin/);
    // Wer nicht mehr teilnimmt, nimmt seine offenen Vorschläge zurück.
    await t.request("/postfach/kontakte", { method: "PUT", als: vera, headers: { "content-type": "application/json" }, body: JSON.stringify({ teilnehmen: false, sperrliste: [] }) });
    expect(await vorschlaege()).toEqual([]);
  });
});

describe("Direkt anlegen, Domains und mehrere Postfächer", () => {
  beforeEach(async () => {
    await einstellen("direkt", { eigeneDomains: ["fonds.example.org"] });
    await teilnehmen(vera);
    await teilnehmen(bernd);
  });

  it("vorhandenes Unternehmen mit passender Website wird verknüpft; Freemail ergibt Person ohne Unternehmen; je Domain ein Unternehmen; Mail gleich zugeordnet", async () => {
    await verbinde(vera, "mail", VERA);
    const a = new FakeAnbieter();
    a.mails = [mail({ von: VERA, an: ["bert@alpha.example.com", "frei@gmail.com", "eins@gamma.example.com", "zwei@gamma.example.com"], betreff: "Runde" })];
    await gleicheAb(db, syncOpt(a));
    const p = await personen();
    const nach = (e: string) => p.find((x) => x.email === e)!;
    expect(nach("bert@alpha.example.com").organisationId).toBe(ID.orgA);
    expect(nach("frei@gmail.com").organisationId).toBeNull();
    expect(nach("eins@gamma.example.com").organisationId).toBe(nach("zwei@gamma.example.com").organisationId);
    expect((await organisationen()).filter((o) => o.website === "https://gamma.example.com")).toHaveLength(1);
    expect(await db.select().from(s.kontaktDomain)).toHaveLength(1); // nur gamma, alpha gab es schon
    expect(await db.select().from(s.kontaktHerkunft)).toHaveLength(5); // vier Personen, ein Unternehmen
    // Die Mail selbst ist schon in diesem Lauf zugeordnet.
    expect((await db.select().from(s.aktivitaet))[0]).toMatchObject({ titel: "Runde" });
  });

  it("zwei gleichzeitige Abgleiche mit denselben Adressen und Domains: je Adresse eine Person, je Domain ein Unternehmen", async () => {
    const v1 = await verbinde(vera, "mail", VERA);
    const v2 = await verbinde(bernd, "mail", BERND);
    const adressen = Array.from({ length: 6 }, (_, i) => `person${i}@delta${i % 2}.example.com`);
    const fuer = (zugang: Zugang) => {
      const a = new FakeAnbieter();
      const liste = zugang.adresse === VERA ? adressen : [...adressen].reverse();
      a.mails = liste.map((x, i) => mail({ von: zugang.adresse, an: [x], nachrichtenId: `<${zugang.adresse}-${i}@parallel.example>`, datum: vor(1, 8 + i) }));
      return a;
    };
    const ergebnisse = await Promise.all([gleicheVerbindungAb(db, v1, syncOpt(fuer)), gleicheVerbindungAb(db, v2, syncOpt(fuer))]);
    expect(ergebnisse.map((e) => e.fehler)).toEqual([null, null]);
    const p = (await personen()).filter((x) => x.email?.includes("@delta"));
    expect(p.map((x) => x.email).sort()).toEqual([...adressen].sort());
    expect((await organisationen()).filter((o) => o.website?.includes("delta")).map((o) => o.website).sort()).toEqual(["https://delta0.example.com", "https://delta1.example.com"]);
    expect(await db.select().from(s.kontaktDomain)).toHaveLength(2);
    expect((await vorschlaege()).every((x) => x.status === "uebernommen")).toBe(true);
    expect(await db.select().from(s.kontaktHerkunft)).toHaveLength(8);
  });

  it("verworfene Vorschläge werden auch im Modus direkt nicht angelegt", async () => {
    await einstellen("vorschlag");
    await verbinde(vera, "mail", VERA);
    const a = new FakeAnbieter();
    a.mails = [mail({ von: VERA, an: ["nein@neu.example.com"] })];
    await gleicheAb(db, syncOpt(a));
    const [v] = await vorschlaege();
    await t.request(`/kontaktvorschlaege/${v!.id}/verwerfen`, { method: "POST", als: vera });
    await einstellen("direkt");
    a.mails.push(mail({ von: VERA, an: ["nein@neu.example.com"], datum: new Date(jetzt.getTime() - 60_000) }));
    await faellig();
    await gleicheAb(db, syncOpt(a));
    expect((await personen()).map((p) => p.email)).not.toContain("nein@neu.example.com");
  });
});

describe("Einstellung der Installation", () => {
  it("nur globale Verwalter lesen und ändern sie; Domains und Sperrliste werden normalisiert, die Sperrliste steht nur als Anzahl im Protokoll", { retry: { count: 1, condition: /"code":"query_too_long"/ } }, async () => {
    expect((await t.request("/kontaktvorschlaege/einstellung", { als: vera })).status).toBe(403);
    const standard = await t.request("/kontaktvorschlaege/einstellung", { als: chefin });
    expect(standard.status, await standard.clone().text()).toBe(200);
    expect(await json(standard)).toEqual({ modus: "aus", eigeneDomains: [], sperrliste: [] });
    const r = await t.request("/kontaktvorschlaege/einstellung", {
      method: "PUT",
      als: chefin,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modus: "vorschlag", eigeneDomains: ["Fonds.Example.org", "x@nicht-domain.example"], sperrliste: ["Privat@Example.net", "@familie.example"] }),
    });
    expect(r.status, await r.clone().text()).toBe(200);
    expect(await json(r)).toEqual({ modus: "vorschlag", eigeneDomains: ["fonds.example.org"], sperrliste: ["familie.example", "privat@example.net"] });
    expect((await t.request("/kontaktvorschlaege/einstellung", { method: "PUT", als: vera, headers: { "content-type": "application/json" }, body: JSON.stringify({ modus: "direkt", eigeneDomains: [], sperrliste: [] }) })).status).toBe(403);
    expect(JSON.stringify((await db.execute(sql`SELECT nachher FROM aenderung WHERE tabelle = 'kontaktabgleich_einstellung'`)).rows)).not.toMatch(/privat@|familie/);
    expect(await json(await t.request("/postfach/kontakte", { als: vera }))).toMatchObject({ modus: "vorschlag", teilnehmen: false });
  });
});
