/**
 * Mailvorlagen (Deutsch und britisches Englisch), je Vorlage Betreff, Text und einfaches HTML. Regeln:
 * - Keine Bilder, keine externen Dateien, keine Verfolgung: Links sind die Adresse selbst (kein Umweg über einen Weiterleitungsdienst).
 * - Das HTML entsteht aus denselben Teilen wie der Text; alle Werte werden maskiert.
 * - Mitteilungen aus dem LP-Portal nennen nur, dass etwas bereitliegt, nie Beträge und nie die Datei selbst.
 */

export type Sprache = "de" | "en";

export interface VorlagenParameter {
  testmail: Record<string, never>;
  kennzahl_abfrage: { unternehmen: string; periodeBeginn: string; periodeEnde: string; faelligAm: string; link: string; hinweis?: string | null };
  esg_abfrage: { unternehmen: string; jahr: string; faelligAm: string; link: string; hinweis?: string | null };
  lp_mitteilung: { fonds: string; art: "abruf" | "ausschuettung"; link: string };
  bericht_freigegeben: { bericht: string; fonds: string | null; link: string };
  /** Nur Unternehmensname, Art des Ereignisses und Link; kein Registerinhalt. */
  register_ereignis: { unternehmen: string; art: string; link: string };
  /** Link zum Setzen eines neuen Passworts; gilt einmal und nur kurz. Kein Hinweis darauf, ob zu der Adresse ein Konto besteht, außer in der Mail selbst. */
  passwort_zuruecksetzen: { link: string; gueltigMinuten: number };
  /** Einladung einer neuen Person: Link zum Festlegen des ersten Passworts; danach folgt die Einrichtung des zweiten Faktors. */
  einladung: { name: string; link: string; gueltigStunden: number };
}
export type Vorlage = keyof VorlagenParameter;
export const VORLAGEN: readonly Vorlage[] = ["testmail", "kennzahl_abfrage", "esg_abfrage", "lp_mitteilung", "bericht_freigegeben", "register_ereignis", "passwort_zuruecksetzen", "einladung"];

export interface Gerendert {
  betreff: string;
  text: string;
  html: string;
}

const maskiere = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Ohne Zeilenumbrüche in Betreffzeilen (Header-Injection) und auf eine sinnvolle Länge gekürzt. */
const einzeilig = (s: string, max = 120) => s.replace(/[\r\n]+/g, " ").trim().slice(0, max);

function datum(iso: string, sprache: Sprache): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return sprache === "de" ? `${m[3]}.${m[2]}.${m[1]}` : `${m[3]}/${m[2]}/${m[1]}`;
}

interface Teile {
  betreff: string;
  /** Absätze; ein Absatz ist Text mit optionalem Link (`{link}` wird eingesetzt). */
  absaetze: string[];
  link?: { adresse: string; beschriftung: string };
  fuss: string;
}

function baue(t: Teile): Gerendert {
  const text = [...t.absaetze, ...(t.link ? [`${t.link.beschriftung}: ${t.link.adresse}`] : []), "--", t.fuss].join("\n\n");
  const html = [
    `<!doctype html><html><head><meta charset="utf-8"><title>${maskiere(t.betreff)}</title></head>`,
    `<body style="font-family: 'Instrument Sans', Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.5; background-color: #ffffff; color: #18211d;">`,
    ...t.absaetze.map((a) => `<p>${maskiere(a)}</p>`),
    ...(t.link ? [`<p><a style="color:#096d69;" href="${maskiere(t.link.adresse)}">${maskiere(t.link.beschriftung)}</a></p>`, `<p style="color:#505e56;font-size:13px;">${maskiere(t.link.adresse)}</p>`] : []),
    `<hr style="border:none;border-top:1px solid #d3d9d3;"><p style="color:#505e56;font-size:13px;">${maskiere(t.fuss)}</p>`,
    `</body></html>`,
  ].join("\n");
  return { betreff: t.betreff, text, html };
}

const FUSS = {
  de: "Diese Nachricht wurde automatisch von Carraway versendet. Bitte nicht antworten.",
  en: "This message was sent automatically by Carraway. Please do not reply.",
};

/** Anzeigenamen der Registerereignisse (`register_ereignis_art`); unbekannte Arten erscheinen unverändert. */
const EREIGNIS_NAMEN: Record<string, [string, string]> = {
  neueintragung: ["Neueintragung", "New entry"],
  aenderung_geschaeftsfuehrung: ["Änderung der Geschäftsführung", "Change of management"],
  kapitalerhoehung: ["Kapitalerhöhung", "Capital increase"],
  sitzverlegung: ["Sitzverlegung", "Change of registered office"],
  insolvenz: ["Insolvenz", "Insolvency"],
  loeschung: ["Löschung", "Deletion"],
  sonstiges: ["Sonstiges", "Other"],
};

/** Anzeigenamen der Berichtsarten (`bericht_art`); unbekannte Arten erscheinen unverändert. */
const BERICHT_NAMEN: Record<string, [string, string]> = {
  fondsbericht: ["Fondsbericht", "Fund report"],
  quartalsbericht: ["Quartalsbericht", "Quarterly report"],
  lp_bericht: ["LP-Bericht", "LP report"],
  gremienvorlage: ["Gremienvorlage", "Committee paper"],
  portfolioliste: ["Portfolioliste", "Portfolio list"],
  exitliste: ["Exitliste", "Exit list"],
  pai_erklaerung: ["PAI-Erklärung", "PAI statement"],
  szenariobericht: ["Szenariobericht", "Scenario report"],
  meldelauf: ["Meldelauf", "Reporting run"],
  beleg: ["Beleg", "Voucher"],
};

type Bauer<V extends Vorlage> = (p: VorlagenParameter[V], sprache: Sprache) => Gerendert;

const TEXTE: { [V in Vorlage]: Bauer<V> } = {
  testmail: (_p, s) =>
    baue({
      betreff: s === "de" ? "Testmail von Carraway" : "Test mail from Carraway",
      absaetze: [s === "de" ? "Der Mailversand ist eingerichtet. Diese Nachricht dient nur dem Test." : "Outgoing mail is set up. This message is only a test."],
      fuss: FUSS[s],
    }),
  kennzahl_abfrage: (p, s) =>
    baue({
      betreff: s === "de" ? `Kennzahlen-Abfrage: ${einzeilig(p.unternehmen, 80)}` : `Request for key figures: ${einzeilig(p.unternehmen, 80)}`,
      absaetze:
        s === "de"
          ? [
              "Guten Tag,",
              `für ${p.unternehmen} bitten wir um Kennzahlen für den Zeitraum ${datum(p.periodeBeginn, s)} bis ${datum(p.periodeEnde, s)}, bis zum ${datum(p.faelligAm, s)}.`,
              ...(p.hinweis ? [`Hinweis: ${p.hinweis}`] : []),
              "Der Link führt zu einem Formular, für das keine Anmeldung nötig ist. Er gilt nur für diese Anfrage und läuft ab. Bitte leiten Sie ihn nicht weiter.",
            ]
          : [
              "Hello,",
              `we kindly ask for key figures for ${p.unternehmen} for the period ${datum(p.periodeBeginn, s)} to ${datum(p.periodeEnde, s)}, due by ${datum(p.faelligAm, s)}.`,
              ...(p.hinweis ? [`Note: ${p.hinweis}`] : []),
              "The link opens a form that needs no sign-in. It only works for this request and expires. Please do not forward it.",
            ],
      link: { adresse: p.link, beschriftung: s === "de" ? "Zum Formular" : "Open the form" },
      fuss: FUSS[s],
    }),
  esg_abfrage: (p, s) =>
    baue({
      betreff: s === "de" ? `ESG-Fragebogen ${einzeilig(p.jahr, 10)}: ${einzeilig(p.unternehmen, 80)}` : `ESG questionnaire ${einzeilig(p.jahr, 10)}: ${einzeilig(p.unternehmen, 80)}`,
      absaetze:
        s === "de"
          ? [
              "Guten Tag,",
              `für ${p.unternehmen} bitten wir um Angaben zu Nachhaltigkeitsindikatoren für das Berichtsjahr ${p.jahr}, bis zum ${datum(p.faelligAm, s)}.`,
              ...(p.hinweis ? [`Hinweis: ${p.hinweis}`] : []),
              "Der Link führt zu einem Formular, für das keine Anmeldung nötig ist. Geschätzte Werte können Sie als solche kennzeichnen und die Quelle angeben. Der Link gilt nur für diese Anfrage und läuft ab. Bitte leiten Sie ihn nicht weiter.",
            ]
          : [
              "Hello,",
              `we kindly ask for information on sustainability indicators for ${p.unternehmen} for the reporting year ${p.jahr}, due by ${datum(p.faelligAm, s)}.`,
              ...(p.hinweis ? [`Note: ${p.hinweis}`] : []),
              "The link opens a form that needs no sign-in. You can mark estimated values as such and name the source. The link only works for this request and expires. Please do not forward it.",
            ],
      link: { adresse: p.link, beschriftung: s === "de" ? "Zum Fragebogen" : "Open the questionnaire" },
      fuss: FUSS[s],
    }),
  lp_mitteilung: (p, s) =>
    baue({
      betreff: s === "de" ? `Neue Mitteilung im Portal: ${einzeilig(p.fonds, 80)}` : `New notice in the portal: ${einzeilig(p.fonds, 80)}`,
      absaetze:
        s === "de"
          ? [
              "Guten Tag,",
              `zu ${p.fonds} liegt eine neue Mitteilung zu ${p.art === "abruf" ? "einem Kapitalabruf" : "einer Ausschüttung"} im Portal bereit.`,
              "Aus Sicherheitsgründen enthält diese Mail weder Beträge noch das Dokument. Bitte melden Sie sich im Portal an.",
            ]
          : [
              "Hello,",
              `a new notice about ${p.art === "abruf" ? "a capital call" : "a distribution"} for ${p.fonds} is available in the portal.`,
              "For security reasons this e-mail contains neither amounts nor the document. Please sign in to the portal.",
            ],
      link: { adresse: p.link, beschriftung: s === "de" ? "Zum Portal" : "Open the portal" },
      fuss: FUSS[s],
    }),
  bericht_freigegeben: (p, s) => {
    const name = BERICHT_NAMEN[p.bericht]?.[s === "de" ? 0 : 1] ?? p.bericht;
    // Belege heißen im Text Beleg, nicht Bericht; der Betreff und der Rest bleiben bei allen Arten gleich.
    const beleg = p.bericht === "beleg";
    return baue({
      betreff: s === "de" ? `${beleg ? "Beleg" : "Bericht"} freigegeben: ${einzeilig(name, 80)}` : `${beleg ? "Voucher" : "Report"} released: ${einzeilig(name, 80)}`,
      absaetze:
        s === "de"
          ? [`${beleg ? "Ein Beleg" : `Der Bericht „${name}“`}${p.fonds ? ` (${p.fonds})` : ""} wurde freigegeben.`, "Sie erhalten diese Nachricht, weil Sie sie in Ihren Einstellungen aktiviert haben."]
          : [`${beleg ? "A voucher" : `The report “${name}”`}${p.fonds ? ` (${p.fonds})` : ""} has been released.`, "You receive this message because you switched it on in your settings."],
      link: { adresse: p.link, beschriftung: s === "de" ? (beleg ? "Zum Beleg" : "Zum Bericht") : beleg ? "Open the voucher" : "Open the report" },
      fuss: FUSS[s],
    });
  },
  register_ereignis: (p, s) => {
    const art = EREIGNIS_NAMEN[p.art]?.[s === "de" ? 0 : 1] ?? p.art;
    return baue({
      betreff: s === "de" ? `Registerereignis: ${einzeilig(p.unternehmen, 70)}` : `Register event: ${einzeilig(p.unternehmen, 70)}`,
      absaetze:
        s === "de"
          ? [`Zu ${p.unternehmen} liegt ein neues Registerereignis vor: ${art}.`, "Die Einzelheiten stehen in Carraway. Sie erhalten diese Nachricht, weil Sie sie in Ihren Einstellungen aktiviert haben."]
          : [`A new register event is available for ${p.unternehmen}: ${art}.`, "The details are in Carraway. You receive this message because you switched it on in your settings."],
      link: { adresse: p.link, beschriftung: s === "de" ? "Zum Unternehmen" : "Open the company" },
      fuss: FUSS[s],
    });
  },
  passwort_zuruecksetzen: (p, s) =>
    baue({
      betreff: s === "de" ? "Passwort zurücksetzen" : "Reset your password",
      absaetze:
        s === "de"
          ? [
              "Guten Tag,",
              "für Ihr Konto wurde das Zurücksetzen des Passworts angefordert. Über den Link legen Sie ein neues Passwort fest.",
              `Der Link gilt ${p.gueltigMinuten} Minuten und nur einmal. Ihr zweiter Faktor (Code der Authenticator-App) bleibt bestehen und wird bei der nächsten Anmeldung weiter verlangt.`,
              "Wenn Sie das nicht angefordert haben, ignorieren Sie diese Nachricht; Ihr Passwort bleibt dann unverändert.",
            ]
          : [
              "Hello,",
              "a password reset was requested for your account. Use the link to choose a new password.",
              `The link is valid for ${p.gueltigMinuten} minutes and works only once. Your second factor (the code from your authenticator app) stays in place and is still required at your next sign-in.`,
              "If you did not request this, ignore this message; your password stays unchanged.",
            ],
      link: { adresse: p.link, beschriftung: s === "de" ? "Neues Passwort festlegen" : "Choose a new password" },
      fuss: FUSS[s],
    }),
  einladung: (p, s) =>
    baue({
      betreff: s === "de" ? "Einladung zu Carraway" : "Invitation to Carraway",
      absaetze:
        s === "de"
          ? [
              `Guten Tag ${p.name},`,
              "für Sie wurde ein Zugang zu Carraway angelegt. Über den Link legen Sie Ihr Passwort fest.",
              `Der Link gilt ${p.gueltigStunden} Stunden und nur einmal. Bei der ersten Anmeldung richten Sie zusätzlich einen zweiten Faktor ein (Code einer Authenticator-App).`,
              "Wenn Sie diese Einladung nicht erwartet haben, ignorieren Sie die Nachricht.",
            ]
          : [
              `Hello ${p.name},`,
              "an account for Carraway has been created for you. Use the link to choose your password.",
              `The link is valid for ${p.gueltigStunden} hours and works only once. At your first sign-in you also set up a second factor (a code from an authenticator app).`,
              "If you did not expect this invitation, ignore this message.",
            ],
      link: { adresse: p.link, beschriftung: s === "de" ? "Passwort festlegen" : "Choose your password" },
      fuss: FUSS[s],
    }),
};

export function rendereVorlage<V extends Vorlage>(vorlage: V, sprache: Sprache, parameter: VorlagenParameter[V]): Gerendert {
  return (TEXTE[vorlage] as Bauer<V>)(parameter, sprache);
}
