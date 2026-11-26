import { useEffect, useRef } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aktuellesThema, setzeThema, useThema, type Thema } from "@carraway/ui";
import { themaAnApi, themaVonApi } from "./abbildung";
import { api, auspacken } from "./client";

/** Das Thema je Person liegt beim Server (`/theme`); der Browser merkt es zusätzlich für den ersten Anstrich (siehe `packages/ui/src/thema.ts`). */
const ladeThema = async () => themaVonApi((await auspacken(api.api.v1.theme.$get())).theme);

export const themaAbfrage = () => queryOptions({ queryKey: ["thema"] as const, queryFn: ladeThema, staleTime: Infinity });

/**
 * Gleicht das Thema nach der Anmeldung einmal mit dem Wert des Servers ab: Der Server gilt, solange die Person in dieser Sitzung noch nichts
 * gewählt hat (eine Wahl schreibt ihren Wert in die Abfrage, siehe `useThemaWahl`). Scheitert das Laden, bleibt der Wert des Browsers (oder `system`).
 */
export function useThemaAbgleich(aktiv = true): void {
  const { data } = useQuery({ ...themaAbfrage(), enabled: aktiv });
  const abgeglichen = useRef(false);
  useEffect(() => {
    if (!data || abgeglichen.current) return;
    abgeglichen.current = true;
    if (data.thema !== aktuellesThema()) setzeThema(data.thema);
  }, [data]);
}

/** Wahl des Themas: wirkt sofort, merkt sich den Wert im Browser und speichert ihn beim Server (ein Fehler dort ändert die Anzeige nicht). */
export function useThemaWahl(): { thema: Thema; waehle: (thema: Thema) => void } {
  const [thema, setze] = useThema();
  const qc = useQueryClient();
  const speichern = useMutation({
    mutationFn: async (neu: Thema) => themaVonApi((await auspacken(api.api.v1.theme.$patch({ json: { theme: themaAnApi(neu) } }))).theme),
    onSuccess: (antwort) => qc.setQueryData(themaAbfrage().queryKey, antwort),
  });
  return {
    thema,
    waehle: (neu) => {
      // Die Wahl gilt ab jetzt als Stand des Servers: Eine noch laufende Abfrage darf sie nicht mehr überschreiben.
      void qc.cancelQueries({ queryKey: themaAbfrage().queryKey });
      qc.setQueryData(themaAbfrage().queryKey, { thema: neu });
      setze(neu);
      speichern.mutate(neu);
    },
  };
}
