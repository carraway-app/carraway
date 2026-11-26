import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { Auswahl, BriefcaseIcon, BuildingsIcon, Button, CalendarCheckIcon, Dialog, Feld as Eingabe, Leer, Segment, Seitenkopf, Tabs, UserCircleIcon, type IconKomponente } from "@carraway/ui";
import {
  crmListen,
  crmSchluessel,
  ladeAbfrageSeite,
  useDatensatzAendern,
  useListeAnlegen,
  useListeEintraege,
  useListeEintragFelder,
  useMassenaktion,
  type AbfrageEingabe,
  type AbfrageAntwort,
  type Feld,
  type Konfig,
  type Massenaktion,
  type MassenErgebnis,
  type Objekt,
  type Zeile,
} from "../api/crm";
import { Datengitter, type GitterSpalte } from "../komponenten/crm/Datengitter";
import { GruppierteTabelle } from "../komponenten/crm/Gruppen";
import { KontaktBoard } from "../komponenten/crm/KontaktBoard";
import { FelderDialog } from "../komponenten/crm/FelderDialog";
import { ImportDialog } from "../komponenten/crm/ImportDialog";
import { Massenleiste } from "../komponenten/crm/Massenleiste";
import { Werkzeuge, istGruppierbar } from "../komponenten/crm/Werkzeuge";
import { angeforderteFelder, useAnsicht } from "../komponenten/crm/zustand";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { useEntprellt } from "../komponenten/formular";
import { NeuerDealDialog } from "../komponenten/NeuerDealDialog";
import { NurLesen } from "../komponenten/NurLesen";
import { OrganisationNeuDialog } from "../komponenten/OrganisationDialoge";
import { PersonDialog } from "../komponenten/PersonDialog";
import { Wiedervorlagen } from "../komponenten/Wiedervorlagen";
import { NaechsteTermine } from "../komponenten/NaechsteTermine";
import { AufgabenListe } from "../komponenten/crm/Datensatzpanel";
import { useT } from "../i18n";
import { useRechte } from "../lib/rechte";
import { recordLink } from "../komponenten/crm/typen";

const route = getRouteApi("/kontakte");
const OBJEKTE: Objekt[] = ["organisation", "person", "deal"];
const OBJEKT_ICON: Record<Objekt, IconKomponente> = { organisation: BuildingsIcon, person: UserCircleIcon, deal: BriefcaseIcon };
const SEITE = 100;
const STANDARD_BREITE = 170;
const NAMEN_BREITE = 240;

/** CRM: Unternehmen, Kontakte und Deals als Tabellen mit eigenen Feldern, Filtern, gespeicherten Ansichten und Listen. */
export function KontaktePage() {
  const t = useT();
  const navigate = route.useNavigate();
  const wechsel = useNavigate();
  const { darf, ich } = useRechte();
  const suche = route.useSearch();
  const ansichtTab = suche.objekt ?? "organisation";
  const heute = ansichtTab === "heute";
  const objekt: Objekt = heute ? "organisation" : ansichtTab;
  const listeId = suche.liste;
  const [eingabe, setEingabe] = useState(suche.suche ?? "");
  const entprellt = useEntprellt(eingabe.trim(), 250);
  const [auswahl, setAuswahl] = useState<ReadonlySet<string>>(new Set());
  const [offen, setOffen] = useState<null | "neu" | "import" | "felder" | "liste">(null);
  const [listenName, setListenName] = useState("");
  const [ergebnis, setErgebnis] = useState<MassenErgebnis | null>(null);
  const [schreibFehler, setSchreibFehler] = useState<unknown>(null);

  // Die URL folgt der entprellten Eingabe, nicht jedem Tastendruck.
  useEffect(() => {
    if (entprellt !== (suche.suche ?? "")) void navigate({ search: (alt) => ({ ...alt, suche: entprellt || undefined }), replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entprellt]);
  // „Neu“ aus der Befehlsleiste: Dialog öffnen und den Parameter aus der Adresse nehmen.
  useEffect(() => {
    if (suche.neu === "1" && !heute) {
      setOffen("neu");
      void navigate({ search: (alt) => ({ ...alt, neu: undefined }), replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suche.neu]);
  useEffect(() => {
    setAuswahl(new Set());
    setErgebnis(null);
  }, [objekt, listeId, suche.ansicht, suche.suche]);

  const z = useAnsicht(objekt, listeId, suche.ansicht);
  const listen = useQuery(crmListen(objekt));
  const aktuelleListe = listen.data?.find((l) => l.id === listeId);
  const felderNachSchluessel = useMemo(() => new Map(z.felder.map((f) => [f.schluessel, f])), [z.felder]);

  const spaltenKonfig = z.konfig.spalten;
  const angefordert = angeforderteFelder(objekt, z.konfig, z.felder);
  const basis: AbfrageEingabe = {
    ...(z.konfig.filter ? { filter: z.konfig.filter } : {}),
    sortierung: z.konfig.sortierung,
    spalten: angefordert.map((feld) => ({ feld })),
    ...(entprellt ? { suche: entprellt } : {}),
    ...(listeId ? { listeId } : {}),
  };
  // Gruppierung der Ansicht: nur Felder, die es (noch) gibt und die sich gruppieren lassen.
  const gruppeFeld = z.art === "tabelle" && z.konfig.gruppierung ? felderNachSchluessel.get(z.konfig.gruppierung) : undefined;
  const gruppiert = gruppeFeld !== undefined && istGruppierbar(gruppeFeld);
  // Board (Kanban) nach einem Auswahlfeld für Unternehmen und Kontakte; Deals haben ihr Board im Dealflow.
  const istBoard = z.art === "kanban" && objekt !== "deal";
  const auswahlFelder = z.felder.filter((f) => f.typ === "auswahl" && !f.archiviertAm);
  const boardFeld = istBoard ? (auswahlFelder.find((f) => f.schluessel === z.konfig.gruppierung) ?? auswahlFelder.find((f) => !f.system) ?? auswahlFelder[0]) : undefined;
  const seiten = useInfiniteQuery({
    queryKey: [...crmSchluessel.abfrage(objekt), "seiten", basis],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => ladeAbfrageSeite(objekt, { ...basis, limit: SEITE, offset: pageParam }),
    getNextPageParam: (letzte: AbfrageAntwort, alle: AbfrageAntwort[]) => {
      const n = alle.reduce((s, p) => s + p.daten.length, 0);
      return n < letzte.gesamt ? n : undefined;
    },
    enabled: z.bereit && !gruppiert && !istBoard,
    // Beim Sortieren und Filtern bleibt die alte Tabelle stehen, bis die neue da ist.
    placeholderData: keepPreviousData,
  });
  const zeilen: Zeile[] = seiten.data?.pages.flatMap((p) => p.daten) ?? [];
  const bezuege = useMemo(() => Object.assign({}, ...(seiten.data?.pages.map((p) => p.bezuege) ?? [])) as Record<string, string | null>, [seiten.data]);
  const gesamt = seiten.data?.pages[0]?.gesamt ?? 0;

  const aendern = useDatensatzAendern(objekt);
  const massen = useMassenaktion(objekt);
  const listeAnlegen = useListeAnlegen();
  const listenEintraege = useListeEintraege(listeId ?? "00000000-0000-4000-8000-000000000000");
  const listenFelder = useListeEintragFelder();

  const spalten: GitterSpalte[] = spaltenKonfig.flatMap((s) => {
    const feld = felderNachSchluessel.get(s.feld);
    return feld ? [{ feld, breite: Math.max(80, Math.min(800, s.breite ?? (feld.schluessel === "name" || feld.schluessel === "titel" ? NAMEN_BREITE : STANDARD_BREITE))) }] : [];
  });

  const sortiere = (schluessel: string) => {
    const aktuell = z.konfig.sortierung.find((s) => s.feld === schluessel);
    z.setzeKonfig({ sortierung: !aktuell ? [{ feld: schluessel, richtung: "auf" }] : aktuell.richtung === "auf" ? [{ feld: schluessel, richtung: "ab" }] : [] });
  };
  const breite = (schluessel: string, neu: number) => z.setzeKonfig({ spalten: spaltenKonfig.map((s) => (s.feld === schluessel ? { ...s, breite: Math.max(80, Math.min(800, Math.round(neu))) } : s)) });

  const aendereZeile = (zeile: Zeile, feld: Feld, wert: unknown) => {
    setSchreibFehler(null);
    // Listenfelder gehören zum Eintrag in der Liste, nicht zum Datensatz.
    if (feld.listeId && listeId) return listenFelder.mutateAsync({ listeId, datensatzId: zeile.id, felder: { [feld.schluessel]: wert } });
    return aendern.mutateAsync({ id: zeile.id, ...(feld.system ? { system: { [feld.schluessel]: wert } } : { eigene: { [feld.schluessel]: wert } }) });
  };
  const oeffneZeile = (zeile: Zeile) => void wechsel(recordLink(objekt, zeile.id) as never);

  const exportEingabe: AbfrageEingabe = { ...basis, spalten: spaltenKonfig.map((s) => ({ feld: s.feld })) };
  const ids = [...auswahl];
  const fuehreAus = (aktion: Massenaktion) => {
    setSchreibFehler(null);
    return massen.mutateAsync({ ids, aktion }).then((r) => {
      setErgebnis(r);
      setAuswahl(new Set());
    }).catch((e: unknown) => setSchreibFehler(e));
  };
  const darfBearbeiten = darf("bearbeiter");
  const istVerwalter = Boolean(ich?.globalVerwalter);
  const darfListenfelder = Boolean(aktuelleListe && (istVerwalter || aktuelleListe.besitzerId === ich?.id));
  // Felder des Datensatzes darf ändern, wer schreiben darf; Listenfelder nur Besitzerin oder Besitzer der Liste und Verwalter (Regel der API).
  const darfFeldSchreiben = (_zeile: Zeile, feld: Feld) => (feld.listeId ? darfListenfelder : darfBearbeiten);
  const setzeSuche = (patch: Record<string, unknown>) => void navigate({ search: (alt) => ({ ...alt, ...patch }), replace: true });

  const neuKnopf =
    objekt === "organisation" ? t.crm.neuUnternehmen : objekt === "person" ? t.crm.neuKontakt : t.crm.neuDeal;

  return (
    <div className="app-seite">
      <Seitenkopf
        meta={t.crm.etikett}
        titel={t.crm.titel}
        aktionen={
          <>
            {istVerwalter ? (
              <Button variante="sekundaer" onClick={() => setOffen("felder")}>
                {t.crm.felderVerwalten}
              </Button>
            ) : null}
            {darfBearbeiten && objekt !== "deal" ? (
              <Button variante="sekundaer" onClick={() => setOffen("import")}>
                {t.crm.importieren}
              </Button>
            ) : null}
            {darfBearbeiten ? <Button onClick={() => setOffen("neu")}>{neuKnopf}</Button> : null}
          </>
        }
      />
      <NurLesen />

      <Tabs
        aria-label={t.crm.objekte.beschriftung}
        aktiv={ansichtTab}
        onWechsel={(id) => void navigate({ search: (alt) => ({ suche: alt.suche, objekt: id === "organisation" ? undefined : (id as "person" | "deal" | "heute") }), replace: false })}
        tabs={[...OBJEKTE.map((o) => ({ id: o as string, icon: OBJEKT_ICON[o], label: t.crm.objekte[o] })), { id: "heute", icon: CalendarCheckIcon, label: t.crm.tabHeute }]}
      >
        {heute ? (
          <HeuteTab />
        ) : (
        <section className="app-karte app-crm" aria-label={t.crm.objekte[objekt]}>
          <div className="app-crm__listenzeile">
            <Auswahl label={t.crm.liste} value={listeId ?? ""} onChange={(e) => setzeSuche({ liste: e.target.value || undefined, ansicht: undefined })} className="app-crm__listenwahl">
              <option value="">{t.crm.alleDatensaetze(t.crm.objekte[objekt])}</option>
              {(listen.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {`${l.name} (${l.eintraege})`}
                </option>
              ))}
            </Auswahl>
            {darfBearbeiten ? (
              <Button variante="sekundaer" onClick={() => setOffen("liste")}>
                {t.crm.neueListe}
              </Button>
            ) : null}
            {darfListenfelder ? (
              <Button variante="sekundaer" onClick={() => setOffen("felder")}>
                {t.crm.listenfelder}
              </Button>
            ) : null}
            <Segment<"tabelle" | "kanban">
              aria-label={t.crm.darstellung}
              value={objekt === "deal" ? "tabelle" : z.art}
              onChange={(wert) => {
                if (objekt === "deal") {
                  if (wert === "kanban") void wechsel({ to: "/dealflow", search: {} });
                } else if (wert === "kanban") {
                  // Spalten nach einem Auswahlfeld: das gewählte, sonst das erste eigene.
                  const feld = auswahlFelder.find((f) => f.schluessel === z.konfig.gruppierung) ?? auswahlFelder.find((f) => !f.system) ?? auswahlFelder[0];
                  z.setzeKonfig({ gruppierung: feld?.schluessel ?? null }, "kanban");
                } else z.setzeKonfig({}, "tabelle");
              }}
              options={[
                { wert: "tabelle", label: t.crm.darstellungTabelle },
                { wert: "kanban", label: t.crm.darstellungBoard },
              ]}
            />
          </div>
          {aktuelleListe?.beschreibung ? <p className="app-leer-text">{aktuelleListe.beschreibung}</p> : null}

          <Werkzeuge
            z={z}
            objekt={objekt}
            listeId={listeId}
            suche={eingabe}
            onSuche={setEingabe}
            onAnsicht={(id) => setzeSuche({ ansicht: id ?? "keine" })}
            istVerwalter={istVerwalter}
            mitSpalten
            exportEingabe={exportEingabe}
          />

          <FehlerHinweis fehler={(schreibFehler ?? aendern.error ?? seiten.error) as Error | null} />
          {auswahl.size > 0 ? (
            <Massenleiste
              objekt={objekt}
              anzahl={auswahl.size}
              felder={z.felder}
              listen={(listen.data ?? []).filter((l) => l.id !== listeId)}
              inListe={Boolean(listeId)}
              darfSchreiben={darfBearbeiten}
              laeuft={massen.isPending}
              ergebnis={ergebnis}
              onAktion={fuehreAus}
              onEntfernen={() =>
                listenEintraege.mutateAsync({ datensatzIds: ids, entfernen: true }).then(() => {
                  setAuswahl(new Set());
                })
              }
              onLeeren={() => setAuswahl(new Set())}
            />
          ) : ergebnis ? (
            <p role="status" className="app-leer-text">
              {ergebnis.fehler.length ? t.crm.massenTeilweise(ergebnis.erfolgreich, ergebnis.fehler.length, [...new Set(ergebnis.fehler.map((f) => (t.fehler as Record<string, string>)[f.code] ?? f.code))].join("; ")) : t.crm.massenErfolg(ergebnis.erfolgreich)}
            </p>
          ) : null}

          <div aria-busy={seiten.isFetching} className="app-ergebnisse">
            {istBoard && z.bereit ? (
              boardFeld ? (
                <KontaktBoard
                  key={`${objekt}|${listeId ?? ""}|${boardFeld.schluessel}`}
                  objekt={objekt}
                  basis={basis}
                  feld={boardFeld}
                  spalten={spalten}
                  darfVerschieben={(k) => darfFeldSchreiben(k, boardFeld)}
                  onVerschieben={(k, wert) => aendereZeile(k, boardFeld, wert)}
                  beschriftung={`${t.crm.objekte[objekt]}: ${t.crm.darstellungBoard}`}
                />
              ) : (
                <Leer zeichen="K" titel={t.crm.boardFeldHinweis} />
              )
            ) : gruppiert && z.bereit ? (
              <GruppierteTabelle
                key={`${objekt}|${listeId ?? ""}|${gruppeFeld.schluessel}`}
                objekt={objekt}
                basis={basis}
                gruppeFeld={gruppeFeld}
                spalten={spalten}
                sortierung={z.konfig.sortierung}
                onSortieren={sortiere}
                onBreite={breite}
                auswahl={auswahl}
                onAuswahl={setAuswahl}
                darfSchreiben={darfFeldSchreiben}
                onAendern={aendereZeile}
                onOeffnen={oeffneZeile}
                beschriftung={t.crm.objekte[objekt]}
              />
            ) : seiten.isPending || !z.bereit ? (
              <div aria-hidden="true">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="app-skelett app-skelett--zeile" />
                ))}
              </div>
            ) : zeilen.length === 0 ? (
              <Leer zeichen="K" titel={t.crm.keine} beschreibung={t.crm.keineBeschreibung} />
            ) : (
              <Datengitter
                key={`${objekt}|${listeId ?? ""}`}
                objekt={objekt}
                spalten={spalten}
                zeilen={zeilen}
                gesamt={gesamt}
                bezuege={bezuege}
                sortierung={z.konfig.sortierung}
                onSortieren={sortiere}
                onBreite={breite}
                auswahl={auswahl}
                onAuswahl={setAuswahl}
                darfSchreiben={darfFeldSchreiben}
                onAendern={aendereZeile}
                ladeMehr={() => void seiten.fetchNextPage()}
                laedtMehr={seiten.isFetchingNextPage}
                beschriftung={t.crm.objekte[objekt]}
                onOeffnen={oeffneZeile}
              />
            )}
          </div>
        </section>
        )}
      </Tabs>

      {offen === "neu" && objekt === "organisation" ? <OrganisationNeuDialog onSchliessen={() => setOffen(null)} /> : null}
      {offen === "neu" && objekt === "person" ? <PersonDialog onSchliessen={() => setOffen(null)} /> : null}
      {offen === "neu" && objekt === "deal" ? <NeuerDealDialog onSchliessen={() => setOffen(null)} /> : null}
      {offen === "import" && objekt !== "deal" ? <ImportDialog vorgabe={objekt} onSchliessen={() => setOffen(null)} /> : null}
      {offen === "felder" ? <FelderDialog objekt={objekt} {...(listeId && darfListenfelder && !istVerwalter ? { listeId } : {})} onSchliessen={() => setOffen(null)} /> : null}
      {offen === "liste" ? (
        <Dialog
          titel={t.crm.neueListe}
          onSchliessen={() => setOffen(null)}
          aktionen={
            <>
              <Button variante="sekundaer" onClick={() => setOffen(null)}>
                {t.crm.abbrechen}
              </Button>
              <Button
                type="submit"
                form="liste-neu"
                disabled={listeAnlegen.isPending}
              >
                {t.crm.anlegen}
              </Button>
            </>
          }
        >
          <form
            id="liste-neu"
            className="app-formular"
            onSubmit={(e) => {
              e.preventDefault();
              if (!listenName.trim()) return;
              listeAnlegen.mutate(
                { name: listenName.trim(), objekt },
                {
                  onSuccess: (neu) => {
                    setOffen(null);
                    setListenName("");
                    setzeSuche({ liste: neu.id, ansicht: undefined });
                  },
                },
              );
            }}
          >
            <FehlerHinweis fehler={listeAnlegen.error} />
            <Eingabe label={t.crm.listeName} value={listenName} onChange={(e) => setListenName(e.target.value)} />
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}

export type { Konfig };

/** „Heute“: meine Wiedervorlagen, meine Aufgaben und meine nächsten Termine, quer über alle Datensätze. */
function HeuteTab() {
  return (
    <div className="app-crm">
      <Wiedervorlagen />
      <AufgabenListe zustaendig="ich" />
      <NaechsteTermine filter={{ eigene: true }} mitBezug />
    </div>
  );
}
