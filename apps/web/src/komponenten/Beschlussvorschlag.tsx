import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Auswahl, Button, Hinweis, Segment, Textbereich } from "@carraway/ui";
import { beschlussvorlagen } from "../api/abfragen";
import { useBeschlussvorschlagAusVorlage, useDealAendern } from "../api/mutationen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "./FehlerHinweis";

const INSTRUMENTE = ["offene_beteiligung", "stille_beteiligung", "darlehen", "wandeldarlehen"] as const;
type Instrument = (typeof INSTRUMENTE)[number];

function VorlageDialog({ dealId, fondsId, ersetzt, onSchliessen }: { dealId: string; fondsId: string | null; ersetzt: boolean; onSchliessen: () => void }) {
  const t = useT();
  const b = t.beschlussvorschlag;
  const abfrage = useQuery(beschlussvorlagen(fondsId ?? undefined));
  const einsetzen = useBeschlussvorschlagAusVorlage(dealId);
  const [vorlageId, setVorlageId] = useState("");
  const [instrument, setInstrument] = useState<"" | Instrument>("");
  const [sprache, setSprache] = useState<"de" | "en">(useSprache());
  const vorlagen = abfrage.data?.daten ?? [];
  const gewaehlt = vorlageId || vorlagen[0]?.id || "";
  return (
    <Seitenpanel titel={b.dialogTitel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{b.dialogTitel}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (gewaehlt) einsetzen.mutate({ vorlageId: gewaehlt, sprache, ...(instrument ? { instrument } : {}) }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={einsetzen.error} />
        {abfrage.isSuccess && vorlagen.length === 0 ? (
          <Hinweis>
            {b.keineVorlagen} <Link to="/decision-proposals" search={{}}>{b.zuVorlagen}</Link>
          </Hinweis>
        ) : (
          <>
            <Auswahl label={b.vorlage} value={gewaehlt} onChange={(e) => setVorlageId(e.target.value)}>
              {vorlagen.map((v) => (
                <option key={v.id} value={v.id}>
                  {fondsId ? v.name : `${v.fonds.name}: ${v.name}`}
                </option>
              ))}
            </Auswahl>
            <Auswahl label={b.instrument} value={instrument} onChange={(e) => setInstrument(e.target.value as "" | Instrument)}>
              <option value="">{b.keinInstrument}</option>
              {INSTRUMENTE.map((i) => (
                <option key={i} value={i}>
                  {aufzaehlung(t.instrument, i)}
                </option>
              ))}
            </Auswahl>
            <div className="app-gruppe">
              <span className="app-kopf__beschriftung" id="vorschlag-sprache">
                {b.sprache}
              </span>
              <Segment<"de" | "en"> aria-labelledby="vorschlag-sprache" value={sprache} onChange={setSprache} options={[{ wert: "de", label: t.kopf.sprachen.de }, { wert: "en", label: t.kopf.sprachen.en }]} />
            </div>
            {ersetzt ? <Hinweis>{b.ersetzt}</Hinweis> : null}
            <div>
              <Button type="submit" disabled={!gewaehlt || einsetzen.isPending}>
                {b.einsetzen}
              </Button>
            </div>
          </>
        )}
      </form>
    </Seitenpanel>
  );
}

function HandDialog({ dealId, text, onSchliessen }: { dealId: string; text: string; onSchliessen: () => void }) {
  const t = useT();
  const b = t.beschlussvorschlag;
  const aendern = useDealAendern(dealId);
  const [wert, setWert] = useState(text);
  return (
    <Seitenpanel titel={b.handTitel} onSchliessen={onSchliessen} breit>
      <h2 className="cw-t-untertitel">{b.handTitel}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          aendern.mutate({ beschlussvorschlag: wert.trim() === "" ? null : wert.trim() }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={aendern.error} />
        <Textbereich label={b.text} rows={10} value={wert} onChange={(e) => setWert(e.target.value)} />
        <div>
          <Button type="submit" disabled={aendern.isPending}>
            {b.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

/** Beschlussvorschlag eines Deals: Text (nur als Text dargestellt), „Vorschlag aus Vorlage“ und Änderung von Hand. */
export function BeschlussvorschlagAbschnitt({ dealId, fondsId, text, schreiben }: { dealId: string; fondsId: string | null; text: string | null; schreiben: boolean }) {
  const t = useT();
  const b = t.beschlussvorschlag;
  const [offen, setOffen] = useState<null | "vorlage" | "hand">(null);
  return (
    <section className="app-karte" aria-labelledby="abschnitt-vorschlag">
      <div className="app-karte__kopf">
        <h2 id="abschnitt-vorschlag" className="cw-t-untertitel app-karte__titel">
          {b.titel}
        </h2>
        {schreiben ? (
          <span className="app-knoepfe">
            <Button variante="sekundaer" onClick={() => setOffen("vorlage")}>
              {b.ausVorlage}
            </Button>
            <Button variante="sekundaer" onClick={() => setOffen("hand")}>
              {b.bearbeiten}
            </Button>
          </span>
        ) : null}
      </div>
      {text ? <p className="app-mehrzeilig">{text}</p> : <p className="app-leer-text">{b.leer}</p>}
      {offen === "vorlage" ? <VorlageDialog dealId={dealId} fondsId={fondsId} ersetzt={Boolean(text)} onSchliessen={() => setOffen(null)} /> : null}
      {offen === "hand" ? <HandDialog dealId={dealId} text={text ?? ""} onSchliessen={() => setOffen(null)} /> : null}
    </section>
  );
}
