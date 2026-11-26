import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import {
  erzeugeFondsbericht,
  erzeugeFondsberichtExcel,
  erzeugeGremienvorlage,
  erzeugePortfolioliste,
  erzeugeQuartalsbericht,
  type FondsberichtDaten,
} from "@carraway/berichte";
import { eq } from "drizzle-orm";
import { beteiligung, type Db } from "@carraway/db";
import { ladeFondsberichtDaten, ladeGremienDaten, ladeQuartalsDaten, type BerichtsErgaenzung } from "../berichte/daten";
import { pruefeSichtEingabe, sichtEingabe, sichtWahl } from "../berichte/sicht";
import { ladeVorlage } from "../berichte/vorlagen";
import { fehlerAntwort } from "../fehler";
import { standardStichtag } from "../kennzahlen/fonds";
import { dealSichtbar } from "../rechte/sichtbarkeit";
import { heute, KEIN_DATENSATZ, protokolliereLesen } from "../schreiben";
import { lese } from "../zeitlimit";
import { berichtPruefung } from "../berichte-pruefung";

const pruefeApi = berichtPruefung("report");

/**
 * Berichte als Download. Alle Berichte sind Entwürfe mit Wasserzeichen (Freigabe kommt in Etappe 5) und zeigen
 * Stichtag und Wissensstand. Ohne `stand` gilt der aktuelle Wissensstand (Zeitpunkt der Erzeugung).
 */

const PDF = "application/pdf";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const idSchema = z.object({ id: z.uuid() });
const grundAbfrage = {
  stichtag: z.iso.date().optional(),
  stand: z.iso.datetime({ offset: true }).optional(),
  sprache: z.enum(["de", "en"]).default("de"),
};
const pdfOderExcel = z.object({ ...grundAbfrage, ...sichtEingabe, format: z.enum(["pdf", "xlsx"]).default("pdf") });
const nurPdf = z.object({ ...grundAbfrage, format: z.enum(["pdf"]).default("pdf") });
const nurExcel = z.object({ ...grundAbfrage, ...sichtEingabe, format: z.enum(["xlsx"]).default("xlsx") });

/** ASCII-Dateiname: Kleinbuchstaben, Ziffern und Bindestriche. */
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bericht";

function datei(c: Context, daten: Uint8Array, typ: string, name: string) {
  return c.body(Buffer.from(daten), 200, {
    "Content-Type": typ,
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "no-store",
  });
}

/** Daten für den Download; eigene Felder aus der Vorlage des Fonds (`art`), Währungssicht aus der Abfrage (`waehrungssicht`, `vergleichswaehrung`). */
async function ladeFondsberichtDatenFuerRoute(
  db: Db,
  id: string,
  stichtag: string | undefined,
  stand: string | undefined,
  art: "fondsbericht" | "portfolioliste",
  sichtAbfrage: { waehrungssicht?: "fonds" | "lokal" | "vergleich" | undefined; vergleichswaehrung?: string | undefined },
): Promise<{ daten: FondsberichtDaten | null; konfiguration: Awaited<ReturnType<typeof ladeVorlage>> }> {
  const wissensstand = stand ? new Date(stand).toISOString() : new Date().toISOString();
  return lese(db, async (tx) => {
    const tag = stichtag ?? (await standardStichtag(tx, id, stand));
    const konfiguration = await ladeVorlage(tx, id, art);
    const sicht = sichtWahl(sichtAbfrage);
    const ergaenzung: BerichtsErgaenzung = { zusatzfelder: konfiguration.zusatzfelder, ...(sicht.sicht === "fonds" ? {} : { sicht }) };
    return { daten: await ladeFondsberichtDaten(tx, id, tag, stand, wissensstand, ergaenzung), konfiguration };
  });
}

/** 400 bei einer unvollständigen Währungssicht (Vergleich ohne Währung oder Währung ohne Vergleich). */
const sichtFehler = (c: Context, abfrage: Parameters<typeof pruefeSichtEingabe>[0]) => {
  const f = pruefeSichtEingabe(abfrage);
  return f ? fehlerAntwort(c, 400, "invalid_input", "The input is invalid.", [f]) : null;
};

export function berichteFuerFonds(db: Db) {
  return new Hono()
    .get("/fund-report", pruefeApi("param", idSchema, { query: pdfOderExcel }), pruefeApi("query", pdfOderExcel), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, stand, sprache, format, waehrungssicht, vergleichswaehrung } = c.req.valid("query");
      const fehler = sichtFehler(c, { waehrungssicht, vergleichswaehrung });
      if (fehler) return fehler;
      const { daten, konfiguration } = await ladeFondsberichtDatenFuerRoute(db, id, stichtag, stand, "fondsbericht", { waehrungssicht, vergleichswaehrung });
      if (!daten) return fehlerAntwort(c, 404, "fund_not_found", "Fund not found.");
      await protokolliereLesen(db, c, "fonds", id, { bericht: "fondsbericht", format, sprache, stichtag: daten.stichtag, stand: stand ?? null, ...(waehrungssicht && waehrungssicht !== "fonds" ? { waehrungssicht, vergleichswaehrung: vergleichswaehrung ?? null } : {}) });
      const name = `${sprache === "de" ? "fondsbericht" : "fund-report"}-${slug(daten.fonds.kurzname)}-${daten.stichtag}-${sprache === "de" ? "entwurf" : "draft"}`;
      if (format === "xlsx") return datei(c, await erzeugeFondsberichtExcel(daten, sprache, { konfiguration }), XLSX, `${name}.xlsx`);
      return datei(c, erzeugeFondsbericht(daten, sprache, { konfiguration }), PDF, `${name}.pdf`);
    })
    .get("/portfolio-list", pruefeApi("param", idSchema, { query: nurExcel }), pruefeApi("query", nurExcel), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, stand, sprache, waehrungssicht, vergleichswaehrung } = c.req.valid("query");
      const fehler = sichtFehler(c, { waehrungssicht, vergleichswaehrung });
      if (fehler) return fehler;
      const { daten } = await ladeFondsberichtDatenFuerRoute(db, id, stichtag, stand, "portfolioliste", { waehrungssicht, vergleichswaehrung });
      if (!daten) return fehlerAntwort(c, 404, "fund_not_found", "Fund not found.");
      await protokolliereLesen(db, c, "fonds", id, { bericht: "portfolioliste", format: "xlsx", sprache, stichtag: daten.stichtag, stand: stand ?? null, ...(waehrungssicht && waehrungssicht !== "fonds" ? { waehrungssicht, vergleichswaehrung: vergleichswaehrung ?? null } : {}) });
      const name = `${sprache === "de" ? "portfolioliste" : "portfolio-list"}-${slug(daten.fonds.kurzname)}-${daten.stichtag}`;
      return datei(c, await erzeugePortfolioliste(daten, sprache), XLSX, `${name}.xlsx`);
    });
}

export function berichteFuerBeteiligung(db: Db) {
  return new Hono().get("/quarterly-report", pruefeApi("param", idSchema, { query: nurPdf }), pruefeApi("query", nurPdf), async (c) => {
    const { id } = c.req.valid("param");
    const { stichtag, stand, sprache } = c.req.valid("query");
    const wissensstand = stand ? new Date(stand).toISOString() : new Date().toISOString();
    // Die Vorlage des Fonds gilt auch hier (Abschnitte, Einheit, Unternehmenskennzahlen), wie bei der Erzeugung im Freigabeweg.
    const ergebnis = await lese(db, async (tx) => {
      const [b] = await tx.select({ fondsId: beteiligung.fondsId }).from(beteiligung).where(eq(beteiligung.id, id));
      if (!b) return null;
      const konfiguration = await ladeVorlage(tx, b.fondsId, "quartalsbericht");
      const d = await ladeQuartalsDaten(tx, id, stichtag, stand, wissensstand, konfiguration.unternehmenskennzahlen);
      return d ? { d, konfiguration } : null;
    });
    if (!ergebnis) return fehlerAntwort(c, 404, "investment_not_found", "Investment not found.");
    const { d: daten, konfiguration } = ergebnis;
    await protokolliereLesen(db, c, "beteiligung", id, { bericht: "quartalsbericht", format: "pdf", sprache, stichtag: daten.stichtag, stand: stand ?? null });
    const name = `${sprache === "de" ? "quartalsbericht" : "quarterly-report"}-${slug(daten.organisation.name)}-${daten.stichtag}-${sprache === "de" ? "entwurf" : "draft"}`;
    return datei(c, erzeugeQuartalsbericht(daten, sprache, { konfiguration }), PDF, `${name}.pdf`);
  });
}

/** Gremienvorlage: offene Deals in der Phase Investitionsausschuss mit Eckdaten und ihren Beschlüssen. */
export function berichteRouten(db: Db) {
  return new Hono().get("/committee-pack", pruefeApi("query", nurPdf), async (c) => {
    const { sprache, stand } = c.req.valid("query");
    const wissensstand = stand ? new Date(stand).toISOString() : new Date().toISOString();
    const daten = await lese(db, (tx) => ladeGremienDaten(tx, null, heute(), wissensstand, dealSichtbar(c)));
    await protokolliereLesen(db, c, "bericht", KEIN_DATENSATZ, { bericht: "gremienvorlage", format: "pdf", sprache, deals: daten.deals.length });
    const name = `${sprache === "de" ? "gremienvorlage" : "committee-paper"}-${daten.stichtag}-${sprache === "de" ? "entwurf" : "draft"}`;
    return datei(c, erzeugeGremienvorlage(daten, sprache), PDF, `${name}.pdf`);
  });
}
