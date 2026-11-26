import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { organisation } from "@carraway/db";
import { Fachfehler } from "../fehler";
import type { MailKontext } from "../mail/auftraege";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { legeEintragAn, legeEreignisAn, meldeEintrag, meldeEreignis } from "./dienst";
import { eintragWerte, ereignisWerte, type EintragWerte, type EreignisWerte } from "./typen";

/**
 * Sammelaktualisierung aus einer strukturierten Datei (JSON oder CSV). Alles oder nichts: Gibt es einen Fehler in einer Zeile, wird keine
 * Zeile übernommen und alle Fehler stehen im Ergebnis (`register_import_invalid`). Die Datei kommt von der Person (z. B. aus Auszügen
 * oder einem lizenzierten Datenbezug); Carraway ruft dafür kein Portal ab.
 */

export const MAX_ZEILEN = 2000;
export const MAX_ZEICHEN = 5_000_000;

export interface ImportFehler {
  zeile: number;
  feld: string;
  meldung: string;
}

interface Zeile {
  nr: number;
  organisationId?: string;
  organisationName?: string;
  eintrag: unknown;
  ereignisse: unknown;
}

const zeilenSchema = z.object({
  organisationId: z.uuid().optional(),
  organisationName: z.string().trim().min(1).max(300).optional(),
});

const ereignisListe = z.array(ereignisWerte).max(200);

const personenListe =(text: string | undefined) =>
  (text ?? "")
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const m = /^(.*?)\s*\((.*)\)$/.exec(t);
      return m ? { name: m[1]!.trim(), funktion: m[2]!.trim() } : { name: t, funktion: "" };
    });

/** Einfache CSV-Zerlegung mit Anführungszeichen; Trennzeichen `;` oder `,` nach der Kopfzeile. */
export function liesCsv(text: string): string[][] {
  const kopf = text.split(/\r?\n/, 1)[0] ?? "";
  const trenner = kopf.split(";").length >= kopf.split(",").length ? ";" : ",";
  const zeilen: string[][] = [];
  let zelle = "";
  let zeile: string[] = [];
  let anfuehrung = false;
  for (let i = 0; i < text.length; i++) {
    const z = text[i]!;
    if (anfuehrung) {
      if (z === '"' && text[i + 1] === '"') {
        zelle += '"';
        i++;
      } else if (z === '"') anfuehrung = false;
      else zelle += z;
    } else if (z === '"') anfuehrung = true;
    else if (z === trenner) {
      zeile.push(zelle);
      zelle = "";
    } else if (z === "\n" || z === "\r") {
      if (z === "\r" && text[i + 1] === "\n") i++;
      zeile.push(zelle);
      zelle = "";
      if (zeile.some((c) => c.trim() !== "")) zeilen.push(zeile);
      zeile = [];
    } else zelle += z;
  }
  zeile.push(zelle);
  if (zeile.some((c) => c.trim() !== "")) zeilen.push(zeile);
  return zeilen;
}

function ausCsv(text: string): Zeile[] {
  const [kopf, ...rest] = liesCsv(text);
  if (!kopf) return [];
  const namen = kopf.map((k) => k.trim());
  return rest.map((zellen, i) => {
    const w = (n: string) => {
      const v = zellen[namen.indexOf(n)]?.trim();
      return v === undefined || v === "" ? undefined : v;
    };
    return {
      nr: i + 2,
      organisationId: w("organisationId"),
      organisationName: w("organisationName"),
      eintrag: {
        gericht: w("gericht"),
        registerart: w("registerart"),
        nummer: w("nummer"),
        firma: w("firma"),
        rechtsform: w("rechtsform") ?? null,
        sitz: w("sitz") ?? null,
        anschrift: w("anschrift") ?? null,
        gegenstand: w("gegenstand") ?? null,
        kapital: w("kapital") ?? null,
        kapitalWaehrung: w("kapitalWaehrung") ?? "EUR",
        vertretung: personenListe(w("vertretung")),
        prokura: personenListe(w("prokura")),
        standDatum: w("standDatum"),
      },
      ereignisse: [],
    };
  });
}

function ausJson(text: string): Zeile[] {
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    throw new Fachfehler(422, "register_import_invalid", "The file is not valid JSON.", { zeilen: [{ zeile: 0, feld: "inhalt", meldung: "Kein gültiges JSON." }] });
  }
  const liste = roh && typeof roh === "object" && !Array.isArray(roh) ? (roh as { eintraege?: unknown }).eintraege : roh;
  if (!Array.isArray(liste)) throw new Fachfehler(422, "register_import_invalid", "Expected a list `eintraege`.", { zeilen: [{ zeile: 0, feld: "eintraege", meldung: "Liste fehlt." }] });
  return liste.map((z, i) => {
    const { organisationId, organisationName, ereignisse, ...eintrag } = (z ?? {}) as Record<string, unknown>;
    return { nr: i + 1, organisationId: organisationId as string | undefined, organisationName: organisationName as string | undefined, eintrag, ereignisse: ereignisse ?? [] };
  });
}

export interface GeprueftesImport {
  zeilen: { nr: number; organisationId: string; eintrag: EintragWerte; ereignisse: EreignisWerte[] }[];
}

/** Liest die Datei, prüft Form und Organisationen. Wirft `register_import_invalid` mit allen Fehlern. */
export async function pruefeImport(tx: Tx, format: "json" | "csv", text: string): Promise<GeprueftesImport> {
  const roh = format === "csv" ? ausCsv(text) : ausJson(text);
  if (roh.length > MAX_ZEILEN) throw new Fachfehler(422, "register_import_invalid", `At most ${MAX_ZEILEN} rows per file.`, { zeilen: [{ zeile: 0, feld: "inhalt", meldung: `Mehr als ${MAX_ZEILEN} Zeilen.` }] });
  const fehler: ImportFehler[] = [];
  const ok: GeprueftesImport["zeilen"] = [];
  for (const z of roh) {
    const kopf = zeilenSchema.safeParse({ organisationId: z.organisationId, organisationName: z.organisationName });
    const eintrag = eintragWerte.safeParse(z.eintrag);
    const ereignisse = ereignisListe.safeParse(z.ereignisse ?? []);
    for (const r of [kopf, eintrag, ereignisse]) if (!r.success) for (const i of r.error.issues) fehler.push({ zeile: z.nr, feld: i.path.join(".") || "zeile", meldung: i.message });
    if (!kopf.success || !eintrag.success || !ereignisse.success) continue;
    let organisationId = kopf.data.organisationId;
    if (!organisationId) {
      if (!kopf.data.organisationName) {
        fehler.push({ zeile: z.nr, feld: "organisationName", meldung: "Organisation (ID oder Name) fehlt." });
        continue;
      }
      const treffer = await tx
        .select({ id: organisation.id })
        .from(organisation)
        .where(and(isNull(organisation.zusammengefuehrtIn), sql`lower(${organisation.name}) = lower(${kopf.data.organisationName})`));
      if (treffer.length !== 1) {
        fehler.push({ zeile: z.nr, feld: "organisationName", meldung: treffer.length === 0 ? "Organisation nicht gefunden." : "Name nicht eindeutig, bitte die ID angeben." });
        continue;
      }
      organisationId = treffer[0]!.id;
    } else {
      const [o] = await tx.select({ z: organisation.zusammengefuehrtIn }).from(organisation).where(eq(organisation.id, organisationId));
      if (!o || o.z) {
        fehler.push({ zeile: z.nr, feld: "organisationId", meldung: "Organisation nicht gefunden." });
        continue;
      }
    }
    ok.push({ nr: z.nr, organisationId, eintrag: eintrag.data, ereignisse: ereignisse.data });
  }
  if (fehler.length > 0) throw new Fachfehler(422, "register_import_invalid", "The file contains errors; nothing was imported.", { zeilen: fehler.slice(0, 200), anzahlFehler: fehler.length });
  return { zeilen: ok };
}

export interface ImportErgebnis {
  angelegt: number;
  unveraendert: number;
  ereignisse: number;
}

export async function uebernehmeImport(tx: Tx, protokoll: Protokollant, geprueft: GeprueftesImport, mail?: MailKontext): Promise<ImportErgebnis> {
  const ergebnis: ImportErgebnis = { angelegt: 0, unveraendert: 0, ereignisse: 0 };
  for (const z of geprueft.zeilen) {
    const { eintrag, neu } = await legeEintragAn(tx, protokoll, z.organisationId, z.eintrag, "import");
    if (neu) {
      ergebnis.angelegt++;
      await meldeEintrag(tx, z.organisationId, eintrag.firma, eintrag.standDatum);
    } else ergebnis.unveraendert++;
    for (const e of z.ereignisse) {
      const r = await legeEreignisAn(tx, protokoll, z.organisationId, e, "import", eintrag.id);
      if (r.neu) {
        ergebnis.ereignisse++;
        await meldeEreignis(tx, z.organisationId, r.ereignis, eintrag.firma, { protokoll, kontext: mail });
      }
    }
  }
  return ergebnis;
}
