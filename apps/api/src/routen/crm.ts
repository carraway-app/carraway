import { kontaktJson, pruefeEnglisch } from "../kontakte/http";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { ansicht, ansichtArt, aufgabe, benutzer, beschaeftigung, dealKontakt, deal, feldDefinition, liste, listeEintrag, organisation, person, dealPhase, type Db } from "@carraway/db";
import { aktuellerAkteur, hatRolle } from "../anmeldung/akteur";
import { abfrageSchema, ansichtKonfigSchema, beschreibeFelder, GRUPPIERBAR, fuehreAbfrageAus, fuehreBoardAus, fuehreGruppierungAus, gruppenSchema, ladeAlleZeilen, ladeTrefferIds, type Kontext } from "../crm/abfrage";
import { aendereDatensatz, archiviere, beschaeftigungEingabe, ladeZeile, spiegleHauptbeschaeftigung, verlangeDealSchreibrecht, verlangeDealSichtbar } from "../crm/datensatz";
import { erzeugeCsv } from "../crm/export";
import { FELD_OBJEKTE, FELD_TYPEN, OBJEKTE, feldArray, ladeFelder, optionenSchema, pruefeFelder, schluesselAusName, type FeldDef, type Objekt, type Option } from "../crm/felder";
import { loeseFelder } from "../crm/objekte";
import { FELD_ZIELE } from "../felder/ziele";
import { ladeVerknuepfungen } from "../crm/verknuepfungen";
import { dealFondsFuerAufgabe, pruefeZustaendigerZugriff, sucheZustaendige } from "../crm/zustaendige";
import { Fachfehler } from "../fehler";
import { dealSichtbar } from "../rechte/sichtbarkeit";
import { idParam, KEIN_DATENSATZ, protokolliereLesen, schreibe, textEingabe, optionalerText } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";
import { wechselePhase } from "./deals";
import { crmImportRouten } from "./crm-import";

const objektParam = z.object({ objekt: z.enum(OBJEKTE) });
const objektIdParam = z.object({ objekt: z.enum(OBJEKTE), id: z.uuid() });

const sichtbarFuer = (c: Context, objekt: Objekt) => (objekt === "deal" ? dealSichtbar(c) : undefined);
const kontextFuer = (c: Context, objekt: Objekt, ids?: string[]): Kontext => ({ sichtbar: sichtbarFuer(c, objekt), dealSichtbar: dealSichtbar(c), ...(ids ? { ids } : {}) });
const istGlobal = (c: Context) => aktuellerAkteur(c).globalVerwalter;


/** Tabellen der CRM-Datensätze (Listen und Gruppen); die Werte eigener Felder anderer Objekte regelt `felder/ziele.ts`. */
const TAB = { organisation, person, deal } as const;

// Felddefinitionen -----------------------------------------------------------------------------------------------

const neuesFeld = z.object({
  /** CRM-Objekte und Portfolio-Objekte (Fonds, Runde, Instrument, Beteiligung, Vorgang); Felder einer Liste gibt es nur für CRM-Objekte. */
  objekt: z.enum(FELD_OBJEKTE),
  listeId: z.uuid().optional(),
  name: textEingabe(80),
  typ: z.enum(FELD_TYPEN),
  optionen: z.record(z.string(), z.unknown()).optional(),
  /** Ohne Angabe aus dem Namen gebildet; nach dem Anlegen fest. */
  schluessel: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).optional(),
});

const aenderungFeld = z
  .object({ name: textEingabe(80).optional(), optionen: z.record(z.string(), z.unknown()).optional(), position: z.number().int().min(0).max(10000).optional() })
  .refine((w) => Object.values(w).some((x) => x !== undefined), { message: "At least one field must be specified" });

async function verlangeFeldRecht(tx: Tx, c: Context, listeId: string | null) {
  if (istGlobal(c)) return;
  if (listeId) {
    const [l] = await tx.select({ besitzerId: liste.besitzerId }).from(liste).where(eq(liste.id, listeId));
    if (l && l.besitzerId === aktuellerAkteur(c).id) return;
  }
  throw new Fachfehler(403, "field_permission", listeId ? "Only the owner of a list and global admins can change its fields." : "Only global admins can define custom fields.");
}

async function ladeDefinition(tx: Tx, id: string): Promise<FeldDef> {
  const [d] = await tx.select().from(feldDefinition).where(eq(feldDefinition.id, id)).for("update");
  if (!d) throw new Fachfehler(404, "field_not_found", "Field not found.");
  return d as FeldDef;
}

async function verwendungen(tx: Tx, def: FeldDef, optionen: string[]): Promise<number> {
  // Tabelle und Spalte der Werte stehen im Verzeichnis der Feldziele (Etappe 21); die Namen sind Konstanten, nie Eingaben.
  const ziel = FELD_ZIELE[def.objekt];
  const quelle = def.listeId ? sql`${listeEintrag}` : sql.raw(`"${ziel.tabelle}"`);
  const spalte = def.listeId ? sql`${listeEintrag.felder}` : sql.raw(`"${ziel.tabelle}"."${ziel.spalte}"`);
  const bedingung = def.typ === "mehrfachauswahl" ? sql`jsonb_exists_any(${spalte} -> ${def.id}::text, ${feldArray(optionen, "text")})` : sql`${spalte} ->> ${def.id}::text = ANY(${feldArray(optionen, "text")})`;
  const rows = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${quelle} WHERE ${bedingung}`);
  return rows.rows[0]?.n ?? 0;
}

// Ansichten, Listen ----------------------------------------------------------------------------------------------

const ansichtEingabe = z.object({
  objekt: z.enum(OBJEKTE),
  listeId: z.uuid().optional(),
  name: textEingabe(80),
  art: z.enum(ansichtArt.enumValues).default("tabelle"),
  konfig: ansichtKonfigSchema,
  geteilt: z.boolean().default(false),
});

const ansichtAenderung = z
  .object({ name: textEingabe(80).optional(), art: z.enum(ansichtArt.enumValues).optional(), konfig: ansichtKonfigSchema.optional(), geteilt: z.boolean().optional(), standard: z.boolean().optional() })
  .refine((w) => Object.values(w).some((x) => x !== undefined), { message: "At least one field must be specified" });

/** Alle Feldschlüssel einer Konfiguration müssen zum Objekt gehören (sonst bekäme eine Ansicht beim Laden einen Fehler). */
async function pruefeKonfig(tx: Tx, objekt: Objekt, listeId: string | null, konfig: z.infer<typeof ansichtKonfigSchema>) {
  const beschrieben = await beschreibeFelder(tx, objekt, listeId);
  const felder = new Set(beschrieben.map((f) => f.schluessel));
  const gruppenTyp = beschrieben.find((f) => f.schluessel === konfig.gruppierung)?.typ;
  if (konfig.gruppierung && gruppenTyp && !(GRUPPIERBAR as readonly string[]).includes(gruppenTyp)) {
    throw new Fachfehler(400, "query_invalid", "Grouping requires a field of type select, multi-select, internal person, link or checkbox.", { felder: [{ feld: konfig.gruppierung, code: "not_groupable", meldung: "Field cannot be grouped" }] });
  }
  const genannt = [...(konfig.spalten.map((s) => s.feld)), ...konfig.sortierung.map((s) => s.feld), ...(konfig.gruppierung ? [konfig.gruppierung] : [])];
  const sammle = (g: NonNullable<z.infer<typeof ansichtKonfigSchema>["filter"]>): string[] => g.elemente.flatMap((e) => ("elemente" in e ? sammle(e as never) : typeof e.feld === "string" ? [e.feld] : []));
  if (konfig.filter) genannt.push(...sammle(konfig.filter));
  const unbekannt = genannt.filter((f) => !felder.has(f));
  if (unbekannt.length) throw new Fachfehler(400, "query_invalid", "The view references fields that do not exist.", { felder: unbekannt.map((f) => ({ feld: f, code: "unknown_field", meldung: "Unknown field" })) });
}

async function ladeAnsicht(tx: Tx, c: Context, id: string) {
  const akteur = aktuellerAkteur(c);
  const [a] = await tx.select().from(ansicht).where(eq(ansicht.id, id)).for("update");
  if (!a || (!a.geteilt && a.besitzerId !== akteur.id)) throw new Fachfehler(404, "view_not_found", "View not found.");
  return a;
}

const neueListe = z.object({ name: textEingabe(120), beschreibung: optionalerText(1000), objekt: z.enum(OBJEKTE) });

async function ladeListe(tx: Tx, id: string) {
  const [l] = await tx.select().from(liste).where(eq(liste.id, id));
  if (!l || l.archiviertAm) throw new Fachfehler(404, "list_not_found", "List not found.");
  return l;
}

/**
 * Prüft, dass die Datensätze zum Objekt gehören, existieren und für die Person sichtbar sind; gibt die zulässigen IDs zurück.
 * Mit `schreiben` bleiben bei Deals nur die übrig, deren Fonds die Person als Bearbeiter schreiben darf. Andere fallen stillschweigend weg.
 */
async function zulaessigeIds(tx: Tx, c: Context, objekt: Objekt, ids: string[], schreiben = false): Promise<string[]> {
  const eindeutig = [...new Set(ids)];
  if (objekt === "deal") {
    const akteur = aktuellerAkteur(c);
    const rows = await tx.select({ id: deal.id, fondsId: deal.fondsId }).from(deal).where(and(inArray(deal.id, eindeutig), dealSichtbar(c)));
    return rows.filter((r) => !schreiben || r.fondsId === null || hatRolle(akteur, r.fondsId, "bearbeiter", "dealflow")).map((r) => r.id);
  }
  const t = TAB[objekt] as typeof organisation;
  const rows = await tx.select({ id: t.id }).from(t).where(and(inArray(t.id, eindeutig), isNull(t.zusammengefuehrtIn), isNull(t.archiviertAm)));
  return rows.map((r) => r.id);
}

/** Listen ändern (Name, Einträge, Felder, Archivieren) nur die Besitzerin oder der Besitzer und globale Verwalter. */
function verlangeListenRecht(c: Context, l: { besitzerId: string | null }) {
  const akteur = aktuellerAkteur(c);
  if (akteur.globalVerwalter || (l.besitzerId !== null && l.besitzerId === akteur.id)) return;
  throw new Fachfehler(403, "list_permission", "Only the owner of a list and global admins can change it.");
}

/** Anzahl der Einträge je Liste, nur Datensätze, die die Person sehen darf (geteilte Listen verraten keine unsichtbaren Deals). */
async function zaehleSichtbar(tx: Tx, c: Context, listen: { id: string; objekt: Objekt }[]): Promise<Map<string, number>> {
  const aus = new Map<string, number>();
  for (const objekt of OBJEKTE) {
    const ids = listen.filter((l) => l.objekt === objekt).map((l) => l.id);
    if (!ids.length) continue;
    const bedingung = objekt === "deal" ? sql`(${dealSichtbar(c) ?? sql`true`})` : sql`${TAB[objekt].zusammengefuehrtIn} IS NULL AND ${TAB[objekt].archiviertAm} IS NULL`;
    const rows = await tx.execute<{ liste_id: string; n: number }>(
      sql`SELECT le.liste_id, count(*)::int AS n FROM ${listeEintrag} le JOIN ${TAB[objekt]} ON ${TAB[objekt].id} = le.datensatz_id WHERE le.liste_id = ANY(${feldArray(ids, "uuid")}) AND ${bedingung} GROUP BY le.liste_id`,
    );
    for (const r of rows.rows) aus.set(r.liste_id, r.n);
  }
  return aus;
}

// Aufgaben -------------------------------------------------------------------------------------------------------

const neueAufgabe = z
  .object({
    titel: textEingabe(300),
    notiz: optionalerText(5000),
    faellig: z.iso.date().nullable().optional(),
    zustaendigId: z.uuid().nullable().optional(),
    organisationId: z.uuid().optional(),
    personId: z.uuid().optional(),
    dealId: z.uuid().optional(),
  })
  .refine((w) => w.organisationId || w.personId || w.dealId, { message: "Specify at least one reference (organizationId, personId or dealId)", path: ["organisationId"] });

const aenderungAufgabe = z
  .object({ titel: textEingabe(300).optional(), notiz: optionalerText(5000), faellig: z.iso.date().nullable().optional(), zustaendigId: z.uuid().nullable().optional() })
  .refine((w) => Object.values(w).some((x) => x !== undefined), { message: "At least one field must be specified" });

/** Zuständig kann jede aktive angemeldete Person mit Zugriff sein (bei Deal-Aufgaben mit Rolle am Fonds des Deals), siehe `crm/zustaendige.ts`. */
async function pruefeZustaendig(tx: Tx, c: Context, id: string | null | undefined, dealId: string | undefined) {
  if (!id) return;
  await pruefeZustaendigerZugriff(tx, id, await dealFondsFuerAufgabe(tx, c, dealId));
}

async function ladeAufgabe(tx: Tx, c: Context, id: string) {
  const [a] = await tx.select().from(aufgabe).where(eq(aufgabe.id, id)).for("update");
  if (!a) throw new Fachfehler(404, "task_not_found", "Task not found.");
  if (a.dealId) {
    const d = await verlangeDealSichtbar(tx, c, a.dealId).catch(() => {
      throw new Fachfehler(404, "task_not_found", "Task not found.");
    });
    verlangeDealSchreibrecht(c, d.fondsId);
  }
  return a;
}

// Massenaktionen -------------------------------------------------------------------------------------------------

const massenaktion = z.object({
  ids: z.array(z.uuid()).min(1).max(500).optional(),
  /** Alternativ alle Treffer einer Abfrage (höchstens 5000). */
  abfrage: abfrageSchema.optional(),
  aktion: z.discriminatedUnion("art", [
    z.object({ art: z.literal("liste_hinzufuegen"), listeId: z.uuid() }),
    z.object({ art: z.literal("feld_setzen"), feld: z.string().min(1).max(64), wert: z.unknown() }),
    z.object({ art: z.literal("phase"), nachPhase: z.enum(dealPhase.enumValues) }),
    z.object({ art: z.literal("archivieren") }),
  ]),
});

export function crmRouten(db: Db) {
  return new Hono()
    // Felder und Abfragen ------------------------------------------------------------------------------------------
    .get("/objects/:object/fields", pruefeEnglisch("param", objektParam), pruefeEnglisch("query", z.object({ listeId: z.uuid().optional(), archiviert: z.enum(["0", "1"]).default("0") })), async (c) => {
      const { objekt } = c.req.valid("param");
      const { listeId, archiviert } = c.req.valid("query");
      const felder = await lese(db, (tx) => beschreibeFelder(tx, objekt, listeId ?? null, archiviert === "1" && istGlobal(c)));
      return kontaktJson(c, { daten: felder }, 200);
    })
    .post("/objects/:object/query", pruefeEnglisch("param", objektParam), pruefeEnglisch("json", abfrageSchema), async (c) => {
      const { objekt } = c.req.valid("param");
      const ergebnis = await lese(db, (tx) => fuehreAbfrageAus(tx, objekt, c.req.valid("json"), kontextFuer(c, objekt)));
      return kontaktJson(c, ergebnis, 200);
    })
    .post(
      "/objects/:object/board",
      pruefeEnglisch("param", objektParam),
      pruefeEnglisch("json", abfrageSchema.extend({ gruppe: z.string().min(1).max(64), summe: z.string().min(1).max(64).nullable().optional(), kartenProSpalte: z.number().int().min(1).max(100).default(30) })),
      async (c) => {
        const { objekt } = c.req.valid("param");
        const { gruppe, summe, kartenProSpalte, ...abfrage } = c.req.valid("json");
        const ergebnis = await lese(db, (tx) => fuehreBoardAus(tx, objekt, abfrage, gruppe, summe ?? null, kartenProSpalte, kontextFuer(c, objekt)));
        return kontaktJson(c, ergebnis, 200, gruppe);
      },
    )
    /** Gruppen einer Tabellenansicht: Anzahl und Summen je Wert eines Auswahl-, Mehrfachauswahl- oder Personenfeldes, mit derselben Treffermenge wie die Abfrage. */
    .post("/objects/:object/groups", pruefeEnglisch("param", objektParam), pruefeEnglisch("json", abfrageSchema.extend(gruppenSchema.shape)), async (c) => {
      const { objekt } = c.req.valid("param");
      const { gruppe, summen, ...abfrage } = c.req.valid("json");
      const ergebnis = await lese(db, (tx) => fuehreGruppierungAus(tx, objekt, abfrage, gruppe, summen, kontextFuer(c, objekt)));
      return kontaktJson(c, ergebnis, 200, gruppe);
    })
    .post("/objects/:object/export", pruefeEnglisch("param", objektParam), pruefeEnglisch("json", abfrageSchema), async (c) => {
      const { objekt } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      const { felder, zeilen, bezuege } = await lese(db, (tx) => ladeAlleZeilen(tx, objekt, eingabe, kontextFuer(c, objekt)));
      await protokolliereLesen(db, c, "crm_export", KEIN_DATENSATZ, { objekt, zeilen: zeilen.length, spalten: felder.length });
      return c.body(erzeugeCsv(felder, zeilen, bezuege), 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${objekt}-export.csv"` });
    })
    .post("/objects/:object/bulk-actions", pruefeEnglisch("param", objektParam), pruefeEnglisch("json", massenaktion), async (c) => {
      const { objekt } = c.req.valid("param");
      const { ids, abfrage, aktion } = c.req.valid("json");
      if (!ids && !abfrage) throw new Fachfehler(400, "bulk_action_invalid", "Specify ids or query.");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const kandidaten = ids ?? (await ladeTrefferIds(tx, objekt, abfrage!, kontextFuer(c, objekt))).slice(0, 5000);
        if (aktion.art === "phase" && objekt !== "deal") throw new Fachfehler(400, "bulk_action_invalid", "Stages only exist for deals.");
        if (aktion.art === "liste_hinzufuegen") {
          const l = await ladeListe(tx, aktion.listeId);
          verlangeListenRecht(c, l);
          if (l.objekt !== objekt) throw new Fachfehler(400, "bulk_action_invalid", "The list belongs to a different object.");
          const gueltig = await zulaessigeIds(tx, c, objekt, kandidaten, true);
          const neu = gueltig.length ? await tx.insert(listeEintrag).values(gueltig.map((datensatzId) => ({ listeId: l.id, datensatzId }))).onConflictDoNothing().returning({ id: listeEintrag.id, datensatzId: listeEintrag.datensatzId }) : [];
          await protokoll.mehrere(neu.map((n) => ({ aktion: "anlegen", tabelle: "liste_eintrag", datensatzId: n.id, nachher: { listeId: l.id, datensatzId: n.datensatzId } })));
          return { erfolgreich: gueltig.length, hinzugefuegt: neu.length, fehler: [] as { id: string; code: string }[] };
        }
        let erfolgreich = 0;
        const fehler: { id: string; code: string }[] = [];
        for (const id of kandidaten) {
          try {
            // Jede Zeile in einem Savepoint: ein Fehler (z. B. fehlender Beschluss) lässt die übrigen gelten.
            await tx.transaction(async (sp) => {
              if (aktion.art === "phase") {
                const d = await verlangeDealSichtbar(sp, c, id);
                verlangeDealSchreibrecht(c, d.fondsId);
                await wechselePhase(sp, protokoll, id, aktion.nachPhase);
              } else if (aktion.art === "archivieren") {
                await archiviere(sp, protokoll, objekt, id);
              } else {
                const system = [...loeseFelder(objekt, [], false).values()].some((f) => f.schluessel === aktion.feld && f.system);
                await aendereDatensatz(sp, protokoll, c, objekt, id, system ? { system: { [aktion.feld]: aktion.wert } } : { eigene: { [aktion.feld]: aktion.wert } });
              }
            });
            erfolgreich++;
          } catch (e) {
            if (!(e instanceof Fachfehler)) throw e;
            fehler.push({ id, code: e.code });
          }
        }
        return { erfolgreich, hinzugefuegt: 0, fehler };
      });
      return kontaktJson(c, ergebnis, 200);
    })

    // Datensätze ---------------------------------------------------------------------------------------------------
    .get("/records/:object/:id", pruefeEnglisch("param", objektIdParam), async (c) => {
      const { objekt, id } = c.req.valid("param");
      const ergebnis = await lese(db, async (tx) => {
        const felder = await beschreibeFelder(tx, objekt, null);
        const abfrage = await fuehreAbfrageAus(tx, objekt, { spalten: felder.map((f) => ({ feld: f.schluessel })), limit: 1 }, kontextFuer(c, objekt, [id]));
        const zeile = abfrage.daten[0];
        if (!zeile) throw new Fachfehler(404, "record_not_found", "Record not found.");
        return { id, werte: zeile, felder, bezuege: abfrage.bezuege };
      });
      return kontaktJson(c, ergebnis, 200);
    })
    .patch(
      "/records/:object/:id",
      pruefeEnglisch("param", objektIdParam),
      pruefeEnglisch("json", z.object({ system: z.record(z.string(), z.unknown()).optional(), eigene: z.record(z.string(), z.unknown()).optional() }).refine((w) => w.system || w.eigene, { message: "Specify system or customFields" })),
      async (c) => {
        const { objekt, id } = c.req.valid("param");
        const eingabe = c.req.valid("json");
        const nachher = await schreibe(db, c, (tx, protokoll) => aendereDatensatz(tx, protokoll, c, objekt, id, eingabe));
        return kontaktJson(c, nachher, 200);
      },
    )
    .get("/records/:object/:id/links", pruefeEnglisch("param", objektIdParam), async (c) => {
      const { objekt, id } = c.req.valid("param");
      const ergebnis = await lese(db, async (tx) => {
        if (objekt === "deal") await verlangeDealSichtbar(tx, c, id);
        else await ladeZeile(tx, objekt, id, false);
        return ladeVerknuepfungen(tx, c, objekt, id);
      });
      return kontaktJson(c, ergebnis, 200);
    })

    /** Kurzkarte für die Vorschau beim Überfahren eines Verweises: nur Name, Unternehmen und Kontaktwege; Deals folgen der Sichtbarkeit des Fonds. */
    .get("/records/:object/:id/card", pruefeEnglisch("param", objektIdParam), async (c) => {
      const { objekt, id } = c.req.valid("param");
      const ergebnis = await lese(db, async (tx) => {
        const firma = async (organisationId: string | null) => {
          if (!organisationId) return null;
          const [o] = await tx.select({ id: organisation.id, name: organisation.name }).from(organisation).where(and(eq(organisation.id, organisationId), isNull(organisation.archiviertAm)));
          return o ?? null;
        };
        if (objekt === "organisation") {
          const z = await ladeZeile(tx, "organisation", id, false);
          return { objekt, id, name: z.name as string, firma: null, art: z.art as string, phase: null, funktion: null, email: (z.email as string | null) ?? null, telefon: (z.telefon as string | null) ?? null, linkedin: (z.linkedin as string | null) ?? null, website: (z.website as string | null) ?? null };
        }
        if (objekt === "person") {
          const z = await ladeZeile(tx, "person", id, false);
          return { objekt, id, name: `${z.vorname as string} ${z.nachname as string}`, firma: await firma((z.organisationId as string | null) ?? null), art: null, phase: null, funktion: (z.funktion as string | null) ?? null, email: (z.email as string | null) ?? null, telefon: (z.telefon as string | null) ?? null, linkedin: (z.linkedin as string | null) ?? null, website: null };
        }
        await verlangeDealSichtbar(tx, c, id);
        const z = await ladeZeile(tx, "deal", id, false);
        const f = await firma((z.organisationId as string | null) ?? null);
        const [kontakt] = f ? await tx.select({ email: organisation.email, telefon: organisation.telefon, linkedin: organisation.linkedin, website: organisation.website }).from(organisation).where(eq(organisation.id, f.id)) : [];
        return { objekt, id, name: z.titel as string, firma: f, art: null, phase: z.phase as string, funktion: null, email: kontakt?.email ?? null, telefon: kontakt?.telefon ?? null, linkedin: kontakt?.linkedin ?? null, website: kontakt?.website ?? null };
      });
      return kontaktJson(c, ergebnis, 200);
    })

    // Felddefinitionen ---------------------------------------------------------------------------------------------
    .post("/fields", pruefeEnglisch("json", neuesFeld), async (c) => {
      const eingabe = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await verlangeFeldRecht(tx, c, eingabe.listeId ?? null);
        if (eingabe.listeId) {
          const l = await ladeListe(tx, eingabe.listeId);
          if (l.objekt !== eingabe.objekt) throw new Fachfehler(400, "query_invalid", "The list belongs to a different object.");
        }
        const optionen = optionenSchema(eingabe.typ).safeParse(eingabe.optionen ?? {});
        if (!optionen.success) throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: optionen.error.issues.map((i) => ({ feld: ["optionen", ...i.path].join("."), code: i.code, meldung: i.message })) });
        const schluessel = eingabe.schluessel ?? schluesselAusName(eingabe.name);
        const [vorhanden] = await tx
          .select({ id: feldDefinition.id })
          .from(feldDefinition)
          .where(and(eq(feldDefinition.objekt, eingabe.objekt), eingabe.listeId ? eq(feldDefinition.listeId, eingabe.listeId) : isNull(feldDefinition.listeId), eq(feldDefinition.schluessel, schluessel)));
        if (vorhanden) throw new Fachfehler(409, "field_key_exists", "A field with this key already exists (archived fields count too).");
        const [pos] = await tx.select({ n: sql<number>`coalesce(max(${feldDefinition.position}), -1) + 1` }).from(feldDefinition).where(and(eq(feldDefinition.objekt, eingabe.objekt), eingabe.listeId ? eq(feldDefinition.listeId, eingabe.listeId) : isNull(feldDefinition.listeId)));
        const [zeile] = await tx
          .insert(feldDefinition)
          .values({ objekt: eingabe.objekt, listeId: eingabe.listeId ?? null, schluessel, name: eingabe.name, typ: eingabe.typ, optionen: optionen.data, position: pos?.n ?? 0 })
          .returning();
        await protokoll("anlegen", "feld_definition", zeile!.id, null, zeile);
        return zeile!;
      });
      return kontaktJson(c, neu, 201);
    })
    .patch("/fields/:id", pruefeEnglisch("param", idParam), pruefeEnglisch("json", aenderungFeld), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeDefinition(tx, id);
        await verlangeFeldRecht(tx, c, vorher.listeId);
        const set: Partial<typeof feldDefinition.$inferInsert> = {};
        if (eingabe.name !== undefined) set.name = eingabe.name;
        if (eingabe.position !== undefined) set.position = eingabe.position;
        if (eingabe.optionen !== undefined) {
          const optionen = optionenSchema(vorher.typ).safeParse(eingabe.optionen);
          if (!optionen.success) throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: optionen.error.issues.map((i) => ({ feld: ["optionen", ...i.path].join("."), code: i.code, meldung: i.message })) });
          if (vorher.typ === "verknuepfung" && optionen.data.ziel !== vorher.optionen.ziel) throw new Fachfehler(409, "field_type_fixed", "The target object of a link field cannot be changed. Create a new field and archive the old one.");
          if (vorher.typ === "auswahl" || vorher.typ === "mehrfachauswahl") {
            const alt = ((vorher.optionen.optionen as Option[] | undefined) ?? []).map((o) => o.schluessel);
            const neu = new Set(((optionen.data.optionen as Option[]) ?? []).map((o) => o.schluessel));
            const entfernt = alt.filter((k) => !neu.has(k));
            if (entfernt.length && (await verwendungen(tx, vorher, entfernt)) > 0) throw new Fachfehler(409, "field_option_in_use", "A removed option is still in use.", { optionen: entfernt });
          }
          set.optionen = optionen.data;
        }
        const [zeile] = await tx.update(feldDefinition).set({ ...set, version: sql`${feldDefinition.version} + 1` as unknown as number }).where(eq(feldDefinition.id, id)).returning();
        await protokoll("aendern", "feld_definition", id, vorher, zeile);
        return zeile!;
      });
      return kontaktJson(c, nachher, 200);
    })
    .post("/fields/:id/archive", pruefeEnglisch("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeDefinition(tx, id);
        await verlangeFeldRecht(tx, c, vorher.listeId);
        if (vorher.archiviertAm) return vorher;
        const [zeile] = await tx.update(feldDefinition).set({ archiviertAm: new Date(), version: sql`${feldDefinition.version} + 1` as unknown as number }).where(eq(feldDefinition.id, id)).returning();
        await protokoll("archivieren", "feld_definition", id, vorher, zeile);
        return zeile!;
      });
      return kontaktJson(c, nachher, 200);
    })
    .post("/fields/:id/restore", pruefeEnglisch("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeDefinition(tx, id);
        await verlangeFeldRecht(tx, c, vorher.listeId);
        if (!vorher.archiviertAm) return vorher;
        const [zeile] = await tx.update(feldDefinition).set({ archiviertAm: null, version: sql`${feldDefinition.version} + 1` as unknown as number }).where(eq(feldDefinition.id, id)).returning();
        await protokoll("wiederherstellen", "feld_definition", id, vorher, zeile);
        return zeile!;
      });
      return kontaktJson(c, nachher, 200);
    })

    // Ansichten ----------------------------------------------------------------------------------------------------
    .get("/views", pruefeEnglisch("query", z.object({ objekt: z.enum(OBJEKTE), listeId: z.uuid().optional() })), async (c) => {
      const { objekt, listeId } = c.req.valid("query");
      const akteur = aktuellerAkteur(c);
      const zeilen = await lese(db, (tx) =>
        tx
          .select()
          .from(ansicht)
          .where(and(eq(ansicht.objekt, objekt), listeId ? eq(ansicht.listeId, listeId) : isNull(ansicht.listeId), or(eq(ansicht.geteilt, true), eq(ansicht.besitzerId, akteur.id))))
          .orderBy(desc(ansicht.standard), asc(ansicht.name), asc(ansicht.id)),
      );
      return kontaktJson(c, { daten: zeilen.map((a) => ({ ...a, eigene: a.besitzerId === akteur.id, bearbeitbar: a.besitzerId === akteur.id || akteur.globalVerwalter })) }, 200);
    })
    .post("/views", pruefeEnglisch("json", ansichtEingabe), async (c) => {
      const eingabe = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        if (eingabe.listeId) {
          const l = await ladeListe(tx, eingabe.listeId);
          if (l.objekt !== eingabe.objekt) throw new Fachfehler(400, "query_invalid", "The list belongs to a different object.");
        }
        await pruefeKonfig(tx, eingabe.objekt, eingabe.listeId ?? null, eingabe.konfig);
        const [zeile] = await tx
          .insert(ansicht)
          .values({ objekt: eingabe.objekt, listeId: eingabe.listeId ?? null, name: eingabe.name, art: eingabe.art, konfig: eingabe.konfig, besitzerId: akteur.id, geteilt: eingabe.geteilt })
          .returning();
        await protokoll("anlegen", "ansicht", zeile!.id, null, zeile);
        return zeile!;
      });
      return kontaktJson(c, neu, 201);
    })
    .patch("/views/:id", pruefeEnglisch("param", idParam), pruefeEnglisch("json", ansichtAenderung), async (c) => {
      const { id } = c.req.valid("param");
      const { standard, ...eingabe } = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeAnsicht(tx, c, id);
        if (vorher.besitzerId !== akteur.id && !akteur.globalVerwalter) throw new Fachfehler(403, "view_foreign", "Only the owner of a shared view and global admins can change it.");
        if (standard !== undefined && !akteur.globalVerwalter) throw new Fachfehler(403, "view_foreign", "Only global admins can set the default view.");
        if (eingabe.konfig) await pruefeKonfig(tx, vorher.objekt, vorher.listeId, eingabe.konfig);
        if (standard === true) {
          await tx.update(ansicht).set({ standard: false }).where(and(eq(ansicht.objekt, vorher.objekt), vorher.listeId ? eq(ansicht.listeId, vorher.listeId) : isNull(ansicht.listeId)));
        }
        const geteilt = standard === true ? true : eingabe.geteilt;
        const [zeile] = await tx
          .update(ansicht)
          .set({ ...(eingabe.name !== undefined ? { name: eingabe.name } : {}), ...(eingabe.art !== undefined ? { art: eingabe.art } : {}), ...(eingabe.konfig !== undefined ? { konfig: eingabe.konfig } : {}), ...(geteilt !== undefined ? { geteilt } : {}), ...(standard !== undefined ? { standard } : {}), aktualisiertAm: new Date() })
          .where(eq(ansicht.id, id))
          .returning();
        await protokoll("aendern", "ansicht", id, vorher, zeile);
        return zeile!;
      });
      return kontaktJson(c, nachher, 200);
    })
    .delete("/views/:id", pruefeEnglisch("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeAnsicht(tx, c, id);
        if (vorher.besitzerId !== akteur.id && !akteur.globalVerwalter) throw new Fachfehler(403, "view_foreign", "Only the owner of a shared view and global admins can delete it.");
        await tx.delete(ansicht).where(eq(ansicht.id, id));
        await protokoll("loeschen", "ansicht", id, vorher, null);
      });
      return c.body(null, 204);
    })

    // Listen -------------------------------------------------------------------------------------------------------
    .get("/lists", pruefeEnglisch("query", z.object({ objekt: z.enum(OBJEKTE).optional() })), async (c) => {
      const { objekt } = c.req.valid("query");
      const zeilen = await lese(db, async (tx) => {
        const rows = await tx.select().from(liste).where(and(isNull(liste.archiviertAm), objekt ? eq(liste.objekt, objekt) : undefined)).orderBy(asc(liste.name), asc(liste.id));
        const nachListe = await zaehleSichtbar(tx, c, rows);
        return rows.map((r) => ({ ...r, eintraege: nachListe.get(r.id) ?? 0 }));
      });
      return kontaktJson(c, { daten: zeilen }, 200);
    })
    .post("/lists", pruefeEnglisch("json", neueListe), async (c) => {
      const eingabe = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [doppelt] = await tx.select({ id: liste.id }).from(liste).where(and(isNull(liste.archiviertAm), sql`lower(${liste.name}) = lower(${eingabe.name})`));
        if (doppelt) throw new Fachfehler(409, "list_name_exists", "A list with this name already exists.");
        const [zeile] = await tx.insert(liste).values({ ...eingabe, besitzerId: akteur.technisch ? null : akteur.id }).returning();
        await protokoll("anlegen", "liste", zeile!.id, null, zeile);
        return zeile!;
      });
      return kontaktJson(c, neu, 201);
    })
    .get("/lists/:id", pruefeEnglisch("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const ergebnis = await lese(db, async (tx) => {
        const l = await ladeListe(tx, id);
        const anzahl = await zaehleSichtbar(tx, c, [l]);
        return { ...l, eintraege: anzahl.get(id) ?? 0, felder: await beschreibeFelder(tx, l.objekt, id) };
      });
      return kontaktJson(c, ergebnis, 200);
    })
    .patch("/lists/:id", pruefeEnglisch("param", idParam), pruefeEnglisch("json", z.object({ name: textEingabe(120).optional(), beschreibung: optionalerText(1000) }).refine((w) => w.name !== undefined || w.beschreibung !== undefined, { message: "At least one field must be specified" })), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeListe(tx, id);
        verlangeListenRecht(c, vorher);
        if (eingabe.name) {
          const [doppelt] = await tx.select({ id: liste.id }).from(liste).where(and(isNull(liste.archiviertAm), sql`lower(${liste.name}) = lower(${eingabe.name})`, sql`${liste.id} <> ${id}`));
          if (doppelt) throw new Fachfehler(409, "list_name_exists", "A list with this name already exists.");
        }
        const [zeile] = await tx.update(liste).set({ ...(eingabe.name !== undefined ? { name: eingabe.name } : {}), ...(eingabe.beschreibung !== undefined ? { beschreibung: eingabe.beschreibung } : {}) }).where(eq(liste.id, id)).returning();
        await protokoll("aendern", "liste", id, vorher, zeile);
        return zeile!;
      });
      return kontaktJson(c, nachher, 200);
    })
    .post("/lists/:id/archive", pruefeEnglisch("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeListe(tx, id);
        verlangeListenRecht(c, vorher);
        const [zeile] = await tx.update(liste).set({ archiviertAm: new Date() }).where(eq(liste.id, id)).returning();
        await protokoll("archivieren", "liste", id, vorher, zeile);
      });
      return c.body(null, 204);
    })
    .post("/lists/:id/entries", pruefeEnglisch("param", idParam), pruefeEnglisch("json", z.object({ datensatzIds: z.array(z.uuid()).min(1).max(500) })), async (c) => {
      const { id } = c.req.valid("param");
      const { datensatzIds } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const l = await ladeListe(tx, id);
        verlangeListenRecht(c, l);
        const gueltig = await zulaessigeIds(tx, c, l.objekt, datensatzIds, true);
        const neu = gueltig.length ? await tx.insert(listeEintrag).values(gueltig.map((datensatzId) => ({ listeId: id, datensatzId }))).onConflictDoNothing().returning({ id: listeEintrag.id, datensatzId: listeEintrag.datensatzId }) : [];
        await protokoll.mehrere(neu.map((n) => ({ aktion: "anlegen", tabelle: "liste_eintrag", datensatzId: n.id, nachher: { listeId: id, datensatzId: n.datensatzId } })));
        return { hinzugefuegt: neu.length, uebersprungen: datensatzIds.length - neu.length };
      });
      return kontaktJson(c, ergebnis, 200);
    })
    .post("/lists/:id/entries/remove", pruefeEnglisch("param", idParam), pruefeEnglisch("json", z.object({ datensatzIds: z.array(z.uuid()).min(1).max(500) })), async (c) => {
      const { id } = c.req.valid("param");
      const { datensatzIds } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const l = await ladeListe(tx, id);
        verlangeListenRecht(c, l);
        const erlaubt = await zulaessigeIds(tx, c, l.objekt, datensatzIds, true);
        if (erlaubt.length === 0) return { entfernt: 0 };
        const weg = await tx.delete(listeEintrag).where(and(eq(listeEintrag.listeId, id), inArray(listeEintrag.datensatzId, erlaubt))).returning();
        await protokoll.mehrere(weg.map((w) => ({ aktion: "loeschen", tabelle: "liste_eintrag", datensatzId: w.id, vorher: w })));
        return { entfernt: weg.length };
      });
      return kontaktJson(c, ergebnis, 200);
    })
    .patch("/lists/:id/entries/:recordId", pruefeEnglisch("param", z.object({ id: z.uuid(), datensatzId: z.uuid() })), pruefeEnglisch("json", z.object({ felder: z.record(z.string(), z.unknown()) })), async (c) => {
      const { id, datensatzId } = c.req.valid("param");
      const { felder } = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const l = await ladeListe(tx, id);
        verlangeListenRecht(c, l);
        const [vorher] = await tx.select().from(listeEintrag).where(and(eq(listeEintrag.listeId, id), eq(listeEintrag.datensatzId, datensatzId))).for("update");
        if (!vorher) throw new Fachfehler(404, "record_not_found", "The record is not in this list.");
        if (l.objekt === "deal") {
          const d = await verlangeDealSichtbar(tx, c, datensatzId);
          verlangeDealSchreibrecht(c, d.fondsId);
        }
        const defs = await ladeFelder(tx, l.objekt, id);
        const geprueft = await pruefeFelder(tx, c, defs, felder);
        const neu = { ...vorher.felder };
        for (const [k, w] of Object.entries(geprueft)) {
          if (w === null) delete neu[k];
          else neu[k] = w;
        }
        const [zeile] = await tx.update(listeEintrag).set({ felder: neu }).where(eq(listeEintrag.id, vorher.id)).returning();
        await protokoll("aendern", "liste_eintrag", vorher.id, vorher, zeile);
        return zeile!;
      });
      return kontaktJson(c, nachher, 200);
    })

    // Aufgaben -----------------------------------------------------------------------------------------------------
    /** Kandidaten für die Zuständigkeit (Auswahl „Person im Haus“): nur Kennung und Name, durchsucht nach Name; mit `dealId` nur, wer den Deal sehen darf. */
    .get("/assignees", pruefeEnglisch("query", z.object({ q: z.string().trim().max(100).optional(), dealId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(25) })), async (c) => {
      const { q, dealId, limit } = c.req.valid("query");
      const daten = await lese(db, async (tx) => sucheZustaendige(tx, c, { q, dealFondsId: await dealFondsFuerAufgabe(tx, c, dealId), limit }));
      return kontaktJson(c, { daten }, 200);
    })
    .get(
      "/tasks",
      pruefeEnglisch("query", z.object({ organisationId: z.uuid().optional(), personId: z.uuid().optional(), dealId: z.uuid().optional(), zustaendig: z.enum(["ich", "alle"]).default("alle"), status: z.enum(["offen", "erledigt", "alle"]).default("offen"), limit: z.coerce.number().int().min(1).max(500).default(200) })),
      async (c) => {
        const q = c.req.valid("query");
        const akteur = aktuellerAkteur(c);
        const sichtbar = dealSichtbar(c);
        const zeilen = await lese(db, (tx) =>
          tx
            .select({
              id: aufgabe.id,
              titel: aufgabe.titel,
              notiz: aufgabe.notiz,
              faellig: aufgabe.faellig,
              erledigtAm: aufgabe.erledigtAm,
              zustaendigId: aufgabe.zustaendig,
              zustaendigName: benutzer.name,
              organisation: { id: organisation.id, name: organisation.name },
              person: { id: person.id, vorname: person.vorname, nachname: person.nachname },
              deal: { id: deal.id, titel: deal.titel },
            })
            .from(aufgabe)
            .leftJoin(benutzer, eq(benutzer.id, aufgabe.zustaendig))
            .leftJoin(organisation, eq(organisation.id, aufgabe.organisationId))
            .leftJoin(person, eq(person.id, aufgabe.personId))
            .leftJoin(deal, eq(deal.id, aufgabe.dealId))
            .where(
              and(
                q.organisationId ? eq(aufgabe.organisationId, q.organisationId) : undefined,
                q.personId ? eq(aufgabe.personId, q.personId) : undefined,
                q.dealId ? eq(aufgabe.dealId, q.dealId) : undefined,
                q.zustaendig === "ich" ? eq(aufgabe.zustaendig, akteur.id) : undefined,
                q.status === "offen" ? isNull(aufgabe.erledigtAm) : q.status === "erledigt" ? sql`${aufgabe.erledigtAm} IS NOT NULL` : undefined,
                sichtbar ? or(isNull(aufgabe.dealId), sichtbar) : undefined,
              ),
            )
            .orderBy(sql`${aufgabe.erledigtAm} IS NOT NULL`, sql`${aufgabe.faellig} ASC NULLS LAST`, desc(aufgabe.erstelltAm), asc(aufgabe.id))
            .limit(q.limit),
        );
        return kontaktJson(c, { daten: zeilen }, 200);
      },
    )
    .post("/tasks", pruefeEnglisch("json", neueAufgabe), async (c) => {
      const { zustaendigId, ...werte } = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        if (werte.organisationId) await ladeZeile(tx, "organisation", werte.organisationId, false);
        if (werte.personId) await ladeZeile(tx, "person", werte.personId, false);
        if (werte.dealId) {
          const d = await verlangeDealSichtbar(tx, c, werte.dealId);
          verlangeDealSchreibrecht(c, d.fondsId);
        }
        await pruefeZustaendig(tx, c, zustaendigId, werte.dealId);
        const zustaendig = zustaendigId === undefined ? (akteur.technisch ? null : akteur.id) : zustaendigId;
        const [zeile] = await tx.insert(aufgabe).values({ ...werte, faellig: werte.faellig ?? null, notiz: werte.notiz ?? null, zustaendig, erstelltVon: akteur.id }).returning();
        await protokoll("anlegen", "aufgabe", zeile!.id, null, zeile);
        return zeile!;
      });
      return kontaktJson(c, neu, 201);
    })
    .patch("/tasks/:id", pruefeEnglisch("param", idParam), pruefeEnglisch("json", aenderungAufgabe), async (c) => {
      const { id } = c.req.valid("param");
      const { zustaendigId, ...rest } = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeAufgabe(tx, c, id);
        await pruefeZustaendig(tx, c, zustaendigId, vorher.dealId ?? undefined);
        const set = { ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)), ...(zustaendigId !== undefined ? { zustaendig: zustaendigId } : {}) };
        const [zeile] = await tx.update(aufgabe).set(set).where(eq(aufgabe.id, id)).returning();
        await protokoll("aendern", "aufgabe", id, vorher, zeile);
        return zeile!;
      });
      return kontaktJson(c, nachher, 200);
    })
    .post("/tasks/:id/complete", pruefeEnglisch("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeAufgabe(tx, c, id);
        if (vorher.erledigtAm) return vorher;
        const [zeile] = await tx.update(aufgabe).set({ erledigtAm: new Date() }).where(eq(aufgabe.id, id)).returning();
        await protokoll("erledigen", "aufgabe", id, vorher, zeile);
        return zeile!;
      });
      return kontaktJson(c, nachher, 200);
    })
    .post("/tasks/:id/reopen", pruefeEnglisch("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeAufgabe(tx, c, id);
        if (!vorher.erledigtAm) return vorher;
        const [zeile] = await tx.update(aufgabe).set({ erledigtAm: null }).where(eq(aufgabe.id, id)).returning();
        await protokoll("aendern", "aufgabe", id, vorher, zeile);
        return zeile!;
      });
      return kontaktJson(c, nachher, 200);
    })
    .delete("/tasks/:id", pruefeEnglisch("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeAufgabe(tx, c, id);
        await tx.delete(aufgabe).where(eq(aufgabe.id, id));
        await protokoll("loeschen", "aufgabe", id, vorher, null);
      });
      return c.body(null, 204);
    })

    // Beschäftigungen und Deal-Kontakte ------------------------------------------------------------------------------
    .get("/employments", pruefeEnglisch("query", z.object({ personId: z.uuid().optional(), organisationId: z.uuid().optional() }).refine((w) => w.personId || w.organisationId, { message: "Specify personId or organizationId" })), async (c) => {
      const { personId, organisationId } = c.req.valid("query");
      const zeilen = await lese(db, (tx) =>
        tx
          .select({
            id: beschaeftigung.id,
            funktion: beschaeftigung.funktion,
            von: beschaeftigung.von,
            bis: beschaeftigung.bis,
            haupt: beschaeftigung.haupt,
            person: { id: person.id, vorname: person.vorname, nachname: person.nachname, email: person.email, telefon: person.telefon, linkedin: person.linkedin },
            organisation: { id: organisation.id, name: organisation.name, email: organisation.email, telefon: organisation.telefon, website: organisation.website, linkedin: organisation.linkedin },
          })
          .from(beschaeftigung)
          .innerJoin(person, eq(person.id, beschaeftigung.personId))
          .innerJoin(organisation, eq(organisation.id, beschaeftigung.organisationId))
          .where(and(personId ? eq(beschaeftigung.personId, personId) : undefined, organisationId ? eq(beschaeftigung.organisationId, organisationId) : undefined, isNull(person.zusammengefuehrtIn), isNull(organisation.zusammengefuehrtIn)))
          .orderBy(desc(beschaeftigung.haupt), sql`${beschaeftigung.bis} IS NOT NULL`, asc(person.nachname), asc(beschaeftigung.id)),
      );
      return kontaktJson(c, { daten: zeilen }, 200);
    })
    .post("/employments", pruefeEnglisch("json", beschaeftigungEingabe), async (c) => {
      const eingabe = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await ladeZeile(tx, "person", eingabe.personId);
        await ladeZeile(tx, "organisation", eingabe.organisationId, false);
        if (eingabe.von && eingabe.bis && eingabe.bis < eingabe.von) throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: "bis", code: "too_small", meldung: "End is before start" }] });
        const [hatHaupt] = await tx.select({ id: beschaeftigung.id }).from(beschaeftigung).where(and(eq(beschaeftigung.personId, eingabe.personId), eq(beschaeftigung.haupt, true)));
        const haupt = (eingabe.haupt || !hatHaupt) && !eingabe.bis;
        if (haupt) await tx.update(beschaeftigung).set({ haupt: false }).where(and(eq(beschaeftigung.personId, eingabe.personId), eq(beschaeftigung.haupt, true)));
        const [zeile] = await tx.insert(beschaeftigung).values({ ...eingabe, funktion: eingabe.funktion ?? null, von: eingabe.von ?? null, bis: eingabe.bis ?? null, haupt }).returning();
        await protokoll("anlegen", "beschaeftigung", zeile!.id, null, zeile);
        await spiegleHauptbeschaeftigung(tx, eingabe.personId);
        return zeile!;
      });
      return kontaktJson(c, neu, 201);
    })
    .patch(
      "/employments/:id",
      pruefeEnglisch("param", idParam),
      pruefeEnglisch("json", z.object({ funktion: z.string().trim().min(1).max(200).nullable().optional(), von: z.iso.date().nullable().optional(), bis: z.iso.date().nullable().optional(), haupt: z.boolean().optional() }).refine((w) => Object.values(w).some((x) => x !== undefined), { message: "At least one field must be specified" })),
      async (c) => {
        const { id } = c.req.valid("param");
        const eingabe = c.req.valid("json");
        const nachher = await schreibe(db, c, async (tx, protokoll) => {
          const [vorher] = await tx.select().from(beschaeftigung).where(eq(beschaeftigung.id, id)).for("update");
          if (!vorher) throw new Fachfehler(404, "employment_not_found", "Employment not found.");
          const von = eingabe.von === undefined ? vorher.von : eingabe.von;
          const bis = eingabe.bis === undefined ? vorher.bis : eingabe.bis;
          if (von && bis && bis < von) throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: "bis", code: "too_small", meldung: "End is before start" }] });
          const haupt = eingabe.haupt ?? vorher.haupt;
          if (haupt && !bis) await tx.update(beschaeftigung).set({ haupt: false }).where(and(eq(beschaeftigung.personId, vorher.personId), eq(beschaeftigung.haupt, true), sql`${beschaeftigung.id} <> ${id}`));
          const [zeile] = await tx
            .update(beschaeftigung)
            .set({ ...(eingabe.funktion !== undefined ? { funktion: eingabe.funktion } : {}), von, bis, haupt: haupt && !bis })
            .where(eq(beschaeftigung.id, id))
            .returning();
          await protokoll("aendern", "beschaeftigung", id, vorher, zeile);
          await spiegleHauptbeschaeftigung(tx, vorher.personId);
          return zeile!;
        });
        return kontaktJson(c, nachher, 200);
      },
    )
    .delete("/employments/:id", pruefeEnglisch("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(beschaeftigung).where(eq(beschaeftigung.id, id)).for("update");
        if (!vorher) throw new Fachfehler(404, "employment_not_found", "Employment not found.");
        await tx.delete(beschaeftigung).where(eq(beschaeftigung.id, id));
        await protokoll("loeschen", "beschaeftigung", id, vorher, null);
        if (vorher.haupt) {
          // Eine andere laufende Beschäftigung rückt nach.
          const [naechste] = await tx.select().from(beschaeftigung).where(and(eq(beschaeftigung.personId, vorher.personId), isNull(beschaeftigung.bis))).orderBy(desc(beschaeftigung.erstelltAm)).limit(1);
          if (naechste) await tx.update(beschaeftigung).set({ haupt: true }).where(eq(beschaeftigung.id, naechste.id));
          await tx.update(person).set({ organisationId: naechste?.organisationId ?? null }).where(eq(person.id, vorher.personId));
        }
      });
      return c.body(null, 204);
    })
    .get("/deals/:id/contacts", pruefeEnglisch("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const zeilen = await lese(db, async (tx) => {
        await verlangeDealSichtbar(tx, c, id);
        return tx
          .select({ personId: person.id, vorname: person.vorname, nachname: person.nachname, email: person.email, telefon: person.telefon, funktion: person.funktion, rolle: dealKontakt.rolle })
          .from(dealKontakt)
          .innerJoin(person, eq(person.id, dealKontakt.personId))
          .where(and(eq(dealKontakt.dealId, id), isNull(person.zusammengefuehrtIn)))
          .orderBy(asc(person.nachname), asc(person.vorname), asc(person.id));
      });
      return kontaktJson(c, { daten: zeilen }, 200);
    })
    .post("/deals/:id/contacts", pruefeEnglisch("param", idParam), pruefeEnglisch("json", z.object({ personId: z.uuid(), rolle: optionalerText(100) })), async (c) => {
      const { id } = c.req.valid("param");
      const { personId, rolle } = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const d = await verlangeDealSichtbar(tx, c, id);
        verlangeDealSchreibrecht(c, d.fondsId);
        await ladeZeile(tx, "person", personId, false);
        const [zeile] = await tx.insert(dealKontakt).values({ dealId: id, personId, rolle: rolle ?? null }).onConflictDoUpdate({ target: [dealKontakt.dealId, dealKontakt.personId], set: { rolle: rolle ?? null } }).returning();
        await protokoll("anlegen", "deal_kontakt", id, null, zeile);
        return zeile!;
      });
      return kontaktJson(c, neu, 201);
    })
    .delete("/deals/:id/contacts/:personId", pruefeEnglisch("param", z.object({ id: z.uuid(), personId: z.uuid() })), async (c) => {
      const { id, personId } = c.req.valid("param");
      await schreibe(db, c, async (tx, protokoll) => {
        const d = await verlangeDealSichtbar(tx, c, id);
        verlangeDealSchreibrecht(c, d.fondsId);
        const weg = await tx.delete(dealKontakt).where(and(eq(dealKontakt.dealId, id), eq(dealKontakt.personId, personId))).returning();
        if (weg.length === 0) throw new Fachfehler(404, "record_not_found", "The contact does not belong to this deal.");
        await protokoll("loeschen", "deal_kontakt", id, weg[0], null);
      });
      return c.body(null, 204);
    })
    .route("/import", crmImportRouten(db));
}
