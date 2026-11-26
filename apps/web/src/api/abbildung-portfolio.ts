import type { InferRequestType } from "hono/client";
import type { PortfolioIntern } from "@carraway/api/portfolio-vertrag";
import { ApiFehler, auspacken } from "./client";

export type PortfolioEingabe<F extends (...args: never[]) => unknown> = PortfolioIntern<InferRequestType<F>>;

type Antwort = { ok: boolean; status: number; json(): Promise<unknown>; headers?: Headers };

export async function auspackenPortfolio<F extends (...args: never[]) => Promise<Antwort>>(
  aufruf: F,
  ...teile: [] extends Parameters<F> ? [PortfolioIntern<Parameters<F>[0]>?] : [PortfolioIntern<Parameters<F>[0]>]
) {
  const { portfolioAnApi, portfolioVonApi, portfolioFeldVonApi } = await import("@carraway/api/portfolio-vertrag");
  try {
    const anfrage = aufruf as unknown as (eingabe: unknown) => Promise<Awaited<ReturnType<F>>>;
    return portfolioVonApi(await auspacken<Awaited<ReturnType<F>>>(anfrage(portfolioAnApi(teile[0]))));
  } catch (fehler) {
    if (!(fehler instanceof ApiFehler)) throw fehler;
    throw new ApiFehler(fehler.code, fehler.status, fehler.message, {
      felder: fehler.felder.map((f) => ({ ...f, feld: f.feld.split(".").map(portfolioFeldVonApi).join(".") })),
      zusatz: portfolioVonApi(fehler.zusatz),
      wartenSekunden: fehler.wartenSekunden,
    });
  }
}
