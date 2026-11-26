import { Hono } from "hono";
import { z } from "zod";
import { fonds, fondsZeichnung, snapshotAuftrag, type Db } from "@carraway/db";
import { and, asc, eq, sum } from "drizzle-orm";
import { Fachfehler, fehlerAntwort } from "../fehler";
import { abgerufen, sperreFonds } from "../instrumente/fondsbewegung";
import { pruefeStichtag } from "../instrumente/stichtag";
import { berechneAbgrenzung, ladeZinskontexte } from "../instrumente/zinsen";
import { ladeZinsansicht } from "../instrumente/zinsansicht";
import { berechneFondsUebersicht, standardStichtag } from "../kennzahlen/fonds";
import { ladeNavEinzelwerte } from "../kennzahlen/nav-herkunft";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { holeSnapshot, wirdGespeichert } from "../kennzahlen/snapshot";
import { geaendertSeitBedingung, geaendertSeitEingabe } from "../geaendert";
import { liesAbfrage, pruefe } from "../pruefung";
import { fondsSichtbar } from "../rechte/sichtbarkeit";
import { Decimal } from "@carraway/rechenkern";
import { heute, ladeFonds, mindestensEins, MINDESTENS_EIN_FELD, schreibe, textEingabe } from "../schreiben";
import { hatPostgresCode } from "../szenarien/konstanten";
import { lese } from "../zeitlimit";
import { berichteFuerFonds } from "./berichte";
import { periodensperreRouten } from "./periodensperre";
import { rollenRouten } from "./benutzer";
import { fondsBewertungRouten } from "./bewertungen";
import { fondsKennzahlRouten } from "./kennzahlen";
import { fondsBuchungRouten } from "./buchungen";
import { fondsJournalRouten } from "./journal";
import { berichtsvorlagenRouten } from "./berichtsvorlagen";

/** Abfrage der Fondsliste; nicht im Routentyp deklariert (bestehende Aufrufer rufen ohne sie auf), aber in der OpenAPI-Beschreibung. */
export const fondsListenAbfrage = z.object({ geaendertSeit: geaendertSeitEingabe });
const idSchema = z.object({ id: z.uuid() });
const stichtagSchema = z.object({ stichtag: z.iso.date().optional() });
/** Wissensstand als Zeitstempel mit Zeitzone, z. B. `2026-11-20T10:00:00Z`. */
const uebersichtAbfrage = z.object({ stichtag: z.iso.date().optional(), stand: z.iso.datetime({ offset: true }).optional() });

const stammFelder = {
  id: fonds.id,
  name: fonds.name,
  kurzname: fonds.kurzname,
  vintage: fonds.vintage,
  zeichnungskapital: fonds.zeichnungskapital,
  waehrung: fonds.waehrung,
};
const fondsAnlage = z.strictObject({
  name: textEingabe(200),
  kurzname: textEingabe(80),
  vintage: z.int().min(1).max(9999),
  zeichnungskapital: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "Nichtnegativer Betrag mit höchstens zwei Nachkommastellen erwartet"),
  waehrung: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Dreibuchstabiger Währungscode erwartet"),
});
// Bestehende Buchungen und Bewertungen sind in der ursprünglichen Fondswährung erfasst.
const fondsAenderung = fondsAnlage.omit({ waehrung: true }).partial().refine(mindestensEins, MINDESTENS_EIN_FELD);

const stammAuszug = ({ id, name, kurzname, vintage, zeichnungskapital, waehrung }: typeof fonds.$inferSelect) =>
  ({ id, name, kurzname, vintage, zeichnungskapital, waehrung });

const kurznameVergeben = () => new Fachfehler(409, "FONDS_KURZNAME_VERGEBEN", "Dieser Fondskurzname ist bereits vergeben.");

export function fondsRouten(db: Db) {
  return new Hono()
    .get("/", async (c) => {
      // Abfrageparameter nicht im Routentyp deklariert: bestehende Aufrufer rufen ohne sie auf.
      const { geaendertSeit } = liesAbfrage(c, fondsListenAbfrage);
      const zeilen = await lese(db, (tx) =>
        tx
          .select(stammFelder)
          .from(fonds)
          .where(and(fondsSichtbar(c, fonds.id), geaendertSeitBedingung("fonds", fonds.id, fonds.erstelltAm, geaendertSeit)))
          .orderBy(asc(fonds.vintage), asc(fonds.name)),
      );
      return c.json({ daten: zeilen }, 200);
    })
    .post("/", pruefe("json", fondsAnlage), async (c) => {
      const eingabe = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [zeile] = await tx.insert(fonds).values(eingabe).onConflictDoNothing({ target: fonds.kurzname }).returning(stammFelder);
        if (!zeile) throw kurznameVergeben();
        await protokoll("anlegen", "fonds", zeile.id, null, zeile);
        return zeile;
      });
      return c.json(neu, 201);
    })
    .get("/:id", pruefe("param", idSchema), async (c) => {
      const { id } = c.req.valid("param");
      return c.json(await lese(db, async (tx) => stammAuszug(await ladeFonds(tx, id))), 200);
    })
    .patch("/:id", pruefe("param", idSchema), pruefe("json", fondsAenderung), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      try {
        const nachher = await schreibe(db, c, async (tx, protokoll) => {
          const vorher = await sperreFonds(tx, id);
          if (eingabe.zeichnungskapital !== undefined && !new Decimal(eingabe.zeichnungskapital).eq(vorher.zeichnungskapital)) {
            if ((await abgerufen(tx, id)).greaterThan(eingabe.zeichnungskapital)) {
              throw new Fachfehler(409, "ZEICHNUNGSKAPITAL_UNTER_ABRUFEN", "Das Zeichnungskapital liegt unter den bereits abgerufenen Beträgen.");
            }
            const [zeichnung] = await tx.select({ summe: sum(fondsZeichnung.zusage) }).from(fondsZeichnung).where(eq(fondsZeichnung.fondsId, id));
            if (zeichnung?.summe != null && !new Decimal(zeichnung.summe).eq(eingabe.zeichnungskapital)) {
              throw new Fachfehler(409, "LP_ZUSAGEN_KAPITAL_ABWEICHEND", "Das Zeichnungskapital muss der Summe der erfassten Zusagen entsprechen.");
            }
          }
          const [zeile] = await tx.update(fonds).set(eingabe).where(eq(fonds.id, id)).returning(stammFelder);
          if (!zeile) throw new Error("Fonds konnte nicht aktualisiert werden.");
          await protokoll("aendern", "fonds", id, stammAuszug(vorher), zeile);
          return zeile;
        });
        return c.json(nachher, 200);
      } catch (fehler) {
        // Der Kurzname ist das einzige änderbare Feld mit Unique-Constraint.
        if (hatPostgresCode(fehler, "23505")) throw kurznameVergeben();
        throw fehler;
      }
    })
    /**
     * Fondsübersicht. Ohne `stand` aus dem Snapshot (beim ersten Aufruf einmal synchron gerechnet und gespeichert),
     * mit `snapshot: { berechnetAm, veraltet }`. Nur Quartalsenden und der Standard-Stichtag werden gespeichert; jeder andere `stichtag` wird live gerechnet (`snapshot: null`). Mit `?stand=` immer live gerechnet, mit dem Wissensstand zu diesem
     * Zeitpunkt (nur Zeilen mit `erfasst_am <= stand`); dann ist `snapshot` null.
     */
    .get("/:id/uebersicht", pruefe("param", idSchema, { query: uebersichtAbfrage }), pruefe("query", uebersichtAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, stand } = c.req.valid("query");
      const vorhanden = await lese(db, async (tx) => (await tx.select({ id: fonds.id }).from(fonds).where(eq(fonds.id, id))).length > 0);
      if (!vorhanden) return fehlerAntwort(c, 404, "FONDS_NICHT_GEFUNDEN", "Fonds nicht gefunden.");

      if (stand !== undefined) {
        const uebersicht = await lese(db, async (tx) => berechneFondsUebersicht(tx, id, stichtag, stand));
        return c.json({ ...uebersicht, quellenstand: stand, snapshot: null }, 200);
      }
      const { uebersicht, snapshot, quellenstand } = await holeSnapshot(db, c, id, stichtag);
      return c.json({ ...uebersicht, snapshot, quellenstand }, 200);
    })
    .get("/:id/nav-einzelwerte", pruefe("param", idSchema), pruefe("query", uebersichtAbfrage.required()), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, stand } = c.req.valid("query");
      return c.json(await lese(db, (tx) => ladeNavEinzelwerte(tx, aktuellerAkteur(c), id, stichtag, stand)), 200);
    })
    /** Fordert eine Neuberechnung an (202). Der Worker rechnet im Hintergrund; ohne `stichtag` alle Snapshots des Fonds. */
    .post("/:id/neuberechnen", pruefe("param", idSchema, { query: stichtagSchema }), pruefe("query", stichtagSchema), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag } = c.req.valid("query");
      await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        if (stichtag && !(await wirdGespeichert(tx, id, stichtag))) {
          throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Neuberechnung nur für Quartalsenden und den Standard-Stichtag.", {
            felder: [{ feld: "stichtag", code: "stichtag_nicht_gespeichert", meldung: "Nur Quartalsenden und der letzte Bewertungsstichtag werden als Snapshot gespeichert" }],
          });
        }
        await tx.insert(snapshotAuftrag).values({ fondsId: id, stichtag: stichtag ?? null }).onConflictDoNothing();
        await protokoll("neuberechnung", "fonds", id, null, { stichtag: stichtag ?? null });
      });
      return c.json({ angefordert: true as const, fondsId: id, stichtag: stichtag ?? null }, 202);
    })
    /**
     * Abgrenzung zum Stichtag: aufgelaufene, noch nicht gebuchte Zinsen je aktivem Darlehen mit Konditionen, getrennt in
     * fällige ungebuchte Perioden und das laufende Stück seit dem letzten Periodenende, mit Rechenweg (Schritten).
     * Ein Darlehen, das sich nicht rechnen lässt (z. B. fehlender Jahresüberschuss), erscheint mit `fehler` und zählt nicht in die Summe.
     */
    .get("/:id/abgrenzung", pruefe("param", idSchema, { query: stichtagSchema }), pruefe("query", stichtagSchema), async (c) => {
      const { id } = c.req.valid("param");
      const stichtag = c.req.valid("query").stichtag ?? heute();
      const ergebnis = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        await pruefeStichtag(tx, id, stichtag);
        const kontexte = (await ladeZinskontexte(tx, { fondsId: id })).filter((k) => k.beteiligung.status === "aktiv" && k.instrument.status === "aktiv" && k.konditionen.length > 0);
        return kontexte.map((k) => {
          const kopf = { beteiligungId: k.beteiligung.id, instrumentId: k.instrument.id, organisation: k.organisationName, instrument: k.instrument.art };
          try {
            return { ...kopf, ...berechneAbgrenzung(k, stichtag)!, fehler: null as string | null, fehlerCode: null as string | null, fehlerParams: null as Record<string, unknown> | null };
          } catch (fehler) {
            // `fehlerCode` und `fehlerParams` sind stabil und übersetzbar, `fehler` bleibt der deutsche Text.
            const fach = fehler instanceof Fachfehler ? fehler : null;
            return { ...kopf, fehler: (fehler as Error).message, fehlerCode: fach?.code ?? "BERECHNUNG_FEHLGESCHLAGEN", fehlerParams: fach?.zusatz ?? {} };
          }
        });
      });
      const summe = (feld: "offen" | "gesamt") => ergebnis.reduce((s, z) => (z.fehler === null && feld in z ? s.plus((z as { offen: string; gesamt: string })[feld]) : s), new Decimal(0)).toFixed(2);
      return c.json({ fondsId: id, stichtag, darlehen: ergebnis, summe: { offen: summe("offen"), gesamt: summe("gesamt") } }, 200);
    })
    /**
     * Zinsen des Fonds je darlehensartigem Instrument zu Stichtag und Wissensstand: Konditionen, aufgelaufen, gebucht, kapitalisiert, gezahlt, offen,
     * nächste Fälligkeit und Perioden mit Status, dazu Summen. Die Rolle am Fonds gilt für alle seine Beteiligungen.
     */
    .get("/:id/zinsen", pruefe("param", idSchema, { query: uebersichtAbfrage }), pruefe("query", uebersichtAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, stand } = c.req.valid("query");
      const ergebnis = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        const tag = stichtag ?? (await standardStichtag(tx, id, stand));
        await pruefeStichtag(tx, id, tag);
        return { fondsId: id, ...(await ladeZinsansicht(tx, { fondsId: id }, tag, stand)) };
      });
      return c.json(ergebnis, 200);
    })
    .route("/", fondsBuchungRouten(db))
    .route("/", fondsJournalRouten(db))
    .route("/:id", fondsBewertungRouten(db))
    .route("/:id", fondsKennzahlRouten(db))
    .route("/:id", berichtsvorlagenRouten(db))
    .route("/:id/berichte", berichteFuerFonds(db))
    .route("/:id/periodensperre", periodensperreRouten(db))
    .route("/:id/rollen", rollenRouten(db));
}
