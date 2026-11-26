import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { anzeigeAus, pruefeManuellenWert, type Feld } from "@carraway/berichte";
import { beteiligung, foerderprogramm, fonds, kennzahlDefinition, kennzahlWert, meldeDatei, meldeFreigabe, meldeLauf, meldeWert, organisation, vorgang, fondsBewegung, type Db, type MeldeLauf } from "@carraway/db";
import { erstelleStandardSpeicher, sha256, type Speicher } from "../berichte/speicher";
import { Fachfehler, fehlerAntwort } from "../fehler";
import { verlangeAnderenAkteur } from "../instrumente/bewertung";
import { aktiveFreigaben, befundeAus, bisherigeBearbeiter, dateiSchluessel, erzeugeDatei, ladeProtokoll, ladeWerte, schnappschussVon, sperreLauf } from "../melde/lauf";
import { sendeBerichtFreigegeben } from "../mail/benachrichtigung";
import { geaendertSeitBedingung, geaendertSeitEingabe } from "../geaendert";
import { pruefe } from "../pruefung";
import { fondsSichtbar } from "../rechte/sichtbarkeit";
import { idParam, protokolliereLesen, schreibe, textEingabe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";
import { legeLaufAn } from "../melde/anlegen";

/**
 * Förder- und Meldeberichte, Teil 2 (Etappe 15): Meldeläufe. Ein Lauf rechnet beim Anlegen alle Werte zu einem festen Wissensstand und hält sie mit
 * ihrer Herkunft fest; Eingaben von Hand gibt es nur im Entwurf. Stufen wie bei Berichten (andere Person als Ersteller, Bearbeiter und frühere Freigaben);
 * die letzte Stufe verlangt keine offenen Fehler und kommentierte Warnungen, erzeugt die Dateien aus den gespeicherten Werten und hält sie unveränderlich
 * (SHA-256). Eine Neuberechnung ist immer ein neuer Lauf (`fassung`), der Verlauf bleibt.
 */

const neuerLauf = z.object({
  fondsId: z.uuid(),
  definition: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/),
  /** Ohne Angabe gilt die Version, die am Ende des Zeitraums gilt. */
  version: z.number().int().min(1).optional(),
  jahr: z.number().int().optional(),
  nummer: z.number().int().optional(),
  stichtag: z.iso.date().optional(),
  sprache: z.enum(["de", "en"]).default("de"),
  /** Wissensstand der Rechnung; ohne Angabe jetzt. */
  stand: z.iso.datetime({ offset: true }).optional(),
});
const listenAbfrage = z.object({ fondsId: z.uuid().optional(), definition: z.string().optional(), status: z.enum(["entwurf", "geprueft", "freigegeben"]).optional(), geaendertSeit: geaendertSeitEingabe });
const eingabeKoerper = z.object({ schluessel: z.string().min(1).max(200), wert: z.string().max(10_000).nullable() });
const kommentarParam = z.object({ id: z.uuid(), regelId: z.string().min(1).max(100) });
const kommentarKoerper = z.object({ text: textEingabe(2000) });
const stufeEingabe = z.object({ stufe: textEingabe(100), ergebnis: z.enum(["ok", "zurueck"]), kommentar: z.string().trim().max(2000).nullable().optional() });
const herkunftAbfrage = z.object({ schluessel: z.string().min(1).max(300) });
const dateiAbfrage = z.object({ art: z.enum(["meldung", "pruefansicht"]).default("meldung") });

const nichtGefunden = () => new Fachfehler(404, "MELDELAUF_NICHT_GEFUNDEN", "Meldelauf nicht gefunden.");

function listenzeile(l: MeldeLauf) {
  const meta = (l.definition as { meta: { bezeichnungDe: string; bezeichnungEn: string; herausgeber: string } }).meta;
  const { definition: _d, befundKommentare: _k, ...rest } = l;
  return { ...rest, bezeichnungDe: meta.bezeichnungDe, bezeichnungEn: meta.bezeichnungEn };
}

async function ladeDetail(tx: Tx, l: MeldeLauf) {
  const s = schnappschussVon(l);
  const werte = await ladeWerte(tx, l.id);
  const protokoll = await ladeProtokoll(tx, l.id);
  const dateien = await tx.select().from(meldeDatei).where(eq(meldeDatei.laufId, l.id)).orderBy(asc(meldeDatei.art));
  const [programm] = l.foerderprogrammId ? await tx.select().from(foerderprogramm).where(eq(foerderprogramm.id, l.foerderprogrammId)) : [];
  const stufen = l.freigabestufen as string[];
  const { definition: _d, befundKommentare, ...lauf } = l;
  return {
    ...lauf,
    meta: s.meta,
    definition: s.inhalt,
    foerderprogramm: programm ? { schluessel: programm.schluessel, bezeichnung: programm.bezeichnung } : null,
    anzeige: anzeigeAus(s.inhalt, werte),
    werte: werte.filter((w) => w.art !== "zeile").map((w) => ({ schluessel: w.schluessel, art: w.art, wert: w.wert, manuell: w.manuell, geaendertVon: w.geaendertVon, geaendertAm: w.geaendertAm })),
    befunde: befundeAus(s.inhalt, werte, befundKommentare),
    protokoll,
    dateien: dateien.map((d) => ({ id: d.id, art: d.art, format: d.format, name: d.name, sha256: d.sha256, groesse: d.groesse, erzeugtAm: d.erzeugtAm })),
    naechsteStufeName: l.status === "freigegeben" ? null : (stufen[l.naechsteStufe] ?? null),
  };
}

function manuelleFelder(inhalt: ReturnType<typeof schnappschussVon>["inhalt"]): Map<string, Feld> {
  const aus = new Map<string, Feld>();
  for (const a of inhalt.abschnitte) if (a.typ === "felder") for (const f of a.felder) if (f.quelle.art === "manuell") aus.set(`${a.id}.${f.id}`, f);
  return aus;
}

const fehlerhaft = (feld: string, code: string, meldung: string) => new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder: [{ feld, code, meldung }] });

export function meldelaufRouten(db: Db, speicher: Speicher = erstelleStandardSpeicher()) {
  return new Hono()
    /**
     * Legt einen Lauf an und rechnet ihn: Definition (Version, die am Ende des Zeitraums gilt), Fonds, Zeitraum, Wissensstand. Die Definition muss für den
     * Fonds aktiviert sein. Gibt es für Fonds, Definition und Zeitraum schon einen Lauf, ist der neue die nächste Fassung; Eingaben von Hand der letzten Fassung
     * werden übernommen.
     */
    .post("/", pruefe("json", neuerLauf), async (c) => {
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, (tx, protokoll) => legeLaufAn(tx, protokoll, e));
      const detail = await lese(db, (tx) => ladeDetail(tx, neu));
      return c.json(detail, 201);
    })
    .get("/", pruefe("query", listenAbfrage), async (c) => {
      const { fondsId, definition, status, geaendertSeit } = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        const zeilen = await tx
          .select()
          .from(meldeLauf)
          .where(and(fondsSichtbar(c, meldeLauf.fondsId), fondsId ? eq(meldeLauf.fondsId, fondsId) : undefined, definition ? eq(meldeLauf.definitionSchluessel, definition) : undefined, status ? eq(meldeLauf.status, status) : undefined, geaendertSeitBedingung("melde_lauf", meldeLauf.id, meldeLauf.erstelltAm, geaendertSeit)))
          .orderBy(desc(meldeLauf.periodeEnde), desc(meldeLauf.erstelltAm), asc(meldeLauf.id));
        return zeilen.map(listenzeile);
      });
      return c.json({ daten }, 200);
    })
    .get("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const detail = await lese(db, async (tx) => {
        const [l] = await tx.select().from(meldeLauf).where(eq(meldeLauf.id, id));
        return l ? ladeDetail(tx, l) : null;
      });
      if (!detail) return fehlerAntwort(c, 404, "MELDELAUF_NICHT_GEFUNDEN", "Meldelauf nicht gefunden.");
      return c.json(detail, 200);
    })
    /** Befunde der Prüfregeln auf den gespeicherten Werten (Fehler blockieren die Freigabe, Warnungen brauchen einen Kommentar). */
    .get("/:id/befunde", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        const [l] = await tx.select().from(meldeLauf).where(eq(meldeLauf.id, id));
        if (!l) return null;
        return befundeAus(schnappschussVon(l).inhalt, await ladeWerte(tx, id), l.befundKommentare);
      });
      if (!daten) return fehlerAntwort(c, 404, "MELDELAUF_NICHT_GEFUNDEN", "Meldelauf nicht gefunden.");
      return c.json({ daten }, 200);
    })
    /**
     * Herkunft eines Wertes: Rechenschritte, angewendete Filter und die Datensätze, aus denen er stammt (Beteiligungen, Vorgänge, Kennzahlenwerte,
     * Fondsbewegungen). Der Schlüssel steht in der Abfrage, weil Zeilenschlüssel von Gruppen beliebigen Text enthalten können.
     */
    .get("/:id/herkunft", pruefe("param", idParam, { query: herkunftAbfrage }), pruefe("query", herkunftAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { schluessel } = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        const [l] = await tx.select({ id: meldeLauf.id }).from(meldeLauf).where(eq(meldeLauf.id, id));
        if (!l) throw nichtGefunden();
        const [w] = await tx.select().from(meldeWert).where(and(eq(meldeWert.laufId, id), eq(meldeWert.schluessel, schluessel)));
        if (!w || w.art === "zeile") throw new Fachfehler(404, "MELDEWERT_NICHT_GEFUNDEN", "Wert nicht gefunden.", { schluessel });
        type H = { schritte: unknown[]; filter: unknown[]; beteiligungen: string[]; vorgaenge: string[]; kennzahlWerte: string[]; bewegungen: string[]; operanden?: unknown[] };
        const h = (w.herkunft ?? { schritte: [], filter: [], beteiligungen: [], vorgaenge: [], kennzahlWerte: [], bewegungen: [] }) as H;
        const MAX = 500;
        const bs = h.beteiligungen.length ? await tx.select({ id: beteiligung.id, name: organisation.name, instrument: beteiligung.instrument }).from(beteiligung).innerJoin(organisation, eq(organisation.id, beteiligung.organisationId)).where(inArray(beteiligung.id, h.beteiligungen)).orderBy(asc(organisation.name)) : [];
        const vs = h.vorgaenge.length ? await tx.select({ id: vorgang.id, beteiligungId: vorgang.beteiligungId, art: vorgang.art, valuta: vorgang.valuta, betrag: vorgang.betrag }).from(vorgang).where(inArray(vorgang.id, h.vorgaenge.slice(0, 5000))).orderBy(asc(vorgang.valuta), asc(vorgang.id)).limit(MAX) : [];
        const ks = h.kennzahlWerte.length ? await tx.select({ id: kennzahlWert.id, beteiligungId: kennzahlWert.beteiligungId, schluessel: kennzahlDefinition.schluessel, szenario: kennzahlWert.szenario, periodeBeginn: kennzahlWert.periodeBeginn, periodeEnde: kennzahlWert.periodeEnde, wert: kennzahlWert.wert }).from(kennzahlWert).innerJoin(kennzahlDefinition, eq(kennzahlDefinition.id, kennzahlWert.definitionId)).where(inArray(kennzahlWert.id, h.kennzahlWerte)).orderBy(asc(kennzahlWert.periodeBeginn)).limit(MAX) : [];
        const bw = h.bewegungen.length ? await tx.select({ id: fondsBewegung.id, art: fondsBewegung.art, valuta: fondsBewegung.valuta, betrag: fondsBewegung.betrag }).from(fondsBewegung).where(inArray(fondsBewegung.id, h.bewegungen)).orderBy(asc(fondsBewegung.valuta)).limit(MAX) : [];
        return {
          schluessel: w.schluessel,
          art: w.art,
          wert: w.wert,
          manuell: w.manuell,
          geaendertVon: w.geaendertVon,
          schritte: h.schritte as { zeichen: string; bezeichnung: string; wert: string }[],
          filter: h.filter as Record<string, string[]>[],
          operanden: (h.operanden ?? []) as { ref: string; wert: string | null }[],
          beteiligungen: bs,
          vorgaenge: vs,
          vorgaengeGesamt: h.vorgaenge.length,
          kennzahlWerte: ks,
          kennzahlWerteGesamt: h.kennzahlWerte.length,
          bewegungen: bw,
        };
      });
      return c.json(daten, 200);
    })
    /** Eingabe von Hand für ein Feld mit Quelle `manuell`, nur im Entwurf; geprüft gegen das Format des Feldes (Zahlen nur als Dezimalzahl, Ja/Nein nur `ja`/`nein`). `wert: null` leert das Feld. */
    .put("/:id/eingaben", pruefe("param", idParam), pruefe("json", eingabeKoerper), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const l = await sperreLauf(tx, id);
        if (l.status !== "entwurf") throw new Fachfehler(409, "MELDELAUF_STATUS_UNGUELTIG", "Eingaben lassen sich nur im Entwurf ändern.", { status: l.status });
        const felder = manuelleFelder(schnappschussVon(l).inhalt);
        const feld = felder.get(e.schluessel);
        if (!feld) {
          const [vorhanden] = await tx.select({ manuell: meldeWert.manuell }).from(meldeWert).where(and(eq(meldeWert.laufId, id), eq(meldeWert.schluessel, e.schluessel)));
          if (vorhanden) throw new Fachfehler(409, "MELDEFELD_NICHT_MANUELL", "Dieses Feld wird berechnet und lässt sich nicht von Hand ändern.", { schluessel: e.schluessel });
          throw new Fachfehler(404, "MELDEFELD_NICHT_GEFUNDEN", "Das Feld gibt es in der Definition nicht.", { schluessel: e.schluessel });
        }
        const wert = e.wert === null ? null : e.wert.trim();
        if (wert !== null) {
          const code = pruefeManuellenWert(feld.format, wert);
          if (code) throw new Fachfehler(400, "MELDEWERT_UNGUELTIG", "Der Wert passt nicht zum Format des Feldes.", { schluessel: e.schluessel, format: feld.format, grund: code });
        }
        const [vorher] = await tx.select().from(meldeWert).where(and(eq(meldeWert.laufId, id), eq(meldeWert.schluessel, e.schluessel)));
        if (!vorher) throw new Fachfehler(404, "MELDEFELD_NICHT_GEFUNDEN", "Das Feld gibt es im Lauf nicht.", { schluessel: e.schluessel });
        const herkunft = { schritte: wert === null ? [{ zeichen: "=", bezeichnung: "Kein Wert vorhanden (k. A.)", wert: "" }] : [{ zeichen: "=", bezeichnung: "Eingabe von Hand", wert }], filter: [], beteiligungen: [], vorgaenge: [], kennzahlWerte: [], bewegungen: [] };
        const [neu] = await tx.update(meldeWert).set({ wert, herkunft, geaendertVon: protokoll.akteur, geaendertAm: new Date() }).where(eq(meldeWert.id, vorher.id)).returning();
        await protokoll("eingabe", "melde_wert", vorher.id, { ...vorher, fondsId: l.fondsId }, { ...neu, fondsId: l.fondsId });
        return { schluessel: neu!.schluessel, wert: neu!.wert, geaendertVon: neu!.geaendertVon, geaendertAm: neu!.geaendertAm };
      });
      return c.json(nachher, 200);
    })
    /** Kommentar zu einer Warnung (Pflicht für die Freigabe), nur solange der Lauf nicht freigegeben ist. */
    .put("/:id/befunde/:regelId/kommentar", pruefe("param", kommentarParam), pruefe("json", kommentarKoerper), async (c) => {
      const { id, regelId } = c.req.valid("param");
      const { text } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const l = await sperreLauf(tx, id);
        if (l.status === "freigegeben") throw new Fachfehler(409, "MELDELAUF_STATUS_UNGUELTIG", "Der Lauf ist bereits freigegeben.", { status: l.status });
        const befund = befundeAus(schnappschussVon(l).inhalt, await ladeWerte(tx, id), l.befundKommentare).find((b) => b.regelId === regelId && b.schwere === "warnung");
        if (!befund) throw new Fachfehler(404, "MELDEBEFUND_NICHT_GEFUNDEN", "Zu dieser Regel gibt es keine offene Warnung.", { regelId });
        const kommentar = { text, von: protokoll.akteur, am: new Date().toISOString() };
        const neu = { ...(l.befundKommentare as Record<string, unknown>), [regelId]: kommentar };
        await tx.update(meldeLauf).set({ befundKommentare: neu }).where(eq(meldeLauf.id, id));
        await protokoll("befund_kommentieren", "melde_lauf", id, { fondsId: l.fondsId, regelId, kommentar: (l.befundKommentare as Record<string, unknown>)[regelId] ?? null }, { fondsId: l.fondsId, regelId, kommentar });
        return { regelId, ...kommentar };
      });
      return c.json(ergebnis, 200);
    })
    /**
     * Datei des Laufs: `art=meldung` (Format der Definition) oder `pruefansicht` (PDF). Freigegeben: genau die gespeicherten Bytes (SHA-256 geprüft),
     * sonst frisch aus den gespeicherten Werten mit Entwurfskennzeichnung. Jeder Abruf steht im Protokoll (`gelesen`).
     */
    .get("/:id/datei", pruefe("param", idParam, { query: dateiAbfrage }), pruefe("query", dateiAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { art } = c.req.valid("query");
      const ergebnis = await lese(db, async (tx) => {
        const [l] = await tx.select().from(meldeLauf).where(eq(meldeLauf.id, id));
        if (!l) return null;
        if (l.status === "freigegeben") {
          const [d] = await tx.select().from(meldeDatei).where(and(eq(meldeDatei.laufId, id), eq(meldeDatei.art, art)));
          if (!d) throw new Fachfehler(404, "MELDELAUF_NICHT_GEFUNDEN", "Die Datei gibt es nicht.");
          const bytes = await speicher.lese(d.schluessel);
          if (sha256(bytes) !== d.sha256) throw new Fachfehler(500, "DATEI_BESCHAEDIGT", "Die gespeicherte Datei stimmt nicht mehr mit ihrem Hash überein.");
          return { bytes, typ: erzeugteTypen[d.format]!, name: d.name, hash: d.sha256, fondsId: l.fondsId };
        }
        const d = await erzeugeDatei(tx, l, art, true);
        return { bytes: d.bytes, typ: d.typ, name: d.name, hash: null, fondsId: l.fondsId };
      });
      if (!ergebnis) return fehlerAntwort(c, 404, "MELDELAUF_NICHT_GEFUNDEN", "Meldelauf nicht gefunden.");
      await protokolliereLesen(db, c, "melde_lauf", id, { meldelauf: "datei", art, freigegeben: ergebnis.hash !== null, dateiName: ergebnis.name, sha256: ergebnis.hash, fondsId: ergebnis.fondsId });
      return c.body(Buffer.from(ergebnis.bytes), 200, {
        "Content-Type": ergebnis.typ,
        "Content-Disposition": `attachment; filename="${ergebnis.name}"`,
        "Cache-Control": "no-store",
        ...(ergebnis.hash ? { "X-Datei-Sha256": ergebnis.hash } : {}),
      });
    })
    /**
     * Freigabestufe: `ok` (die nächste Stufe, andere Person als Ersteller, Bearbeiter und gültige Freigaben) oder `zurueck` (die zuletzt erteilte Freigabe entfällt,
     * mit Kommentar). Die letzte Stufe prüft die Befunde, erzeugt die Dateien aus den gespeicherten Werten und speichert sie unveränderlich.
     */
    .post("/:id/stufe", pruefe("param", idParam), pruefe("json", stufeEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await sperreLauf(tx, id);
        if (vorher.status === "freigegeben") throw new Fachfehler(409, "MELDELAUF_STATUS_UNGUELTIG", "Der Lauf ist bereits freigegeben.", { status: vorher.status });
        const stufen = vorher.freigabestufen as string[];
        const log = await ladeProtokoll(tx, id);
        const aktiv = aktiveFreigaben(log);
        const index = aktiv.length;
        if (e.stufe !== stufen[index]) throw new Fachfehler(409, "MELDELAUF_STUFE_FALSCH", "Das ist nicht die nächste Stufe.", { erwartet: stufen[index] ?? null, stufe: e.stufe });
        const stand = (neu: Record<string, unknown>) => ({ ...neu, fondsId: vorher.fondsId });

        if (e.ergebnis === "zurueck") {
          if (!e.kommentar?.trim()) throw fehlerhaft("kommentar", "kommentar_erforderlich", "Für die Rückgabe ist ein Kommentar erforderlich");
          const neueAnzahl = Math.max(0, index - 1);
          await tx.insert(meldeFreigabe).values({ laufId: id, stufeIndex: index, stufe: e.stufe, ergebnis: "zurueck", kommentar: e.kommentar, akteur: protokoll.akteur });
          const [neu] = await tx.update(meldeLauf).set({ naechsteStufe: neueAnzahl, status: neueAnzahl === 0 ? "entwurf" : "geprueft" }).where(eq(meldeLauf.id, id)).returning();
          await protokoll("zurueckgeben", "melde_lauf", id, stand({ status: vorher.status, naechsteStufe: vorher.naechsteStufe }), stand({ status: neu!.status, naechsteStufe: neu!.naechsteStufe }));
          return neu!;
        }

        verlangeAnderenAkteur(vorher.erstelltVon, protokoll.akteur);
        if ((await bisherigeBearbeiter(tx, id)).has(protokoll.akteur)) throw new Fachfehler(409, "VIER_AUGEN_VERLETZT", "Wer eine Eingabe gemacht oder eine Warnung kommentiert hat, darf den Lauf nicht freigeben.");
        if (aktiv.includes(protokoll.akteur)) throw new Fachfehler(409, "VIER_AUGEN_VERLETZT", "Jede Stufe verlangt einen anderen Akteur als die bereits erteilten Freigaben.");
        const letzte = index === stufen.length - 1;
        if (!letzte) {
          await tx.insert(meldeFreigabe).values({ laufId: id, stufeIndex: index, stufe: e.stufe, ergebnis: "ok", kommentar: e.kommentar ?? null, akteur: protokoll.akteur });
          const [neu] = await tx.update(meldeLauf).set({ naechsteStufe: index + 1, status: "geprueft" }).where(eq(meldeLauf.id, id)).returning();
          await protokoll("pruefen", "melde_lauf", id, stand({ status: vorher.status, naechsteStufe: vorher.naechsteStufe }), stand({ status: neu!.status, naechsteStufe: neu!.naechsteStufe }));
          return neu!;
        }

        // Letzte Stufe: keine offenen Fehler, jede Warnung kommentiert; Dateien aus den gespeicherten Werten, unveränderlich speichern
        const befunde = befundeAus(schnappschussVon(vorher).inhalt, await ladeWerte(tx, id), vorher.befundKommentare);
        const fehler = befunde.filter((b) => b.schwere === "fehler");
        if (fehler.length) throw new Fachfehler(409, "MELDELAUF_FEHLER_OFFEN", "Der Lauf hat offene Fehler und lässt sich nicht freigeben.", { befunde: fehler.map((b) => ({ regelId: b.regelId, code: b.code, refs: b.refs, params: b.params })) });
        const ohneKommentar = befunde.filter((b) => b.schwere === "warnung" && !b.kommentar);
        if (ohneKommentar.length) throw new Fachfehler(409, "MELDELAUF_WARNUNG_OHNE_KOMMENTAR", "Jede Warnung braucht vor der Freigabe einen Kommentar.", { befunde: ohneKommentar.map((b) => ({ regelId: b.regelId, code: b.code, refs: b.refs, params: b.params })) });
        const arten: ("meldung" | "pruefansicht")[] = vorher.format === "pdf" ? ["meldung"] : ["meldung", "pruefansicht"];
        for (const art of arten) {
          const d = await erzeugeDatei(tx, vorher, art, false);
          const hash = sha256(d.bytes);
          const schluessel = dateiSchluessel(id, hash, d.format);
          await speicher.schreibe(schluessel, d.bytes);
          const [zeile] = await tx.insert(meldeDatei).values({ laufId: id, art, format: d.format, name: d.name, schluessel, sha256: hash, groesse: d.bytes.length }).returning();
          await protokoll("anlegen", "melde_datei", zeile!.id, null, { ...zeile, fondsId: vorher.fondsId });
        }
        await tx.insert(meldeFreigabe).values({ laufId: id, stufeIndex: index, stufe: e.stufe, ergebnis: "ok", kommentar: e.kommentar ?? null, akteur: protokoll.akteur });
        const [neu] = await tx.update(meldeLauf).set({ status: "freigegeben", naechsteStufe: stufen.length, freigegebenAm: new Date() }).where(eq(meldeLauf.id, id)).returning();
        await protokoll("freigeben", "melde_lauf", id, stand({ status: vorher.status, naechsteStufe: vorher.naechsteStufe }), stand({ status: neu!.status, naechsteStufe: neu!.naechsteStufe }));
        // Interne Hinweise nur an Personen mit Opt-in (Etappe 17), wie bei Berichten; ohne Mailversand bleibt die Freigabe unberührt.
        const [fondsZeile] = await tx.select({ name: fonds.name }).from(fonds).where(eq(fonds.id, vorher.fondsId));
        await sendeBerichtFreigegeben(tx, protokoll, c.get("mail"), { berichtId: id, bericht: "meldelauf", fondsId: vorher.fondsId, fondsName: fondsZeile?.name ?? null, linkPfad: `/meldungen/${id}`, bezugArt: "melde_lauf" });
        return neu!;
      });
      const detail = await lese(db, (tx) => ladeDetail(tx, nachher));
      return c.json(detail, 200);
    });
}

const erzeugteTypen: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
};
