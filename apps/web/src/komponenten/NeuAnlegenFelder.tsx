import { lazy, Suspense, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { VerknuepfungsFeld, type SuchfeldTreffer } from "./Suchfeld";

/**
 * Verknüpfungsfelder mit „Neu anlegen“ (Issue #296): Der Eintrag unter den Treffern öffnet den Anlage-Dialog, vorbefüllt mit der
 * Eingabe; der neue Datensatz steht danach im Feld. Der Dialog erscheint als Überlagerung über dem Formular; sein Absenden bleibt
 * im Dialog und löst das Formular dahinter nicht aus (React reicht Ereignisse aus Portalen an den Elternbaum weiter).
 */
function Abgeschirmt({ children }: { children: ReactNode }) {
  return (
    <div onSubmit={(e) => e.stopPropagation()}>
      <Suspense fallback={null}>{children}</Suspense>
    </div>
  );
}

// Die Dialoge laden erst beim Öffnen: Seiten mit diesen Feldern bleiben im Anfangsumfang klein.
const PersonDialog = lazy(() => import("./PersonDialog").then((m) => ({ default: m.PersonDialog })));
const NeuerDealDialog = lazy(() => import("./NeuerDealDialog").then((m) => ({ default: m.NeuerDealDialog })));

interface FeldProps {
  label: string;
  wert: SuchfeldTreffer | null;
  onWahl: (treffer: SuchfeldTreffer | null) => void;
  ausschliessen?: ReadonlySet<string>;
  required?: boolean;
  fehler?: ReactNode;
  name?: string;
}

/** Person wählen oder neu anlegen. */
export function PersonSuchfeld({ wert, onWahl, ...rest }: FeldProps) {
  const t = useT();
  const [neu, setNeu] = useState<string | null>(null);
  return (
    <>
      <VerknuepfungsFeld {...rest} ziel="person" wert={wert} onWahl={onWahl} onNeu={setNeu} />
      {neu !== null ? (
        <Abgeschirmt>
          <PersonDialog
            namensvorschlag={neu}
            onSchliessen={() => setNeu(null)}
            onAngelegt={(person) => onWahl({ id: person.id, label: `${person.vorname} ${person.nachname}`, info: person.organisation?.name ?? t.suche.ohneOrganisation })}
          />
        </Abgeschirmt>
      ) : null}
    </>
  );
}

/** Deal wählen oder neu anlegen. */
export function DealSuchfeld({ wert, onWahl, ...rest }: FeldProps) {
  const [neu, setNeu] = useState<string | null>(null);
  return (
    <>
      <VerknuepfungsFeld {...rest} ziel="deal" wert={wert} onWahl={onWahl} onNeu={setNeu} />
      {neu !== null ? (
        <Abgeschirmt>
          <NeuerDealDialog
            titelVorschlag={neu}
            onSchliessen={() => setNeu(null)}
            onAngelegt={(deal) => onWahl({ id: deal.id, label: deal.titel, info: deal.organisation.name })}
          />
        </Abgeschirmt>
      ) : null}
    </>
  );
}
