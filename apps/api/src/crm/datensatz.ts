import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { aufgabe, beschaeftigung, beteiligung, datensatzLink, deal, dealKontakt, investorZugang, listeEintrag, organisation, person } from "@carraway/db";
import { aktuellerAkteur, hatRolle } from "../anmeldung/akteur";
import { Fachfehler } from "../fehler";
import { dealSichtbar } from "../rechte/sichtbarkeit";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { ladeFelder, pruefeFelder, wertSchema, type FeldDef, type Objekt } from "./felder";
import { OBJEKT_DEFS } from "./objekte";

const TABELLEN = { organisation, person, deal } as const;
export const TABELLENNAME: Record<Objekt, string> = { organisation: "organisation", person: "person", deal: "deal" };

/** Lädt eine Zeile (gesperrt) und prüft, dass sie existiert und weder zusammengeführt noch archiviert ist. */
export async function ladeZeile(tx: Tx, objekt: Objekt, id: string, sperren = true) {
  const t = TABELLEN[objekt];
  const abfrage = tx.select().from(t as typeof organisation).where(eq(t.id, id));
  const [zeile] = (sperren ? await abfrage.for("update") : await abfrage) as (typeof organisation.$inferSelect)[];
  if (!zeile) throw new Fachfehler(404, "DATENSATZ_NICHT_GEFUNDEN", "Datensatz nicht gefunden.");
  const roh = zeile as unknown as { zusammengefuehrtIn?: string | null; archiviertAm?: Date | null };
  if (roh.zusammengefuehrtIn || roh.archiviertAm) throw new Fachfehler(404, "DATENSATZ_NICHT_GEFUNDEN", "Datensatz nicht gefunden.");
  return zeile as unknown as Record<string, unknown> & { id: string; felder: Record<string, unknown>; fondsId?: string | null; status?: string };
}

/** Darf die Person den Deal (mit Fonds) schreiben? Deals ohne Fonds darf jede Person mit Bearbeiterrolle ändern. */
export function verlangeDealSchreibrecht(c: Context, fondsId: string | null) {
  if (fondsId === null) return;
  const akteur = aktuellerAkteur(c);
  if (!hatRolle(akteur, fondsId, "bearbeiter", "dealflow")) throw new Fachfehler(403, "KEINE_BERECHTIGUNG", "Dafür fehlt die Berechtigung am Fonds des Deals.");
}

/** Der Deal muss für die Person sichtbar sein, sonst gilt er als nicht vorhanden. */
export async function verlangeDealSichtbar(tx: Tx, c: Context, id: string) {
  const bedingung = dealSichtbar(c);
  const [z] = await tx.select({ id: deal.id, fondsId: deal.fondsId }).from(deal).where(and(eq(deal.id, id), bedingung));
  if (!z) throw new Fachfehler(404, "DEAL_NICHT_GEFUNDEN", "Deal nicht gefunden.");
  return z;
}

const SYSTEM_WERTE = {
  required: new Set(["name", "vorname", "nachname", "titel", "art"]),
};

/**
 * Ändert Systemfelder und eigene Felder eines Datensatzes (Inline-Bearbeitung). Systemfelder: nur die als schreibbar
 * ausgewiesenen; eigene Felder: je Typ geprüft, `null` entfernt den Wert. Verknüpfungsfelder pflegen die Rückverweise.
 */
export async function aendereDatensatz(
  tx: Tx,
  protokoll: Protokollant,
  c: Context,
  objekt: Objekt,
  id: string,
  eingabe: { system?: Record<string, unknown> | undefined; eigene?: Record<string, unknown> | undefined },
) {
  const t = TABELLEN[objekt];
  const vorher = await ladeZeile(tx, objekt, id);
  if (objekt === "deal") {
    await verlangeDealSichtbar(tx, c, id);
    verlangeDealSchreibrecht(c, (vorher.fondsId as string | null) ?? null);
  }
  const def = OBJEKT_DEFS[objekt];
  const set: Record<string, unknown> = {};
  const fehler: { feld: string; code: string; meldung: string }[] = [];
  for (const [schluessel, roh] of Object.entries(eingabe.system ?? {})) {
    const feld = def.felder.find((f) => f.schluessel === schluessel);
    if (!feld?.schreibbar) {
      fehler.push({ feld: schluessel, code: "not_writable", meldung: "Das Feld lässt sich nicht ändern" });
      continue;
    }
    if (roh === null) {
      if (SYSTEM_WERTE.required.has(schluessel)) fehler.push({ feld: schluessel, code: "required", meldung: "Pflichtfeld" });
      else set[feld.schreibbar.spalte] = null;
      continue;
    }
    const optionen = feld.optionen ? { optionen: feld.optionen.map((o) => ({ schluessel: o })) } : {};
    const ergebnis = wertSchema({ typ: feld.typ, optionen }).safeParse(roh);
    if (!ergebnis.success) fehler.push({ feld: schluessel, code: "invalid_value", meldung: ergebnis.error.issues[0]?.message ?? "Ungültiger Wert" });
    else set[feld.schreibbar.spalte] = ergebnis.data;
  }
  if (fehler.length) throw new Fachfehler(400, "FELDWERT_UNGUELTIG", "Mindestens ein Feldwert ist ungültig.", { felder: fehler });
  if (Object.keys(set).length && objekt === "deal" && vorher.status !== "offen") throw new Fachfehler(409, "DEAL_NICHT_OFFEN", "Der Deal ist nicht mehr offen.");

  let defs: FeldDef[] = [];
  let neueFelder = vorher.felder;
  if (eingabe.eigene && Object.keys(eingabe.eigene).length) {
    defs = await ladeFelder(tx, objekt, null);
    const geprueft = await pruefeFelder(tx, c, defs, eingabe.eigene);
    neueFelder = { ...vorher.felder };
    for (const [k, w] of Object.entries(geprueft)) {
      if (w === null) delete neueFelder[k];
      else neueFelder[k] = w;
    }
    set.felder = neueFelder;
  }
  if (Object.keys(set).length === 0) return vorher;
  if (objekt === "deal") set.aktualisiertAm = new Date();
  const [nachher] = await tx.update(t as typeof organisation).set(set as never).where(eq(t.id, id)).returning();
  await protokoll("aendern", TABELLENNAME[objekt], id, vorher, nachher);
  if (set.felder !== undefined) await synchronisiereVerknuepfungsfelder(tx, objekt, id, defs, neueFelder);
  return nachher;
}

/** Schreibt die Rückverweise der Verknüpfungsfelder (`art = relation`) neu: je Feld höchstens ein Ziel. */
export async function synchronisiereVerknuepfungsfelder(tx: Tx, objekt: Objekt, id: string, defs: FeldDef[], felder: Record<string, unknown>) {
  const relationen = defs.filter((d) => d.typ === "verknuepfung");
  if (relationen.length === 0) return;
  await tx.delete(datensatzLink).where(and(eq(datensatzLink.vonTyp, objekt), eq(datensatzLink.vonId, id), eq(datensatzLink.art, "relation"), inArray(datensatzLink.quelleId, relationen.map((d) => d.id))));
  const neu = relationen.flatMap((d) => (typeof felder[d.id] === "string" ? [{ vonTyp: objekt, vonId: id, zuTyp: d.optionen.ziel as Objekt, zuId: felder[d.id] as string, art: "relation", quelleId: d.id }] : []));
  if (neu.length) await tx.insert(datensatzLink).values(neu).onConflictDoNothing();
}

/** Archiviert Organisationen und Personen (weich). Organisationen mit Beteiligungen, Deals oder Investor-Zugängen bleiben. */
export async function archiviere(tx: Tx, protokoll: Protokollant, objekt: Objekt, id: string) {
  if (objekt === "deal") throw new Fachfehler(400, "MASSENAKTION_UNGUELTIG", "Deals werden nicht archiviert; sie lassen sich absagen.");
  const vorher = await ladeZeile(tx, objekt, id);
  if (objekt === "organisation") {
    const [b] = await tx.select({ n: sql<number>`count(*)::int` }).from(beteiligung).where(eq(beteiligung.organisationId, id));
    const [d] = await tx.select({ n: sql<number>`count(*)::int` }).from(deal).where(eq(deal.organisationId, id));
    const [z] = await tx.select({ n: sql<number>`count(*)::int` }).from(investorZugang).where(eq(investorZugang.organisationId, id));
    if ((b?.n ?? 0) + (d?.n ?? 0) + (z?.n ?? 0) > 0) throw new Fachfehler(409, "DATENSATZ_REFERENZIERT", "Das Unternehmen hat Beteiligungen, Deals oder Zugänge und lässt sich nicht archivieren.");
  } else {
    await tx.update(aufgabe).set({ erledigtAm: new Date() }).where(and(eq(aufgabe.personId, id), isNull(aufgabe.erledigtAm)));
  }
  const t = TABELLEN[objekt];
  const [nachher] = await tx.update(t as typeof organisation).set({ archiviertAm: new Date() } as never).where(eq(t.id, id)).returning();
  await protokoll("archivieren", TABELLENNAME[objekt], id, vorher, nachher);
}

/**
 * Setzt die Hauptbeschäftigung einer Person und spiegelt sie in `person.organisation_id` und `person.funktion`
 * (beide Spalten lesen viele andere Abfragen). `organisationId = null` entfernt die Hauptzeile.
 */
export async function spiegleHauptbeschaeftigung(tx: Tx, personId: string) {
  const [haupt] = await tx.select().from(beschaeftigung).where(and(eq(beschaeftigung.personId, personId), eq(beschaeftigung.haupt, true)));
  await tx
    .update(person)
    .set({ organisationId: haupt?.organisationId ?? null, ...(haupt ? { funktion: haupt.funktion ?? null } : {}) })
    .where(eq(person.id, personId));
}

export const beschaeftigungEingabe = z.object({
  personId: z.uuid(),
  organisationId: z.uuid(),
  funktion: z.string().trim().min(1).max(200).nullable().optional(),
  von: z.iso.date().nullable().optional(),
  bis: z.iso.date().nullable().optional(),
  haupt: z.boolean().default(false),
});

/**
 * Hauptunternehmen einer Person setzen oder entfernen und die Zeile in `beschaeftigung` nachziehen (aufgerufen, wenn
 * `person.organisation_id` über die bestehenden Wege geändert wird). Eine frühere Hauptzeile bleibt als Verlauf erhalten.
 */
export async function setzeHauptunternehmen(tx: Tx, personId: string, organisationId: string | null, funktion?: string | null) {
  const heute = new Date().toISOString().slice(0, 10);
  const [haupt] = await tx.select().from(beschaeftigung).where(and(eq(beschaeftigung.personId, personId), eq(beschaeftigung.haupt, true)));
  if (organisationId === null) {
    if (haupt) await tx.update(beschaeftigung).set({ haupt: false, bis: haupt.bis ?? heute }).where(eq(beschaeftigung.id, haupt.id));
    return;
  }
  if (haupt && haupt.organisationId === organisationId) {
    if (funktion !== undefined && funktion !== haupt.funktion) await tx.update(beschaeftigung).set({ funktion }).where(eq(beschaeftigung.id, haupt.id));
    return;
  }
  if (haupt) await tx.update(beschaeftigung).set({ haupt: false, bis: haupt.bis ?? heute }).where(eq(beschaeftigung.id, haupt.id));
  const [vorhanden] = await tx.select().from(beschaeftigung).where(and(eq(beschaeftigung.personId, personId), eq(beschaeftigung.organisationId, organisationId), isNull(beschaeftigung.bis)));
  if (vorhanden) await tx.update(beschaeftigung).set({ haupt: true, ...(funktion !== undefined ? { funktion } : {}) }).where(eq(beschaeftigung.id, vorhanden.id));
  else await tx.insert(beschaeftigung).values({ personId, organisationId, funktion: funktion ?? null, haupt: true });
}

/**
 * Beim Zusammenführen ziehen die Zeilen des CRM mit um: Aufgaben, Listeneinträge (doppelte fallen weg), Verknüpfungen, Beschäftigungen,
 * Deal-Kontakte; eigene Felder des Ziels gelten, Lücken füllt die Quelle, ebenso die Kontaktspalten Telefon, LinkedIn und E-Mail der Organisation.
 */
export async function ziehCrmUm(tx: Tx, objekt: "organisation" | "person", zielId: string, quelleId: string) {
  const t = objekt === "organisation" ? organisation : person;
  const [z] = await tx.select({ felder: t.felder }).from(t).where(eq(t.id, zielId));
  const [q] = await tx.select({ felder: t.felder }).from(t).where(eq(t.id, quelleId));
  const felder = { ...(q?.felder ?? {}), ...(z?.felder ?? {}) };
  await tx.update(t).set({ felder } as never).where(eq(t.id, zielId));
  if (objekt === "organisation") {
    await tx.execute(sql`UPDATE organisation z SET email = coalesce(z.email, q.email), telefon = coalesce(z.telefon, q.telefon), linkedin = coalesce(z.linkedin, q.linkedin) FROM organisation q WHERE z.id = ${zielId} AND q.id = ${quelleId}`);
  } else {
    await tx.execute(sql`UPDATE person z SET telefon = coalesce(z.telefon, q.telefon), linkedin = coalesce(z.linkedin, q.linkedin) FROM person q WHERE z.id = ${zielId} AND q.id = ${quelleId}`);
  }
  const aufgaben = await tx.update(aufgabe).set(objekt === "organisation" ? { organisationId: zielId } : { personId: zielId }).where(eq(objekt === "organisation" ? aufgabe.organisationId : aufgabe.personId, quelleId)).returning({ id: aufgabe.id });
  await tx.execute(sql`DELETE FROM ${listeEintrag} q WHERE q.datensatz_id = ${quelleId} AND EXISTS (SELECT 1 FROM ${listeEintrag} z WHERE z.liste_id = q.liste_id AND z.datensatz_id = ${zielId})`);
  const eintraege = await tx.update(listeEintrag).set({ datensatzId: zielId }).where(eq(listeEintrag.datensatzId, quelleId)).returning({ id: listeEintrag.id });
  // Verknüpfungen: neu schreiben, ohne Selbstverweise und Doppelte.
  const links = await tx.select().from(datensatzLink).where(sql`(${datensatzLink.vonId} = ${quelleId} OR ${datensatzLink.zuId} = ${quelleId})`);
  if (links.length) {
    await tx.delete(datensatzLink).where(inArray(datensatzLink.id, links.map((l) => l.id)));
    const neu = links
      .map((l) => ({ vonTyp: l.vonTyp, vonId: l.vonId === quelleId ? zielId : l.vonId, zuTyp: l.zuTyp, zuId: l.zuId === quelleId ? zielId : l.zuId, art: l.art, quelleId: l.quelleId }))
      .filter((l) => !(l.vonTyp === l.zuTyp && l.vonId === l.zuId));
    if (neu.length) await tx.insert(datensatzLink).values(neu).onConflictDoNothing();
  }
  if (objekt === "organisation") {
    await tx.execute(sql`DELETE FROM ${beschaeftigung} q WHERE q.organisation_id = ${quelleId} AND EXISTS (SELECT 1 FROM ${beschaeftigung} z WHERE z.person_id = q.person_id AND z.organisation_id = ${zielId} AND z.id <> q.id AND z.bis IS NULL AND q.bis IS NULL AND NOT q.haupt)`);
    await tx.update(beschaeftigung).set({ organisationId: zielId }).where(eq(beschaeftigung.organisationId, quelleId));
  } else {
    await tx.update(beschaeftigung).set({ haupt: false }).where(and(eq(beschaeftigung.personId, quelleId), eq(beschaeftigung.haupt, true)));
    await tx.update(beschaeftigung).set({ personId: zielId }).where(eq(beschaeftigung.personId, quelleId));
    await tx.execute(sql`DELETE FROM ${dealKontakt} q WHERE q.person_id = ${quelleId} AND EXISTS (SELECT 1 FROM ${dealKontakt} z WHERE z.deal_id = q.deal_id AND z.person_id = ${zielId})`);
    await tx.update(dealKontakt).set({ personId: zielId }).where(eq(dealKontakt.personId, quelleId));
  }
  return { aufgaben: aufgaben.length, listeneintraege: eintraege.length };
}
