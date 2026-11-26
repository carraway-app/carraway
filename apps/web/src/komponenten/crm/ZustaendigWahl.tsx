import { useState } from "react";
import { Popover } from "@carraway/ui";
import { useT } from "../../i18n";
import { useRechte } from "../../lib/rechte";
import { BenutzerSuche } from "./Sucheingabe";

/**
 * Auswahl der zuständigen Person als Popover: durchsuchbare Liste der Personen mit Zugriff (bei einem Deal nur, wer ihn sehen darf), dazu „Mir zuweisen“ und „Niemand“.
 * Das Popover schließt nach der Wahl; `onWaehlen(null)` heißt niemand.
 */
export function ZustaendigWahl({
  name,
  beschriftung,
  dealId,
  onWaehlen,
  klasse,
  kante = "links",
}: {
  /** Aktuelle Person (Text am Auslöser); `null`: niemand. */
  name: string | null;
  /** Zugänglicher Name des Auslösers; beginnt mit dem sichtbaren Text. */
  beschriftung: string;
  dealId?: string | undefined;
  onWaehlen: (wer: { id: string; name: string } | null) => void;
  klasse?: string;
  kante?: "rechts" | "links";
}) {
  const t = useT();
  const { ich } = useRechte();
  const [zaehler, setZaehler] = useState(0);
  const waehle = (wer: { id: string; name: string } | null) => {
    onWaehlen(wer);
    setZaehler((n) => n + 1);
  };
  const extras = [
    ...(ich ? [{ id: "ich", label: t.crm.aufgabeFuerMich, onWaehlen: () => waehle({ id: ich.id, name: ich.name }) }] : []),
    { id: "niemand", label: t.crm.niemand, onWaehlen: () => waehle(null) },
  ];
  return (
    <Popover
      key={zaehler}
      ausloeser={name ?? t.crm.nichtZugewiesen}
      aria-label={t.crm.zustaendigWaehlen}
      ausloeserLabel={beschriftung}
      ausloeserKlasse={klasse ?? "app-zustaendig"}
      kante={kante}
    >
      <BenutzerSuche dealId={dealId} onWaehlen={waehle} extras={extras} />
    </Popover>
  );
}
