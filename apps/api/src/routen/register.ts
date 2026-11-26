import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { dokument, organisation, registerBeobachtung, registerEreignis, registerMeldung, registereintrag, type Db } from "@carraway/db";
import { aktuellerAkteur, sichtbareFonds } from "../anmeldung/akteur";
import { Fachfehler } from "../fehler";
import { pruefe } from "../pruefung";
import { erstelleRegisterAnbieter, type RegisterAnbieter } from "../register/anbieter";
import { aktuellerEintrag, ladeAbweichungen, ladeHinweise, legeEintragAn, legeEreignisAn, meldeEintrag, meldeEreignis, registerOrganisationen, uebernehme } from "../register/dienst";
import { MAX_ZEICHEN, pruefeImport, uebernehmeImport } from "../register/import";
import { ereignisWerte, neuerEintrag, REGISTERARTEN, UEBERNAHME_FELDER } from "../register/typen";
import { idParam, ladeOrganisation, schreibe, textEingabe } from "../schreiben";
import { lese } from "../zeitlimit";

const ereignisPfad = z.object({ id: z.uuid(), ereignisId: z.uuid() });

const importEingabe = z.object({
  format: z.enum(["json", "csv"]),
  inhalt: z.string().min(1).max(MAX_ZEICHEN),
  /** Nur prüfen und zählen, nichts übernehmen. */
  nurPruefen: z.boolean().default(false),
});

const abrufEingabe = z.object({ gericht: textEingabe(200), registerart: z.enum(REGISTERARTEN), nummer: textEingabe(50) }).partial();

function anbieterOderFehler(anbieter: RegisterAnbieter | null): RegisterAnbieter {
  if (!anbieter) throw new Fachfehler(409, "REGISTER_ANBIETER_FEHLT", "Es ist kein Anbieter für Registerdaten eingerichtet.");
  return anbieter;
}

/** Register am Unternehmen: aktueller Eintrag, Historie, Ereignisse, Abweichungen, Beobachtung. Unter `/organisationen`. */
export function registerOrganisationRouten(db: Db, anbieter: RegisterAnbieter | null = erstelleRegisterAnbieter()) {
  return new Hono()
    .get("/:id/register", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const fonds = sichtbareFonds(aktuellerAkteur(c));
      return c.json(
        await lese(db, async (tx) => {
          await ladeOrganisation(tx, id);
          const orgIds = await registerOrganisationen(tx, id);
          const eintraege = await tx.select().from(registereintrag).where(inArray(registereintrag.organisationId, orgIds)).orderBy(desc(registereintrag.standDatum), desc(registereintrag.erfasstAm), desc(registereintrag.id));
          const aktuell = eintraege[0] ?? null;
          const ereignisse = await tx.select().from(registerEreignis).where(inArray(registerEreignis.organisationId, orgIds)).orderBy(desc(registerEreignis.datum), desc(registerEreignis.erfasstAm));
          const [b] = await tx.select().from(registerBeobachtung).where(eq(registerBeobachtung.organisationId, id));
          let auszug: { id: string; dateiname: string } | null = null;
          if (aktuell?.dokumentId) {
            const [d] = await tx.select({ id: dokument.id, dateiname: dokument.dateiname }).from(dokument).where(eq(dokument.id, aktuell.dokumentId));
            auszug = d ?? null;
          }
          return {
            aktuell,
            historie: eintraege.slice(1),
            ereignisse,
            abweichungen: await ladeAbweichungen(tx, id, aktuell ?? undefined),
            hinweise: await ladeHinweise(tx, { organisationId: id, fondsIds: fonds }),
            beobachtung: { aktiv: b?.aktiv ?? false, letztePruefungAm: b?.letztePruefungAm ?? null, letztesErgebnis: b?.letztesErgebnis ?? null },
            auszug,
            anbieterEingerichtet: anbieter !== null,
          };
        }),
        200,
      );
    })
    .post("/:id/register/eintraege", pruefe("param", idParam), pruefe("json", neuerEintrag), async (c) => {
      const { id } = c.req.valid("param");
      const { dokumentId, ...werte } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        await ladeOrganisation(tx, id);
        return legeEintragAn(tx, protokoll, id, werte, dokumentId ? "dokument" : "manuell", dokumentId ?? null);
      });
      return c.json(ergebnis, ergebnis.neu ? 201 : 200);
    })
    .post("/:id/register/ereignisse", pruefe("param", idParam), pruefe("json", ereignisWerte), async (c) => {
      const { id } = c.req.valid("param");
      const werte = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        await ladeOrganisation(tx, id);
        const aktuell = await aktuellerEintrag(tx, id);
        return legeEreignisAn(tx, protokoll, id, werte, "manuell", aktuell?.id ?? null);
      });
      return c.json(ergebnis.ereignis, 201);
    })
    .post("/:id/register/ereignisse/:ereignisId/erledigen", pruefe("param", ereignisPfad), async (c) => {
      const { id, ereignisId } = c.req.valid("param");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const [e] = await tx.select().from(registerEreignis).where(and(eq(registerEreignis.id, ereignisId), eq(registerEreignis.organisationId, id))).for("update");
        if (!e) throw new Fachfehler(404, "REGISTER_EREIGNIS_NICHT_GEFUNDEN", "Registerereignis nicht gefunden.");
        if (e.erledigtAm) throw new Fachfehler(409, "REGISTER_EREIGNIS_ERLEDIGT", "Das Ereignis ist bereits erledigt.");
        const [nachher] = await tx.update(registerEreignis).set({ erledigtAm: new Date(), erledigtVon: protokoll.akteur }).where(eq(registerEreignis.id, ereignisId)).returning();
        await protokoll("erledigen", "register_ereignis", ereignisId, e, nachher);
        return nachher!;
      });
      return c.json(ergebnis, 200);
    })
    .post("/:id/register/uebernehmen", pruefe("param", idParam), pruefe("json", z.object({ felder: z.array(z.enum(UEBERNAHME_FELDER)).min(1).max(UEBERNAHME_FELDER.length) })), async (c) => {
      const { id } = c.req.valid("param");
      const { felder } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, (tx, protokoll) => uebernehme(tx, protokoll, id, [...new Set(felder)]));
      return c.json(ergebnis, 200);
    })
    .put("/:id/register/beobachtung", pruefe("param", idParam), pruefe("json", z.object({ aktiv: z.boolean() })), async (c) => {
      const { id } = c.req.valid("param");
      const { aktiv } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        await ladeOrganisation(tx, id);
        const [vorher] = await tx.select().from(registerBeobachtung).where(eq(registerBeobachtung.organisationId, id));
        const [nachher] = await tx
          .insert(registerBeobachtung)
          .values({ organisationId: id, aktiv, geaendertVon: protokoll.akteur })
          .onConflictDoUpdate({ target: registerBeobachtung.organisationId, set: { aktiv, geaendertAm: new Date(), geaendertVon: protokoll.akteur } })
          .returning();
        await protokoll("beobachtung", "organisation", id, vorher ?? null, nachher);
        return nachher!;
      });
      return c.json({ aktiv: ergebnis.aktiv, letztePruefungAm: ergebnis.letztePruefungAm, letztesErgebnis: ergebnis.letztesErgebnis }, 200);
    })
    .post("/:id/register/abruf", pruefe("param", idParam), pruefe("json", abrufEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      const a = anbieterOderFehler(anbieter);
      const referenz = await lese(db, async (tx) => {
        await ladeOrganisation(tx, id);
        const e = await aktuellerEintrag(tx, id);
        const r = { gericht: eingabe.gericht ?? e?.gericht, registerart: eingabe.registerart ?? e?.registerart, nummer: eingabe.nummer ?? e?.nummer };
        if (!r.gericht || !r.registerart || !r.nummer) throw new Fachfehler(409, "REGISTER_REFERENZ_FEHLT", "Gericht, Registerart und Nummer fehlen; sie stehen noch in keinem Eintrag.");
        return r as { gericht: string; registerart: (typeof REGISTERARTEN)[number]; nummer: string };
      });
      let abruf;
      try {
        abruf = await a.abruf(referenz);
      } catch {
        throw new Fachfehler(502, "REGISTER_ABRUF_FEHLGESCHLAGEN", "Der Abruf beim Anbieter ist fehlgeschlagen.");
      }
      if (!abruf) throw new Fachfehler(404, "REGISTER_NICHT_GEFUNDEN", "Der Anbieter kennt diesen Registereintrag nicht.");
      const quelle = `anbieter:${a.name}`;
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const { eintrag, neu } = await legeEintragAn(tx, protokoll, id, abruf.eintrag, quelle);
        let ereignisse = 0;
        if (neu) await meldeEintrag(tx, id, eintrag.firma, eintrag.standDatum);
        for (const e of abruf.ereignisse) {
          const r = await legeEreignisAn(tx, protokoll, id, e, quelle, eintrag.id);
          if (r.neu) {
            ereignisse++;
            await meldeEreignis(tx, id, r.ereignis, eintrag.firma, { protokoll, kontext: c.get("mail") });
          }
        }
        return { eintrag, neu, ereignisse };
      });
      return c.json(ergebnis, 200);
    });
}

/** Register ohne einzelne Organisation: Anbieter, Suche, Import, Meldungen. Unter `/register`. */
export function registerRouten(db: Db, anbieter: RegisterAnbieter | null = erstelleRegisterAnbieter()) {
  return new Hono()
    .get("/status", async (c) => c.json({ anbieterEingerichtet: anbieter !== null, anbieter: anbieter?.name ?? null }, 200))
    .get("/suche", pruefe("query", z.object({ firma: textEingabe(200).optional(), nummer: textEingabe(50).optional() }).refine((v) => v.firma || v.nummer, { message: "Firma oder Nummer angeben", path: [] })), async (c) => {
      const a = anbieterOderFehler(anbieter);
      try {
        return c.json({ daten: await a.suche(c.req.valid("query")) }, 200);
      } catch {
        throw new Fachfehler(502, "REGISTER_ABRUF_FEHLGESCHLAGEN", "Der Abruf beim Anbieter ist fehlgeschlagen.");
      }
    })
    .post("/import", pruefe("json", importEingabe), async (c) => {
      const { format, inhalt, nurPruefen } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const geprueft = await pruefeImport(tx, format, inhalt);
        if (nurPruefen) return { zeilen: geprueft.zeilen.length, uebernommen: false as const };
        return { zeilen: geprueft.zeilen.length, uebernommen: true as const, ...(await uebernehmeImport(tx, protokoll, geprueft, c.get("mail"))) };
      });
      return c.json(ergebnis, 200);
    })
    .get("/meldungen", pruefe("query", z.object({ ungelesen: z.enum(["true", "false"]).optional(), organisationId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })), async (c) => {
      const { ungelesen, organisationId, limit } = c.req.valid("query");
      const zeilen = await lese(db, (tx) =>
        tx
          .select({ m: registerMeldung, organisation: organisation.name })
          .from(registerMeldung)
          .innerJoin(organisation, eq(organisation.id, registerMeldung.organisationId))
          .where(and(ungelesen === "true" ? isNull(registerMeldung.gelesenAm) : undefined, organisationId ? eq(registerMeldung.organisationId, organisationId) : undefined))
          .orderBy(desc(registerMeldung.erstelltAm), asc(registerMeldung.id))
          .limit(limit),
      );
      return c.json({ daten: zeilen.map(({ m, organisation: o }) => ({ ...m, organisation: o })) }, 200);
    })
    .post("/meldungen/:id/gelesen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const [m] = await tx.select().from(registerMeldung).where(eq(registerMeldung.id, id));
        if (!m) throw new Fachfehler(404, "REGISTER_MELDUNG_NICHT_GEFUNDEN", "Meldung nicht gefunden.");
        if (m.gelesenAm) return m;
        const [nachher] = await tx.update(registerMeldung).set({ gelesenAm: new Date(), gelesenVon: protokoll.akteur }).where(eq(registerMeldung.id, id)).returning();
        return nachher!;
      });
      return c.json(ergebnis, 200);
    });
}

/** Hinweise aus Registerereignissen an einer Beteiligung. Unter `/beteiligungen`. */
export function registerBeteiligungRouten(db: Db) {
  return new Hono().get("/:id/register-hinweise", pruefe("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    return c.json({ daten: await lese(db, (tx) => ladeHinweise(tx, { beteiligungId: id })) }, 200);
  });
}
