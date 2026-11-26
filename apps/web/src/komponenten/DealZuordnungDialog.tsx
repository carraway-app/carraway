import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Hinweis, Seitenpanel } from "@carraway/ui";
import { dealArbeitsliste, dealZustaendige, istZuordnungskonflikt, useDealZuordnen, type Arbeitsdeal, type Zuordnung } from "../api/dealflow";
import { useSprache, useT } from "../i18n";
import { feldText } from "../i18n/fehler";
import { FehlerHinweis } from "./FehlerHinweis";

const ROLLEN = [
  { id: "investmentmanagerId", name: "investmentmanagerName", label: "investmentmanager" },
  { id: "projektleiterId", name: "projektleiterName", label: "projektleiter" },
] as const;

export function DealZuordnungDialog({ deal, onSchliessen, onGespeichert }: {
  deal: Arbeitsdeal;
  onSchliessen: () => void;
  onGespeichert: () => void;
}) {
  const t = useT();
  const f = t.dealflow;
  const sprache = useSprache();
  const idPrefix = useId();
  const [basis, setBasis] = useState(deal);
  const [entwurf, setEntwurf] = useState<Partial<Zuordnung>>({});
  const [nichtVerfuegbar, setNichtVerfuegbar] = useState(false);
  const [laedtNeu, setLaedtNeu] = useState(false);
  const [ladeFehler, setLadeFehler] = useState<Error | null>(null);
  const zustaendige = useQuery(dealZustaendige(deal.id));
  const arbeitsliste = useQuery({ ...dealArbeitsliste(), enabled: false });
  const speichern = useDealZuordnen();
  const konflikt = istZuordnungskonflikt(speichern.error);
  const benutzer = zustaendige.data?.benutzer ?? [];
  const hatAenderung = ROLLEN.some(({ id }) => id in entwurf);
  const vergleichsname = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase(sprache);
  const bisherigeBetreuung = basis.betreuung && vergleichsname(basis.betreuung);
  const treffer = bisherigeBetreuung && !basis.investmentmanagerId && !entwurf.investmentmanagerId
    ? benutzer.filter((b) => vergleichsname(b.name) === bisherigeBetreuung)
    : [];
  const vorschlag = zustaendige.isSuccess && treffer.length === 1 ? treffer[0] : undefined;

  async function neuLaden() {
    setLaedtNeu(true);
    setLadeFehler(null);
    const [liste, auswahl] = await Promise.all([arbeitsliste.refetch(), zustaendige.refetch()]);
    setLaedtNeu(false);
    if (liste.isError || auswahl.isError) {
      setLadeFehler(liste.error ?? auswahl.error);
      return;
    }
    const aktuell = liste.data?.deals.find((d) => d.id === deal.id);
    if (!aktuell) {
      setNichtVerfuegbar(true);
      return;
    }
    setBasis(aktuell);
    setEntwurf({});
    speichern.reset();
    requestAnimationFrame(() => document.getElementById(`${idPrefix}-investmentmanagerId`)?.focus());
  }

  return (
    <Seitenpanel titel={f.zuordnen} onSchliessen={onSchliessen}>
      <form className="app-formular" onSubmit={(e) => {
        e.preventDefault();
        if (speichern.isPending || konflikt || nichtVerfuegbar || !hatAenderung || !zustaendige.isSuccess) return;
        speichern.mutate({ deal: basis, ...entwurf }, { onSuccess: onGespeichert });
      }}>
        <h2 className="cw-t-untertitel">{f.zuordnen}</h2>
        <p className="app-dealflow__bezugsname">{deal.titel}</p>
        {basis.betreuung ? <p>{f.altBetreuung} · {basis.betreuung}</p> : null}
        {vorschlag && !konflikt && !nichtVerfuegbar ? (
          <div>
            <Button variante="sekundaer" disabled={speichern.isPending} onClick={() => {
              setEntwurf((alt) => ({ ...alt, investmentmanagerId: vorschlag.id }));
              document.getElementById(`${idPrefix}-investmentmanagerId`)?.focus();
            }}>{f.altBetreuungUebernehmen(vorschlag.name)}</Button>
          </div>
        ) : null}
        {konflikt ? (
          <Hinweis variante="fehler" titel={t.fehler.deal_assignment_conflict}>
            {nichtVerfuegbar ? f.nichtMehrOffen : f.konfliktBearbeiten}
          </Hinweis>
        ) : <FehlerHinweis fehler={speichern.error} bekannt={ROLLEN.map(({ id }) => id)} />}
        <FehlerHinweis fehler={ladeFehler ?? zustaendige.error} />
        {zustaendige.isPending ? <p role="status">{t.gemeinsam.laedt}</p> : null}
        {ROLLEN.map(({ id, name, label }) => {
          const aktuell = basis[id];
          return (
            <Auswahl
              key={id}
              id={`${idPrefix}-${id}`}
              label={f[label]}
              value={(id in entwurf ? entwurf[id] : aktuell) ?? ""}
              disabled={!zustaendige.isSuccess || speichern.isPending || konflikt || nichtVerfuegbar}
              fehler={feldText(t, speichern.error, id)}
              onChange={(e) => {
                const neu = e.target.value || null;
                setEntwurf((alt) => {
                  const daten = { ...alt };
                  if (neu === aktuell) delete daten[id];
                  else daten[id] = neu;
                  return daten;
                });
              }}
            >
              <option value="">{f.nichtZugeordnet}</option>
              {aktuell && !benutzer.some((b) => b.id === aktuell) ? <option value={aktuell} disabled>{basis[name] ?? t.gemeinsam.keinWert}</option> : null}
              {benutzer.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Auswahl>
          );
        })}
        <div>
          {konflikt && !nichtVerfuegbar ? (
            <Button disabled={laedtNeu} onClick={() => void neuLaden()}>{f.neuLaden}</Button>
          ) : (
            <Button type="submit" disabled={!hatAenderung || !zustaendige.isSuccess || speichern.isPending || nichtVerfuegbar}>{t.crm.speichern}</Button>
          )}
        </div>
      </form>
    </Seitenpanel>
  );
}
