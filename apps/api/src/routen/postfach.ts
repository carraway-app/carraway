import { kontaktJson, pruefeKontakt } from "../kontakte/http";
import { randomUUID } from "node:crypto";
import { and, asc, eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { kontaktabgleichEinstellung, kontaktabgleichTeilnahme, oauthZustand, postfachVerbindung, type Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { Fachfehler } from "../fehler";
import type { Konfiguration } from "../konfiguration";
import { ADRESSE } from "../mail/konfiguration";
import { idParam, schreibe } from "../schreiben";
import { lese } from "../zeitlimit";
import type { Abrufer } from "../postfach/http";
import type { ImapFabrik } from "../postfach/imap";
import { baueAutorisierungsUrl, pkcePaar, pruefeIdToken, sha256Hex, tauscheCode, zufall, type Anbietername, type Bereich } from "../postfach/oauth";
import { darfKontakteAnlegen, entferneOffeneVorschlaege, normalisiereListe } from "../postfach/kontakte";
import { PostfachFehler, type Zugang } from "../postfach/typen";
import { pruefeImapZiel, type Aufloeser, standardAufloeser } from "../postfach/ziel";
import { leseZugang, verifierAad, verschluesseleZugang } from "../postfach/zugang";

/**
 * Anbindung des eigenen Postfachs und Kalenders (Etappe 17). Alle Routen gelten nur für die angemeldete Person: Verbindungen anderer Personen sind auch für
 * Verwalter weder sichtbar noch änderbar (404). Tokens und Passwörter verlassen den Server nie; Antworten enthalten nur Status, Adresse und Zeiten.
 *
 * OAuth: `POST /oauth/start` erzeugt `state`, `nonce` und PKCE-Verifier (nur Hashes bzw. verschlüsselt gespeichert, einmalig, 10 Minuten gültig, an die Person
 * gebunden) und gibt die Adresse der Anbieterseite zurück. `GET /rueckruf` nimmt `code` und `state` entgegen, tauscht den Code gegen Tokens, prüft das ID-Token
 * (`aud`, Ablauf, `nonce`) und leitet zurück zur Oberfläche; Fehler stehen dort als Code in der Adresse, nie Tokens oder Anbieter-Antworten.
 */

const ZUSTAND_GUELTIG_MS = 10 * 60_000;

const oauthStart = z.object({ anbieter: z.enum(["microsoft", "google"]), bereich: z.enum(["mail", "kalender"]), zustimmung: z.literal(true) }).strict();
const imapEingabe = z
  .object({
    host: z.string().trim().min(1).max(253),
    port: z.number().int().min(1).max(65535),
    sicherheit: z.enum(["tls", "starttls", "keine"]),
    benutzer: z.string().trim().min(1).max(200),
    passwort: z.string().min(1).max(500),
    adresse: z.string().trim().max(254).regex(ADRESSE),
    ordner: z.array(z.string().trim().min(1).max(100)).min(1).max(3).default(["INBOX"]),
    inhaltSpeichern: z.boolean().default(false),
    zustimmung: z.literal(true),
  })
  .strict();
const aendernEingabe = z.object({ inhaltSpeichern: z.boolean() }).strict();
const kontakteEingabe = z.object({ teilnehmen: z.boolean(), sperrliste: z.array(z.string().trim().max(254)).max(500) }).strict();
const rueckrufAbfrage = z.object({ code: z.string().max(4000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional() });

export interface PostfachRoutenOptionen {
  konfig: Konfiguration;
  abrufer: Abrufer;
  imapFabrik: ImapFabrik;
  aufloeser?: Aufloeser;
}

export function postfachRouten(db: Db, opt: PostfachRoutenOptionen) {
  const { konfig } = opt;
  const basis = konfig.appOrigins[0]!;
  const rueckrufUrl = `${basis}/api/v1/mailbox/callback`;
  const verlangeRing = () => {
    if (!konfig.schluessel) throw new Fachfehler(409, "secret_missing", "GEHEIMNIS_SCHLUESSEL is not set; credentials cannot be stored without it.");
    return konfig.schluessel;
  };
  const zurueck = (c: { redirect: (u: string, s?: 302) => Response }, parameter: Record<string, string>) => c.redirect(`${basis}/einstellungen/postfach?${new URLSearchParams(parameter).toString()}`, 302);

  /** Speichert (ersetzt) die Verbindung der Person für den Bereich. */
  async function speichere(c: Parameters<typeof schreibe>[1], benutzerId: string, bereich: Bereich, anbieter: "microsoft" | "google" | "imap", zugang: Zugang, inhaltSpeichern: boolean) {
    const ring = verlangeRing();
    const id = randomUUID();
    await schreibe(db, c, async (tx, protokoll) => {
      const alt = await tx.delete(postfachVerbindung).where(and(eq(postfachVerbindung.benutzerId, benutzerId), eq(postfachVerbindung.bereich, bereich))).returning({ id: postfachVerbindung.id });
      await tx.insert(postfachVerbindung).values({ id, benutzerId, bereich, anbieter, zugangVerschluesselt: verschluesseleZugang(ring, id, zugang), inhaltSpeichern: bereich === "mail" ? inhaltSpeichern : false });
      await protokoll("verbinden", "postfach_verbindung", id, null, { bereich, anbieter, ersetzt: alt.length });
    });
    return id;
  }

  const ansicht = (z: typeof postfachVerbindung.$inferSelect) => {
    let adresse: string | null = null;
    try {
      if (konfig.schluessel) adresse = leseZugang(konfig.schluessel, z.id, z.zugangVerschluesselt).adresse;
    } catch {
      adresse = null;
    }
    return {
      id: z.id,
      bereich: z.bereich,
      anbieter: z.anbieter,
      adresse,
      status: z.status,
      letzterFehler: z.letzterFehler,
      letzterAbgleichAm: z.letzterAbgleichAm?.toISOString() ?? null,
      inhaltSpeichern: z.inhaltSpeichern,
      erstelltAm: z.erstelltAm.toISOString(),
    };
  };

  const eigene = async (id: string, benutzerId: string) => {
    const [z] = await lese(db, (tx) => tx.select().from(postfachVerbindung).where(and(eq(postfachVerbindung.id, id), eq(postfachVerbindung.benutzerId, benutzerId))));
    if (!z) throw new Fachfehler(404, "mailbox_not_found", "This connection does not exist.");
    return z;
  };

  /** Kontakte aus Postfach und Kalender: Modus der Installation, eigene Teilnahme und eigene Sperrliste (nur die Person selbst). */
  const kontakteAnsicht = async (akteur: { id: string; globalVerwalter: boolean }) => {
    const [e] = await lese(db, (tx) => tx.select({ modus: kontaktabgleichEinstellung.modus }).from(kontaktabgleichEinstellung));
    const [t] = await lese(db, (tx) => tx.select().from(kontaktabgleichTeilnahme).where(eq(kontaktabgleichTeilnahme.benutzerId, akteur.id)));
    // Ohne das Recht, Kontakte anzulegen, nimmt das Postfach nicht teil (der Abgleich prüft das bei jedem Lauf selbst).
    const darfAnlegen = await lese(db, (tx) => darfKontakteAnlegen(tx, akteur.id, akteur.globalVerwalter));
    return { modus: (e?.modus ?? "aus") as "aus" | "vorschlag" | "direkt", teilnehmen: t?.teilnehmen ?? false, sperrliste: t?.sperrliste ?? [], darfAnlegen };
  };

  return new Hono()
    .get("/contacts", async (c) => kontaktJson(c, await kontakteAnsicht(aktuellerAkteur(c)), 200))
    .put("/contacts", pruefeKontakt("json", kontakteEingabe), async (c) => {
      const akteur = aktuellerAkteur(c);
      const benutzerId = akteur.id;
      const e = c.req.valid("json");
      const sperrliste = normalisiereListe(e.sperrliste);
      await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(kontaktabgleichTeilnahme).where(eq(kontaktabgleichTeilnahme.benutzerId, benutzerId));
        await tx
          .insert(kontaktabgleichTeilnahme)
          .values({ benutzerId, teilnehmen: e.teilnehmen, sperrliste })
          .onConflictDoUpdate({ target: kontaktabgleichTeilnahme.benutzerId, set: { teilnehmen: e.teilnehmen, sperrliste, geaendertAm: new Date() } });
        // Wer nicht mehr teilnimmt, nimmt seine offenen Vorschläge zurück.
        if (!e.teilnehmen) await entferneOffeneVorschlaege(tx, benutzerId);
        // Im Protokoll nur Schalter und Anzahl, nie die Einträge der Sperrliste (private Kontakte).
        await protokoll(vorher ? "aendern" : "anlegen", "kontaktabgleich_teilnahme", benutzerId, vorher ? { teilnehmen: vorher.teilnehmen, sperrliste: vorher.sperrliste.length } : null, { teilnehmen: e.teilnehmen, sperrliste: sperrliste.length });
      });
      return kontaktJson(c, await kontakteAnsicht(akteur), 200);
    })
    .get("/", async (c) => {
      const { id } = aktuellerAkteur(c);
      const zeilen = await lese(db, (tx) => tx.select().from(postfachVerbindung).where(eq(postfachVerbindung.benutzerId, id)).orderBy(asc(postfachVerbindung.bereich)));
      return kontaktJson(
        c,
        {
          anbieter: { microsoft: Boolean(konfig.postfach.microsoft), google: Boolean(konfig.postfach.google), imap: konfig.postfach.imap },
          schluesselVorhanden: Boolean(konfig.schluessel),
          verbindungen: zeilen.map(ansicht),
        },
        200,
      );
    })
    .post("/oauth/start", pruefeKontakt("json", oauthStart), async (c) => {
      const { id: benutzerId } = aktuellerAkteur(c);
      const e = c.req.valid("json");
      const ring = verlangeRing();
      const anbieter = konfig.postfach[e.anbieter];
      if (!anbieter) throw new Fachfehler(409, "mailbox_provider_disabled", "This provider is not set up in this installation.");
      const state = zufall();
      const nonce = zufall();
      const pkce = pkcePaar();
      const zustandId = randomUUID();
      await schreibe(db, c, async (tx) => {
        // Abgelaufene Zustände aufräumen, dann den neuen anlegen.
        await tx.delete(oauthZustand).where(lt(oauthZustand.ablauf, new Date()));
        await tx.insert(oauthZustand).values({
          id: zustandId,
          benutzerId,
          stateHash: sha256Hex(state),
          nonceHash: sha256Hex(nonce),
          verifierVerschluesselt: ring.verschluessele(pkce.verifier, verifierAad(zustandId)),
          anbieter: e.anbieter,
          bereich: e.bereich,
          ablauf: new Date(Date.now() + ZUSTAND_GUELTIG_MS),
        });
      });
      return kontaktJson(c, { url: baueAutorisierungsUrl(anbieter, e.anbieter, e.bereich, { redirectUri: rueckrufUrl, state, nonce, challenge: pkce.challenge }) }, 200);
    })
    .get("/callback", pruefeKontakt("query", rueckrufAbfrage), async (c) => {
      const akteur = aktuellerAkteur(c);
      const { code, state, error } = c.req.valid("query");
      if (!state) return zurueck(c, { fehler: "mailbox_state_invalid" });
      // Der Zustand ist einmalig: Er wird in jedem Fall verbraucht, auch wenn danach etwas schiefgeht.
      const zustand = await schreibe(db, c, async (tx) => {
        const [z] = await tx.select().from(oauthZustand).where(eq(oauthZustand.stateHash, sha256Hex(state))).for("update");
        if (z) await tx.delete(oauthZustand).where(eq(oauthZustand.id, z.id));
        return z ?? null;
      });
      if (!zustand || zustand.ablauf.getTime() < Date.now() || zustand.benutzerId !== akteur.id) return zurueck(c, { fehler: "mailbox_state_invalid" });
      const name = zustand.anbieter as Anbietername;
      const anbieter = konfig.postfach[name === "microsoft" ? "microsoft" : "google"];
      if (!anbieter || (zustand.anbieter !== "microsoft" && zustand.anbieter !== "google")) return zurueck(c, { fehler: "mailbox_provider_disabled" });
      if (error || !code) return zurueck(c, { fehler: "mailbox_connection_failed" });
      try {
        const ring = verlangeRing();
        const verifier = ring.entschluessele(zustand.verifierVerschluesselt, verifierAad(zustand.id));
        const token = await tauscheCode(opt.abrufer, anbieter, { code, redirectUri: rueckrufUrl, verifier });
        const { adresse } = pruefeIdToken(token.idToken, { clientId: anbieter.clientId, nonceHash: zustand.nonceHash });
        // Ohne Refresh-Token hält die Verbindung nur eine Stunde; das gilt als gescheitert.
        if (!token.refreshToken) throw new PostfachFehler("REFRESH_TOKEN_FEHLT");
        await speichere(c, akteur.id, zustand.bereich, name, { art: "oauth", accessToken: token.accessToken, refreshToken: token.refreshToken, ablaufMs: token.ablaufMs, adresse }, false);
      } catch (fehler) {
        if (fehler instanceof Fachfehler) throw fehler;
        return zurueck(c, { fehler: "mailbox_connection_failed", grund: fehler instanceof PostfachFehler ? fehler.code : "UNBEKANNT" });
      }
      return zurueck(c, { ergebnis: "verbunden", bereich: zustand.bereich });
    })
    .post("/imap", pruefeKontakt("json", imapEingabe), async (c) => {
      const { id: benutzerId } = aktuellerAkteur(c);
      const e = c.req.valid("json");
      verlangeRing();
      if (!konfig.postfach.imap) throw new Fachfehler(409, "mailbox_provider_disabled", "IMAP is disabled in this installation.");
      let ziel: string;
      try {
        ziel = await pruefeImapZiel(e.host, e.port, konfig.postfach.privateZiele, opt.aufloeser ?? standardAufloeser);
      } catch (fehler) {
        if (fehler instanceof PostfachFehler && fehler.code === "ZIEL_VERBOTEN") throw new Fachfehler(400, "mailbox_target_forbidden", "This target is not allowed.");
        throw new Fachfehler(502, "mailbox_connection_failed", "The connection to the mailbox failed.");
      }
      const zugang: Zugang = { art: "imap", host: e.host, port: e.port, sicherheit: e.sicherheit, benutzer: e.benutzer, passwort: e.passwort, adresse: e.adresse.toLowerCase(), ordner: e.ordner };
      // Probeverbindung vor dem Speichern: Anmeldung und alle Ordner müssen gehen.
      try {
        // Verbunden wird mit der geprüften Adresse, nicht noch einmal mit dem Namen (DNS-Rebinding).
        const v = await opt.imapFabrik(ziel === e.host ? zugang : { ...zugang, host: ziel, servername: e.host });
        try {
          for (const o of e.ordner) await v.oeffne(o);
        } finally {
          await v.schliesse().catch(() => undefined);
        }
      } catch {
        throw new Fachfehler(502, "mailbox_connection_failed", "The connection to the mailbox failed.");
      }
      const id = await speichere(c, benutzerId, "mail", "imap", zugang, e.inhaltSpeichern);
      const [z] = await lese(db, (tx) => tx.select().from(postfachVerbindung).where(eq(postfachVerbindung.id, id)));
      return kontaktJson(c, ansicht(z!), 201);
    })
    .patch("/:id", pruefeKontakt("param", idParam), pruefeKontakt("json", aendernEingabe), async (c) => {
      const { id: benutzerId } = aktuellerAkteur(c);
      const { id } = c.req.valid("param");
      const { inhaltSpeichern } = c.req.valid("json");
      const vorher = await eigene(id, benutzerId);
      if (vorher.bereich !== "mail") throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: "inhaltSpeichern", code: "custom", meldung: "Applies to mailboxes only" }] });
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const [z] = await tx.update(postfachVerbindung).set({ inhaltSpeichern }).where(and(eq(postfachVerbindung.id, id), eq(postfachVerbindung.benutzerId, benutzerId))).returning();
        await protokoll("aendern", "postfach_verbindung", id, { inhaltSpeichern: vorher.inhaltSpeichern }, { inhaltSpeichern });
        return z!;
      });
      return kontaktJson(c, ansicht(nachher), 200);
    })
    /** Fordert einen Abgleich beim nächsten Lauf des Workers an. */
    .post("/:id/sync", pruefeKontakt("param", idParam), async (c) => {
      const { id: benutzerId } = aktuellerAkteur(c);
      const { id } = c.req.valid("param");
      await eigene(id, benutzerId);
      await schreibe(db, c, async (tx) => {
        await tx.update(postfachVerbindung).set({ naechsterAbgleichAm: new Date() }).where(and(eq(postfachVerbindung.id, id), eq(postfachVerbindung.benutzerId, benutzerId)));
      });
      return kontaktJson(c, { angefordert: true }, 202);
    })
    /** Trennt: Der verschlüsselte Zugang wird gelöscht. Bereits übernommene Aktivitäten und angelegte Kontakte bleiben; offene Kontaktvorschläge daraus entfallen. */
    .delete("/:id", pruefeKontakt("param", idParam), async (c) => {
      const { id: benutzerId } = aktuellerAkteur(c);
      const { id } = c.req.valid("param");
      const z = await eigene(id, benutzerId);
      await schreibe(db, c, async (tx, protokoll) => {
        await tx.delete(postfachVerbindung).where(and(eq(postfachVerbindung.id, id), eq(postfachVerbindung.benutzerId, benutzerId)));
        // Noch nicht bestätigte Vorschläge aus diesem Postfach oder Kalender entfallen; angelegte Kontakte bleiben.
        await entferneOffeneVorschlaege(tx, benutzerId, z.bereich);
        await protokoll("trennen", "postfach_verbindung", id, { bereich: z.bereich, anbieter: z.anbieter }, null);
      });
      return c.body(null, 204);
    });
}
