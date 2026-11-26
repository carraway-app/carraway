import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { beteiligung, organisation, vorgang, zinslauf, zinslaufPosition, zinsperiodeGebucht, type Db } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { Fachfehler, fehlerAntwort } from "../fehler";
import { hauptinstrumentId } from "../instrumente/hauptinstrument";
import { pruefeStichtag } from "../instrumente/stichtag";
import { berechneZinsstand, gebuchtePerioden, ladeZinskontexte, type Zinskontext } from "../instrumente/zinsen";
import { berechneZustand, offenesKapital, pruefePeriodensperre } from "../instrumente/zustand";
import { geaendertSeitBedingung, geaendertSeitEingabe } from "../geaendert";
import { pruefe } from "../pruefung";
import { fondsSichtbar } from "../rechte/sichtbarkeit";
import { akteurAus, idParam, ladeFonds, schreibe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";
import { ordneRundeZu } from "../instrumente/vorgang-runde";

const neuerLauf = z.object({ fondsId: z.uuid(), stichtag: z.iso.date() });
const listenAbfrage = z.object({ fondsId: z.uuid().optional(), geaendertSeit: geaendertSeitEingabe });

type Lauf = typeof zinslauf.$inferSelect;

interface PruefungsErgebnis {
  schluessel: string;
  /** Stabiler Code der Prüfung (für die Übersetzung in der Oberfläche). */
  code: string;
  bezeichnung: string;
  status: "ok" | "abweichung";
  hinweis?: string;
  hinweisCode?: string;
  hinweisParams?: Record<string, unknown>;
  params: Record<string, unknown>;
  details?: unknown;
}

interface Abdeckung {
  beteiligungId: string;
  /** Fehlt bei Läufen aus der Zeit vor den Instrumenten; dann gilt die Beteiligung. */
  instrumentId?: string;
  positionen: number;
  offenesKapital: string;
}

/** Postgres-Fehlercode 23505 (Unique-Verletzung); Drizzle verpackt den Treiberfehler. */
function istEindeutigkeitsfehler(fehler: unknown): boolean {
  for (let e: unknown = fehler, tiefe = 0; e && tiefe < 5; tiefe++, e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

async function sperreLauf(tx: Tx, id: string): Promise<Lauf> {
  const [lauf] = await tx.select().from(zinslauf).where(eq(zinslauf.id, id)).for("update");
  if (!lauf) throw new Fachfehler(404, "ZINSLAUF_NICHT_GEFUNDEN", "Zinslauf nicht gefunden.");
  return lauf;
}

function verlangeStatus(lauf: Lauf, erlaubt: Lauf["status"][]) {
  if (!erlaubt.includes(lauf.status)) {
    throw new Fachfehler(409, "ZINSLAUF_STATUS_UNGUELTIG", `Der Zinslauf hat den Status „${lauf.status}“.`, { status: lauf.status, erlaubt });
  }
}

/** Aktive darlehensartige Instrumente (Darlehen, Wandeldarlehen, stille Beteiligung, Venture Debt, Gesellschafterdarlehen), die der Lauf betrachtet. */
const aktive = (kontexte: Zinskontext[]) => kontexte.filter((k) => k.beteiligung.status === "aktiv" && k.instrument.status === "aktiv");

/** Gehört die Position (oder Abdeckung) zum Instrument? Alte Zeilen ohne Instrument gelten für die Beteiligung. */
const gehoertZu = (z: { beteiligungId: string; instrumentId?: string | null }, k: Zinskontext) => (z.instrumentId ? z.instrumentId === k.instrument.id : z.beteiligungId === k.beteiligung.id);

async function ladeLaufMitPositionen(tx: Tx, id: string) {
  const [lauf] = await tx.select().from(zinslauf).where(eq(zinslauf.id, id));
  if (!lauf) return null;
  const positionen = await tx
    .select({ p: zinslaufPosition, organisationId: organisation.id, organisationName: organisation.name })
    .from(zinslaufPosition)
    .innerJoin(beteiligung, eq(beteiligung.id, zinslaufPosition.beteiligungId))
    .innerJoin(organisation, eq(organisation.id, beteiligung.organisationId))
    .where(eq(zinslaufPosition.zinslaufId, id))
    .orderBy(asc(organisation.name), asc(zinslaufPosition.beteiligungId), asc(zinslaufPosition.bis));
  const summe = positionen.reduce((s, z) => s.plus(z.p.betragGebucht), new Decimal(0));
  return {
    ...lauf,
    positionen: positionen.map((z) => ({ ...z.p, organisation: { id: z.organisationId, name: z.organisationName } })),
    summe: { anzahl: positionen.length, gebucht: summe.toFixed(2) },
  };
}

/**
 * Hinweise zu einem Fonds: aktive Darlehen ohne Konditionen (nehmen am Lauf nicht teil). `ohneKonditionen` sind die Beteiligungs-IDs
 * (wie bisher), `ohneKonditionenDetails` tragen zusätzlich den Namen der Organisation.
 */
function hinweiseAus(kontexte: Zinskontext[]) {
  const ohne = aktive(kontexte).filter((k) => k.konditionen.length === 0);
  return {
    ohneKonditionen: [...new Set(ohne.map((k) => k.beteiligung.id))],
    ohneKonditionenDetails: ohne.map((k) => ({ beteiligungId: k.beteiligung.id, instrumentId: k.instrument.id, organisation: k.organisationName, instrument: k.instrument.art })),
  };
}

/** Hinweise zum heutigen Stand des Fonds (Konditionen können nach dem Anlegen des Laufs nachgetragen worden sein). */
async function ladeHinweise(tx: Tx, fondsId: string) {
  return hinweiseAus(await ladeZinskontexte(tx, { fondsId }));
}

/** Kontrollbericht eines Laufs: Plausibilisierung gegen die Quelldaten, Abweichungen werden ausgewiesen, nicht geglättet. */
async function kontrolliere(tx: Tx, lauf: Lauf) {
  const positionen = await tx.select().from(zinslaufPosition).where(eq(zinslaufPosition.zinslaufId, lauf.id));
  const kontexte = await ladeZinskontexte(tx, { fondsId: lauf.fondsId });
  /**
   * Jede Prüfung trägt neben dem deutschen Text einen stabilen `code` und `params`, damit die Oberfläche sie übersetzen kann
   * (Entscheidung 82): `code` nennt die Prüfung, bei einer Abweichung `hinweisCode` den Befund; `params` sind die Werte dazu.
   */
  const pruefungen: PruefungsErgebnis[] = [];
  const ergebnis = (schluessel: string, code: string, bezeichnung: string, abweichungen: unknown[], optionen: { hinweis?: string; hinweisCode?: string; params?: Record<string, unknown> } = {}) =>
    pruefungen.push({
      schluessel,
      code,
      bezeichnung,
      status: abweichungen.length === 0 ? "ok" : "abweichung",
      ...(optionen.hinweis ? { hinweis: optionen.hinweis, hinweisCode: optionen.hinweisCode ?? code, hinweisParams: optionen.params ?? {} } : {}),
      params: abweichungen.length ? { anzahl: abweichungen.length } : (optionen.params ?? {}),
      ...(abweichungen.length ? { details: abweichungen } : {}),
    });

  // 1. Summe der Positionen gleich Summe der Buchungen
  const summePositionen = positionen.reduce((s, p) => s.plus(p.betragGebucht), new Decimal(0));
  if (lauf.status === "gebucht") {
    const vorgangIds = positionen.map((p) => p.vorgangId).filter((v): v is string => v !== null);
    const buchungen = vorgangIds.length ? await tx.select().from(vorgang).where(inArray(vorgang.id, vorgangIds)) : [];
    const summeBuchungen = buchungen.reduce((s, v) => s.plus(v.betrag), new Decimal(0));
    const ohneVorgang = positionen.filter((p) => p.vorgangId === null && new Decimal(p.betragGebucht).greaterThan(0));
    ergebnis(
      "summe_positionen_gleich_buchungen",
      "ZINSLAUF_SUMME_ABWEICHUNG",
      "Summe der Positionen entspricht der Summe der Buchungen",
      summePositionen.equals(summeBuchungen) && ohneVorgang.length === 0 ? [] : [{ summePositionen: summePositionen.toFixed(2), summeBuchungen: summeBuchungen.toFixed(2), positionenOhneBuchung: ohneVorgang.map((p) => p.id) }],
      { params: { summePositionen: summePositionen.toFixed(2), summeBuchungen: summeBuchungen.toFixed(2) } },
    );
  } else {
    ergebnis("summe_positionen_gleich_buchungen", "ZINSLAUF_SUMME_ABWEICHUNG", "Summe der Positionen entspricht der Summe der Buchungen", [], {
      hinweis: `Lauf ist ${lauf.status}, es gibt noch keine Buchungen (Summe der Positionen ${summePositionen.toFixed(2)})`,
      hinweisCode: "ZINSLAUF_NOCH_NICHT_GEBUCHT",
      params: { status: lauf.status, summePositionen: summePositionen.toFixed(2) },
    });
  }

  // 2. Keine Periode doppelt gebucht (alle gültigen Zinsbuchungen der Darlehen des Fonds), und kein Positionspaar in zwei gebuchten Läufen
  const doppelt: unknown[] = [];
  for (const k of kontexte) {
    const aufgehoben = new Set<string>();
    for (const v of k.vorgaenge) {
      if (!v.storniertVorgangId) continue;
      aufgehoben.add(v.id);
      aufgehoben.add(v.storniertVorgangId);
    }
    const zaehler = new Map<string, number>();
    for (const v of k.vorgaenge) {
      if (v.art !== "zins" || aufgehoben.has(v.id) || !new Decimal(v.betrag).greaterThan(0)) continue;
      zaehler.set(v.valuta, (zaehler.get(v.valuta) ?? 0) + 1);
    }
    for (const [bis, n] of zaehler) if (n > 1) doppelt.push({ beteiligungId: k.beteiligung.id, instrumentId: k.instrument.id, periodeBis: bis, buchungen: n });
    if (lauf.status !== "gebucht") {
      const gebucht = new Set(gebuchtePerioden(k));
      for (const p of positionen.filter((x) => gehoertZu(x, k) && gebucht.has(x.bis))) {
        doppelt.push({ beteiligungId: k.beteiligung.id, instrumentId: k.instrument.id, periodeBis: p.bis, hinweis: "Periode ist bereits anderweitig gebucht" });
      }
    }
  }
  ergebnis("keine_periode_doppelt", "ZINSPERIODE_DOPPELT", "Keine Zinsperiode ist doppelt gebucht", doppelt);

  // 3. Jedes aktive Darlehen mit Konditionen ist im Lauf abgedeckt
  const abdeckungen = lauf.abgedeckt as Abdeckung[];
  const luecken = aktive(kontexte)
    .filter((k) => k.konditionen.length > 0 && !abdeckungen.some((a) => gehoertZu(a, k)))
    .map((k) => ({ beteiligungId: k.beteiligung.id, instrumentId: k.instrument.id, organisation: k.organisationName }));
  ergebnis("alle_darlehen_abgedeckt", "DARLEHEN_NICHT_ABGEDECKT", "Jedes aktive Darlehen mit Konditionen ist im Lauf abgedeckt", luecken);

  // 4. Aktive Darlehen ohne Konditionen
  const ohneKonditionen = aktive(kontexte)
    .filter((k) => k.konditionen.length === 0 && ["darlehen", "wandeldarlehen"].includes(k.instrument.art))
    .map((k) => ({ beteiligungId: k.beteiligung.id, instrumentId: k.instrument.id, organisation: k.organisationName }));
  ergebnis("darlehen_mit_konditionen", "DARLEHEN_OHNE_KONDITIONEN", "Jedes aktive Darlehen hat Konditionen", ohneKonditionen);

  // 5. Positionen und Darlehen ohne Kapital
  const kapitalNull: unknown[] = positionen
    .filter((p) => (p.kapitalien as { kapital: string }[]).every((a) => new Decimal(a.kapital).isZero()))
    .map((p) => ({ positionId: p.id, beteiligungId: p.beteiligungId, von: p.von, bis: p.bis }));
  for (const a of abdeckungen) {
    if (new Decimal(a.offenesKapital).isZero()) kapitalNull.push({ beteiligungId: a.beteiligungId, ...(a.instrumentId ? { instrumentId: a.instrumentId } : {}), hinweis: "Kein offenes Kapital im Lauf" });
  }
  ergebnis("kapital_null", "KAPITAL_NULL", "Keine Position und kein Darlehen mit Kapital null", kapitalNull);

  return {
    zinslaufId: lauf.id,
    status: lauf.status,
    stichtag: lauf.stichtag,
    gesamt: pruefungen.every((p) => p.status === "ok") ? ("ok" as const) : ("abweichung" as const),
    pruefungen,
  };
}

export function zinslaufRouten(db: Db) {
  return new Hono()
    .get("/", pruefe("query", listenAbfrage), async (c) => {
      const { fondsId, geaendertSeit } = c.req.valid("query");
      const zeilen = await lese(db, (tx) =>
        tx
          .select({
            id: zinslauf.id,
            fondsId: zinslauf.fondsId,
            stichtag: zinslauf.stichtag,
            status: zinslauf.status,
            berechnetVon: zinslauf.berechnetVon,
            berechnetAm: zinslauf.berechnetAm,
            geprueftVon: zinslauf.geprueftVon,
            freigegebenVon: zinslauf.freigegebenVon,
            gebuchtAm: zinslauf.gebuchtAm,
            anzahlPositionen: sql<number>`(SELECT count(*)::int FROM zinslauf_position p WHERE p.zinslauf_id = "zinslauf"."id")`,
            summeGebucht: sql<string>`(SELECT coalesce(sum(p.betrag_gebucht), 0)::text FROM zinslauf_position p WHERE p.zinslauf_id = "zinslauf"."id")`,
          })
          .from(zinslauf)
          .where(and(fondsId ? eq(zinslauf.fondsId, fondsId) : undefined, fondsSichtbar(c, zinslauf.fondsId), geaendertSeitBedingung("zinslauf", zinslauf.id, zinslauf.berechnetAm, geaendertSeit)))
          .orderBy(desc(zinslauf.stichtag), desc(zinslauf.berechnetAm), asc(zinslauf.id)),
      );
      return c.json({ daten: zeilen }, 200);
    })
    .get("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const lauf = await lese(db, async (tx) => {
        const l = await ladeLaufMitPositionen(tx, id);
        return l ? { ...l, hinweise: await ladeHinweise(tx, l.fondsId) } : null;
      });
      if (!lauf) return fehlerAntwort(c, 404, "ZINSLAUF_NICHT_GEFUNDEN", "Zinslauf nicht gefunden.");
      return c.json(lauf, 200);
    })
    .get("/:id/kontrolle", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const bericht = await lese(db, async (tx) => {
        const [lauf] = await tx.select().from(zinslauf).where(eq(zinslauf.id, id));
        return lauf ? kontrolliere(tx, lauf) : null;
      });
      if (!bericht) return fehlerAntwort(c, 404, "ZINSLAUF_NICHT_GEFUNDEN", "Zinslauf nicht gefunden.");
      return c.json(bericht, 200);
    })
    /** Berechnet die Positionen aller aktiven Darlehen mit Konditionen; Status `berechnet`. */
    .post("/", pruefe("json", neuerLauf), async (c) => {
      const { fondsId, stichtag } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, fondsId);
        await pruefeStichtag(tx, fondsId, stichtag);
        const kontexte = aktive(await ladeZinskontexte(tx, { fondsId }));
        const mitKonditionen = kontexte.filter((k) => k.konditionen.length > 0);
        const abgedeckt: Abdeckung[] = [];
        const zeilen: (typeof zinslaufPosition.$inferInsert)[] = [];
        for (const k of mitKonditionen) {
          const stand = berechneZinsstand(k, stichtag);
          const instrumentId = k.instrument.id;
          abgedeckt.push({ beteiligungId: k.beteiligung.id, instrumentId, positionen: stand.positionen.length, offenesKapital: offenesKapital(berechneZustand(k.vorgaenge)).toFixed(2) });
          for (const { position: p, kondition } of stand.positionen) {
            zeilen.push({
              zinslaufId: "",
              beteiligungId: k.beteiligung.id,
              instrumentId,
              konditionId: kondition.id,
              von: p.von,
              bis: p.bis,
              faelligAm: p.faelligAm,
              gestundet: p.gestundet,
              betragFix: p.betragFix.toFixed(),
              betragGewinn: p.betragGewinn.toFixed(),
              betragGesamt: p.betragGesamt.toFixed(),
              betragGebucht: p.betragGebucht.toFixed(2),
              kapitalisiert: p.kapitalisiert,
              kapitalien: p.kapitalien.map((a) => ({ von: a.von, bis: a.bis, kapital: a.kapital.toString() })),
              schritte: p.schritte,
            });
          }
        }
        const [lauf] = await tx.insert(zinslauf).values({ fondsId, stichtag, berechnetVon: akteurAus(c), abgedeckt }).returning();
        if (!lauf) throw new Error("Zinslauf nicht angelegt");
        if (zeilen.length) await tx.insert(zinslaufPosition).values(zeilen.map((z) => ({ ...z, zinslaufId: lauf.id })));
        await protokoll("anlegen", "zinslauf", lauf.id, null, { ...lauf, positionen: zeilen.length });
        return { id: lauf.id, hinweise: hinweiseAus(kontexte) };
      });
      const lauf = await lese(db, (tx) => ladeLaufMitPositionen(tx, ergebnis.id));
      return c.json({ ...lauf, hinweise: ergebnis.hinweise }, 201);
    })
    .post("/:id/pruefen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = akteurAus(c);
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await sperreLauf(tx, id);
        verlangeStatus(vorher, ["berechnet"]);
        const [neu] = await tx.update(zinslauf).set({ status: "geprueft", geprueftVon: akteur, geprueftAm: new Date() }).where(eq(zinslauf.id, id)).returning();
        await protokoll("pruefen", "zinslauf", id, vorher, neu);
        return neu;
      });
      return c.json(nachher, 200);
    })
    /** Vier-Augen: die Person muss sich von der Person der Prüfung unterscheiden. */
    .post("/:id/freigeben", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = akteurAus(c);
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await sperreLauf(tx, id);
        verlangeStatus(vorher, ["geprueft"]);
        if (vorher.geprueftVon === akteur) {
          throw new Fachfehler(409, "VIER_AUGEN_VERLETZT", "Die Freigabe muss von einem anderen Akteur kommen als die Prüfung.");
        }
        const [neu] = await tx.update(zinslauf).set({ status: "freigegeben", freigegebenVon: akteur, freigegebenAm: new Date() }).where(eq(zinslauf.id, id)).returning();
        await protokoll("freigeben", "zinslauf", id, vorher, neu);
        return neu;
      });
      return c.json(nachher, 200);
    })
    .post("/:id/verwerfen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = akteurAus(c);
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await sperreLauf(tx, id);
        verlangeStatus(vorher, ["berechnet", "geprueft", "freigegeben"]);
        const [neu] = await tx.update(zinslauf).set({ status: "verworfen", verworfenVon: akteur, verworfenAm: new Date() }).where(eq(zinslauf.id, id)).returning();
        await protokoll("verwerfen", "zinslauf", id, vorher, neu);
        return neu;
      });
      return c.json(nachher, 200);
    })
    /**
     * Bucht die freigegebenen Positionen: je Position ein `zins`-Vorgang (Valuta = Periodenende, Betrag auf Cent,
     * bei Kapitalisierung mit Kennzeichen `kapitalisiert`) und ein Marker, der die Periode sperrt. Sind seit der
     * Berechnung Vorgänge der Darlehen erfasst worden (409 `ZINSLAUF_VERALTET`) oder ist eine Periode inzwischen
     * gebucht (409 `ZINSPERIODE_GEBUCHT`), bricht die Buchung ab.
     */
    .post("/:id/buchen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = akteurAus(c);
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await sperreLauf(tx, id);
        verlangeStatus(vorher, ["freigegeben"]);
        const positionen = await tx.select().from(zinslaufPosition).where(eq(zinslaufPosition.zinslaufId, id)).orderBy(asc(zinslaufPosition.beteiligungId), asc(zinslaufPosition.bis));
        // Gebucht wird mit Valuta = Periodenende; die früheste Periode entscheidet, ob die Sperre greift.
        const fruehestes = positionen.map((p) => p.bis).sort()[0];
        if (fruehestes) await pruefePeriodensperre(tx, vorher.fondsId, fruehestes);
        const beteiligungIds = [...new Set(positionen.map((p) => p.beteiligungId))];
        for (const bid of beteiligungIds) await tx.select({ id: beteiligung.id }).from(beteiligung).where(eq(beteiligung.id, bid)).for("update");
        // Positionen alter Läufe ohne Instrument gehören zum Hauptinstrument ihrer Beteiligung.
        const zuordnung = new Map<string, string>();
        for (const p of positionen) zuordnung.set(p.id, p.instrumentId ?? (await hauptinstrumentId(tx, p.beteiligungId)));
        const instrumentIds = [...new Set(zuordnung.values())];
        const kontexte = instrumentIds.length ? await ladeZinskontexte(tx, { instrumentIds }) : [];
        for (const k of kontexte) {
          const gebucht = new Set(gebuchtePerioden(k));
          const spaeter = k.vorgaenge.filter((v) => v.erfasstAm > vorher.berechnetAm);
          for (const p of positionen.filter((x) => zuordnung.get(x.id) === k.instrument.id)) {
            if (gebucht.has(p.bis)) {
              throw new Fachfehler(409, "ZINSPERIODE_GEBUCHT", "Die Periode ist bereits gebucht.", { beteiligungId: k.beteiligung.id, instrumentId: k.instrument.id, periodeBis: p.bis });
            }
          }
          if (spaeter.length > 0) {
            throw new Fachfehler(409, "ZINSLAUF_VERALTET", "Seit der Berechnung wurden Vorgänge der Darlehen erfasst; bitte neu berechnen.", { beteiligungId: k.beteiligung.id, instrumentId: k.instrument.id });
          }
        }
        for (const p of positionen) {
          const instrumentId = zuordnung.get(p.id)!;
          let vorgangId: string | null = null;
          if (new Decimal(p.betragGebucht).greaterThan(0)) {
            const [neu] = await tx
              .insert(vorgang)
              .values({
                beteiligungId: p.beteiligungId,
                instrumentId,
                art: "zins",
                valuta: p.bis,
                betrag: p.betragGebucht,
                kapitalisiert: p.kapitalisiert,
                bemerkung: `Zinslauf zum ${vorher.stichtag}: Zinsen ${p.von} bis ${p.bis}${p.gestundet ? `, gestundet bis ${p.faelligAm}` : ""}`,
              })
              .returning();
            vorgangId = neu!.id;
            await protokoll("anlegen", "vorgang", neu!.id, null, neu);
            await ordneRundeZu(tx, protokoll, neu!);
          }
          try {
            await tx.insert(zinsperiodeGebucht).values({ beteiligungId: p.beteiligungId, instrumentId, periodeBis: p.bis, zinslaufPositionId: p.id, vorgangId });
          } catch (fehler) {
            if (istEindeutigkeitsfehler(fehler)) throw new Fachfehler(409, "ZINSPERIODE_GEBUCHT", "Die Periode ist bereits gebucht.", { beteiligungId: p.beteiligungId, periodeBis: p.bis });
            throw fehler;
          }
          if (vorgangId) await tx.update(zinslaufPosition).set({ vorgangId }).where(eq(zinslaufPosition.id, p.id));
        }
        const [neu] = await tx.update(zinslauf).set({ status: "gebucht", gebuchtVon: akteur, gebuchtAm: new Date() }).where(and(eq(zinslauf.id, id))).returning();
        await protokoll("buchen", "zinslauf", id, vorher, { ...neu, positionen: positionen.length });
        return neu;
      });
      return c.json(nachher, 200);
    });
}
