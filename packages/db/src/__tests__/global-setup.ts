import { testDatenbankUrl } from "../schutz";

/** Bricht den ganzen Testlauf mit klarer Meldung ab, bevor eine Datei gegen die falsche Datenbank läuft. */
export default function setup() {
  testDatenbankUrl();
}
