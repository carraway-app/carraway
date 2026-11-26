import { kontaktJson, pruefeKontakt } from "../kontakte/http";
import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { benutzerEinstellung, mailAuftrag, mailStatus as mailStatusEnum, type Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { legeMailAn, verlangeMail } from "../mail/auftraege";
import { mailStatus } from "../mail/konfiguration";
import { schreibe } from "../schreiben";
import { lese } from "../zeitlimit";

/**
 * Verwaltung des Mailversands (Etappe 17), nur für globale Verwalter und nur für Menschen: Status der SMTP-Einrichtung (Passwort und Benutzer
 * erscheinen nie), Testmail an die eigene Adresse und der Ausgangskorb ohne Inhalte.
 */

const listeAbfrage = z.object({ status: z.enum(mailStatusEnum.enumValues).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

export function mailRouten(db: Db) {
  return new Hono()
    .get("/status", async (c) => {
      const k = c.get("mail");
      const zaehler = await lese(db, async (tx) => {
        const { rows } = await tx.execute<{ wartend: number; fehlgeschlagen: number; letzte_stunde: number }>(sql`
          SELECT count(*) FILTER (WHERE status = 'wartend')::int AS wartend,
                 count(*) FILTER (WHERE status = 'fehlgeschlagen')::int AS fehlgeschlagen,
                 count(*) FILTER (WHERE gesendet_am > now() - interval '1 hour')::int AS letzte_stunde
          FROM mail_auftrag`);
        return rows[0] ?? { wartend: 0, fehlgeschlagen: 0, letzte_stunde: 0 };
      });
      return kontaktJson(
        c,
        { ...mailStatus(k?.konfig), schluesselVorhanden: Boolean(k?.ring), ausgangskorb: { wartend: zaehler.wartend, fehlgeschlagen: zaehler.fehlgeschlagen, gesendetLetzteStunde: zaehler.letzte_stunde } },
        200,
      );
    })
    /** Legt eine Testmail an die Adresse der angemeldeten Person in den Ausgangskorb; der Worker sendet sie. */
    .post("/test", async (c) => {
      const akteur = aktuellerAkteur(c);
      const id = await schreibe(db, c, async (tx, protokoll) => {
        verlangeMail(c.get("mail"));
        const [e] = await tx.select({ sprache: benutzerEinstellung.sprache }).from(benutzerEinstellung).where(eq(benutzerEinstellung.benutzerId, akteur.id));
        return legeMailAn(tx, protokoll, c.get("mail"), { an: akteur.email, sprache: e?.sprache === "en" ? "en" : "de", vorlage: "testmail", parameter: {}, bezug: { art: "testmail", id: akteur.id } });
      });
      return kontaktJson(c, { auftragId: id }, 202);
    })
    /** Ausgangskorb: Status, Versuche und Fehlercode, nie der Inhalt. */
    .get("/jobs", pruefeKontakt("query", listeAbfrage), async (c) => {
      const { status, limit } = c.req.valid("query");
      const zeilen = await lese(db, (tx) =>
        tx
          .select({
            id: mailAuftrag.id,
            empfaenger: mailAuftrag.empfaenger,
            vorlage: mailAuftrag.vorlage,
            betreff: mailAuftrag.betreff,
            bezugArt: mailAuftrag.bezugArt,
            bezugId: mailAuftrag.bezugId,
            status: mailAuftrag.status,
            versuche: mailAuftrag.versuche,
            letzterFehler: mailAuftrag.letzterFehler,
            naechsterVersuchAm: mailAuftrag.naechsterVersuchAm,
            erstelltAm: mailAuftrag.erstelltAm,
            gesendetAm: mailAuftrag.gesendetAm,
          })
          .from(mailAuftrag)
          .where(status ? eq(mailAuftrag.status, status) : undefined)
          .orderBy(desc(mailAuftrag.erstelltAm), desc(mailAuftrag.id))
          .limit(limit),
      );
      return kontaktJson(c, { daten: zeilen }, 200);
    });
}
