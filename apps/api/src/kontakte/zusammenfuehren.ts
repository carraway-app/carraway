import { eq, inArray, sql } from "drizzle-orm";
import { aktivitaet, beteiligung, deal, finanzierungsrunde, gremienmandat, organisation, organisationsbeziehung, person, rundenposition, vehikel } from "@carraway/db";
import { hatRolle, sichtbareFonds, type Akteur } from "../anmeldung/akteur";
import { Fachfehler, bereitsZusammengefuehrtFehler } from "../fehler";
import type { Bereich } from "../rechte/bereiche";
import { fehlendeBereiche, verlangeBereiche } from "../rechte/uebergreifend";
import type { Protokollant } from "../schreiben";
import { setzeHauptunternehmen, ziehCrmUm } from "../crm/datensatz";
import type { Tx } from "../zeitlimit";

interface Protokollzeile {
  aktion: string;
  tabelle: string;
  datensatzId: string;
  vorher: unknown;
  nachher: unknown;
}

/**
 * Zusammenführen zweier Organisationen oder Personen (Etappe 7). Das Ziel bleibt, die Quelle bleibt als Datensatz erhalten
 * (`zusammengefuehrt_in`, nie gelöscht) und nimmt nichts Neues mehr auf. Alle Verweise der Quelle ziehen zum Ziel um;
 * Zeilen, die dadurch doppelt würden (gleiche Rolle, gleiche Beziehung) oder sich selbst verknüpfen würden, entfallen mit
 * Eintrag im Änderungsprotokoll. Alles läuft in einer Transaktion.
 */

export const ORGANISATION_FELDER = ["name", "art", "sektor", "ort", "website"] as const;
export const PERSON_FELDER = ["vorname", "nachname", "email", "funktion", "organisationId"] as const;
export type Seite = "ziel" | "quelle";

type Wert = string | null;

export interface FeldVergleich {
  feld: string;
  ziel: Wert;
  quelle: Wert;
  abweichend: boolean;
  /** Vorschlag: der Wert des Ziels, außer er fehlt und die Quelle hat einen. */
  vorschlag: Seite;
}

const leer = (w: Wert | undefined) => w === null || w === undefined || w.trim() === "";

function vergleiche(felder: readonly string[], ziel: Record<string, unknown>, quelle: Record<string, unknown>): FeldVergleich[] {
  return felder.map((feld) => {
    const z = (ziel[feld] ?? null) as Wert;
    const q = (quelle[feld] ?? null) as Wert;
    return { feld, ziel: z, quelle: q, abweichend: z !== q, vorschlag: leer(z) && !leer(q) ? "quelle" : "ziel" };
  });
}

/** Werte der Felder aus der Wahl je Feld; ohne Wahl gilt der Vorschlag. */
function gewaehlteWerte(vergleich: FeldVergleich[], wahl: Partial<Record<string, Seite>>): Record<string, Wert> {
  const werte: Record<string, Wert> = {};
  for (const v of vergleich) {
    const seite = wahl[v.feld] ?? v.vorschlag;
    // Ein Pflichtfeld (Name, Art, Vor- und Nachname) wird nie auf leer gesetzt.
    werte[v.feld] = seite === "quelle" ? v.quelle : v.ziel;
  }
  return werte;
}

export interface OrganisationsVorschau {
  ziel: typeof organisation.$inferSelect;
  quelle: typeof organisation.$inferSelect;
  felder: FeldVergleich[];
  verschiebt: { personen: number; deals: number; aktivitaeten: number; beteiligungen: number; rollen: number; beziehungen: number; runden: number; rundenpositionen: number };
  /** Fonds, die Beteiligungen einer der beiden Organisationen halten. */
  fondsIds: string[];
  /** Mit Beteiligungen verlangt die Zusammenführung die Rolle Freigeber an allen betroffenen Fonds. */
  freigabeNoetig: boolean;
  darfAusfuehren: boolean;
  /** Fonds und Instrument, die beide Organisationen halten und die die Person sehen darf: dann wird nicht zusammengeführt (409). */
  ueberschneidungen: { fondsId: string; instrument: string }[];
  /** Es gibt eine Überschneidung an einem Fonds, den die Person nicht sehen darf; zusammengeführt wird trotzdem nicht. */
  ueberschneidungVerdeckt: boolean;
  /** Mindestens ein betroffener Fonds ist für die Person nicht sichtbar (seine ID und seine Zahlen bleiben verborgen). */
  verdeckteFonds: boolean;
  /** Bereiche, die das Zusammenführen berührt und die der Person fehlen: Zahlen und Fonds dieser Bereiche bleiben verborgen, ausführen geht nicht. */
  bereichFehlt: Bereich[];
}

export interface PersonenVorschau {
  ziel: typeof person.$inferSelect;
  quelle: typeof person.$inferSelect;
  felder: FeldVergleich[];
  /** Bearbeiter an allen Fonds der Deals, an denen Aktivitäten der Personen hängen (ohne Namen der Fonds). */
  darfAusfuehren: boolean;
  verschiebt: { aktivitaeten: number; rollen: number; mandate: number };
  /** Hängen Deal-Kontakte oder Aktivitäten an Deals, fehlt der Bereich Dealflow: die Person darf nicht zusammenführen. */
  bereichFehlt: Bereich[];
}

async function zaehle(tx: Tx, abfrage: ReturnType<typeof sql>): Promise<number> {
  const { rows } = await tx.execute<{ n: number }>(abfrage);
  return Number(rows[0]?.n ?? 0);
}

/** Sperrt beide Zeilen in fester Reihenfolge (gegen Verklemmungen bei gleichzeitigen Zusammenführungen) und prüft sie. */
async function sperreBeide<T extends { id: string; zusammengefuehrtIn: string | null }>(
  ladeSperre: (ids: string[]) => Promise<T[]>,
  zielId: string,
  quelleId: string,
  nichtGefunden: Fachfehler,
): Promise<{ ziel: T; quelle: T }> {
  if (zielId === quelleId) throw new Fachfehler(400, "merge_invalid", "A record cannot be merged with itself.");
  const zeilen = await ladeSperre([zielId, quelleId].sort());
  const ziel = zeilen.find((z) => z.id === zielId);
  const quelle = zeilen.find((z) => z.id === quelleId);
  if (!ziel || !quelle) throw nichtGefunden;
  for (const z of [ziel, quelle]) if (z.zusammengefuehrtIn) throw bereitsZusammengefuehrtFehler(z.zusammengefuehrtIn);
  return { ziel, quelle };
}

/** `sperren`: die Zeilen bis zum Ende der Transaktion sperren (Zusammenführen); die Vorschau läuft schreibgeschützt ohne Sperre. */
const sperreOrganisationen = (tx: Tx, zielId: string, quelleId: string, sperren: boolean) =>
  sperreBeide(
    (ids) => {
      const abfrage = tx.select().from(organisation).where(inArray(organisation.id, ids)).orderBy(organisation.id);
      return sperren ? abfrage.for("update") : abfrage;
    },
    zielId,
    quelleId,
    new Fachfehler(404, "organization_not_found", "Organization not found."),
  );

const sperrePersonen = (tx: Tx, zielId: string, quelleId: string, sperren: boolean) =>
  sperreBeide(
    (ids) => {
      const abfrage = tx.select().from(person).where(inArray(person.id, ids)).orderBy(person.id);
      return sperren ? abfrage.for("update") : abfrage;
    },
    zielId,
    quelleId,
    new Fachfehler(404, "person_not_found", "Person not found."),
  );

/** Fonds der Deals, die ein Zusammenführen berührt: Deals der Organisationen und Deals, an denen Aktivitäten der Datensätze hängen. */
async function dealFonds(tx: Tx, spalte: "organisation_id" | "person_id", ids: string[]): Promise<string[]> {
  const liste = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const sp = sql.raw(spalte);
  const { rows } = await tx.execute<{ fonds_id: string }>(
    spalte === "organisation_id"
      ? sql`SELECT DISTINCT d.fonds_id FROM deal d WHERE d.fonds_id IS NOT NULL AND (d.organisation_id IN (${liste}) OR d.id IN (SELECT deal_id FROM aktivitaet WHERE ${sp} IN (${liste}) AND deal_id IS NOT NULL))`
      : sql`SELECT DISTINCT d.fonds_id FROM deal d WHERE d.fonds_id IS NOT NULL AND d.id IN (SELECT deal_id FROM aktivitaet WHERE ${sp} IN (${liste}) AND deal_id IS NOT NULL)`,
  );
  return rows.map((r) => r.fonds_id);
}

/** Fonds der Beteiligungen, an denen Gremienmandate der Personen hängen (Issue #156). */
async function mandatFonds(tx: Tx, ids: string[]): Promise<string[]> {
  const zeilen = await tx
    .selectDistinct({ fondsId: beteiligung.fondsId })
    .from(gremienmandat)
    .innerJoin(beteiligung, eq(beteiligung.id, gremienmandat.beteiligungId))
    .where(inArray(gremienmandat.personId, ids));
  return zeilen.map((z) => z.fondsId).sort();
}

/** Mandate ziehen nur um, wenn die Person an jedem ihrer Fonds Bearbeiter mit Bereich Portfolio ist (auch an Fonds ohne Sicht nicht). */
const darfMandate = (akteur: Akteur, fonds: string[]) => fonds.every((f) => hatRolle(akteur, f, "bearbeiter", "portfolio"));

/** Bearbeiter an jedem Fonds, dessen Deals umziehen; ohne Rolle an einem davon (auch ohne Sicht) ist Zusammenführen verboten. */
const darfDeals = (akteur: Akteur, fonds: string[]) => fonds.every((f) => hatRolle(akteur, f, "bearbeiter", "dealflow"));

/** Bereiche, in die das Zusammenführen von Organisationen schreibt: Beteiligungen, Runden und Rundenpositionen (Portfolio), Deals (Dealflow). */
const BEREICHE_ORGANISATION: Bereich[] = ["portfolio", "dealflow"];

/** Berührt das Zusammenführen Deals? Deal-Kontakte der Quelle ziehen um, ihre Aktivitäten an Deals ebenso. */
async function beruehrtDeals(tx: Tx, quelleId: string): Promise<boolean> {
  const n = await zaehle(
    tx,
    sql`SELECT ((SELECT count(*) FROM deal_kontakt WHERE person_id = ${quelleId}::uuid)
      + (SELECT count(*) FROM aktivitaet WHERE person_id = ${quelleId}::uuid AND deal_id IS NOT NULL))::int AS n`,
  );
  return n > 0;
}

async function beteiligungsLage(tx: Tx, akteur: Akteur, zielId: string, quelleId: string) {
  const zeilen = await tx
    .select({ organisationId: beteiligung.organisationId, fondsId: beteiligung.fondsId, instrument: beteiligung.instrument })
    .from(beteiligung)
    .where(inArray(beteiligung.organisationId, [zielId, quelleId]));
  const fondsIds = [...new Set(zeilen.map((z) => z.fondsId))].sort();
  // Je Fonds und Unternehmen gibt es höchstens eine Beteiligung: Hält ein Fonds beide Organisationen, ließen sich die Beteiligungen nicht vereinen.
  const ziel = new Set(zeilen.filter((z) => z.organisationId === zielId).map((z) => z.fondsId));
  const ueberschneidungen = zeilen
    .filter((z) => z.organisationId === quelleId && ziel.has(z.fondsId))
    .map((z) => ({ fondsId: z.fondsId, instrument: z.instrument as string }))
    .sort((a, b) => `${a.fondsId}${a.instrument}`.localeCompare(`${b.fondsId}${b.instrument}`));
  const dealRechte = darfDeals(akteur, await dealFonds(tx, "organisation_id", [zielId, quelleId]));
  const darf = dealRechte && fondsIds.every((f) => hatRolle(akteur, f, "freigeber", "portfolio"));
  // Fonds ohne Rolle der Person bleiben verborgen: nach außen nur Wahrheitswerte, nie ihre IDs.
  const sicht = sichtbareFonds(akteur, "betrachter", "portfolio");
  const sichtbar = (f: string) => sicht === "alle" || sicht.includes(f);
  return {
    fondsIds,
    ueberschneidungen,
    sichtbareFondsIds: fondsIds.filter(sichtbar),
    sichtbareUeberschneidungen: ueberschneidungen.filter((u) => sichtbar(u.fondsId)),
    sichtbar,
    ueberschneidungVerdeckt: ueberschneidungen.some((u) => !sichtbar(u.fondsId)),
    darfAusfuehren: darf,
    freigabeNoetig: fondsIds.length > 0,
  };
}

export async function vorschauOrganisationen(tx: Tx, akteur: Akteur, zielId: string, quelleId: string): Promise<OrganisationsVorschau> {
  const { ziel, quelle } = await sperreOrganisationen(tx, zielId, quelleId, false);
  const lage = await beteiligungsLage(tx, akteur, zielId, quelleId);
  const q = quelleId;
  // Ohne den Bereich bleiben die Zahlen und Fonds dieses Bereichs verborgen (nur Wahrheitswert und Liste der fehlenden Bereiche).
  const bereichFehlt = fehlendeBereiche(akteur, BEREICHE_ORGANISATION);
  const portfolio = !bereichFehlt.includes("portfolio");
  const dealflow = !bereichFehlt.includes("dealflow");
  // Zahlen zu Deals und Beteiligungen zählen nur Fonds, die die Person sehen darf.
  // Bereiche je Fonds: Deals nach Fonds mit Dealflow, Beteiligungen nach Fonds mit Portfolio.
  const sicht = sichtbareFonds(akteur, "betrachter", "portfolio");
  const dealSicht = sichtbareFonds(akteur, "betrachter", "dealflow");
  const dealBedingung =
    dealSicht === "alle" ? sql`true` : dealSicht.length ? sql`(fonds_id IS NULL OR fonds_id IN (${sql.join(dealSicht.map((f) => sql`${f}::uuid`), sql`, `)}))` : sql`fonds_id IS NULL`;
  const fondsBedingung = sicht === "alle" ? sql`true` : sicht.length ? sql`fonds_id IN (${sql.join(sicht.map((f) => sql`${f}::uuid`), sql`, `)})` : sql`false`;
  return {
    ziel,
    quelle,
    felder: vergleiche(ORGANISATION_FELDER, ziel, quelle),
    verschiebt: {
      personen: await zaehle(tx, sql`SELECT count(*)::int AS n FROM person WHERE organisation_id = ${q}`),
      deals: dealflow ? await zaehle(tx, sql`SELECT count(*)::int AS n FROM deal WHERE organisation_id = ${q} AND ${dealBedingung}`) : 0,
      aktivitaeten: await zaehle(tx, sql`SELECT count(*)::int AS n FROM aktivitaet WHERE organisation_id = ${q}`),
      beteiligungen: portfolio ? await zaehle(tx, sql`SELECT count(*)::int AS n FROM beteiligung WHERE organisation_id = ${q} AND ${fondsBedingung}`) : 0,
      rollen: await zaehle(tx, sql`SELECT count(*)::int AS n FROM kontaktrolle WHERE organisation_id = ${q}`),
      beziehungen: await zaehle(tx, sql`SELECT count(*)::int AS n FROM organisationsbeziehung WHERE von_organisation_id = ${q} OR zu_organisation_id = ${q}`),
      runden: portfolio ? await zaehle(tx, sql`SELECT count(*)::int AS n FROM finanzierungsrunde WHERE organisation_id = ${q}`) : 0,
      rundenpositionen: portfolio ? await zaehle(tx, sql`SELECT count(*)::int AS n FROM rundenposition p JOIN vehikel v ON v.id = p.vehikel_id WHERE v.investor_id = ${q}`) : 0,
    },
    fondsIds: portfolio ? lage.sichtbareFondsIds : [],
    verdeckteFonds: portfolio && lage.sichtbareFondsIds.length < lage.fondsIds.length,
    freigabeNoetig: portfolio && lage.freigabeNoetig,
    darfAusfuehren: bereichFehlt.length === 0 && lage.darfAusfuehren,
    ueberschneidungen: portfolio ? lage.sichtbareUeberschneidungen : [],
    ueberschneidungVerdeckt: portfolio && lage.ueberschneidungVerdeckt,
    bereichFehlt,
  };
}

export async function vorschauPersonen(tx: Tx, akteur: Akteur, zielId: string, quelleId: string): Promise<PersonenVorschau> {
  const { ziel, quelle } = await sperrePersonen(tx, zielId, quelleId, false);
  const bereichFehlt = fehlendeBereiche(akteur, ["dealflow"]);
  const dealsFehlen = bereichFehlt.length > 0 && (await beruehrtDeals(tx, quelleId));
  const mandatFonds_ = await mandatFonds(tx, [zielId, quelleId]);
  const sicht = sichtbareFonds(akteur, "betrachter", "portfolio");
  const quellMandate = await tx
    .select({ fondsId: beteiligung.fondsId })
    .from(gremienmandat)
    .innerJoin(beteiligung, eq(beteiligung.id, gremienmandat.beteiligungId))
    .where(eq(gremienmandat.personId, quelleId));
  const sichtbareMandate = quellMandate.filter((m) => sicht === "alle" || sicht.includes(m.fondsId)).length;
  return {
    ziel,
    quelle,
    felder: vergleiche(PERSON_FELDER, ziel, quelle),
    bereichFehlt: dealsFehlen ? bereichFehlt : [],
    darfAusfuehren: !dealsFehlen && darfDeals(akteur, await dealFonds(tx, "person_id", [zielId, quelleId])) && darfMandate(akteur, mandatFonds_),
    verschiebt: {
      aktivitaeten: await zaehle(tx, sql`SELECT count(*)::int AS n FROM aktivitaet WHERE person_id = ${quelleId}`),
      rollen: await zaehle(tx, sql`SELECT count(*)::int AS n FROM kontaktrolle WHERE person_id = ${quelleId}`),
      // Nur Mandate in Fonds, die die Person sehen darf; Fonds ohne Sicht bleiben verborgen.
      mandate: sichtbareMandate,
    },
  };
}

const verschoben = (tabelle: string, zeilen: { id: string }[], feld: string, von: string, nach: string): Protokollzeile[] =>
  zeilen.map((z) => ({ aktion: "zusammenfuehren_verschieben", tabelle, datensatzId: z.id, vorher: { [feld]: von }, nachher: { [feld]: nach } }));

const geloescht = (tabelle: string, zeilen: { id: string }[]): Protokollzeile[] =>
  zeilen.map((z) => ({ aktion: "zusammenfuehren_entfallen", tabelle, datensatzId: z.id, vorher: z, nachher: null }));

/**
 * Vehikel der Quelle ziehen zum Ziel (docs/portfolio-modell.md, „Vehikel der Co-Investoren“). Hat das Ziel schon ein Vehikel gleichen Namens, wandern die
 * Positionen dorthin und das Vehikel der Quelle entfällt; hat das Ziel schon ein Standard-Vehikel, verliert das der Quelle das Kennzeichen. Liefert die Zahl
 * der Positionen an Vehikeln der Quelle.
 */
async function zieheVehikelUm(tx: Tx, protokoll: Protokollant, quelleId: string, zielId: string): Promise<number> {
  const quelle = await tx.select().from(vehikel).where(eq(vehikel.investorId, quelleId)).for("update");
  if (quelle.length === 0) return 0;
  const ziel = await tx.select().from(vehikel).where(eq(vehikel.investorId, zielId)).for("update");
  let zielHatStandard = ziel.some((v) => v.standard);
  // Gleichnamige Vehikel werden eins. Hält das Ziel-Vehikel in einer Runde schon eine Position, würde die der Quelle daneben stehen
  // (je Runde und Vehikel höchstens eine Position): dann wird nichts zusammengeführt, die Positionen sind vorher von Hand zusammenzulegen.
  const paare = quelle.flatMap((v) => {
    const gleich = ziel.find((z) => z.name === v.name);
    return gleich ? [{ quelle: v.id, ziel: gleich.id }] : [];
  });
  if (paare.length > 0) {
    const kollisionen = await tx.execute<{ runde_id: string; vehikel: string }>(sql`
      SELECT DISTINCT q.runde_id, v.name AS vehikel
      FROM rundenposition q
      JOIN rundenposition z ON z.runde_id = q.runde_id
      JOIN vehikel v ON v.id = q.vehikel_id
      WHERE (q.vehikel_id, z.vehikel_id) IN (${sql.join(paare.map((p) => sql`(${p.quelle}::uuid, ${p.ziel}::uuid)`), sql`, `)})`);
    if (kollisionen.rows.length > 0) {
      throw new Fachfehler(409, "vehicle_position_conflict", "Vehicles with the same name each hold a position in the same round. A round has at most one position per vehicle; combine the positions first.", {
        kollisionen: kollisionen.rows.map((r) => ({ rundeId: r.runde_id, vehikel: r.vehikel })),
      });
    }
  }
  let positionen = 0;
  for (const v of quelle) {
    const gleich = ziel.find((z) => z.name === v.name);
    const zeilen = await tx.select({ id: rundenposition.id }).from(rundenposition).where(eq(rundenposition.vehikelId, v.id));
    positionen += zeilen.length;
    if (gleich) {
      await tx.update(rundenposition).set({ vehikelId: gleich.id }).where(eq(rundenposition.vehikelId, v.id));
      await protokoll.mehrere(verschoben("rundenposition", zeilen, "vehikelId", v.id, gleich.id));
      await tx.delete(vehikel).where(eq(vehikel.id, v.id));
      await protokoll.mehrere(geloescht("vehikel", [v]));
      continue;
    }
    const standard = v.standard && !zielHatStandard;
    zielHatStandard ||= standard;
    await tx.update(vehikel).set({ investorId: zielId, standard }).where(eq(vehikel.id, v.id));
    await protokoll.mehrere([{ aktion: "zusammenfuehren_verschieben", tabelle: "vehikel", datensatzId: v.id, vorher: { investorId: quelleId, standard: v.standard }, nachher: { investorId: zielId, standard } }]);
  }
  return positionen;
}

/** Rollen der Quelle, die das Ziel schon hat (gleiche Person oder Organisation, Rolle und Beginn), entfallen; die übrigen ziehen um. */
async function bereinigeRollen(tx: Tx, protokoll: Protokollant, spalte: "person_id" | "organisation_id", quelleId: string, zielId: string) {
  const andere = spalte === "person_id" ? sql.raw("organisation_id") : sql.raw("person_id");
  const sp = sql.raw(spalte);
  const entfallen = await tx.execute<{ id: string }>(sql`
    DELETE FROM kontaktrolle q
    WHERE q.${sp} = ${quelleId}
      AND EXISTS (
        SELECT 1 FROM kontaktrolle z
        WHERE z.id <> q.id AND z.${sp} = ${zielId} AND z.${andere} = q.${andere} AND z.rolle = q.rolle AND z.von IS NOT DISTINCT FROM q.von
      )
    RETURNING q.*`);
  await protokoll.mehrere(geloescht("kontaktrolle", entfallen.rows));
  const umgezogen = await tx.execute<{ id: string }>(sql`UPDATE kontaktrolle SET ${sp} = ${zielId} WHERE ${sp} = ${quelleId} RETURNING id`);
  await protokoll.mehrere(verschoben("kontaktrolle", umgezogen.rows, spalte, quelleId, zielId));
  return umgezogen.rows.length;
}

export interface OrganisationsErgebnis {
  organisation: typeof organisation.$inferSelect;
  quelleId: string;
  verschoben: OrganisationsVorschau["verschiebt"];
}

export async function fuehreOrganisationenZusammen(
  tx: Tx,
  protokoll: Protokollant,
  akteur: Akteur,
  zielId: string,
  quelleId: string,
  wahl: Partial<Record<string, Seite>>,
): Promise<OrganisationsErgebnis> {
  // Beteiligungen, Runden und Deals ziehen um: Das Zusammenführen schreibt in Portfolio und Dealflow, nicht nur in Kontakte.
  verlangeBereiche(akteur, BEREICHE_ORGANISATION);
  const { ziel, quelle } = await sperreOrganisationen(tx, zielId, quelleId, true);
  // LP-Portal (Etappe 12): Zugänge, Zeichnungen, Mitteilungen und Berichtsfassungen hängen an der Organisation des Investors; die Quelle würde sie verlieren.
  const { rows: portal } = await tx.execute<{ n: number }>(sql`
    SELECT ((SELECT count(*) FROM investor_zugang WHERE organisation_id = ${quelleId})
      + (SELECT count(*) FROM fonds_zeichnung WHERE organisation_id = ${quelleId})
      + (SELECT count(*) FROM fonds_mitteilung WHERE organisation_id = ${quelleId})
      + (SELECT count(*) FROM bericht_variante WHERE organisation_id = ${quelleId}))::int AS n`);
  if ((portal[0]?.n ?? 0) > 0) {
    throw new Fachfehler(409, "investor_access_exists", "The organization has subscriptions, notices or LP portal access and cannot be merged as the source.");
  }
  const lage = await beteiligungsLage(tx, akteur, zielId, quelleId);
  // Mit Beteiligungen ist die Zusammenführung eine Entscheidung über Fondsbestände: Freigeber an jedem betroffenen Fonds.
  if (!lage.darfAusfuehren) throw new Fachfehler(403, "forbidden", "Merging requires the editor role for all funds of the affected deals and the approver role for all funds with investments.");
  if (lage.ueberschneidungen.length > 0) {
    throw new Fachfehler(409, "investments_overlap", "Both organizations are held by the same fund.", {
      ueberschneidungen: lage.sichtbareUeberschneidungen,
      ueberschneidungVerdeckt: lage.ueberschneidungVerdeckt,
    });
  }

  const werte = gewaehlteWerte(vergleiche(ORGANISATION_FELDER, ziel, quelle), wahl);
  if (leer(werte.name) || leer(werte.art)) throw new Fachfehler(400, "merge_invalid", "Name and type must not be empty.");

  const bewegt: OrganisationsErgebnis["verschoben"] = { personen: 0, deals: 0, aktivitaeten: 0, beteiligungen: 0, rollen: 0, beziehungen: 0, runden: 0, rundenpositionen: 0 };
  const umziehen = async (tabelle: string, ziele: typeof person | typeof deal | typeof aktivitaet | typeof beteiligung | typeof finanzierungsrunde) => {
    const zeilen = await tx
      .update(ziele)
      .set({ organisationId: zielId })
      .where(eq(ziele.organisationId, quelleId))
      .returning({ id: ziele.id });
    await protokoll.mehrere(verschoben(tabelle, zeilen, "organisationId", quelleId, zielId));
    return zeilen.length;
  };
  bewegt.personen = await umziehen("person", person);
  bewegt.deals = await umziehen("deal", deal);
  bewegt.aktivitaeten = await umziehen("aktivitaet", aktivitaet);
  bewegt.beteiligungen = await umziehen("beteiligung", beteiligung);
  bewegt.runden = await umziehen("finanzierungsrunde", finanzierungsrunde);
  bewegt.rundenpositionen = await zieheVehikelUm(tx, protokoll, quelleId, zielId);
  bewegt.rollen = await bereinigeRollen(tx, protokoll, "organisation_id", quelleId, zielId);
  // Zuordnungen aus der Datenübernahme (Etappe 6) folgen dem Ziel, damit ein erneuter Import nicht die zusammengeführte Quelle trifft.
  await tx.execute(sql`UPDATE import_zuordnung SET datensatz_id = ${zielId} WHERE objekt = 'organisation' AND datensatz_id = ${quelleId}`);

  // Beziehungen: die zwischen Quelle und Ziel würden sich selbst verknüpfen, doppelte entfallen, die übrigen ziehen um.
  const selbst = await tx.execute<{ id: string }>(sql`
    DELETE FROM organisationsbeziehung
    WHERE (von_organisation_id = ${quelleId} AND zu_organisation_id = ${zielId}) OR (von_organisation_id = ${zielId} AND zu_organisation_id = ${quelleId})
    RETURNING *`);
  const doppelt = await tx.execute<{ id: string }>(sql`
    DELETE FROM organisationsbeziehung q
    WHERE (q.von_organisation_id = ${quelleId} OR q.zu_organisation_id = ${quelleId})
      AND EXISTS (
        SELECT 1 FROM organisationsbeziehung z
        WHERE z.id <> q.id AND z.art = q.art
          AND z.von_organisation_id = CASE WHEN q.von_organisation_id = ${quelleId} THEN ${zielId}::uuid ELSE q.von_organisation_id END
          AND z.zu_organisation_id IS NOT DISTINCT FROM CASE WHEN q.zu_organisation_id = ${quelleId} THEN ${zielId}::uuid ELSE q.zu_organisation_id END
          AND z.fonds_id IS NOT DISTINCT FROM q.fonds_id
      )
    RETURNING q.*`);
  await protokoll.mehrere(geloescht("organisationsbeziehung", [...selbst.rows, ...doppelt.rows]));
  const ausgehend = await tx.update(organisationsbeziehung).set({ vonOrganisationId: zielId }).where(eq(organisationsbeziehung.vonOrganisationId, quelleId)).returning({ id: organisationsbeziehung.id });
  const eingehend = await tx.update(organisationsbeziehung).set({ zuOrganisationId: zielId }).where(eq(organisationsbeziehung.zuOrganisationId, quelleId)).returning({ id: organisationsbeziehung.id });
  await protokoll.mehrere([...verschoben("organisationsbeziehung", ausgehend, "vonOrganisationId", quelleId, zielId), ...verschoben("organisationsbeziehung", eingehend, "zuOrganisationId", quelleId, zielId)]);
  bewegt.beziehungen = ausgehend.length + eingehend.length;

  const [nachherZiel] = await tx
    .update(organisation)
    .set({ name: werte.name!, art: werte.art as typeof ziel.art, sektor: werte.sektor ?? null, ort: werte.ort ?? null, website: werte.website ?? null, rechtsform: ziel.rechtsform ?? quelle.rechtsform })
    .where(eq(organisation.id, zielId))
    .returning();
  const [nachherQuelle] = await tx
    .update(organisation)
    .set({ zusammengefuehrtIn: zielId, zusammengefuehrtAm: new Date() })
    .where(eq(organisation.id, quelleId))
    .returning();
  const crm = await ziehCrmUm(tx, "organisation", zielId, quelleId);
  await protokoll("zusammenfuehren", "organisation", zielId, ziel, { ...nachherZiel, zusammengefuehrtAus: quelleId, verschoben: { ...bewegt, ...crm } });
  await protokoll("zusammengefuehrt", "organisation", quelleId, quelle, nachherQuelle);

  // Die gespeicherte Fondsübersicht trägt Organisations-ID und -Name: betroffene Fonds neu rechnen lassen.
  if (bewegt.beteiligungen > 0 || ziel.name !== werte.name) {
    await tx.execute(sql`INSERT INTO snapshot_auftrag (fonds_id) SELECT DISTINCT fonds_id FROM beteiligung WHERE organisation_id = ${zielId} ON CONFLICT DO NOTHING`);
  }
  return { organisation: nachherZiel!, quelleId, verschoben: bewegt };
}

export interface PersonenErgebnis {
  person: typeof person.$inferSelect;
  quelleId: string;
  verschoben: PersonenVorschau["verschiebt"];
}

export async function fuehrePersonenZusammen(tx: Tx, protokoll: Protokollant, akteur: Akteur, zielId: string, quelleId: string, wahl: Partial<Record<string, Seite>>): Promise<PersonenErgebnis> {
  const { ziel, quelle } = await sperrePersonen(tx, zielId, quelleId, true);
  // Deal-Kontakte und Aktivitäten an Deals ziehen um: ohne den Bereich Dealflow nur, wenn keine Deals berührt sind.
  if (await beruehrtDeals(tx, quelleId)) verlangeBereiche(akteur, ["dealflow"]);
  if (!darfDeals(akteur, await dealFonds(tx, "person_id", [zielId, quelleId]))) {
    throw new Fachfehler(403, "forbidden", "Activities of the persons are linked to deals of funds for which the editor role is missing.");
  }
  if (!darfMandate(akteur, await mandatFonds(tx, [zielId, quelleId]))) {
    throw new Fachfehler(403, "forbidden", "Board mandates of the persons belong to investments of funds for which the editor role in the portfolio area is missing.");
  }
  const werte = gewaehlteWerte(vergleiche(PERSON_FELDER, ziel, quelle), wahl);
  if (leer(werte.vorname) || leer(werte.nachname)) throw new Fachfehler(400, "merge_invalid", "First and last name must not be empty.");
  if (werte.organisationId) {
    const [org] = await tx.select({ id: organisation.id, weg: organisation.zusammengefuehrtIn }).from(organisation).where(eq(organisation.id, werte.organisationId));
    if (!org || org.weg) throw new Fachfehler(400, "merge_invalid", "The selected organization no longer exists.");
  }

  const akt = await tx.update(aktivitaet).set({ personId: zielId }).where(eq(aktivitaet.personId, quelleId)).returning({ id: aktivitaet.id });
  await protokoll.mehrere(verschoben("aktivitaet", akt, "personId", quelleId, zielId));
  const rollen = await bereinigeRollen(tx, protokoll, "person_id", quelleId, zielId);
  // Gremienmandate (Issue #156) ziehen mit um; doppelte Mandate bleiben sichtbar und lassen sich danach von Hand löschen.
  const mandate = await tx.update(gremienmandat).set({ personId: zielId }).where(eq(gremienmandat.personId, quelleId)).returning({ id: gremienmandat.id });
  await protokoll.mehrere(verschoben("gremienmandat", mandate, "personId", quelleId, zielId));
  await tx.execute(sql`UPDATE import_zuordnung SET datensatz_id = ${zielId} WHERE objekt = 'person' AND datensatz_id = ${quelleId}`);

  const [nachherZiel] = await tx
    .update(person)
    .set({ vorname: werte.vorname!, nachname: werte.nachname!, email: werte.email ?? null, funktion: werte.funktion ?? null, organisationId: werte.organisationId ?? null })
    .where(eq(person.id, zielId))
    .returning();
  const [nachherQuelle] = await tx.update(person).set({ zusammengefuehrtIn: zielId, zusammengefuehrtAm: new Date() }).where(eq(person.id, quelleId)).returning();
  const crm = await ziehCrmUm(tx, "person", zielId, quelleId);
  await setzeHauptunternehmen(tx, zielId, nachherZiel!.organisationId, nachherZiel!.funktion);
  const bewegt = { aktivitaeten: akt.length, rollen, mandate: mandate.length };
  await protokoll("zusammenfuehren", "person", zielId, ziel, { ...nachherZiel, zusammengefuehrtAus: quelleId, verschoben: { ...bewegt, ...crm } });
  await protokoll("zusammengefuehrt", "person", quelleId, quelle, nachherQuelle);
  return { person: nachherZiel!, quelleId, verschoben: bewegt };
}
