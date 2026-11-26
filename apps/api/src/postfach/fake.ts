import type { MailAbruf, MailKopf, PostfachAnbieter, Termin } from "./typen";

/**
 * Anbieter ohne Netzwerk: für Tests und für die Demo-Umgebung (Anbieter `demo`). Die Daten liegen im Speicher und lassen sich ändern;
 * `holeMailKoepfe` liefert nur Nachrichten, die jünger sind als der Stand (wie ein echter Abgleich).
 */
export class FakeAnbieter implements PostfachAnbieter {
  mails: MailKopf[] = [];
  termine: Termin[] = [];
  texte = new Map<string, string>();
  /** Zählt, wofür der Text geholt wurde (Tests prüfen, dass nur passende Nachrichten nachgeladen werden). */
  textAbrufe: string[] = [];
  fehler: Error | null = null;

  async holeMailKoepfe(_zugang: unknown, stand: string | null): Promise<MailAbruf> {
    if (this.fehler) throw this.fehler;
    const seit = stand ? Date.parse(stand) : 0;
    const koepfe = this.mails.filter((m) => m.datum.getTime() > seit).sort((a, b) => a.datum.getTime() - b.datum.getTime());
    return { koepfe, stand: (koepfe.at(-1)?.datum ?? new Date(seit || Date.now())).toISOString() };
  }

  async holeMailText(_zugang: unknown, kopf: MailKopf, max: number): Promise<string> {
    this.textAbrufe.push(kopf.id);
    return (this.texte.get(kopf.id) ?? "").slice(0, max);
  }

  async holeTermine(_zugang: unknown, von: Date, bis: Date): Promise<Termin[]> {
    if (this.fehler) throw this.fehler;
    return this.termine.filter((t) => t.beginn >= von && t.beginn <= bis);
  }
}

export interface DemoKontakt {
  email: string;
  vorname: string;
  nachname: string;
}

/**
 * Erfundene Nachrichten und Termine mit den ersten Kontakten der Demo-Daten (und einem unbekannten Absender, der nie gespeichert wird).
 * Zeiten relativ zu `jetzt`, damit immer ein kommender Termin dabei ist.
 */
export function erzeugeDemoDaten(kontakte: DemoKontakt[], eigeneAdresse: string, jetzt: Date): { mails: MailKopf[]; termine: Termin[]; texte: Map<string, string> } {
  const tag = 86_400_000;
  const mails: MailKopf[] = [];
  const termine: Termin[] = [];
  const texte = new Map<string, string>();
  const betreffe = ["Rückfrage zum Finanzierungsstand", "Unterlagen für das nächste Gespräch", "Terminabstimmung Quartalsgespräch", "Kurzer Zwischenstand"];
  kontakte.slice(0, 4).forEach((k, i) => {
    const eingehend = i % 2 === 0;
    const id = `demo-mail-${i + 1}`;
    mails.push({
      id,
      nachrichtenId: `<${id}@demo.example>`,
      datum: new Date(jetzt.getTime() - (i * 3 + 1) * tag),
      betreff: betreffe[i % betreffe.length]!,
      von: eingehend ? k.email : eigeneAdresse,
      an: eingehend ? [eigeneAdresse] : [k.email],
      cc: [],
      ...(eingehend ? {} : { gesendet: true }),
    });
    texte.set(id, `Guten Tag ${k.vorname},\n\ndies ist ein erfundener Beispieltext für die Demo (${betreffe[i % betreffe.length]}).\n\nBeste Grüße`);
  });
  mails.push({ id: "demo-mail-fremd", nachrichtenId: "<demo-mail-fremd@demo.example>", datum: new Date(jetzt.getTime() - tag), betreff: "Newsletter", von: "newsletter@example.net", an: [eigeneAdresse], cc: [] });
  const zeiten = [-5, -1, 2, 6];
  kontakte.slice(0, 4).forEach((k, i) => {
    const beginn = new Date(jetzt.getTime() + zeiten[i]! * tag);
    beginn.setUTCHours(9 + i, 0, 0, 0);
    termine.push({ id: `demo-termin-${i + 1}@demo.example`, instanz: null, titel: ["Erstgespräch", "Abstimmung zur Runde", "Quartalsgespräch", "Besuch vor Ort"][i]!, beginn, ende: new Date(beginn.getTime() + 3_600_000), teilnehmer: [eigeneAdresse, k.email], eigeneAntwort: "angenommen", abgesagt: false });
  });
  return { mails, termine, texte };
}
