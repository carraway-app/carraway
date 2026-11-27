import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Auswahl, Button, Hinweis, Leer, Seitenkopf, Tabelle, Textbereich, Feld, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { beschlussvorlagen, fondsListe, type Beschlussvorlage } from "../api/abfragen";
import { ApiFehler } from "../api/client";
import { useVorlageAendern, useVorlageAnlegen, useVorlageLoeschen } from "../api/mutationen";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { useFormular } from "../komponenten/formular";
import { pflichtRegel } from "../lib/feldpruefung";
import { feldText } from "../i18n/fehler";
import { wirksamerFonds } from "../lib/fonds";
import { DATENSPRACHE } from "../lib/datensprache";
import { useRechte } from "../lib/rechte";
import { useSprache, useT } from "../i18n";
import { DealflowReiter } from "../komponenten/DealflowReiter";

const route = getRouteApi("/decision-proposals");

function VorlageDialog({ fondsId, vorlage, platzhalter, onSchliessen }: { fondsId: string; vorlage?: Beschlussvorlage; platzhalter: readonly string[]; onSchliessen: () => void }) {
  const t = useT();
  const f = t.beschlussvorlagen.form;
  const anlegen = useVorlageAnlegen();
  const aendern = useVorlageAendern();
  const aktion = vorlage ? aendern : anlegen;
  const { werte, feld, pruefeAlle } = useFormular({ name: vorlage?.name ?? "", text: vorlage?.text ?? "" }, { name: pflichtRegel(), text: pflichtRegel() });
  const titel = vorlage ? f.titelBearbeiten : f.titelNeu;
  const unbekannt = aktion.error instanceof ApiFehler && aktion.error.code === "placeholder_unknown" && Array.isArray(aktion.error.zusatz.unbekannt) ? (aktion.error.zusatz.unbekannt as string[]) : null;
  return (
    <Seitenpanel titel={titel} onSchliessen={onSchliessen} breit>
      <h2 className="cw-t-untertitel">{titel}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pruefeAlle()) return;
          const gemeinsam = { name: werte.name.trim(), text: werte.text.trim() };
          if (vorlage) aendern.mutate({ id: vorlage.id, json: gemeinsam }, { onSuccess: onSchliessen });
          else anlegen.mutate({ fondsId, ...gemeinsam }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={aktion.error} bekannt={["name", "text"]} />
        {unbekannt ? <Hinweis variante="fehler">{t.beschlussvorlagen.unbekannt(unbekannt.join(", "))}</Hinweis> : null}
        <Feld label={f.name} {...feld("name", feldText(t, aktion.error, "name"))} />
        <Textbereich label={f.text} rows={8} hilfe={f.platzhalter(platzhalter.map((p) => `{{${p}}}`).join(" "))} {...feld("text", feldText(t, aktion.error, "text"))} />
        <div>
          <Button type="submit" disabled={aktion.isPending}>
            {vorlage ? f.speichern : f.anlegen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

/** Beschlussvorlagen je Fonds: lesen alle mit Rolle, pflegen nur Verwalter dieses Fonds. */
export function BeschlussvorlagenSeite() {
  const { fondsId: gewaehlt } = route.useSearch();
  const fonds = useQuery(fondsListe());
  const aktuell = wirksamerFonds(fonds.data ?? [], gewaehlt);
  return <BeschlussvorlagenInhalt key={aktuell?.id} aktuell={aktuell} fonds={fonds.data ?? []} />;
}

function BeschlussvorlagenInhalt({ aktuell, fonds }: { aktuell: { id: string; name: string } | undefined; fonds: readonly { id: string; name: string }[] }) {
  const navigate = route.useNavigate();
  const t = useT();
  const v = t.beschlussvorlagen;
  const sprache = useSprache();
  const { darf } = useRechte();
  const abfrage = useQuery({ ...beschlussvorlagen(aktuell?.id), enabled: Boolean(aktuell) });
  const loeschen = useVorlageLoeschen();
  const [offen, setOffen] = useState<null | "neu" | Beschlussvorlage>(null);
  const verwalten = darf("verwalter", aktuell?.id, "dealflow");

  const spalten: TabelleSpalte<Beschlussvorlage>[] = [
    { schluessel: "name", kopf: v.spalten.name, zelle: (x) => x.name },
    { schluessel: "text", kopf: v.spalten.text, umbruch: true, zelle: (x) => <span className="app-mehrzeilig">{x.text}</span> },
    { schluessel: "aktualisiert", kopf: v.spalten.aktualisiert, zelle: (x) => formatDatum(x.aktualisiertAm, sprache) },
    {
      schluessel: "aktion",
      kopf: <span className="cw-nur-lesen">{v.spalten.aktion}</span>,
      zelle: (x) =>
        verwalten ? (
          <span className="app-knoepfe">
            <Button variante="sekundaer" aria-label={v.bearbeitenName(x.name)} onClick={() => setOffen(x)}>
              {v.bearbeiten}
            </Button>
            <Button variante="gefahr" disabled={loeschen.isPending} aria-label={v.loeschenName(x.name)} onClick={() => loeschen.mutate(x.id)}>
              {v.loeschen}
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <div className="app-seite">
      <Seitenkopf info={v.einleitung}
        zeitbezug={
          fonds.length > 1 && aktuell ? (
            // Beschlussvorlagen gehören zum Dealflow (globale Leiste); der Fonds wird hier gewählt.
            <Auswahl kompakt label={t.kopf.fonds} value={aktuell.id} onChange={(e) => void navigate({ search: { fondsId: e.target.value }, replace: true })}>
              {fonds.map((f) => (
                <option key={f.id} value={f.id} lang={DATENSPRACHE}>
                  {f.name}
                </option>
              ))}
            </Auswahl>
          ) : undefined
        }
        meta={aktuell && fonds.length <= 1 ? <span lang={DATENSPRACHE}>{aktuell.name}</span> : undefined}
        titel={v.titel}
        aktionen={
          <>
            {verwalten && aktuell ? <Button onClick={() => setOffen("neu")}>{v.neu}</Button> : null}
          </>
        }
      />
      <DealflowReiter aktiv="beschluesse">
      {aktuell && !verwalten ? <Hinweis>{v.nurVerwalter}</Hinweis> : null}
      <FehlerHinweis fehler={abfrage.error ?? loeschen.error} />
      <section className="app-karte">
        {!aktuell ? (
          <Leer titel={v.keineFonds} beschreibung="" />
        ) : abfrage.isPending ? (
          <div className="app-skelett app-skelett--zeile" aria-hidden="true" />
        ) : abfrage.data && abfrage.data.daten.length === 0 ? (
          <p className="app-leer-text">{v.keine}</p>
        ) : (
          <Tabelle beschriftung={v.titel} spalten={spalten} zeilen={abfrage.data?.daten ?? []} zeilenSchluessel={(x) => x.id} />
        )}
      </section>
      {offen && aktuell ? <VorlageDialog fondsId={aktuell.id} platzhalter={abfrage.data?.platzhalter ?? []} {...(offen === "neu" ? {} : { vorlage: offen })} onSchliessen={() => setOffen(null)} /> : null}
      </DealflowReiter>
    </div>
  );
}
