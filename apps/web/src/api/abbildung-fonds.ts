import type { InferRequestType } from "hono/client";
import type { FondsIntern } from "@carraway/api/fonds-vertrag";
import { ApiFehler, auspacken } from "./client";

export type FondsEingabe<F extends (...args: never[]) => unknown> = FondsIntern<InferRequestType<F>>;

type Antwort = { ok: boolean; status: number; json(): Promise<unknown>; headers?: Headers };

export async function ausFonds<F extends (...args: never[]) => Promise<Antwort>>(
  aufruf: F,
  ...teile: [] extends Parameters<F> ? [FondsIntern<Parameters<F>[0]>?] : [FondsIntern<Parameters<F>[0]>]
) {
  const { fondsAnApi, fondsVonApi, fondsFeldVonApi } = await import("@carraway/api/fonds-vertrag");
  const eingabe = teile[0];
  const anfrage = fondsAnApi(eingabe);
  if (anfrage && typeof anfrage === "object" && "query" in anfrage) {
    const query = anfrage.query;
    if (query && typeof query === "object" && "entryType" in query && typeof query.entryType === "string") {
      const { journalTypenAnApi } = await import("@carraway/api/journal-vertrag");
      query.entryType = journalTypenAnApi(query.entryType);
    }
  }
  try {
    const sende = aufruf as unknown as (eingabe: unknown) => Promise<Awaited<ReturnType<F>>>;
    return fondsVonApi(await auspacken<Awaited<ReturnType<F>>>(sende(anfrage)));
  } catch (fehler) {
    if (!(fehler instanceof ApiFehler)) throw fehler;
    throw new ApiFehler(fehler.code, fehler.status, fehler.message, {
      felder: fehler.felder.map((f) => ({ ...f, feld: f.feld.split(".").map(fondsFeldVonApi).join(".") })),
      zusatz: fondsVonApi(fehler.zusatz),
      wartenSekunden: fehler.wartenSekunden,
    });
  }
}
