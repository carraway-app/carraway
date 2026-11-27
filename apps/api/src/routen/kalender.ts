import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { aktivitaet, benutzer, deal, investorBenutzer, kalenderToken, organisation, wirksameFondsrolle, wirksamesBereichsrecht, type Db } from "@carraway/db";
import { clientIp } from "../anmeldung/schutz";
import { Fachfehler } from "../fehler";
import type { Konfiguration } from "../konfiguration";
import { lese } from "../zeitlimit";
import { KALENDER_TOKEN_FORM, kalenderTokenHash } from "./einstellungen";
import { hatBereichSql } from "../rechte/aufloesung";
import { merke, zaehle, zuViele } from "./extern";

/**
 * Kalenderabonnement (ICS) der Wiedervorlagen einer Person: `GET /kalender/<Token>.ics`, ohne Konto. Das Token (256 Bit, nur als SHA-256
 * gespeichert, widerrufbar) ist der Zugang und gehört zu genau einer Person. Bei jedem Abruf wird neu geprüft: Token nicht widerrufen, Person
 * aktiv, kein technischer und kein Investor-Benutzer; es erscheinen nur offene Wiedervorlagen, für die die Person zuständig ist und deren
 * Deal sie nach den aktuellen Rollen sehen darf. Begrenzung je IP und je Token wie bei den Kennzahlen-Links; Antworten `no-store`.
 *
 * Der Pfad ist `/calendar/:file` (Token mit Endung `.ics`), damit er genau einem Muster der Berechtigungstabelle entspricht.
 */

const DATEI = /^([A-Za-z0-9_-]{43})\.ics$/;

const escapeIcs = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Faltet Zeilen auf höchstens 75 Oktette (RFC 5545), ohne Mehrbyte-Zeichen zu zerschneiden. */
function falte(zeile: string): string {
  if (Buffer.byteLength(zeile) <= 75) return zeile;
  const teile: string[] = [];
  let aktuell = "";
  for (const z of zeile) {
    const grenze = teile.length === 0 ? 75 : 74;
    if (Buffer.byteLength(aktuell + z) > grenze) {
      teile.push(aktuell);
      aktuell = z;
    } else aktuell += z;
  }
  teile.push(aktuell);
  return teile.join("\r\n ");
}

const tagOhneStriche = (iso: string) => iso.replaceAll("-", "");
const naechsterTag = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replaceAll("-", "");
};

export interface IcsTermin {
  id: string;
  titel: string;
  tag: string;
  beschreibung: string;
}

export function erzeugeIcs(termine: IcsTermin[], jetzt: Date): string {
  const stempel = jetzt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const zeilen = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Carraway//Wiedervorlagen//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Carraway Wiedervorlagen"];
  for (const t of termine) {
    zeilen.push(
      "BEGIN:VEVENT",
      `UID:wiedervorlage-${t.id}@carraway`,
      `DTSTAMP:${stempel}`,
      `DTSTART;VALUE=DATE:${tagOhneStriche(t.tag)}`,
      `DTEND;VALUE=DATE:${naechsterTag(t.tag)}`,
      `SUMMARY:${escapeIcs(`Wiedervorlage: ${t.titel}`)}`,
      ...(t.beschreibung ? [`DESCRIPTION:${escapeIcs(t.beschreibung)}`] : []),
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  zeilen.push("END:VCALENDAR");
  return `${zeilen.map(falte).join("\r\n")}\r\n`;
}

export function kalenderOeffentlichRouten(db: Db, konfig: Pick<Konfiguration, "externLimit" | "proxyVertrauen">) {
  const limit = konfig.externLimit;
  return new Hono().get("/:file", async (c) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Robots-Tag", "noindex, nofollow");
    const ip = clientIp(c, konfig);
    if ((await zaehle(db, `ip:${ip}`, 60)) >= limit.ipProMinute || (await zaehle(db, `fehl:${ip}`, 600)) >= limit.fehlgriffeProZehnMinuten) {
      c.header("Retry-After", "60");
      throw zuViele();
    }
    await merke(db, `ip:${ip}`);
    const nichtGefunden = async () => {
      await merke(db, `fehl:${ip}`);
      return new Fachfehler(404, "not_found", "This link does not exist.");
    };
    const m = DATEI.exec(c.req.param("file"));
    if (!m || !KALENDER_TOKEN_FORM.test(m[1]!)) throw await nichtGefunden();
    const hash = kalenderTokenHash(m[1]!);
    if ((await zaehle(db, `kal:${hash.slice(0, 16)}`, 60)) >= limit.tokenProMinute) {
      c.header("Retry-After", "60");
      throw zuViele();
    }
    await merke(db, `kal:${hash.slice(0, 16)}`);

    const termine = await lese(db, async (tx) => {
      const [t] = await tx
        .select({ id: kalenderToken.id, benutzerId: kalenderToken.benutzerId, aktiv: benutzer.aktiv, technisch: benutzer.technisch, global: benutzer.globalVerwalter })
        .from(kalenderToken)
        .innerJoin(benutzer, eq(benutzer.id, kalenderToken.benutzerId))
        .where(and(eq(kalenderToken.tokenHash, hash), isNull(kalenderToken.widerrufenAm)));
      if (!t || !t.aktiv || t.technisch) return null;
      const [investor] = await tx.select({ id: investorBenutzer.benutzerId }).from(investorBenutzer).where(eq(investorBenutzer.benutzerId, t.benutzerId));
      if (investor) return null;
      const fonds = (await tx.select({ f: wirksameFondsrolle.fondsId }).from(wirksameFondsrolle).where(eq(wirksameFondsrolle.benutzerId, t.benutzerId))).map((r) => r.f);
      // Ohne jede Rolle (und nicht global) sieht die Person kein CRM und damit auch keine Wiedervorlagen.
      if (!t.global && fonds.length === 0) return { tokenId: t.id, zeilen: [] };
      // Wiedervorlagen gehören zum Bereich Kontakte, Deals zu Dealflow (docs/permissions-model.md): ohne Kontakte bleibt der Kalender leer, ohne Dealflow fehlen die Wiedervorlagen an Deals.
      const { rows: bereiche } = await tx.execute<{ kontakte: boolean; dealflow: boolean }>(sql`SELECT ${hatBereichSql(t.benutzerId, "kontakte")} AS kontakte, ${hatBereichSql(t.benutzerId, "dealflow")} AS dealflow`);
      if (!bereiche[0]?.kontakte) return { tokenId: t.id, zeilen: [] };
      // Bereiche je Fonds: Wiedervorlagen an Deals eines Fonds nur, wenn die Person dort den Dealflow sieht.
      const dealFonds = (
        await tx
          .selectDistinct({ f: wirksamesBereichsrecht.fondsId })
          .from(wirksamesBereichsrecht)
          .where(and(eq(wirksamesBereichsrecht.benutzerId, t.benutzerId), or(isNull(wirksamesBereichsrecht.bereich), eq(wirksamesBereichsrecht.bereich, "dealflow"))))
      ).map((r) => r.f);
      const dealBedingung = !bereiche[0].dealflow
        ? isNull(aktivitaet.dealId)
        : t.global
          ? undefined
          : or(isNull(aktivitaet.dealId), isNull(deal.fondsId), dealFonds.length ? inArray(deal.fondsId, dealFonds) : sql`false`);
      const zeilen = await tx
        .select({ id: aktivitaet.id, titel: aktivitaet.titel, tag: aktivitaet.wiedervorlage, organisation: organisation.name, deal: deal.titel })
        .from(aktivitaet)
        .leftJoin(deal, eq(deal.id, aktivitaet.dealId))
        .leftJoin(organisation, eq(organisation.id, sql`coalesce(${aktivitaet.organisationId}, ${deal.organisationId})`))
        .where(and(isNotNull(aktivitaet.wiedervorlage), isNull(aktivitaet.wiedervorlageErledigtAm), eq(aktivitaet.zustaendig, t.benutzerId), dealBedingung))
        .orderBy(asc(aktivitaet.wiedervorlage), asc(aktivitaet.id))
        .limit(1000);
      return { tokenId: t.id, zeilen };
    });
    if (!termine) throw await nichtGefunden();
    await db.update(kalenderToken).set({ letzterZugriffAm: new Date() }).where(eq(kalenderToken.id, termine.tokenId));
    const ics = erzeugeIcs(
      termine.zeilen.map((z) => ({ id: z.id, titel: z.titel, tag: z.tag!, beschreibung: [z.organisation, z.deal].filter(Boolean).join(" – ") })),
      new Date(),
    );
    return c.body(ics, 200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="carraway.ics"' });
  });
}
