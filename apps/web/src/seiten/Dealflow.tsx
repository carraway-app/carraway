import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Auswahl, Button, KanbanIcon, Segment, Seitenkopf, Status, Tabs, TrayIcon, UserCircleIcon } from "@carraway/ui";
import { dealListe, fondsListe, type Deal } from "../api/abfragen";
import { crmAbfrage, useDealVerschieben, type AbfrageEingabe, type Gruppe, type Option, type Zeile } from "../api/crm";
import { dealArbeitsliste, dealKartenfelder, type Arbeitsdeal } from "../api/dealflow";
import type { DealPhase } from "../api/mutationen";
import { DealArbeitslisten, istUnzugeordnet } from "../komponenten/DealArbeitslisten";
import { DealKartenfelderDialog, DealKartenwerte, kartenUnternehmen, STANDARD_KARTENFELDER, waehlbareKartenfelder } from "../komponenten/DealKartenfelderDialog";
import { DealZuordnungDialog } from "../komponenten/DealZuordnungDialog";
import { DealPipelineErgebnisse, STATUS_VARIANTE, type PipelineDealtyp } from "../komponenten/DealPipelineErgebnisse";
import { Datensatzlink } from "../komponenten/crm/Datensatzlink";
import { Werkzeuge } from "../komponenten/crm/Werkzeuge";
import { PHASEN, optionenVon } from "../komponenten/crm/typen";
import { useAnsicht } from "../komponenten/crm/zustand";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { useEntprellt } from "../komponenten/formular";
import { NeuerDealDialog } from "../komponenten/NeuerDealDialog";
import { NurLesen } from "../komponenten/NurLesen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { useNamen } from "../lib/namen";
import { useRechte } from "../lib/rechte";

const route = getRouteApi("/dealflow");

export { PHASEN } from "../komponenten/crm/typen";
export { STATUS_VARIANTE } from "../komponenten/DealPipelineErgebnisse";
const STATUSWERTE = ["offen", "abgesagt", "investiert"] as const satisfies readonly Deal["status"][];

type DealAnlage = { phase?: DealPhase; dealtyp?: PipelineDealtyp };

const KARTENBASIS = ["titel", "unternehmen", "phase", "ticket", "status"];

export function DealflowSeite() {
  const t = useT();
  const { bereich = "pipeline", neu: neuParam } = route.useSearch();
  const navigate = route.useNavigate();
  const { darf } = useRechte();
  const darfAnlegen = darf("bearbeiter");
  const [neu, setNeu] = useState<DealAnlage | null>(null);
  const arbeitsliste = useQuery(dealArbeitsliste());
  const deals = arbeitsliste.data?.deals ?? [];
  const offenUnzugeordnet = deals.filter(istUnzugeordnet).length;
  const arbeitsdealNachId = new Map(deals.map((deal) => [deal.id, deal]));
  const darfZuordnen = (id: string) => {
    const deal = arbeitsdealNachId.get(id);
    return Boolean(deal && darf("bearbeiter", deal.fondsId, "dealflow"));
  };

  useEffect(() => {
    if (neuParam === "1" && darfAnlegen) {
      setNeu({});
      void navigate({ search: (alt) => ({ ...alt, neu: undefined }), replace: true });
    }
  }, [neuParam, darfAnlegen, navigate]);

  const ansichten = [
    { bereich: "eingang", titel: t.dealflow.eingang, icon: TrayIcon },
    { bereich: "meine", titel: t.dealflow.meineDeals, icon: UserCircleIcon },
    { bereich: "pipeline", titel: t.dealflow.pipeline, icon: KanbanIcon },
  ] as const;

  return (
    <div className="app-seite app-dealflow">
      <Seitenkopf
        titel={t.dealflow.titel}
        aktionen={
          <>
            <Link to="/beschlussvorlagen" search={{}} className="cw-button cw-button--sekundaer">
              {t.beschlussvorlagen.titel}
            </Link>
            <Link to="/dealflow/auswertung" search={{}} className="cw-button cw-button--sekundaer">
              {t.dealflow.auswertung}
            </Link>
            {darfAnlegen ? <Button onClick={() => setNeu({})}>{t.dealflow.neuerDeal}</Button> : null}
          </>
        }
      />
      <NurLesen />
      <Tabs
        aria-label={t.dealflow.navigation}
        aktiv={bereich}
        onWechsel={(id) => void navigate({ search: (alt) => ({ ...alt, bereich: id === "pipeline" ? undefined : (id as "eingang" | "meine") }) })}
        tabs={ansichten.map((a) => ({
          id: a.bereich,
          label: a.titel,
          icon: a.icon,
          ...(a.bereich === "eingang" && arbeitsliste.isSuccess ? { zaehler: offenUnzugeordnet, zaehlerLabel: t.dealflow.etikett(offenUnzugeordnet) } : {}),
        }))}
      />
      {bereich === "pipeline" ? (
        <DealPipeline arbeitsdeals={arbeitsdealNachId} darfBearbeiten={darfZuordnen}
          onNeu={darfAnlegen ? setNeu : undefined} fehler={arbeitsliste.error} />
      ) : (
        <DealArbeitslisten key={bereich} bereich={bereich} deals={deals} benutzerId={arbeitsliste.data?.benutzerId}
          darfZuordnen={darfZuordnen} laedt={arbeitsliste.isPending} fehler={arbeitsliste.error} />
      )}
      {neu ? <NeuerDealDialog
        {...(neu.phase && neu.phase !== "closing" ? { phase: neu.phase, onAngelegt: () => undefined } : {})}
        initialerDealtyp={neu.dealtyp}
        onSchliessen={() => setNeu(null)}
      /> : null}
    </div>
  );
}

const OHNE_WERT = "-";

function DealPipeline({ arbeitsdeals, darfBearbeiten, onNeu, fehler }: {
  arbeitsdeals: Map<string, Arbeitsdeal>;
  darfBearbeiten: (id: string) => boolean;
  onNeu?: (eingabe: DealAnlage) => void;
  fehler: Error | null;
}) {
  const t = useT();
  const f = t.dealflow;
  const sprache = useSprache();
  const { status = "offen", ansicht, suche: sucheParam, umfang = "alle", darstellung = "board", gruppe,
    fondsId = "", investmentmanagerId = "", projektleiterId = "" } = route.useSearch();
  const navigate = route.useNavigate();
  const { ich } = useRechte();
  const [eingabe, setEingabe] = useState(sucheParam ?? "");
  const entprellt = useEntprellt(eingabe.trim().slice(0, 200), 250);
  useEffect(() => {
    if (entprellt !== (sucheParam ?? "")) {
      void navigate({ search: (alt) => ({ ...alt, suche: entprellt || undefined }), replace: true });
    }
  }, [entprellt, navigate, sucheParam]);
  const filterLeiste = useRef<HTMLDivElement>(null);
  const [felderOffen, setFelderOffen] = useState(false);
  const [zuordnen, setZuordnen] = useState<Arbeitsdeal | null>(null);
  const [meldung, setMeldung] = useState("");
  const verschieben = useDealVerschieben();
  const z = useAnsicht("deal", undefined, ansicht);
  const fonds = useQuery(fondsListe());
  const liste = useQuery({ ...dealListe(), enabled: status !== "offen" });
  const kartenfelder = useQuery(dealKartenfelder());

  const feldkatalog = waehlbareKartenfelder(z.felder);
  const felderNachId = new Map(feldkatalog.map((feld) => [feld.schluessel, feld]));
  const felder = [...new Set(kartenfelder.data?.felder ?? STANDARD_KARTENFELDER)].flatMap((id) => {
    const feld = felderNachId.get(id);
    return feld ? [feld] : [];
  });
  const rollenNamen = new Map<string, string>();
  for (const d of arbeitsdeals.values()) {
    if (d.investmentmanagerId && d.investmentmanagerName) rollenNamen.set(d.investmentmanagerId, d.investmentmanagerName);
    if (d.projektleiterId && d.projektleiterName) rollenNamen.set(d.projektleiterId, d.projektleiterName);
  }
  const rollenquelle = status === "offen" ? [...arbeitsdeals.values()] : (liste.data ?? []).filter((d) => status === "alle" || d.status === status);
  const investmentmanagerIds = [...new Set(rollenquelle.flatMap((d) => d.investmentmanagerId ? [d.investmentmanagerId] : []))];
  const projektleiterIds = [...new Set(rollenquelle.flatMap((d) => d.projektleiterId ? [d.projektleiterId] : []))];
  const name = useNamen([...new Set([...investmentmanagerIds, ...projektleiterIds])].filter((id) => !rollenNamen.has(id)));

  function rollenOptionen(ids: string[], gewaehlt: string) {
    const optionIds = gewaehlt && gewaehlt !== OHNE_WERT && !ids.includes(gewaehlt) ? [...ids, gewaehlt] : ids;
    return optionIds.map((id) => ({ id, name: rollenNamen.get(id) ?? name(id) ?? t.gemeinsam.keinWert }))
      .sort((a, b) => a.name.localeCompare(b.name, sprache))
      .map((b) => <option key={b.id} value={b.id}>{b.name}</option>);
  }

  const schnellfilter: Gruppe["elemente"] = [];
  if (umfang === "meine" && ich) {
    schnellfilter.push({ verknuepfung: "oder", elemente: [
      { feld: "investmentmanagerId", operator: "ist", wert: ich.id },
      { feld: "projektleiterId", operator: "ist", wert: ich.id },
    ] });
  }
  if (status !== "alle") schnellfilter.push({ feld: "status", operator: "ist", wert: status });
  for (const [feld, wert] of [["fondsId", fondsId], ["investmentmanagerId", investmentmanagerId], ["projektleiterId", projektleiterId]] as const) {
    if (wert === OHNE_WERT) schnellfilter.push({ feld, operator: "leer" });
    else if (wert) schnellfilter.push({ feld, operator: "ist", wert });
  }
  const elemente = z.konfig.filter ? [...schnellfilter, z.konfig.filter] : schnellfilter;

  const basis: AbfrageEingabe = {
    filter: elemente.length > 0 ? { verknuepfung: "und", elemente } : undefined,
    sortierung: z.konfig.sortierung,
    spalten: [...new Set([...KARTENBASIS, ...felder.map((feld) => feld.schluessel)])].slice(0, 40).map((feld) => ({ feld })),
    ...(entprellt ? { suche: entprellt } : {}),
  };
  const bereit = z.bereit && (umfang === "alle" || Boolean(ich));
  const phasenFeld = z.felder.find((feld) => feld.schluessel === "phase");
  const phaseOptionen = phasenFeld ? optionenVon(phasenFeld, t) : [];
  const optionen: Option[] = PHASEN.map((p) => phaseOptionen.find((option) => option.schluessel === p)
    ?? { schluessel: p, label: t.dealPhase[p], farbe: "grau" });
  const vorschau = useQuery({
    ...crmAbfrage("deal", { ...basis, spalten: [{ feld: "titel" }], limit: 1 }),
    enabled: felderOffen && bereit,
    placeholderData: undefined,
  });

  function setzeFilter(feld: "fondsId" | "investmentmanagerId" | "projektleiterId", wert: string) {
    void navigate({ search: (alt) => ({ ...alt, [feld]: wert || undefined }), replace: true });
  }

  function setzeDarstellung(wert: "board" | "liste") {
    void navigate({ search: (alt) => ({ ...alt, darstellung: wert === "board" ? undefined : wert }), replace: true });
  }

  function sortiere(feld: string) {
    const aktuell = z.konfig.sortierung[0];
    z.setzeKonfig({ sortierung: [{ feld, richtung: aktuell?.feld === feld && aktuell.richtung === "auf" ? "ab" : "auf" }] });
  }

  function karte(k: Zeile, bezuege: Record<string, string | null>) {
    const stat = String(k.status ?? "offen") as Deal["status"];
    const arbeitsdeal = arbeitsdeals.get(k.id);
    const unternehmen = kartenUnternehmen(k, bezuege);
    return (
      <>
        {unternehmen && typeof k.unternehmen === "string" ? (
          <p className="app-deal__titel">
            <Datensatzlink objekt="organisation" id={k.unternehmen} draggable={false}>
              {unternehmen}
            </Datensatzlink>
          </p>
        ) : null}
        <DealKartenwerte felder={felder} werte={k} bezuege={bezuege} />
        {stat !== "offen" ? <Status variante={STATUS_VARIANTE[stat]}>{aufzaehlung(t.dealStatus, stat)}</Status> : null}
        {arbeitsdeal && istUnzugeordnet(arbeitsdeal) && darfBearbeiten(k.id) ? (
          <Button className="app-dealflow__karte-zuweisen" groesse="s" variante="ruhig" aria-label={f.zuweisenFuer(arbeitsdeal.titel)} onClick={() => {
            setMeldung("");
            setZuordnen(arbeitsdeal);
          }}>{f.zuweisen}</Button>
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className="app-dealflow__segmente">
        <Segment<"alle" | "meine">
          aria-label={t.crm.pipelineUmfang}
          value={umfang}
          onChange={(wert) => void navigate({ search: (alt) => ({ ...alt, umfang: wert === "alle" ? undefined : wert }), replace: true })}
          options={[
            { wert: "alle", label: t.crm.pipelineAlleDeals },
            { wert: "meine", label: t.crm.pipelineMeineDeals },
          ]}
        />
        <Segment
          aria-label={f.statusFilter}
          value={status}
          onChange={(wert) => void navigate({ search: (alt) => ({ ...alt, status: wert === "offen" ? undefined : wert }), replace: true })}
          options={[
            { wert: "alle", label: t.gemeinsam.alle },
            ...STATUSWERTE.map((wert) => ({ wert, label: t.dealStatus[wert] })),
          ]}
        />
        <Segment<"board" | "liste">
          aria-label={t.gemeinsam.ansicht}
          value={darstellung}
          onChange={setzeDarstellung}
          options={[
            { wert: "board", label: f.ansichtBoard },
            { wert: "liste", label: t.crm.pipelineListe },
          ]}
        />
        <label className="app-dealflow__kontrollfeld">
          <input type="checkbox" checked={gruppe === "dealtyp"} onChange={(e) => {
            const gruppieren = e.target.checked;
            void navigate({ search: (alt) => ({ ...alt, gruppe: gruppieren ? "dealtyp" : undefined }), replace: true });
          }} />
          {t.crm.pipelineGruppieren}
        </label>
      </div>
      <Werkzeuge
        z={z}
        objekt="deal"
        suche={eingabe}
        onSuche={setEingabe}
        onAnsicht={(id) => void navigate({ search: (alt) => ({ ...alt, ansicht: id ?? "keine" }), replace: true })}
        istVerwalter={Boolean(ich?.globalVerwalter)}
        mitSpalten={false}
        exportEingabe={{ ...basis, spalten: ["titel", "unternehmen", "dealtyp", "phase", "status", "ticket", "investmentmanager", "projektleiter", "quelle", "betreuung", "aktualisiertAm"].map((feld) => ({ feld })) }}
      />
      <div className="app-dealflow__filter" ref={filterLeiste} tabIndex={-1}>
        <Auswahl kompakt label={f.fonds} value={fondsId} onChange={(e) => setzeFilter("fondsId", e.target.value)} disabled={fonds.isPending}>
          <option value="">{f.alleFonds}</option>
          <option value={OHNE_WERT}>{f.ohneFonds}</option>
          {fonds.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Auswahl>
        <Auswahl kompakt label={f.investmentmanager} value={investmentmanagerId} onChange={(e) => setzeFilter("investmentmanagerId", e.target.value)}>
          <option value="">{f.alleInvestmentmanager}</option>
          <option value={OHNE_WERT}>{f.nichtZugeordnet}</option>
          {rollenOptionen(investmentmanagerIds, investmentmanagerId)}
        </Auswahl>
        <Auswahl kompakt label={f.projektleiter} value={projektleiterId} onChange={(e) => setzeFilter("projektleiterId", e.target.value)}>
          <option value="">{f.alleProjektleiter}</option>
          <option value={OHNE_WERT}>{f.nichtZugeordnet}</option>
          {rollenOptionen(projektleiterIds, projektleiterId)}
        </Auswahl>
        {darstellung === "board" ? <Button groesse="s" variante="sekundaer" disabled={!bereit || !kartenfelder.isSuccess} onClick={() => {
          setMeldung("");
          setFelderOffen(true);
        }}>{f.kartenfelder}</Button> : null}
      </div>
      <div className="cw-nur-lesen" role="status">{meldung}</div>
      <FehlerHinweis fehler={verschieben.error ?? fehler ?? (darstellung === "board" ? kartenfelder.error : null) ?? fonds.error ?? liste.error} />

      <DealPipelineErgebnisse
        basis={basis}
        darstellung={darstellung}
        gruppiert={gruppe === "dealtyp"}
        bereit={bereit && (darstellung === "liste" || !kartenfelder.isPending)}
        board={{
          optionen,
          summe: true,
          darfVerschieben: (k) => k.status === "offen" && darfBearbeiten(k.id),
          onVerschieben: (k, nach) => verschieben.mutateAsync({ id: k.id, nachPhase: nach as DealPhase }),
          ohneNeu: ["closing"],
          kartenTitel: (k) => ({ text: String(k.titel ?? ""), id: k.id }),
          karte,
        }}
        onNeu={onNeu ? (phase, dealtyp) => onNeu({ phase: phase as DealPhase | undefined, dealtyp }) : undefined}
        onListe={() => setzeDarstellung("liste")}
        onSortieren={sortiere}
      />
      {felderOffen ? <DealKartenfelderDialog katalog={feldkatalog} aktiv={felder.map((feld) => feld.schluessel)} vorschauId={vorschau.data?.daten[0]?.id}
        onSchliessen={() => setFelderOffen(false)} onGespeichert={() => {
          setFelderOffen(false);
          setMeldung(f.kartenfelderGespeichert);
        }} /> : null}
      {zuordnen ? <DealZuordnungDialog deal={zuordnen} onSchliessen={() => setZuordnen(null)} onGespeichert={() => {
        setZuordnen(null);
        setMeldung(f.zuordnungGespeichert(zuordnen.titel));
        requestAnimationFrame(() => {
          if (document.activeElement === document.body) filterLeiste.current?.focus();
        });
      }} /> : null}
    </>
  );
}
