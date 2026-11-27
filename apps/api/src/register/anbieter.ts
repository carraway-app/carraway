import { readFileSync } from "node:fs";
import { z } from "zod";
import { eintragWerte, ereignisWerte, REGISTERARTEN, type EintragWerte, type EreignisWerte } from "./typen";

/**
 * Schnittstelle zu einer Quelle für Registerdaten. Carraway ruft Registerportale nicht automatisiert ab (siehe `docs/register/access.md`);
 * ein Anbieter ist eine lizenzierte Schnittstelle, die ein Betreiber ausdrücklich einrichtet. Der Testanbieter nutzt diese Schnittstelle, authentifizierte Adapter registrieren sich unter data-providers/.
 */

export interface RegisterReferenz {
  gericht: string;
  registerart: (typeof REGISTERARTEN)[number];
  nummer: string;
}

export interface RegisterTreffer extends RegisterReferenz {
  firma: string;
  sitz?: string | null;
  rechtsform?: string | null;
}

export interface RegisterAbruf {
  eintrag: EintragWerte;
  ereignisse: EreignisWerte[];
}

export interface RegisterAnbieter {
  /** Kurzname für die Quelle (`anbieter:<name>`): Kleinbuchstaben, Ziffern, `_` und `-`. */
  readonly name: string;
  suche(frage: { firma?: string; nummer?: string }): Promise<RegisterTreffer[]>;
  abruf(referenz: RegisterReferenz): Promise<RegisterAbruf | null>;
}

export const schluesselVon = (r: RegisterReferenz) => `${r.gericht}|${r.registerart}|${r.nummer}`;

/** Testanbieter: liefert feste Daten aus dem Speicher (Tests) oder aus einer JSON-Datei (Demo). Kein Netzwerk. */
export class TestAnbieter implements RegisterAnbieter {
  readonly name = "test";
  /** Anzahl der Abrufe, für Tests der Begrenzung. */
  abrufe = 0;
  constructor(private readonly daten: Map<string, RegisterAbruf>) {}

  static ausDatei(pfad: string): TestAnbieter {
    const roh: unknown = JSON.parse(readFileSync(pfad, "utf8"));
    const schema = z.record(z.string(), z.object({ eintrag: eintragWerte, ereignisse: z.array(ereignisWerte).default([]) }));
    return new TestAnbieter(new Map(Object.entries(schema.parse(roh))));
  }

  setze(abruf: RegisterAbruf): void {
    this.daten.set(schluesselVon(abruf.eintrag), abruf);
  }

  async suche(frage: { firma?: string; nummer?: string }): Promise<RegisterTreffer[]> {
    const f = frage.firma?.toLowerCase();
    return [...this.daten.values()]
      .filter((d) => (f ? d.eintrag.firma.toLowerCase().includes(f) : true) && (frage.nummer ? d.eintrag.nummer === frage.nummer : true))
      .map((d) => ({ gericht: d.eintrag.gericht, registerart: d.eintrag.registerart, nummer: d.eintrag.nummer, firma: d.eintrag.firma, sitz: d.eintrag.sitz ?? null, rechtsform: d.eintrag.rechtsform ?? null }));
  }

  async abruf(referenz: RegisterReferenz): Promise<RegisterAbruf | null> {
    this.abrufe++;
    return this.daten.get(schluesselVon(referenz)) ?? null;
  }
}

/** Anbieter aus der Umgebung: `REGISTER_ANBIETER=test` mit `REGISTER_TESTDATEI`; ohne Angabe gibt es keinen Anbieter. */
export function erstelleRegisterAnbieter(umgebung: NodeJS.ProcessEnv = process.env): RegisterAnbieter | null {
  if (umgebung.REGISTER_ANBIETER === "test") return umgebung.REGISTER_TESTDATEI ? TestAnbieter.ausDatei(umgebung.REGISTER_TESTDATEI) : new TestAnbieter(new Map());
  return null;
}
