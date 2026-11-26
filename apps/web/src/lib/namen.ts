import { useQuery } from "@tanstack/react-query";
import { benutzerNamen, istBenutzerId } from "../api/anmeldung";
import { useT } from "../i18n";

/**
 * Anzeigenamen zu Benutzer-IDs (`von`-Felder von Zinslauf, Beschluss usw.). Die API nennt nur Personen, die die anfragende
 * Person sehen darf; für Altbestand (`system`) und nicht sichtbare Personen gibt es einen neutralen Text, nie die rohe ID.
 */
export function useNamen(ids: readonly (string | null | undefined)[]): (id: string | null | undefined) => string | null {
  const t = useT();
  const gueltig = ids.filter(istBenutzerId);
  const abfrage = useQuery(benutzerNamen(gueltig));
  return (id) => {
    if (!id) return null;
    if (!istBenutzerId(id)) return id === "system" ? t.rechte.system : t.rechte.unbekanntePerson;
    const name = abfrage.data?.find((n) => n.id === id)?.name;
    if (name) return name;
    return abfrage.isPending ? t.gemeinsam.keinWert : t.rechte.unbekanntePerson;
  };
}
