import { kontaktJson, pruefeKontakt } from "../kontakte/http";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { aktivitaet, aktivitaetSync, person, postfachVerbindung, type Db, type Dokument } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { sha256, type Speicher } from "../berichte/speicher";
import { bereiteVor, legeDokumentAn, sichtbareDubletten } from "../dokumente/speichern";
import { MAX_DOKUMENT } from "../dokumente/typ";
import { verlangeZiele, type Ziel } from "../dokumente/ziele";
import { Fachfehler } from "../fehler";
import type { Konfiguration } from "../konfiguration";
import type { Abrufer } from "../postfach/http";
import type { ImapFabrik } from "../postfach/imap";
import { erstelleAnbieterFabrik } from "../postfach/anbieter";
import { PostfachFehler, type Anhang, type PostfachAnbieter, type Zugang } from "../postfach/typen";
import { leseZugang } from "../postfach/zugang";
import { schreibe, type Protokollant } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

/**
 * Anhänge synchronisierter Mails (Etappe 17): Beim Abgleich werden nie Anhänge gelesen. Erst auf ausdrücklichen Klick der Person, deren Postfach die Mail
 * angelegt hat, zeigt `GET .../attachments` die Anhänge (nur Name, Größe, Typ, live beim Anbieter) und übernimmt `POST .../import` einen davon als Dokument
 * (Typ- und Größenprüfung wie beim Hochladen, verknüpft mit dem Deal der Mail, sonst mit der Organisation; Rolle Bearbeiter am Ziel). Das Erneuern des
 * Zugriffstokens bleibt allein beim Worker (rotierende Refresh-Tokens): Ist das Token abgelaufen, wird ein Abgleich angefordert und die Person versucht es danach noch einmal.
 *
 * Den Weg bietet `erstelleAnhangDienst` auch Erweiterungen an (`ErweiterungsKontext.anhaenge`), zum Beispiel für die Übergabe eines Anhangs an die KI-Auslesung.
 */

const param = z.object({ id: z.uuid(), anhangId: z.string().min(1).max(500) });
const nurId = z.object({ id: z.uuid() });

export interface AnhangOptionen {
  konfig: Konfiguration;
  abrufer: Abrufer;
  imapFabrik: ImapFabrik;
  speicher: Speicher;
}

type Kontext = Parameters<typeof aktuellerAkteur>[0];

/** Die Quelle eines Anhangs: die Mail, ihre Herkunft im Postfach und der Adapter des Anbieters (nur für die Person, deren Postfach die Mail angelegt hat). */
export interface AnhangQuelle {
  akteur: ReturnType<typeof aktuellerAkteur>;
  akt: typeof aktivitaet.$inferSelect;
  sync: typeof aktivitaetSync.$inferSelect;
  kopfId: string;
  zugang: Zugang;
  adapter: PostfachAnbieter;
  personOrg: string | null;
}

/** Ergebnis einer Übernahme: das Dokument, sein Ziel und das Ergebnis des Schrittes `nachAnlage` (`null` ohne). */
export interface AnhangUebernahme<T> {
  dokument: Dokument;
  ziel: Ziel;
  ergebnis: T | null;
}

interface UebernahmeOptionen<T> {
  maxBytes?: number;
  rolle?: "bearbeiter" | "verwalter";
  pruefeAnhang?: (anhang: Anhang) => void;
  nachAnlage?: (tx: Tx, protokoll: Protokollant, dokument: Dokument, ziel: Ziel) => Promise<T>;
}

/** Dienste rund um Anhänge synchronisierter Mails. Die Routen des Kerns und Erweiterungen nutzen denselben Weg samt Rechteprüfung. */
export interface AnhangDienst {
  /** Lädt die Quelle; nur die Person, deren Postfach die Mail angelegt hat, und nur für Anbieter, die Anhänge können. */
  ladeQuelle(c: Kontext, aktivitaetId: string): Promise<AnhangQuelle>;
  /** Fehler des Anbieters als Fehler der API (keine Anbieter-Texte). */
  uebersetze(f: unknown): never;
  /**
   * Übernimmt einen Anhang als Dokument (Typ- und Größenprüfung wie beim Hochladen, vertraulich, verknüpft mit dem Deal der Mail, sonst mit der Organisation, Rolle
   * Bearbeiter am Ziel). `nachAnlage` läuft in derselben Transaktion und kann weitere Daten anlegen.
   */
  uebernehme<T = never>(c: Kontext, q: AnhangQuelle, anhangId: string, optionen?: UebernahmeOptionen<T>): Promise<AnhangUebernahme<T>>;
}

export function erstelleAnhangDienst(db: Db, opt: AnhangOptionen): AnhangDienst {
  const fabrik = erstelleAnbieterFabrik({ konfig: opt.konfig.postfach, abrufer: opt.abrufer, imapFabrik: opt.imapFabrik, umgebung: opt.konfig.umgebung });

  async function ladeQuelle(c: Kontext, aktivitaetId: string): Promise<AnhangQuelle> {
    const akteur = aktuellerAkteur(c);
    const zeile = await lese(db, async (tx) => {
      const [a] = await tx
        .select({ akt: aktivitaet, sync: aktivitaetSync, personOrg: person.organisationId })
        .from(aktivitaet)
        .leftJoin(aktivitaetSync, eq(aktivitaetSync.aktivitaetId, aktivitaet.id))
        .leftJoin(person, eq(person.id, aktivitaet.personId))
        .where(eq(aktivitaet.id, aktivitaetId));
      return a ?? null;
    });
    if (!zeile) throw new Fachfehler(404, "activity_not_found", "Activity not found.");
    if (!zeile.sync || zeile.akt.art !== "mail") throw new Fachfehler(409, "not_synced_activity", "This activity does not come from a connected mailbox.");
    if (zeile.sync.benutzerId !== akteur.id) throw new Fachfehler(403, "synced_activity_foreign", "Only the person whose mailbox created the mail can access its attachments.");
    if ((zeile.sync.anbieter !== "microsoft" && zeile.sync.anbieter !== "google") || !zeile.sync.anbieterId) {
      throw new Fachfehler(409, "attachment_not_supported", "Attachments cannot be loaded for this mail.");
    }
    const ring = opt.konfig.schluessel;
    if (!ring) throw new Fachfehler(409, "secret_missing", "GEHEIMNIS_SCHLUESSEL is not set.");
    const [v] = await lese(db, (tx) =>
      tx.select().from(postfachVerbindung).where(and(eq(postfachVerbindung.benutzerId, akteur.id), eq(postfachVerbindung.bereich, "mail"), eq(postfachVerbindung.anbieter, zeile.sync!.anbieter))),
    );
    if (!v) throw new Fachfehler(404, "mailbox_not_found", "The mailbox is no longer connected.");
    let zugang: Zugang;
    try {
      zugang = leseZugang(ring, v.id, v.zugangVerschluesselt);
    } catch {
      throw new Fachfehler(409, "mailbox_connection_failed", "The stored credentials cannot be read.");
    }
    if (zugang.art === "oauth" && zugang.ablaufMs - 60_000 < Date.now()) {
      await schreibe(db, c, async (tx) => {
        await tx.update(postfachVerbindung).set({ naechsterAbgleichAm: new Date() }).where(eq(postfachVerbindung.id, v.id));
      });
      throw new Fachfehler(409, "mailbox_access_expired", "Access must be renewed first. Please try again in a minute.");
    }
    const adapter: PostfachAnbieter = await fabrik(zeile.sync.anbieter, zugang);
    return { akteur, akt: zeile.akt, sync: zeile.sync, kopfId: zeile.sync.anbieterId, zugang, adapter, personOrg: zeile.personOrg };
  }

  /** Fehler des Anbieters als Fehler der API (keine Anbieter-Texte). */
  const uebersetze = (f: unknown): never => {
    if (f instanceof Fachfehler) throw f;
    if (f instanceof PostfachFehler && f.code === "ANHANG_ZU_GROSS") throw new Fachfehler(413, "document_too_large", "The attachment exceeds the size limit.");
    throw new Fachfehler(502, "mailbox_connection_failed", "The connection to the mailbox failed.");
  };

  async function uebernehme<T = never>(c: Kontext, q: AnhangQuelle, anhangId: string, optionen: UebernahmeOptionen<T> = {}): Promise<AnhangUebernahme<T>> {
    const { rolle = "bearbeiter", nachAnlage } = optionen;
    const maxBytes = Math.min(optionen.maxBytes ?? MAX_DOKUMENT, MAX_DOKUMENT);
    const organisationId = q.akt.organisationId ?? q.personOrg;
    const ziel: Ziel | null = q.akt.dealId ? { typ: "deal", id: q.akt.dealId } : organisationId ? { typ: "organisation", id: organisationId } : null;
    if (!ziel) throw new Fachfehler(409, "attachment_not_supported", "The mail has neither a deal nor an organization to link the document to.");
    await lese(db, (tx) => verlangeZiele(tx, q.akteur, [ziel], rolle));
    let bytes: Uint8Array;
    let name: string;
    try {
      // Die Angaben zum Anhang kommen vom Anbieter, nicht vom Aufrufer: Name und Typ der Liste, nicht aus der Anfrage.
      const eintrag = (await q.adapter.listeAnhaenge!(q.zugang, q.kopfId)).find((a) => a.id === anhangId);
      if (!eintrag) throw new Fachfehler(404, "attachment_not_found", "This attachment does not exist (anymore).");
      optionen.pruefeAnhang?.(eintrag);
      if (eintrag.groesse > maxBytes) throw new Fachfehler(413, "document_too_large", "The attachment exceeds the size limit.");
      name = eintrag.name;
      bytes = await q.adapter.holeAnhang!(q.zugang, q.kopfId, anhangId, maxBytes);
      if (bytes.byteLength > maxBytes) throw new Fachfehler(413, "document_too_large", "The attachment exceeds the size limit.");
    } catch (f) {
      return uebersetze(f);
    }
    const vorbereitet = await bereiteVor(opt.speicher, bytes, name);
    return schreibe(db, c, async (tx, protokoll) => {
      await verlangeZiele(tx, q.akteur, [ziel], rolle);
      const dubletten = await sichtbareDubletten(tx, q.akteur, vorbereitet.hash);
      if (dubletten[0]) throw new Fachfehler(409, "document_exists", "This document already exists.", { dokumentId: dubletten[0].id, dateiname: dubletten[0].dateiname });
      // Anhänge aus Mails sind vertraulich, bis jemand es ausdrücklich ändert.
      const d = await legeDokumentAn(tx, protokoll, { id: q.akteur.id, name: q.akteur.name }, vorbereitet, { klassifikation: "sonstiges", vertraulich: true, ziele: [ziel] });
      await protokoll("anhang_uebernehmen", "aktivitaet", q.akt.id, null, { dokumentId: d.id, sha256: sha256(bytes) });
      return { dokument: d, ziel, ergebnis: nachAnlage ? await nachAnlage(tx, protokoll, d, ziel) : null };
    });
  }

  return { ladeQuelle, uebersetze, uebernehme };
}

export function anhangRouten({ ladeQuelle, uebersetze, uebernehme }: AnhangDienst) {
  return new Hono()
    .get("/:id/attachments", pruefeKontakt("param", nurId), async (c) => {
      const { id } = c.req.valid("param");
      const q = await ladeQuelle(c, id);
      try {
        const liste = await q.adapter.listeAnhaenge!(q.zugang, q.kopfId);
        return kontaktJson(c, { daten: liste.map((a) => ({ id: a.id, name: a.name, groesse: a.groesse, typ: a.typ })) }, 200);
      } catch (f) {
        return uebersetze(f);
      }
    })
    .post("/:id/attachments/:attachmentId/import", pruefeKontakt("param", param), async (c) => {
      const { id, anhangId } = c.req.valid("param");
      const q = await ladeQuelle(c, id);
      const { dokument } = await uebernehme(c, q, anhangId);
      return kontaktJson(c, { dokumentId: dokument.id, dateiname: dokument.dateiname }, 201);
    });
}
