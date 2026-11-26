import { sql } from "drizzle-orm";
import { Decimal, WAEHRUNGSCODE, bewertungNachMethode, bewertungsszenario, faktorAlsZahl, unternehmenswertNachMethode, wasserfall, type BwFondsWerte, type MethodeEingabe } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import type { FondsUebersicht } from "../kennzahlen/fonds";
import { standardSicht } from "../kapital/sicht";
import { kernEingabe, ladeKapital } from "../kapital/wasserfall";
import { kursFuer } from "../waehrung/kurse";
import type { Tx } from "../zeitlimit";
import type { BewertungsAnnahmen } from "./annahmen";

/**
 * Bewertungsszenarien (Etappe 21): Aus den Annahmen je Beteiligung (Fälle mit Wahrscheinlichkeit und Methode) und dem Stand zum Basistag entsteht je Fall der Wert, daraus
 * der Erwartungswert und die Wirkung auf den Fonds. Gerechnet wird im Rechenkern (`bewertungsszenario.ts`, mit unabhängiger Referenz); hier werden die Eingaben
 * beschafft: Kennzahl des Unternehmens (zuletzt bestätigter Ist-Wert bis zum Basistag), Anteile des Fonds und Preis der letzten Runde aus der Kapitaltabelle.
 * Fehlt eine Eingabe, hat der Fall keinen Wert (Lücke mit Befund), nie null oder ein Näherungswert. Alle Beträge sind in Fondswährung.
 *
 * Währung der Kennzahl (Nacharbeiten 9): Ist die Kennzahl ein Betrag mit einem Währungscode als Einheit, der von der Fondswährung abweicht, wird der Unternehmenswert
 * (Kennzahl × Multiple − Abzug, beides in der Währung der Kennzahl) mit dem Kurs des Basistags in die Fondswährung umgerechnet (Kurstabelle, Wissensstand beachtet,
 * höchstens sieben Tage alt); fehlt der Kurs, hat der Fall keinen Wert (Befund `BEWERTUNG_KURS_FEHLT`).
 *
 * Exit-Wasserfall (Nacharbeiten 9): Zu jedem Fall mit einem Unternehmenswert (Multiple, letzte Runde) und einer Kapitaltabelle des Unternehmens mit Positionen des Fonds
 * steht der Erlös des Fonds aus dem Exit-Wasserfall zum Basistag daneben (derselbe Wasserfall wie in Prognose und Beteiligung, keine zweite Rechnung). Er ändert weder den
 * Wert des Falls noch die Fondskennzahlen; er zeigt, was Vorzugsrechte gegenüber dem reinen Anteil ausmachen. Ohne Exit-Kosten, zum Basistag als Exit-Datum.
 */

export type BewertungsBefundCode = "BEWERTUNG_KURS_FEHLT" | "BEWERTUNG_KENNZAHL_FEHLT" | "BEWERTUNG_RUNDE_FEHLT" | "BEWERTUNG_ANTEIL_FEHLT" | "BEWERTUNG_OHNE_AKTUELLEN_WERT" | "BEWERTUNG_FALL_FEHLT";

export interface BewertungsBefund {
  code: BewertungsBefundCode;
  schwere: "hinweis" | "warnung";
  beteiligungId?: string;
  params?: Record<string, string | number>;
}

export interface BewertungsFallErgebnis {
  schluessel: string;
  name: string | null;
  gewicht: string;
  methode: "multiple" | "letzte_runde" | "wert";
  /** Wert in Fondswährung; `null` = Lücke. */
  wert: string | null;
  abweichung: string | null;
  /** Die Eingaben, aus denen der Wert entstand (für den Rechenweg); `null` = fehlte. */
  eingaben: Record<string, string | null>;
  /**
   * Erlös des Fonds aus dem Exit-Wasserfall, wenn der Fall einen Unternehmenswert hat (Multiple, letzte Runde); sonst `null`. `erloesFonds` ist `null`, wenn das Unternehmen
   * keine Kapitaltabelle mit Positionen des Fonds hat (`grund`). `unterschied` = Erlös laut Wasserfall − Wert des Falls.
   */
  exit: { unternehmenswert: string; erloesFonds: string | null; grund: "keine_kapitaltabelle" | null; unterschied: string | null; beteiligungenDesFonds: number } | null;
}

export interface BewertungsszenarioErgebnis {
  waehrung: string;
  carrySatz: string;
  beteiligungen: { id: string; name: string; aktuell: string; faelle: BewertungsFallErgebnis[]; erwartet: string | null; abweichung: string | null; erwartetErloes: string | null }[];
  aktuell: BwFondsWerte;
  faelle: ({ schluessel: string; name: string | null } & BwFondsWerte)[];
  erwartet: BwFondsWerte;
  befunde: BewertungsBefund[];
}

const ungueltig = (meldung: string, zusatz: Record<string, unknown> = {}) => new Fachfehler(422, "scenario_assumptions_invalid", meldung, zusatz);

/**
 * Zuletzt bestätigter Ist-Wert einer Kennzahl bis zum Basistag (Wissensstand beachtet); `null`, wenn es keinen gibt oder er keine Zahl ist. `waehrung` ist der Code der
 * Währung, wenn die Kennzahl ein Betrag mit einem Währungscode als Einheit ist, sonst `null` (die Kennzahl gilt dann in Fondswährung).
 */
async function kennzahlWert(tx: Tx, beteiligungId: string, schluessel: string, basis: string, stand: string | undefined): Promise<{ wert: string; waehrung: string | null } | null> {
  const { rows } = await tx.execute<{ wert: string; typ: string; einheit: string }>(sql`
    SELECT kw.wert, kd.typ::text AS typ, kd.einheit FROM kennzahl_wert kw JOIN kennzahl_definition kd ON kd.id = kw.definition_id
    WHERE kw.beteiligung_id = ${beteiligungId} AND kd.schluessel = ${schluessel} AND kw.szenario = 'ist' AND kw.status = 'bestaetigt' AND kw.periode_ende <= ${basis}::date
      ${stand === undefined ? sql`` : sql` AND kw.bestaetigt_am <= ${stand}::timestamptz`}
    ORDER BY kw.periode_ende DESC, kw.bestaetigt_am DESC, kw.folge DESC LIMIT 1`);
  const zeile = rows[0];
  if (zeile === undefined || !/^-?\d{1,18}(\.\d{1,6})?$/.test(zeile.wert)) return null;
  return { wert: zeile.wert, waehrung: zeile.typ === "betrag" && WAEHRUNGSCODE.test(zeile.einheit) ? zeile.einheit : null };
}

export async function rechneBewertungsszenario(
  tx: Tx,
  fondsId: string,
  basis: string,
  annahmen: BewertungsAnnahmen,
  ue: FondsUebersicht,
  carrySatz: string,
  stand: string | undefined,
): Promise<BewertungsszenarioErgebnis> {
  const befunde: BewertungsBefund[] = [];
  const fondsWaehrung = (await tx.execute<{ waehrung: string }>(sql`SELECT waehrung FROM fonds WHERE id = ${fondsId}`)).rows[0]?.waehrung ?? "EUR";
  const eintraege: { id: string; name: string; aktuell: string; faelle: { schluessel: string; name: string | null; gewicht: string; methode: MethodeEingabe; eingaben: Record<string, string | null>; exit: BewertungsFallErgebnis["exit"] }[] }[] = [];

  for (const [id, a] of Object.entries(annahmen.beteiligungen)) {
    const b = ue.beteiligungen.find((x) => x.id === id);
    if (!b) throw ungueltig("A valuation scenario names an investment that does not exist in this fund on the base date.", { feld: `bewertung.beteiligungen.${id}`, beteiligungId: id });
    if (b.status !== "aktiv") throw ungueltig("A valuation scenario is only possible for active investments.", { feld: `bewertung.beteiligungen.${id}`, beteiligungId: id, status: b.status });
    if (!b.letzteBewertung) befunde.push({ code: "BEWERTUNG_OHNE_AKTUELLEN_WERT", schwere: "warnung", beteiligungId: id });

    const kapital = a.faelle.some((f) => f.methode.art !== "wert") ? await ladeKapital(tx, { fondsId, organisationId: b.organisation.id }, basis) : null;
    const fondsAnteile = kapital ? kapital.zeilen.filter((z) => z.diesesFonds).reduce((s, z) => s.plus(z.anteile), new Decimal(0)) : new Decimal(0);
    // Bezugsgröße für den abgeleiteten Anteil und den Unternehmenswert: die Standard-Sicht der Installation (voll verwässert mit Pool oder unverwässert).
    const sicht = standardSicht();
    const gesamt = kapital ? new Decimal(sicht === "voll_verwaessert" ? kapital.anteileVollVerwaessert : kapital.anteileGesamt) : new Decimal(0);
    const abgeleiteterAnteil = fondsAnteile.greaterThan(0) && gesamt.greaterThan(0) ? fondsAnteile.div(gesamt).toDecimalPlaces(12, Decimal.ROUND_HALF_UP).toFixed() : null;

    const faelle: (typeof eintraege)[number]["faelle"] = [];
    for (const f of a.faelle) {
      const m = f.methode;
      let methode: MethodeEingabe;
      let eingaben: Record<string, string | null>;
      if (m.art === "wert") {
        methode = { art: "wert", betrag: m.betrag };
        eingaben = { betrag: m.betrag };
      } else if (m.art === "letzte_runde") {
        const preis = kapital?.letzteRunde?.preisJeAnteil ?? null;
        const anteile = fondsAnteile.greaterThan(0) ? fondsAnteile.toFixed() : null;
        if (preis === null) befunde.push({ code: "BEWERTUNG_RUNDE_FEHLT", schwere: "warnung", beteiligungId: id, params: { fall: f.schluessel } });
        else if (anteile === null) befunde.push({ code: "BEWERTUNG_ANTEIL_FEHLT", schwere: "warnung", beteiligungId: id, params: { fall: f.schluessel } });
        methode = { art: "letzte_runde", preisJeAnteil: preis, anteile, abschlag: m.abschlag, anteileGesamt: gesamt.greaterThan(0) ? gesamt.toFixed() : null };
        eingaben = { preisJeAnteil: preis, anteile, abschlag: m.abschlag, runde: kapital?.letzteRunde?.bezeichnung ?? null, anteilBasis: sicht };
      } else {
        const k = await kennzahlWert(tx, id, m.kennzahl, basis, stand);
        const kz = k?.wert ?? null;
        const anteil = m.anteil ?? abgeleiteterAnteil;
        // Kennzahl in Fremdwährung: Umrechnung zum Kurs des Basistags; fehlt der Kurs, ist der Fall eine Lücke (nie ein geschätzter Kurs).
        let umrechnung: { zaehler: string; nenner: string } | null | undefined;
        let kurs: string | null = null;
        let kursDatum: string | null = null;
        if (k?.waehrung && k.waehrung !== fondsWaehrung) {
          const w = await kursFuer(tx, k.waehrung, fondsWaehrung, basis, stand);
          if (w.ok) {
            umrechnung = { zaehler: w.faktor.zaehler.toFixed(), nenner: w.faktor.nenner.toFixed() };
            kurs = faktorAlsZahl(w.faktor, 8);
            kursDatum = w.faktor.kursDatum;
          } else {
            umrechnung = null;
            befunde.push({ code: "BEWERTUNG_KURS_FEHLT", schwere: "warnung", beteiligungId: id, params: { fall: f.schluessel, von: w.luecke.von, nach: w.luecke.nach, stichtag: basis, grund: w.luecke.grund === "veraltet" ? `letzter Kurs vom ${w.luecke.letzterKursDatum}` : "kein Kurs" } });
          }
        }
        if (kz === null) befunde.push({ code: "BEWERTUNG_KENNZAHL_FEHLT", schwere: "warnung", beteiligungId: id, params: { fall: f.schluessel, kennzahl: m.kennzahl } });
        else if (anteil === null) befunde.push({ code: "BEWERTUNG_ANTEIL_FEHLT", schwere: "warnung", beteiligungId: id, params: { fall: f.schluessel } });
        methode = { art: "multiple", kennzahlWert: kz, multiple: m.multiple, abzug: m.abzug, anteil, ...(umrechnung !== undefined ? { umrechnung } : {}) };
        eingaben = {
          kennzahl: m.kennzahl,
          kennzahlWert: kz,
          multiple: m.multiple,
          abzug: m.abzug,
          anteil,
          anteilQuelle: m.anteil !== undefined ? "angegeben" : abgeleiteterAnteil !== null ? "kapitaltabelle" : null,
          ...(m.anteil === undefined && abgeleiteterAnteil !== null ? { anteilBasis: sicht } : {}),
          ...(k?.waehrung && k.waehrung !== fondsWaehrung ? { kennzahlWaehrung: k.waehrung, kurs, kursDatum } : {}),
        };
      }
      // Exit-Wasserfall: Unternehmenswert des Falls, Erlös des Fonds aus der Kapitaltabelle (dieselbe Funktion wie in der Prognose).
      const unternehmenswert = unternehmenswertNachMethode(methode);
      let exit: BewertungsFallErgebnis["exit"] = null;
      if (unternehmenswert !== null) {
        const eigene = kapital ? new Set(kapital.zeilen.filter((z) => z.diesesFonds).map((z) => z.id)) : new Set<string>();
        const eigeneBeteiligungen = ue.beteiligungen.filter((x) => x.status === "aktiv" && x.organisation.id === b.organisation.id).length;
        if (kapital && eigene.size > 0) {
          const k = kernEingabe(kapital);
          const zeilen = wasserfall({ exitwert: unternehmenswert, exitdatum: basis, klassen: k.klassen, inhaber: k.inhaber }).wert.zeilen;
          const erloes = zeilen.filter((z) => eigene.has(z.id)).reduce((s, z) => s.plus(z.gesamt), new Decimal(0)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
          const fallWert = bewertungNachMethode(methode);
          exit = { unternehmenswert: unternehmenswert.toFixed(2), erloesFonds: erloes.toFixed(2), grund: null, unterschied: fallWert === null ? null : erloes.minus(fallWert).toFixed(2), beteiligungenDesFonds: eigeneBeteiligungen };
        } else exit = { unternehmenswert: unternehmenswert.toFixed(2), erloesFonds: null, grund: "keine_kapitaltabelle", unterschied: null, beteiligungenDesFonds: eigeneBeteiligungen };
      }
      faelle.push({ schluessel: f.schluessel, name: f.name ?? null, gewicht: f.gewicht, methode, eingaben, exit });
    }
    eintraege.push({ id, name: b.organisation.name, aktuell: b.letzteBewertung?.wert ?? "0", faelle });
  }

  // Fälle, die nur einige Beteiligungen haben: die übrigen behalten ihren aktuellen Wert (Hinweis).
  const alleSchluessel = [...new Set(eintraege.flatMap((e) => e.faelle.map((f) => f.schluessel)))];
  for (const e of eintraege) for (const k of alleSchluessel) if (!e.faelle.some((f) => f.schluessel === k)) befunde.push({ code: "BEWERTUNG_FALL_FEHLT", schwere: "hinweis", beteiligungId: e.id, params: { fall: k } });

  const kern = bewertungsszenario({
    nav: ue.kennzahlen.nav.wert,
    ausschuettungen: ue.kennzahlen.ausschuettungen.wert ?? "0",
    eingezahlt: ue.kennzahlen.eingezahlt.wert ?? "0",
    abgerufen: ue.kennzahlen.abgerufen.wert ?? "0",
    carrySatz,
    beteiligungen: eintraege.map((e) => ({ id: e.id, aktuell: e.aktuell, faelle: e.faelle.map((f) => ({ schluessel: f.schluessel, gewicht: f.gewicht, wert: bewertungNachMethode(f.methode)?.toFixed(2) ?? null })) })),
  });
  const namenJeSchluessel = new Map(eintraege.flatMap((e) => e.faelle.filter((f) => f.name).map((f) => [f.schluessel, f.name!] as const)));
  return {
    waehrung: fondsWaehrung,
    carrySatz,
    beteiligungen: kern.beteiligungen.map((k) => {
      const e = eintraege.find((x) => x.id === k.id)!;
      return {
        id: k.id,
        name: e.name,
        aktuell: k.aktuell,
        faelle: k.faelle.map((f) => {
          const quelle = e.faelle.find((x) => x.schluessel === f.schluessel)!;
          return { schluessel: f.schluessel, name: quelle.name, gewicht: f.gewicht, methode: quelle.methode.art, wert: f.wert, abweichung: f.abweichung, eingaben: quelle.eingaben, exit: quelle.exit };
        }),
        erwartet: k.erwartet,
        abweichung: k.abweichung,
        // Erwartungswert der Erlöse laut Wasserfall: nur, wenn jeder Fall einen Erlös hat (ein fester Wert hat keinen); sonst eine Lücke, nie aus einem Teil gebildet.
        erwartetErloes: e.faelle.length > 0 && e.faelle.every((x) => x.exit?.erloesFonds != null) ? e.faelle.reduce((s, x) => s.plus(new Decimal(x.exit!.erloesFonds!).times(x.gewicht)), new Decimal(0)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2) : null,
      };
    }),
    aktuell: kern.aktuell,
    faelle: kern.faelle.map((f) => ({ ...f, name: namenJeSchluessel.get(f.schluessel) ?? null })),
    erwartet: kern.erwartet,
    befunde,
  };
}
