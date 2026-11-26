import type { Deutsch } from "@carraway/api/kontakte/api-namen";
import { ApiFehler, auspacken } from "./client";

export type { Deutsch } from "@carraway/api/kontakte/api-namen";

type Antwort = Parameters<typeof auspacken>[0] extends Promise<infer R> ? R : never;
type Eingabe<T> = T extends object ? { [K in keyof T]: K extends "param" | "query" | "json" ? Deutsch<T[K]> : T[K] } : T;
type Argumente<A extends unknown[]> = { [I in keyof A]: Eingabe<A[I]> };

/** Abbildung erst beim Aufruf laden. Die Hülle und das LP-Portal verwenden denselben HTTP-Client. */
async function sende<A extends unknown[], R>(
  aufruf: (...args: A) => Promise<R>,
  crm: boolean,
  teile: Argumente<NoInfer<A>>,
): Promise<R> {
  const [eingabe, ...optionen] = teile;
  if (!eingabe || typeof eingabe !== "object") return aufruf(...(teile as A));
  const { aufEnglisch } = await import("@carraway/api/kontakte/api-namen");
  const anfrage = Object.fromEntries(Object.entries(eingabe).map(([k, v]) => [k, k === "param" || k === "query" || k === "json" ? aufEnglisch(v, crm) : v]));
  return aufruf(...([anfrage, ...optionen] as A));
}

export function kontaktAbruf<A extends unknown[], R>(
  aufruf: (...args: A) => Promise<R>, ...teile: Argumente<NoInfer<A>>
): Promise<R> {
  return sende(aufruf, true, teile);
}

async function ausAntwort<R extends Antwort>(anfrage: Promise<R>, crm: boolean, gruppenfeld?: string) {
  const { aufDeutsch, deutscherFeldpfad } = await import("@carraway/api/kontakte/api-namen");
  try {
    return aufDeutsch(await auspacken(anfrage), crm, undefined, gruppenfeld);
  } catch (fehler) {
    if (fehler instanceof ApiFehler) {
      throw new ApiFehler(fehler.code, fehler.status, fehler.message, {
        felder: fehler.felder.map((feld) => ({ ...feld, feld: deutscherFeldpfad(feld.feld) })),
        zusatz: aufDeutsch(fehler.zusatz, crm),
        wartenSekunden: fehler.wartenSekunden,
      });
    }
    throw fehler;
  }
}

export function ausKontakten<A extends unknown[], R extends Antwort>(
  aufruf: (...args: A) => Promise<R>, ...teile: Argumente<NoInfer<A>>
) {
  return ausAntwort(sende(aufruf, false, teile), false);
}

export function ausCrm<A extends unknown[], R extends Antwort>(
  aufruf: (...args: A) => Promise<R>, ...teile: Argumente<NoInfer<A>>
) {
  const json = (teile[0] as { json?: { gruppe?: string } } | undefined)?.json;
  return ausAntwort(sende(aufruf, true, teile), true, json?.gruppe);
}

export function ausKontaktAntwort(anfrage: Promise<Response>) {
  return ausAntwort(anfrage, false);
}
