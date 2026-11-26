import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button, Hinweis } from "@carraway/ui";
import { dublettenSuche, type Dublette } from "../api/abfragen";
import { ApiFehler } from "../api/client";
import { aufzaehlung, useT } from "../i18n";
import { useEntprellt } from "./formular";

/** Kandidaten aus einem 409 `possible_duplicate`; sonst `null`. */
export function kandidatenAus(fehler: unknown): Dublette[] | null {
  if (!(fehler instanceof ApiFehler) || fehler.code !== "possible_duplicate") return null;
  return Array.isArray(fehler.zusatz.kandidaten) ? (fehler.zusatz.kandidaten as Dublette[]) : [];
}

function Kandidaten({ kandidaten, onVerwenden }: { kandidaten: Dublette[]; onVerwenden?: ((kandidat: Dublette) => void) | undefined }) {
  const t = useT();
  return (
    <ul className="app-dubletten">
      {kandidaten.map((k) => (
        <li key={k.id}>
          <Link to="/organisationen/$id" params={{ id: k.id }} target="_blank" rel="noreferrer">
            {k.name}
          </Link>
          <span className="app-dubletten__info">{[aufzaehlung(t.organisationArt, k.art), k.ort].filter(Boolean).join(" · ")}</span>
          {onVerwenden ? (
            <Button variante="sekundaer" onClick={() => onVerwenden(k)} aria-label={t.dubletten.verwendenName(k.name)}>
              {t.dubletten.verwenden}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Hinweis während der Eingabe: ruft die Dublettenprüfung der API mit dem (entprellten) Namen auf. */
export function DublettenHinweis({ name, onVerwenden }: { name: string; onVerwenden?: (kandidat: Dublette) => void }) {
  const t = useT();
  const entprellt = useEntprellt(name.trim());
  const abfrage = useQuery({ ...dublettenSuche(entprellt), enabled: entprellt.length >= 3 });
  // Platz bleibt reserviert: kein Springen, wenn der Hinweis erscheint.
  const kandidaten = entprellt.length >= 3 ? (abfrage.data ?? []) : [];
  return (
    <div className="app-dubletten-platz" aria-live="polite">
      {kandidaten.length > 0 ? (
        <Hinweis titel={t.dubletten.titel}>
          {t.dubletten.hinweis}
          <Kandidaten kandidaten={kandidaten} onVerwenden={onVerwenden} />
        </Hinweis>
      ) : null}
    </div>
  );
}

/** Antwort auf 409 `possible_duplicate`: Kandidaten zeigen, neu anlegen nur nach ausdrücklicher Bestätigung. */
export function DublettenBestaetigung({
  kandidaten,
  onBestaetigen,
  onVerwenden,
  laeuft,
}: {
  kandidaten: Dublette[];
  onBestaetigen: () => void;
  onVerwenden?: (kandidat: Dublette) => void;
  laeuft: boolean;
}) {
  const t = useT();
  return (
    <Hinweis variante="fehler" titel={t.fehler.possible_duplicate}>
      {t.dubletten.bestaetigung}
      <Kandidaten kandidaten={kandidaten} onVerwenden={onVerwenden} />
      <Button variante="gefahr" onClick={onBestaetigen} disabled={laeuft}>
        {t.dubletten.trotzdemAnlegen}
      </Button>
    </Hinweis>
  );
}
