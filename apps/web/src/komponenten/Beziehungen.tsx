import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Feld, Segment } from "@carraway/ui";
import { fondsListe, type Organisation } from "../api/abfragen";
import { useBeziehungAnlegen, useBeziehungLoeschen } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useT } from "../i18n";
import { useRechte } from "../lib/rechte";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "./FehlerHinweis";
import { KontaktAuswahl, type Treffer } from "./KontaktAuswahl";
import { useFormular } from "./formular";
import { Datensatzlink } from "./crm/Datensatzlink";

type Art = "co_investor" | "berater" | "investor" | "sonstige";
const ARTEN: Art[] = ["co_investor", "berater", "investor", "sonstige"];
type Zeile = Organisation["beziehungen"][number];

const FELDER = ["vonOrganisationId", "zuOrganisationId", "fondsId", "art", "bemerkung"];

function BeziehungDialog({ organisationId, onSchliessen }: { organisationId: string; onSchliessen: () => void }) {
  const t = useT();
  const f = t.beziehungen.form;
  const anlegen = useBeziehungAnlegen();
  const fonds = useQuery(fondsListe());
  const [ziel, setZiel] = useState<"organisation" | "fonds">("organisation");
  const [gewaehlt, setGewaehlt] = useState<Treffer | null>(null);
  const [ohneWahl, setOhneWahl] = useState(false);
  const { werte, feld } = useFormular({ art: "co_investor", fondsId: "", bemerkung: "" });
  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const zielId = ziel === "organisation" ? gewaehlt?.id : werte.fondsId;
          if (!zielId) return setOhneWahl(true);
          anlegen.mutate(
            {
              vonOrganisationId: organisationId,
              art: werte.art as Art,
              ...(ziel === "organisation" ? { zuOrganisationId: zielId } : { fondsId: zielId }),
              ...(werte.bemerkung.trim() ? { bemerkung: werte.bemerkung.trim() } : {}),
            },
            { onSuccess: onSchliessen },
          );
        }}
      >
        <FehlerHinweis fehler={anlegen.error} bekannt={FELDER} />
        <Auswahl label={f.art} {...feld("art")} fehler={feldText(t, anlegen.error, "art")}>
          {ARTEN.map((a) => (
            <option key={a} value={a}>
              {t.beziehungen.aus[a]}
            </option>
          ))}
        </Auswahl>
        <div className="app-gruppe">
          <span className="app-kopf__beschriftung" id="beziehung-ziel">
            {f.ziel}
          </span>
          <Segment<"organisation" | "fonds"> aria-labelledby="beziehung-ziel" value={ziel} onChange={setZiel} options={[{ wert: "organisation", label: f.organisation }, { wert: "fonds", label: f.fonds }]} />
        </div>
        {ziel === "organisation" ? (
          <KontaktAuswahl art="organisation" label={f.organisation} ausser={organisationId} gewaehlt={gewaehlt} onWaehlen={setGewaehlt} fehler={ohneWahl && !gewaehlt ? t.auswahl.waehlen : undefined} />
        ) : (
          <Auswahl label={f.fondsFeld} {...feld("fondsId")} fehler={ohneWahl && !werte.fondsId ? t.auswahl.waehlen : feldText(t, anlegen.error, "fondsId")}>
            <option value="">{t.gemeinsam.keinWert}</option>
            {fonds.data?.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Auswahl>
        )}
        <Feld label={f.bemerkung} {...feld("bemerkung")} fehler={feldText(t, anlegen.error, "bemerkung")} />
        <div>
          <Button type="submit" disabled={anlegen.isPending}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

/** Beziehungen einer Organisation zu anderen Organisationen und Fonds, in beide Richtungen. */
export function BeziehungenAbschnitt({ organisationId, zeilen }: { organisationId: string; zeilen: Zeile[] }) {
  const t = useT();
  const { darf } = useRechte();
  const entfernen = useBeziehungLoeschen();
  const [offen, setOffen] = useState(false);
  const schreiben = darf("bearbeiter");
  const satz = (z: Zeile) => {
    const gegenueber = z.organisation?.name ?? z.fonds?.name ?? "";
    return z.richtung === "aus" ? `${aufzaehlung(t.beziehungen.aus, z.art)} ${gegenueber}` : `${gegenueber} ${aufzaehlung(t.beziehungen.ein, z.art)}`;
  };
  return (
    <section className="app-karte" aria-labelledby="abschnitt-beziehungen">
      <div className="app-karte__kopf">
        <h2 id="abschnitt-beziehungen" className="cw-t-untertitel app-karte__titel">
          {t.beziehungen.titel}
        </h2>
        {schreiben ? (
          <Button variante="sekundaer" onClick={() => setOffen(true)}>
            {t.beziehungen.hinzufuegen}
          </Button>
        ) : null}
      </div>
      <FehlerHinweis fehler={entfernen.error} />
      {zeilen.length === 0 ? (
        <p className="app-leer-text">{t.beziehungen.keine}</p>
      ) : (
        <ul className="app-liste">
          {zeilen.map((z) => (
            <li key={z.id}>
              {z.organisation ? (
                <>
                  {z.richtung === "aus" ? `${aufzaehlung(t.beziehungen.aus, z.art)} ` : null}
                  <Datensatzlink objekt="organisation" id={z.organisation.id}>
                    {z.organisation.name}
                  </Datensatzlink>
                  {z.richtung === "ein" ? ` ${aufzaehlung(t.beziehungen.ein, z.art)}` : null}
                </>
              ) : (
                satz(z)
              )}
              {z.bemerkung ? <span className="app-dubletten__info"> · {z.bemerkung}</span> : null}{" "}
              {schreiben ? (
                <Button variante="ruhig" disabled={entfernen.isPending} aria-label={t.beziehungen.entfernenName(satz(z))} onClick={() => entfernen.mutate(z.id)}>
                  {t.beziehungen.entfernen}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {offen ? <BeziehungDialog organisationId={organisationId} onSchliessen={() => setOffen(false)} /> : null}
    </section>
  );
}
