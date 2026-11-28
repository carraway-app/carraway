import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Auswahl, Button, Feld, Seitenpanel } from "@carraway/ui";
import { fondsListe, fondsUebersicht } from "../api/abfragen-kern";
import { ApiFehler } from "../api/client";
import { heuteIso } from "../api/datum";
import { beteiligungsunternehmen, useBeteiligungAnlegen, type Beteiligungsunternehmen, type NeueBeteiligung } from "../api/portfolio";
import { useT } from "../i18n";
import { feldText } from "../i18n/fehler";
import { useRechte } from "../lib/rechte";
import { FehlerHinweis } from "./FehlerHinweis";
import { useEntprellt } from "./formular";
import { Combobox } from "./Suchfeld";

const INSTRUMENTE = ["offene_beteiligung", "stille_beteiligung", "darlehen", "wandeldarlehen", "venture_debt", "gesellschafterdarlehen", "safe"] as const satisfies readonly NeueBeteiligung["instrument"][];

export function BeteiligungAnlegen({ fondsId }: { fondsId?: string | undefined }) {
  const t = useT();
  const { darf } = useRechte();
  const { data } = useQuery(fondsListe());
  const [offen, setOffen] = useState(false);
  const fonds = (data ?? []).filter((f) => darf("bearbeiter", f.id, "portfolio"));
  if (!fonds.length || (fondsId && !fonds.some((f) => f.id === fondsId))) return null;

  return (
    <>
      <Button onClick={() => setOffen(true)}>{t.portfolio.anlage.titel}</Button>
      {offen ? <BeteiligungAnlegenDialog fonds={fonds} fondsId={fondsId ?? fonds[0]!.id} onSchliessen={() => setOffen(false)} /> : null}
    </>
  );
}

function BeteiligungAnlegenDialog({ fonds, fondsId, onSchliessen }: {
  fonds: { id: string; name: string }[];
  fondsId: string;
  onSchliessen: () => void;
}) {
  const t = useT();
  const f = t.portfolio.anlage;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [fondsWahl, setFondsWahl] = useState(fondsId);
  const [unternehmen, setUnternehmen] = useState<Beteiligungsunternehmen | null>(null);
  const [eingabe, setEingabe] = useState("");
  const [art, setArt] = useState<NeueBeteiligung["instrument"]>("offene_beteiligung");
  const [datum, setDatum] = useState(heuteIso);
  const anlegen = useBeteiligungAnlegen();
  const suchtext = unternehmen ? "" : eingabe.trim();
  const q = useEntprellt(suchtext, 200);
  const sucht = q === suchtext && q.length >= 2;
  const treffer = useQuery({ ...beteiligungsunternehmen(fondsWahl, q), enabled: sucht });
  const fehler = anlegen.error;
  const konflikt = fehler instanceof ApiFehler && fehler.code === "investment_exists" && typeof fehler.zusatz.beteiligungId === "string"
    ? fehler.zusatz.beteiligungId
    : null;
  const vorhanden = konflikt ?? unternehmen?.beteiligungId;
  const kannSpeichern = unternehmen && datum && !vorhanden && !anlegen.isPending;

  async function zumFonds(neu: { id: string; fondsId: string; erstinvestment: string }) {
    onSchliessen();
    const standard = await qc.fetchQuery(fondsUebersicht(neu.fondsId)).catch(() => null);
    const stichtag = standard && standard.stichtag >= neu.erstinvestment ? undefined : neu.erstinvestment;
    await navigate({ to: "/funds/$fundId", params: { fundId: neu.fondsId }, search: { hervorgehoben: neu.id, stichtag } });
  }

  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <form className="app-formular" onSubmit={(e) => {
        e.preventDefault();
        if (kannSpeichern) {
          anlegen.mutate({ fondsId: fondsWahl, organisationId: unternehmen.id, instrument: art, erstinvestment: datum }, { onSuccess: (neu) => void zumFonds(neu) });
        }
      }}>
        <FehlerHinweis fehler={fehler} bekannt={["organisationId", "instrument", "erstinvestment"]} />
        <Auswahl label={f.fonds} value={fondsWahl} disabled={anlegen.isPending} onChange={(e) => {
          setFondsWahl(e.target.value);
          setUnternehmen(null);
          setEingabe("");
          anlegen.reset();
        }}>
          {fonds.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Auswahl>
        <Combobox
          label={f.unternehmen}
          text={eingabe}
          required
          disabled={anlegen.isPending}
          fehler={feldText(t, fehler, "organisationId")}
          hilfe={unternehmen ? t.auswahl.gewaehlt(unternehmen.name) : undefined}
          onText={(neu) => {
            setEingabe(neu);
            setUnternehmen(null);
            anlegen.reset();
          }}
          optionen={sucht ? (treffer.data ?? []).map((x) => ({
            id: x.id,
            label: x.name,
            info: [x.ort, x.beteiligungId ? t.auswahl.vorhanden : null].filter(Boolean).join(" · "),
            wahl: () => {
              setUnternehmen(x);
              setEingabe(x.name);
              anlegen.reset();
            },
          })) : []}
          laedt={suchtext.length >= 2 && (!sucht || treffer.isFetching)}
          leerText={suchtext.length < 2 ? t.auswahl.hinweis : treffer.isError ? undefined : t.auswahl.keine}
        />
        {sucht && treffer.isError ? <FehlerHinweis fehler={treffer.error} /> : null}
        {vorhanden ? (
          <p role="status">
            <Link to="/investments/$id" params={{ id: vorhanden }} search={{}}>{f.vorhanden}</Link>
          </p>
        ) : null}
        <Auswahl label={t.portfolio.spalten.instrument} value={art} disabled={anlegen.isPending} onChange={(e) => setArt(e.target.value as NeueBeteiligung["instrument"])} fehler={feldText(t, fehler, "instrument")}>
          {INSTRUMENTE.map((x) => <option key={x} value={x}>{t.instrument[x]}</option>)}
        </Auswahl>
        <Feld label={f.erstinvestment} type="date" value={datum} onChange={(e) => setDatum(e.target.value)} required disabled={anlegen.isPending} fehler={feldText(t, fehler, "erstinvestment")} />
        <div><Button type="submit" disabled={!kannSpeichern}>{f.speichern}</Button></div>
      </form>
    </Seitenpanel>
  );
}
