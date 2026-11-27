import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Auswahl, Button, Feld, Seitenpanel, Status, Tabelle, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { vehikelDesInvestors, type VehikelEintrag } from "../api/abfragen";
import { useVehikelAendern, useVehikelAnlegen, useVehikelLoeschen } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { formatAnzahl, formatBetragCent } from "../lib/zahl";
import { FehlerHinweis } from "./FehlerHinweis";
import { useFormular } from "./formular";
import { Skelettzeilen } from "./Skelett";

type Position = VehikelEintrag["positionen"][number];
const ARTEN = ["fonds", "gesellschaft", "spv", "sonstige"] as const;
const STATUS = ["aktiv", "in_liquidation", "aufgeloest"] as const;

/**
 * Abschnitt „Vehikel“ eines Investors: die Fonds und Gesellschaften, über die er investiert (Name, Art, Auflagejahr, Status, Positionen) mit Anlegen,
 * Bearbeiten und Löschen ohne Positionen, darunter die Beteiligungen je Vehikel (nur Runden, die die Person sehen darf).
 */
export function VehikelAbschnitt({ organisationId, schreiben }: { organisationId: string; schreiben: boolean }) {
  const t = useT();
  const v = t.finanzierungsrunden.vehikel;
  const sprache = useSprache();
  const { data, error, isPending } = useQuery(vehikelDesInvestors(organisationId));
  const loeschen = useVehikelLoeschen();
  const [dialog, setDialog] = useState<{ vehikel?: VehikelEintrag } | null>(null);

  const spalten: TabelleSpalte<VehikelEintrag>[] = [
    {
      schluessel: "name",
      kopf: v.spalten.name,
      zelle: (x) => (
        <span className="app-zusammenhang">
          {x.name}
          {x.standard ? <Status>{v.standard}</Status> : null}
        </span>
      ),
    },
    { schluessel: "art", kopf: v.spalten.art, zelle: (x) => aufzaehlung(v.arten, x.art) },
    { schluessel: "auflagejahr", kopf: v.spalten.auflagejahr, zahl: true, zelle: (x) => x.auflagejahr ?? t.gemeinsam.keinWert },
    { schluessel: "status", kopf: v.spalten.status, zelle: (x) => <Status variante={x.status === "aktiv" ? "freigegeben" : "entwurf"}>{aufzaehlung(v.status, x.status)}</Status> },
    { schluessel: "positionen", kopf: v.spalten.positionen, zahl: true, zelle: (x) => x.anzahlPositionen },
    ...(schreiben
      ? [
          {
            schluessel: "aktion",
            kopf: v.spalten.aktion,
            zelle: (x: VehikelEintrag) => (
              <span className="app-zusammenhang">
                <Button variante="sekundaer" aria-label={v.bearbeitenFuer(x.name)} onClick={() => setDialog({ vehikel: x })}>
                  {v.bearbeiten}
                </Button>
                <Button variante="gefahr" aria-label={v.loeschenFuer(x.name)} title={x.anzahlPositionen > 0 ? v.loeschenGesperrt : undefined} disabled={x.anzahlPositionen > 0 || loeschen.isPending} onClick={() => loeschen.mutate(x.id)}>
                  {v.loeschen}
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];
  const positionSpalten: TabelleSpalte<Position>[] = [
    {
      schluessel: "unternehmen",
      kopf: v.positionenSpalten.unternehmen,
      zelle: (p) => (
        <Link to="/organizations/$id" params={{ id: p.unternehmen.id }} search={{ tab: "runden" }}>
          {p.unternehmen.name}
        </Link>
      ),
    },
    {
      schluessel: "runde",
      kopf: v.positionenSpalten.runde,
      zelle: (p) => (
        <span className="app-zusammenhang">
          {p.runde}
          {p.status === "entwurf" ? <Status variante="entwurf">{v.entwurf}</Status> : null}
        </span>
      ),
    },
    { schluessel: "datum", kopf: v.positionenSpalten.datum, zelle: (p) => formatDatum(p.datum, sprache) },
    { schluessel: "rolle", kopf: v.positionenSpalten.rolle, zelle: (p) => aufzaehlung(t.rundenRolle, p.rolle) },
    { schluessel: "betrag", kopf: v.positionenSpalten.betrag, zahl: true, zelle: (p) => formatBetragCent(p.betrag, sprache) },
    { schluessel: "anteile", kopf: v.positionenSpalten.anteile, zahl: true, zelle: (p) => formatAnzahl(p.anteile, sprache) },
  ];
  const mitPositionen = (data ?? []).filter((x) => x.anzahlPositionen > 0);

  return (
    <>
      <section className="app-karte" aria-labelledby="abschnitt-vehikel">
        <div className="app-karte__kopf">
          <h2 id="abschnitt-vehikel" className="cw-t-untertitel app-karte__titel">
            {v.titel}
          </h2>
          {schreiben ? <Button onClick={() => setDialog({})}>{v.neu}</Button> : null}
        </div>
        <p className="app-leer-text">{v.beschreibung}</p>
        <FehlerHinweis fehler={loeschen.error} />
        {isPending ? <Skelettzeilen anzahl={2} /> : null}
        {error ? <FehlerHinweis fehler={error} /> : null}
        {data && data.length === 0 ? <p className="app-leer-text">{v.keine}</p> : null}
        {data && data.length > 0 ? <Tabelle dicht beschriftung={v.tabelle} spalten={spalten} zeilen={data} zeilenSchluessel={(x) => x.id} /> : null}
      </section>
      {mitPositionen.length > 0 ? (
        <section className="app-karte" aria-labelledby="abschnitt-vehikel-positionen">
          <h2 id="abschnitt-vehikel-positionen" className="cw-t-untertitel app-karte__titel">
            {v.positionenTitel}
          </h2>
          {mitPositionen.map((x) => (
            <div key={x.id} className="app-gruppe">
              <h3 className="cw-feld__label">{x.name}</h3>
              {x.positionen.length > 0 ? <Tabelle dicht beschriftung={v.positionenTabelle(x.name)} spalten={positionSpalten} zeilen={x.positionen} zeilenSchluessel={(p) => p.id} /> : null}
              {x.anzahlPositionen > x.positionen.length ? <p className="app-leer-text">{v.verdeckt(x.anzahlPositionen - x.positionen.length)}</p> : null}
            </div>
          ))}
        </section>
      ) : null}
      {dialog ? <VehikelDialog organisationId={organisationId} {...(dialog.vehikel ? { vehikel: dialog.vehikel } : {})} onSchliessen={() => setDialog(null)} /> : null}
    </>
  );
}

/** Neues Vehikel oder Änderung (Name, Art, Auflagejahr, Status, Standard). */
function VehikelDialog({ organisationId, vehikel, onSchliessen }: { organisationId: string; vehikel?: VehikelEintrag; onSchliessen: () => void }) {
  const t = useT();
  const v = t.finanzierungsrunden.vehikel;
  const f = v.form;
  const anlegen = useVehikelAnlegen();
  const aendern = useVehikelAendern();
  const mutation = vehikel ? aendern : anlegen;
  const { werte, feld } = useFormular({ name: vehikel?.name ?? "", art: vehikel?.art ?? "fonds", auflagejahr: vehikel?.auflagejahr ? String(vehikel.auflagejahr) : "", status: vehikel?.status ?? "aktiv" });
  const [standard, setStandard] = useState(vehikel?.standard ?? false);
  const titel = vehikel ? f.titelAendern : f.titelNeu;

  function absenden() {
    const jahr = werte.auflagejahr.trim() === "" ? null : Number(werte.auflagejahr.trim());
    const koerper = { name: werte.name.trim(), art: werte.art as (typeof ARTEN)[number], auflagejahr: jahr, status: werte.status as (typeof STATUS)[number] };
    if (vehikel) aendern.mutate({ id: vehikel.id, ...koerper, ...(standard && !vehikel.standard ? { standard: true as const } : {}) }, { onSuccess: onSchliessen });
    else anlegen.mutate({ organisationId, ...koerper, ...(standard ? { standard: true } : {}) }, { onSuccess: onSchliessen });
  }

  return (
    <Seitenpanel titel={titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{titel}</h2>
      <p className="app-leer-text">{f.beschreibung}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          absenden();
        }}
      >
        <FehlerHinweis fehler={mutation.error} bekannt={["name", "art", "auflagejahr", "status"]} />
        <Feld label={f.name} {...feld("name")} fehler={feldText(t, mutation.error, "name")} />
        <Auswahl label={f.art} {...feld("art")}>
          {ARTEN.map((a) => (
            <option key={a} value={a}>
              {aufzaehlung(v.arten, a)}
            </option>
          ))}
        </Auswahl>
        <Feld label={f.auflagejahr} zahl inputMode="numeric" {...feld("auflagejahr")} fehler={feldText(t, mutation.error, "auflagejahr")} />
        <Auswahl label={f.status} {...feld("status")}>
          {STATUS.map((x) => (
            <option key={x} value={x}>
              {aufzaehlung(v.status, x)}
            </option>
          ))}
        </Auswahl>
        {vehikel?.standard ? null : (
          <label className="app-haken">
            <input type="checkbox" checked={standard} onChange={(e) => setStandard(e.target.checked)} />
            <span>{f.standard}</span>
          </label>
        )}
        <div>
          <Button type="submit" disabled={mutation.isPending || werte.name.trim() === ""}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
