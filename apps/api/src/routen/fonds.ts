import { portfolioAnApi } from "../portfolio-vertrag";
import { pruefePortfolio } from "../portfolio-pruefung";
import { pruefeFonds } from "../fonds-pruefung";
import { fondsAnApi } from "../fonds-vertrag";
import { Hono } from "hono";
import { z } from "zod";
import { fonds, snapshotAuftrag, type Db } from "@carraway/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { Fachfehler, fehlerAntwort } from "../fehler";
import { abgerufen, sperreFonds } from "../instrumente/fondsbewegung";
import { pruefeStichtag } from "../instrumente/stichtag";
import { bewerteZusagen } from "../instrumente/zusagen";
import { berechneAbgrenzung, ladeZinskontexte } from "../instrumente/zinsen";
import { ladeZinsansicht } from "../instrumente/zinsansicht";
import { berechneFondsUebersicht, uebersichtFuerAnsicht, standardStichtag } from "../kennzahlen/fonds";
import { ladeNavEinzelwerte } from "../kennzahlen/nav-herkunft";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { holeSnapshot, wirdGespeichert } from "../kennzahlen/snapshot";
import { geaendertSeitBedingung, geaendertSeitEingabe } from "../geaendert";
import { liesAbfrage } from "../pruefung";
import { fondsSichtbar, portfolioSicht } from "../rechte/sichtbarkeit";
import { Decimal } from "@carraway/rechenkern";
import { heute, ladeFonds, mindestensEins, MINDESTENS_EIN_FELD, schreibe, textEingabe } from "../schreiben";
import { hatPostgresCode } from "../szenarien/konstanten";
import { lese } from "../zeitlimit";
import { beteiligungEingabe, legeBeteiligungDirektAn, sucheBeteiligungsunternehmen } from "../portfolio/beteiligung-anlegen";
import { periodensperreRouten } from "./periodensperre";
import { pruefeNeuesZeichnungskapital } from "./investoren";
import { rollenRouten } from "./benutzer";
import { fondsBewertungRouten } from "./bewertungen";
import { fondsKennzahlRouten } from "./kennzahlen";
import { fondsJournalRouten } from "./journal";

/** Abfrage der Fondsliste; nicht im Routentyp deklariert (bestehende Aufrufer rufen ohne sie auf), aber in der OpenAPI-Beschreibung. */
export const fondsListenAbfrage = z.object({ changedSince: geaendertSeitEingabe });
const idSchema = z.object({ id: z.uuid() });
const unternehmenAbfrage = z.object({ q: z.string().trim().min(2).max(200) });
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
  zeichnungskapital: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "Expected a non-negative amount with at most two decimal places"),
  waehrung: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Expected a three-letter currency code"),
});
// Bestehende Buchungen und Bewertungen sind in der ursprünglichen Fondswährung erfasst.
const fondsAenderung = fondsAnlage.omit({ waehrung: true }).partial().refine(mindestensEins, MINDESTENS_EIN_FELD);

const stammAuszug = ({ id, name, kurzname, vintage, zeichnungskapital, waehrung }: typeof fonds.$inferSelect) =>
  ({ id, name, kurzname, vintage, zeichnungskapital, waehrung });

const kurznameVergeben = () => new Fachfehler(409, "fund_short_name_taken", "This fund short name is already taken.");

export function fondsRouten(db: Db) {
  return new Hono()
    .get("/", async (c) => {
      // Abfrageparameter nicht im Routentyp deklariert: bestehende Aufrufer rufen ohne sie auf.
      const { changedSince: geaendertSeit } = liesAbfrage(c, fondsListenAbfrage);
      const zeilen = await lese(db, (tx) =>
        tx
          .select({
            ...stammFelder,
            nachZusage: fonds.lpVerteilungNachZusage,
            abgedeckt: sql<string>`(SELECT coalesce(sum(z.zusage), 0)::text FROM fonds_zeichnung z WHERE z.fonds_id = "fonds"."id")`,
            anzahl: sql<number>`(SELECT count(*)::int FROM fonds_zeichnung z WHERE z.fonds_id = "fonds"."id")`,
          })
          .from(fonds)
          .where(and(fondsSichtbar(c, fonds.id), geaendertSeitBedingung("fonds", fonds.id, fonds.erstelltAm, geaendertSeit)))
          .orderBy(asc(fonds.vintage), asc(fonds.name)),
      );
      // Abdeckung des Zeichnungskapitals durch die LP-Zusagen (Issue #275): Hinweis auf der Fondsseite, solange sie unvollständig ist.
      const daten = zeilen.map(({ nachZusage, abgedeckt, anzahl, ...stamm }) => {
        const stand = bewerteZusagen(stamm.zeichnungskapital, abgedeckt, anzahl, nachZusage);
        return { ...stamm, abgedeckt: stand.abgedeckt, zusagenVollstaendig: stand.vollstaendig };
      });
      return c.json(fondsAnApi({ daten }), 200);
    })
    .post("/", pruefeFonds("json", fondsAnlage), async (c) => {
      const eingabe = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [zeile] = await tx.insert(fonds).values(eingabe).onConflictDoNothing({ target: fonds.kurzname }).returning(stammFelder);
        if (!zeile) throw kurznameVergeben();
        await protokoll("anlegen", "fonds", zeile.id, null, zeile);
        return zeile;
      });
      return c.json(fondsAnApi(neu), 201);
    })
    .get("/:id", pruefeFonds("param", idSchema), async (c) => {
      const { id } = c.req.valid("param");
      return c.json(fondsAnApi(await lese(db, async (tx) => stammAuszug(await ladeFonds(tx, id)))), 200);
    })
    .patch("/:id", pruefeFonds("param", idSchema), pruefeFonds("json", fondsAenderung), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      try {
        const nachher = await schreibe(db, c, async (tx, protokoll) => {
          const vorher = await sperreFonds(tx, id);
          if (eingabe.zeichnungskapital !== undefined && !new Decimal(eingabe.zeichnungskapital).eq(vorher.zeichnungskapital)) {
            if ((await abgerufen(tx, id)).greaterThan(eingabe.zeichnungskapital)) {
              throw new Fachfehler(409, "subscribed_capital_below_calls", "The subscribed capital is below the amounts already called.");
            }
            await pruefeNeuesZeichnungskapital(tx, protokoll, vorher, eingabe.zeichnungskapital, aktuellerAkteur(c).globalVerwalter);
          }
          const [zeile] = await tx.update(fonds).set(eingabe).where(eq(fonds.id, id)).returning(stammFelder);
          if (!zeile) throw new Error("Fonds konnte nicht aktualisiert werden.");
          await protokoll("aendern", "fonds", id, stammAuszug(vorher), zeile);
          return zeile;
        });
        return c.json(fondsAnApi(nachher), 200);
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
    .get("/:id/overview", pruefeFonds("param", idSchema, { query: uebersichtAbfrage }), pruefeFonds("query", uebersichtAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, stand } = c.req.valid("query");
      const vorhanden = await lese(db, async (tx) => (await tx.select({ id: fonds.id }).from(fonds).where(eq(fonds.id, id))).length > 0);
      if (!vorhanden) return fehlerAntwort(c, 404, "fund_not_found", "Fund not found.");

      const sieht = portfolioSicht(aktuellerAkteur(c));
      if (stand !== undefined) {
        const uebersicht = await lese(db, async (tx) => berechneFondsUebersicht(tx, id, stichtag, stand));
        return c.json(fondsAnApi({ ...uebersichtFuerAnsicht(uebersicht, sieht), quellenstand: stand, snapshot: null }), 200);
      }
      const { uebersicht, snapshot, quellenstand } = await holeSnapshot(db, c, id, stichtag);
      return c.json(fondsAnApi({ ...uebersichtFuerAnsicht(uebersicht, sieht), snapshot, quellenstand }), 200);
    })
    .get("/:id/nav-components", pruefeFonds("param", idSchema), pruefeFonds("query", uebersichtAbfrage.required()), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, stand } = c.req.valid("query");
      return c.json(fondsAnApi(await lese(db, (tx) => ladeNavEinzelwerte(tx, aktuellerAkteur(c), id, stichtag, stand))), 200);
    })
    /** Fordert eine Neuberechnung an (202). Der Worker rechnet im Hintergrund; ohne `stichtag` alle Snapshots des Fonds. */
    .post("/:id/recalculate", pruefeFonds("param", idSchema, { query: stichtagSchema }), pruefeFonds("query", stichtagSchema), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag } = c.req.valid("query");
      await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        if (stichtag && !(await wirdGespeichert(tx, id, stichtag))) {
          throw new Fachfehler(400, "invalid_input", "Recalculation only for quarter ends and the default as-of date.", {
            felder: [{ feld: "stichtag", code: "as_of_not_stored", meldung: "Only quarter ends and the last valuation as-of date are stored as a snapshot" }],
          });
        }
        await tx.insert(snapshotAuftrag).values({ fondsId: id, stichtag: stichtag ?? null }).onConflictDoNothing();
        await protokoll("neuberechnung", "fonds", id, null, { stichtag: stichtag ?? null });
      });
      return c.json(fondsAnApi({ angefordert: true as const, fondsId: id, stichtag: stichtag ?? null }), 202);
    })
    /**
     * Abgrenzung zum Stichtag: aufgelaufene, noch nicht gebuchte Zinsen je aktivem Darlehen mit Konditionen, getrennt in
     * fällige ungebuchte Perioden und das laufende Stück seit dem letzten Periodenende, mit Rechenweg (Schritten).
     * Ein Darlehen, das sich nicht rechnen lässt (z. B. fehlender Jahresüberschuss), erscheint mit `fehler` und zählt nicht in die Summe.
     */
    .get("/:id/accruals", pruefeFonds("param", idSchema, { query: stichtagSchema }), pruefeFonds("query", stichtagSchema), async (c) => {
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
            return { ...kopf, fehler: (fehler as Error).message, fehlerCode: fach?.code ?? "calculation_failed", fehlerParams: fach?.zusatz ?? {} };
          }
        });
      });
      const summe = (feld: "offen" | "gesamt") => ergebnis.reduce((s, z) => (z.fehler === null && feld in z ? s.plus((z as { offen: string; gesamt: string })[feld]) : s), new Decimal(0)).toFixed(2);
      return c.json(fondsAnApi({ fondsId: id, stichtag, darlehen: ergebnis, summe: { offen: summe("offen"), gesamt: summe("gesamt") } }), 200);
    })
    /**
     * Zinsen des Fonds je darlehensartigem Instrument zu Stichtag und Wissensstand: Konditionen, aufgelaufen, gebucht, kapitalisiert, gezahlt, offen,
     * nächste Fälligkeit und Perioden mit Status, dazu Summen. Die Rolle am Fonds gilt für alle seine Beteiligungen.
     */
    .get("/:id/interest", pruefeFonds("param", idSchema, { query: uebersichtAbfrage }), pruefeFonds("query", uebersichtAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, stand } = c.req.valid("query");
      const ergebnis = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        const tag = stichtag ?? (await standardStichtag(tx, id, stand));
        await pruefeStichtag(tx, id, tag);
        return { fondsId: id, ...(await ladeZinsansicht(tx, { fondsId: id }, tag, stand)) };
      });
      return c.json(fondsAnApi(ergebnis), 200);
    })
    .get("/:id/investment-companies", pruefePortfolio("param", idSchema, { query: unternehmenAbfrage }), pruefePortfolio("query", unternehmenAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { q } = c.req.valid("query");
      const treffer = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        return sucheBeteiligungsunternehmen(tx, id, q);
      });
      return c.json(portfolioAnApi(treffer), 200);
    })
    .post("/:id/investments", pruefePortfolio("param", idSchema), pruefePortfolio("json", beteiligungEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        return legeBeteiligungDirektAn(tx, protokoll, id, eingabe);
      });
      return c.json(portfolioAnApi(neu), 201);
    })
    .route("/", fondsJournalRouten(db))
    .route("/:id", fondsBewertungRouten(db))
    .route("/:id", fondsKennzahlRouten(db))
    .route("/:id/period-lock", periodensperreRouten(db))
    .route("/:id/roles", rollenRouten(db));
}
