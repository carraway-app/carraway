import type { Texte } from "./de";
import { berichteBereichEn } from "./bereich.berichte.en";
import { crmBereichEn } from "./bereich.crm.en";
import { crmFehlerEn } from "./fehler.crm.en";
import { instrumenteBereichEn } from "./bereich.instrumente.en";
import { journalBereichEn } from "./bereich.journal.en";
import { kontaktimportBereichEn } from "./bereich.kontaktimport.en";
import { rundenBereichEn } from "./bereich.runden.en";
import { zusatzBereichEn } from "./bereich.zusatz.en";
import { waehrungBereichEn } from "./bereich.waehrung.en";
import { kontoBereichEn } from "./bereich.konto.en";
import { stammBereichEn } from "./bereich.stamm.en";
import { buchhaltungEn, buchhaltungFehlerEn } from "./buchhaltung.en";
import { datenuebernahmeEn } from "./datenuebernahme.en";
import { dokumenteEn, dokumenteFehlerEn } from "./dokumente.en";
import { fondsStammEn } from "./bereich.fonds-stamm.en";
import { fehlertexteEn } from "./fehlertexte.en";
import { kennzahlenEn } from "./kennzahlen.en";
import { kernEn } from "./kern.en";
import { mailEn } from "./mail.en";
import { meldeEn } from "./melde.en";
import { registerEn, registerFehlerEn } from "./register.en";
import { szenarienEn, szenarienFehlerEn } from "./szenarien.en";
import { waehrungFehlerEn } from "./fehler.waehrung.en";
import { verwaltungEn } from "./verwaltung.en";

/** Britisches Englisch, zusammengesetzt wie `de.ts`. Der Typ erzwingt dieselben Schlüssel. */
export const en: Texte = {
  ...kernEn,
  fehler: { ...crmFehlerEn, ...buchhaltungFehlerEn, ...kernEn.fehler, ...fehlertexteEn, ...dokumenteFehlerEn, ...mailEn.fehler, ...registerFehlerEn, ...szenarienFehlerEn, ...waehrungFehlerEn },
  ...berichteBereichEn,
  ...rundenBereichEn,
  ...instrumenteBereichEn,
  ...kontaktimportBereichEn,
  ...journalBereichEn,
  ...stammBereichEn,
  ...kontoBereichEn,
  ...crmBereichEn,
  ...zusatzBereichEn,
  ...waehrungBereichEn,
  datenuebernahme: datenuebernahmeEn,
  kennzahlen: kennzahlenEn,
  dokumente: dokumenteEn,
  buchhaltung: buchhaltungEn,
  melde: meldeEn,
  fondsStamm: fondsStammEn,
  mail: mailEn,
  register: registerEn,
  szenarien: szenarienEn,
  verwaltung: verwaltungEn,
};
