import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Hinweis } from "@carraway/ui";
import { belegvorlagen, useBelegErzeugen, type BelegArt, type BezugArt } from "../api/buchhaltung";
import { ApiFehler } from "../api/client";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { useRechte } from "../lib/rechte";
import { Seitenpanel } from "@carraway/ui";
import { BelegFeldwert } from "./BelegFeldwert";
import { FehlerHinweis } from "./FehlerHinweis";

/**
 * „Beleg erzeugen“ an einem Vorgang, Zinslauf, Verkauf, Wandlung oder an der Beteiligung. Der Beleg wird aus den Daten vorbefüllt;
 * danach geht es zur Prüfung auf die Seite des Belegs. Gibt es schon einen Beleg zum Vorfall, führt der Knopf dorthin.
 */
type BelegBezug = { art: BelegArt; bezugArt: BezugArt; bezugId: string };

/**
 * Das Seitenpanel „Beleg erzeugen“; öffnet der Knopf oder ein Menüeintrag, steht es hier. Mit `fondsId` bietet es neben der Standardart
 * die aktiven eigenen Belegarten des Fonds mit derselben Basis-Art an.
 */
export function BelegPanel({ art, bezugArt, bezugId, fondsId, onSchliessen }: BelegBezug & { fondsId?: string; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const e = t.buchhaltung.erzeugen;
  const navigieren = useNavigate();
  const erzeugen = useBelegErzeugen();
  const [belegSprache, setBelegSprache] = useState<"de" | "en">(sprache);
  const { data: vorlagen } = useQuery({ ...belegvorlagen(fondsId ?? ""), enabled: Boolean(fondsId) });
  const eigene = (vorlagen ?? []).filter((v) => v.eigeneArtId && v.aktiv && (v.art === art || (bezugArt === "vorgang" && v.art === "frei")));
  const [eigeneArtId, setEigeneArtId] = useState("");
  const [werte, setWerte] = useState<Record<string, string>>({});
  const gewaehlt = eigene.find((v) => v.eigeneArtId === eigeneArtId) ?? (art === "frei" ? eigene[0] : undefined);
  const vorhanden = erzeugen.error instanceof ApiFehler && erzeugen.error.code === "BELEG_VORHANDEN" ? String(erzeugen.error.zusatz.belegId ?? "") : "";
  return (
    <Seitenpanel titel={e.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{e.titel}</h2>
      <p className="app-leer-text">{e.beschreibung}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          erzeugen.mutate(
            { art: gewaehlt?.art ?? art, ...(gewaehlt?.eigeneArtId ? { eigeneArtId: gewaehlt.eigeneArtId } : {}), ...(Object.keys(werte).length ? { werte } : {}), bezugArt, bezugId, sprache: belegSprache },
            { onSuccess: (beleg) => void navigieren({ to: "/belege/$id", params: { id: beleg.id } }) },
          );
        }}
      >
        {vorhanden ? (
          <Hinweis>
            <Link to="/belege/$id" params={{ id: vorhanden }}>
              {e.oeffnen}
            </Link>
          </Hinweis>
        ) : null}
        <FehlerHinweis fehler={erzeugen.error} bekannt={["art", "eigeneArtId", "bezugArt", "bezugId", "sprache"]} />
        {eigene.length > 0 ? (
          <Auswahl label={e.belegart} value={gewaehlt?.eigeneArtId ?? ""} onChange={(ev) => { setEigeneArtId(ev.target.value); setWerte({}); erzeugen.reset(); }}>
            {art !== "frei" ? <option value="">{aufzaehlung(t.buchhaltung.belegArt, art)}</option> : null}
            {eigene.map((v) => (
              <option key={v.eigeneArtId} value={v.eigeneArtId ?? ""}>
                {(sprache === "de" ? v.bezeichnungDe : v.bezeichnungEn) ?? ""}
              </option>
            ))}
          </Auswahl>
        ) : null}
        {gewaehlt?.felder.some((f) => f.manuell) ? (
          <div className="cw-formularraster">
            {gewaehlt.felder.filter((f) => f.manuell).map((f) => <BelegFeldwert key={f.schluessel} feld={f} wert={werte[f.schluessel] ?? ""} onChange={(wert) => setWerte((alt) => ({ ...alt, [f.schluessel]: wert }))} />)}
          </div>
        ) : null}
        <Auswahl label={e.sprache} value={belegSprache} onChange={(ev) => setBelegSprache(ev.target.value === "en" ? "en" : "de")}>
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </Auswahl>
        <div className="app-aktionen__knoepfe">
          <Button type="submit" disabled={erzeugen.isPending || (art === "frei" && !gewaehlt)}>
            {e.erzeugen}
          </Button>
          <Button type="button" variante="sekundaer" onClick={onSchliessen}>
            {e.abbrechen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

export function BelegKnopf({ art, bezugArt, bezugId, fondsId }: BelegBezug & { fondsId: string }) {
  const t = useT();
  const { darf } = useRechte();
  const [offen, setOffen] = useState(false);
  // Belege gehören zum Bereich Finanzen, auch wenn der Knopf auf einer Seite eines anderen Bereichs steht.
  const berechtigt = darf("bearbeiter", fondsId, "finanzen");
  const { data } = useQuery({ ...belegvorlagen(fondsId), enabled: berechtigt && art === "frei" });
  if (!berechtigt || (art === "frei" && !data?.some((v) => v.art === "frei" && v.aktiv))) return null;
  return (
    <>
      <Button variante="sekundaer" onClick={() => setOffen(true)}>
        {t.buchhaltung.erzeugen.knopf}
      </Button>
      {offen ? <BelegPanel art={art} bezugArt={bezugArt} bezugId={bezugId} fondsId={fondsId} onSchliessen={() => setOffen(false)} /> : null}
    </>
  );
}
