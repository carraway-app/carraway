import { useEffect, useState, type ReactNode } from "react";
import { Button, CaretDownIcon, Feld, Popover, formatDatum } from "@carraway/ui";
import { useSprache, useT } from "../i18n";
import { hatIrgendwoRolle, useRechte } from "../lib/rechte";
import { datumDesStands, endeDesTages, formatWissensstand } from "../lib/wissensstand";

/**
 * Wer den Wissensstand sehen und setzen darf: Bearbeiter im Bereich Finanzen oder Verwalter des Fonds. Ohne Fonds (Dashboard über alle Fonds)
 * genügt diese Rolle in irgendeinem Fonds. Alle anderen sehen nur den Stichtag; für sie gilt der aktuelle Stand. Die API bleibt unverändert,
 * weil der Wissensstand nur lesend wirkt und keine zusätzlichen Daten freigibt.
 */
export function useWissensstandErlaubt(fondsId: string | null): boolean {
  const { ich, darf } = useRechte();
  if (!ich) return false;
  if (fondsId) return darf("bearbeiter", fondsId, "finanzen") || darf("verwalter", fondsId);
  return hatIrgendwoRolle(ich, "bearbeiter", "finanzen") || hatIrgendwoRolle(ich, "verwalter");
}

export interface StichtagMenueProps {
  /** Stichtag der Ansicht (`YYYY-MM-DD`); leer bis die Daten da sind. */
  stichtag: string;
  /** Ein leeres Datum setzt den fachlichen Standard wieder ein. Ohne Angabe gibt es kein Stichtagsfeld (nur Wissensstand). */
  onStichtag?: (neu: string | undefined) => void;
  /** Wissensstand als Zeitpunkt aus der Adresse. */
  stand?: string;
  /** Ohne Angabe bietet das Menü keinen Wissensstand an. */
  onStand?: (neu: string | undefined) => void;
  /** Fonds der Ansicht für die Sichtbarkeit des Wissensstands; `null` für Ansichten über alle Fonds. */
  fondsId: string | null;
  /** Weitere Einstellungen der Ansicht unter Stichtag und Wissensstand, zum Beispiel die Währungssicht. */
  zusatz?: ReactNode;
  /** Kurzform der Zusatzeinstellung für den Auslöser (zum Beispiel „Fonds“ für die Währungssicht). */
  zusatzKurz?: string;
  label?: string;
}

/**
 * Stichtag-Menü im Kopf: ein Auslöser „Stichtag 30.09.2026“, dahinter in fester Reihenfolge der Stichtag, der Wissensstand (nur als Datum,
 * gemeint ist das Ende dieses Tages in Europe/Berlin; nur mit Recht) und weitere Einstellungen der Ansicht.
 */
export function StichtagMenue({ stichtag, onStichtag, stand, onStand, fondsId, zusatz, zusatzKurz, label }: StichtagMenueProps) {
  const t = useT();
  const sprache = useSprache();
  const erlaubt = useWissensstandErlaubt(fondsId);
  const mitStand = Boolean(onStand) && (erlaubt || Boolean(stand));
  const [eingabe, setEingabe] = useState(stichtag);
  useEffect(() => setEingabe(stichtag), [stichtag]);
  const titel = label ?? t.kopf.stichtag;
  // Ältere Links mit genauer Uhrzeit zeigen sie weiter an; ein Datum aus dem Menü ist immer das Ende des Tages.
  const standText = stand ? formatWissensstand(stand, sprache) : null;
  const kurz = [stichtag ? formatDatum(stichtag, sprache) : null, standText ? `${t.wissensstand.label} ${standText}` : null, zusatzKurz].filter(Boolean).join(" · ");
  return (
    <Popover
      className="app-stichtagmenue"
      aria-label={t.wissensstand.menue}
      ausloeserLabel={`${titel}: ${kurz || t.gemeinsam.keinWert}`}
      ausloeserKlasse="app-stichtagmenue__ausloeser"
      aktiv={Boolean(stand)}
      ausloeser={
        <>
          <span className="app-stichtagmenue__label">{titel}</span>{" "}
          <span className="app-stichtagmenue__wert">{kurz || t.gemeinsam.keinWert}</span>
          <CaretDownIcon size={14} />
        </>
      }
    >
      {onStichtag ? (
        <Feld
          type="date"
          label={titel}
          hilfe={t.wissensstand.stichtagHilfe}
          value={eingabe}
          onChange={(e) => {
            const datum = e.currentTarget.value;
            setEingabe(datum);
            onStichtag(datum || undefined);
          }}
          onBlur={() => { if (!eingabe) setEingabe(stichtag); }}
        />
      ) : null}
      {mitStand && onStand ? (
        <div className="app-wissensstand">
          <Feld
            type="date"
            label={t.wissensstand.label}
            hilfe={t.wissensstand.hilfe}
            value={datumDesStands(stand)}
            readOnly={!erlaubt}
            onChange={(e) => onStand(endeDesTages(e.currentTarget.value))}
          />
          {stand ? (
            <Button variante="ruhig" onClick={() => onStand(undefined)}>
              {t.wissensstand.aktuell}
            </Button>
          ) : null}
        </div>
      ) : null}
      {zusatz}
    </Popover>
  );
}
