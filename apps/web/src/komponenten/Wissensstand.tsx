import { useEffect, useState } from "react";
import { Button, CaretDownIcon, Feld, Popover } from "@carraway/ui";
import { useSprache, useT } from "../i18n";
import { alsDatetimeLocal, alsStand, formatZeitpunkt } from "../lib/zeit";

interface WissensstandProps {
  stand: string | undefined;
  onWahl: (stand: string | undefined) => void;
}

export function WissensstandWahl({ stand, onWahl }: WissensstandProps) {
  const t = useT();
  return (
    <Popover
      aria-label={t.wissensstand.label}
      title={t.wissensstand.hilfe}
      aktiv={Boolean(stand)}
      ausloeser={<>{t.wissensstand.label}<CaretDownIcon /></>}
    >
      <Wissensstand stand={stand} onWahl={onWahl} />
    </Popover>
  );
}

/**
 * Eingabe des Wissensstands (`?stand=`): zeigt einen Stichtag so, wie er zu einem früheren Zeitpunkt bekannt war.
 * Die Eingabe ist Ortszeit, die URL und die API tragen den Zeitpunkt in UTC.
 */
export function Wissensstand({ stand, onWahl }: WissensstandProps) {
  const t = useT();
  const sprache = useSprache();
  const [eingabe, setEingabe] = useState(() => alsDatetimeLocal(stand));
  useEffect(() => setEingabe(alsDatetimeLocal(stand)), [stand]);
  return (
    <div className="app-wissensstand">
      <Feld
        type="datetime-local"
        label={t.wissensstand.label}
        hilfe={stand ? t.wissensstand.ansichtMit(formatZeitpunkt(stand, sprache)) : t.wissensstand.hilfe}
        value={eingabe}
        onChange={(e) => {
          const zeit = e.currentTarget.value;
          setEingabe(zeit);
          onWahl(alsStand(zeit));
        }}
      />
      {stand ? (
        <Button variante="ruhig" onClick={() => onWahl(undefined)}>
          {t.wissensstand.aktuell}
        </Button>
      ) : null}
    </div>
  );
}
