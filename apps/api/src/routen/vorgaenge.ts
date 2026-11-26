import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  beteiligung,
  jahresueberschuss,
  instrument,
  vorgang,
  zinsmethode,
  zinsperiodenart,
  type Db,
} from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { Fachfehler, fehlerAntwort } from "../fehler";
import { ladeInstrumentdaten } from "../instrumente/daten";
import { ladeZinsansicht } from "../instrumente/zinsansicht";
import { pruefeStichtag } from "../instrumente/stichtag";
import { standardStichtag } from "../kennzahlen/fonds";
import { ladeRunden } from "../kennzahlen/beteiligung";
import { ladeVorgaenge, pruefePeriodensperre, sperreBeteiligung } from "../instrumente/zustand";
import { liesAbfrage, pruefe } from "../pruefung";
import { betragEingabe, heute, idParam, optionalerText, schreibe, textEingabe } from "../schreiben";
import { lese } from "../zeitlimit";
import { legeKonditionAn } from "../instrumente/konditionen";
import { zinsperiodeAufgeben } from "../instrumente/zinsperioden";
import { ladeBuchwertabgang, verkaufZuVorgang } from "../instrumente/verkaeufe";
import { BERUEHRT_KAPITAL, bucheVorgang, pruefeNachBuchung } from "../instrumente/buchen";
import { loeseInstrument } from "../instrumente/instrumente";
import { alsVorgangJson } from "../instrumente/tranchen";
import { erfuelleTranche, legeTrancheAn } from "../instrumente/tranchen-schreiben";
import { pruefeNeueWerte } from "../felder/werte";
import { ordneRundeZu, setzeVorgangRunde } from "../instrumente/vorgang-runde";

/** Betrag mit Vorzeichen (Wertberichtigung: Zuführung positiv, Auflösung negativ), höchstens zwei Nachkommastellen, nicht null. */
export const betragMitVorzeichen = z
  .string()
  .regex(/^-?(?!0+(\.0+)?$)\d{1,16}(\.\d{1,2})?$/, "Betrag ungleich null mit höchstens zwei Nachkommastellen erwartet");

/** Zinssatz als Anteil (0,06 = 6 %): 0 bis 1 mit höchstens sechs Nachkommastellen. */
export const satzEingabe = z.string().regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/, "Anteil von 0 bis 1 mit höchstens sechs Nachkommastellen erwartet");

const valuta = z.iso.date();
const bemerkung = optionalerText(1000);
/** Werte eigener Felder des Vorgangs (Schlüssel: ID der Felddefinition); nur beim Anlegen, danach ist der Vorgang unveränderlich. */
export const vorgangFelder = z.record(z.string(), z.unknown()).optional();
/** Betrag in der lokalen Währung der Beteiligung (Etappe 21); bei Beteiligungen mit abweichender lokaler Währung darf `betrag` (Fondswährung) fehlen. */
export const betragLokalEingabe = z.string().regex(/^(?!0+(\.0+)?$)\d{1,16}(\.\d{1,2})?$/, "Betrag größer als null mit höchstens zwei Nachkommastellen erwartet").optional();
/** Nur bei der Wertberichtigung hat der lokale Betrag ein Vorzeichen (Zuführung positiv, Auflösung negativ). */
export const betragLokalMitVorzeichen = z.string().regex(/^-?(?!0+(\.0+)?$)\d{1,16}(\.\d{1,2})?$/, "Betrag ungleich null mit höchstens zwei Nachkommastellen erwartet").optional();

/** Gemeinsame Felder: das Instrument (Pflicht bei mehreren Instrumenten der Beteiligung) und die Werte eigener Felder. */
const instrumentId = z.uuid().optional();
/** Finanzierungsrunde des Unternehmens; ohne Angabe die Runde des Instruments, `null` = keiner Runde. */
const rundeId = z.uuid().nullable().optional();

export const neuerVorgang = z.discriminatedUnion("art", [
  z.object({ art: z.literal("zusage"), valuta, betrag: betragEingabe.optional(), betragLokal: betragLokalEingabe, bemerkung, instrumentId, rundeId, felder: vorgangFelder }),
  z.object({ art: z.literal("auszahlung"), valuta, betrag: betragEingabe.optional(), betragLokal: betragLokalEingabe, bemerkung, instrumentId, rundeId, trancheId: z.uuid().optional(), meilensteinId: z.uuid().optional(), felder: vorgangFelder }),
  z.object({ art: z.literal("rueckfluss"), valuta, betrag: betragEingabe.optional(), betragLokal: betragLokalEingabe, bemerkung, instrumentId, rundeId, felder: vorgangFelder }),
  z.object({ art: z.literal("tilgung"), valuta, betrag: betragEingabe.optional(), betragLokal: betragLokalEingabe, bemerkung, instrumentId, rundeId, felder: vorgangFelder }),
  z.object({ art: z.literal("zinszahlung"), valuta, betrag: betragEingabe.optional(), betragLokal: betragLokalEingabe, bemerkung, instrumentId, rundeId, beglichenVorgangId: z.uuid().optional(), felder: vorgangFelder }),
  z.object({ art: z.literal("dividende"), valuta, betrag: betragEingabe.optional(), betragLokal: betragLokalEingabe, bemerkung, instrumentId, rundeId, felder: vorgangFelder }),
  z.object({ art: z.literal("wertberichtigung"), valuta, betrag: betragMitVorzeichen.optional(), betragLokal: betragLokalMitVorzeichen, bemerkung, instrumentId, rundeId, felder: vorgangFelder }),
]);

const stornoEingabe = z.object({ grund: textEingabe(500), valuta: z.iso.date().optional() });

const neueKondition = z
  .object({
    gueltigAb: z.iso.date(),
    satzFix: satzEingabe,
    methode: z.enum(zinsmethode.enumValues),
    zinsperiode: z.enum(zinsperiodenart.enumValues).optional(),
    anker: z.iso.date().optional(),
    gewinnabhaengigSatz: satzEingabe.optional(),
    kappungSatz: satzEingabe.optional(),
    stundungBis: z.iso.date().optional(),
    kapitalisieren: z.boolean().default(false),
    faelligAm: z.iso.date().optional(),
    /** Das darlehensartige Instrument; bei mehreren in der Beteiligung Pflicht. */
    instrumentId: z.uuid().optional(),
  })
  .refine((w) => (w.gewinnabhaengigSatz === undefined) === (w.kappungSatz === undefined), {
    message: "Gewinnabhängiger Satz und Kappungssatz nur gemeinsam angeben",
    path: ["kappungSatz"],
  });

const neuerMeilenstein = z.object({
  bezeichnung: textEingabe(300),
  bedingung: optionalerText(2000),
  frist: z.iso.date().optional(),
  betrag: betragEingabe,
  instrumentId: z.uuid().optional(),
});

const meilensteinErfuellt = z.object({ datum: z.iso.date().optional(), nachweis: optionalerText(2000) });

/** `stichtag` schneidet nach Valuta und Gültigkeit, `stand` nach Erfassungszeitpunkt (Wissensstand, Zeitstempel mit Zeitzone). */
export const sichtAbfrage = z.object({ stichtag: z.iso.date().optional(), stand: z.iso.datetime({ offset: true }).optional() });
const rundenAbfrage = z.object({ stichtag: z.iso.date().optional(), alle: z.enum(["0", "1"]).optional() });

const jahresParam = z.object({ id: z.uuid(), jahr: z.coerce.number().int().min(1900).max(2200) });

export function beteiligungInstrumentRouten(db: Db) {
  return new Hono()
    /**
     * Schreibt einen Vorgang auf ein Instrument der Beteiligung: Zusage, Auszahlung (optional zu einer Tranche), Rückfluss, Tilgung, Zinszahlung,
     * Dividende, Wertberichtigung. `instrumentId` ist Pflicht, wenn die Beteiligung mehrere Instrumente hat.
     */
    .post("/vorgaenge", pruefe("param", idParam), pruefe("json", neuerVorgang), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => bucheVorgang(tx, protokoll, id, { ...eingabe, felder: await pruefeNeueWerte(tx, c, "vorgang", eingabe.felder) }));
      return c.json(ergebnis, 201);
    })
    /** Neue Version der Konditionen (Vertragsänderung = neue Zeile). */
    .post("/konditionen", pruefe("param", idParam), pruefe("json", neueKondition), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      const ergebnis = await schreibe(db, c, (tx, protokoll) => legeKonditionAn(tx, protokoll, id, eingabe));
      return c.json(ergebnis, 201);
    })
    /** Alter Pfad der Tranche: legt sie am Instrument der Beteiligung an (ohne Prüfung gegen die Zusage; `POST /instrumente/:id/tranchen` prüft sie). */
    .post("/meilensteine", pruefe("param", idParam), pruefe("json", neuerMeilenstein), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      const zeile = await schreibe(db, c, async (tx, protokoll) => {
        const b = await sperreBeteiligung(tx, id);
        const i = await loeseInstrument(tx, b, eingabe.instrumentId);
        const { tranche } = await legeTrancheAn(tx, protokoll, i.id, { bezeichnung: eingabe.bezeichnung, betrag: eingabe.betrag, bedingung: eingabe.bedingung, geplantAm: eingabe.frist ?? null, pruefeZusage: false }, "meilenstein");
        return tranche;
      });
      return c.json(zeile, 201);
    })
    /** Jahresüberschuss eines Kalenderjahres setzen oder ersetzen (Bemessung der gewinnabhängigen Verzinsung). */
    .put("/jahresueberschuss/:jahr", pruefe("param", jahresParam), pruefe("json", z.object({ betrag: z.string().regex(/^-?\d{1,16}(\.\d{1,2})?$/, "Betrag mit höchstens zwei Nachkommastellen erwartet") })), async (c) => {
      const { id, jahr } = c.req.valid("param");
      const { betrag } = c.req.valid("json");
      const zeile = await schreibe(db, c, async (tx, protokoll) => {
        await sperreBeteiligung(tx, id);
        const [vorher] = await tx.select().from(jahresueberschuss).where(and(eq(jahresueberschuss.beteiligungId, id), eq(jahresueberschuss.jahr, jahr)));
        const wert = new Decimal(betrag).toFixed(2);
        if (vorher) {
          const [nachher] = await tx.update(jahresueberschuss).set({ betrag: wert, erfasstAm: new Date() }).where(eq(jahresueberschuss.id, vorher.id)).returning();
          await protokoll("aendern", "jahresueberschuss", vorher.id, vorher, nachher);
          return nachher;
        }
        const [neu] = await tx.insert(jahresueberschuss).values({ beteiligungId: id, jahr, betrag: wert }).returning();
        if (!neu) throw new Error("Jahresüberschuss nicht angelegt");
        await protokoll("anlegen", "jahresueberschuss", neu.id, null, neu);
        return neu;
      });
      return c.json(zeile, 200);
    })
    /**
     * Finanzierungsrunden des Unternehmens der Beteiligung mit Positionen. Mit `alle=1` ohne Schnitt am Stichtag
     * (z. B. für die Wahl der Zielrunde einer Wandlung, die nach dem Stichtag der Seite liegen kann); sonst bis `stichtag`.
     */
    .get("/runden", pruefe("param", idParam, { query: rundenAbfrage }), pruefe("query", rundenAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, alle } = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        const [b] = await tx.select().from(beteiligung).where(eq(beteiligung.id, id));
        if (!b) return null;
        return ladeRunden(tx, b.organisationId, b.fondsId, alle === "1" ? null : (stichtag ?? (await standardStichtag(tx, b.fondsId))));
      });
      if (!daten) return fehlerAntwort(c, 404, "BETEILIGUNG_NICHT_GEFUNDEN", "Beteiligung nicht gefunden.");
      return c.json({ daten }, 200);
    })
    /** Alles Instrumentspezifische einer Beteiligung: Konditionen, Meilensteine, Zustand, Buchwert mit Herkunft. */
    .get("/instrumentdaten", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      // Abfrageparameter bewusst nicht im Routentyp deklariert (bestehende Aufrufer rufen ohne sie auf), aber geprüft.
      const { stichtag, stand } = liesAbfrage(c, sichtAbfrage);
      const daten = await lese(db, (tx) => ladeInstrumentdaten(tx, id, { stichtag, stand }));
      if (!daten) return fehlerAntwort(c, 404, "BETEILIGUNG_NICHT_GEFUNDEN", "Beteiligung nicht gefunden.");
      return c.json(daten, 200);
    })
    /**
     * Zinsen der Beteiligung je darlehensartigem Instrument zu Stichtag und Wissensstand: Konditionen (Stand am Stichtag), aufgelaufen, gebucht,
     * kapitalisiert, gezahlt, offen, nächste Fälligkeit und Perioden mit Status, dazu Summen über die Instrumente.
     */
    .get("/zinsen", pruefe("param", idParam, { query: sichtAbfrage }), pruefe("query", sichtAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, stand } = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        const [b] = await tx.select().from(beteiligung).where(eq(beteiligung.id, id));
        if (!b) return null;
        const tag = stichtag ?? (await standardStichtag(tx, b.fondsId, stand));
        await pruefeStichtag(tx, b.fondsId, tag);
        return { beteiligungId: id, ...(await ladeZinsansicht(tx, { beteiligungIds: [id] }, tag, stand)) };
      });
      if (!daten) return fehlerAntwort(c, 404, "BETEILIGUNG_NICHT_GEFUNDEN", "Beteiligung nicht gefunden.");
      return c.json(daten, 200);
    });
}

const rundeZuordnung = z.object({ rundeId: z.uuid().nullable() });

export function vorgangRouten(db: Db) {
  return new Hono()
    /**
     * Ordnet einen Vorgang einer Finanzierungsrunde des Unternehmens zu oder entfernt die Zuordnung (`rundeId: null`). Der Vorgang bleibt unverändert, die
     * Zuordnung steht im Änderungsprotokoll (Tabelle `vorgang_runde`). Recht wie beim Buchen am Fonds des Vorgangs (bearbeiter).
     */
    .put("/:id/runde", pruefe("param", idParam), pruefe("json", rundeZuordnung), async (c) => {
      const { id } = c.req.valid("param");
      const { rundeId } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const [v] = await tx.select().from(vorgang).where(eq(vorgang.id, id));
        if (!v) throw new Fachfehler(404, "VORGANG_NICHT_GEFUNDEN", "Vorgang nicht gefunden.");
        await sperreBeteiligung(tx, v.beteiligungId);
        const r = await setzeVorgangRunde(tx, protokoll, v, rundeId);
        return { vorgangId: v.id, rundeId: r.rundeId, quelle: r.rundeId ? ("manuell" as const) : null, geaendert: r.geaendert };
      });
      return c.json(ergebnis, 200);
    })
    .post("/:id/storno", pruefe("param", idParam), pruefe("json", stornoEingabe), async (c) => {
    const { id } = c.req.valid("param");
    const { grund, valuta: gewuenschteValuta } = c.req.valid("json");
    const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
      const [original] = await tx.select().from(vorgang).where(eq(vorgang.id, id));
      if (!original) throw new Fachfehler(404, "VORGANG_NICHT_GEFUNDEN", "Vorgang nicht gefunden.");
      const b = await sperreBeteiligung(tx, original.beteiligungId);
      if (original.storniertVorgangId) throw new Fachfehler(409, "STORNO_UNZULAESSIG", "Ein Storno kann nicht selbst storniert werden.");
      const verkaufId = await verkaufZuVorgang(tx, id);
      if (verkaufId) {
        throw new Fachfehler(409, "VERKAUF_STORNO_UEBER_VERKAUF", "Der Vorgang gehört zu einem Verkauf; bitte den ganzen Verkauf stornieren (POST /verkaeufe/:id/storno).", { verkaufId });
      }
      const vorhandene = await ladeVorgaenge(tx, b.id);
      if (vorhandene.some((v) => v.storniertVorgangId === id)) throw new Fachfehler(409, "BEREITS_STORNIERT", "Der Vorgang ist bereits storniert.");

      if (gewuenschteValuta !== undefined && gewuenschteValuta < original.valuta) {
        throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", {
          felder: [{ feld: "valuta", code: "storno_vor_original", meldung: `Die Valuta des Storno darf nicht vor der des Originals (${original.valuta}) liegen` }],
        });
      }
      const heutigerTag = heute();
      const stornoValuta = gewuenschteValuta ?? (heutigerTag > original.valuta ? heutigerTag : original.valuta);
      await pruefePeriodensperre(tx, b.fondsId, stornoValuta);
      const neu = {
        beteiligungId: b.id,
        art: original.art,
        valuta: stornoValuta,
        betrag: new Decimal(original.betrag).neg().toFixed(2),
        bemerkung: `Storno: ${grund}`,
        kapitalisiert: original.kapitalisiert,
        storniertVorgangId: original.id,
        instrumentId: original.instrumentId,
        trancheId: original.trancheId,
        // Das Storno trägt die Feldwerte des Originals (Etappe 21): Ein Storno hebt den Vorgang auf, die Merkmale bleiben bei beiden Zeilen gleich.
        felder: original.felder,
        // Ebenso den lokalen Betrag (negiert) mit dem festgehaltenen Kurs: Original und Storno heben sich in jeder Währung auf.
        betragLokal: original.betragLokal === null ? null : new Decimal(original.betragLokal).neg().toFixed(2),
        kurs: original.kurs,
        kursId: original.kursId,
      };
      const abgang = await ladeBuchwertabgang(tx, b.id);
      const [instr] = await tx.select().from(instrument).where(eq(instrument.id, original.instrumentId));
      if (!instr) throw new Fachfehler(404, "INSTRUMENT_NICHT_GEFUNDEN", "Instrument nicht gefunden.");
      pruefeNachBuchung(b.id, instr, vorhandene, neu, abgang, BERUEHRT_KAPITAL.has(original.art));
      const [storno] = await tx.insert(vorgang).values(neu).returning();
      if (!storno) throw new Error("Storno nicht angelegt");
      await zinsperiodeAufgeben(tx, original);
      await protokoll("storno", "vorgang", original.id, original, { grund, stornoVorgangId: storno.id });
      await protokoll("anlegen", "vorgang", storno.id, null, storno);
      await ordneRundeZu(tx, protokoll, storno);
      return { storno: alsVorgangJson(storno), original: alsVorgangJson(original) };
    });
    return c.json(ergebnis, 201);
  });
}

export function meilensteinRouten(db: Db) {
  return new Hono().post("/:id/erfuellt", pruefe("param", idParam), pruefe("json", meilensteinErfuellt), async (c) => {
    const { id } = c.req.valid("param");
    const { datum, nachweis } = c.req.valid("json");
    const nachher = await schreibe(db, c, (tx, protokoll) => erfuelleTranche(tx, protokoll, id, datum, nachweis, "meilenstein"));
    return c.json(nachher, 200);
  });
}
