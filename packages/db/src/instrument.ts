import type { instrumentArt } from "./schema";

/** Vorgabe für die Bezeichnung eines Instruments aus seiner Art (deutsch, wie in der Datenmigration). */
export const INSTRUMENT_BEZEICHNUNG: Record<(typeof instrumentArt.enumValues)[number], string> = {
  offene_beteiligung: "Offene Beteiligung",
  stille_beteiligung: "Stille Beteiligung",
  darlehen: "Darlehen",
  wandeldarlehen: "Wandeldarlehen",
  venture_debt: "Venture Debt",
  gesellschafterdarlehen: "Gesellschafterdarlehen",
};
