import { DokumenteAbschnitt } from "../komponenten/DokumenteAbschnitt";
import { AufgabenAbschnitt, Datensatzpanel, VerknuepftAbschnitt } from "../komponenten/crm/Datensatzpanel";
import { Verbindungen, useVerbindungen } from "../komponenten/crm/Verbindungen";
import { Schnellaktionen } from "../komponenten/crm/Zelle";
import { useState, type ReactNode } from "react";
import type { VerzeichnisEintrag, VerzeichnisGruppe } from "@carraway/ui";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Button, Hinweis, Inhaltsverzeichnis, Seitenkopf, Status, Tabelle, formatBetrag, formatDatum, type StatusVariante, type TabelleSpalte } from "@carraway/ui";
import { dublettenSuche, organisationAktivitaeten, organisationDetail, type Organisation } from "../api/abfragen";
import { AktivitaetDialog, AktivitaetenListe } from "../komponenten/Aktivitaeten";
import { NaechsteTermine } from "../komponenten/NaechsteTermine";
import { OrganisationBearbeitenDialog } from "../komponenten/OrganisationDialoge";
import { BeziehungenAbschnitt } from "../komponenten/Beziehungen";
import { RegisterAbschnitt } from "../komponenten/Register";
import { RundenMitFondswahl } from "../komponenten/Runden";
import { VehikelAbschnitt } from "../komponenten/VehikelAbschnitt";
import { ZusammenfuehrenDialog } from "../komponenten/Zusammenfuehren";
import { NurLesen } from "../komponenten/NurLesen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { DATENSPRACHE } from "../lib/datensprache";
import { useSichtbar } from "../lib/bereiche";
import { useRechte } from "../lib/rechte";
import { ExternerLink } from "../komponenten/ExternerLink";
import { useInhalt } from "../lib/tabs";
import { Datensatzlink } from "../komponenten/crm/Datensatzlink";

const route = getRouteApi("/organisationen/$id");

type OrgDeal = Organisation["deals"][number];
type OrgBeteiligung = Organisation["beteiligungen"][number];

const DEAL_STATUS: Record<string, StatusVariante> = { offen: "pruefung", investiert: "freigegeben", abgesagt: "fehlt" };
const BETEILIGUNG_STATUS: Record<string, StatusVariante> = { aktiv: "freigegeben", exit: "entwurf", insolvent: "fehlt", abgeschrieben: "fehlt" };

interface Eintrag extends VerzeichnisEintrag {
  gruppe: string;
  tab: string;
  unter?: string;
}

type Offen = null | "bearbeiten" | "aktivitaet" | "zusammenfuehren";

export function OrganisationSeite() {
  const t = useT();
  const sprache = useSprache();
  const { id } = route.useParams();
  const suche = route.useSearch();
  const navigate = route.useNavigate();
  const { data: o } = useSuspenseQuery(organisationDetail(id));
  const { data: aktivitaeten } = useSuspenseQuery(organisationAktivitaeten(id));
  const { darf } = useRechte();
  const [offen, setOffen] = useState<Offen>(null);
  const weg = o.zusammengefuehrtIn !== null;
  const schreiben = darf("bearbeiter") && !weg;
  const dubletten = useQuery({ ...dublettenSuche(o.name), enabled: offen === "zusammenfuehren" });
  const schliessen = () => setOffen(null);
  const keinWert = t.gemeinsam.keinWert;
  const s = t.organisation.spalten;
  const { zeilen: verbindungen } = useVerbindungen("organisation", o.id, o.rollen, o.personen);

  const deals: TabelleSpalte<OrgDeal>[] = [
    {
      schluessel: "titel",
      kopf: s.deal,
      zelle: (d) => (
        <Datensatzlink objekt="deal" id={d.id}>
          {d.titel}
        </Datensatzlink>
      ),
    },
    { schluessel: "phase", kopf: s.phase, zelle: (d) => aufzaehlung(t.dealPhase, d.phase) },
    { schluessel: "status", kopf: s.status, zelle: (d) => <Status variante={DEAL_STATUS[d.status] ?? "entwurf"}>{aufzaehlung(t.dealStatus, d.status)}</Status> },
    { schluessel: "ticket", kopf: s.ticket, zahl: true, zelle: (d) => (d.ticket === null ? keinWert : formatBetrag(d.ticket, sprache)) },
    { schluessel: "aktualisiert", kopf: s.aktualisiert, zelle: (d) => formatDatum(d.aktualisiertAm, sprache) },
  ];
  const beteiligungen: TabelleSpalte<OrgBeteiligung>[] = [
    {
      schluessel: "fonds",
      kopf: s.fonds,
      zelle: (b) => (
        <Link to="/fonds/$fondsId" params={{ fondsId: b.fonds.id }} search={{}}>
          {b.fonds.name}
        </Link>
      ),
    },
    {
      schluessel: "instrument",
      kopf: s.instrument,
      zelle: (b) => (
        <Link to="/beteiligungen/$id" params={{ id: b.id }} search={{}}>
          {aufzaehlung(t.instrument, b.instrument)}
        </Link>
      ),
    },
    { schluessel: "status", kopf: s.status, zelle: (b) => <Status variante={BETEILIGUNG_STATUS[b.status] ?? "entwurf"}>{aufzaehlung(t.beteiligungStatus, b.status)}</Status> },
    { schluessel: "erstinvestment", kopf: s.erstinvestment, zahl: true, zelle: (b) => formatDatum(b.erstinvestment, sprache) },
  ];

  const unternehmen = o.art === "unternehmen";
  const alle: Eintrag[] = [
    { gruppe: "unternehmen", id: "kontakte", tab: "uebersicht", label: t.crm.tabKontakte, zaehler: verbindungen.length, inhalt: () => <Verbindungen seite="organisation" id={o.id} rollen={o.rollen} altePersonen={o.personen} schreiben={schreiben} /> },
    { gruppe: "unternehmen", id: "beziehungen", tab: "uebersicht", unter: "beziehungen", label: t.crm.tabBeziehungen, zaehler: o.beziehungen.length, inhalt: () => <BeziehungenAbschnitt organisationId={o.id} zeilen={o.beziehungen} /> },
    {
      gruppe: "engagement",
      id: "deals",
      tab: "engagement",
      unter: "deals",
      label: t.tabs.deals,
      zaehler: o.deals.length,
      inhalt: () => (
        <Abschnitt id="deals" titel={t.organisation.deals} leer={t.organisation.keineDeals} zeilen={o.deals.length}>
          <Tabelle dicht beschriftung={t.organisation.deals} spalten={deals} zeilen={o.deals} zeilenSchluessel={(d) => d.id} />
        </Abschnitt>
      ),
    },
    {
      gruppe: "engagement",
      id: "beteiligungen",
      tab: "engagement",
      unter: "beteiligungen",
      label: t.tabs.beteiligungen,
      zaehler: o.beteiligungen.length,
      inhalt: () => (
        <Abschnitt id="beteiligungen" titel={t.organisation.beteiligungen} leer={t.organisation.keineBeteiligungen} zeilen={o.beteiligungen.length}>
          <Tabelle dicht beschriftung={t.organisation.beteiligungen} spalten={beteiligungen} zeilen={o.beteiligungen} zeilenSchluessel={(b) => b.id} />
        </Abschnitt>
      ),
    },
    // Vehikel nur bei Investoren (und bei Organisationen, die aus dem Bestand schon Vehikel haben).
    ...(o.art === "investor" || o.vehikelAnzahl > 0
      ? [{ gruppe: "engagement", id: "vehikel", tab: "engagement", unter: "vehikel", label: t.finanzierungsrunden.vehikel.titel, zaehler: o.vehikelAnzahl, inhalt: () => <VehikelAbschnitt organisationId={o.id} schreiben={schreiben} /> }]
      : []),
    ...(unternehmen ? [{ gruppe: "kapital", id: "runden", tab: "runden", label: t.tabs.runden, inhalt: () => <RundenMitFondswahl organisationId={o.id} /> }] : []),
    ...(unternehmen && !weg ? [{ gruppe: "kapital", id: "register", tab: "register", label: t.tabs.register, inhalt: () => <RegisterAbschnitt organisationId={o.id} /> }] : []),
    {
      gruppe: "zusammenarbeit",
      id: "aktivitaeten",
      tab: "aktivitaet",
      unter: "aktivitaeten",
      label: t.tabs.aktivitaeten,
      zaehler: aktivitaeten.length,
      inhalt: () => (
        <Abschnitt
          id="aktivitaeten"
          titel={t.aktivitaeten.titel}
          leer={t.aktivitaeten.keine}
          zeilen={aktivitaeten.length}
          aktion={schreiben ? <Button variante="sekundaer" onClick={() => setOffen("aktivitaet")}>{t.aktivitaeten.erfassen}</Button> : undefined}
          mitInhalt
        >
          <AktivitaetenListe aktivitaeten={aktivitaeten} />
        </Abschnitt>
      ),
    },
    { gruppe: "zusammenarbeit", id: "termine", tab: "aktivitaet", unter: "termine", label: t.tabs.termine, inhalt: () => <NaechsteTermine filter={{ organisationId: o.id }} /> },
    { gruppe: "zusammenarbeit", id: "aufgaben", tab: "aufgaben", label: t.crm.tabAufgaben, inhalt: () => <AufgabenAbschnitt bezug={{ organisationId: o.id }} /> },
    { gruppe: "ablage", id: "dokumente", tab: "dokumente", label: t.tabs.dokumente, inhalt: () => <DokumenteAbschnitt zielTyp="organisation" zielId={o.id} fondsId={null} /> },
    { gruppe: "ablage", id: "verknuepft", tab: "verknuepft", label: t.crm.tabVerknuepft, inhalt: () => <VerknuepftAbschnitt objekt="organisation" id={o.id} /> },
  ];
  // Abschnitte anderer Bereiche (Deals, Beteiligungen, Runden, Dokumente) erscheinen nur mit dem Bereich (`lib/bereiche.ts`).
  const eintraege = useSichtbar("organisation", alle);
  const { aktiv, setzeAktiv } = useInhalt(suche, navigate, eintraege);
  const gruppenNamen: Record<string, string> = { unternehmen: t.crm.verzeichnisUnternehmen, engagement: t.crm.verzeichnisEngagement, kapital: t.crm.verzeichnisKapital, zusammenarbeit: t.crm.verzeichnisZusammenarbeit, ablage: t.crm.verzeichnisAblage };
  const gruppen: VerzeichnisGruppe[] = Object.keys(gruppenNamen).map((g) => ({
    id: g,
    label: gruppenNamen[g],
    eintraege: eintraege.filter((e) => e.gruppe === g).map(({ gruppe: _g, tab: _t, unter: _u, ...e }) => e),
  }));

  const etikett = [aufzaehlung(t.organisationArt, o.art), o.sektor, o.ort].filter(Boolean).join(" · ");

  return (
    <div className="app-seite">
      <Seitenkopf
        meta={
          <>
            {etikett}
            {o.website ? (
              <>
                {" · "}
                <ExternerLink url={o.website} />
              </>
            ) : null}
          </>
        }
        titel={o.name}
        titelSprache={DATENSPRACHE}
        aktionen={
          <>
            <Schnellaktionen werte={{ telefon: o.telefon, linkedin: o.linkedin }} name={o.name} />
            {o.email ? (
              <a className="cw-button cw-button--sekundaer" href={`mailto:${o.email}`}>
                {t.crm.mailSchreiben}
              </a>
            ) : null}
            {schreiben ? (
              <Button variante="sekundaer" onClick={() => setOffen("zusammenfuehren")}>
                {t.zusammenfuehren.knopf}
              </Button>
            ) : null}
            {schreiben ? (
              <Button variante="sekundaer" onClick={() => setOffen("bearbeiten")}>
                {t.organisation.bearbeiten}
              </Button>
            ) : null}
          </>
        }
      />

      <NurLesen />
      {weg ? (
        <Hinweis>
          {t.organisation.zusammengefuehrt}{" "}
          <Link to="/organisationen/$id" params={{ id: o.zusammengefuehrtIn! }}>
            {t.organisation.zumBleibenden}
          </Link>
        </Hinweis>
      ) : null}

      <div className="app-datensatz">
        <div className="app-datensatz__haupt">
          <Inhaltsverzeichnis aria-label={t.tabs.bereiche} gruppen={gruppen} aktiv={aktiv} onWechsel={setzeAktiv} />
        </div>
        {weg ? null : <Datensatzpanel objekt="organisation" id={o.id} darfSchreiben={schreiben} titel={o.name} />}
      </div>

      {offen === "zusammenfuehren" ? (
        <ZusammenfuehrenDialog
          art="organisation"
          id={o.id}
          name={o.name}
          vorschlaege={(dubletten.data ?? []).filter((k) => k.id !== o.id).map((k) => ({ id: k.id, label: k.name, info: [aufzaehlung(t.organisationArt, k.art), k.ort].filter(Boolean).join(" · ") }))}
          onSchliessen={schliessen}
        />
      ) : null}

      {offen === "bearbeiten" ? <OrganisationBearbeitenDialog organisation={o} onSchliessen={schliessen} /> : null}
      {offen === "aktivitaet" ? <AktivitaetDialog organisationId={o.id} personen={o.personen} onSchliessen={schliessen} /> : null}
    </div>
  );
}

function Abschnitt({
  id,
  titel,
  leer,
  zeilen,
  aktion,
  mitInhalt,
  children,
}: {
  id: string;
  titel: string;
  leer: string;
  zeilen: number;
  aktion?: ReactNode;
  /** Die Kinder zeigen den Leerzustand selbst. */
  mitInhalt?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="app-karte">
      <div className="app-karte__kopf">
        <h2 id={`abschnitt-${id}`} className="cw-t-untertitel app-karte__titel">
          {titel}
        </h2>
        {aktion}
      </div>
      {zeilen === 0 && !mitInhalt ? <p className="app-leer-text">{leer}</p> : children}
    </section>
  );
}
