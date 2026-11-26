import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { beteiligung, bewertung, bewertungsrunde, finanzierungsrunde, organisation, rundenposition } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { pruefePeriodensperre } from "./zustand";
import { gibBewertungFrei, legeEntwurfAn, verlangeAnderenAkteur, verwirfEntwurf, type Methode } from "./bewertung";

/**
 * Massen-Neubewertung: Entwürfe für alle aktiven Beteiligungen eines Fonds, die zum Stichtag noch keine Bewertung
 * (weder freigegeben noch Entwurf) haben, in einer Runde gebündelt; die Runde wird mit einer Freigabe freigegeben.
 *
 * - `fortschreiben`: der zuletzt freigegebene Wert vor dem Stichtag, mit seiner Methode.
 * - `letzte_runde`: Preis je Anteil der letzten Finanzierungsrunde des Unternehmens bis zum Stichtag × Anteile, die der Fonds
 *   in Runden bis zum Stichtag hält. Fehlen Runde oder Anteile (z. B. bei Darlehen), wird fortgeschrieben.
 */

export type Vorschlag = "fortschreiben" | "letzte_runde";

export interface Uebersprungen {
  beteiligungId: string;
  organisation: string;
  grund: "bewertung_vorhanden" | "entwurf_vorhanden" | "keine_vorherige_bewertung";
}

export async function legeRundeAn(tx: Tx, protokoll: Protokollant, fondsId: string, stichtag: string, vorschlag: Vorschlag) {
  await pruefePeriodensperre(tx, fondsId, stichtag);
  const [offen] = await tx
    .select({ id: bewertungsrunde.id })
    .from(bewertungsrunde)
    .where(and(eq(bewertungsrunde.fondsId, fondsId), eq(bewertungsrunde.stichtag, stichtag), eq(bewertungsrunde.status, "entwurf")));
  if (offen) throw new Fachfehler(409, "valuation_round_open", "There is already an open valuation round for this as-of date.", { bewertungsrundeId: offen.id });

  const [runde] = await tx.insert(bewertungsrunde).values({ fondsId, stichtag, vorschlag, erstelltVon: protokoll.akteur }).returning();
  if (!runde) throw new Error("Bewertungsrunde nicht angelegt");
  await protokoll("anlegen", "bewertungsrunde", runde.id, null, runde);

  const aktive = await tx
    .select({ b: beteiligung, organisation: organisation.name })
    .from(beteiligung)
    .innerJoin(organisation, eq(organisation.id, beteiligung.organisationId))
    .where(and(eq(beteiligung.fondsId, fondsId), eq(beteiligung.status, "aktiv"), lte(beteiligung.erstinvestment, stichtag)))
    .orderBy(asc(organisation.name), asc(beteiligung.id));

  const ids = aktive.map((a) => a.b.id);
  const vorhandene = ids.length
    ? await tx
        .select({ beteiligungId: bewertung.beteiligungId, status: bewertung.status })
        .from(bewertung)
        .where(and(inArray(bewertung.beteiligungId, ids), eq(bewertung.stichtag, stichtag), inArray(bewertung.status, ["freigegeben", "entwurf"])))
    : [];
  const hat = (id: string, status: string) => vorhandene.some((v) => v.beteiligungId === id && v.status === status);

  // Letzte freigegebene Bewertung vor dem Stichtag je Beteiligung
  const letzte = ids.length
    ? (
        await tx.execute<{ beteiligung_id: string; stichtag: string; wert: string; methode: Methode }>(sql`
          SELECT DISTINCT ON (beteiligung_id) beteiligung_id, stichtag::text AS stichtag, wert::text AS wert, methode::text AS methode
          FROM bewertung
          WHERE status = 'freigegeben' AND stichtag < ${stichtag}::date AND beteiligung_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
          ORDER BY beteiligung_id, stichtag DESC`)
      ).rows
    : [];

  // Letzte Runde und Anteile des Fonds je Unternehmen
  const organisationen = [...new Set(aktive.map((a) => a.b.organisationId))];
  const runden = organisationen.length
    ? await tx
        .select()
        .from(finanzierungsrunde)
        .where(and(inArray(finanzierungsrunde.organisationId, organisationen), lte(finanzierungsrunde.datum, stichtag), eq(finanzierungsrunde.status, "abgeschlossen"), eq(finanzierungsrunde.art, "eigenkapital")))
        .orderBy(desc(finanzierungsrunde.datum), desc(finanzierungsrunde.erstelltAm))
    : [];
  const positionen = runden.length
    ? await tx
        .select()
        .from(rundenposition)
        .where(and(inArray(rundenposition.rundeId, runden.map((r) => r.id)), eq(rundenposition.fondsId, fondsId)))
    : [];

  const entwuerfe: (typeof bewertung.$inferSelect)[] = [];
  const uebersprungen: Uebersprungen[] = [];
  for (const { b, organisation: name } of aktive) {
    if (hat(b.id, "freigegeben")) {
      uebersprungen.push({ beteiligungId: b.id, organisation: name, grund: "bewertung_vorhanden" });
      continue;
    }
    if (hat(b.id, "entwurf")) {
      uebersprungen.push({ beteiligungId: b.id, organisation: name, grund: "entwurf_vorhanden" });
      continue;
    }
    let wert: string | null = null;
    let methode: Methode = "sonstige";
    let begruendung = "";
    if (vorschlag === "letzte_runde") {
      const eigene = runden.filter((r) => r.organisationId === b.organisationId);
      const juengste = eigene[0];
      const anteile = positionen.filter((p) => eigene.some((r) => r.id === p.rundeId)).reduce((s, p) => s.plus(p.anteile), new Decimal(0));
      if (juengste && anteile.greaterThan(0)) {
        wert = anteile.times(juengste.preisJeAnteil!).toDecimalPlaces(2).toFixed(2);
        methode = "letzte_runde";
        begruendung = `Preis je Anteil der Runde „${juengste.bezeichnung}“ vom ${juengste.datum} (${juengste.preisJeAnteil}) × ${anteile.toFixed(0)} Anteile des Fonds`;
      }
    }
    if (wert === null) {
      const vorherige = letzte.find((l) => l.beteiligung_id === b.id);
      if (!vorherige) {
        uebersprungen.push({ beteiligungId: b.id, organisation: name, grund: "keine_vorherige_bewertung" });
        continue;
      }
      wert = vorherige.wert;
      methode = vorherige.methode;
      begruendung =
        vorschlag === "letzte_runde"
          ? `Fortgeschrieben vom ${vorherige.stichtag} (keine Runde mit Anteilen des Fonds)`
          : `Fortgeschrieben vom ${vorherige.stichtag}`;
    }
    const { bewertung: neu } = await legeEntwurfAn(tx, protokoll, b.id, { stichtag, wert, methode, begruendung, bewertungsrundeId: runde.id });
    entwuerfe.push(neu);
  }
  // Die Liste bleibt mit der Runde erhalten (Anzeige auch nach dem Neuladen der Seite).
  const [mitListe] = await tx.update(bewertungsrunde).set({ uebersprungen }).where(eq(bewertungsrunde.id, runde.id)).returning();
  return { runde: mitListe ?? runde, bewertungen: entwuerfe, uebersprungen };
}

/** Prüft, dass eine Runde für Entwürfe angegeben werden darf: offen, gleicher Fonds, gleicher Stichtag. */
export async function pruefeRundeFuerEntwurf(tx: Tx, rundeId: string, fondsId: string, stichtag: string) {
  const [runde] = await tx.select().from(bewertungsrunde).where(eq(bewertungsrunde.id, rundeId));
  if (!runde) throw new Fachfehler(404, "valuation_round_not_found", "Valuation round not found.");
  if (runde.status !== "entwurf") {
    throw new Fachfehler(409, "valuation_status_invalid", `The valuation round has the status "${runde.status}".`, { status: runde.status });
  }
  if (runde.fondsId !== fondsId || runde.stichtag !== stichtag) {
    throw new Fachfehler(409, "valuation_round_mismatch", "The round belongs to a different fund or as-of date.");
  }
}

export async function sperreRunde(tx: Tx, id: string) {
  const [runde] = await tx.select().from(bewertungsrunde).where(eq(bewertungsrunde.id, id)).for("update");
  if (!runde) throw new Fachfehler(404, "valuation_round_not_found", "Valuation round not found.");
  return runde;
}

function verlangeOffen(runde: typeof bewertungsrunde.$inferSelect) {
  if (runde.status !== "entwurf") {
    throw new Fachfehler(409, "valuation_status_invalid", `The valuation round has the status "${runde.status}".`, { status: runde.status });
  }
}

/** Gibt alle noch offenen Entwürfe der Runde in einer Transaktion frei (Vier-Augen: andere Person als der Ersteller der Runde). */
export async function gibRundeFrei(tx: Tx, protokoll: Protokollant, id: string) {
  const vorher = await sperreRunde(tx, id);
  verlangeOffen(vorher);
  verlangeAnderenAkteur(vorher.erstelltVon, protokoll.akteur);
  await pruefePeriodensperre(tx, vorher.fondsId, vorher.stichtag);
  const offene = await tx
    .select({ id: bewertung.id })
    .from(bewertung)
    .where(and(eq(bewertung.bewertungsrundeId, id), eq(bewertung.status, "entwurf")))
    .orderBy(asc(bewertung.beteiligungId));
  for (const o of offene) await gibBewertungFrei(tx, protokoll, o.id);
  const [nachher] = await tx
    .update(bewertungsrunde)
    .set({ status: "freigegeben", freigegebenVon: protokoll.akteur, freigegebenAm: new Date() })
    .where(eq(bewertungsrunde.id, id))
    .returning();
  await protokoll("freigeben", "bewertungsrunde", id, vorher, nachher);
  return { runde: nachher!, freigegeben: offene.length };
}

export async function verwirfRunde(tx: Tx, protokoll: Protokollant, id: string) {
  const vorher = await sperreRunde(tx, id);
  verlangeOffen(vorher);
  const offene = await tx
    .select({ id: bewertung.id })
    .from(bewertung)
    .where(and(eq(bewertung.bewertungsrundeId, id), eq(bewertung.status, "entwurf")))
    .orderBy(asc(bewertung.beteiligungId));
  for (const o of offene) await verwirfEntwurf(tx, protokoll, o.id);
  const [nachher] = await tx.update(bewertungsrunde).set({ status: "verworfen" }).where(eq(bewertungsrunde.id, id)).returning();
  await protokoll("verwerfen", "bewertungsrunde", id, vorher, nachher);
  return nachher!;
}
