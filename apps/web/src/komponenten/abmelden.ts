import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { schluesselAnmeldung } from "../api/anmeldung";
import { authAnfrage } from "../api/client";

/** Meldet die Sitzung ab, verwirft alle zwischengespeicherten Daten der Person und führt zur Anmeldung. */
export function useAbmelden() {
  const qc = useQueryClient();
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<unknown>(null);
  async function abmelden() {
    setLaeuft(true);
    setFehler(null);
    try {
      await authAnfrage("/sign-out", {});
      // Die Daten gehören der bisherigen Person: nichts davon darf der nächsten angezeigt werden. Erst `/ich` weg,
      // damit der Wächter zur Anmeldung führt, dann (die Seiten sind abgebaut) alles andere.
      qc.removeQueries({ queryKey: schluesselAnmeldung.ich });
      await router.navigate({ to: "/anmelden", search: {}, replace: true });
      qc.clear();
    } catch (f) {
      setFehler(f);
    } finally {
      setLaeuft(false);
    }
  }
  return { abmelden, laeuft, fehler };
}
