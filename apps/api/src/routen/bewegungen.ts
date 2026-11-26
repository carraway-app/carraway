import { pruefeFonds } from "../fonds-pruefung";
import { fondsAnApi } from "../fonds-vertrag";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql, lte } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { erzeugeMitteilung, type Sprache } from "@carraway/berichte";
import { aenderung, fondsBewegung, fondsMitteilung, type Db } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { ladeAbrufNachweise, ladeKapitalHerkunft } from "../instrumente/kapital-herkunft";
import { dispositionKopf } from "../dokumente/typ";
import { ladeKapitalstand } from "../instrumente/kapitalstand";
import { ladeVerteilung } from "../berichte/daten";
import { erstelleStandardSpeicher, sha256, type Speicher } from "../berichte/speicher";
import { Fachfehler } from "../fehler";
import { verlangeMail } from "../mail/auftraege";
import { sendeLpHinweis } from "../mail/benachrichtigung";
import { verlangeAnderenAkteur } from "../instrumente/bewertung";
import { ladeFonds, protokolliereLesen, schreibe } from "../schreiben";
import { lese } from "../zeitlimit";

/**
 * Kapitalabrufe und Ausschüttungen eines Fonds und die Mitteilungen an die Investoren (Etappe 12). Mount unter `/funds`.
 * Die Freigabe erzeugt je Investor eine PDF-Mitteilung mit dem auf den Cent verteilten Anteil (dieselbe Verteilung wie im LP-Bericht),
 * speichert sie unveränderlich (SHA-256) und macht sie im Portal sichtbar. Vier-Augen: eine andere Person als die, die die Bewegung
 * erfasst hat (aus dem Änderungsprotokoll, wo bekannt: Datenübernahmen und Demo-Daten tragen `system` oder die Person des Imports).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fondsParam = z.object({ id: z.uuid() });
const bewegungParam = z.object({ id: z.uuid(), bewegungId: z.uuid() });
const schnittAbfrage = z.object({ stichtag: z.iso.date(), stand: z.iso.datetime({ offset: true }) });
const freigabeEingabe = z.object({
  sprache: z.enum(["de", "en"]).default("de"),
  /** Zusätzlich die Investor-Benutzer per Mail auf die neuen Mitteilungen im Portal hinweisen (ohne Beträge, ohne Datei). */
  perMail: z.boolean().default(false),
});

const slug = (text: string) => text.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
const NAME: Record<"abruf" | "ausschuettung", Record<Sprache, string>> = {
  abruf: { de: "kapitalabruf", en: "capital-call" },
  ausschuettung: { de: "ausschuettung", en: "distribution" },
};

export function bewegungRouten(db: Db, speicher: Speicher = erstelleStandardSpeicher()) {
  return new Hono()
    .get("/:id/movements/capital-position", pruefeFonds("param", fondsParam), pruefeFonds("query", z.object({ stichtag: z.iso.date(), stand: z.iso.datetime({ offset: true }).optional() })), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, stand } = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        const quellenstand = stand ?? (await tx.execute<{ stand: string }>(sql`SELECT to_json(now()) #>> '{}' AS stand`)).rows[0]!.stand;
        const kapital = await ladeKapitalstand(tx, id, stichtag, quellenstand);
        return { stichtag, quellenstand, fonds: kapital.fonds, konten: kapital.zeichnungen.map((z) => ({
          organisationId: z.organisationId, investor: z.investor, ...kapital.jeLp.get(z.organisationId)!,
        })) };
      });
      return c.json(fondsAnApi(daten));
    })
    .get("/:id/movements/sources", pruefeFonds("param", fondsParam), pruefeFonds("query", schnittAbfrage.extend({ bewegungId: z.uuid().optional() })), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, stand, bewegungId } = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        const fonds = await ladeFonds(tx, id);
        const positionen = await ladeKapitalHerkunft(tx, id, stichtag, stand, bewegungId);
        const nachweise = bewegungId ? await ladeAbrufNachweise(tx, id, bewegungId, stichtag, stand) : null;
        return { ...positionen, nachweise, waehrung: fonds.waehrung };
      });
      return c.json(fondsAnApi(daten));
    })
    .get("/:id/movements/notices/:noticeId/file", pruefeFonds("param", fondsParam.extend({ mitteilungId: z.uuid() })), pruefeFonds("query", schnittAbfrage), async (c) => {
      const { id, mitteilungId } = c.req.valid("param");
      const { stichtag, stand } = c.req.valid("query");
      const [m] = await lese(db, (tx) => tx.select().from(fondsMitteilung).where(and(
        eq(fondsMitteilung.id, mitteilungId), eq(fondsMitteilung.fondsId, id), lte(fondsMitteilung.valuta, stichtag),
        sql`${fondsMitteilung.freigegebenAm} <= ${stand}::timestamptz`,
      )));
      if (!m) throw new Fachfehler(404, "notice_not_found", "Notice not found.");
      const bytes = await speicher.lese(m.dateiSchluessel);
      if (sha256(bytes) !== m.dateiSha256) throw new Fachfehler(500, "file_corrupt", "The stored file does not match its hash.");
      await protokolliereLesen(db, c, "fonds_mitteilung", mitteilungId, { dateiName: m.dateiName, sha256: m.dateiSha256 });
      return c.body(Buffer.from(bytes), 200, { "Content-Type": "application/pdf", "Content-Disposition": dispositionKopf("attachment", m.dateiName), "Cache-Control": "no-store", "X-File-Sha256": m.dateiSha256 });
    })
    /** Kapitalbewegungen des Fonds, neueste zuerst, mit dem Stand der Mitteilungen. */
    .get("/:id/movements", pruefeFonds("param", fondsParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        const zeilen = await tx.select().from(fondsBewegung).where(eq(fondsBewegung.fondsId, id)).orderBy(asc(fondsBewegung.valuta), asc(fondsBewegung.id));
        const mitteilungen = zeilen.length
          ? await tx.select({ bewegungId: fondsMitteilung.bewegungId }).from(fondsMitteilung).where(inArray(fondsMitteilung.bewegungId, zeilen.map((z) => z.id)))
          : [];
        const stornierte = new Set(zeilen.flatMap((z) => (z.storniertBewegungId ? [z.storniertBewegungId] : [])));
        return zeilen
          .map((z) => ({
            id: z.id,
            art: z.art,
            valuta: z.valuta,
            betrag: z.betrag,
            bemerkung: z.bemerkung,
            erfasstAm: z.erfasstAm.toISOString(),
            istStorno: z.storniertBewegungId !== null,
            storniert: stornierte.has(z.id),
            anzahlMitteilungen: mitteilungen.filter((m) => m.bewegungId === z.id).length,
          }))
          .reverse();
      });
      return c.json(fondsAnApi({ daten }), 200);
    })
    /**
     * Gibt die Mitteilungen einer Bewegung frei: je Investor eine PDF (Fonds, Investor, Betragsanteil, Fälligkeit, Verwendungszweck als
     * Platzhalter, Stand bis dahin), gespeichert und im Portal sichtbar. Einmal je Bewegung (409 `notices_exist`); nicht für stornierte Bewegungen und Stornos (409 `movement_reversed`).
     */
    .post("/:id/movements/:movementId/notices/approve", pruefeFonds("param", bewegungParam), pruefeFonds("json", freigabeEingabe), async (c) => {
      const { id, bewegungId } = c.req.valid("param");
      const { sprache, perMail } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const fonds = await ladeFonds(tx, id);
        if (perMail) verlangeMail(c.get("mail"));
        const [bewegung] = await tx.select().from(fondsBewegung).where(eq(fondsBewegung.id, bewegungId)).for("update");
        // Die Rolle prüft die Tabelle am Fonds des Pfads; die Bewegung muss zu genau diesem Fonds gehören.
        if (!bewegung || bewegung.fondsId !== id) throw new Fachfehler(404, "movement_not_found", "Capital movement not found.");
        const [erfasst] = await tx
          .select({ akteur: aenderung.akteur })
          .from(aenderung)
          .where(and(eq(aenderung.tabelle, "fonds_bewegung"), eq(aenderung.datensatzId, bewegungId), eq(aenderung.aktion, "anlegen")))
          .orderBy(asc(aenderung.am), asc(aenderung.id))
          .limit(1);
        if (erfasst && UUID.test(erfasst.akteur)) verlangeAnderenAkteur(erfasst.akteur, protokoll.akteur);
        // Ein Storno und sein Original sind aus allen Konten heraus (Etappe 4b); dafür gibt es keine neue Mitteilung. Bereits freigegebene bleiben bestehen.
        const [stornoZeile] = await tx.select({ id: fondsBewegung.id }).from(fondsBewegung).where(eq(fondsBewegung.storniertBewegungId, bewegungId)).limit(1);
        if (bewegung.storniertBewegungId !== null || stornoZeile) {
          throw new Fachfehler(409, "movement_reversed", "There are no notices for a reversed capital movement (or for its reversal).");
        }
        const [vorhanden] = await tx.select({ id: fondsMitteilung.id }).from(fondsMitteilung).where(eq(fondsMitteilung.bewegungId, bewegungId)).limit(1);
        if (vorhanden) throw new Fachfehler(409, "notices_exist", "The notices for this movement are already approved.");

        const verteilung = await ladeVerteilung(tx, id, bewegung.valuta, undefined);
        if (verteilung.zeichnungen.length === 0) throw new Fachfehler(409, "no_subscriptions", "The fund has no subscriptions; there are no investors to receive a notice.");
        const stelle = verteilung.bewegungen.findIndex((b) => b.id === bewegungId);
        if (stelle < 0) throw new Error("Bewegung fehlt in der Verteilung");
        const bisDahin = verteilung.bewegungen.slice(0, stelle + 1);
        const jetzt = new Date();
        const ergebnisse = [];
        for (const [i, z] of verteilung.zeichnungen.entries()) {
          const summe = (art: "abruf" | "ausschuettung") => bisDahin.filter((b) => b.art === art).reduce((s, b) => s.plus(b.teile[i]!), new Decimal(0));
          const abgerufen = summe("abruf");
          const betrag = bisDahin[stelle]!.teile[i]!;
          const bytes = erzeugeMitteilung(
            {
              fonds: { name: fonds.name, kurzname: fonds.kurzname, waehrung: fonds.waehrung },
              investor: z.investor,
              art: bewegung.art,
              valuta: bewegung.faelligAm ?? bewegung.valuta,
              betrag,
              fondsBetrag: bewegung.betrag,
              anteil: z.anteil,
              referenz: `${fonds.kurzname} / ${bewegung.art === "abruf" ? "KA" : "AS"} / ${bewegung.valuta} / ${bewegung.id.slice(0, 8).toUpperCase()}`,
              erstelltAm: jetzt.toISOString(),
              summen: { zusage: z.zusage, abgerufen: abgerufen.toFixed(2), ausgeschuettet: summe("ausschuettung").toFixed(2), offeneZusage: new Decimal(z.zusage).minus(abgerufen).toFixed(2) },
            },
            sprache,
          );
          const mitteilungId = randomUUID();
          const hash = sha256(bytes);
          const schluessel = `mitteilungen/${mitteilungId}/${hash}.pdf`;
          await speicher.schreibe(schluessel, bytes);
          const dateiName = `${NAME[bewegung.art][sprache]}-${slug(fonds.kurzname)}-${bewegung.valuta}-${slug(z.investor)}.pdf`;
          const [neu] = await tx
            .insert(fondsMitteilung)
            .values({
              id: mitteilungId,
              bewegungId,
              fondsId: id,
              organisationId: z.organisationId,
              art: bewegung.art,
              valuta: bewegung.valuta,
              betrag,
              sprache,
              dateiName,
              dateiSchluessel: schluessel,
              dateiSha256: hash,
              dateiGroesse: bytes.length,
              freigegebenVon: protokoll.akteur,
              freigegebenAm: jetzt,
            })
            .returning();
          await protokoll("anlegen", "fonds_mitteilung", mitteilungId, null, neu);
          ergebnisse.push({ id: mitteilungId, organisation: { id: z.organisationId, name: z.investor }, betrag, dateiName, dateiSha256: hash });
        }
        await protokoll("mitteilungen_freigeben", "fonds_bewegung", bewegungId, null, { anzahl: ergebnisse.length, sprache, perMail });
        const mails = perMail
          ? await sendeLpHinweis(tx, protokoll, c.get("mail"), { fondsName: fonds.name, art: bewegung.art, organisationIds: ergebnisse.map((r) => r.organisation.id), bezugId: bewegungId, sprache })
          : 0;
        return { ergebnisse, mails };
      });
      return c.json(fondsAnApi({ bewegungId, anzahl: ergebnis.ergebnisse.length, mitteilungen: ergebnis.ergebnisse, mailAuftraege: ergebnis.mails }), 201);
    });
}
