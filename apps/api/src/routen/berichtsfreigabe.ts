import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { FREITEXT_SCHLUESSEL, pruefeKonfiguration } from "@carraway/berichte";
import { aenderung, bericht, berichtAbschnitt, berichtArt, berichtFreigabe, beteiligung, fonds, type Bericht, type Db } from "@carraway/db";
import { ladeSzenarien, type SzenarioZeile } from "../szenarien/dienst";
import { holeVariantenNach, speichereFassungen } from "../berichte/varianten";
import { dateiSchluessel, erstelleStandardSpeicher, sha256, type Speicher } from "../berichte/speicher";
import { erzeugeBerichtDatei, formateVon } from "../berichte/erzeugen";
import { berichtsartAusErweiterung } from "../berichte/arten";
import { kontrolliereBericht } from "../berichte/kontrolle";
import { ladeFreigabestufen, ladeVorlage } from "../berichte/vorlagen";
import { pruefeSichtEingabe, SICHT_ARTEN, sichtEingabe, sichtParameter, sichtWahl } from "../berichte/sicht";
import { Fachfehler, fehlerAntwort } from "../fehler";
import { sendeBerichtFreigegeben } from "../mail/benachrichtigung";
import { pruefeStichtag } from "../instrumente/stichtag";
import { standardStichtag } from "../kennzahlen/fonds";
import { verlangeAnderenAkteur } from "../instrumente/bewertung";
import { geaendertSeitBedingung, geaendertSeitEingabe } from "../geaendert";
import { pruefe } from "../pruefung";
import { heute, idParam, optionalerText, protokolliereLesen, schreibe, textEingabe } from "../schreiben";
import { fondsSichtbar } from "../rechte/sichtbarkeit";
import { lese, type Tx } from "../zeitlimit";

/**
 * Berichte mit Freigabe in Stufen (Etappe 5). Mount unter `/berichte`, nach den festen Pfaden der alten Download-Routen
 * (`/berichte/gremienvorlage`), damit `/:id` sie nicht verschluckt. Die Stufen heißen je Fonds (Standard: Investmentmanager,
 * Teamleitung, Geschäftsführung), jede verlangt eine andere angemeldete Person als Ersteller, alle bisherigen Bearbeiter der Abschnitte
 * und die bereits erteilten Freigaben. Mit der letzten Stufe wird die Datei ohne Wasserzeichen erzeugt, `stand` festgehalten und die Datei unveränderlich
 * gespeichert; Downloads liefern danach genau diese Bytes (Hash geprüft).
 */

const neuerBericht = z.object({
  art: z.enum(berichtArt.enumValues),
  format: z.enum(["pdf", "xlsx"]).optional(),
  fondsId: z.uuid().optional(),
  beteiligungId: z.uuid().optional(),
  stichtag: z.iso.date().optional(),
  sprache: z.enum(["de", "en"]).default("de"),
  /** Gewünschter Wissensstand (Bericht zu einem früheren Stand neu erzeugen); ohne Angabe gilt der Zeitpunkt der Freigabe. */
  stand: z.iso.datetime({ offset: true }).optional(),
  /** Nur Arten, die es erlauben (PAI-Erklärung der Erweiterung ESG): Texte aus der zuletzt freigegebenen Fassung des Fonds als Entwurf übernehmen. */
  texteAusVorjahr: z.boolean().optional(),
  /** Nur Szenariobericht: ein bis drei festgeschriebene Szenarien des Fonds, in dieser Reihenfolge. */
  szenarioIds: z.array(z.uuid()).min(1).max(3).optional(),
  /** Währungssicht der Listenberichte (Fondsbericht, LP-Bericht, Portfolioliste, Exitliste): Fondswährung (Standard), lokal je Beteiligung oder Vergleich in `vergleichswaehrung`. */
  ...sichtEingabe,
});
const listenAbfrage = z.object({ fondsId: z.uuid().optional(), art: z.enum(berichtArt.enumValues).optional(), status: z.enum(["entwurf", "geprueft", "freigegeben"]).optional(), geaendertSeit: geaendertSeitEingabe });
const stufeEingabe = z.object({
  stufe: textEingabe(100),
  ergebnis: z.enum(["ok", "zurueck"]),
  kommentar: optionalerText(2000),
  /** Nur in der letzten Stufe: Freigabe trotz roter Kontrolle, mit Begründung (wird protokolliert). */
  kontrolleUeberschreiben: z.object({ grund: textEingabe(1000) }).optional(),
});
const abschnittParam = z.object({ id: z.uuid(), schluessel: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/) });
const abschnittEingabe = z
  .object({ textDe: z.string().max(20000).optional(), textEn: z.string().max(20000).optional() })
  .refine((w) => w.textDe !== undefined || w.textEn !== undefined, { message: "Mindestens ein Text muss angegeben werden", path: [] });

/**
 * Wissensstand „jetzt“. Zeitstempel in der Datenbank haben Mikrosekunden, `Date` nur Millisekunden: eine Zeile, die in derselben
 * Millisekunde geschrieben wurde, läge sonst knapp nach dem Stand. Deshalb eine Millisekunde aufrunden.
 */
const jetzt = () => new Date(Date.now() + 1);

async function sperreBericht(tx: Tx, id: string): Promise<Bericht> {
  const [b] = await tx.select().from(bericht).where(eq(bericht.id, id)).for("update");
  if (!b) throw new Fachfehler(404, "BERICHT_NICHT_GEFUNDEN", "Bericht nicht gefunden.");
  return b;
}

/**
 * Alle Personen, die je einen Abschnitt des Berichts geändert haben (nicht nur der letzte Bearbeiter): Grundlage ist das
 * nur anhängende Änderungsprotokoll, in dem jede Änderung eines Abschnitts mit ihrem Akteur steht. Wer einen Abschnitt
 * angelegt oder geändert hat, darf den Bericht nicht freigeben, auch wenn später jemand anderes den Text überschrieben hat.
 */
export async function bisherigeBearbeiter(tx: Tx, berichtId: string): Promise<Set<string>> {
  const zeilen = await tx
    .selectDistinct({ akteur: aenderung.akteur })
    .from(aenderung)
    .where(
      and(
        eq(aenderung.tabelle, "bericht_abschnitt"),
        inArray(aenderung.datensatzId, tx.select({ id: berichtAbschnitt.id }).from(berichtAbschnitt).where(eq(berichtAbschnitt.berichtId, berichtId))),
      ),
    );
  const bearbeiter = new Set(zeilen.map((z) => z.akteur));
  // Absicherung: auch der in der Zeile selbst festgehaltene letzte Bearbeiter zählt.
  const aktuell = await tx.select({ von: berichtAbschnitt.geaendertVon }).from(berichtAbschnitt).where(eq(berichtAbschnitt.berichtId, berichtId));
  for (const a of aktuell) bearbeiter.add(a.von);
  return bearbeiter;
}

/** Gültige Freigaben nach Wiedergabe des Protokolls: ein `ok` fügt hinzu, ein `zurueck` nimmt die zuletzt erteilte zurück. */
export function aktiveFreigaben(protokoll: { ergebnis: string; akteur: string }[]): string[] {
  const aktiv: string[] = [];
  for (const p of protokoll) {
    if (p.ergebnis === "ok") aktiv.push(p.akteur);
    else aktiv.pop();
  }
  return aktiv;
}

async function nachfassungId(tx: Tx, id: string) {
  const [nachfolger] = await tx.select({ id: bericht.id }).from(bericht).where(eq(bericht.vorfassungId, id));
  return nachfolger?.id ?? null;
}

async function ladeDetail(tx: Tx, b: Bericht) {
  const protokoll = await tx.select().from(berichtFreigabe).where(eq(berichtFreigabe.berichtId, b.id)).orderBy(asc(berichtFreigabe.am), asc(berichtFreigabe.id));
  const abschnitte = await tx.select().from(berichtAbschnitt).where(eq(berichtAbschnitt.berichtId, b.id)).orderBy(asc(berichtAbschnitt.schluessel));
  const stufen = b.freigabestufen as string[];
  return { ...b, nachfassungId: b.status === "freigegeben" ? await nachfassungId(tx, b.id) : null, protokoll, abschnitte, naechsteStufeName: b.status === "freigegeben" ? null : (stufen[b.naechsteStufe] ?? null) };
}

export function berichtFreigabeRouten(db: Db, speicher: Speicher = erstelleStandardSpeicher()) {
  return new Hono()
    /**
     * Nur globale Verwalter: legt die Fassungen je Investor für LP-Berichte an, die vor den Fassungen freigegeben wurden. Die Daten sind die des festgehaltenen
     * Wissensstands und werden gegen die gespeicherte Hauptdatei geprüft; wiederholbar, unveränderlich gespeichert (SHA-256), protokolliert.
     */
    .post("/varianten-nachholen", pruefe("json", z.object({ berichtId: z.uuid().optional() })), async (c) => {
      const { berichtId } = c.req.valid("json");
      return c.json(await holeVariantenNach(db, c, speicher, berichtId ? { berichtId } : {}), 200);
    })
    /** Legt einen Bericht als Entwurf an (Art, Bezug, Stichtag, Sprache, optional Wissensstand). */
    .post("/", pruefe("json", neuerBericht), async (c) => {
      const e = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const format = e.format ?? "pdf";
        const fehlerhaft = (feld: string, code: string, meldung: string) =>
          new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder: [{ feld, code, meldung }] });
        const formate = formateVon(e.art);
        if (!formate) throw fehlerhaft("art", "art_nicht_verfuegbar", `Die Art ${e.art} gibt es in dieser Installation nicht`);
        if (!formate.includes(format)) throw fehlerhaft("format", "format_nicht_moeglich", `Die Art ${e.art} gibt es nur als ${formate.join(" oder ")}`);
        const erweiterung = berichtsartAusErweiterung(e.art);
        let fondsId = e.fondsId ?? null;
        let beteiligungId: string | null = null;
        if (e.art === "quartalsbericht") {
          if (!e.beteiligungId) throw fehlerhaft("beteiligungId", "erforderlich", "Der Quartalsbericht braucht eine Beteiligung");
          const [b] = await tx.select().from(beteiligung).where(eq(beteiligung.id, e.beteiligungId));
          if (!b) throw new Fachfehler(404, "BETEILIGUNG_NICHT_GEFUNDEN", "Beteiligung nicht gefunden.");
          beteiligungId = b.id;
          fondsId = b.fondsId;
        } else {
          if (!fondsId) throw fehlerhaft("fondsId", "erforderlich", "Diese Berichtsart braucht einen Fonds");
          const [f] = await tx.select({ id: fonds.id }).from(fonds).where(eq(fonds.id, fondsId));
          if (!f) throw new Fachfehler(404, "FONDS_NICHT_GEFUNDEN", "Fonds nicht gefunden.");
        }
        // Arten aus Erweiterungen geben Vorgabe und Prüfung des Stichtags selbst vor (PAI-Erklärung: der 31.12. des letzten abgeschlossenen Jahres).
        // Szenariobericht: nur festgeschriebene Szenarien dieses Fonds; ihr Ergebnis ist gespeichert und unveränderlich, die Auswahl wird mit dem Bericht festgehalten.
        let szenarien: SzenarioZeile[] = [];
        if (e.art === "szenariobericht") {
          const ids = e.szenarioIds ?? [];
          if (ids.length === 0 || new Set(ids).size !== ids.length) throw fehlerhaft("szenarioIds", "erforderlich", "Der Szenariobericht braucht ein bis drei verschiedene Szenarien");
          szenarien = await ladeSzenarien(tx, fondsId!, ids);
          if (szenarien.length !== ids.length) throw new Fachfehler(404, "SZENARIO_NICHT_GEFUNDEN", "Szenario nicht gefunden.");
          if (szenarien.some((z) => z.status !== "festgeschrieben")) throw new Fachfehler(409, "SZENARIO_NICHT_FESTGESCHRIEBEN", "Ein Szenarienbericht lässt sich nur mit festgeschriebenen Szenarien freigeben.");
        } else if (e.szenarioIds) throw fehlerhaft("szenarioIds", "nur_szenariobericht", "Szenarien gibt es nur beim Szenariobericht");
        const sichtFehler = pruefeSichtEingabe(e);
        if (sichtFehler) throw fehlerhaft(sichtFehler.feld, sichtFehler.code, sichtFehler.meldung);
        const wahl = sichtWahl(e);
        if (wahl.sicht !== "fonds" && !SICHT_ARTEN.includes(e.art)) throw fehlerhaft("waehrungssicht", "sicht_nicht_moeglich", "Die Währungssicht gibt es nur bei Fondsbericht, LP-Bericht, Portfolioliste und Exitliste");
        const stichtag = e.stichtag ?? (e.art === "szenariobericht" ? [...szenarien.map((z) => z.basisStichtag)].sort().at(-1)! : e.art === "gremienvorlage" ? heute() : erweiterung?.anlage?.standardStichtag ? erweiterung.anlage.standardStichtag(heute()) : await standardStichtag(tx, fondsId!, e.stand));
        const stichtagFehler = erweiterung?.anlage?.pruefeStichtag?.(stichtag);
        if (stichtagFehler) throw fehlerhaft("stichtag", stichtagFehler.code, stichtagFehler.meldung);
        if (e.art !== "gremienvorlage" && e.art !== "szenariobericht") await pruefeStichtag(tx, fondsId!, stichtag);
        const vorjahr = erweiterung?.anlage?.texteAusVorjahr;
        if (e.texteAusVorjahr && !vorjahr) throw fehlerhaft("texteAusVorjahr", "nur_pai", "Texte aus dem Vorjahr gibt es nur bei der PAI-Erklärung");
        if (e.stand && new Date(e.stand).getTime() > Date.now()) throw fehlerhaft("stand", "stand_in_zukunft", "Der Wissensstand darf nicht in der Zukunft liegen");
        const stufen = await ladeFreigabestufen(tx, fondsId!);
        const konfiguration = await ladeVorlage(tx, fondsId!, e.art);
        const [neu] = await tx
          .insert(bericht)
          .values({
            art: e.art,
            format,
            fondsId,
            beteiligungId,
            stichtag,
            sprache: e.sprache,
            standVorgabe: e.stand ? new Date(e.stand) : null,
            freigabestufen: stufen,
            konfiguration,
            // Arten aus Erweiterungen halten ihre Parameter fest (PAI-Erklärung: die Version des Indikatorkatalogs, mit der sie rechnet).
            ...(erweiterung?.anlage?.parameter ? { parameter: erweiterung.anlage.parameter() } : {}),
            ...(e.art === "szenariobericht" ? { parameter: { szenarioIds: e.szenarioIds } } : {}),
            ...(wahl.sicht !== "fonds" ? { parameter: sichtParameter(wahl) } : {}),
            erstelltVon: protokoll.akteur,
          })
          .returning();
        if (!neu) throw new Error("Bericht nicht angelegt");
        await protokoll("anlegen", "bericht", neu.id, null, neu);
        let uebernommenAus: string | null = null;
        if (e.texteAusVorjahr && vorjahr) {
          // Die letzte freigegebene Fassung derselben Art im Fonds mit früherem Stichtag; ihre Texte gelten als Entwurf, bis sie hier freigegeben werden.
          const [quellbericht] = await tx
            .select()
            .from(bericht)
            .where(and(eq(bericht.art, e.art), eq(bericht.fondsId, fondsId!), eq(bericht.status, "freigegeben"), lt(bericht.stichtag, stichtag)))
            .orderBy(desc(bericht.stichtag), desc(bericht.erzeugtAm))
            .limit(1);
          if (!quellbericht) throw new Fachfehler(409, vorjahr.fehlerCode, vorjahr.meldung);
          const erlaubt: readonly string[] = erweiterung?.freitexte?.schluessel() ?? [];
          const quelle = (await tx.select().from(berichtAbschnitt).where(eq(berichtAbschnitt.berichtId, quellbericht.id))).filter((a) => erlaubt.includes(a.schluessel) && (a.textDe !== "" || a.textEn !== ""));
          if (quelle.length > 0) {
            await tx.insert(berichtAbschnitt).values(quelle.map((a) => ({ berichtId: neu.id, schluessel: a.schluessel, textDe: a.textDe, textEn: a.textEn, status: "entwurf" as const, geaendertVon: protokoll.akteur })));
          }
          uebernommenAus = quellbericht.id;
          await protokoll("uebernehmen", "bericht", neu.id, null, { quelleBerichtId: quellbericht.id, quelleStichtag: quellbericht.stichtag, abschnitte: quelle.map((a) => a.schluessel) });
        }
        return { ...neu, texteUebernommenAus: uebernommenAus };
      });
      return c.json(ergebnis, 201);
    })
    .post("/:id/berichtigung", pruefe("param", idParam), pruefe("json", z.object({ grund: textEingabe(1000) })), async (c) => {
      const { id } = c.req.valid("param");
      const { grund } = c.req.valid("json");
      const entwurf = await schreibe(db, c, async (tx, protokoll) => {
        const vor = await sperreBericht(tx, id);
        if (vor.status !== "freigegeben") throw new Fachfehler(409, "VORFASSUNG_NICHT_FREIGEGEBEN", "Eine Berichtigung setzt eine freigegebene Fassung voraus.");
        if (await nachfassungId(tx, id)) throw new Fachfehler(409, "BERICHTIGUNG_VORHANDEN", "Zu dieser Fassung gibt es bereits eine Berichtigung.");
        const fondsId = vor.fondsId ?? (await tx.select({ id: beteiligung.fondsId }).from(beteiligung).where(eq(beteiligung.id, vor.beteiligungId!)))[0]!.id;
        const [neu] = await tx.insert(bericht).values({
          vorfassungId: vor.id,
          berichtigungsgrund: grund,
          art: vor.art,
          format: vor.format,
          fondsId,
          beteiligungId: vor.beteiligungId,
          stichtag: vor.stichtag,
          sprache: vor.sprache,
          parameter: vor.parameter,
          konfiguration: vor.konfiguration,
          freigabestufen: await ladeFreigabestufen(tx, fondsId),
          erstelltVon: protokoll.akteur,
        }).returning();
        if (!neu) throw new Error("Berichtigung nicht angelegt");
        await protokoll("anlegen", "bericht", neu.id, null, neu);
        const texte = await tx.select().from(berichtAbschnitt).where(eq(berichtAbschnitt.berichtId, id));
        if (texte.length) {
          const kopien = await tx.insert(berichtAbschnitt).values(texte.map(({ schluessel, textDe, textEn }) => ({
            berichtId: neu.id, schluessel, textDe, textEn, geaendertVon: protokoll.akteur,
          }))).returning();
          await protokoll.mehrere(kopien.map((a) => ({ aktion: "anlegen", tabelle: "bericht_abschnitt", datensatzId: a.id, nachher: a })));
        }
        return neu;
      });
      return c.json(entwurf, 201);
    })
    .get("/", pruefe("query", listenAbfrage), async (c) => {
      const { fondsId, art, status, geaendertSeit } = c.req.valid("query");
      const daten = await lese(db, (tx) =>
        tx
          .select()
          .from(bericht)
          .where(and(fondsSichtbar(c, bericht.fondsId), fondsId ? eq(bericht.fondsId, fondsId) : undefined, art ? eq(bericht.art, art) : undefined, status ? eq(bericht.status, status) : undefined, geaendertSeitBedingung("bericht", bericht.id, bericht.erstelltAm, geaendertSeit)))
          .orderBy(desc(bericht.erstelltAm), asc(bericht.id)),
      );
      return c.json({ daten }, 200);
    })
    .get("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const detail = await lese(db, async (tx) => {
        const [b] = await tx.select().from(bericht).where(eq(bericht.id, id));
        return b ? ladeDetail(tx, b) : null;
      });
      if (!detail) return fehlerAntwort(c, 404, "BERICHT_NICHT_GEFUNDEN", "Bericht nicht gefunden.");
      return c.json(detail, 200);
    })
    /**
     * Datei des Berichts. Freigegeben: genau die gespeicherten Bytes (SHA-256 geprüft). Sonst frisch erzeugt mit Wasserzeichen
     * zum vorgegebenen oder aktuellen Wissensstand.
     */
    .get("/:id/datei", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const ergebnis = await lese(db, async (tx) => {
        const [b] = await tx.select().from(bericht).where(eq(bericht.id, id));
        if (!b) return null;
        if (b.status === "freigegeben" && b.dateiSchluessel && b.dateiSha256 && b.dateiName) {
          const bytes = await speicher.lese(b.dateiSchluessel);
          if (sha256(bytes) !== b.dateiSha256) throw new Fachfehler(500, "DATEI_BESCHAEDIGT", "Die gespeicherte Datei stimmt nicht mehr mit ihrem Hash überein.");
          return { bytes, typ: b.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name: b.dateiName, hash: b.dateiSha256 };
        }
        const d = await erzeugeBerichtDatei(tx, b, { entwurf: true, stand: b.standVorgabe ?? jetzt() });
        return { ...d, hash: null };
      });
      if (!ergebnis) return fehlerAntwort(c, 404, "BERICHT_NICHT_GEFUNDEN", "Bericht nicht gefunden.");
      await protokolliereLesen(db, c, "bericht", id, { bericht: "datei", freigegeben: ergebnis.hash !== null, dateiName: ergebnis.name, sha256: ergebnis.hash });
      return c.body(Buffer.from(ergebnis.bytes), 200, {
        "Content-Type": ergebnis.typ,
        "Content-Disposition": `attachment; filename="${ergebnis.name}"`,
        "Cache-Control": "no-store",
        ...(ergebnis.hash ? { "X-Datei-Sha256": ergebnis.hash } : {}),
      });
    })
    /** Kontrollbericht der Berichtsdaten. Freigegebene Berichte werden mit ihrem festgehaltenen Stand geprüft. */
    .get("/:id/kontrolle", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const kontrolle = await lese(db, async (tx) => {
        const [b] = await tx.select().from(bericht).where(eq(bericht.id, id));
        if (!b) return null;
        return kontrolliereBericht(tx, b, (b.stand ?? b.standVorgabe ?? jetzt()).toISOString());
      });
      if (!kontrolle) return fehlerAntwort(c, 404, "BERICHT_NICHT_GEFUNDEN", "Bericht nicht gefunden.");
      return c.json(kontrolle, 200);
    })
    /**
     * Freitextabschnitt des LP-Berichts setzen, solange der Bericht ein Entwurf ist (keine Stufe erteilt).
     * Schlüssel: vorwort, marktumfeld, ausblick; sie müssen in der Vorlage des Fonds stehen.
     */
    .put("/:id/abschnitte/:schluessel", pruefe("param", abschnittParam), pruefe("json", abschnittEingabe), async (c) => {
      const { id, schluessel } = c.req.valid("param");
      const e = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const b = await sperreBericht(tx, id);
        const freitexte = b.art === "lp_bericht" ? undefined : berichtsartAusErweiterung(b.art)?.freitexte;
        if (b.art !== "lp_bericht" && !freitexte) throw new Fachfehler(409, "ABSCHNITT_UNBEKANNT", "Nur der LP-Bericht und die PAI-Erklärung haben Freitextabschnitte.", { art: b.art });
        // Schlüssel je Art: Vorwort, Marktumfeld, Ausblick (LP-Bericht); bei Arten aus Erweiterungen deren Schlüssel (PAI-Erklärung: Vorbemerkung, Erläuterung und Maßnahmen je Indikator).
        const erlaubt: readonly string[] = freitexte ? freitexte.schluessel() : FREITEXT_SCHLUESSEL;
        if (!erlaubt.includes(schluessel)) throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder: [{ feld: "schluessel", code: "invalid_value", meldung: `Unbekannter Abschnitt (erlaubt: ${erlaubt.join(", ")})` }] });
        if (b.status !== "entwurf") throw new Fachfehler(409, "BERICHT_NICHT_ENTWURF", "Abschnitte lassen sich nur im Entwurf ändern.", { status: b.status });
        const vorlage = pruefeKonfiguration(b.art, b.konfiguration);
        // Der Abschnitt der Vorlage zum Schlüssel (PAI-Erklärung: Vorbemerkung oder Tabelle); er muss in der Vorlage stehen.
        const abschnittName = freitexte ? freitexte.abschnitt(schluessel) : schluessel;
        if (!vorlage.abschnitte.includes(abschnittName)) throw new Fachfehler(409, "ABSCHNITT_UNBEKANNT", "Der Abschnitt steht nicht in der Vorlage des Fonds.", { schluessel });
        const [vorher] = await tx.select().from(berichtAbschnitt).where(and(eq(berichtAbschnitt.berichtId, id), eq(berichtAbschnitt.schluessel, schluessel)));
        const werte = { ...(e.textDe !== undefined ? { textDe: e.textDe } : {}), ...(e.textEn !== undefined ? { textEn: e.textEn } : {}), geaendertVon: protokoll.akteur, geaendertAm: new Date() };
        const [neu] = vorher
          ? await tx.update(berichtAbschnitt).set(werte).where(eq(berichtAbschnitt.id, vorher.id)).returning()
          : await tx.insert(berichtAbschnitt).values({ berichtId: id, schluessel, ...werte }).returning();
        await protokoll(vorher ? "aendern" : "anlegen", "bericht_abschnitt", neu!.id, vorher ?? null, neu);
        return neu!;
      });
      return c.json(nachher, 200);
    })
    /**
     * Freigabestufe: `ok` (die nächste Stufe, anderer Akteur als bei den gültigen Freigaben) oder `zurueck` (die zuletzt erteilte
     * Freigabe entfällt, mit Kommentar). Die letzte Stufe erzeugt die Datei ohne Wasserzeichen, hält den Stand fest und speichert sie.
     * Ist der Kontrollbericht rot, ist die Freigabe 409 `KONTROLLE_ROT`, außer die letzte Stufe überschreibt mit Begründung.
     */
    .post("/:id/stufe", pruefe("param", idParam), pruefe("json", stufeEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await sperreBericht(tx, id);
        if (vorher.status === "freigegeben") throw new Fachfehler(409, "BERICHT_STATUS_UNGUELTIG", "Der Bericht ist bereits freigegeben.", { status: vorher.status });
        const stufen = vorher.freigabestufen as string[];
        const log = await tx.select().from(berichtFreigabe).where(eq(berichtFreigabe.berichtId, id)).orderBy(asc(berichtFreigabe.am), asc(berichtFreigabe.id));
        const aktiv = aktiveFreigaben(log);
        const index = aktiv.length;
        if (e.stufe !== stufen[index]) throw new Fachfehler(409, "BERICHT_STUFE_FALSCH", "Das ist nicht die nächste Stufe.", { erwartet: stufen[index] ?? null, stufe: e.stufe });
        const fehlerhaft = (feld: string, code: string, meldung: string) => new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder: [{ feld, code, meldung }] });

        if (e.ergebnis === "zurueck") {
          if (!e.kommentar?.trim()) throw fehlerhaft("kommentar", "kommentar_erforderlich", "Für die Rückgabe ist ein Kommentar erforderlich");
          if (e.kontrolleUeberschreiben) throw fehlerhaft("kontrolleUeberschreiben", "nur_bei_freigabe", "Die Überschreibung gilt nur bei der Freigabe der letzten Stufe");
          const neueAnzahl = Math.max(0, index - 1);
          await tx.insert(berichtFreigabe).values({ berichtId: id, stufeIndex: index, stufe: e.stufe, ergebnis: "zurueck", kommentar: e.kommentar, akteur: protokoll.akteur });
          const [neu] = await tx.update(bericht).set({ naechsteStufe: neueAnzahl, status: neueAnzahl === 0 ? "entwurf" : "geprueft" }).where(eq(bericht.id, id)).returning();
          await protokoll("zurueckgeben", "bericht", id, vorher, neu);
          return neu!;
        }

        // Vier-Augen auf jeder Stufe: nicht der Ersteller, nicht wer einen Abschnitt bearbeitet hat, nicht wer schon eine gültige Freigabe erteilt hat.
        verlangeAnderenAkteur(vorher.erstelltVon, protokoll.akteur);
        if ((await bisherigeBearbeiter(tx, id)).has(protokoll.akteur)) {
          throw new Fachfehler(409, "VIER_AUGEN_VERLETZT", "Wer einen Abschnitt des Berichts bearbeitet hat, darf ihn nicht freigeben.");
        }
        if (aktiv.includes(protokoll.akteur)) {
          throw new Fachfehler(409, "VIER_AUGEN_VERLETZT", "Jede Stufe verlangt einen anderen Akteur als die bereits erteilten Freigaben.");
        }
        const letzte = index === stufen.length - 1;
        if (e.kontrolleUeberschreiben && !letzte) throw fehlerhaft("kontrolleUeberschreiben", "nur_letzte_stufe", "Die Überschreibung ist nur in der letzten Stufe möglich");
        if (!letzte) {
          await tx.insert(berichtFreigabe).values({ berichtId: id, stufeIndex: index, stufe: e.stufe, ergebnis: "ok", kommentar: e.kommentar ?? null, akteur: protokoll.akteur });
          const [neu] = await tx.update(bericht).set({ naechsteStufe: index + 1, status: "geprueft" }).where(eq(bericht.id, id)).returning();
          await protokoll("pruefen", "bericht", id, vorher, neu);
          return neu!;
        }

        // Letzte Stufe: Kontrolle, Datei ohne Wasserzeichen, Stand festhalten, unveränderlich speichern
        const stand = vorher.standVorgabe ?? jetzt();
        const kontrolle = await kontrolliereBericht(tx, vorher, stand.toISOString());
        let ueberschrieben: unknown = null;
        if (kontrolle.gesamt !== "ok") {
          if (!e.kontrolleUeberschreiben) {
            throw new Fachfehler(409, "KONTROLLE_ROT", "Der Kontrollbericht zeigt Abweichungen; die Freigabe braucht eine ausdrückliche Überschreibung mit Begründung.", {
              pruefungen: kontrolle.pruefungen.filter((p) => p.status !== "ok").map((p) => ({ code: p.code, schluessel: p.schluessel, params: p.params })),
            });
          }
          ueberschrieben = {
            grund: e.kontrolleUeberschreiben.grund,
            akteur: protokoll.akteur,
            am: new Date().toISOString(),
            pruefungen: kontrolle.pruefungen.filter((p) => p.status !== "ok"),
          };
        }
        const datei = await erzeugeBerichtDatei(tx, vorher, { entwurf: false, stand, mitFassungen: true });
        const hash = sha256(datei.bytes);
        const schluessel = dateiSchluessel(id, hash, vorher.format);
        await speicher.schreibe(schluessel, datei.bytes);
        // LP-Bericht mit Abschnitt „Kapitalkonten“: je Investor eine unveränderlich gespeicherte Fassung mit nur dessen Konto (Portal liefert nur diese).
        await speichereFassungen(tx, protokoll, speicher, { id, fondsId: vorher.fondsId }, datei.fassungen ?? []);
        await tx.update(berichtAbschnitt).set({ status: "freigegeben" }).where(eq(berichtAbschnitt.berichtId, id));
        await tx.insert(berichtFreigabe).values({
          berichtId: id,
          stufeIndex: index,
          stufe: e.stufe,
          ergebnis: "ok",
          kommentar: e.kommentar ?? null,
          akteur: protokoll.akteur,
          kontrolleUeberschreibung: e.kontrolleUeberschreiben?.grund ?? null,
        });
        const [neu] = await tx
          .update(bericht)
          .set({
            status: "freigegeben",
            naechsteStufe: stufen.length,
            stand,
            erzeugtAm: new Date(),
            dateiName: datei.name,
            dateiSchluessel: schluessel,
            dateiSha256: hash,
            dateiGroesse: datei.bytes.length,
            kontrolleUeberschrieben: ueberschrieben,
          })
          .where(eq(bericht.id, id))
          .returning();
        await protokoll("freigeben", "bericht", id, vorher, neu);
        if (ueberschrieben) await protokoll("kontrolle_ueberschrieben", "bericht", id, null, ueberschrieben);
        // Interne Hinweise nur an Personen mit Opt-in (Etappe 17); ohne Mailversand bleibt die Freigabe unberührt.
        const hinweisFonds = vorher.fondsId ?? (vorher.beteiligungId ? (await tx.select({ f: beteiligung.fondsId }).from(beteiligung).where(eq(beteiligung.id, vorher.beteiligungId)))[0]?.f ?? null : null);
        const [fondsZeile] = hinweisFonds ? await tx.select({ name: fonds.name }).from(fonds).where(eq(fonds.id, hinweisFonds)) : [];
        await sendeBerichtFreigegeben(tx, protokoll, c.get("mail"), { berichtId: id, bericht: vorher.art, fondsId: hinweisFonds, fondsName: fondsZeile?.name ?? null });
        return neu!;
      });
      return c.json(nachher, 200);
    });
}
