import type { UebernahmeFeld } from "./typen";

/**
 * Abgleich von Registerdaten mit den Stammdaten einer Organisation (reine Funktionen). Ergebnis sind Befunde mit stabilen Codes;
 * die Oberfläche übersetzt sie und bietet je Feld „übernehmen“ an. Nichts wird automatisch geändert.
 */

export interface Stammdaten {
  name: string;
  ort: string | null;
  rechtsform: string | null;
  /** Namen der Personen mit Rolle Geschäftsführung (aktiv zum Stichtag), „Vorname Nachname“. */
  geschaeftsfuehrung: string[];
}

export interface Registerstand {
  firma: string;
  sitz: string | null;
  rechtsform: string | null;
  vertretung: { name: string; funktion: string }[];
}

export type BefundCode = "FIRMA_ABWEICHEND" | "SITZ_ABWEICHEND" | "SITZ_FEHLT_IM_CRM" | "RECHTSFORM_ABWEICHEND" | "RECHTSFORM_FEHLT_IM_CRM" | "GESCHAEFTSFUEHRUNG_ABWEICHEND";

export interface Abweichung {
  feld: UebernahmeFeld;
  code: BefundCode;
  crm: string | null;
  register: string | null;
  /** Nur bei `geschaeftsfuehrung`: im Register, aber nicht im CRM, und umgekehrt. */
  fehltImCrm?: string[];
  nichtImRegister?: string[];
}

const RECHTSFORMEN = /\s+(gmbh\s*&\s*co\.?\s*kg|ug\s*\(haftungsbeschr(?:ä|ae)nkt\)|gmbh|ag|se|kg|ohg|gbr|ug|e\.?\s?k\.?|e\.?\s?v\.?|e\.?\s?g\.?|ggmbh)\s*$/i;

/** Vergleichsform: klein, ohne Umlaute und Satzzeichen, einfache Leerzeichen. */
export function normalisiere(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ohneRechtsform = (firma: string) => normalisiere(firma.replace(RECHTSFORMEN, ""));

/** „Nachname, Vorname“ und „Vorname Nachname“ gleich; Titel entfallen. */
export function personenSchluessel(name: string): string {
  const [vorne, hinten] = name.includes(",") ? name.split(",", 2) : [name, ""];
  const teile = (hinten ? `${hinten} ${vorne}` : vorne!).split(/\s+/).filter((t) => !/^(dr|prof|dipl|ing|mag|med|rer|nat|h|c)\.?$/i.test(t.replace(/[.-]/g, "")) || t.length > 3);
  return normalisiere(teile.join(" "));
}

const istLeitung = (funktion: string) => /(gesch(?:ä|ae)ftsf|vorstand|inhaber)/i.test(funktion);

export function vergleiche(stamm: Stammdaten, register: Registerstand): Abweichung[] {
  const befunde: Abweichung[] = [];
  if (ohneRechtsform(stamm.name) !== ohneRechtsform(register.firma)) {
    befunde.push({ feld: "firma", code: "FIRMA_ABWEICHEND", crm: stamm.name, register: register.firma });
  }
  if (register.sitz) {
    if (!stamm.ort) befunde.push({ feld: "sitz", code: "SITZ_FEHLT_IM_CRM", crm: null, register: register.sitz });
    else if (normalisiere(stamm.ort) !== normalisiere(register.sitz)) befunde.push({ feld: "sitz", code: "SITZ_ABWEICHEND", crm: stamm.ort, register: register.sitz });
  }
  if (register.rechtsform) {
    const norm = (t: string) => normalisiere(t).replaceAll(" ", "");
    if (!stamm.rechtsform) befunde.push({ feld: "rechtsform", code: "RECHTSFORM_FEHLT_IM_CRM", crm: null, register: register.rechtsform });
    else if (norm(stamm.rechtsform) !== norm(register.rechtsform)) befunde.push({ feld: "rechtsform", code: "RECHTSFORM_ABWEICHEND", crm: stamm.rechtsform, register: register.rechtsform });
  }
  const imRegister = register.vertretung.filter((v) => istLeitung(v.funktion)).map((v) => v.name);
  const regSchluessel = new Set(imRegister.map(personenSchluessel));
  const crmSchluessel = new Set(stamm.geschaeftsfuehrung.map(personenSchluessel));
  const fehltImCrm = imRegister.filter((n) => !crmSchluessel.has(personenSchluessel(n)));
  const nichtImRegister = stamm.geschaeftsfuehrung.filter((n) => !regSchluessel.has(personenSchluessel(n)));
  if (imRegister.length > 0 && (fehltImCrm.length > 0 || nichtImRegister.length > 0)) {
    befunde.push({ feld: "geschaeftsfuehrung", code: "GESCHAEFTSFUEHRUNG_ABWEICHEND", crm: stamm.geschaeftsfuehrung.join(", ") || null, register: imRegister.join(", "), fehltImCrm, nichtImRegister });
  }
  return befunde;
}

/** Zerlegt einen Registernamen in Vor- und Nachname („Nachname, Vorname“ oder „Vorname Nachname“). */
export function zerlegeName(name: string): { vorname: string; nachname: string } {
  if (name.includes(",")) {
    const [nach, vor] = name.split(",", 2).map((t) => t.trim());
    return { vorname: vor || "–", nachname: nach || name.trim() };
  }
  const teile = name.trim().split(/\s+/);
  const nachname = teile.pop() ?? name.trim();
  return { vorname: teile.join(" ") || "–", nachname };
}
