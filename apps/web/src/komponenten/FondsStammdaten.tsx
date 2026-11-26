import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Feld, Karte, Seitenpanel } from "@carraway/ui";
import { fondsStammdaten, useFondsAendern, useFondsAnlegen, type FondsDaten } from "../api/fonds-stammdaten";
import { useSprache, useT } from "../i18n";
import { feldText } from "../i18n/fehler";
import { useRechte } from "../lib/rechte";
import { formatBetragCent } from "../lib/zahl";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragFuerFeld, betragOderNichts, useFormular } from "./formular";
import { BetragFeld } from "./BetragFeld";
import { WaehrungAuswahl } from "./WaehrungAuswahl";
import { betragRegel, ganzzahlRegel, pflichtRegel, waehrungRegel } from "../lib/feldpruefung";

interface FondsStammdatenProps {
  fondsId?: string;
  onFondsWahl: (id: string) => void;
}

export default function FondsStammdaten({ fondsId, onFondsWahl }: FondsStammdatenProps) {
  return fondsId ? <FondsDetails key={fondsId} fondsId={fondsId} /> : <FondsAnlage onFondsWahl={onFondsWahl} />;
}

function FondsAnlage({ onFondsWahl }: Pick<FondsStammdatenProps, "onFondsWahl">) {
  const { ich } = useRechte();
  const t = useT();
  const [offen, setOffen] = useState(false);
  if (!ich?.globalVerwalter) return null;
  return (
    <>
      <Button variante="primaer" onClick={() => setOffen(true)}>{t.fondsStamm.anlegen}</Button>
      {offen && (
        <FondsFormular
          onSchliessen={() => setOffen(false)}
          onGespeichert={(id) => {
            setOffen(false);
            onFondsWahl(id);
          }}
        />
      )}
    </>
  );
}

function FondsDetails({ fondsId }: { fondsId: string }) {
  const { darf } = useRechte();
  const t = useT();
  const f = t.fondsStamm;
  const sprache = useSprache();
  const { data, error, isPending, refetch } = useQuery(fondsStammdaten(fondsId));
  const [offen, setOffen] = useState(false);
  const kannBearbeiten = darf("verwalter", fondsId, "fondsverwaltung");

  return (
    <Karte
      titel={f.titel}
      aktion={data && kannBearbeiten ? <Button variante="sekundaer" onClick={() => setOffen(true)}>{f.bearbeiten}</Button> : undefined}
    >
      {isPending && <p role="status">{t.gemeinsam.laedt}</p>}
      {error && (
        <>
          <FehlerHinweis fehler={error} />
          <Button variante="sekundaer" onClick={() => void refetch()}>{t.gemeinsam.erneutVersuchen}</Button>
        </>
      )}
      {data && (
        <dl className="app-fakten">
          <div><dt>{f.name}</dt><dd>{data.name}</dd></div>
          <div><dt>{f.kurzname}</dt><dd>{data.kurzname}</dd></div>
          <div><dt>{f.vintage}</dt><dd>{data.vintage}</dd></div>
          <div><dt>{f.zeichnungskapital}</dt><dd className="app-zahl">{formatBetragCent(data.zeichnungskapital, sprache, data.waehrung)}</dd></div>
          <div><dt>{f.waehrung}</dt><dd>{data.waehrung}</dd></div>
        </dl>
      )}
      {data && offen && kannBearbeiten && (
        <FondsFormular fonds={data} onSchliessen={() => setOffen(false)} onGespeichert={() => setOffen(false)} />
      )}
    </Karte>
  );
}

const FELDER = ["name", "kurzname", "vintage", "zeichnungskapital", "waehrung"];

function FondsFormular({ fonds: aktuelleDaten, onSchliessen, onGespeichert }: {
  fonds?: FondsDaten;
  onSchliessen: () => void;
  onGespeichert: (id: string) => void;
}) {
  const t = useT();
  const sprache = useSprache();
  const f = t.fondsStamm;
  const anlegen = useFondsAnlegen();
  const aendern = useFondsAendern();
  // Änderungen werden gegen den Stand bei Öffnen ermittelt, auch wenn die Abfrage im Hintergrund neu lädt.
  const [fonds] = useState(aktuelleDaten);
  const mutation = fonds ? aendern : anlegen;
  const { werte, feld, pruefeAlle } = useFormular({
    name: fonds?.name ?? "",
    kurzname: fonds?.kurzname ?? "",
    vintage: fonds ? String(fonds.vintage) : "",
    zeichnungskapital: betragFuerFeld(fonds?.zeichnungskapital),
    waehrung: fonds?.waehrung ?? "EUR",
  },
  {
    name: pflichtRegel(),
    kurzname: pflichtRegel(),
    vintage: ganzzahlRegel({ min: 1, pflicht: true, stellen: 4 }),
    zeichnungskapital: betragRegel({ vorzeichen: "positiv", pflicht: true }),
    waehrung: waehrungRegel({ pflicht: true }),
  });
  const titel = fonds ? f.bearbeiten : f.anlegen;
  const feldfehler = (name: string) => feldText(t, mutation.error, name);

  function senden() {
    if (mutation.isPending || !pruefeAlle()) return;
    const name = werte.name.trim();
    const kurzname = werte.kurzname.trim();
    const vintage = Number(werte.vintage);
    const zeichnungskapital = betragOderNichts(werte.zeichnungskapital, sprache) ?? "";
    const onSuccess = (neu: FondsDaten) => onGespeichert(neu.id);
    if (!fonds) {
      anlegen.mutate({ name, kurzname, vintage, zeichnungskapital, waehrung: werte.waehrung }, { onSuccess });
      return;
    }
    const json = {
      ...(werte.name !== fonds.name ? { name } : {}),
      ...(werte.kurzname !== fonds.kurzname ? { kurzname } : {}),
      ...(vintage !== fonds.vintage ? { vintage } : {}),
      ...(zeichnungskapital !== betragFuerFeld(fonds.zeichnungskapital) ? { zeichnungskapital } : {}),
    };
    if (Object.keys(json).length === 0) onSchliessen();
    else aendern.mutate({ id: fonds.id, json }, { onSuccess });
  }

  return (
    <Seitenpanel titel={titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{titel}</h2>
      <form className="app-formular" noValidate onSubmit={(e) => { e.preventDefault(); senden(); }}>
        <FehlerHinweis fehler={mutation.error} bekannt={FELDER} />
        <Feld label={f.name} required maxLength={200} {...feld("name", feldfehler("name"))} />
        <Feld label={f.kurzname} required maxLength={80} {...feld("kurzname", feldfehler("kurzname"))} />
        <Feld label={f.vintage} type="number" min={1} max={9999} step={1} required {...feld("vintage", feldfehler("vintage"))} />
        <BetragFeld label={f.zeichnungskapital} required {...feld("zeichnungskapital", feldfehler("zeichnungskapital"))} />
        <WaehrungAuswahl label={f.waehrung} hilfe={fonds ? undefined : f.waehrungHinweis} required={!fonds} disabled={Boolean(fonds)} {...feld("waehrung", feldfehler("waehrung"))} />
        <div className="app-aktionen__knoepfe">
          <Button variante="sekundaer" onClick={onSchliessen}>{f.abbrechen}</Button>
          <Button variante="primaer" type="submit" disabled={mutation.isPending}>{fonds ? f.speichern : f.anlegen}</Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
