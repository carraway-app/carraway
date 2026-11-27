import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { benutzer, fonds, investorBenutzer, type FondsRolle, nutzergruppe, nutzergruppeFonds, nutzergruppeMitglied, nutzergruppeRolle, rechteEinstellung, rechterolle, type Db } from "@carraway/db";
import { Fachfehler } from "../fehler";
import { pruefe } from "../pruefung";
import { BEREICHE, istBereich, type Bereich } from "../rechte/bereiche";
import { BEREICHE_API, bereichAnApi, bereichAusApi, bereichEingabe, stufeAnApi, stufeEingabe, stufenJeBereichAnApi } from "../rechte/api-namen";
import { idParam, mindestensEins, MINDESTENS_EIN_FELD, nurGesetzte, schreibe, textEingabe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

const ids = z.array(z.uuid()).max(500);
const beschreibung = z.string().trim().max(1000).nullable();

/** Höchste Stufe je Bereich der Rolle; ein Bereich ohne Eintrag hat keine Grenze. Einträge zu Bereichen außerhalb der Rolle entfallen. */
const bereichStufen = z.partialRecord(z.enum(BEREICHE_API), stufeEingabe);
const rolleEingabe = z.object({ name: textEingabe(120), description: beschreibung.optional(), areas: z.array(bereichEingabe).max(BEREICHE.length), areaLevels: bereichStufen.optional() });
const rolleAenderung = rolleEingabe.partial().refine(mindestensEins, MINDESTENS_EIN_FELD);

const gruppeEingabe = z.object({
  name: textEingabe(120),
  description: beschreibung.optional(),
  level: stufeEingabe.default("betrachter"),
  fundsRestricted: z.boolean().default(false),
  areasPerFund: z.boolean().default(false),
  fundIds: ids.default([]),
  fundAreas: z.record(z.uuid(), z.array(bereichEingabe).min(1).max(BEREICHE.length)).default({}),
  roleIds: ids.default([]),
  memberIds: ids.default([]),
});
const gruppeAenderung = z
  .object({
    name: textEingabe(120).optional(),
    description: beschreibung.optional(),
    level: stufeEingabe.optional(),
    fundsRestricted: z.boolean().optional(),
    areasPerFund: z.boolean().optional(),
    fundIds: ids.optional(),
    fundAreas: z.record(z.uuid(), z.array(bereichEingabe).min(1).max(BEREICHE.length)).optional(),
    roleIds: ids.optional(),
    memberIds: ids.optional(),
  })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);

/** Bereiche und Stufen je Bereich aus dem Namen der Schnittstelle in Werte der Datenbank. */
const grenzenAusApi = (g: Partial<Record<string, FondsRolle>> | undefined): Partial<Record<Bereich, FondsRolle>> | undefined =>
  g && (Object.fromEntries(Object.entries(g).flatMap(([b, s]) => (s === undefined ? [] : [[bereichAusApi(b), s]]))) as Partial<Record<Bereich, FondsRolle>>);

const nichtGefunden = (was: "ROLLE" | "GRUPPE") => new Fachfehler(404, was === "ROLLE" ? "role_not_found" : "group_not_found", was === "ROLLE" ? "Role not found." : "Group not found.");
const nameVergeben = () => new Fachfehler(409, "name_taken", "This name is already taken.");

/** Alle Kennungen müssen existieren; sonst 400 mit dem Feld. */
async function verlangeVorhanden(tx: Tx, tabelle: typeof fonds | typeof rechterolle, werte: string[], feld: string) {
  if (werte.length === 0) return;
  const gefunden = await tx.select({ id: tabelle.id }).from(tabelle).where(inArray(tabelle.id, werte));
  if (gefunden.length !== new Set(werte).size) throw new Fachfehler(400, "assignment_invalid", `Unknown ID in "${feld}".`);
}

/** Mitglieder: aktive oder gesperrte Personen, nie technische Benutzer (API-Schlüssel) und nie Investor-Benutzer des LP-Portals. */
async function verlangeMitglieder(tx: Tx, werte: string[]) {
  if (werte.length === 0) return;
  const personen = await tx.select({ id: benutzer.id, technisch: benutzer.technisch }).from(benutzer).where(inArray(benutzer.id, werte));
  if (personen.length !== new Set(werte).size) throw new Fachfehler(400, "assignment_invalid", "Unknown ID in \"memberIds\".");
  if (personen.some((p) => p.technisch)) throw new Fachfehler(409, "technical_user", "Technical users (API keys) do not belong to any group; their permissions are defined in the key.");
  const investoren = await tx.select({ id: investorBenutzer.benutzerId }).from(investorBenutzer).where(inArray(investorBenutzer.benutzerId, werte));
  if (investoren.length) throw new Fachfehler(409, "investor_user", "Investor users of the LP portal do not belong to any group.");
}

type FondsBereiche = Partial<Record<string, Bereich[]>>;

/**
 * Bereiche je Fonds: nur bei `bereicheJeFonds` und nur für Fonds der Gruppe (sonst 400). Ohne den Schalter entfällt die Auswahl, damit
 * bestehende Gruppen sich wie bisher verhalten.
 */
function pruefeFondsBereiche(jeFonds: boolean, fondsIds: string[], fondsBereiche: FondsBereiche): FondsBereiche {
  const eintraege = Object.keys(fondsBereiche);
  if (eintraege.length === 0) return {};
  if (!jeFonds) throw new Fachfehler(400, "assignment_invalid", "Areas per fund require the group setting \"areasPerFund\".");
  const fonds = new Set(fondsIds);
  if (eintraege.some((f) => !fonds.has(f))) throw new Fachfehler(400, "assignment_invalid", "Areas per fund only for funds of the group (\"fundIds\").");
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

/** Stand einer Rolle im Änderungsprotokoll (Namen der Datenbank, unverändert). */
const rolleProtokoll = (r: typeof rechterolle.$inferSelect) => ({ id: r.id, name: r.name, beschreibung: r.beschreibung, bereiche: r.bereiche, bereichStufen: r.bereichStufen, erstelltAm: r.erstelltAm });
/** Rolle in der Antwort der Schnittstelle. */
const rolleAuszug = (r: typeof rechterolle.$inferSelect) => ({
  id: r.id,
  name: r.name,
  description: r.beschreibung,
  areas: r.bereiche.filter(istBereich).map(bereichAnApi),
  areaLevels: stufenJeBereichAnApi(r.bereichStufen),
  createdAt: r.erstelltAm,
});

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
type GruppeZeile = NonNullable<Awaited<ReturnType<typeof ladeGruppe>>>;
/** Stand einer Gruppe im Änderungsprotokoll (Namen der Datenbank, unverändert). */
const gruppeProtokoll = (g: GruppeZeile) => ({
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
/** Gruppe in der Antwort der Schnittstelle. */
const gruppeAuszug = (g: GruppeZeile) => ({
  id: g.id,
  name: g.name,
  description: g.beschreibung,
  level: stufeAnApi(g.stufe),
  fundsRestricted: g.fondsBeschraenkt,
  areasPerFund: g.bereicheJeFonds,
  fundIds: g.fondsIds,
  fundAreas: Object.fromEntries(Object.entries(g.fondsBereiche).map(([fondsId, b]) => [fondsId, (b ?? []).map(bereichAnApi)])),
  roleIds: g.rollenIds,
  memberIds: g.mitglieder,
  createdAt: g.erstelltAm,
});

/**
 * Rollen, Nutzergruppen und die zentrale Einstellung „Fonds offen“ (Rechtemodell, docs/permissions-model.md). Nur globale Verwalter
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
        return { fundsOpen: einstellung?.fondsOffen ?? true, areas: BEREICHE.map(bereichAnApi), roles: rollen.map(rolleAuszug), groups: geladen };
      });
      return c.json(daten, 200);
    })
    .put("/settings", pruefe("json", z.object({ fundsOpen: z.boolean() })), async (c) => {
      const { fundsOpen: fondsOffen } = c.req.valid("json");
      await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(rechteEinstellung).where(eq(rechteEinstellung.id, 1)).for("update");
        await tx
          .insert(rechteEinstellung)
          .values({ id: 1, fondsOffen })
          .onConflictDoUpdate({ target: rechteEinstellung.id, set: { fondsOffen, geaendertAm: new Date() } });
        await protokoll("aendern", "rechte_einstellung", "00000000-0000-0000-0000-000000000001", vorher ? { fondsOffen: vorher.fondsOffen } : null, { fondsOffen });
      });
      return c.json({ fundsOpen: fondsOffen }, 200);
    })
    .post("/roles", pruefe("json", rolleEingabe), async (c) => {
      const eingabe = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [zeile] = await tx
          .insert(rechterolle)
          .values({ name: eingabe.name, beschreibung: eingabe.description ?? null, ...normiereRolle(eingabe.areas, grenzenAusApi(eingabe.areaLevels)) })
          .onConflictDoNothing({ target: rechterolle.name })
          .returning();
        if (!zeile) throw nameVergeben();
        await protokoll("anlegen", "rechterolle", zeile.id, null, rolleProtokoll(zeile));
        return zeile;
      });
      return c.json(rolleAuszug(neu), 201);
    })
    .patch("/roles/:id", pruefe("param", idParam), pruefe("json", rolleAenderung), async (c) => {
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
            ...(eingabe.description !== undefined ? { beschreibung: eingabe.description } : {}),
            ...(eingabe.areas !== undefined || eingabe.areaLevels !== undefined
              ? normiereRolle(eingabe.areas ?? (vorher.bereiche.filter(istBereich)), grenzenAusApi(eingabe.areaLevels) ?? (vorher.bereichStufen as Partial<Record<Bereich, FondsRolle>>))
              : {}),
          })
          .where(eq(rechterolle.id, id))
          .returning();
        await protokoll("aendern", "rechterolle", id, rolleProtokoll(vorher), rolleProtokoll(zeile!));
        return zeile!;
      });
      return c.json(rolleAuszug(neu), 200);
    })
    .delete("/roles/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.delete(rechterolle).where(eq(rechterolle.id, id)).returning();
        if (!vorher) throw nichtGefunden("ROLLE");
        await protokoll("loeschen", "rechterolle", id, rolleProtokoll(vorher), null);
      });
      return c.body(null, 204);
    })
    .post("/groups", pruefe("json", gruppeEingabe), async (c) => {
      const eingabe = c.req.valid("json");
      const werte = { fondsIds: eingabe.fundIds, rollenIds: eingabe.roleIds, mitglieder: eingabe.memberIds };
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await verlangeVorhanden(tx, fonds, werte.fondsIds, "fundIds");
        await verlangeVorhanden(tx, rechterolle, werte.rollenIds, "roleIds");
        await verlangeMitglieder(tx, werte.mitglieder);
        const fondsBereiche = pruefeFondsBereiche(eingabe.areasPerFund, werte.fondsIds, eingabe.fundAreas);
        const [zeile] = await tx
          .insert(nutzergruppe)
          .values({ name: eingabe.name, beschreibung: eingabe.description ?? null, stufe: eingabe.level, fondsBeschraenkt: eingabe.fundsRestricted, bereicheJeFonds: eingabe.areasPerFund })
          .onConflictDoNothing({ target: nutzergruppe.name })
          .returning();
        if (!zeile) throw nameVergeben();
        await ersetze(tx, zeile.id, { ...werte, fondsBereiche });
        const geladen = (await ladeGruppe(tx, zeile.id))!;
        await protokoll("anlegen", "nutzergruppe", zeile.id, null, gruppeProtokoll(geladen));
        return gruppeAuszug(geladen);
      });
      return c.json(neu, 201);
    })
    .patch("/groups/:id", pruefe("param", idParam), pruefe("json", gruppeAenderung), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      const werte = nurGesetzte({ fondsIds: eingabe.fundIds, fondsBereiche: eingabe.fundAreas, rollenIds: eingabe.roleIds, mitglieder: eingabe.memberIds });
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await tx.select({ id: nutzergruppe.id }).from(nutzergruppe).where(eq(nutzergruppe.id, id)).for("update");
        const vorher = await ladeGruppe(tx, id);
        if (!vorher) throw nichtGefunden("GRUPPE");
        if (eingabe.name !== undefined) {
          const [anders] = await tx.select({ id: nutzergruppe.id }).from(nutzergruppe).where(and(eq(nutzergruppe.name, eingabe.name), ne(nutzergruppe.id, id)));
          if (anders) throw nameVergeben();
        }
        if (werte.fondsIds) await verlangeVorhanden(tx, fonds, werte.fondsIds, "fundIds");
        if (werte.rollenIds) await verlangeVorhanden(tx, rechterolle, werte.rollenIds, "roleIds");
        if (werte.mitglieder) await verlangeMitglieder(tx, werte.mitglieder);
        // Fonds und ihre Bereiche werden zusammen geschrieben; fehlt eines davon, gilt der bisherige Stand.
        const jeFonds = eingabe.areasPerFund ?? vorher.bereicheJeFonds;
        const fondsIds = werte.fondsIds ?? vorher.fondsIds;
        const bisherBereiche = jeFonds ? Object.fromEntries(Object.entries(vorher.fondsBereiche).filter(([f]) => fondsIds.includes(f))) : {};
        const fondsBereiche = pruefeFondsBereiche(jeFonds, fondsIds, werte.fondsBereiche ?? bisherBereiche);
        const fondsNeu = werte.fondsIds !== undefined || werte.fondsBereiche !== undefined || eingabe.areasPerFund !== undefined;
        const kopf = {
          ...(eingabe.name !== undefined ? { name: eingabe.name } : {}),
          ...(eingabe.description !== undefined ? { beschreibung: eingabe.description } : {}),
          ...(eingabe.level !== undefined ? { stufe: eingabe.level } : {}),
          ...(eingabe.fundsRestricted !== undefined ? { fondsBeschraenkt: eingabe.fundsRestricted } : {}),
          ...(eingabe.areasPerFund !== undefined ? { bereicheJeFonds: eingabe.areasPerFund } : {}),
        };
        if (Object.keys(kopf).length) await tx.update(nutzergruppe).set(kopf).where(eq(nutzergruppe.id, id));
        await ersetze(tx, id, { ...werte, ...(fondsNeu ? { fondsIds, fondsBereiche } : {}) });
        const geladen = (await ladeGruppe(tx, id))!;
        await protokoll("aendern", "nutzergruppe", id, gruppeProtokoll(vorher), gruppeProtokoll(geladen));
        return gruppeAuszug(geladen);
      });
      return c.json(neu, 200);
    })
    .delete("/groups/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeGruppe(tx, id);
        if (!vorher) throw nichtGefunden("GRUPPE");
        await tx.delete(nutzergruppe).where(eq(nutzergruppe.id, id));
        await protokoll("loeschen", "nutzergruppe", id, gruppeProtokoll(vorher), null);
      });
      return c.body(null, 204);
    });
}
