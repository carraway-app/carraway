import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ichAbfrage, sicheresZiel } from "../api/anmeldung";
import { ApiFehler } from "../api/client";

/** Ein Schritt der Anmeldung, der etwas an die API schickt: Laufzustand und Fehler an einer Stelle, nichts davon im Query-Cache (Passwörter, Codes). */
export function useAnmeldeschritt() {
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<unknown>(null);
  async function ausfuehren(aufgabe: () => Promise<void>): Promise<void> {
    setLaeuft(true);
    setFehler(null);
    try {
      await aufgabe();
    } catch (f) {
      setFehler(f);
    } finally {
      setLaeuft(false);
    }
  }
  return { laeuft, fehler, ausfuehren, setFehler };
}

/**
 * Nach erfolgreicher Anmeldung, Passwortänderung oder Einrichtung des zweiten Faktors: den Cache der vorigen Person verwerfen,
 * `/ich` frisch holen (die Sperren des Servers können sich geändert haben) und zum Ziel gehen. Der Wächter des Routers leitet
 * von dort weiter, falls noch eine Sperre gilt.
 */
export function useAnmeldungAbschliessen() {
  const qc = useQueryClient();
  const router = useRouter();
  return async function abschliessen(ziel: string | undefined, optionen: { cacheLeeren?: boolean } = {}): Promise<void> {
    if (optionen.cacheLeeren) qc.clear();
    try {
      await qc.fetchQuery({ ...ichAbfrage(), staleTime: 0 });
    } catch (f) {
      // Der Server hat die Sitzung zwar angelegt, lässt die Person aber nicht ein (gesperrtes Konto).
      if (f instanceof ApiFehler && f.status === 401) throw new ApiFehler("KONTO_GESPERRT", 401);
      throw f;
    }
    // Der Router reicht rohe Suchwerte der Wurzel durch; das Ziel wird hier noch einmal geprüft.
    router.history.replace(sicheresZiel(ziel) ?? "/");
  };
}
