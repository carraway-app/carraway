import { kontaktJson, pruefeKontakt } from "../kontakte/http";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { kontaktabgleichEinstellung, kontaktVorschlagQuelle, person, type Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { Fachfehler } from "../fehler";
import { ladeBekannte } from "../postfach/abgleich";
import { fuehreKontaktZusammen, holeNach, legeKontaktAn, normalisiereListe, unternehmensDomain, unternehmensname, type Bereich } from "../postfach/kontakte";
import { idParam, schreibe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

/**
 * Kontakte aus Postfach und Kalender: Einstellung der Installation (nur globale Verwalter) und die Liste „Neue Kontakte aus Postfach und Kalender“.
 *
 * Wer welche Vorschläge sieht: nur die Person, aus deren Postfach oder Kalender ein Vorschlag stammt (Quelle), und nur solange die Verbindung besteht. Verbindungen
 * sieht auch heute nur ihre Besitzerin, Verwalter nicht; ein Vorschlag würde sonst verraten, mit wem eine andere Person schreibt, bevor sie es für das CRM freigibt.
 * Übernehmen, Zusammenführen und Verwerfen legen Kontakte an oder ändern sie und verlangen darum Bearbeiter im Bereich Kontakte (Berechtigungstabelle).
 * Verworfen wird je Quelle und dauerhaft: Der Vorschlag kommt für diese Person nicht wieder; stammt er auch aus dem Postfach einer anderen Person, sieht sie ihn weiter.
 */

const einstellungEingabe = z
  .object({
    modus: z.enum(["aus", "vorschlag", "direkt"]),
    eigeneDomains: z.array(z.string().trim().max(254)).max(200),
    sperrliste: z.array(z.string().trim().max(254)).max(1000),
  })
  .strict();
const zusammenfuehrenEingabe = z.object({ personId: z.uuid() }).strict();

type VorschlagZeile = {
  id: string;
  adresse: string;
  name: string | null;
  erstellt_am: string | Date;
  bereiche: Bereich[];
};

/** Offene Vorschläge, deren Quelle die Person mit bestehender Verbindung ist und die sie nicht verworfen hat; Adressen, die inzwischen eine Person haben, fehlen. */
async function sichtbareVorschlaege(tx: Tx, benutzerId: string, id?: string): Promise<VorschlagZeile[]> {
  const { rows } = await tx.execute<VorschlagZeile>(sql`
    SELECT v.id, v.adresse, v.name, v.erstellt_am, array_agg(DISTINCT q.bereich::text ORDER BY q.bereich::text) AS bereiche
    FROM kontakt_vorschlag v
    JOIN kontakt_vorschlag_quelle q ON q.vorschlag_id = v.id AND q.benutzer_id = ${benutzerId} AND NOT q.verworfen
    JOIN postfach_verbindung c ON c.benutzer_id = q.benutzer_id AND c.bereich = q.bereich
    WHERE v.status = 'offen'
      ${id ? sql`AND v.id = ${id}` : sql``}
      AND NOT EXISTS (SELECT 1 FROM person p WHERE lower(trim(p.email)) = v.adresse)
    GROUP BY v.id
    ORDER BY v.erstellt_am DESC, v.id
    LIMIT 500`);
  return rows;
}

export function kontaktvorschlaegeRouten(db: Db) {
  const ladeEinstellung = async () => {
    const [e] = await lese(db, (tx) => tx.select().from(kontaktabgleichEinstellung));
    return { modus: (e?.modus ?? "aus") as "aus" | "vorschlag" | "direkt", eigeneDomains: e?.eigeneDomains ?? [], sperrliste: e?.sperrliste ?? [] };
  };

  const verlangeSichtbar = async (tx: Tx, benutzerId: string, id: string) => {
    const [v] = await sichtbareVorschlaege(tx, benutzerId, id);
    if (!v) throw new Fachfehler(404, "contact_suggestion_not_found", "This suggestion does not exist.");
    return v;
  };

  return new Hono()
    .get("/settings", async (c) => kontaktJson(c, await ladeEinstellung(), 200))
    .put("/settings", pruefeKontakt("json", einstellungEingabe), async (c) => {
      const e = c.req.valid("json");
      const werte = { modus: e.modus, eigeneDomains: normalisiereListe(e.eigeneDomains).filter((d) => !d.includes("@")), sperrliste: normalisiereListe(e.sperrliste) };
      await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(kontaktabgleichEinstellung);
        await tx
          .insert(kontaktabgleichEinstellung)
          .values({ id: 1, ...werte })
          .onConflictDoUpdate({ target: kontaktabgleichEinstellung.id, set: { ...werte, geaendertAm: new Date() } });
        // Domains der Installation sind keine Personendaten; die Sperrliste kann private Adressen enthalten und steht nur als Anzahl im Protokoll.
        const sicht = (x: { modus: string; eigeneDomains: string[]; sperrliste: string[] }) => ({ modus: x.modus, eigeneDomains: x.eigeneDomains, sperrliste: x.sperrliste.length });
        await protokoll(vorher ? "aendern" : "anlegen", "kontaktabgleich_einstellung", "00000000-0000-0000-0000-000000000001", vorher ? sicht(vorher) : null, sicht(werte));
      });
      return kontaktJson(c, await ladeEinstellung(), 200);
    })
    .get("/", async (c) => {
      const { id: benutzerId } = aktuellerAkteur(c);
      const ergebnis = await lese(db, async (tx) => {
        const zeilen = await sichtbareVorschlaege(tx, benutzerId);
        const bekannte = zeilen.length > 0 ? await ladeBekannte(tx) : null;
        const domains = zeilen.map((z) => unternehmensDomain(z.adresse)).filter((d): d is string => d !== null);
        const { rows: schon } = domains.length
          ? await tx.execute<{ domain: string; id: string; name: string }>(sql`SELECT d.domain, o.id, o.name FROM kontakt_domain d JOIN organisation o ON o.id = d.organisation_id WHERE d.domain IN (${sql.join(domains.map((d) => sql`${d}`), sql`, `)})`)
          : { rows: [] };
        const orgIds = [...new Set(domains.map((d) => bekannte?.domains.get(d)).filter((x): x is string => Boolean(x)))];
        const { rows: namen } = orgIds.length
          ? await tx.execute<{ id: string; name: string }>(sql`SELECT id, name FROM organisation WHERE id IN (${sql.join(orgIds.map((i) => sql`${i}::uuid`), sql`, `)})`)
          : { rows: [] };
        const nameVon = new Map(namen.map((n) => [n.id, n.name]));
        return zeilen.map((z) => {
          const domain = unternehmensDomain(z.adresse);
          const vorhanden = domain ? (schon.find((s) => s.domain === domain) ?? (bekannte?.domains.get(domain) ? { id: bekannte.domains.get(domain)!, name: nameVon.get(bekannte.domains.get(domain)!) ?? domain } : null)) : null;
          return {
            id: z.id,
            adresse: z.adresse,
            name: z.name,
            bereiche: z.bereiche,
            erstelltAm: new Date(z.erstellt_am).toISOString(),
            // Unternehmen: vorhandenes (wird verknüpft), neu aus der Domain (Name vorläufig) oder keines (Freemail und Ähnliches).
            unternehmen: vorhanden ? { id: vorhanden.id, name: vorhanden.name, neu: false } : domain ? { id: null, name: unternehmensname(domain), neu: true } : null,
          };
        });
      });
      const { modus } = await ladeEinstellung();
      return kontaktJson(c, { modus, daten: ergebnis }, 200);
    })
    .post("/:id/accept", pruefeKontakt("param", idParam), async (c) => {
      const { id: benutzerId } = aktuellerAkteur(c);
      const { id } = c.req.valid("param");
      const personId = await schreibe(db, c, async (tx, protokoll) => {
        const v = await verlangeSichtbar(tx, benutzerId, id);
        const bekannte = await ladeBekannte(tx);
        const r = await legeKontaktAn(tx, protokoll, { adresse: v.adresse, name: v.name, herkunft: benutzerId, bereich: v.bereiche.includes("mail") ? "mail" : "kalender", entschiedenVon: benutzerId, bekannte });
        await holeNach(tx);
        return r.personId;
      });
      return kontaktJson(c, { personId }, 200);
    })
    .post("/:id/merge", pruefeKontakt("param", idParam), pruefeKontakt("json", zusammenfuehrenEingabe), async (c) => {
      const { id: benutzerId } = aktuellerAkteur(c);
      const { id } = c.req.valid("param");
      const { personId } = c.req.valid("json");
      await schreibe(db, c, async (tx, protokoll) => {
        const v = await verlangeSichtbar(tx, benutzerId, id);
        const [ziel] = await tx.select({ id: person.id }).from(person).where(and(eq(person.id, personId), isNull(person.zusammengefuehrtIn), isNull(person.archiviertAm)));
        if (!ziel) throw new Fachfehler(404, "person_not_found", "Person not found.");
        await fuehreKontaktZusammen(tx, protokoll, { vorschlagId: v.id, adresse: v.adresse, name: v.name, zielId: ziel.id, entschiedenVon: benutzerId });
        await holeNach(tx);
      });
      return kontaktJson(c, { personId }, 200);
    })
    .post("/:id/dismiss", pruefeKontakt("param", idParam), async (c) => {
      const { id: benutzerId } = aktuellerAkteur(c);
      const { id } = c.req.valid("param");
      await schreibe(db, c, async (tx, protokoll) => {
        await verlangeSichtbar(tx, benutzerId, id);
        await tx.update(kontaktVorschlagQuelle).set({ verworfen: true }).where(and(eq(kontaktVorschlagQuelle.vorschlagId, id), eq(kontaktVorschlagQuelle.benutzerId, benutzerId)));
        await protokoll("verwerfen", "kontakt_vorschlag", id, null, { id });
      });
      return c.body(null, 204);
    });
}
