import { berichteBereichDe } from "./bereich.berichte";
import { crmBereichDe } from "./bereich.crm";
import { crmFehlerDe } from "./fehler.crm";
import { instrumenteBereichDe } from "./bereich.instrumente";
import { journalBereichDe } from "./bereich.journal";
import { kontaktimportBereichDe } from "./bereich.kontaktimport";
import { rundenBereichDe } from "./bereich.runden";
import { zusatzBereichDe } from "./bereich.zusatz";
import { waehrungBereichDe } from "./bereich.waehrung";
import { kontoBereichDe } from "./bereich.konto";
import { stammBereichDe } from "./bereich.stamm";
import { buchhaltungDe, buchhaltungFehlerDe } from "./buchhaltung";
import { datenuebernahmeDe } from "./datenuebernahme";
import { dokumenteDe, dokumenteFehlerDe } from "./dokumente";
import { fondsStammDe } from "./bereich.fonds-stamm";
import { fehlertexteDe } from "./fehlertexte";
import { kennzahlenDe } from "./kennzahlen";
import { kernDe } from "./kern.de";
import { mailDe } from "./mail";
import { meldeDe } from "./melde";
import { registerDe, registerFehlerDe } from "./register";
import { szenarienDe, szenarienFehlerDe } from "./szenarien";
import { waehrungFehlerDe } from "./fehler.waehrung";
import { verwaltungDe } from "./verwaltung";

/**
 * Alle Texte der Oberfläche in Deutsch, zusammengesetzt aus dem Rahmen (`kern.de.ts`) und den Bereichen (`bereiche.ts`). Die Anwendung lädt dieses Ganze nie:
 * Sie liest den Rahmen beim Start und die Bereiche mit der Seite, die sie braucht. Der Verbund dient dem Typ `Texte` (die Form, die `en` erfüllen muss)
 * und den Tests, die beide Sprachen vollständig brauchen.
 */
export const de = {
  ...kernDe,
  fehler: { ...crmFehlerDe, ...buchhaltungFehlerDe, ...kernDe.fehler, ...fehlertexteDe, ...dokumenteFehlerDe, ...mailDe.fehler, ...registerFehlerDe, ...szenarienFehlerDe, ...waehrungFehlerDe },
  ...berichteBereichDe,
  ...rundenBereichDe,
  ...instrumenteBereichDe,
  ...kontaktimportBereichDe,
  ...journalBereichDe,
  ...stammBereichDe,
  ...kontoBereichDe,
  ...crmBereichDe,
  ...zusatzBereichDe,
  ...waehrungBereichDe,
  datenuebernahme: datenuebernahmeDe,
  kennzahlen: kennzahlenDe,
  dokumente: dokumenteDe,
  buchhaltung: buchhaltungDe,
  melde: meldeDe,
  fondsStamm: fondsStammDe,
  mail: mailDe,
  register: registerDe,
  szenarien: szenarienDe,
  verwaltung: verwaltungDe,
};

export type Texte = typeof de;
