import { useState } from "react";
import { useInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Auswahl, Button, ButtonLink, CheckIcon, formatDatum, Hinweis, ListChecksIcon, ListMagnifyingGlassIcon, Schrittfolge, Seitenkopf, Status, Tabelle, Tabs, UploadSimpleIcon, WarningIcon, type TabelleSpalte } from "@carraway/ui";
import {
  BEFUNDE_JE_SEITE,
  BLAETTER,
  importBefunde,
  importLauf,
  laufErgebnis,
  laufFonds,
  protokollUrl,
  useLaufPruefen,
  useLaufUebernehmen,
  vorschauZaehler,
  type Befund,
  type BefundFilter,
  type FondsSummen,
  type Importlauf,
  type Zaehler,
} from "../api/import";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { Skelettzeilen } from "../komponenten/Skelett";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { befundMeldung, befundTitel } from "../i18n/befunde";
import { hatIrgendwoRolle, hatRolle, useRechte } from "../lib/rechte";
import { formatBetragCent } from "../lib/zahl";
import { formatZeitpunkt } from "../lib/zeit";
import { LAUF_VARIANTE, laufStatusSchluessel, laufStatusText } from "./Import";

const route = getRouteApi("/import/$id");
/** Höchstzahl gespeicherter Befunde je Lauf (wie in der API). */
const MAX_BEFUNDE = 5000;

export function ImportLaufSeite() {
  const t = useT();
  const d = t.datenuebernahme;
  const { id } = route.useParams();
  const { data: lauf } = useSuspenseQuery(importLauf(id));
  const sprache = useSprache();
  const schluessel = laufStatusSchluessel(lauf);
  const aktuell = lauf.status === "uebernommen" ? "fertig" : lauf.geprueftAm && lauf.status === "geprueft" ? "uebernehmen" : "pruefen";
  const person = (name: string | null) => name ?? t.rechte.unbekanntePerson;
  const kb = Math.max(1, Math.round(lauf.groesse / 1024));
  const suche = route.useSearch();
  const navigate = route.useNavigate();
  const ergebnisSichtbar = lauf.status === "uebernommen" && !lauf.eingeschraenkt;
  const reiter = [
    { id: "pruefen", icon: ListChecksIcon, label: d.pruefen.titel, inhalt: () => <Pruefen lauf={lauf} /> },
    ...(lauf.geprueftAm ? [{ id: "befunde", icon: WarningIcon, label: d.befunde.titel, inhalt: () => <Befunde lauf={lauf} /> }] : []),
    { id: "uebernehmen", icon: UploadSimpleIcon, label: d.uebernehmen.titel, inhalt: () => <Uebernehmen lauf={lauf} /> },
    ...(ergebnisSichtbar ? [{ id: "ergebnis", icon: CheckIcon, label: d.ergebnis.titel, inhalt: () => <Ergebnis lauf={lauf} /> }] : []),
    { id: "protokoll", icon: ListMagnifyingGlassIcon, label: d.protokoll.titel, inhalt: () => <Protokoll lauf={lauf} /> },
  ];
  // Standard ist der Reiter des aktuellen Schritts; der gewählte steht in der Adresse.
  const standard = ergebnisSichtbar ? "ergebnis" : lauf.geprueftAm && ((lauf.fehlerAnzahl ?? 0) > 0 || lauf.eingeschraenkt) ? "befunde" : aktuell === "pruefen" ? "pruefen" : "uebernehmen";
  const gewaehlt = reiter.some((r) => r.id === suche.tab) ? (suche.tab as string) : standard;

  return (
    <div className="app-seite">
      <Seitenkopf meta={<Link to="/import">{d.lauf.zurueck}</Link>} titel={lauf.dateiname} />
      <Schrittfolge
        aria-label={d.schritte.beschriftung}
        aktuell={aktuell}
        schritte={[
          { id: "hochladen", label: d.schritte.hochladen },
          { id: "pruefen", label: d.schritte.pruefen },
          { id: "uebernehmen", label: d.schritte.uebernehmen },
          { id: "fertig", label: d.schritte.fertig },
        ]}
      />
      <section className="app-karte" aria-label={d.lauf.etikett}>
        <dl className="app-fakten">
          <div>
            <dt>{d.laeufe.spalten.status}</dt>
            <dd>
              <Status variante={LAUF_VARIANTE[schluessel] ?? "entwurf"}>{laufStatusText(t, lauf)}</Status>
            </dd>
          </div>
          <div>
            <dt>{d.lauf.datei}</dt>
            <dd>
              {lauf.dateiname} ({d.lauf.groesse(kb)})
            </dd>
          </div>
          <div>
            <dt>{d.lauf.hochgeladenVon}</dt>
            <dd>{d.laeufe.von(person(lauf.hochgeladenVonName), formatZeitpunkt(lauf.hochgeladenAm, sprache))}</dd>
          </div>
          <div>
            <dt>{d.lauf.geprueftVon}</dt>
            <dd>{lauf.geprueftAm ? d.laeufe.von(person(lauf.geprueftVonName), formatZeitpunkt(lauf.geprueftAm, sprache)) : d.lauf.noch}</dd>
          </div>
          <div>
            <dt>{d.lauf.uebernommenVon}</dt>
            <dd>{lauf.uebernommenAm ? d.laeufe.von(person(lauf.uebernommenVonName), formatZeitpunkt(lauf.uebernommenAm, sprache)) : d.lauf.noch}</dd>
          </div>
          <div>
            <dt>{d.lauf.pruefsumme}</dt>
            <dd className="app-zahl">{lauf.sha256.slice(0, 16)}…</dd>
          </div>
        </dl>
      </section>
      {lauf.eingeschraenkt ? (
        <Hinweis titel={d.eingeschraenkt.titel}>{d.eingeschraenkt.text}</Hinweis>
      ) : null}
      <Tabs aria-label={d.lauf.bereiche} aktiv={gewaehlt} onWechsel={(id) => void navigate({ search: (alt) => ({ ...alt, tab: id === standard ? undefined : id }) })} tabs={reiter} />
    </div>
  );
}

// Prüfen -----------------------------------------------------------------------------------------------------------

function Zaehlertabelle({ zaehler, beschriftung }: { zaehler: Partial<Record<(typeof BLAETTER)[number], Zaehler>>; beschriftung: string }) {
  const t = useT();
  const d = t.datenuebernahme.zaehler;
  const zeilen = BLAETTER.flatMap((b) => {
    const z = zaehler[b];
    return z && z.zeilen > 0 ? [{ blatt: b, ...z }] : [];
  });
  if (zeilen.length === 0) return <p className="app-leer-text">{d.leer}</p>;
  const spalten: TabelleSpalte<(typeof zeilen)[number]>[] = [
    { schluessel: "blatt", kopf: d.spalten.blatt, zelle: (z) => aufzaehlung(t.datenuebernahme.blaetter, z.blatt) },
    { schluessel: "zeilen", kopf: d.spalten.zeilen, zahl: true, zelle: (z) => String(z.zeilen) },
    { schluessel: "neu", kopf: d.spalten.neu, zahl: true, zelle: (z) => String(z.neu) },
    { schluessel: "unveraendert", kopf: d.spalten.unveraendert, zahl: true, zelle: (z) => String(z.unveraendert) },
    { schluessel: "abweichend", kopf: d.spalten.abweichend, zahl: true, zelle: (z) => String(z.abweichend) },
  ];
  return <Tabelle beschriftung={beschriftung} spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => z.blatt} />;
}

function Pruefen({ lauf }: { lauf: Importlauf }) {
  const t = useT();
  const d = t.datenuebernahme;
  const { darf } = useRechte();
  const pruefen = useLaufPruefen(lauf.id);
  const uebernommen = lauf.status === "uebernommen";
  const geprueft = lauf.geprueftAm !== null;
  const fehler = lauf.fehlerAnzahl;
  const warnungen = lauf.warnungAnzahl ?? 0;

  return (
    <section className="app-karte" aria-labelledby="lauf-pruefen">
      <h2 id="lauf-pruefen" className="cw-t-untertitel app-karte__titel">
        {d.pruefen.titel}
      </h2>
      <p className="app-leer-text">{d.pruefen.text}</p>
      <FehlerHinweis fehler={pruefen.error} />
      {uebernommen ? <p className="app-leer-text">{d.pruefen.bereitsUebernommen}</p> : null}
      {!uebernommen && darf("bearbeiter") ? (
        <div>
          <Button onClick={() => pruefen.mutate()} disabled={pruefen.isPending}>
            {pruefen.isPending ? d.pruefen.laeuft : geprueft ? d.pruefen.erneut : d.pruefen.knopf}
          </Button>
        </div>
      ) : null}
      {!geprueft && !uebernommen ? <p className="app-leer-text">{d.pruefen.nochNicht}</p> : null}
      {geprueft && !lauf.eingeschraenkt && fehler !== null ? (
        fehler === 0 ? (
          <Hinweis titel={d.pruefen.fehlerfreiTitel}>{d.pruefen.fehlerfrei(warnungen)}</Hinweis>
        ) : (
          <Hinweis variante="fehler" titel={d.pruefen.mitFehlernTitel}>
            {d.pruefen.mitFehlern(fehler, warnungen)}
          </Hinweis>
        )
      ) : null}
      {geprueft && !lauf.eingeschraenkt ? (
        <>
          <h3 className="cw-t-beschriftung">{d.zaehler.titel}</h3>
          <Zaehlertabelle zaehler={vorschauZaehler(lauf)} beschriftung={d.zaehler.tabelle} />
          <p className="app-leer-text">{d.zaehler.erklaerung}</p>
        </>
      ) : null}
    </section>
  );
}

// Befunde ----------------------------------------------------------------------------------------------------------

function Befunde({ lauf }: { lauf: Importlauf }) {
  const t = useT();
  const d = t.datenuebernahme.befunde;
  const sprache = useSprache();
  const [filter, setFilter] = useState<BefundFilter>({});
  const abfrage = useInfiniteQuery(importBefunde(lauf.id, filter));
  const zeilen = abfrage.data?.pages.flatMap((s) => s.daten) ?? [];
  const eingeschraenkt = lauf.eingeschraenkt || abfrage.data?.pages[0]?.eingeschraenkt === true;
  const gekuerzt = lauf.befundeGekuerzt;

  const spalten: TabelleSpalte<Befund>[] = [
    { schluessel: "schweregrad", kopf: d.spalten.schweregrad, zelle: (b) => <Status variante={b.schweregrad === "fehler" ? "fehlt" : "pruefung"}>{aufzaehlung(d.schweregrad, b.schweregrad)}</Status> },
    { schluessel: "blatt", kopf: d.spalten.blatt, zelle: (b) => (b.blatt ? aufzaehlung(t.datenuebernahme.blaetter, b.blatt) : d.ohneStelle) },
    { schluessel: "zeile", kopf: d.spalten.zeile, zahl: true, zelle: (b) => (b.zeile === null ? t.gemeinsam.keinWert : String(b.zeile)) },
    { schluessel: "spalte", kopf: d.spalten.spalte, zelle: (b) => b.spalte ?? t.gemeinsam.keinWert },
    {
      schluessel: "befund",
      kopf: d.spalten.befund,
      umbruch: true,
      zelle: (b) => {
        const meldung = befundMeldung(b, sprache, t.fehler);
        return (
          <>
            <strong className="app-befund__titel">{befundTitel(b.code, sprache, t.fehler)}</strong>
            {meldung}
            {sprache !== "de" && meldung !== b.meldung ? (
              <span className="app-befund__original" lang="de">
                {d.originalDeutsch}: {b.meldung}
              </span>
            ) : null}
          </>
        );
      },
    },
  ];

  return (
    <section className="app-karte" aria-labelledby="lauf-befunde">
      <h2 id="lauf-befunde" className="cw-t-untertitel app-karte__titel">
        {d.titel}
      </h2>
      {eingeschraenkt ? <p className="app-leer-text">{t.datenuebernahme.eingeschraenkt.befundeNur}</p> : null}
      <div className="app-aktionen" role="group" aria-label={d.filter.gruppe}>
        <Auswahl label={d.filter.schweregrad} value={filter.schweregrad ?? ""} onChange={(e) => setFilter((alt) => ({ ...alt, schweregrad: e.target.value === "" ? undefined : (e.target.value as "fehler" | "warnung") }))}>
          <option value="">{d.filter.alle}</option>
          <option value="fehler">{d.filter.fehler}</option>
          <option value="warnung">{d.filter.warnung}</option>
        </Auswahl>
        <Auswahl label={d.filter.blatt} value={filter.blatt ?? ""} onChange={(e) => setFilter((alt) => ({ ...alt, blatt: e.target.value === "" ? undefined : e.target.value }))}>
          <option value="">{d.filter.alleBlaetter}</option>
          {BLAETTER.map((b) => (
            <option key={b} value={b}>
              {t.datenuebernahme.blaetter[b]}
            </option>
          ))}
        </Auswahl>
      </div>
      {abfrage.isPending ? <Skelettzeilen anzahl={3} /> : null}
      <FehlerHinweis fehler={abfrage.error} />
      {abfrage.data && zeilen.length === 0 ? <p className="app-leer-text">{d.keine}</p> : null}
      {zeilen.length > 0 ? <Tabelle beschriftung={d.tabelle} spalten={spalten} zeilen={zeilen} zeilenSchluessel={(b) => b.nr} /> : null}
      {zeilen.length > 0 ? (
        <p className="app-leer-text" aria-live="polite">
          {d.geladen(zeilen.length)}
        </p>
      ) : null}
      {abfrage.hasNextPage ? (
        <div>
          <Button variante="sekundaer" onClick={() => void abfrage.fetchNextPage()} disabled={abfrage.isFetchingNextPage}>
            {abfrage.isFetchingNextPage ? d.laedt : `${d.mehr} (${BEFUNDE_JE_SEITE})`}
          </Button>
        </div>
      ) : null}
      {gekuerzt ? <p className="app-leer-text">{d.gekuerzt(MAX_BEFUNDE)}</p> : null}
    </section>
  );
}

// Übernehmen -------------------------------------------------------------------------------------------------------

/** Warum die Person nicht übernehmen kann (Text), oder `null`. Die API entscheidet endgültig; hier wird nur nichts angeboten, was sie ablehnt. */
function sperrgrund(t: ReturnType<typeof useT>, lauf: Importlauf, ich: NonNullable<ReturnType<typeof useRechte>["ich"]>): string | null {
  const d = t.datenuebernahme.uebernehmen;
  if (ich.technisch) return d.nurMensch;
  if (lauf.hochgeladenVon === ich.id) return `${d.selbstHochgeladen} ${d.anAndere}`;
  if (lauf.geprueftVon === ich.id) return `${d.selbstGeprueft} ${d.anAndere}`;
  const fonds = laufFonds(lauf);
  const neueFonds = (fonds?.neu.length ?? 0) > 0;
  const hatRolleAnFonds = fonds && fonds.ids.length > 0 ? fonds.ids.every((id) => hatRolle(ich, id, "freigeber")) : hatIrgendwoRolle(ich, "freigeber");
  if (!hatRolleAnFonds || (neueFonds && !ich.globalVerwalter)) return d.keineRolle;
  if (lauf.status !== "geprueft") return d.nichtGeprueft;
  return null;
}

function Uebernehmen({ lauf }: { lauf: Importlauf }) {
  const t = useT();
  const d = t.datenuebernahme.uebernehmen;
  const sprache = useSprache();
  const { ich } = useRechte();
  const uebernehmen = useLaufUebernehmen(lauf.id);
  const [offen, setOffen] = useState(false);
  if (!ich) return null;

  if (lauf.status === "uebernommen") {
    return (
      <section className="app-karte" aria-labelledby="lauf-uebernehmen">
        <h2 id="lauf-uebernehmen" className="cw-t-untertitel app-karte__titel">
          {d.titel}
        </h2>
        {uebernehmen.isSuccess ? (
          <Hinweis titel={d.fertigTitel}>{d.fertig}</Hinweis>
        ) : (
          <p className="app-leer-text">{d.schonUebernommen(lauf.uebernommenVonName ?? t.rechte.unbekanntePerson, lauf.uebernommenAm ? formatZeitpunkt(lauf.uebernommenAm, sprache) : "")}</p>
        )}
      </section>
    );
  }

  const grund = sperrgrund(t, lauf, ich);
  return (
    <section className="app-karte" aria-labelledby="lauf-uebernehmen">
      <h2 id="lauf-uebernehmen" className="cw-t-untertitel app-karte__titel">
        {d.titel}
      </h2>
      <p className="app-leer-text">{d.text}</p>
      <FehlerHinweis fehler={uebernehmen.error} />
      {grund ? (
        <p id="uebernehmen-grund" className="app-leer-text" role="note">
          {grund}
        </p>
      ) : (
        <p className="app-leer-text">{d.bereit}</p>
      )}
      <div>
        <Button onClick={() => setOffen(true)} disabled={grund !== null || uebernehmen.isPending} aria-describedby={grund ? "uebernehmen-grund" : undefined}>
          {d.knopf}
        </Button>
      </div>
      {offen ? (
        <Seitenpanel titel={d.titel} onSchliessen={() => setOffen(false)}>
          <div className="app-formular">
            <p>{d.bestaetigung}</p>
            <div className="app-knoepfe">
              <Button
                disabled={uebernehmen.isPending}
                onClick={() => uebernehmen.mutate(undefined, { onSettled: () => setOffen(false) })}
              >
                {uebernehmen.isPending ? d.laeuft : d.knopf}
              </Button>
              <Button variante="sekundaer" onClick={() => setOffen(false)}>
                {d.abbrechen}
              </Button>
            </div>
          </div>
        </Seitenpanel>
      ) : null}
    </section>
  );
}

// Ergebnis und Protokoll -------------------------------------------------------------------------------------------

function FondsErgebnis({ f }: { f: FondsSummen }) {
  const t = useT();
  const d = t.datenuebernahme.ergebnis;
  const sprache = useSprache();
  const betrag = (wert: string | null) => (wert === null ? t.gemeinsam.keinWert : formatBetragCent(wert, sprache));
  const kontrollen = f.kontrollsummen;
  const spalten: TabelleSpalte<FondsSummen["kontrollsummen"][number]>[] = [
    { schluessel: "groesse", kopf: d.spalten.groesse, zelle: (k) => `${aufzaehlung(d.groessen, k.groesse)}${k.beteiligung ? ` · ${k.beteiligung}` : ""}` },
    { schluessel: "quelle", kopf: d.spalten.quelle, zahl: true, zelle: (k) => betrag(k.quelle) },
    { schluessel: "ist", kopf: d.spalten.ist, zahl: true, zelle: (k) => betrag(k.ist) },
    { schluessel: "differenz", kopf: d.spalten.differenz, zahl: true, zelle: (k) => betrag(k.differenz) },
    { schluessel: "status", kopf: d.spalten.status, zelle: (k) => <Status variante={k.status === "ok" ? "freigegeben" : k.status === "abweichung" ? "fehlt" : "pruefung"}>{aufzaehlung(d.kontrolleStatus, k.status)}</Status> },
  ];
  return (
    <div className="app-gruppe">
      <h4 className="cw-t-beschriftung">
        {f.name} ({f.kurzname})
      </h4>
      <dl className="app-fakten">
        <div>
          <dt>{d.fonds.beteiligungen}</dt>
          <dd className="app-zahl">{f.beteiligungen}</dd>
        </div>
        {(["zusagen", "auszahlungen", "rueckfluesse", "tilgungen", "abrufe", "ausschuettungen", "zeichnungskapital"] as const).map((k) => (
          <div key={k}>
            <dt>{d.fonds[k]}</dt>
            <dd className="app-zahl">{betrag(f[k])}</dd>
          </div>
        ))}
        <div>
          <dt>{f.navStichtag ? d.navStichtag(formatDatum(f.navStichtag, sprache)) : d.fonds.nav}</dt>
          <dd className="app-zahl">{betrag(f.nav)}</dd>
        </div>
      </dl>
      {kontrollen.length > 0 ? <Tabelle beschriftung={d.kontrollTabelle(f.name)} spalten={spalten} zeilen={kontrollen} zeilenSchluessel={(k) => `${k.groesse}-${k.beteiligung ?? ""}-${k.stichtag ?? ""}`} /> : null}
    </div>
  );
}

function Ergebnis({ lauf }: { lauf: Importlauf }) {
  const t = useT();
  const d = t.datenuebernahme.ergebnis;
  const ergebnis = laufErgebnis(lauf);
  return (
    <section className="app-karte" aria-labelledby="lauf-ergebnis">
      <h2 id="lauf-ergebnis" className="cw-t-untertitel app-karte__titel">
        {d.titel}
      </h2>
      {ergebnis ? (
        <>
          <h3 className="cw-t-beschriftung">{d.zaehlerTitel}</h3>
          <Zaehlertabelle zaehler={ergebnis.zaehler} beschriftung={t.datenuebernahme.zaehler.tabelle} />
          {ergebnis.fonds.length > 0 ? <h3 className="cw-t-beschriftung">{d.fondsTitel}</h3> : null}
          {ergebnis.fonds.map((f) => (
            <FondsErgebnis key={f.kurzname} f={f} />
          ))}
          <p className="app-leer-text">{d.navHinweis}</p>
        </>
      ) : (
        <p className="app-leer-text">{d.keine}</p>
      )}
    </section>
  );
}

function Protokoll({ lauf }: { lauf: Importlauf }) {
  const t = useT();
  const d = t.datenuebernahme.protokoll;
  const sprache = useSprache();
  const verfuegbar = lauf.geprueftAm !== null && !lauf.eingeschraenkt;
  return (
    <section className="app-karte" aria-labelledby="lauf-protokoll">
      <h2 id="lauf-protokoll" className="cw-t-untertitel app-karte__titel">
        {d.titel}
      </h2>
      <p className="app-leer-text">{d.text}</p>
      {verfuegbar ? (
        <div className="app-aktionen__knoepfe">
          <ButtonLink variante="sekundaer" href={protokollUrl(lauf.id, "pdf", sprache)} download>
            {d.pdf}
          </ButtonLink>
          <ButtonLink variante="sekundaer" href={protokollUrl(lauf.id, "xlsx", sprache)} download>
            {d.xlsx}
          </ButtonLink>
        </div>
      ) : (
        <p className="app-leer-text">{lauf.eingeschraenkt ? d.nurMitRechten : d.nurNachPruefung}</p>
      )}
    </section>
  );
}
