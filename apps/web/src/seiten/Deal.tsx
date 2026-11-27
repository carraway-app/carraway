import { DokumenteAbschnitt } from "../komponenten/DokumenteAbschnitt";
import { DealKontakteAbschnitt } from "../komponenten/crm/Beschaeftigungen";
import { Schnellaktionen } from "../komponenten/crm/Zelle";
import { AufgabenAbschnitt, Datensatzpanel, VerknuepftAbschnitt } from "../komponenten/crm/Datensatzpanel";
import { useState, type ReactNode } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Auswahl, Button, Hinweis, Markdown, Seitenkopf, Seitenpanel, Status, Tabelle, formatBetrag, formatDatum, type StatusVariante, type TabelleSpalte } from "@carraway/ui";
import { dealDetail, fondsListe, type DealDetail } from "../api/abfragen";
import { useDealAendern, useDealWiederaufnehmen, usePhaseAendern, type DealPhase } from "../api/mutationen";
import { AktivitaetDialog, AktivitaetenListe } from "../komponenten/Aktivitaeten";
import { NaechsteTermine } from "../komponenten/NaechsteTermine";
import { BeschlussvorschlagAbschnitt } from "../komponenten/Beschlussvorschlag";
import { AbsageDialog, BeschlussDialog, UebernahmeDialog } from "../komponenten/DealDialoge";
import { DealtypAuswahl } from "../komponenten/DealtypAuswahl";
import { DealZuordnungDialog } from "../komponenten/DealZuordnungDialog";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { NurLesen } from "../komponenten/NurLesen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { BereichsLeiste, mitZielen } from "../komponenten/BereichsLeiste";
import { feldText } from "../i18n/fehler";
import { dealtypName, dealtypTexte, type Dealtyp } from "../lib/dealtyp";
import { DATENSPRACHE } from "../lib/datensprache";
import { useNamen } from "../lib/namen";
import { useSichtbar } from "../lib/bereiche";
import { useBereich, useRechte } from "../lib/rechte";
import { aktiverEintrag, type InhaltsEintrag } from "../lib/tabs";
import { PHASEN, STATUS_VARIANTE } from "./Dealflow";
import { Datensatzlink } from "../komponenten/crm/Datensatzlink";

const route = getRouteApi("/deals/$id");

type Beschluss = DealDetail["beschluesse"][number];
type Offen = null | "aktivitaet" | "beschluss" | "absage" | "uebernahme" | "zuordnung" | "dealtyp";

/** Ziele der Bereiche in der Adresse (`?tab=…&subtab=…`, bisherige Kennungen); der erste Eintrag ist der Standard. */
const EINTRAEGE: readonly InhaltsEintrag[] = [
  { id: "uebersicht", tab: "uebersicht" },
  { id: "verlauf", tab: "verlauf" },
  { id: "aktivitaeten", tab: "aktivitaet", unter: "aktivitaeten" },
  { id: "termine", tab: "aktivitaet", unter: "termine" },
  { id: "kontakte", tab: "kontakte" },
  { id: "aufgaben", tab: "aufgaben" },
  { id: "beschluss", tab: "beschluss" },
  { id: "dokumente", tab: "dokumente" },
  { id: "verknuepft", tab: "verknuepft" },
];

/** Felder, die die Übersicht des Deals schon zeigt; im Abschnitt „Attribute“ stehen sie nicht noch einmal. */
const DEAL_IN_UEBERSICHT = ["titel", "unternehmen", "phase", "status", "ticket", "eingangsdatum", "herkunft", "dealtyp", "fonds", "investmentmanager", "projektleiter", "quelle", "betreuung"];

const ERGEBNIS_VARIANTE: Record<string, StatusVariante> = { zugestimmt: "freigegeben", abgelehnt: "fehlt", vertagt: "pruefung" };

/** Der Server verlangt für Closing und Portfolio, dass der jüngste Beschluss zustimmt (Entscheidung 41); die Liste kommt bereits jüngster zuerst. */
export const hatZustimmung = (beschluesse: Beschluss[]) => beschluesse[0]?.ergebnis === "zugestimmt";

export function DealSeite() {
  const t = useT();
  const sprache = useSprache();
  const { id } = route.useParams();
  const { data: d } = useSuspenseQuery(dealDetail(id));
  const { data: fonds } = useSuspenseQuery(fondsListe());
  const phaseAendern = usePhaseAendern();
  const wiederaufnehmen = useDealWiederaufnehmen(id);
  const { ich, darf } = useRechte();
  const name = useNamen([...d.beschluesse.map((b) => b.erfasstVon), d.investmentmanagerId, d.projektleiterId]);
  const suche = route.useSearch();
  // Aufgaben, Termine, Verknüpfungen, Dokumente und das Seitenpanel gehören anderen Bereichen (`lib/bereiche.ts`) und fehlen ohne ihn.
  const eintraege = useSichtbar("deal", EINTRAEGE);
  const sichtbar = (id: string) => eintraege.some((e) => e.id === id);
  const mitPanel = useBereich("kontakte");
  const aktiv = aktiverEintrag(suche, eintraege)?.id ?? "";
  const managedBy = d.providerSources?.find(source => source.mirrored)?.anbieter;
  const schreiben = !managedBy && darf("bearbeiter", d.fondsId, "dealflow");
  const [offen, setOffen] = useState<Offen>(null);
  const [zuordnungMeldung, setZuordnungMeldung] = useState("");
  const schliessen = () => setOffen(null);
  const keinWert = t.gemeinsam.keinWert;
  const s = t.deal;
  const org = d.organisation ?? { id: d.organisationId, name: keinWert };

  const f = t.dealflow;
  const investmentmanagerName = name(d.investmentmanagerId);
  const projektleiterName = name(d.projektleiterId);
  const istOffen = d.status === "offen";
  const zustimmung = hatZustimmung(d.beschluesse);
  // Vier-Augen: Wer den zustimmenden Beschluss erfasst hat, führt den Übergang ins Portfolio nicht selbst durch.
  const selbstBeschlossen = zustimmung && ich !== undefined && d.beschluesse[0]?.erfasstVon === ich.id;
  const grund =
    d.status === "investiert"
      ? s.grund.investiert
      : d.status === "abgesagt"
        ? s.grund.abgesagt
        : !zustimmung
          ? s.grund.beschlussFehlt
          : !schreiben
            ? t.rechte.braucht(aufzaehlung(t.rolle, "bearbeiter"))
            : selbstBeschlossen
              ? t.rechte.vierAugenBeschluss
              : null;

  const beschluesse: TabelleSpalte<Beschluss>[] = [
    { schluessel: "datum", kopf: s.beschluss.datum, zelle: (b) => formatDatum(b.datum, sprache) },
    { schluessel: "gremium", kopf: s.beschluss.gremium, zelle: (b) => b.gremium },
    { schluessel: "ergebnis", kopf: s.beschluss.ergebnis, zelle: (b) => <Status variante={ERGEBNIS_VARIANTE[b.ergebnis] ?? "entwurf"}>{aufzaehlung(t.beschlussErgebnis, b.ergebnis)}</Status> },
    { schluessel: "betrag", kopf: s.beschluss.betrag, zahl: true, zelle: (b) => (b.betrag === null ? keinWert : formatBetrag(b.betrag, sprache)) },
    { schluessel: "auflagen", kopf: s.beschluss.auflagen, umbruch: true, zelle: (b) => (b.auflagen ? <Markdown text={b.auflagen} /> : keinWert) },
    { schluessel: "protokoll", kopf: s.beschluss.protokoll, umbruch: true, zelle: (b) => (b.protokoll ? <Markdown text={b.protokoll} /> : keinWert) },
    { schluessel: "erfasstVon", kopf: s.beschluss.erfasstVon, zelle: (b) => name(b.erfasstVon) ?? keinWert },
  ];

  return (
    <div className="app-seite">
      {managedBy && <Hinweis>{sprache === "de" ? "Wird in " + managedBy + " gepflegt." : "Managed in " + managedBy + "."}</Hinweis>}
      <Seitenkopf
        meta={
          <>
            <Datensatzlink objekt="organisation" id={org.id}>
              {org.name}
            </Datensatzlink>
            <Status variante={STATUS_VARIANTE[d.status]}>{aufzaehlung(t.dealStatus, d.status)}</Status>
          </>
        }
        titel={d.titel}
        titelSprache={DATENSPRACHE}
        aktionen={
          <>
            <Schnellaktionen werte={"email" in org ? { email: org.email, telefon: org.telefon, website: org.website, linkedin: org.linkedin } : {}} name={org.name} />
            <Link to="/dealflow" search={{}} className="cw-button cw-button--sekundaer">
              {s.zumDealflow}
            </Link>
          </>
        }
      />

      <NurLesen fondsId={d.fondsId} bereich="dealflow" />

      <BereichsLeiste
        aria-label={t.tabs.bereiche}
        aktiv={aktiv}
        zurueck={{ label: t.nav.dealflow, ziel: { to: "/dealflow" } }}
        kopf={{ titel: d.titel, titelSprache: DATENSPRACHE, untertitel: `${org.name} · ${aufzaehlung(t.dealStatus, d.status)}` }}
        pfad={[{ label: t.nav.dealflow, ziel: { to: "/dealflow" } }, { label: d.titel }]}
        gruppen={mitZielen([
          {
            id: "deal",
            label: s.verzeichnis.deal,
            eintraege: [
              {
                id: "uebersicht",
                label: t.tabs.uebersicht,
                inhalt: () => (
                  <>
      <section className="app-karte" aria-label={s.stammdaten}>
        <dl className="app-fakten">
          <div>
            <dt>{s.phase}</dt>
            <dd>{aufzaehlung(t.dealPhase, d.phase)}</dd>
          </div>
          <div>
            <dt>{s.ticket}</dt>
            <dd className="app-zahl">{d.ticket === null ? keinWert : formatBetrag(d.ticket, sprache)}</dd>
          </div>
          <div>
            <dt>{s.quelle}</dt>
            <dd>{d.quelle ?? keinWert}</dd>
          </div>
          <div>
            <dt>{f.eingangsdatum}</dt>
            <dd>{d.eingangsdatum ? formatDatum(d.eingangsdatum, sprache) : keinWert}</dd>
          </div>
          <div>
            <dt>{f.herkunft}</dt>
            <dd>{d.herkunft ? f.herkuenfte[d.herkunft] : keinWert}</dd>
          </div>
          <div>
            <dt>{dealtypTexte[sprache].feld}</dt>
            <dd>{dealtypName(d.dealtyp, sprache)}</dd>
          </div>
          <div>
            <dt>{f.investmentmanager}</dt>
            <dd>{investmentmanagerName ?? keinWert}</dd>
          </div>
          <div>
            <dt>{f.projektleiter}</dt>
            <dd>{projektleiterName ?? keinWert}</dd>
          </div>
          {d.betreuung ? (
            <div>
              <dt>{f.altBetreuung}</dt>
              <dd>{d.betreuung}</dd>
            </div>
          ) : null}
          <div>
            <dt>{s.fonds}</dt>
            <dd>{d.fonds?.name ?? keinWert}</dd>
          </div>
          {d.status === "abgesagt" ? (
            <div>
              <dt>{s.absagegrund}</dt>
              <dd>{d.absagegrund ?? keinWert}</dd>
            </div>
          ) : null}
        </dl>
        <div role="status" className="cw-nur-lesen">{zuordnungMeldung}</div>
        {istOffen && schreiben ? (
          <div className="app-aktionen__knoepfe">
            <Button variante="sekundaer" onClick={() => {
              setZuordnungMeldung("");
              setOffen("zuordnung");
            }}>{f.zuordnen}</Button>
            <Button variante="sekundaer" onClick={() => setOffen("dealtyp")}>{dealtypTexte[sprache].bearbeiten}</Button>
          </div>
        ) : null}
      </section>


      <section className="app-karte" aria-label={s.aktionen}>
        <h2 className="cw-t-untertitel app-karte__titel">{s.aktionen}</h2>
        <FehlerHinweis fehler={phaseAendern.error ?? wiederaufnehmen.error} />
        <div className="app-aktionen">
          <Auswahl
            label={s.phaseAendern}
            value={d.phase}
            disabled={!istOffen || !schreiben}
            onChange={(e) => phaseAendern.mutate({ id: d.id, nachPhase: e.target.value as DealPhase })}
          >
            {PHASEN.map((p) => (
              <option key={p} value={p} disabled={p === "closing" && !zustimmung && d.phase !== "closing"}>
                {p === "closing" && !zustimmung && d.phase !== "closing" ? `${t.dealPhase[p]} (${s.beschlussFehltKurz})` : t.dealPhase[p]}
              </option>
            ))}
          </Auswahl>
          <div className="app-aktionen__knoepfe">
            {istOffen && schreiben ? (
              <Button variante="gefahr" onClick={() => setOffen("absage")}>
                {s.absagen}
              </Button>
            ) : null}
            {d.status === "abgesagt" && schreiben ? (
              <Button variante="sekundaer" disabled={wiederaufnehmen.isPending} onClick={() => wiederaufnehmen.mutate()}>
                {s.wiederaufnehmen}
              </Button>
            ) : null}
            <Button disabled={grund !== null} aria-describedby={grund ? "uebernahme-grund" : undefined} onClick={() => setOffen("uebernahme")}>
              {s.insPortfolio}
            </Button>
          </div>
        </div>
        {grund ? (
          <Hinweis id="uebernahme-grund" titel={s.insPortfolioGesperrt}>
            {grund}
          </Hinweis>
        ) : null}
      </section>


      {mitPanel ? <Datensatzpanel objekt="deal" id={d.id} darfSchreiben={schreiben && istOffen} titel={d.titel} doppelt={DEAL_IN_UEBERSICHT} /> : null}

      {d.beteiligungen.length > 0 ? (
        <Abschnitt titel={t.organisation.beteiligungen}>
          <ul className="app-liste">
            {d.beteiligungen.map((b) => (
              <li key={b.id}>
                <Link to="/funds/$fundId" params={{ fundId: b.fonds.id }} search={{}}>
                  {b.fonds.name}
                </Link>{" "}
                ·{" "}
                <Link to="/investments/$id" params={{ id: b.id }} search={{}}>
                  {aufzaehlung(t.instrument, b.instrument)}
                </Link>{" "}
                · {formatDatum(b.erstinvestment, sprache)}
              </li>
            ))}
          </ul>
        </Abschnitt>
      ) : null}


                  </>
                ),
              },
              {
                id: "verlauf",
                label: t.tabs.verlauf,
                zaehler: d.phasenverlauf.length,
                inhalt: () => (
                  <>
      <Abschnitt titel={s.phasenverlauf}>
        <ol className="app-zeitstrahl" aria-label={s.phasenverlauf}>
          {d.phasenverlauf.map((w) => (
            <li key={w.id} className="app-zeitstrahl__eintrag">
              <div className="app-zeitstrahl__kopf">
                <time className="app-zahl" dateTime={w.am}>
                  {formatDatum(w.am, sprache)}
                </time>
              </div>
              <p className="app-zeitstrahl__titel">
                {w.vonPhase ? s.phasenwechsel(aufzaehlung(t.dealPhase, w.vonPhase), aufzaehlung(t.dealPhase, w.nachPhase)) : s.angelegtIn(aufzaehlung(t.dealPhase, w.nachPhase))}
              </p>
              {w.bemerkung ? <Markdown className="app-zeitstrahl__notiz" text={w.bemerkung} /> : null}
            </li>
          ))}
        </ol>
      </Abschnitt>


                  </>
                ),
              },
            ],
          },
          {
            id: "zusammenarbeit",
            label: s.verzeichnis.zusammenarbeit,
            eintraege: [
              {
                id: "aktivitaeten",
                label: t.tabs.aktivitaeten,
                zaehler: d.aktivitaeten.length,
                inhalt: () => (
                  <>
      <Abschnitt titel={t.aktivitaeten.titel} aktion={schreiben ? <Button variante="sekundaer" onClick={() => setOffen("aktivitaet")}>{t.aktivitaeten.erfassen}</Button> : undefined}>
        <AktivitaetenListe aktivitaeten={d.aktivitaeten} />
      </Abschnitt>

                  </>
                ),
              },
              { id: "termine", label: t.tabs.termine, inhalt: () => <NaechsteTermine filter={{ dealId: d.id }} /> },
              { id: "kontakte", label: t.crm.tabKontakte, inhalt: () => <DealKontakteAbschnitt dealId={d.id} schreiben={schreiben} /> },
              { id: "aufgaben", label: t.crm.tabAufgaben, inhalt: () => <AufgabenAbschnitt bezug={{ dealId: d.id }} fondsId={d.fondsId} /> },
            ].filter((e) => sichtbar(e.id)),
          },
          {
            id: "entscheidung",
            label: s.verzeichnis.entscheidung,
            eintraege: [
              {
                id: "beschluss",
                label: t.tabs.beschluss,
                zaehler: d.beschluesse.length,
                inhalt: () => (
                  <>
      <BeschlussvorschlagAbschnitt dealId={d.id} fondsId={d.fondsId} text={d.beschlussvorschlag} schreiben={schreiben && istOffen} />

      <Abschnitt titel={s.beschluesse} aktion={schreiben ? <Button variante="sekundaer" onClick={() => setOffen("beschluss")}>{s.beschlussErfassen}</Button> : undefined}>
        {d.beschluesse.length === 0 ? (
          <p className="app-leer-text">{s.keineBeschluesse}</p>
        ) : (
          <Tabelle beschriftung={s.beschluesse} spalten={beschluesse} zeilen={d.beschluesse} zeilenSchluessel={(b) => b.id} />
        )}
      </Abschnitt>


                  </>
                ),
              },
            ],
          },
          {
            id: "ablage",
            label: s.verzeichnis.ablage,
            eintraege: [
              { id: "dokumente", label: t.tabs.dokumente, inhalt: () => <DokumenteAbschnitt zielTyp="deal" zielId={d.id} fondsId={d.fondsId} /> },
              { id: "verknuepft", label: t.crm.tabVerknuepft, inhalt: () => <VerknuepftAbschnitt objekt="deal" id={d.id} /> },
            ].filter((e) => sichtbar(e.id)),
          },
        ], eintraege, { to: "/deals/$id", params: { id: d.id } })}
      />

      {offen === "aktivitaet" ? <AktivitaetDialog organisationId={org.id} dealId={d.id} personen={d.personen} onSchliessen={schliessen} /> : null}
      {offen === "beschluss" ? <BeschlussDialog dealId={d.id} dealFondsId={d.fondsId} fonds={fonds} onSchliessen={schliessen} /> : null}
      {offen === "absage" ? <AbsageDialog dealId={d.id} onSchliessen={schliessen} /> : null}
      {offen === "zuordnung" ? (
        <DealZuordnungDialog
          deal={{
            ...d,
            unternehmenName: org.name,
            investmentmanagerId: d.investmentmanagerId ?? null,
            projektleiterId: d.projektleiterId ?? null,
            investmentmanagerName,
            projektleiterName,
          }}
          onSchliessen={schliessen}
          onGespeichert={() => {
            setZuordnungMeldung(f.zuordnungGespeichert(d.titel));
            schliessen();
          }}
        />
      ) : null}
      {offen === "dealtyp" ? <DealtypDialog id={d.id} dealtyp={d.dealtyp} onSchliessen={schliessen} /> : null}
      {offen === "uebernahme" ? <UebernahmeDialog deal={d} fonds={fonds} onSchliessen={schliessen} /> : null}
    </div>
  );
}

function DealtypDialog({ id, dealtyp, onSchliessen }: { id: string; dealtyp: Dealtyp | null; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const [wert, setWert] = useState(dealtyp);
  const aendern = useDealAendern(id);
  const titel = dealtypTexte[sprache].bearbeiten;

  return (
    <Seitenpanel titel={titel} onSchliessen={onSchliessen}>
      <form className="app-formular" onSubmit={(e) => {
        e.preventDefault();
        if (wert !== dealtyp && !aendern.isPending) aendern.mutate({ dealtyp: wert }, { onSuccess: onSchliessen });
      }}>
        <h2 className="cw-t-untertitel">{titel}</h2>
        <FehlerHinweis fehler={aendern.error} bekannt={["dealtyp"]} />
        <DealtypAuswahl wert={wert} onWechsel={setWert} fehler={feldText(t, aendern.error, "dealtyp")} deaktiviert={aendern.isPending} />
        <div>
          <Button type="submit" disabled={wert === dealtyp || aendern.isPending}>{t.crm.speichern}</Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

function Abschnitt({ titel, aktion, children }: { titel: string; aktion?: ReactNode; children: ReactNode }) {
  return (
    <section className="app-karte">
      <div className="app-karte__kopf">
        <h2 className="cw-t-untertitel app-karte__titel">{titel}</h2>
        {aktion}
      </div>
      {children}
    </section>
  );
}
