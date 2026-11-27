import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { formatBetrag, formatDatum, formatProzent, formatZahl, erzeugeBelegPdf, type BelegPdfDaten, type Sprache } from "@carraway/berichte";
import { benutzer, beleg, belegArt, belegArtEigen, belegBezugArt, belegNummernkreis, belegStatus, belegStufe, fonds, fondsBuchhaltung, type Beleg, type Db } from "@carraway/db";
import { enumWerte, katalogname, insDeutsche, insEnglische, istBelegfeld } from "../buchhaltung/abbildung";
import { buchhaltungsFehler } from "../buchhaltung/fehler";
import { aktuellerAkteur, hatRolle } from "../anmeldung/akteur";
import { sendeBerichtFreigegeben } from "../mail/benachrichtigung";
import { sha256, erstelleStandardSpeicher, type Speicher } from "../berichte/speicher";
import { KATALOG, fondsVonBezug, ladeBelegVorlage, ladeEigeneArt, pruefePflicht, setzeFeldwerte, sammleBelegdaten, type Belegdaten, type KatalogFeld, type Vorlage } from "../buchhaltung/belegfelder";
import { Fachfehler, fehlerAntwort } from "../fehler";
import { verlangeAnderenAkteur } from "../instrumente/bewertung";
import { pruefe } from "../pruefung";
import { fondsSichtbar } from "../rechte/sichtbarkeit";
import { idParam, optionalerText, protokolliereLesen, schreibe, textEingabe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";
import { aktiveFreigaben } from "./berichtsfreigabe";

/**
 * Belege (Etappe 14): aus Vorgang, Zinslauf, Verkauf, Wandlung oder Beteiligung vorbefüllt, mit Vorlage des Fonds, zwei Stufen
 * (Prüfung, Freigabe) durch zwei verschiedene Personen, beide verschieden vom Ersteller. Die Freigabe vergibt die Belegnummer
 * (lückenlos je Fonds, Zeile im Nummernkreis gesperrt), erzeugt das PDF und speichert es unveränderlich mit SHA-256.
 * Ein freigegebener Beleg lässt sich nur stornieren (Freigeber, mit Grund): Status `storniert`, Nummer und Datei bleiben, die Nummer bleibt
 * vergeben, und für denselben Vorfall darf danach ein neuer Beleg entstehen (je Art und Bezug höchstens ein nicht stornierter).
 */

export const BELEG_STUFEN = ["Prüfung", "Freigabe"] as const;

/** `art` ist die Basis-Art; bei einer eigenen Belegart (`eigeneArtId`) muss sie deren Basis-Art sein. */
const feldwerte = z.record(z.string().max(60).refine(istBelegfeld, "Unknown voucher field key"), z.string().max(2000).nullable());
const neuerBeleg = z.object({ type: z.enum(enumWerte(belegArt.enumValues)), customTypeId: z.uuid().optional(), values: feldwerte.optional(), referenceType: z.enum(enumWerte(belegBezugArt.enumValues)), referenceId: z.uuid(), language: z.enum(["de", "en"]).default("de") });
const listenAbfrage = z.object({ fundId: z.uuid().optional(), type: z.enum(enumWerte(belegArt.enumValues)).optional(), customTypeId: z.uuid().optional(), status: z.enum(enumWerte(belegStatus.enumValues)).optional() });
const stornoEingabe = z.object({ reason: textEingabe(500) });
const stufeEingabe = z.object({ stage: z.enum(enumWerte(BELEG_STUFEN)), result: z.enum(["ok", "returned"]), comment: optionalerText(2000) });

interface GespeicherteDaten {
  werte: Record<string, string | null>;
  mittelherkunft: Belegdaten["mittelherkunft"];
  datum: string;
  betrag: string | null;
}

/** Entwürfe und geprüfte Belege sind änderbar; freigegebene bleiben stehen, stornierte ebenso. */
function verlangeAenderbar(b: Beleg): void {
  if (b.status === "storniert") throw new Fachfehler(409, "voucher_reversed", "The voucher is reversed.", { status: b.status });
  if (b.status === "freigegeben") throw new Fachfehler(409, "voucher_status_invalid", "The voucher is already approved.", { status: b.status });
}

async function sperreBeleg(tx: Tx, id: string): Promise<Beleg> {
  const [b] = await tx.select().from(beleg).where(eq(beleg.id, id)).for("update");
  if (!b) throw new Fachfehler(404, "voucher_not_found", "Voucher not found.");
  return b;
}

const alsDaten = (d: Belegdaten): GespeicherteDaten => ({ werte: d.werte, mittelherkunft: d.mittelherkunft, datum: d.datum, betrag: d.betrag });

function formatWert(typ: KatalogFeld["typ"] | undefined, wert: string | null, sprache: Sprache, waehrung: string): string | null {
  if (wert === null || wert === "") return null;
  switch (typ) {
    case "betrag":
      return formatBetrag(wert, sprache, waehrung);
    case "datum":
      return formatDatum(wert, sprache);
    case "zahl":
      return formatZahl(wert, sprache);
    case "anteil":
      return formatProzent(wert, sprache);
    default:
      return wert;
  }
}

async function ladeNamen(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const zeilen = await tx.select({ id: benutzer.id, name: benutzer.name }).from(benutzer).where(inArray(benutzer.id, ids));
  return new Map(zeilen.map((z) => [z.id, z.name]));
}

/** Daten für das PDF eines Belegs aus dem festgehaltenen Stand (Vorlage und Daten des Belegs, nie die aktuelle Vorlage). */
async function pdfDaten(tx: Tx, b: Beleg, stufenZeilen: { stufe: string; akteur: string; am: Date; ergebnis: string }[], erzeugtAm: Date): Promise<BelegPdfDaten> {
  const vorlage = b.vorlage as Vorlage;
  const daten = b.daten as GespeicherteDaten;
  const sprache = b.sprache as Sprache;
  const eigeneArt = b.eigeneArtId ? (await tx.select().from(belegArtEigen).where(eq(belegArtEigen.id, b.eigeneArtId)))[0] : undefined;
  const [fz] = await tx.select({ name: fonds.name, kurzname: fonds.kurzname, waehrung: fonds.waehrung }).from(fonds).where(eq(fonds.id, b.fondsId));
  const katalog = new Map(KATALOG[b.art].map((k) => [k.schluessel, k]));
  const bezeichnung = (fe: Vorlage["felder"][number]) => (sprache === "de" ? fe.bezeichnungDe : fe.bezeichnungEn) ?? (sprache === "de" ? katalog.get(fe.schluessel)?.bezeichnungDe : katalog.get(fe.schluessel)?.bezeichnungEn) ?? fe.schluessel;
  const reihenfolge = [...vorlage.felder.filter((fe) => fe.abschnitt === "kopf"), ...vorlage.felder.filter((fe) => fe.abschnitt === "details")];
  const namen = await ladeNamen(tx, [...new Set(stufenZeilen.map((s) => s.akteur))]);
  // Erteilte Stufen: der letzte gültige `ok` je Stufe (eine Rückgabe nimmt die zuletzt erteilte zurück).
  const gueltig: typeof stufenZeilen = [];
  for (const s of stufenZeilen) {
    if (s.ergebnis === "ok") gueltig.push(s);
    else gueltig.pop();
  }
  return {
    fonds: { name: fz?.name ?? "", kurzname: fz?.kurzname ?? "" },
    art: b.art,
    artName: eigeneArt ? (sprache === "de" ? eigeneArt.bezeichnungDe : eigeneArt.bezeichnungEn) : undefined,
    sprache,
    belegnummer: b.belegnummer,
    datum: daten.datum,
    betrag: daten.betrag,
    waehrung: fz?.waehrung ?? "EUR",
    kopftext: sprache === "de" ? vorlage.kopfDe : vorlage.kopfEn,
    fusstext: sprache === "de" ? vorlage.fussDe : vorlage.fussEn,
    felder: reihenfolge.map((fe) => ({ bezeichnung: bezeichnung(fe), wert: formatWert(fe.manuell ?? katalog.get(fe.schluessel)?.typ, daten.werte[fe.schluessel] ?? null, sprache, fz?.waehrung ?? "EUR"), abschnitt: fe.abschnitt })),
    mittelherkunft: daten.mittelherkunft.map((m) => ({ bezeichnung: sprache === "de" ? m.bezeichnungDe : m.bezeichnungEn, quote: m.quote, betrag: m.betrag })),
    stufen: gueltig.map((s) => ({ stufe: s.stufe, person: namen.get(s.akteur) ?? s.akteur, am: s.am.toISOString() })),
    erzeugtAm: erzeugtAm.toISOString(),
  };
}

/** Nächste Belegnummer des Fonds: Zeile im Nummernkreis gesperrt, in derselben Transaktion fortgeschrieben (lückenlos). */
async function naechsteNummer(tx: Tx, fondsId: string): Promise<{ lfd: number; nummer: string }> {
  await tx.insert(belegNummernkreis).values({ fondsId }).onConflictDoNothing();
  const [kreis] = await tx.select().from(belegNummernkreis).where(eq(belegNummernkreis.fondsId, fondsId)).for("update");
  const lfd = kreis!.letzte + 1;
  await tx.update(belegNummernkreis).set({ letzte: lfd }).where(eq(belegNummernkreis.fondsId, fondsId));
  const [k] = await tx.select({ praefix: fondsBuchhaltung.belegpraefix }).from(fondsBuchhaltung).where(eq(fondsBuchhaltung.fondsId, fondsId));
  const praefix = k?.praefix ?? "B";
  return { lfd, nummer: `${praefix ? `${praefix}-` : ""}${String(lfd).padStart(6, "0")}` };
}

async function ladeDetail(tx: Tx, b: Beleg) {
  const stufen = await tx.select().from(belegStufe).where(eq(belegStufe.belegId, b.id)).orderBy(asc(belegStufe.am), asc(belegStufe.id));
  const aktiv = aktiveFreigaben(stufen);
  const [eigeneArt] = b.eigeneArtId ? await tx.select({ de: belegArtEigen.bezeichnungDe, en: belegArtEigen.bezeichnungEn }).from(belegArtEigen).where(eq(belegArtEigen.id, b.eigeneArtId)) : [];
  return { ...b, artNameDe: eigeneArt?.de ?? null, artNameEn: eigeneArt?.en ?? null, stufen: [...BELEG_STUFEN], protokoll: stufen, naechsteStufeName: b.status === "freigegeben" || b.status === "storniert" ? null : (BELEG_STUFEN[aktiv.length] ?? null) };
}

export function belegRouten(db: Db, speicher: Speicher = erstelleStandardSpeicher()) {
  return new Hono().onError(buchhaltungsFehler)
    /** Erzeugt einen Beleg als Entwurf, vorbefüllt aus den Geschäftsdaten; fehlende Pflichtfelder stehen in `befunde`. */
    .post("/", pruefe("json", neuerBeleg), async (c) => {
      const e = insDeutsche(c.req.valid("json"));
      const akteur = aktuellerAkteur(c);
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        // Erst der Fonds des Bezugs und die Rolle, dann der Inhalt: Ein fremder oder fehlender Datensatz antwortet gleich (404).
        const bezugFonds = await fondsVonBezug(tx, e.bezugArt, e.bezugId);
        if (bezugFonds === null || !hatRolle(akteur, bezugFonds, "bearbeiter")) throw new Fachfehler(404, "voucher_reference_not_found", "The event the voucher should refer to was not found.");
        if (e.art === "frei" && !e.eigeneArtId) throw new Fachfehler(400, "invalid_input", "A free voucher requires a custom voucher type.");
        const eigeneArt = e.eigeneArtId ? await ladeEigeneArt(tx, bezugFonds, e.eigeneArtId) : null;
        if (e.eigeneArtId) {
          if (!eigeneArt) throw new Fachfehler(404, "voucher_type_not_found", "The voucher type does not exist in this fund.");
          if (eigeneArt.basisArt !== e.art) throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: "art", code: "mismatch", meldung: "The type must be the base type of the custom voucher type" }] });
          if (!eigeneArt.aktiv) throw new Fachfehler(409, "voucher_type_retired", "The voucher type is retired.", { eigeneArtId: eigeneArt.id });
        }
        const daten = await sammleBelegdaten(tx, e.art, e.bezugArt, e.bezugId);
        const [vorhanden] = await tx
          .select({ id: beleg.id })
          .from(beleg)
          .where(and(eigeneArt ? eq(beleg.eigeneArtId, eigeneArt.id) : and(eq(beleg.art, e.art), isNull(beleg.eigeneArtId)), eq(beleg.bezugArt, e.bezugArt), eq(beleg.bezugId, e.bezugId), isNull(beleg.stornoAm)));
        if (vorhanden) throw new Fachfehler(409, "voucher_exists", "A voucher already exists for this event.", { belegId: vorhanden.id });
        const { vorlage } = await ladeBelegVorlage(tx, daten.fondsId, e.art, eigeneArt?.id ?? null);
        setzeFeldwerte(vorlage, daten.werte, e.werte ?? {});
        const befunde = pruefePflicht(vorlage, daten.werte);
        const [b] = await tx
          .insert(beleg)
          .values({ fondsId: daten.fondsId, art: e.art, eigeneArtId: eigeneArt?.id ?? null, bezugArt: e.bezugArt, bezugId: e.bezugId, beteiligungId: daten.beteiligungId, sprache: e.sprache, vorlage, daten: alsDaten(daten), befunde, erstelltVon: protokoll.akteur })
          .returning();
        await protokoll("anlegen", "beleg", b!.id, null, { id: b!.id, art: e.art, eigeneArtId: eigeneArt?.id ?? null, bezugArt: e.bezugArt, bezugId: e.bezugId, fondsId: daten.fondsId, befunde });
        return b!;
      });
      return c.json(insEnglische(neu), 201);
    })
    .get("/", pruefe("query", listenAbfrage), async (c) => {
      const { fondsId, art, eigeneArtId, status } = insDeutsche(c.req.valid("query"));
      const daten = await lese(db, (tx) =>
        tx
          .select({ id: beleg.id, fondsId: beleg.fondsId, art: beleg.art, eigeneArtId: beleg.eigeneArtId, artNameDe: belegArtEigen.bezeichnungDe, artNameEn: belegArtEigen.bezeichnungEn, bezugArt: beleg.bezugArt, bezugId: beleg.bezugId, beteiligungId: beleg.beteiligungId, sprache: beleg.sprache, status: beleg.status, belegnummer: beleg.belegnummer, befunde: beleg.befunde, naechsteStufe: beleg.naechsteStufe, erstelltVon: beleg.erstelltVon, erstelltAm: beleg.erstelltAm, freigegebenAm: beleg.freigegebenAm, stornoAm: beleg.stornoAm, stornoGrund: beleg.stornoGrund, betrag: sql<string | null>`${beleg.daten}->>'betrag'`, datum: sql<string | null>`${beleg.daten}->>'datum'` })
          .from(beleg)
          .leftJoin(belegArtEigen, eq(belegArtEigen.id, beleg.eigeneArtId))
          .where(and(fondsSichtbar(c, beleg.fondsId), fondsId ? eq(beleg.fondsId, fondsId) : undefined, art ? eq(beleg.art, art) : undefined, eigeneArtId ? eq(beleg.eigeneArtId, eigeneArtId) : undefined, status ? eq(beleg.status, status) : undefined))
          .orderBy(desc(beleg.erstelltAm), asc(beleg.id)),
      );
      return c.json(insEnglische({ daten }), 200);
    })
    .get("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const detail = await lese(db, async (tx) => {
        const [b] = await tx.select().from(beleg).where(eq(beleg.id, id));
        return b ? ladeDetail(tx, b) : null;
      });
      if (!detail) return fehlerAntwort(c, 404, "voucher_not_found", "Voucher not found.");
      return c.json(insEnglische(detail), 200);
    })
    .patch("/:id/field-values", pruefe("param", idParam), pruefe("json", z.object({ values: feldwerte.refine((w) => Object.keys(w).length > 0) })), async (c) => {
      const { id } = c.req.valid("param");
      const { werte } = insDeutsche(c.req.valid("json"));
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await sperreBeleg(tx, id);
        verlangeAenderbar(vorher);
        if (vorher.status !== "entwurf") throw new Fachfehler(409, "voucher_status_invalid", "Field values can only be changed in draft.");
        const vorlage = vorher.vorlage as Vorlage;
        const alt = vorher.daten as GespeicherteDaten;
        const daten = { ...alt, werte: { ...alt.werte } };
        setzeFeldwerte(vorlage, daten.werte, werte);
        const befunde = pruefePflicht(vorlage, daten.werte);
        const [belegNeu] = await tx.update(beleg).set({ daten, befunde, erstelltVon: protokoll.akteur }).where(eq(beleg.id, id)).returning();
        await protokoll("aendern", "beleg", id, vorher, belegNeu);
        return belegNeu!;
      });
      return c.json(insEnglische(neu), 200);
    })
    /** Befüllt einen Entwurf neu aus den aktuellen Geschäftsdaten und der aktuellen Vorlage; wer das tut, wird Urheber, erteilte Stufen entfallen. */
    .post("/:id/refill", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await sperreBeleg(tx, id);
        verlangeAenderbar(vorher);
        const daten = await sammleBelegdaten(tx, vorher.art, vorher.bezugArt, vorher.bezugId);
        const { vorlage } = await ladeBelegVorlage(tx, vorher.fondsId, vorher.art, vorher.eigeneArtId);
        const alteFelder = new Map((vorher.vorlage as Vorlage).felder.map((f) => [f.schluessel, f.manuell]));
        const alteWerte = (vorher.daten as GespeicherteDaten).werte;
        for (const f of vorlage.felder) {
          if (f.manuell && alteFelder.get(f.schluessel) === f.manuell) daten.werte[f.schluessel] = alteWerte[f.schluessel] ?? null;
        }
        const befunde = pruefePflicht(vorlage, daten.werte);
        const log = await tx.select().from(belegStufe).where(eq(belegStufe.belegId, id)).orderBy(asc(belegStufe.am), asc(belegStufe.id));
        // Erteilte Stufen nehmen wir mit einer Rückgabe je Stufe zurück (das Protokoll bleibt nur anhängend).
        for (let i = aktiveFreigaben(log).length - 1; i >= 0; i--) {
          await tx.insert(belegStufe).values({ belegId: id, stufeIndex: i, stufe: BELEG_STUFEN[i]!, ergebnis: "zurueck", kommentar: "Daten neu befüllt", akteur: protokoll.akteur });
        }
        const [neu] = await tx.update(beleg).set({ vorlage, daten: alsDaten(daten), befunde, naechsteStufe: 0, status: "entwurf", beteiligungId: daten.beteiligungId, erstelltVon: protokoll.akteur }).where(eq(beleg.id, id)).returning();
        await protokoll("neu_befuellen", "beleg", id, vorher, neu);
        return neu!;
      });
      return c.json(insEnglische(nachher), 200);
    })
    .get("/:id/file", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const ergebnis = await lese(db, async (tx) => {
        const [b] = await tx.select().from(beleg).where(eq(beleg.id, id));
        if (!b) return null;
        if ((b.status === "freigegeben" || b.status === "storniert") && b.dateiSchluessel && b.dateiSha256 && b.dateiName) {
          const bytes = await speicher.lese(b.dateiSchluessel);
          if (sha256(bytes) !== b.dateiSha256) throw new Fachfehler(500, "file_corrupt", "The stored file no longer matches its hash.");
          return { bytes, name: b.dateiName, hash: b.dateiSha256 };
        }
        const log = await tx.select().from(belegStufe).where(eq(belegStufe.belegId, id)).orderBy(asc(belegStufe.am), asc(belegStufe.id));
        const bytes = erzeugeBelegPdf(await pdfDaten(tx, b, log, new Date()), { entwurf: true });
        return { bytes, name: `beleg-entwurf-${b.id.slice(0, 8)}.pdf`, hash: null };
      });
      if (!ergebnis) return fehlerAntwort(c, 404, "voucher_not_found", "Voucher not found.");
      await protokolliereLesen(db, c, "beleg", id, { beleg: "datei", freigegeben: ergebnis.hash !== null, dateiName: ergebnis.name, sha256: ergebnis.hash });
      return c.body(Buffer.from(ergebnis.bytes), 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${ergebnis.name}"`,
        "Cache-Control": "no-store",
        ...(ergebnis.hash ? { "X-File-Sha256": ergebnis.hash } : {}),
      });
    })
    /** Storniert einen freigegebenen Beleg (Freigeber, Grund ist Pflicht): Nummer und Datei bleiben, ein neuer Beleg für den Vorfall ist danach möglich. */
    .post("/:id/reverse", pruefe("param", idParam), pruefe("json", stornoEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const { grund } = insDeutsche(c.req.valid("json"));
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await sperreBeleg(tx, id);
        if (vorher.status === "storniert") throw new Fachfehler(409, "voucher_reversed", "The voucher is already reversed.", { status: vorher.status });
        if (vorher.status !== "freigegeben") throw new Fachfehler(409, "voucher_not_approved", "Only an approved voucher can be reversed.", { status: vorher.status });
        const [neu] = await tx.update(beleg).set({ status: "storniert", stornoAm: new Date(), stornoVon: protokoll.akteur, stornoGrund: grund }).where(eq(beleg.id, id)).returning();
        await protokoll("stornieren", "beleg", id, vorher, neu);
        return neu!;
      });
      return c.json(insEnglische(nachher), 200);
    })
    /** Stufe `ok` oder `zurueck`. Die Freigabe (zweite Stufe) vergibt die Belegnummer und speichert das PDF. */
    .post("/:id/stage", pruefe("param", idParam), pruefe("json", stufeEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const e = insDeutsche(c.req.valid("json"));
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await sperreBeleg(tx, id);
        verlangeAenderbar(vorher);
        const log = await tx.select().from(belegStufe).where(eq(belegStufe.belegId, id)).orderBy(asc(belegStufe.am), asc(belegStufe.id));
        const aktiv = aktiveFreigaben(log);
        const index = aktiv.length;
        if (e.stufe !== BELEG_STUFEN[index]) throw new Fachfehler(409, "voucher_stage_wrong", "This is not the next stage.", { erwartet: BELEG_STUFEN[index] ?? null, stufe: e.stufe });
        const fehlerhaft = (feld: string, code: string, meldung: string) => new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld, code, meldung }] });

        if (e.ergebnis === "zurueck") {
          if (!e.kommentar?.trim()) throw fehlerhaft("kommentar", "comment_required", "A comment is required for returning");
          await tx.insert(belegStufe).values({ belegId: id, stufeIndex: index, stufe: e.stufe, ergebnis: "zurueck", kommentar: e.kommentar, akteur: protokoll.akteur });
          const rest = Math.max(0, index - 1);
          const [neu] = await tx.update(beleg).set({ naechsteStufe: rest, status: rest === 0 ? "entwurf" : "geprueft" }).where(eq(beleg.id, id)).returning();
          await protokoll("zurueckgeben", "beleg", id, vorher, neu);
          return neu!;
        }

        verlangeAnderenAkteur(vorher.erstelltVon, protokoll.akteur);
        if (aktiv.includes(protokoll.akteur)) throw new Fachfehler(409, "four_eyes_violated", "Each stage requires a different person than the stages already given.");
        const befunde = vorher.befunde as { feld: string; code: string }[];
        if (befunde.length > 0) throw new Fachfehler(409, "voucher_required_field_missing", "Required fields are missing; add the details and refill the voucher.", { missingFields: befunde.map((b) => katalogname(b.feld, true)) });

        if (index < BELEG_STUFEN.length - 1) {
          await tx.insert(belegStufe).values({ belegId: id, stufeIndex: index, stufe: e.stufe, ergebnis: "ok", kommentar: e.kommentar ?? null, akteur: protokoll.akteur });
          const [neu] = await tx.update(beleg).set({ naechsteStufe: index + 1, status: "geprueft" }).where(eq(beleg.id, id)).returning();
          await protokoll("pruefen", "beleg", id, vorher, neu);
          return neu!;
        }

        // Letzte Stufe: Belegnummer (Zeile im Nummernkreis gesperrt), PDF ohne Wasserzeichen, unveränderlich speichern.
        const { lfd, nummer } = await naechsteNummer(tx, vorher.fondsId);
        const jetzt = new Date();
        await tx.insert(belegStufe).values({ belegId: id, stufeIndex: index, stufe: e.stufe, ergebnis: "ok", kommentar: e.kommentar ?? null, akteur: protokoll.akteur, am: jetzt });
        const log2 = [...log, { stufe: e.stufe, akteur: protokoll.akteur, am: jetzt, ergebnis: "ok" }];
        const pdf = erzeugeBelegPdf(await pdfDaten(tx, { ...vorher, belegnummer: nummer }, log2, jetzt), { entwurf: false });
        const hash = sha256(pdf);
        const schluessel = `belege/${id}/${hash}.pdf`;
        await speicher.schreibe(schluessel, pdf);
        const [neu] = await tx
          .update(beleg)
          .set({ status: "freigegeben", naechsteStufe: BELEG_STUFEN.length, belegnummer: nummer, belegnummerLfd: lfd, freigegebenAm: jetzt, dateiName: `beleg-${nummer}.pdf`, dateiSchluessel: schluessel, dateiSha256: hash, dateiGroesse: pdf.length })
          .where(eq(beleg.id, id))
          .returning();
        await protokoll("freigeben", "beleg", id, vorher, neu);
        // Interne Hinweise nur an Personen mit Opt-in, wie bei Berichten und Meldungen (Etappe 17); ohne Mailversand bleibt die Freigabe unberührt.
        const [fondsZeile] = await tx.select({ name: fonds.name }).from(fonds).where(eq(fonds.id, vorher.fondsId));
        await sendeBerichtFreigegeben(tx, protokoll, c.get("mail"), { berichtId: id, bericht: "beleg", fondsId: vorher.fondsId, fondsName: fondsZeile?.name ?? null, linkPfad: `/vouchers/${id}`, bezugArt: "beleg" });
        return neu!;
      });
      return c.json(insEnglische(nachher), 200);
    });
}
