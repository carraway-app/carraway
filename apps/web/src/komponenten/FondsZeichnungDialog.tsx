import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Hinweis, Seitenpanel } from "@carraway/ui";
import { useFondsZeichnungenAnlegen, zeichnungsOrganisationen } from "../api/verwaltung";
import { useSprache, useT } from "../i18n";
import { feldText } from "../i18n/fehler";
import { formatBetragCent } from "../lib/zahl";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragOderNichts } from "./formular";
import { BetragFeld } from "./BetragFeld";
import { betragRegel } from "../lib/feldpruefung";
import { pruefungText } from "./formular";

interface Props {
  fondsId: string;
  zeichnungskapital: string;
  waehrung: string;
  onSchliessen: () => void;
  onErfolg: () => void;
}

const zusageRegel = betragRegel({ vorzeichen: "positiv", pflicht: true });
const leereZeile = (id: number) => ({ id, organisationId: "", zusage: "" });

export function FondsZeichnungDialog({ fondsId, zeichnungskapital, waehrung, onSchliessen, onErfolg }: Props) {
  const t = useT();
  const sprache = useSprache();
  const v = t.verwaltung.investoren;
  const z = v.fonds.zeichnungen;
  const { data: organisationen, isPending, error } = useQuery(zeichnungsOrganisationen());
  const anlegen = useFondsZeichnungenAnlegen(fondsId);
  const [zeilen, setZeilen] = useState(() => [leereZeile(0)]);
  const [naechsteId, setNaechsteId] = useState(1);
  // Zeilen sind dynamisch (kein `useFormular`): Die Zusage wird beim Verlassen, beim Absenden und bei nicht behebbaren Fehlern sofort gemeldet.
  const [beruehrt, setBeruehrt] = useState<Record<number, boolean>>({});
  const [versucht, setVersucht] = useState(false);
  const zusagePruefung = (zusage: string) => zusageRegel(zusage, {}, { sprache });
  const hatOrganisationen = !!organisationen?.length;

  function aendern(id: number, werte: Partial<Pick<ReturnType<typeof leereZeile>, "organisationId" | "zusage">>) {
    setZeilen((alt) => alt.map((zeile) => zeile.id === id ? { ...zeile, ...werte } : zeile));
  }

  return (
    <Seitenpanel titel={z.anlegen} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{z.anlegen}</h2>
      <p>{z.verteilung}</p>
      <Hinweis>{z.wirkung}</Hinweis>
      <p>{z.kapital} <strong>{formatBetragCent(zeichnungskapital, sprache, waehrung)}</strong></p>
      {isPending ? <p role="status">{t.gemeinsam.laedt}</p> : null}
      <FehlerHinweis fehler={error} />
      {organisationen && !hatOrganisationen ? <p>{z.keineOrganisationen}</p> : null}
      {hatOrganisationen ? (
        <form
          className="app-formular"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setVersucht(true);
            if (zeilen.some((zeile) => zusagePruefung(zeile.zusage) !== undefined || zeile.organisationId === "")) return;
            anlegen.mutate({
              zeichnungen: zeilen.map(({ organisationId, zusage }) => ({ organisationId, zusage: betragOderNichts(zusage, sprache) ?? "" })),
            }, { onSuccess: onErfolg });
          }}
        >
          <FehlerHinweis fehler={anlegen.error} />
          {zeilen.map(({ id, organisationId, zusage }, index) => (
            <fieldset className="app-formular" key={id}>
              <Auswahl label={v.form.organisation} required value={organisationId} onChange={(e) => aendern(id, { organisationId: e.target.value })} fehler={versucht && organisationId === "" ? pruefungText(sprache, { code: "pflicht" }) : undefined}>
                <option value="">{v.organisationWaehlen}</option>
                {organisationen.map((o) => (
                  <option key={o.id} value={o.id} disabled={zeilen.some((andere) => andere.id !== id && andere.organisationId === o.id)}>
                    {o.name}
                  </option>
                ))}
              </Auswahl>
              <BetragFeld label={z.zusage} required name={`zusage-${id}`} value={zusage} onChange={(e) => aendern(id, { zusage: e.target.value })}
                onBlur={() => setBeruehrt((alt) => ({ ...alt, [id]: true }))}
                fehler={(() => {
                  const p = zusagePruefung(zusage);
                  return p && (versucht || beruehrt[id] || p.sofort) ? pruefungText(sprache, p) : feldText(t, anlegen.error, `zeichnungen.${index}.zusage`);
                })()} />
              {zeilen.length > 1 ? <Button variante="ruhig" onClick={() => setZeilen((alt) => alt.filter((zeile) => zeile.id !== id))}>{t.gemeinsam.entfernen}</Button> : null}
            </fieldset>
          ))}
          <div className="app-knoepfe">
            <Button
              variante="sekundaer"
              disabled={zeilen.length >= Math.min(200, organisationen.length)}
              onClick={() => {
                setZeilen((alt) => [...alt, leereZeile(naechsteId)]);
                setNaechsteId(naechsteId + 1);
              }}
            >
              {z.weitere}
            </Button>
            <Button type="submit" disabled={anlegen.isPending}>{z.anlegen}</Button>
          </div>
        </form>
      ) : null}
    </Seitenpanel>
  );
}
