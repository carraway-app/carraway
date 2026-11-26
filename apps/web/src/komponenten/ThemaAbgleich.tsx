import { useThemaAbgleich } from "../api/thema";

/** Gleicht das Thema nach der Anmeldung mit dem Server ab. Eigene Datei, damit der Abgleich erst nach dem ersten Zeichnen lädt (Budget des Anfangsumfangs). */
export default function ThemaAbgleich() {
  useThemaAbgleich();
  return null;
}
