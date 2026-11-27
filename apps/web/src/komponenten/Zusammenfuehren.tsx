import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button, Hinweis, Tabelle, type TabelleSpalte } from "@carraway/ui";
import { useOrganisationenVorschau, useOrganisationenZusammenfuehren, usePersonenVorschau, usePersonenZusammenfuehren } from "../api/mutationen";
import { useT } from "../i18n";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "./FehlerHinweis";
import type { Treffer } from "./KontaktAuswahl";
import { VerknuepfungsFeld } from "./Suchfeld";

type Seite = "ziel" | "quelle";
export interface Vorschlag extends Treffer {
  info: string;
}

/** Form beider Vorschauen, soweit die Oberfläche sie braucht. Alles Rechnerische (Zählung, Regeln) liefert die API. */
interface Vorschau {
  ziel: { id: string };
  quelle: { id: string };
  felder: { feld: string; ziel: string | null; quelle: string | null; abweichend: boolean; vorschlag: Seite }[];
  verschiebt: Record<string, number>;
  freigabeNoetig?: boolean;
  darfAusfuehren?: boolean;
  ueberschneidungen?: unknown[];
  ueberschneidungVerdeckt?: boolean;
}

/**
 * Zusammenführen in drei Schritten: Gegenstück wählen, Vorschau mit Feldwahl, ausführen. Die Seite, von der aus gestartet wird, bleibt
 * standardmäßig der bleibende Datensatz; „Reihenfolge tauschen“ kehrt das um. Der zusammengeführte Datensatz wird nie gelöscht.
 */
export function ZusammenfuehrenDialog({ art, id, name, vorschlaege, onSchliessen }: { art: "organisation" | "person"; id: string; name: string; vorschlaege: Vorschlag[]; onSchliessen: () => void }) {
  const t = useT();
  const z = t.zusammenfuehren;
  const navigate = useNavigate();
  const orgVorschau = useOrganisationenVorschau();
  const personVorschau = usePersonenVorschau();
  const orgAusfuehren = useOrganisationenZusammenfuehren();
  const personAusfuehren = usePersonenZusammenfuehren();
  const vorschauAktion = art === "organisation" ? orgVorschau : personVorschau;
  const ausfuehren = art === "organisation" ? orgAusfuehren : personAusfuehren;
  const [anderer, setAnderer] = useState<Treffer | null>(null);
  const [getauscht, setGetauscht] = useState(false);
  const [wahl, setWahl] = useState<Record<string, Seite>>({});
  const vorschau = vorschauAktion.data as Vorschau | undefined;

  const zielId = getauscht ? (anderer?.id ?? id) : id;
  const quelleId = getauscht ? id : (anderer?.id ?? "");

  // Vorschau laden, sobald ein Gegenstück gewählt ist oder die Reihenfolge wechselt.
  useEffect(() => {
    if (!anderer) return;
    setWahl({});
    vorschauAktion.mutate({ id: zielId, quelleId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anderer?.id, getauscht]);

  const gilt = (feld: Vorschau["felder"][number]): Seite => wahl[feld.feld] ?? feld.vorschlag;
  const anzeige = (feld: string, wert: string | null) => (wert === null || wert === "" ? z.ohneWert : feld === "organisationId" ? z.gesetzt : wert);
  const blockiert = vorschau ? (vorschau.ueberschneidungen?.length ?? 0) > 0 || vorschau.ueberschneidungVerdeckt === true || vorschau.darfAusfuehren === false : true;

  function senden() {
    if (!vorschau) return;
    const felder = Object.fromEntries(vorschau.felder.filter((f) => f.abweichend).map((f) => [f.feld, gilt(f)]));
    const erfolg = { onSuccess: () => void navigate(art === "organisation" ? { to: "/organizations/$id", params: { id: zielId } } : { to: "/people/$id", params: { id: zielId } }).then(onSchliessen) };
    if (art === "organisation") orgAusfuehren.mutate({ id: zielId, json: { quelleId, felder } }, erfolg);
    else personAusfuehren.mutate({ id: zielId, json: { quelleId, felder } }, erfolg);
  }

  const spalten: TabelleSpalte<Vorschau["felder"][number]>[] = [
    { schluessel: "feld", kopf: z.spalten.feld, zelle: (f) => z.feld[f.feld as keyof typeof z.feld] ?? f.feld },
    { schluessel: "ziel", kopf: z.spalten.ziel, zelle: (f) => anzeige(f.feld, f.ziel) },
    { schluessel: "quelle", kopf: z.spalten.quelle, zelle: (f) => anzeige(f.feld, f.quelle) },
    {
      schluessel: "gilt",
      kopf: z.spalten.gilt,
      zelle: (f) =>
        f.abweichend ? (
          <span className="app-knoepfe">
            {(["ziel", "quelle"] as const).map((seite) => (
              <label key={seite} className="app-haken">
                <input
                  type="radio"
                  name={`wahl-${f.feld}`}
                  checked={gilt(f) === seite}
                  aria-label={z.wahlName(z.feld[f.feld as keyof typeof z.feld] ?? f.feld, seite === "ziel" ? z.seiteZiel : z.seiteQuelle)}
                  onChange={() => setWahl((alt) => ({ ...alt, [f.feld]: seite }))}
                />
                <span aria-hidden="true">{seite === "ziel" ? z.spalten.ziel : z.spalten.quelle}</span>
              </label>
            ))}
          </span>
        ) : (
          t.gemeinsam.keinWert
        ),
    },
  ];

  return (
    <Seitenpanel titel={art === "organisation" ? z.titelOrganisation : z.titelPerson} onSchliessen={onSchliessen} breit>
      <h2 className="cw-t-untertitel">{art === "organisation" ? z.titelOrganisation : z.titelPerson}</h2>
      {!anderer ? (
        <div className="app-formular">
          <p className="app-leer-text">{z.einleitung}</p>
          <VerknuepfungsFeld ziel={art} label={z.suche} wert={null} ausschliessen={new Set([id])} onWahl={setAnderer} />
          <h3 className="app-gruppen-titel">{z.vorschlaege}</h3>
          {vorschlaege.length === 0 ? (
            <p className="app-leer-text">{z.keineVorschlaege}</p>
          ) : (
            <ul className="app-auswahlliste" aria-label={z.vorschlaege}>
              {vorschlaege.map((v) => (
                <li key={v.id}>
                  <button type="button" className="app-auswahlliste__knopf" onClick={() => setAnderer({ id: v.id, label: v.label })}>
                    {v.label}
                    <span className="app-dubletten__info">{v.info}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="app-formular">
          <FehlerHinweis fehler={vorschauAktion.error ?? ausfuehren.error} />
          {!vorschau ? (
            vorschauAktion.isError ? null : (
              <p className="app-leer-text" role="status">
                {z.laedtVorschau}
              </p>
            )
          ) : (
            <>
              <p className="app-leer-text">
                <strong>{z.bleibt}:</strong> {getauscht ? anderer.label : name} {z.weich}
              </p>
              <Button variante="sekundaer" onClick={() => setGetauscht((x) => !x)}>
                {z.tauschen}
              </Button>
              <h3 className="app-gruppen-titel">{z.umzug}</h3>
              <ul className="app-liste-klein">
                {Object.entries(vorschau.verschiebt).map(([schluessel, n]) => (
                  <li key={schluessel}>
                    {z.verschiebt[schluessel as keyof typeof z.verschiebt] ?? schluessel}: <span className="app-zahl">{n}</span>
                  </li>
                ))}
              </ul>
              <h3 className="app-gruppen-titel">{z.felder}</h3>
              <Tabelle beschriftung={z.felder} spalten={spalten} zeilen={vorschau.felder} zeilenSchluessel={(f) => f.feld} />
              {vorschau.freigabeNoetig ? <Hinweis>{z.freigabeNoetig}</Hinweis> : null}
              {vorschau.darfAusfuehren === false ? <Hinweis variante="fehler">{z.keineFreigabe}</Hinweis> : null}
              {(vorschau.ueberschneidungen?.length ?? 0) > 0 || vorschau.ueberschneidungVerdeckt ? <Hinweis variante="fehler">{z.ueberschneidung}</Hinweis> : null}
              <div>
                <Button variante="gefahr" disabled={blockiert || ausfuehren.isPending} onClick={senden}>
                  {z.ausfuehren}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Seitenpanel>
  );
}
