import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { aktivitaet, aktivitaetSync, person, postfachVerbindung, type Db } from "@carraway/db";
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
import { PostfachFehler, type PostfachAnbieter, type Zugang } from "../postfach/typen";
import { leseZugang } from "../postfach/zugang";
import { pruefe } from "../pruefung";
import { schreibe } from "../schreiben";
import { lese } from "../zeitlimit";

/**
 * Anhänge synchronisierter Mails (Etappe 17): Beim Abgleich werden nie Anhänge gelesen. Erst auf ausdrücklichen Klick der Person, deren Postfach die Mail
 * angelegt hat, zeigt `GET .../anhaenge` die Anhänge (nur Name, Größe, Typ, live beim Anbieter) und übernimmt `POST .../importieren` einen davon als Dokument
 * (Typ- und Größenprüfung wie beim Hochladen, verknüpft mit dem Deal der Mail, sonst mit der Organisation; Rolle Bearbeiter am Ziel). Das Erneuern des
 * Zugriffstokens bleibt allein beim Worker (rotierende Refresh-Tokens): Ist das Token abgelaufen, wird ein Abgleich angefordert und die Person versucht es danach noch einmal.
 */

const param = z.object({ id: z.uuid(), anhangId: z.string().min(1).max(500) });
const nurId = z.object({ id: z.uuid() });

export interface AnhangOptionen {
  konfig: Konfiguration;
  abrufer: Abrufer;
  imapFabrik: ImapFabrik;
  speicher: Speicher;
}

export function anhangRouten(db: Db, opt: AnhangOptionen) {
  const fabrik = erstelleAnbieterFabrik({ konfig: opt.konfig.postfach, abrufer: opt.abrufer, imapFabrik: opt.imapFabrik, umgebung: opt.konfig.umgebung });

  async function ladeQuelle(c: Parameters<typeof aktuellerAkteur>[0], aktivitaetId: string) {
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
    if (!zeile) throw new Fachfehler(404, "AKTIVITAET_NICHT_GEFUNDEN", "Aktivität nicht gefunden.");
    if (!zeile.sync || zeile.akt.art !== "mail") throw new Fachfehler(409, "KEINE_SYNC_AKTIVITAET", "Diese Aktivität stammt nicht aus einer Postfachanbindung.");
    if (zeile.sync.benutzerId !== akteur.id) throw new Fachfehler(403, "FREMDE_SYNC_AKTIVITAET", "Nur die Person, deren Postfach die Mail angelegt hat, kommt an ihre Anhänge.");
    if ((zeile.sync.anbieter !== "microsoft" && zeile.sync.anbieter !== "google") || !zeile.sync.anbieterId) {
      throw new Fachfehler(409, "ANHANG_NICHT_UNTERSTUETZT", "Für diese Mail lassen sich Anhänge nicht laden.");
    }
    const ring = opt.konfig.schluessel;
    if (!ring) throw new Fachfehler(409, "GEHEIMNIS_FEHLT", "GEHEIMNIS_SCHLUESSEL ist nicht gesetzt.");
    const [v] = await lese(db, (tx) =>
      tx.select().from(postfachVerbindung).where(and(eq(postfachVerbindung.benutzerId, akteur.id), eq(postfachVerbindung.bereich, "mail"), eq(postfachVerbindung.anbieter, zeile.sync!.anbieter))),
    );
    if (!v) throw new Fachfehler(404, "POSTFACH_NICHT_GEFUNDEN", "Das Postfach ist nicht mehr verbunden.");
    let zugang: Zugang;
    try {
      zugang = leseZugang(ring, v.id, v.zugangVerschluesselt);
    } catch {
      throw new Fachfehler(409, "POSTFACH_VERBINDUNG_FEHLGESCHLAGEN", "Die gespeicherten Zugangsdaten lassen sich nicht lesen.");
    }
    if (zugang.art === "oauth" && zugang.ablaufMs - 60_000 < Date.now()) {
      await schreibe(db, c, async (tx) => {
        await tx.update(postfachVerbindung).set({ naechsterAbgleichAm: new Date() }).where(eq(postfachVerbindung.id, v.id));
      });
      throw new Fachfehler(409, "POSTFACH_ZUGANG_ABGELAUFEN", "Der Zugriff muss erst erneuert werden. Bitte in einer Minute noch einmal versuchen.");
    }
    const adapter: PostfachAnbieter = await fabrik(zeile.sync.anbieter, zugang);
    return { akteur, akt: zeile.akt, kopfId: zeile.sync.anbieterId, zugang, adapter, personOrg: zeile.personOrg };
  }

  /** Fehler des Anbieters als Fehler der API (keine Anbieter-Texte). */
  const uebersetze = (f: unknown): never => {
    if (f instanceof Fachfehler) throw f;
    if (f instanceof PostfachFehler && f.code === "ANHANG_ZU_GROSS") throw new Fachfehler(413, "DOKUMENT_ZU_GROSS", `Der Anhang ist größer als ${MAX_DOKUMENT / 1024 / 1024} MB.`);
    throw new Fachfehler(502, "POSTFACH_VERBINDUNG_FEHLGESCHLAGEN", "Die Verbindung zum Postfach ist fehlgeschlagen.");
  };

  return new Hono()
    .get("/:id/anhaenge", pruefe("param", nurId), async (c) => {
      const { id } = c.req.valid("param");
      const q = await ladeQuelle(c, id);
      try {
        const liste = await q.adapter.listeAnhaenge!(q.zugang, q.kopfId);
        return c.json({ daten: liste.map((a) => ({ id: a.id, name: a.name, groesse: a.groesse, typ: a.typ })) }, 200);
      } catch (f) {
        return uebersetze(f);
      }
    })
    .post("/:id/anhaenge/:anhangId/importieren", pruefe("param", param), async (c) => {
      const { id, anhangId } = c.req.valid("param");
      const q = await ladeQuelle(c, id);
      const organisationId = q.akt.organisationId ?? q.personOrg;
      const ziel: Ziel | null = q.akt.dealId ? { typ: "deal", id: q.akt.dealId } : organisationId ? { typ: "organisation", id: organisationId } : null;
      if (!ziel) throw new Fachfehler(409, "ANHANG_NICHT_UNTERSTUETZT", "Die Mail hat weder einen Deal noch eine Organisation, mit der das Dokument verknüpft werden könnte.");
      await lese(db, (tx) => verlangeZiele(tx, q.akteur, [ziel], "bearbeiter"));
      let bytes: Uint8Array;
      let name: string;
      try {
        // Die Angaben zum Anhang kommen vom Anbieter, nicht vom Aufrufer: Name und Typ der Liste, nicht aus der Anfrage.
        const eintrag = (await q.adapter.listeAnhaenge!(q.zugang, q.kopfId)).find((a) => a.id === anhangId);
        if (!eintrag) throw new Fachfehler(404, "ANHANG_NICHT_GEFUNDEN", "Diesen Anhang gibt es nicht (mehr).");
        if (eintrag.groesse > MAX_DOKUMENT) throw new Fachfehler(413, "DOKUMENT_ZU_GROSS", `Der Anhang ist größer als ${MAX_DOKUMENT / 1024 / 1024} MB.`);
        name = eintrag.name;
        bytes = await q.adapter.holeAnhang!(q.zugang, q.kopfId, anhangId, MAX_DOKUMENT);
      } catch (f) {
        return uebersetze(f);
      }
      const vorbereitet = await bereiteVor(opt.speicher, bytes, name);
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await verlangeZiele(tx, q.akteur, [ziel], "bearbeiter");
        const dubletten = await sichtbareDubletten(tx, q.akteur, vorbereitet.hash);
        if (dubletten[0]) throw new Fachfehler(409, "DOKUMENT_VORHANDEN", "Dieses Dokument gibt es schon.", { dokumentId: dubletten[0].id, dateiname: dubletten[0].dateiname });
        // Anhänge aus Mails sind vertraulich, bis jemand es ausdrücklich ändert.
        const d = await legeDokumentAn(tx, protokoll, { id: q.akteur.id, name: q.akteur.name }, vorbereitet, { klassifikation: "sonstiges", vertraulich: true, ziele: [ziel] });
        await protokoll("anhang_uebernehmen", "aktivitaet", id, null, { dokumentId: d.id, sha256: sha256(bytes) });
        return d;
      });
      return c.json({ dokumentId: neu.id, dateiname: neu.dateiname }, 201);
    });
}
