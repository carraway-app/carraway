import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { benutzer, fonds, fondsRolle, investorBenutzer, type FondsRolle, nutzergruppe, nutzergruppeFonds, nutzergruppeMitglied, nutzergruppeRolle, rechteEinstellung, rechterolle, type Db } from "@carraway/db";
import { Fachfehler } from "../fehler";
import { pruefe } from "../pruefung";
import { BEREICHE, istBereich, type Bereich } from "../rechte/bereiche";
import { idParam, mindestensEins, MINDESTENS_EIN_FELD, schreibe, textEingabe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

const ids = z.array(z.uuid()).max(500);
const beschreibung = z.string().trim().max(1000).nullable();

/** Höchste Stufe je Bereich der Rolle; ein Bereich ohne Eintrag hat keine Grenze. Einträge zu Bereichen außerhalb der Rolle entfallen. */
const bereichStufen = z.partialRecord(z.enum(BEREICHE), z.enum(fondsRolle.enumValues));
const rolleEingabe = z.object({ name: textEingabe(120), beschreibung: beschreibung.optional(), bereiche: z.array(z.enum(BEREICHE)).max(BEREICHE.length), bereichStufen: bereichStufen.optional() });
const rolleAenderung = rolleEingabe.partial().refine(mindestensEins, MINDESTENS_EIN_FELD);

const gruppeEingabe = z.object({
  name: textEingabe(120),
  beschreibung: beschreibung.optional(),
  stufe: z.enum(fondsRolle.enumValues).default("betrachter"),
  fondsBeschraenkt: z.boolean().default(false),
  bereicheJeFonds: z.boolean().default(false),
  fondsIds: ids.default([]),
  fondsBereiche: z.record(z.uuid(), z.array(z.enum(BEREICHE)).min(1).max(BEREICHE.length)).default({}),
  rollenIds: ids.default([]),
  mitglieder: ids.default([]),
});
const gruppeAenderung = z
  .object({
    name: textEingabe(120).optional(),
    beschreibung: beschreibung.optional(),
    stufe: z.enum(fondsRolle.enumValues).optional(),
    fondsBeschraenkt: z.boolean().optional(),
    bereicheJeFonds: z.boolean().optional(),
    fondsIds: ids.optional(),
    fondsBereiche: z.record(z.uuid(), z.array(z.enum(BEREICHE)).min(1).max(BEREICHE.length)).optional(),
    rollenIds: ids.optional(),
    mitglieder: ids.optional(),
  })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);

const nichtGefunden = (was: "ROLLE" | "GRUPPE") => new Fachfehler(404, `${was}_NICHT_GEFUNDEN`, was === "ROLLE" ? "Rolle nicht gefunden." : "Gruppe nicht gefunden.");
const nameVergeben = () => new Fachfehler(409, "NAME_VERGEBEN", "Dieser Name ist schon vergeben.");

/** Alle Kennungen müssen existieren; sonst 400 mit dem Feld. */
async function verlangeVorhanden(tx: Tx, tabelle: typeof fonds | typeof rechterolle, werte: string[], feld: string) {
  if (werte.length === 0) return;
  const gefunden = await tx.select({ id: tabelle.id }).from(tabelle).where(inArray(tabelle.id, werte));
  if (gefunden.length !== new Set(werte).size) throw new Fachfehler(400, "UNGUELTIGE_ZUORDNUNG", `Unbekannte Kennung in „${feld}“.`);
}

/** Mitglieder: aktive oder gesperrte Personen, nie technische Benutzer (API-Schlüssel) und nie Investor-Benutzer des LP-Portals. */
async function verlangeMitglieder(tx: Tx, werte: string[]) {
  if (werte.length === 0) return;
  const personen = await tx.select({ id: benutzer.id, technisch: benutzer.technisch }).from(benutzer).where(inArray(benutzer.id, werte));
  if (personen.length !== new Set(werte).size) throw new Fachfehler(400, "UNGUELTIGE_ZUORDNUNG", "Unbekannte Kennung in „mitglieder“.");
  if (personen.some((p) => p.technisch)) throw new Fachfehler(409, "TECHNISCHER_BENUTZER", "Technische Benutzer (API-Schlüssel) gehören zu keiner Gruppe; ihre Rechte stehen im Schlüssel.");
  const investoren = await tx.select({ id: investorBenutzer.benutzerId }).from(investorBenutzer).where(inArray(investorBenutzer.benutzerId, werte));
  if (investoren.length) throw new Fachfehler(409, "INVESTOR_BENUTZER", "Investor-Benutzer des LP-Portals gehören zu keiner Gruppe.");
}

type FondsBereiche = Partial<Record<string, Bereich[]>>;

/**
 * Bereiche je Fonds: nur bei `bereicheJeFonds` und nur für Fonds der Gruppe (sonst 400). Ohne den Schalter entfällt die Auswahl, damit
 * bestehende Gruppen sich wie bisher verhalten.
 */
function pruefeFondsBereiche(jeFonds: boolean, fondsIds: string[], fondsBereiche: FondsBereiche): FondsBereiche {
  const eintraege = Object.keys(fondsBereiche);
  if (eintraege.length === 0) return {};
  if (!jeFonds) throw new Fachfehler(400, "UNGUELTIGE_ZUORDNUNG", "Bereiche je Fonds verlangen den Schalter „Bereiche je Fonds“ der Gruppe.");
  const fonds = new Set(fondsIds);
  if (eintraege.some((f) => !fonds.has(f))) throw new Fachfehler(400, "UNGUELTIGE_ZUORDNUNG", "Bereiche je Fonds nur für Fonds der Gruppe („fondsIds“).");
  return Object.fromEntries(Object.entries(fondsBereiche).map(([f, b]) => [f, [...new Set(b)].sort()]));
}

async function ersetze(tx: Tx, gruppeId: string, werte: { fondsIds?: string[]; fondsBereiche?: FondsBereiche; rollenIds?: string[]; mitglieder?: string[] }) {
  if (werte.fondsIds) {
    await tx.delete(nutzergruppeFonds).where(eq(nutzergruppeFonds.gruppeId, gruppeId));
    const eindeutig = [...new Set(werte.fondsIds)];
    if (eindeutig.length) await tx.insert(nutzergruppeFonds).values(eindeutig.map((fondsId) => ({ gruppeId, fondsId, bereiche: werte.fondsBereiche?.[fondsId] ?? null })));
  }
  if (werte.rollenIds) {
    await tx.delete(nutzergruppeRolle).where(eq(nutzergruppeRolle.gruppeId, gruppeId));
    const eindeutig = [...new Set(werte.rollenIds)];
    if (eindeutig.length) await tx.insert(nutzergruppeRolle).values(eindeutig.map((rolleId) => ({ gruppeId, rolleId })));
  }
  if (werte.mitglieder) {
    await tx.delete(nutzergruppeMitglied).where(eq(nutzergruppeMitglied.gruppeId, gruppeId));
    const eindeutig = [...new Set(werte.mitglieder)];
    if (eindeutig.length) await tx.insert(nutzergruppeMitglied).values(eindeutig.map((benutzerId) => ({ gruppeId, benutzerId })));
  }
}

async function ladeGruppe(tx: Tx, id: string) {
  const [g] = await tx.select().from(nutzergruppe).where(eq(nutzergruppe.id, id));
  if (!g) return undefined;
  // Nacheinander: eine Transaktion verträgt keine gleichzeitigen Abfragen.
  const f = await tx.select({ id: nutzergruppeFonds.fondsId, bereiche: nutzergruppeFonds.bereiche }).from(nutzergruppeFonds).where(eq(nutzergruppeFonds.gruppeId, id));
  const r = await tx.select({ id: nutzergruppeRolle.rolleId }).from(nutzergruppeRolle).where(eq(nutzergruppeRolle.gruppeId, id));
  const m = await tx.select({ id: nutzergruppeMitglied.benutzerId }).from(nutzergruppeMitglied).where(eq(nutzergruppeMitglied.gruppeId, id));
  const fondsBereiche: FondsBereiche = Object.fromEntries(f.filter((x) => x.bereiche !== null).sort((a, b) => a.id.localeCompare(b.id)).map((x) => [x.id, (x.bereiche ?? []).filter(istBereich).sort()]));
  return { ...g, fondsIds: f.map((x) => x.id).sort(), fondsBereiche, rollenIds: r.map((x) => x.id).sort(), mitglieder: m.map((x) => x.id).sort() };
}

const rolleAuszug = (r: typeof rechterolle.$inferSelect) => ({ id: r.id, name: r.name, beschreibung: r.beschreibung, bereiche: r.bereiche, bereichStufen: r.bereichStufen, erstelltAm: r.erstelltAm });

/** Nur Grenzen zu Bereichen der Rolle; doppelte Bereiche entfallen. */
function normiereRolle(bereiche: Bereich[], grenzen: Partial<Record<Bereich, FondsRolle>> | undefined) {
  const eindeutig = [...new Set(bereiche)];
  const stufen: Record<string, FondsRolle> = {};
  for (const b of eindeutig) {
    const grenze = grenzen?.[b];
    if (grenze) stufen[b] = grenze;
  }
  return { bereiche: eindeutig, bereichStufen: stufen };
}
const gruppeAuszug = (g: NonNullable<Awaited<ReturnType<typeof ladeGruppe>>>) => ({
  id: g.id,
  name: g.name,
  beschreibung: g.beschreibung,
  stufe: g.stufe,
  fondsBeschraenkt: g.fondsBeschraenkt,
  bereicheJeFonds: g.bereicheJeFonds,
  fondsIds: g.fondsIds,
  fondsBereiche: g.fondsBereiche,
  rollenIds: g.rollenIds,
  mitglieder: g.mitglieder,
  erstelltAm: g.erstelltAm,
});

/**
 * Rollen, Nutzergruppen und die zentrale Einstellung „Fonds offen“ (Rechtemodell, docs/rechte-modell.md). Nur globale Verwalter
 * (Berechtigungstabelle). Jede Änderung steht im Änderungsprotokoll.
 */
export function rechteRouten(db: Db) {
  return new Hono()
    .get("/", async (c) => {
      const daten = await lese(db, async (tx) => {
        const [einstellung] = await tx.select().from(rechteEinstellung).where(eq(rechteEinstellung.id, 1));
        const rollen = await tx.select().from(rechterolle).orderBy(asc(rechterolle.name), asc(rechterolle.id));
        const gruppen = await tx.select({ id: nutzergruppe.id }).from(nutzergruppe).orderBy(asc(nutzergruppe.name), asc(nutzergruppe.id));
        const geladen = [];
        for (const g of gruppen) geladen.push(gruppeAuszug((await ladeGruppe(tx, g.id))!));
        return { fondsOffen: einstellung?.fondsOffen ?? true, bereiche: [...BEREICHE], rollen: rollen.map(rolleAuszug), gruppen: geladen };
      });
      return c.json(daten, 200);
    })
    .put("/einstellung", pruefe("json", z.object({ fondsOffen: z.boolean() })), async (c) => {
      const { fondsOffen } = c.req.valid("json");
      await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(rechteEinstellung).where(eq(rechteEinstellung.id, 1)).for("update");
        await tx
          .insert(rechteEinstellung)
          .values({ id: 1, fondsOffen })
          .onConflictDoUpdate({ target: rechteEinstellung.id, set: { fondsOffen, geaendertAm: new Date() } });
        await protokoll("aendern", "rechte_einstellung", "00000000-0000-0000-0000-000000000001", vorher ? { fondsOffen: vorher.fondsOffen } : null, { fondsOffen });
      });
      return c.json({ fondsOffen }, 200);
    })
    .post("/rollen", pruefe("json", rolleEingabe), async (c) => {
      const eingabe = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [zeile] = await tx
          .insert(rechterolle)
          .values({ name: eingabe.name, beschreibung: eingabe.beschreibung ?? null, ...normiereRolle(eingabe.bereiche, eingabe.bereichStufen) })
          .onConflictDoNothing({ target: rechterolle.name })
          .returning();
        if (!zeile) throw nameVergeben();
        await protokoll("anlegen", "rechterolle", zeile.id, null, rolleAuszug(zeile));
        return zeile;
      });
      return c.json(rolleAuszug(neu), 201);
    })
    .patch("/rollen/:id", pruefe("param", idParam), pruefe("json", rolleAenderung), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(rechterolle).where(eq(rechterolle.id, id)).for("update");
        if (!vorher) throw nichtGefunden("ROLLE");
        if (eingabe.name !== undefined) {
          const [anders] = await tx.select({ id: rechterolle.id }).from(rechterolle).where(and(eq(rechterolle.name, eingabe.name), ne(rechterolle.id, id)));
          if (anders) throw nameVergeben();
        }
        const [zeile] = await tx
          .update(rechterolle)
          .set({
            ...(eingabe.name !== undefined ? { name: eingabe.name } : {}),
            ...(eingabe.beschreibung !== undefined ? { beschreibung: eingabe.beschreibung } : {}),
            ...(eingabe.bereiche !== undefined || eingabe.bereichStufen !== undefined
              ? normiereRolle(eingabe.bereiche ?? (vorher.bereiche.filter(istBereich)), eingabe.bereichStufen ?? (vorher.bereichStufen as Partial<Record<Bereich, FondsRolle>>))
              : {}),
          })
          .where(eq(rechterolle.id, id))
          .returning();
        await protokoll("aendern", "rechterolle", id, rolleAuszug(vorher), rolleAuszug(zeile!));
        return zeile!;
      });
      return c.json(rolleAuszug(neu), 200);
    })
    .delete("/rollen/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.delete(rechterolle).where(eq(rechterolle.id, id)).returning();
        if (!vorher) throw nichtGefunden("ROLLE");
        await protokoll("loeschen", "rechterolle", id, rolleAuszug(vorher), null);
      });
      return c.body(null, 204);
    })
    .post("/gruppen", pruefe("json", gruppeEingabe), async (c) => {
      const eingabe = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await verlangeVorhanden(tx, fonds, eingabe.fondsIds, "fondsIds");
        await verlangeVorhanden(tx, rechterolle, eingabe.rollenIds, "rollenIds");
        await verlangeMitglieder(tx, eingabe.mitglieder);
        const fondsBereiche = pruefeFondsBereiche(eingabe.bereicheJeFonds, eingabe.fondsIds, eingabe.fondsBereiche);
        const [zeile] = await tx
          .insert(nutzergruppe)
          .values({ name: eingabe.name, beschreibung: eingabe.beschreibung ?? null, stufe: eingabe.stufe, fondsBeschraenkt: eingabe.fondsBeschraenkt, bereicheJeFonds: eingabe.bereicheJeFonds })
          .onConflictDoNothing({ target: nutzergruppe.name })
          .returning();
        if (!zeile) throw nameVergeben();
        await ersetze(tx, zeile.id, { ...eingabe, fondsBereiche });
        const gruppe = gruppeAuszug((await ladeGruppe(tx, zeile.id))!);
        await protokoll("anlegen", "nutzergruppe", zeile.id, null, gruppe);
        return gruppe;
      });
      return c.json(neu, 201);
    })
    .patch("/gruppen/:id", pruefe("param", idParam), pruefe("json", gruppeAenderung), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await tx.select({ id: nutzergruppe.id }).from(nutzergruppe).where(eq(nutzergruppe.id, id)).for("update");
        const vorher = await ladeGruppe(tx, id);
        if (!vorher) throw nichtGefunden("GRUPPE");
        if (eingabe.name !== undefined) {
          const [anders] = await tx.select({ id: nutzergruppe.id }).from(nutzergruppe).where(and(eq(nutzergruppe.name, eingabe.name), ne(nutzergruppe.id, id)));
          if (anders) throw nameVergeben();
        }
        if (eingabe.fondsIds) await verlangeVorhanden(tx, fonds, eingabe.fondsIds, "fondsIds");
        if (eingabe.rollenIds) await verlangeVorhanden(tx, rechterolle, eingabe.rollenIds, "rollenIds");
        if (eingabe.mitglieder) await verlangeMitglieder(tx, eingabe.mitglieder);
        // Fonds und ihre Bereiche werden zusammen geschrieben; fehlt eines davon, gilt der bisherige Stand.
        const jeFonds = eingabe.bereicheJeFonds ?? vorher.bereicheJeFonds;
        const fondsIds = eingabe.fondsIds ?? vorher.fondsIds;
        const bisherBereiche = jeFonds ? Object.fromEntries(Object.entries(vorher.fondsBereiche).filter(([f]) => fondsIds.includes(f))) : {};
        const fondsBereiche = pruefeFondsBereiche(jeFonds, fondsIds, eingabe.fondsBereiche ?? bisherBereiche);
        const fondsNeu = eingabe.fondsIds !== undefined || eingabe.fondsBereiche !== undefined || eingabe.bereicheJeFonds !== undefined;
        const kopf = {
          ...(eingabe.name !== undefined ? { name: eingabe.name } : {}),
          ...(eingabe.beschreibung !== undefined ? { beschreibung: eingabe.beschreibung } : {}),
          ...(eingabe.stufe !== undefined ? { stufe: eingabe.stufe } : {}),
          ...(eingabe.fondsBeschraenkt !== undefined ? { fondsBeschraenkt: eingabe.fondsBeschraenkt } : {}),
          ...(eingabe.bereicheJeFonds !== undefined ? { bereicheJeFonds: eingabe.bereicheJeFonds } : {}),
        };
        if (Object.keys(kopf).length) await tx.update(nutzergruppe).set(kopf).where(eq(nutzergruppe.id, id));
        await ersetze(tx, id, { ...eingabe, ...(fondsNeu ? { fondsIds, fondsBereiche } : {}) });
        const gruppe = gruppeAuszug((await ladeGruppe(tx, id))!);
        await protokoll("aendern", "nutzergruppe", id, gruppeAuszug(vorher), gruppe);
        return gruppe;
      });
      return c.json(neu, 200);
    })
    .delete("/gruppen/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeGruppe(tx, id);
        if (!vorher) throw nichtGefunden("GRUPPE");
        await tx.delete(nutzergruppe).where(eq(nutzergruppe.id, id));
        await protokoll("loeschen", "nutzergruppe", id, gruppeAuszug(vorher), null);
      });
      return c.body(null, 204);
    });
}
