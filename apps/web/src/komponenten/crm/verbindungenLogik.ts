import type { Beschaeftigung } from "../../api/crm";
import type { RollenZeile } from "../Rollen";

/** Eine Person der älteren Liste der Organisation (`personen` in der Antwort der Organisation: Personen, deren Hauptunternehmen sie ist). */
export interface AltePerson {
  id: string;
  vorname: string;
  nachname: string;
  email: string | null;
  funktion: string | null;
}

/** Eine Zeile der gemeinsamen Tabelle: ein Kontakt (Seite des Unternehmens) bzw. ein Unternehmen (Seite des Kontakts). */
export interface Verbindung {
  schluessel: string;
  /** ID des Kontakts bzw. des Unternehmens auf der Gegenseite. */
  gegenId: string;
  name: string;
  email: string | null;
  telefon: string | null;
  linkedin: string | null;
  website: string | null;
  funktion: string | null;
  von: string | null;
  bis: string | null;
  haupt: boolean;
  /** Die Beschäftigung hinter der Zeile; ohne sie gibt es nur eine Rolle (oder den Eintrag der älteren Liste). */
  beschaeftigungId: string | null;
  /** Rollen dieser Person bei diesem Unternehmen (Begriff der Kontaktrollen, bleibt erhalten). */
  rollen: RollenZeile[];
  /** Person der älteren Liste, falls die Zeile aus ihr stammt oder zur Hauptzeile passt (Bearbeiten der Stammdaten). */
  altePerson: AltePerson | null;
}

/**
 * Führt die drei Quellen zu einer Liste zusammen: Beschäftigungen (mit Funktion, Zeitraum, Hauptunternehmen), Rollen (Kontaktrollen) und
 * die ältere Personenliste der Organisation. Je Beschäftigung eine Zeile; die Rollen einer Person stehen bei ihrer ersten Zeile an diesem Unternehmen
 * (laufende Beschäftigung zuerst, so sortiert die API). Wer nur eine Rolle oder nur einen Eintrag der älteren Liste hat, bekommt eine eigene Zeile ohne Beschäftigung.
 */
export function baueVerbindungen(seite: "organisation" | "person", beschaeftigungen: Beschaeftigung[], rollen: RollenZeile[], altePersonen: AltePerson[] = []): Verbindung[] {
  const gegenVon = (r: RollenZeile): { id: string; name: string } | null =>
    seite === "organisation" ? (r.person ? { id: r.person.id, name: `${r.person.vorname} ${r.person.nachname}`.trim() } : null) : r.organisation ? { id: r.organisation.id, name: r.organisation.name } : null;
  const rollenNach = new Map<string, RollenZeile[]>();
  for (const r of rollen) {
    const g = gegenVon(r);
    if (g) rollenNach.set(g.id, [...(rollenNach.get(g.id) ?? []), r]);
  }
  const alteNach = new Map(altePersonen.map((p) => [p.id, p]));
  const gesehen = new Set<string>();
  const zeilen: Verbindung[] = beschaeftigungen.map((b) => {
    const gegen = seite === "organisation" ? b.person : b.organisation;
    const erste = !gesehen.has(gegen.id);
    gesehen.add(gegen.id);
    return {
      schluessel: b.id,
      gegenId: gegen.id,
      name: seite === "organisation" ? `${b.person.vorname} ${b.person.nachname}`.trim() : b.organisation.name,
      email: gegen.email,
      telefon: gegen.telefon,
      linkedin: gegen.linkedin,
      website: seite === "person" ? b.organisation.website : null,
      funktion: b.funktion,
      von: b.von,
      bis: b.bis,
      haupt: b.haupt,
      beschaeftigungId: b.id,
      rollen: erste ? (rollenNach.get(gegen.id) ?? []) : [],
      altePerson: seite === "organisation" ? (alteNach.get(b.person.id) ?? null) : null,
    };
  });
  // Rollen ohne Beschäftigung.
  for (const [gegenId, liste] of rollenNach) {
    if (gesehen.has(gegenId)) continue;
    gesehen.add(gegenId);
    const g = gegenVon(liste[0]!)!;
    zeilen.push({ schluessel: `rolle:${gegenId}`, gegenId, name: g.name, email: null, telefon: null, linkedin: null, website: null, funktion: null, von: null, bis: null, haupt: false, beschaeftigungId: null, rollen: liste, altePerson: alteNach.get(gegenId) ?? null });
  }
  // Personen der älteren Liste ohne Beschäftigung und ohne Rolle (kommt nur bei Altdaten vor).
  if (seite === "organisation") {
    for (const p of altePersonen) {
      if (gesehen.has(p.id)) continue;
      gesehen.add(p.id);
      zeilen.push({ schluessel: `person:${p.id}`, gegenId: p.id, name: `${p.vorname} ${p.nachname}`.trim(), email: p.email, telefon: null, linkedin: null, website: null, funktion: p.funktion, von: null, bis: null, haupt: true, beschaeftigungId: null, rollen: [], altePerson: p });
    }
  }
  // Rollenzeilen haben den Namen der Gegenseite aus der Rolle; fehlende Kontaktwege ergänzt die ältere Liste.
  return zeilen.map((z) => (z.email === null && z.altePerson?.email ? { ...z, email: z.altePerson.email } : z));
}
