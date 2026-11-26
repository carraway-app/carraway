import { feldpfad, insDeutsche, insEnglische } from "@carraway/api/buchhaltung/abbildung";
import { ApiFehler, auspacken } from "./client";

export async function buchhaltungsAufruf<R extends { ok: boolean; status: number; json(): Promise<unknown> }>(senden: (englisch: typeof insEnglische) => Promise<R>) {
  try {
    return insDeutsche(await auspacken(senden(insEnglische)));
  } catch (fehler) {
    if (!(fehler instanceof ApiFehler)) throw fehler;
    throw new ApiFehler(fehler.code, fehler.status, fehler.message, {
      felder: fehler.felder.map((f) => ({ ...f, feld: feldpfad(f.feld, false) })),
      zusatz: insDeutsche(fehler.zusatz),
      wartenSekunden: fehler.wartenSekunden,
    });
  }
}
