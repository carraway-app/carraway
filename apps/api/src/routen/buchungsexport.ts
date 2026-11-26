import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  beteiligung,
  buchungsexport,
  buchungsexportPosition,
  buchungsregel,
  fonds,
  fondsBewegung,
  fondsBuchhaltung,
  organisation,
  vorgang,
  zinslauf,
  zinslaufPosition,
  type Db,
} from "@carraway/db";
import { EXTF_KENNUNG, schreibeExtf, type ExtfBuchung, type ExtfProblem } from "@carraway/import";
import { Decimal } from "@carraway/rechenkern";
import { sha256, erstelleStandardSpeicher, type Speicher } from "../berichte/speicher";
import { belegnummern } from "../buchhaltung/belegnummern";
import { Fachfehler, fehlerAntwort } from "../fehler";
import { pruefe } from "../pruefung";
import { fondsSichtbar } from "../rechte/sichtbarkeit";
import { idParam, ladeFonds, protokolliereLesen, schreibe, textEingabe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

/**
 * Buchungsexport im DATEV-Format (Buchungsstapel, EXTF, Etappe 14) für gebuchte Zinsläufe, ausgewählte Vorgänge und Fondsbewegungen
 * (Abruf, Ausschüttung). Konten und Buchungstexte kommen aus der Kontenzuordnung des Fonds je Vorgangsart bzw. Bewegungsart, Belegfeld 1
 * ist die Belegnummer des freigegebenen Belegs. Ein Storno (negativer Betrag, Etappe 4b) wird als Umkehrbuchung geschrieben: positiver
 * Umsatz mit vertauschtem Soll/Haben-Kennzeichen. Ein Storno ist ein eigener Datensatz und damit auch dann exportierbar, wenn sein
 * Original schon exportiert wurde.
 * Eine Buchung wird nur einmal exportiert; ein erneuter Export verlangt `wiederholung` mit Grund und ersetzt die Markierung.
 * Die Datei liegt unveränderlich im Speicher; Abruf = bearbeiter, mit Zeile `gelesen` im Protokoll.
 */

const auswahl = z.object({
  zinslaufId: z.uuid().optional(),
  vorgangIds: z.array(z.uuid()).max(2000).optional(),
  fondsBewegungIds: z.array(z.uuid()).max(2000).optional(),
  wiederholung: z.boolean().default(false),
});
const exportEingabe = auswahl.extend({ grund: textEingabe(500).optional() });

export interface ExportZeile {
  /** Genau eines von beiden ist gesetzt. */
  vorgangId: string | null;
  fondsBewegungId: string | null;
  organisation: string;
  art: string;
  valuta: string;
  betrag: string;
  konto: string;
  gegenkonto: string;
  richtung: "S" | "H";
  buSchluessel: string | null;
  belegfeld: string;
  mitBeleg: boolean;
  buchungstext: string;
  bereitsExportiert: boolean;
}

interface Plan {
  zeilen: ExportZeile[];
  buchungen: ExtfBuchung[];
  kopf: { berater: number; mandant: number; wirtschaftsjahrBeginn: string; sachkontenlaenge: number; datumVon: string; datumBis: string; bezeichnung: string };
  fonds: { kurzname: string };
  datei: { bytes: Uint8Array; anzahl: number; probleme: ExtfProblem[] };
}

/** Postgres-Fehlercode in der Ursachenkette (Drizzle verpackt den Treiberfehler). */
function hatFehlercode(fehler: unknown, code: string): boolean {
  for (let e: unknown = fehler, tiefe = 0; e && tiefe < 5; tiefe++, e = (e as { cause?: unknown }).cause) if ((e as { code?: unknown }).code === code) return true;
  return false;
}

const platzhalter = (text: string, w: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_m, k: string) => w[k] ?? "");

/** Beginn des Wirtschaftsjahres (Monat `wj`), in dem `tag` liegt. */
export function wirtschaftsjahrBeginn(tag: string, wj: number): string {
  const jahr = Number(tag.slice(0, 4));
  const monat = Number(tag.slice(5, 7));
  return `${monat >= wj ? jahr : jahr - 1}-${String(wj).padStart(2, "0")}-01`;
}

async function sammleVorgangIds(tx: Tx, fondsId: string, e: z.infer<typeof auswahl>): Promise<string[]> {
  const ids = new Set<string>(e.vorgangIds ?? []);
  if (e.zinslaufId) {
    const [lauf] = await tx.select().from(zinslauf).where(and(eq(zinslauf.id, e.zinslaufId), eq(zinslauf.fondsId, fondsId)));
    if (!lauf) throw new Fachfehler(404, "ZINSLAUF_NICHT_GEFUNDEN", "Zinslauf nicht gefunden.");
        if (lauf.status !== "gebucht") throw new Fachfehler(409, "ZINSLAUF_STATUS_UNGUELTIG", `Der Zinslauf hat den Status „${lauf.status}“; exportiert werden nur gebuchte Läufe.`, { status: lauf.status, erlaubt: ["gebucht"] });
    const pos = await tx.select({ v: zinslaufPosition.vorgangId }).from(zinslaufPosition).where(eq(zinslaufPosition.zinslaufId, e.zinslaufId));
    for (const p of pos) if (p.v) ids.add(p.v);
  }
  return [...ids];
}

/** Baut Zeilen und Datei, ohne zu schreiben. Prüft Konfiguration, Kontenzuordnung, Fonds und Doppelexport. */
async function plane(tx: Tx, fondsId: string, e: z.infer<typeof auswahl>): Promise<Plan> {
  const [fz] = await tx.select().from(fonds).where(eq(fonds.id, fondsId));
  if (!fz) throw new Fachfehler(404, "FONDS_NICHT_GEFUNDEN", "Fonds nicht gefunden.");
  const [k] = await tx.select().from(fondsBuchhaltung).where(eq(fondsBuchhaltung.fondsId, fondsId));
  if (!k || k.beraternummer === null || k.mandantennummer === null) throw new Fachfehler(409, "BUCHHALTUNG_NICHT_KONFIGURIERT", "Berater- und Mandantennummer des Fonds fehlen.");
  const ids = await sammleVorgangIds(tx, fondsId, e);
  const bewegungIds = [...new Set(e.fondsBewegungIds ?? [])];
  if (ids.length === 0 && bewegungIds.length === 0) throw new Fachfehler(409, "BUCHUNGSEXPORT_LEER", "Es gibt nichts zu exportieren.");
  const vorgaenge = ids.length
    ? await tx
        .select({ v: vorgang, fondsId: beteiligung.fondsId, organisation: organisation.name })
        .from(vorgang)
        .innerJoin(beteiligung, eq(beteiligung.id, vorgang.beteiligungId))
        .innerJoin(organisation, eq(organisation.id, beteiligung.organisationId))
        .where(inArray(vorgang.id, ids))
    : [];
  const bewegungen = bewegungIds.length ? await tx.select().from(fondsBewegung).where(inArray(fondsBewegung.id, bewegungIds)) : [];
  // Buchungen anderer Fonds antworten wie nicht vorhandene (kein Hinweis auf fremde Daten).
  const unbekannt = [...ids.filter((id) => !vorgaenge.some((z) => z.v.id === id && z.fondsId === fondsId)), ...bewegungIds.filter((id) => !bewegungen.some((b) => b.id === id && b.fondsId === fondsId))];
  if (unbekannt.length) throw new Fachfehler(404, "VORGANG_NICHT_GEFUNDEN", "Vorgang nicht gefunden.");
  // Einheitliche Buchungen, nach Valuta und Erfassung geordnet.
  const einheiten = [
    ...vorgaenge.map(({ v, organisation: name }) => ({ id: v.id, istVorgang: true, art: v.art as string, valuta: v.valuta, betrag: v.betrag, bemerkung: v.bemerkung, erfasstAm: v.erfasstAm.getTime(), name })),
    ...bewegungen.map((b) => ({ id: b.id, istVorgang: false, art: b.art as string, valuta: b.valuta, betrag: b.betrag, bemerkung: b.bemerkung, erfasstAm: b.erfasstAm.getTime(), name: fz.name })),
  ].sort((a, b) => a.valuta.localeCompare(b.valuta) || a.erfasstAm - b.erfasstAm || a.id.localeCompare(b.id));
  const regeln = new Map((await tx.select().from(buchungsregel).where(eq(buchungsregel.fondsId, fondsId))).map((r) => [r.quelle as string, r]));
  const fehlend = [...new Set(einheiten.map((z) => z.art))].filter((a) => !regeln.has(a));
  if (fehlend.length) throw new Fachfehler(409, "BUCHUNGSREGEL_FEHLT", "Für eine Vorgangsart fehlt die Kontenzuordnung.", { arten: fehlend });
  const schonExportiert = new Set<string>();
  if (ids.length) for (const x of await tx.select({ v: buchungsexportPosition.vorgangId }).from(buchungsexportPosition).where(and(eq(buchungsexportPosition.aktiv, true), inArray(buchungsexportPosition.vorgangId, ids)))) if (x.v) schonExportiert.add(x.v);
  if (bewegungIds.length) for (const x of await tx.select({ b: buchungsexportPosition.fondsBewegungId }).from(buchungsexportPosition).where(and(eq(buchungsexportPosition.aktiv, true), inArray(buchungsexportPosition.fondsBewegungId, bewegungIds)))) if (x.b) schonExportiert.add(x.b);
  if (schonExportiert.size && !e.wiederholung) throw new Fachfehler(409, "BUCHUNGSEXPORT_BEREITS_EXPORTIERT", "Vorgänge sind schon exportiert; ein erneuter Export muss ausdrücklich verlangt werden.", { vorgangIds: [...schonExportiert] });
  const nummern = await belegnummern(tx, fondsId, ids, bewegungIds);
  const zeilen: ExportZeile[] = einheiten.map((v) => {
    const r = regeln.get(v.art)!;
    const nummer = nummern.get(v.id);
    return {
      vorgangId: v.istVorgang ? v.id : null,
      fondsBewegungId: v.istVorgang ? null : v.id,
      organisation: v.name,
      art: v.art,
      valuta: v.valuta,
      betrag: new Decimal(v.betrag).toFixed(2),
      konto: r.konto,
      gegenkonto: r.gegenkonto,
      richtung: r.richtung as "S" | "H",
      buSchluessel: r.buSchluessel,
      belegfeld: nummer ?? `FND-${v.id.slice(0, 8).toUpperCase()}`,
      mitBeleg: nummer !== undefined,
      buchungstext: platzhalter(r.buchungstext, { organisation: v.istVorgang ? v.name : "", art: v.art, valuta: v.valuta, bemerkung: v.bemerkung ?? "" }),
      bereitsExportiert: schonExportiert.has(v.id),
    };
  });
  const datumVon = zeilen[0]!.valuta;
  const datumBis = zeilen.at(-1)!.valuta;
  const kopf = {
    berater: k.beraternummer,
    mandant: k.mandantennummer,
    wirtschaftsjahrBeginn: wirtschaftsjahrBeginn(datumVon, k.wirtschaftsjahrBeginn),
    sachkontenlaenge: k.sachkontenlaenge,
    datumVon,
    datumBis,
    bezeichnung: `${fz.kurzname} ${datumVon.slice(0, 7)}`.slice(0, 30),
  };
  const buchungen: ExtfBuchung[] = zeilen.map((z) => ({ betrag: z.betrag, richtung: z.richtung, konto: z.konto, gegenkonto: z.gegenkonto, buSchluessel: z.buSchluessel, belegdatum: z.valuta, belegfeld1: z.belegfeld, buchungstext: z.buchungstext }));
  const datei = schreibeExtf({ ...kopf, erzeugtAm: new Date() }, buchungen);
  return { zeilen, buchungen, kopf, fonds: { kurzname: fz.kurzname }, datei };
}

const dateiBasis = (kurzname: string, datumVon: string, datumBis: string) => `EXTF_Buchungsstapel_${kurzname.replace(/[^A-Za-z0-9]+/g, "_")}_${datumVon.replaceAll("-", "")}-${datumBis.replaceAll("-", "")}`;

export function fondsExportRouten(db: Db, speicher: Speicher = erstelleStandardSpeicher()) {
  return new Hono()
    /** Zeigt, was exportiert würde (Konten, Belegfeld, Buchungstext), und die Probleme; schreibt nichts. */
    .post("/:id/buchungsexport/vorschau", pruefe("param", idParam), pruefe("json", auswahl), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const p = await lese(db, (tx) => plane(tx, id, e));
      return c.json({ format: EXTF_KENNUNG, datumVon: p.kopf.datumVon, datumBis: p.kopf.datumBis, wirtschaftsjahrBeginn: p.kopf.wirtschaftsjahrBeginn, sachkontenlaenge: p.kopf.sachkontenlaenge, zeilen: p.zeilen, anzahl: p.datei.anzahl, probleme: p.datei.probleme, ohneBeleg: p.zeilen.filter((z) => !z.mitBeleg).map((z) => z.vorgangId ?? z.fondsBewegungId!) }, 200);
    })
    /** Erzeugt die Datei, speichert sie unveränderlich und markiert die Vorgänge als exportiert. */
    .post("/:id/buchungsexport", pruefe("param", idParam), pruefe("json", exportEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      if (e.wiederholung && !e.grund) throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder: [{ feld: "grund", code: "grund_erforderlich", meldung: "Ein erneuter Export braucht einen Grund" }] });
      let ergebnis;
      try {
        ergebnis = await schreibe(db, c, async (tx, protokoll) => {
          // Exporte eines Fonds laufen nacheinander: Die Prüfung auf schon Exportiertes sieht sonst keinen parallelen Lauf.
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`export:${id}`}))`);
          await ladeFonds(tx, id);
          const p = await plane(tx, id, e);
          if (p.datei.probleme.length) throw new Fachfehler(409, "BUCHUNGSEXPORT_PROBLEME", "Die Datei hat Probleme und wird nicht erzeugt.", { probleme: p.datei.probleme });
          const hash = sha256(p.datei.bytes);
          const exportId = crypto.randomUUID();
          const schluessel = `buchungsexporte/${exportId}/${hash}.csv`;
          await speicher.schreibe(schluessel, p.datei.bytes);
          const summe = p.zeilen.reduce((s, z) => s.plus(z.betrag), new Decimal(0));
          const [neu] = await tx
            .insert(buchungsexport)
            .values({ id: exportId, fondsId: id, formatVersion: EXTF_KENNUNG, erzeugtVon: protokoll.akteur, datumVon: p.kopf.datumVon, datumBis: p.kopf.datumBis, anzahl: p.datei.anzahl, summe: summe.toFixed(2), wiederholung: e.wiederholung, grund: e.grund ?? null, dateiName: `${dateiBasis(p.fonds.kurzname, p.kopf.datumVon, p.kopf.datumBis)}.csv`, dateiSchluessel: schluessel, dateiSha256: hash, dateiGroesse: p.datei.bytes.length })
            .returning();
          const vorgangIds = p.zeilen.flatMap((z) => (z.vorgangId ? [z.vorgangId] : []));
          const bewegungIds = p.zeilen.flatMap((z) => (z.fondsBewegungId ? [z.fondsBewegungId] : []));
          if (e.wiederholung) {
            if (vorgangIds.length) await tx.update(buchungsexportPosition).set({ aktiv: false }).where(and(eq(buchungsexportPosition.aktiv, true), inArray(buchungsexportPosition.vorgangId, vorgangIds)));
            if (bewegungIds.length) await tx.update(buchungsexportPosition).set({ aktiv: false }).where(and(eq(buchungsexportPosition.aktiv, true), inArray(buchungsexportPosition.fondsBewegungId, bewegungIds)));
          }
          await tx.insert(buchungsexportPosition).values(p.zeilen.map((z) => ({ exportId, vorgangId: z.vorgangId, fondsBewegungId: z.fondsBewegungId, belegfeld: z.belegfeld, betrag: z.betrag })));
          await protokoll("exportieren", "buchungsexport", exportId, null, { fondsId: id, anzahl: p.datei.anzahl, summe: summe.toFixed(2), sha256: hash, wiederholung: e.wiederholung, grund: e.grund ?? null });
          return { ...neu!, ohneBeleg: p.zeilen.filter((z) => !z.mitBeleg).map((z) => z.vorgangId ?? z.fondsBewegungId!) };
        });
      } catch (fehler) {
        if (hatFehlercode(fehler, "23505")) throw new Fachfehler(409, "BUCHUNGSEXPORT_BEREITS_EXPORTIERT", "Vorgänge sind schon exportiert; ein erneuter Export muss ausdrücklich verlangt werden.");
        throw fehler;
      }
      return c.json(ergebnis, 201);
    })
    .get("/:id/buchungsexporte", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        return tx
          .select({ id: buchungsexport.id, fondsId: buchungsexport.fondsId, formatVersion: buchungsexport.formatVersion, erzeugtVon: buchungsexport.erzeugtVon, erzeugtAm: buchungsexport.erzeugtAm, datumVon: buchungsexport.datumVon, datumBis: buchungsexport.datumBis, anzahl: buchungsexport.anzahl, summe: buchungsexport.summe, wiederholung: buchungsexport.wiederholung, grund: buchungsexport.grund, dateiName: buchungsexport.dateiName, dateiSha256: buchungsexport.dateiSha256 })
          .from(buchungsexport)
          .where(and(eq(buchungsexport.fondsId, id), fondsSichtbar(c, buchungsexport.fondsId)))
          .orderBy(desc(buchungsexport.erzeugtAm), asc(buchungsexport.id));
      });
      return c.json({ daten }, 200);
    });
}

export function buchungsexportRouten(db: Db, speicher: Speicher = erstelleStandardSpeicher()) {
  return new Hono().get("/:id/datei", pruefe("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const x = await lese(db, async (tx) => {
      const [z] = await tx.select().from(buchungsexport).where(eq(buchungsexport.id, id));
      return z ?? null;
    });
    if (!x) return fehlerAntwort(c, 404, "BUCHUNGSEXPORT_NICHT_GEFUNDEN", "Buchungsexport nicht gefunden.");
    const bytes = await speicher.lese(x.dateiSchluessel);
    if (sha256(bytes) !== x.dateiSha256) throw new Fachfehler(500, "DATEI_BESCHAEDIGT", "Die gespeicherte Datei stimmt nicht mehr mit ihrem Hash überein.");
    await protokolliereLesen(db, c, "buchungsexport", id, { buchungsexport: "datei", dateiName: x.dateiName, sha256: x.dateiSha256 });
    return c.body(Buffer.from(bytes), 200, { "Content-Type": "text/csv; charset=windows-1252", "Content-Disposition": `attachment; filename="${x.dateiName}"`, "Cache-Control": "no-store", "X-Datei-Sha256": x.dateiSha256 });
  });
}
