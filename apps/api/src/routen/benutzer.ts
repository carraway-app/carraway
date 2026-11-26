import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { Hono } from "hono";
import { z } from "zod";
import { apiSchluessel, benutzer, fondsRolle, fondsrolle, investorBenutzer, konto, nutzergruppeMitglied, sitzung, wirksameFondsrolle, type Db } from "@carraway/db";
import { aktuellerAkteur, sichtbareFonds, type SchluesselScope } from "../anmeldung/akteur";
import { MINDESTLAENGE_PASSWORT, type Auth } from "../anmeldung/auth";
import { einladungOffen, stelleEinladungAus } from "../anmeldung/zuruecksetzen";
import { verlangeMail } from "../mail/auftraege";
import { Fachfehler } from "../fehler";
import { pruefe } from "../pruefung";
import { idParam, ladeFonds, mindestensEins, MINDESTENS_EIN_FELD, schreibe, textEingabe } from "../schreiben";
import { bereicheJeFondsAuszug, ladeRechte } from "../rechte/aufloesung";
import { lese, type Tx } from "../zeitlimit";

const neuerBenutzer = z.object({
  name: textEingabe(200),
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  /** Startpasswort. Ohne Angabe (nur bei eingerichtetem Mailversand) bekommt die Person eine Einladung mit Link zum Festlegen des Passworts. */
  passwort: z.string().min(MINDESTLAENGE_PASSWORT).max(128).optional(),
  globalVerwalter: z.boolean().default(false),
  /** Sprache der Einladung; Standard Deutsch. */
  sprache: z.enum(["de", "en"]).default("de"),
});
const einrichtung = neuerBenutzer.omit({ globalVerwalter: true, sprache: true }).extend({ passwort: z.string().min(MINDESTLAENGE_PASSWORT).max(128) });
const einladungEingabe = z.object({ sprache: z.enum(["de", "en"]).default("de") });

const aenderungBenutzer = z
  .object({ name: textEingabe(200).optional(), aktiv: z.boolean().optional(), globalVerwalter: z.boolean().optional() })
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
  if (zeile) throw new Fachfehler(409, "INVESTOR_BENUTZER", "Investor-Benutzer des LP-Portals erhalten keine Fondsrollen und werden unter „Investoren“ verwaltet.");
}

const rolleEingabe = z.object({ rolle: z.enum(fondsRolle.enumValues) });

/**
 * Einrichtung einer leeren Installation: legt die erste Person als globale Verwalterin an (ohne Anmeldung, nur solange
 * es noch keine Person gibt; danach 403 `REGISTRIERUNG_GESCHLOSSEN`). Die Registrierung in Better Auth bleibt geschlossen.
 */
export function einrichtungRouten(db: Db) {
  return new Hono().post("/", pruefe("json", einrichtung), async (c) => {
    const eingabe = c.req.valid("json");
    const hash = await hashPassword(eingabe.passwort);
    const neu = await schreibe(db, "system", async (tx, protokoll) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(80001)`);
      const { rows } = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM benutzer WHERE NOT technisch`);
      if ((rows[0]?.n ?? 0) > 0) throw new Fachfehler(403, "REGISTRIERUNG_GESCHLOSSEN", "Die Installation ist bereits eingerichtet; neue Benutzer legen die Verwalter an.");
      const [zeile] = await tx.insert(benutzer).values({ name: eingabe.name, email: eingabe.email, emailVerified: true, globalVerwalter: true }).returning();
      if (!zeile) throw new Error("Benutzer nicht angelegt");
      await tx.insert(konto).values({ accountId: zeile.id, providerId: "credential", userId: zeile.id, password: hash });
      await protokoll("anlegen", "benutzer", zeile.id, null, { id: zeile.id, name: zeile.name, email: zeile.email, globalVerwalter: true, einrichtung: true });
      return zeile;
    });
    return c.json({ id: neu.id, name: neu.name, email: neu.email, globalVerwalter: true }, 201);
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
    .get("/namen", pruefe("query", namenAbfrage), async (c) => {
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
      return c.json({ daten }, 200);
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
          aktiv: p.aktiv,
          technisch: p.technisch,
          globalVerwalter: p.globalVerwalter,
          zweiFaktorAktiv: p.twoFactorEnabled,
          passwortAendern: p.passwortAendern,
          /** `true`: eingeladen, hat das Passwort noch nicht festgelegt. */
          einladungOffen: !p.technisch && !mitKonto.has(p.id),
          /** Eigene Fondsrollen (Ausnahmen je Fonds, gelten vor den Gruppen). */
          rollen: rollen.filter((r) => r.benutzerId === p.id).map((r) => ({ fondsId: r.fondsId, rolle: r.rolle })),
          /** Nutzergruppen der Person (Kennungen). */
          gruppen: mitgliedschaften.filter((m) => m.benutzerId === p.id).map((m) => m.gruppeId),
        }));
      });
      return c.json({ daten }, 200);
    })
    /**
     * Legt eine Person an. Mit Startpasswort richtet sie bei der ersten Anmeldung den zweiten Faktor ein. Ohne Passwort bekommt sie eine Mail mit einem
     * Link (72 Stunden, einmalig) zum Festlegen des Passworts, danach folgt dieselbe Einrichtung; das geht nur bei eingerichtetem Mailversand.
     */
    .post("/", pruefe("json", neuerBenutzer), async (c) => {
      const eingabe = c.req.valid("json");
      const einladung = eingabe.passwort === undefined;
      const mail = c.get("mail");
      if (einladung) verlangeMail(mail);
      const hash = eingabe.passwort === undefined ? null : await hashPassword(eingabe.passwort);
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [vorhanden] = await tx.select({ id: benutzer.id }).from(benutzer).where(eq(benutzer.email, eingabe.email));
        if (vorhanden) throw new Fachfehler(409, "BENUTZER_VORHANDEN", "Zu dieser Adresse gibt es schon einen Benutzer.");
        const [zeile] = await tx
          .insert(benutzer)
          .values({ name: eingabe.name, email: eingabe.email, emailVerified: true, globalVerwalter: eingabe.globalVerwalter, passwortAendern: !einladung })
          .returning();
        if (!zeile) throw new Error("Benutzer nicht angelegt");
        if (hash) await tx.insert(konto).values({ accountId: zeile.id, providerId: "credential", userId: zeile.id, password: hash });
        await protokoll("anlegen", "benutzer", zeile.id, null, { id: zeile.id, name: zeile.name, email: zeile.email, globalVerwalter: zeile.globalVerwalter, einladung });
        if (einladung) await stelleEinladungAus(tx, db, auth, protokoll, mail!, { benutzerId: zeile.id, name: zeile.name, email: zeile.email, sprache: eingabe.sprache });
        return zeile;
      });
      return c.json({ id: neu.id, name: neu.name, email: neu.email, aktiv: neu.aktiv, globalVerwalter: neu.globalVerwalter, einladung }, 201);
    })
    /**
     * Wirksame Rechte einer Person zur Kontrolle in der Verwaltung: Stufe je Fonds (mit Herkunft: eigene Fondsrolle oder Gruppe) und Bereiche
     * (`null` = alle, weil die Person keiner Gruppe angehört oder globale Verwalterin ist).
     */
    .get("/:id/rechte", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        const [person] = await tx.select().from(benutzer).where(eq(benutzer.id, id));
        if (!person) return null;
        const rechte = await ladeRechte(tx, id);
        const eigene = new Set((await tx.select({ f: fondsrolle.fondsId }).from(fondsrolle).where(eq(fondsrolle.benutzerId, id))).map((r) => r.f));
        return {
          id: person.id,
          globalVerwalter: person.globalVerwalter,
          bereiche: person.globalVerwalter || rechte.bereiche === null ? null : [...rechte.bereiche].sort(),
          stufeOhneFonds: rechte.stufeOhneFonds,
          ...bereicheJeFondsAuszug({ globalVerwalter: person.globalVerwalter, ...rechte }),
          rollen: [...rechte.rollen].map(([fondsId, rolle]) => ({ fondsId, rolle, quelle: eigene.has(fondsId) ? ("eigene" as const) : ("gruppe" as const) })),
        };
      });
      if (!daten) throw new Fachfehler(404, "BENUTZER_NICHT_GEFUNDEN", "Benutzer nicht gefunden.");
      return c.json(daten, 200);
    })
    /** Sendet die Einladung erneut (neuer Link, der frühere verfällt); nur solange die Person noch kein Passwort festgelegt hat. */
    .post("/:id/einladung", pruefe("param", idParam), pruefe("json", einladungEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const { sprache } = c.req.valid("json");
      const mail = c.get("mail");
      verlangeMail(mail);
      await schreibe(db, c, async (tx, protokoll) => {
        const [person] = await tx.select().from(benutzer).where(eq(benutzer.id, id)).for("update");
        if (!person) throw new Fachfehler(404, "BENUTZER_NICHT_GEFUNDEN", "Benutzer nicht gefunden.");
        await verlangeKeinenInvestor(tx, id);
        if (person.technisch || !person.aktiv || !(await einladungOffen(tx, id))) {
          throw new Fachfehler(409, "EINLADUNG_NICHT_MOEGLICH", "Eine Einladung gibt es nur für aktive Personen, die noch kein Passwort festgelegt haben.");
        }
        await stelleEinladungAus(tx, db, auth, protokoll, mail, { benutzerId: id, name: person.name, email: person.email, sprache });
      });
      return c.body(null, 204);
    })
    .patch("/:id", pruefe("param", idParam), pruefe("json", aenderungBenutzer), async (c) => {
      const { id } = c.req.valid("param");
      const aenderungen = c.req.valid("json");
      const selbst = aktuellerAkteur(c).id === id;
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        // Alle aktiven globalen Verwalter in fester Reihenfolge sperren, bevor die Person selbst gesperrt wird:
        // zwei gleichzeitige Änderungen können sich so weder verklemmen noch gemeinsam den letzten Verwalter entfernen.
        const { rows: verwalter } = await tx.execute<{ id: string }>(
          sql`SELECT id FROM benutzer WHERE global_verwalter AND aktiv AND NOT technisch ORDER BY id FOR UPDATE`,
        );
        const [vorher] = await tx.select().from(benutzer).where(eq(benutzer.id, id)).for("update");
        if (!vorher) throw new Fachfehler(404, "BENUTZER_NICHT_GEFUNDEN", "Benutzer nicht gefunden.");
        await verlangeKeinenInvestor(tx, id);
        const verliertVerwaltung = (aenderungen.globalVerwalter === false || aenderungen.aktiv === false) && vorher.globalVerwalter && vorher.aktiv && !vorher.technisch;
        if (verliertVerwaltung && verwalter.filter((v) => v.id !== id).length === 0) {
          throw new Fachfehler(409, "LETZTER_VERWALTER", "Die Installation braucht mindestens einen aktiven globalen Verwalter.");
        }
        if (selbst && (aenderungen.aktiv === false || aenderungen.globalVerwalter === false)) {
          throw new Fachfehler(403, "KEINE_BERECHTIGUNG", "Die eigene Sperrung oder der Verlust der Verwaltung ist nicht möglich.");
        }
        if (vorher.technisch && aenderungen.globalVerwalter) {
          throw new Fachfehler(403, "TECHNISCHER_BENUTZER", "Ein technischer Benutzer kann nicht Verwalter sein.");
        }
        const [neu] = await tx.update(benutzer).set({ ...aenderungen, updatedAt: new Date() }).where(eq(benutzer.id, id)).returning();
        // Wer gesperrt wird, verliert sofort alle Sitzungen.
        if (aenderungen.aktiv === false) await tx.delete(sitzung).where(eq(sitzung.userId, id));
        const auszug = (b: typeof vorher) => ({ name: b.name, aktiv: b.aktiv, globalVerwalter: b.globalVerwalter });
        await protokoll("aendern", "benutzer", id, auszug(vorher), auszug(neu!));
        return neu!;
      });
      return c.json({ id: nachher.id, name: nachher.name, email: nachher.email, aktiv: nachher.aktiv, globalVerwalter: nachher.globalVerwalter }, 200);
    });
}

const fondsUndBenutzer = z.object({ id: z.uuid(), benutzerId: z.uuid() });

/** Rollen am Fonds (Verwalter des Fonds): auflisten, setzen, entziehen. */
export function rollenRouten(db: Db) {
  return new Hono()
    .get("/", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        return tx
          .select({ benutzerId: benutzer.id, name: benutzer.name, email: benutzer.email, aktiv: benutzer.aktiv, rolle: fondsrolle.rolle })
          .from(fondsrolle)
          .innerJoin(benutzer, eq(benutzer.id, fondsrolle.benutzerId))
          .where(eq(fondsrolle.fondsId, id))
          .orderBy(asc(benutzer.name), asc(benutzer.id));
      });
      return c.json({ daten }, 200);
    })
    .put("/:benutzerId", pruefe("param", fondsUndBenutzer), pruefe("json", rolleEingabe), async (c) => {
      const { id, benutzerId } = c.req.valid("param");
      const { rolle } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        const [person] = await tx.select().from(benutzer).where(eq(benutzer.id, benutzerId)).for("update");
        if (!person) throw new Fachfehler(404, "BENUTZER_NICHT_GEFUNDEN", "Benutzer nicht gefunden.");
        await verlangeKeinenInvestor(tx, benutzerId);
        if (person.technisch) throw new Fachfehler(403, "TECHNISCHER_BENUTZER", "Technische Benutzer erhalten ihre Rechte über den API-Schlüssel.");
        const [bisher] = await tx.select().from(fondsrolle).where(and(eq(fondsrolle.benutzerId, benutzerId), eq(fondsrolle.fondsId, id)));
        await tx
          .insert(fondsrolle)
          .values({ benutzerId, fondsId: id, rolle })
          .onConflictDoUpdate({ target: [fondsrolle.benutzerId, fondsrolle.fondsId], set: { rolle } });
        await protokoll("rolle_setzen", "fondsrolle", benutzerId, bisher ? { fondsId: id, rolle: bisher.rolle } : null, { fondsId: id, rolle });
        return { benutzerId, fondsId: id, rolle };
      });
      return c.json(ergebnis, 200);
    })
    .delete("/:benutzerId", pruefe("param", fondsUndBenutzer), async (c) => {
      const { id, benutzerId } = c.req.valid("param");
      await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        const [bisher] = await tx.delete(fondsrolle).where(and(eq(fondsrolle.benutzerId, benutzerId), eq(fondsrolle.fondsId, id))).returning();
        if (!bisher) throw new Fachfehler(404, "BENUTZER_NICHT_GEFUNDEN", "Der Benutzer hat an diesem Fonds keine Rolle.");
        await protokoll("rolle_entziehen", "fondsrolle", benutzerId, { fondsId: id, rolle: bisher.rolle }, null);
      });
      return c.body(null, 204);
    });
}
