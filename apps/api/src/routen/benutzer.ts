import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { Hono } from "hono";
import { z } from "zod";
import { apiSchluessel, benutzer, fondsrolle, investorBenutzer, konto, nutzergruppeMitglied, sitzung, wirksameFondsrolle, type Db } from "@carraway/db";
import { entferneEinrichtungsToken, gueltigesEinrichtungsToken, sperreEinrichtung } from "../anmeldung/einrichtung";
import { fehlversuche, merkeFehlversuch } from "../anmeldung/begrenzung";
import { clientIp } from "../anmeldung/schutz";
import type { Konfiguration } from "../konfiguration";
import { aktuellerAkteur, sichtbareFonds, type SchluesselScope } from "../anmeldung/akteur";
import { MINDESTLAENGE_PASSWORT, type Auth } from "../anmeldung/auth";
import { einladungOffen, stelleEinladungAus } from "../anmeldung/zuruecksetzen";
import { verlangeMail } from "../mail/auftraege";
import { Fachfehler } from "../fehler";
import { pruefe } from "../pruefung";
import { idParam, ladeFonds, mindestensEins, MINDESTENS_EIN_FELD, nurGesetzte, schreibe, textEingabe } from "../schreiben";
import { bereichAnApi, stufeAnApi, stufeAnApiOderNull, stufeEingabe } from "../rechte/api-namen";
import { bereicheJeFondsAuszug, ladeRechte } from "../rechte/aufloesung";
import { entferneOffeneVorschlaege } from "../postfach/kontakte";
import { lese, type Tx } from "../zeitlimit";

const neuerBenutzer = z.object({
  name: textEingabe(200),
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  /** Startpasswort. Ohne Angabe (nur bei eingerichtetem Mailversand) bekommt die Person eine Einladung mit Link zum Festlegen des Passworts. */
  password: z.string().min(MINDESTLAENGE_PASSWORT).max(128).optional(),
  globalAdmin: z.boolean().default(false),
  /** Sprache der Einladung; Standard Deutsch. */
  language: z.enum(["de", "en"]).default("de"),
});
const einrichtung = neuerBenutzer.omit({ globalAdmin: true, language: true }).extend({ token: z.string().min(1).max(1024), password: z.string().min(MINDESTLAENGE_PASSWORT).max(128) });
const einladungEingabe = z.object({ language: z.enum(["de", "en"]).default("de") });

const aenderungBenutzer = z
  .object({ name: textEingabe(200).optional(), active: z.boolean().optional(), globalAdmin: z.boolean().optional() })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);

/** `?ids=a,b,c`: 1 bis 100 verschiedene IDs. */
const namenAbfrage = z.object({
  ids: z
    .string()
    .max(100 * 37)
    .transform((t) => t.split(",").map((i) => i.trim()))
    .pipe(z.array(z.uuid()).min(1).max(100)),
});

/** Investor-Benutzer (LP-Portal) bekommen nie Fondsrollen und werden nicht über die interne Verwaltung geändert. Die Datenbank erzwingt dasselbe per Trigger. */
export async function verlangeKeinenInvestor(tx: Tx, benutzerId: string) {
  const [zeile] = await tx.select({ id: investorBenutzer.benutzerId }).from(investorBenutzer).where(eq(investorBenutzer.benutzerId, benutzerId));
  if (zeile) throw new Fachfehler(409, "investor_user", "Investor users of the LP portal do not receive fund roles and are managed under 'Investors'.");
}

const rolleEingabe = z.object({ role: stufeEingabe });

/**
 * Einrichtung einer leeren Installation mit Einrichtungs-Token. Tokenverbrauch und Anlage des ersten Verwalters
 * erfolgen in derselben Transaktion. Danach meldet die Route 403 `registration_closed`.
 */
export function einrichtungRouten(db: Db, konfig: Konfiguration) {
  return new Hono().post("/", pruefe("json", einrichtung), async (c) => {
    const eingabe = c.req.valid("json");
    const adresse = createHash("sha256").update(eingabe.email).digest("hex");
    const zaehler = [`setup:ip:${clientIp(c, konfig)}`, `setup:email:${adresse}`];
    const { versuche, fensterMs } = konfig.anmeldeLimit;
    const neu = await schreibe(db, "system", async (tx, protokoll) => {
      if (!await sperreEinrichtung(tx)) throw new Fachfehler(403, "registration_closed", "The installation is already set up.");
      for (const schluessel of zaehler) {
        if (await fehlversuche(tx, schluessel, fensterMs) >= versuche) {
          c.header("Retry-After", String(Math.ceil(fensterMs / 1000)));
          throw new Fachfehler(429, "too_many_attempts", "Too many failed attempts. Please try again later.");
        }
      }
      if (!await gueltigesEinrichtungsToken(tx, eingabe.token)) {
        await merkeFehlversuch(tx, zaehler, fensterMs);
        return null; // Den Fehlversuch festschreiben, bevor die Route den Fehler zurückgibt.
      }
      const hash = await hashPassword(eingabe.password);
      await entferneEinrichtungsToken(tx);
      const [zeile] = await tx.insert(benutzer).values({ name: eingabe.name, email: eingabe.email, emailVerified: true, globalVerwalter: true }).returning();
      if (!zeile) throw new Error("Benutzer nicht angelegt");
      await tx.insert(konto).values({ accountId: zeile.id, providerId: "credential", userId: zeile.id, password: hash });
      await protokoll("anlegen", "benutzer", zeile.id, null, { id: zeile.id, name: zeile.name, email: zeile.email, globalVerwalter: true, einrichtung: true });
      return zeile;
    });
    if (!neu) throw new Fachfehler(403, "setup_token_invalid", "The setup token is invalid.");
    return c.json({ id: neu.id, name: neu.name, email: neu.email, globalAdmin: true }, 201);
  });
}

/** Benutzerverwaltung (globale Verwalter): Liste, Anlage mit Startpasswort oder Einladung, Sperren und Verwalter-Kennzeichen. */
export function benutzerRouten(db: Db, auth: Auth) {
  return new Hono()
    /**
     * Anzeigenamen zu Benutzer-IDs (für Protokoll, Beschlüsse, Freigaben). Für jede angemeldete Person mit einer Rolle:
     * sichtbar sind die eigene Person und Personen, die mindestens einen Fonds mit ihr teilen (globale Verwalter sehen alle,
     * und globale Verwalter teilen jeden Fonds). Technische Benutzer erscheinen mit dem Namen ihres Schlüssels; sie teilen
     * einen Fonds, wenn ein Scope des Schlüssels ihn nennt. Unbekannte oder nicht sichtbare IDs fehlen in der Antwort.
     */
    .get("/names", pruefe("query", namenAbfrage), async (c) => {
      const { ids } = c.req.valid("query");
      const akteur = aktuellerAkteur(c);
      const meine = sichtbareFonds(akteur);
      const daten = await lese(db, async (tx) => {
        const personen = await tx.select().from(benutzer).where(inArray(benutzer.id, ids));
        if (personen.length === 0) return [];
        const rollen = await tx.select().from(wirksameFondsrolle).where(inArray(wirksameFondsrolle.benutzerId, ids));
        const schluessel = await tx.select().from(apiSchluessel).where(inArray(apiSchluessel.benutzerId, ids));
        const teilt = (fondsIds: string[]) => meine === "alle" || fondsIds.some((f) => meine.includes(f));
        return personen
          .filter((p) => {
            if (meine === "alle" || p.id === akteur.id) return true;
            if (p.globalVerwalter) return meine.length > 0;
            if (p.technisch) return teilt(schluessel.filter((s) => s.benutzerId === p.id).flatMap((s) => (s.scopes as SchluesselScope[]).map((x) => x.fondsId)));
            return teilt(rollen.filter((r) => r.benutzerId === p.id).map((r) => r.fondsId));
          })
          .map((p) => ({
            id: p.id,
            name: p.technisch ? (schluessel.filter((s) => s.benutzerId === p.id).sort((a, b) => b.erstelltAm.getTime() - a.erstelltAm.getTime())[0]?.name ?? p.name) : p.name,
          }));
      });
      return c.json({ data: daten }, 200);
    })
    .get("/", async (c) => {
      const daten = await lese(db, async (tx) => {
        // Investor-Benutzer des LP-Portals gehören nicht in die interne Verwaltung (sie haben nie Fondsrollen); sie stehen unter `/investoren`.
        const investoren = new Set((await tx.select({ id: investorBenutzer.benutzerId }).from(investorBenutzer)).map((i) => i.id));
        const personen = (await tx.select().from(benutzer).orderBy(asc(benutzer.name), asc(benutzer.id))).filter((p) => !investoren.has(p.id));
        const rollen = await tx.select().from(fondsrolle);
        const mitgliedschaften = await tx.select().from(nutzergruppeMitglied);
        const mitKonto = new Set((await tx.select({ id: konto.userId }).from(konto)).map((k) => k.id));
        return personen.map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          active: p.aktiv,
          technicalUser: p.technisch,
          globalAdmin: p.globalVerwalter,
          twoFactorEnabled: p.twoFactorEnabled,
          passwordChangeRequired: p.passwortAendern,
          /** `true`: eingeladen, hat das Passwort noch nicht festgelegt. */
          invitationPending: !p.technisch && !mitKonto.has(p.id),
          /** Eigene Fondsrollen (Ausnahmen je Fonds, gelten vor den Gruppen). */
          roles: rollen.filter((r) => r.benutzerId === p.id).map((r) => ({ fundId: r.fondsId, role: stufeAnApi(r.rolle) })),
          /** Nutzergruppen der Person (Kennungen). */
          groupIds: mitgliedschaften.filter((m) => m.benutzerId === p.id).map((m) => m.gruppeId),
        }));
      });
      return c.json({ data: daten }, 200);
    })
    /**
     * Legt eine Person an. Mit Startpasswort richtet sie bei der ersten Anmeldung den zweiten Faktor ein. Ohne Passwort bekommt sie eine Mail mit einem
     * Link (72 Stunden, einmalig) zum Festlegen des Passworts, danach folgt dieselbe Einrichtung; das geht nur bei eingerichtetem Mailversand.
     */
    .post("/", pruefe("json", neuerBenutzer), async (c) => {
      const eingabe = c.req.valid("json");
      const einladung = eingabe.password === undefined;
      const mail = c.get("mail");
      if (einladung) verlangeMail(mail);
      const hash = eingabe.password === undefined ? null : await hashPassword(eingabe.password);
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [vorhanden] = await tx.select({ id: benutzer.id }).from(benutzer).where(eq(benutzer.email, eingabe.email));
        if (vorhanden) throw new Fachfehler(409, "user_exists", "A user with this address already exists.");
        const [zeile] = await tx
          .insert(benutzer)
          .values({ name: eingabe.name, email: eingabe.email, emailVerified: true, globalVerwalter: eingabe.globalAdmin, passwortAendern: !einladung })
          .returning();
        if (!zeile) throw new Error("Benutzer nicht angelegt");
        if (hash) await tx.insert(konto).values({ accountId: zeile.id, providerId: "credential", userId: zeile.id, password: hash });
        await protokoll("anlegen", "benutzer", zeile.id, null, { id: zeile.id, name: zeile.name, email: zeile.email, globalVerwalter: zeile.globalVerwalter, einladung });
        if (einladung) await stelleEinladungAus(tx, db, auth, protokoll, mail!, { benutzerId: zeile.id, name: zeile.name, email: zeile.email, sprache: eingabe.language });
        return zeile;
      });
      return c.json({ id: neu.id, name: neu.name, email: neu.email, active: neu.aktiv, globalAdmin: neu.globalVerwalter, invited: einladung }, 201);
    })
    /**
     * Wirksame Rechte einer Person zur Kontrolle in der Verwaltung: Stufe je Fonds (mit Herkunft: eigene Fondsrolle oder Gruppe) und Bereiche
     * (`null` = alle, weil die Person keiner Gruppe angehört oder globale Verwalterin ist).
     */
    .get("/:id/permissions", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        const [person] = await tx.select().from(benutzer).where(eq(benutzer.id, id));
        if (!person) return null;
        const rechte = await ladeRechte(tx, id);
        const eigene = new Set((await tx.select({ f: fondsrolle.fondsId }).from(fondsrolle).where(eq(fondsrolle.benutzerId, id))).map((r) => r.f));
        return {
          id: person.id,
          globalAdmin: person.globalVerwalter,
          areas: person.globalVerwalter || rechte.bereiche === null ? null : [...rechte.bereiche].map(bereichAnApi).sort(),
          levelWithoutFund: stufeAnApiOderNull(rechte.stufeOhneFonds),
          ...bereicheJeFondsAuszug({ globalVerwalter: person.globalVerwalter, ...rechte }),
          roles: [...rechte.rollen].map(([fondsId, rolle]) => ({ fundId: fondsId, role: stufeAnApi(rolle), source: eigene.has(fondsId) ? ("own" as const) : ("group" as const) })),
        };
      });
      if (!daten) throw new Fachfehler(404, "user_not_found", "User not found.");
      return c.json(daten, 200);
    })
    /** Sendet die Einladung erneut (neuer Link, der frühere verfällt); nur solange die Person noch kein Passwort festgelegt hat. */
    .post("/:id/invitation", pruefe("param", idParam), pruefe("json", einladungEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const { language: sprache } = c.req.valid("json");
      const mail = c.get("mail");
      verlangeMail(mail);
      await schreibe(db, c, async (tx, protokoll) => {
        const [person] = await tx.select().from(benutzer).where(eq(benutzer.id, id)).for("update");
        if (!person) throw new Fachfehler(404, "user_not_found", "User not found.");
        await verlangeKeinenInvestor(tx, id);
        if (person.technisch || !person.aktiv || !(await einladungOffen(tx, id))) {
          throw new Fachfehler(409, "invitation_not_possible", "An invitation is only possible for active persons who have not set a password yet.");
        }
        await stelleEinladungAus(tx, db, auth, protokoll, mail, { benutzerId: id, name: person.name, email: person.email, sprache });
      });
      return c.body(null, 204);
    })
    .patch("/:id", pruefe("param", idParam), pruefe("json", aenderungBenutzer), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      const aenderungen = nurGesetzte({ name: eingabe.name, aktiv: eingabe.active, globalVerwalter: eingabe.globalAdmin });
      const selbst = aktuellerAkteur(c).id === id;
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        // Alle aktiven globalen Verwalter in fester Reihenfolge sperren, bevor die Person selbst gesperrt wird:
        // zwei gleichzeitige Änderungen können sich so weder verklemmen noch gemeinsam den letzten Verwalter entfernen.
        const { rows: verwalter } = await tx.execute<{ id: string }>(
          sql`SELECT id FROM benutzer WHERE global_verwalter AND aktiv AND NOT technisch ORDER BY id FOR UPDATE`,
        );
        const [vorher] = await tx.select().from(benutzer).where(eq(benutzer.id, id)).for("update");
        if (!vorher) throw new Fachfehler(404, "user_not_found", "User not found.");
        await verlangeKeinenInvestor(tx, id);
        const verliertVerwaltung = (aenderungen.globalVerwalter === false || aenderungen.aktiv === false) && vorher.globalVerwalter && vorher.aktiv && !vorher.technisch;
        if (verliertVerwaltung && verwalter.filter((v) => v.id !== id).length === 0) {
          throw new Fachfehler(409, "last_admin", "The installation needs at least one active global admin.");
        }
        if (selbst && (aenderungen.aktiv === false || aenderungen.globalVerwalter === false)) {
          throw new Fachfehler(403, "forbidden", "You cannot lock yourself or remove your own admin rights.");
        }
        if (vorher.technisch && aenderungen.globalVerwalter) {
          throw new Fachfehler(403, "technical_user", "A technical user cannot be an admin.");
        }
        const [neu] = await tx.update(benutzer).set({ ...aenderungen, updatedAt: new Date() }).where(eq(benutzer.id, id)).returning();
        // Wer gesperrt wird, verliert sofort alle Sitzungen.
        if (aenderungen.aktiv === false) await tx.delete(sitzung).where(eq(sitzung.userId, id));
        // Wer die Installation verlässt, nimmt seine offenen Kontaktvorschläge aus Postfach und Kalender mit; angelegte Kontakte bleiben.
        if (aenderungen.aktiv === false) await entferneOffeneVorschlaege(tx, id);
        const auszug = (b: typeof vorher) => ({ name: b.name, aktiv: b.aktiv, globalVerwalter: b.globalVerwalter });
        await protokoll("aendern", "benutzer", id, auszug(vorher), auszug(neu!));
        return neu!;
      });
      return c.json({ id: nachher.id, name: nachher.name, email: nachher.email, active: nachher.aktiv, globalAdmin: nachher.globalVerwalter }, 200);
    });
}

const fondsUndBenutzer = z.object({ id: z.uuid(), userId: z.uuid() });

/** Rollen am Fonds (Verwalter des Fonds): auflisten, setzen, entziehen. */
export function rollenRouten(db: Db) {
  return new Hono()
    .get("/", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        return tx
          .select({ userId: benutzer.id, name: benutzer.name, email: benutzer.email, active: benutzer.aktiv, role: fondsrolle.rolle })
          .from(fondsrolle)
          .innerJoin(benutzer, eq(benutzer.id, fondsrolle.benutzerId))
          .where(eq(fondsrolle.fondsId, id))
          .orderBy(asc(benutzer.name), asc(benutzer.id));
      });
      return c.json({ data: daten.map((d) => ({ ...d, role: stufeAnApi(d.role) })) }, 200);
    })
    .put("/:userId", pruefe("param", fondsUndBenutzer), pruefe("json", rolleEingabe), async (c) => {
      const { id, userId: benutzerId } = c.req.valid("param");
      const { role: rolle } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        const [person] = await tx.select().from(benutzer).where(eq(benutzer.id, benutzerId)).for("update");
        if (!person) throw new Fachfehler(404, "user_not_found", "User not found.");
        await verlangeKeinenInvestor(tx, benutzerId);
        if (person.technisch) throw new Fachfehler(403, "technical_user", "Technical users receive their rights through the API key.");
        const [bisher] = await tx.select().from(fondsrolle).where(and(eq(fondsrolle.benutzerId, benutzerId), eq(fondsrolle.fondsId, id)));
        await tx
          .insert(fondsrolle)
          .values({ benutzerId, fondsId: id, rolle })
          .onConflictDoUpdate({ target: [fondsrolle.benutzerId, fondsrolle.fondsId], set: { rolle } });
        await protokoll("rolle_setzen", "fondsrolle", benutzerId, bisher ? { fondsId: id, rolle: bisher.rolle } : null, { fondsId: id, rolle });
        return { userId: benutzerId, fundId: id, role: stufeAnApi(rolle) };
      });
      return c.json(ergebnis, 200);
    })
    .delete("/:userId", pruefe("param", fondsUndBenutzer), async (c) => {
      const { id, userId: benutzerId } = c.req.valid("param");
      await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        const [bisher] = await tx.delete(fondsrolle).where(and(eq(fondsrolle.benutzerId, benutzerId), eq(fondsrolle.fondsId, id))).returning();
        if (!bisher) throw new Fachfehler(404, "user_not_found", "The user has no role in this fund.");
        await protokoll("rolle_entziehen", "fondsrolle", benutzerId, { fondsId: id, rolle: bisher.rolle }, null);
      });
      return c.body(null, 204);
    });
}
