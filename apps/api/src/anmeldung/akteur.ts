import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { apiSchluessel, benutzer, investorBenutzer, investorZugang, konto, werteSchluessel, type Db, type FondsRolle } from "@carraway/db";
import { Fachfehler } from "../fehler";
import { BEREICHE, niedrigereStufe, type Bereich, type RegelBereich } from "../rechte/bereiche";
import { ladeRechte } from "../rechte/aufloesung";
import type { Konfiguration } from "../konfiguration";
import { lese } from "../zeitlimit";
import type { Auth } from "./auth";

/** Rangfolge der Fondsrollen: eine höhere Rolle darf alles, was eine niedrigere darf. */
export const ROLLEN_RANG: Record<FondsRolle, number> = { betrachter: 1, bearbeiter: 2, freigeber: 3, verwalter: 4 };

export type Recht = "lesen" | "schreiben";
export interface SchluesselScope {
  fondsId: string;
  recht: Recht;
}

/** Wer die Anfrage stellt: eine angemeldete Person oder der technische Benutzer eines API-Schlüssels. */
export interface Akteur {
  id: string;
  name: string;
  email: string;
  technisch: boolean;
  globalVerwalter: boolean;
  zweiFaktorAktiv: boolean;
  /** Pflicht nicht erfüllt: Person mit Passwort ohne zweiten Faktor, solange `ZWEI_FAKTOR_PFLICHT` gilt. */
  zweiFaktorFehlt: boolean;
  /** Startpasswort noch nicht geändert: alle Routen außer `/auth/*` und `/me` antworten 403 `password_change_required`. */
  passwortAendern: boolean;
  /** Wirksame Stufe je Fonds: eigene Fondsrolle, sonst die höchste Stufe der Gruppen mit Zugriff auf den Fonds (`rechte/aufloesung.ts`). */
  rollen: Map<string, FondsRolle>;
  /** Bereiche aus den Rollen der Gruppen; `null` = alle Bereiche (keine Gruppe, API-Schlüssel). Die Rechtsprüfung verlangt den Bereich der Route. */
  bereiche: ReadonlySet<Bereich> | null;
  /**
   * Höchste Stufe der Gruppen unabhängig vom Fonds. Zählt nur an Regeln mit `ohneFondsErlaubt` (Kontakte, Dealflow: Daten ohne Fonds), nie
   * allgemein (`hatRolleOhneFonds`). `null` ohne Gruppe.
   */
  stufeOhneFonds: FondsRolle | null;
  /**
   * Stufe je Fonds und Bereich (Sicht `wirksames_bereichsrecht`); `null` = keine Unterscheidung nach Bereich (keine Gruppe, API-Schlüssel, globale
   * Verwalter): dann gilt `rollen` für jeden Bereich aus `bereiche`. Bleibt in `fuerBereich` unverändert, damit eingebettete Daten eines anderen
   * Bereichs (`rechte/sichtbarkeit.ts`) ihre eigene Stufe finden.
   */
  stufen: ReadonlyMap<string, ReadonlyMap<Bereich, FondsRolle>> | null;
  /** Stufe je Bereich für Daten ohne Fonds; `null` wie bei `stufen`. */
  stufeOhneFondsJeBereich: ReadonlyMap<Bereich, FondsRolle> | null;
  /**
   * Investor-Benutzer des LP-Portals (Etappe 12): hat nie Fondsrollen und kommt nur an die Routen unter `/portal`.
   * Alle internen Routen lehnt `rechtePruefung` für ihn mit 403 `portal_only` ab.
   */
  investor: boolean;
  /** Investor-Organisationen, deren Konten, Berichte und Mitteilungen der Investor-Benutzer sieht; sonst leer (auch bei API-Schlüsseln). */
  investorOrganisationen: string[];
  /** `werteschluessel`: persönlicher Schlüssel `cww_…` (alt `fdw_…`), gilt nur für `/values/*` (die Rechtsprüfung lehnt jede andere Route ab). */
  quelle: "sitzung" | "schluessel" | "werteschluessel";
  schluesselId?: string;
}

declare module "hono" {
  interface ContextVariableMap {
    akteur?: Akteur;
  }
}

export function aktuellerAkteur(c: Context): Akteur {
  const akteur = c.get("akteur");
  if (!akteur) throw new Fachfehler(401, "not_authenticated", "Please sign in.");
  return akteur;
}

/**
 * Akteur mit den Stufen eines Bereichs (Bereiche je Fonds, docs/rechte-modell.md): `rollen` und `stufeOhneFonds` gelten danach nur für diesen
 * Bereich. `rechtePruefung` legt so den Akteur jeder Anfrage auf den Bereich ihrer Route fest; damit filtern `sichtbareFonds`, `hatRolle` und
 * alle Listen in den Handlern nach Fonds und Bereich. `alle` verlangt jeden Bereich (kleinste Stufe je Fonds), `allgemein` ändert nichts.
 */
export function fuerBereich(akteur: Akteur, bereich: RegelBereich): Akteur {
  if (bereich === "allgemein" || akteur.globalVerwalter || akteur.stufen === null) return akteur;
  const stufen = akteur.stufen;
  const ohne = akteur.stufeOhneFondsJeBereich;
  const benoetigt: readonly Bereich[] = bereich === "alle" ? BEREICHE : [bereich];
  const kleinste = (werte: (FondsRolle | undefined)[]): FondsRolle | null =>
    werte.some((w) => w === undefined) ? null : (werte as FondsRolle[]).reduce((a, b) => niedrigereStufe(a, b));
  const rollen = new Map<string, FondsRolle>();
  for (const [fondsId, jeBereich] of stufen) {
    const stufe = kleinste(benoetigt.map((b) => jeBereich.get(b)));
    if (stufe) rollen.set(fondsId, stufe);
  }
  return { ...akteur, rollen, stufeOhneFonds: ohne ? kleinste(benoetigt.map((b) => ohne.get(b))) : null };
}

/** Wirksame Rolle am Fonds: globale Verwalter sind überall Verwalter. */
export function rolleAm(akteur: Akteur, fondsId: string): FondsRolle | null {
  return akteur.globalVerwalter ? "verwalter" : (akteur.rollen.get(fondsId) ?? null);
}

/** Mindestens `mindest` am Fonds; mit `bereich` an diesem Bereich (sonst am Bereich der Route, siehe `fuerBereich`). */
export const hatRolle = (akteur: Akteur, fondsId: string, mindest: FondsRolle, bereich?: Bereich): boolean => {
  const rolle = rolleAm(bereich ? fuerBereich(akteur, bereich) : akteur, fondsId);
  return rolle !== null && ROLLEN_RANG[rolle] >= ROLLEN_RANG[mindest];
};

/** Mindestens die Rolle an irgendeinem Fonds (für Dinge ohne Fonds wie Kontakte). */
export const hatIrgendwoRolle = (akteur: Akteur, mindest: FondsRolle): boolean =>
  akteur.globalVerwalter || [...akteur.rollen.values()].some((r) => ROLLEN_RANG[r] >= ROLLEN_RANG[mindest]);

/**
 * Wie `hatIrgendwoRolle`, zusätzlich mit der Stufe der Gruppen ohne Fonds. Nur für Regeln mit `ohneFondsErlaubt` (die Rechtsprüfung ruft es
 * ausdrücklich), damit eine Gruppe ohne Fonds nie an fondsbezogene Routen kommt.
 */
export const hatRolleOhneFonds = (akteur: Akteur, mindest: FondsRolle): boolean =>
  hatIrgendwoRolle(akteur, mindest) || (akteur.stufeOhneFonds !== null && ROLLEN_RANG[akteur.stufeOhneFonds] >= ROLLEN_RANG[mindest]);

/**
 * Fonds, an denen die Person mindestens `mindest` ist; `alle` für globale Verwalter. Ohne `bereich` gilt der Bereich der Route (der Akteur
 * der Anfrage ist darauf festgelegt); Daten eines anderen Bereichs nennen ihn.
 */
export function sichtbareFonds(akteur: Akteur, mindest: FondsRolle = "betrachter", bereich?: Bereich): string[] | "alle" {
  if (akteur.globalVerwalter) return "alle";
  if (bereich) return sichtbareFonds(fuerBereich(akteur, bereich), mindest);
  return [...akteur.rollen].filter(([, r]) => ROLLEN_RANG[r] >= ROLLEN_RANG[mindest]).map(([f]) => f);
}

// API-Schlüssel ---------------------------------------------------------------------------------------------------

export const SCHLUESSEL_PRAEFIX = "cwk_";
/**
 * Vor der Umbenennung des Produkts begannen API-Schlüssel mit `fdk_`. Gespeichert ist nur der Hash des Klartexts; bereits ausgegebene
 * Schlüssel müssen daher weiter angenommen werden. Neue Schlüssel tragen immer `cwk_`.
 */
export const ALTES_SCHLUESSEL_PRAEFIX = "fdk_";

export const hashSchluessel = (klartext: string) => createHash("sha256").update(klartext).digest("hex");

/** Neuer Schlüssel mit 256 Bit Zufall; Klartext wird nur einmal angezeigt. */
export function erzeugeSchluessel(): { klartext: string; hash: string; vorschau: string } {
  const klartext = `${SCHLUESSEL_PRAEFIX}${randomBytes(32).toString("base64url")}`;
  return { klartext, hash: hashSchluessel(klartext), vorschau: klartext.slice(0, SCHLUESSEL_PRAEFIX.length + 6) };
}

export const WERTE_PRAEFIX = "cww_";
/** Altes Präfix der Werteschlüssel vor der Umbenennung (wie `ALTES_SCHLUESSEL_PRAEFIX`): ausgegebene Schlüssel bleiben gültig, neue tragen `cww_`. */
export const ALTES_WERTE_PRAEFIX = "fdw_";

/** Neuer persönlicher Werteschlüssel mit 256 Bit Zufall; Klartext wird nur einmal angezeigt. */
export function erzeugeWerteSchluessel(): { klartext: string; hash: string; vorschau: string } {
  const klartext = `${WERTE_PRAEFIX}${randomBytes(32).toString("base64url")}`;
  return { klartext, hash: hashSchluessel(klartext), vorschau: klartext.slice(0, WERTE_PRAEFIX.length + 6) };
}

/** Rechte aus den Scopes: `lesen` entspricht Betrachter, `schreiben` Bearbeiter; nie Freigeber oder Verwalter. */
export function rollenAusScopes(scopes: SchluesselScope[]): Map<string, FondsRolle> {
  const rollen = new Map<string, FondsRolle>();
  for (const s of scopes) {
    const rolle: FondsRolle = s.recht === "schreiben" ? "bearbeiter" : "betrachter";
    const bisher = rollen.get(s.fondsId);
    if (!bisher || ROLLEN_RANG[rolle] > ROLLEN_RANG[bisher]) rollen.set(s.fondsId, rolle);
  }
  return rollen;
}

const ungueltig = () => new Fachfehler(401, "not_authenticated", "Please sign in.");

async function akteurAusSchluessel(db: Db, klartext: string): Promise<Akteur> {
  const hash = hashSchluessel(klartext);
  const zeile = await lese(db, async (tx) => {
    const [z] = await tx
      .select({ schluessel: apiSchluessel, benutzer })
      .from(apiSchluessel)
      .innerJoin(benutzer, eq(benutzer.id, apiSchluessel.benutzerId))
      .where(eq(apiSchluessel.hash, hash));
    return z;
  });
  if (!zeile || zeile.schluessel.widerrufenAm || zeile.schluessel.ablauf <= new Date() || !zeile.benutzer.aktiv) throw ungueltig();
  await db.execute(
    sql`UPDATE api_schluessel SET zuletzt_genutzt = now() WHERE id = ${zeile.schluessel.id} AND (zuletzt_genutzt IS NULL OR zuletzt_genutzt < now() - interval '1 minute')`,
  );
  return {
    id: zeile.benutzer.id,
    name: zeile.benutzer.name,
    email: zeile.benutzer.email,
    technisch: true,
    globalVerwalter: false,
    zweiFaktorAktiv: false,
    zweiFaktorFehlt: false,
    passwortAendern: false,
    rollen: rollenAusScopes(zeile.schluessel.scopes as SchluesselScope[]),
    bereiche: null,
    stufeOhneFonds: null,
    stufen: null,
    stufeOhneFondsJeBereich: null,
    investor: false,
    investorOrganisationen: [],
    quelle: "schluessel",
    schluesselId: zeile.schluessel.id,
  };
}

/**
 * Persönlicher Werteschlüssel: handelt als seine Person mit deren heutigen Rechten (Rollen werden bei jedem Aufruf gelesen), nie als
 * Verwalter über die Werte hinaus und nur auf `/values/*`. Eine Beschränkung auf Fonds schneidet die Rollen zu. Investor-Benutzer,
 * deaktivierte und technische Personen haben keinen Zugriff.
 */
async function akteurAusWerteSchluessel(db: Db, klartext: string, konfig: Konfiguration, werteSchreiben: boolean): Promise<Akteur> {
  const hash = hashSchluessel(klartext);
  const treffer = await lese(db, async (tx) => {
    const [z] = await tx
      .select({ schluessel: werteSchluessel, benutzer })
      .from(werteSchluessel)
      .innerJoin(benutzer, eq(benutzer.id, werteSchluessel.benutzerId))
      .where(eq(werteSchluessel.hash, hash));
    if (!z) return undefined;
    const rechte = await ladeRechte(tx, z.benutzer.id);
    const [markiert] = await tx.select({ id: investorBenutzer.benutzerId }).from(investorBenutzer).where(eq(investorBenutzer.benutzerId, z.benutzer.id));
    const passwort = werteSchreiben && z.schluessel.darfSchreiben && konfig.zweiFaktorPflicht && !z.benutzer.twoFactorEnabled
      ? await tx.select({ id: konto.id }).from(konto).where(and(eq(konto.userId, z.benutzer.id), eq(konto.providerId, "credential"))).limit(1)
      : [];
    return { ...z, rechte, investor: markiert !== undefined, hatPasswort: passwort.length > 0 };
  });
  if (!treffer || treffer.schluessel.widerrufenAm || treffer.schluessel.ablauf <= new Date() || !treffer.benutzer.aktiv || treffer.benutzer.technisch || treffer.investor) throw ungueltig();
  await db.execute(
    sql`UPDATE werte_schluessel SET zuletzt_genutzt = now() WHERE id = ${treffer.schluessel.id} AND (zuletzt_genutzt IS NULL OR zuletzt_genutzt < now() - interval '1 minute')`,
  );
  const beschraenkt = treffer.schluessel.fondsIds;
  const eigene = treffer.rechte.rollen;
  const schreiben = werteSchreiben && treffer.schluessel.darfSchreiben && beschraenkt.length > 0;
  if (werteSchreiben && !schreiben) throw new Fachfehler(403, "forbidden", "This value key is read-only.");
  const global = treffer.benutzer.globalVerwalter && beschraenkt.length === 0;
  const rollen = new Map<string, FondsRolle>();
  for (const fondsId of beschraenkt.length ? beschraenkt : eigene.keys()) {
    const rolle = treffer.benutzer.globalVerwalter ? "verwalter" : eigene.get(fondsId);
    if (rolle) rollen.set(fondsId, schreiben ? rolle : "betrachter");
  }
  const stufenDerPerson = treffer.benutzer.globalVerwalter ? null : treffer.rechte.stufen;
  const stufen = stufenDerPerson
    ? new Map([...rollen.keys()].map((fondsId) => [fondsId, new Map([...(stufenDerPerson.get(fondsId) ?? [])].map(([b, rolle]) => [b, schreiben ? rolle : "betrachter" as const]))]))
    : null;
  return {
    id: treffer.benutzer.id,
    name: treffer.benutzer.name,
    email: treffer.benutzer.email,
    technisch: false,
    globalVerwalter: global,
    zweiFaktorAktiv: treffer.benutzer.twoFactorEnabled === true,
    zweiFaktorFehlt: schreiben && istZweiFaktorOffen(konfig, { zweiFaktorAktiv: treffer.benutzer.twoFactorEnabled === true, hatPasswort: treffer.hatPasswort }),
    passwortAendern: schreiben && treffer.benutzer.passwortAendern,
    rollen,
    bereiche: treffer.benutzer.globalVerwalter ? null : treffer.rechte.bereiche,
    stufeOhneFonds: null,
    stufen,
    stufeOhneFondsJeBereich: stufen ? new Map() : null,
    investor: false,
    investorOrganisationen: [],
    quelle: "werteschluessel",
    schluesselId: treffer.schluessel.id,
  };
}

async function akteurAusSitzung(db: Db, auth: Auth, konfig: Konfiguration, c: Context): Promise<Akteur> {
  const sitzungsdaten = await auth.api.getSession({ headers: c.req.raw.headers });
  const u = sitzungsdaten?.user as (NonNullable<typeof sitzungsdaten>["user"] & { aktiv?: boolean; technisch?: boolean; globalVerwalter?: boolean }) | undefined;
  if (!u || u.aktiv === false || u.technisch) throw ungueltig();
  const { rechte, hatPasswort, passwortAendern, investor, investorOrganisationen } = await lese(db, async (tx) => {
    const [kopf] = await tx.select({ passwortAendern: benutzer.passwortAendern }).from(benutzer).where(eq(benutzer.id, u.id));
    const rechte = await ladeRechte(tx, u.id);
    let hatPasswort = true;
    if (konfig.zweiFaktorPflicht && !u.twoFactorEnabled) {
      hatPasswort = (await tx.select({ id: konto.id }).from(konto).where(and(eq(konto.userId, u.id), eq(konto.providerId, "credential")))).length > 0;
    }
    const [markiert] = await tx.select({ id: investorBenutzer.benutzerId }).from(investorBenutzer).where(eq(investorBenutzer.benutzerId, u.id));
    const zugaenge = markiert ? await tx.select({ organisationId: investorZugang.organisationId }).from(investorZugang).where(eq(investorZugang.benutzerId, u.id)) : [];
    return {
      rechte,
      hatPasswort,
      passwortAendern: kopf?.passwortAendern === true,
      investor: markiert !== undefined,
      investorOrganisationen: zugaenge.map((z) => z.organisationId),
    };
  });
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    technisch: false,
    globalVerwalter: u.globalVerwalter === true,
    zweiFaktorAktiv: u.twoFactorEnabled === true,
    zweiFaktorFehlt: istZweiFaktorOffen(konfig, { zweiFaktorAktiv: u.twoFactorEnabled === true, hatPasswort }),
    passwortAendern,
    rollen: rechte.rollen,
    bereiche: rechte.bereiche,
    stufeOhneFonds: rechte.stufeOhneFonds,
    stufen: rechte.stufen,
    stufeOhneFondsJeBereich: rechte.stufeOhneFondsJeBereich,
    investor,
    investorOrganisationen,
    quelle: "sitzung",
  };
}

/**
 * Fehlt der zweite Faktor? Nur wer sich mit Passwort anmeldet, braucht ihn bei uns. Wer ausschließlich über OIDC
 * (Entra ID, Google) kommt, hat keinen Passwort-Zugang; dort gilt die Mehrfaktor-Richtlinie des Anbieters der Firma.
 */
export function istZweiFaktorOffen(konfig: Pick<Konfiguration, "zweiFaktorPflicht">, p: { zweiFaktorAktiv: boolean; hatPasswort: boolean }): boolean {
  return konfig.zweiFaktorPflicht && !p.zweiFaktorAktiv && p.hatPasswort;
}

/** Ermittelt den Akteur der Anfrage: `Authorization: Bearer cwk_…` oder `cww_…` (Werteschlüssel; die alten Präfixe `fdk_` und `fdw_` gelten weiter) oder die Sitzung per Cookie; sonst 401. */
export async function ermittleAkteur(db: Db, auth: Auth, konfig: Konfiguration, c: Context, werteSchreiben = false): Promise<Akteur> {
  const kopf = c.req.header("Authorization");
  if (kopf !== undefined) {
    // Beide Präfixe je Schlüsselart: neu `cwk_`/`cww_`, alt `fdk_`/`fdw_` (siehe `ALTES_SCHLUESSEL_PRAEFIX`).
    const treffer = /^Bearer ((cwk|fdk|cww|fdw)_[A-Za-z0-9_-]{20,})$/.exec(kopf.trim());
    if (!treffer) throw ungueltig();
    return treffer[2] === "cww" || treffer[2] === "fdw" ? akteurAusWerteSchluessel(db, treffer[1]!, konfig, werteSchreiben) : akteurAusSchluessel(db, treffer[1]!);
  }
  return akteurAusSitzung(db, auth, konfig, c);
}
