import type { InferRequestType } from "hono/client";
import type { BerichteBereich, BerichteIntern } from "@carraway/api/berichte-vertrag";
import { ApiFehler, auspacken, ladeMitSitzung } from "./client";

type Antwort = { ok: boolean; status: number; json(): Promise<unknown>; headers?: Headers };
export type BerichteEingabe<B extends BerichteBereich, F extends (...args: never[]) => unknown> = BerichteIntern<B, InferRequestType<F>>;

export function ausBerichteBereich<B extends BerichteBereich>(bereich: B) {
  return async <F extends (...args: never[]) => Promise<Antwort>>(
    aufruf: F,
    ...teile: [] extends Parameters<F> ? [BerichteIntern<B, Parameters<F>[0]>?] : [BerichteIntern<B, Parameters<F>[0]>]
  ) => {
    const vertrag = await import("@carraway/api/berichte-vertrag");
    try {
      const anfrage = aufruf as unknown as (eingabe: unknown) => Promise<Awaited<ReturnType<F>>>;
      return vertrag.berichtVonApi(bereich, await auspacken(anfrage(vertrag.berichtAnApi(bereich, teile[0]))));
    } catch (fehler) {
      if (!(fehler instanceof ApiFehler)) throw fehler;
      throw zurueckUebersetzterFehler(bereich, fehler, vertrag);
    }
  };
}

function zurueckUebersetzterFehler(
  bereich: BerichteBereich,
  fehler: ApiFehler,
  vertrag: typeof import("@carraway/api/berichte-vertrag"),
) {
  return new ApiFehler(fehler.code, fehler.status, fehler.message, {
    felder: fehler.felder.map((f) => ({ ...f, feld: vertrag.berichtFeldpfadVonApi(bereich, f.feld) })),
    zusatz: vertrag.berichtVonApi(bereich, fehler.zusatz),
    wartenSekunden: fehler.wartenSekunden,
  });
}

export function bereichAbruf<B extends BerichteBereich>(bereich: B, pfad: string, methode: string, koerper?: unknown) {
  return ausBerichteBereich(bereich)(async () => {
    const form = koerper instanceof FormData;
    const vertrag = await import("@carraway/api/berichte-vertrag");
    return ladeMitSitzung(`${window.location.origin}/api/v1${pfad}`, {
      method: methode,
      ...(form ? { body: koerper } : {
        headers: { "Content-Type": "application/json" },
        ...(koerper === undefined ? {} : { body: JSON.stringify(vertrag.berichtAnApi(bereich, koerper)) }),
      }),
    });
  });
}
