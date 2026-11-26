import "../../crm.css";
import { useMemo, useState } from "react";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { CaretDownIcon, CaretRightIcon, formatBetrag } from "@carraway/ui";
import { crmGruppen, ladeAbfrageSeite, type AbfrageAntwort, type AbfrageEingabe, type Bedingung, type Feld, type Gruppe, type Gruppenzeile, type Konfig, type Objekt, type Zeile } from "../../api/crm";
import { useSprache, useT } from "../../i18n";
import { FehlerHinweis } from "../FehlerHinweis";
import { Datengitter, type GitterSpalte } from "./Datengitter";
import { Chip } from "./Zelle";
import { feldName, optionenVon } from "./typen";

/** Bedingung, die genau die Zeilen einer Gruppe trifft (dieselben Operatoren wie im Filter, nichts Besonderes für den Server). */
export function gruppenBedingung(feld: Feld, wert: string | null): Bedingung {
  if (feld.typ === "kontrollkaestchen") return { feld: feld.schluessel, operator: wert === "true" ? "ist_wahr" : "ist_falsch" };
  if (wert === null) return { feld: feld.schluessel, operator: "leer" };
  if (feld.typ === "mehrfachauswahl") return { feld: feld.schluessel, operator: "enthaelt_eines", wert: [wert] };
  return { feld: feld.schluessel, operator: "ist", wert };
}

/** Hängt eine Bedingung mit UND an den Filter (flach, wenn der Filter schon ein UND ist; sonst als Gruppe, die den ODER-Filter einschließt). */
export function mitBedingung(filter: Gruppe | undefined, b: Bedingung): Gruppe {
  if (!filter) return { verknuepfung: "und", elemente: [b] };
  return filter.verknuepfung === "und" ? { verknuepfung: "und", elemente: [...filter.elemente, b] } : { verknuepfung: "und", elemente: [filter, b] };
}

const GRUPPENHOEHE = 288;
const MAX_SUMMEN = 6;
const SEITE = 100;

interface Props {
  objekt: Objekt;
  basis: AbfrageEingabe;
  gruppeFeld: Feld;
  spalten: GitterSpalte[];
  sortierung: Konfig["sortierung"];
  onSortieren: (feld: string) => void;
  onBreite: (feld: string, breite: number) => void;
  auswahl: ReadonlySet<string>;
  onAuswahl: (neu: Set<string>) => void;
  darfSchreiben: (zeile: Zeile, feld: Feld) => boolean;
  onAendern: (zeile: Zeile, feld: Feld, wert: unknown) => Promise<unknown>;
  onOeffnen: (zeile: Zeile) => void;
  beschriftung: string;
}

/**
 * Tabelle in Gruppen nach einem Auswahl-, Mehrfachauswahl-, Personen-, Verknüpfungs- oder Kontrollkästchenfeld: je Gruppe eine aufklappbare Kopfzeile mit Anzahl und Summen der Betrags- und Zahlenspalten,
 * darunter die Zeilen der Gruppe als eigene Tabelle (erst beim Aufklappen geladen). Gruppen und Summen kommen vom Server mit der Treffermenge der Abfrage; die Zeilen einer Gruppe
 * holt dieselbe Abfrage mit einer Bedingung auf das Gruppenfeld.
 */
export function GruppierteTabelle({ objekt, basis, gruppeFeld, spalten, beschriftung: tabellenName, ...rest }: Props) {
  const t = useT();
  const sprache = useSprache();
  const summenFelder = useMemo(() => spalten.map((s) => s.feld).filter((f) => f.typ === "betrag" || f.typ === "zahl").slice(0, MAX_SUMMEN), [spalten]);
  const gruppenEingabe = useMemo(() => ({ ...(basis.filter ? { filter: basis.filter } : {}), ...(basis.suche ? { suche: basis.suche } : {}), ...(basis.listeId ? { listeId: basis.listeId } : {}) }) as AbfrageEingabe, [basis]);
  const abfrage = useQuery(crmGruppen(objekt, gruppenEingabe, gruppeFeld.schluessel, summenFelder.map((f) => f.schluessel)));
  const [geoeffnet, setGeoeffnet] = useState<Record<string, boolean>>({});

  if (abfrage.isError) return <FehlerHinweis fehler={abfrage.error} />;
  if (!abfrage.data) {
    return (
      <div aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="app-skelett app-skelett--zeile" />
        ))}
      </div>
    );
  }
  const { gruppen, bezuege, abgeschnitten } = abfrage.data;
  if (gruppen.length === 0) return <p className="app-leer-text">{t.crm.keine}</p>;

  const formatiere = (f: Feld, wert: string) => (f.typ === "betrag" ? formatBetrag(wert, sprache) : new Intl.NumberFormat(sprache === "de" ? "de-DE" : "en-GB", { maximumFractionDigits: 6 }).format(Number(wert)));
  const bezeichnung = (g: Gruppenzeile): ReturnType<typeof Chip> | string => {
    if (g.wert === null) return t.crm.gruppeOhneWert;
    if (gruppeFeld.typ === "benutzer") return bezuege[`benutzer:${g.wert}`] ?? t.crm.keinZugriff;
    if (gruppeFeld.typ === "verknuepfung") return bezuege[`${gruppeFeld.ziel}:${g.wert}`] ?? t.crm.keinZugriff;
    if (gruppeFeld.typ === "kontrollkaestchen") return <Chip farbe={g.wert === "true" ? "signal" : "grau"}>{g.wert === "true" ? t.crm.ja : t.crm.nein}</Chip>;
    const o = optionenVon(gruppeFeld, t).find((x) => x.schluessel === g.wert);
    return <Chip farbe={o?.farbe ?? "grau"}>{o?.label ?? g.wert}</Chip>;
  };
  const text = (g: Gruppenzeile): string => {
    if (g.wert === null) return t.crm.gruppeOhneWert;
    if (gruppeFeld.typ === "benutzer") return bezuege[`benutzer:${g.wert}`] ?? t.crm.keinZugriff;
    if (gruppeFeld.typ === "verknuepfung") return bezuege[`${gruppeFeld.ziel}:${g.wert}`] ?? t.crm.keinZugriff;
    if (gruppeFeld.typ === "kontrollkaestchen") return g.wert === "true" ? t.crm.ja : t.crm.nein;
    return optionenVon(gruppeFeld, t).find((x) => x.schluessel === g.wert)?.label ?? g.wert;
  };

  return (
    <div className="app-gruppen" aria-busy={abfrage.isFetching}>
      {abgeschnitten ? (
        <p className="app-dubletten__info" role="status">
          {t.crm.gruppenGekuerzt(gruppen.length)}
        </p>
      ) : null}
      {gruppen.map((g, i) => {
        const schluessel = g.wert ?? "\u0000ohne";
        const offen = geoeffnet[schluessel] ?? i < 2;
        const kopfId = `gruppe-${gruppeFeld.schluessel}-${i}`;
        return (
          <section key={schluessel} className="app-gruppe-block" aria-labelledby={kopfId}>
            <h3 className="app-gruppe-block__kopf">
              <button type="button" id={kopfId} className="app-gruppe-block__knopf" aria-expanded={offen} onClick={() => setGeoeffnet((alt) => ({ ...alt, [schluessel]: !offen }))}>
                {offen ? <CaretDownIcon /> : <CaretRightIcon />}
                <span className="app-gruppe-block__name">{bezeichnung(g)}</span>
                <span className="app-gruppe-block__anzahl">{g.anzahl}</span>
                {summenFelder.map((f) => (
                  <span key={f.schluessel} className="app-gruppe-block__summe">
                    {`${feldName(f, t)}: ${formatiere(f, g.summen[f.schluessel] ?? "0")}`}
                  </span>
                ))}
              </button>
            </h3>
            {offen ? <Gruppenzeilen objekt={objekt} basis={basis} gruppeFeld={gruppeFeld} wert={g.wert} spalten={spalten} gesamt={g.anzahl} beschriftung={`${tabellenName}: ${text(g)}`} {...rest} /> : null}
          </section>
        );
      })}
    </div>
  );
}

function Gruppenzeilen({ objekt, basis, gruppeFeld, wert, spalten, gesamt: erwartet, beschriftung, sortierung, onSortieren, onBreite, auswahl, onAuswahl, darfSchreiben, onAendern, onOeffnen }: Props & { wert: string | null; gesamt: number }) {
  const eingabe: AbfrageEingabe = { ...basis, filter: mitBedingung(basis.filter as Gruppe | undefined, gruppenBedingung(gruppeFeld, wert)) };
  const seiten = useInfiniteQuery({
    queryKey: ["crm", "abfrage", objekt, "gruppenzeilen", eingabe],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => ladeAbfrageSeite(objekt, { ...eingabe, limit: SEITE, offset: pageParam }),
    getNextPageParam: (letzte: AbfrageAntwort, alle: AbfrageAntwort[]) => {
      const n = alle.reduce((s, p) => s + p.daten.length, 0);
      return n < letzte.gesamt ? n : undefined;
    },
    placeholderData: keepPreviousData,
  });
  const zeilen: Zeile[] = seiten.data?.pages.flatMap((p) => p.daten) ?? [];
  const bezuege = useMemo(() => Object.assign({}, ...(seiten.data?.pages.map((p) => p.bezuege) ?? [])) as Record<string, string | null>, [seiten.data]);
  const gesamt = seiten.data?.pages[0]?.gesamt ?? erwartet;
  if (seiten.isError) return <FehlerHinweis fehler={seiten.error} />;
  if (!seiten.data) return <div className="app-skelett app-skelett--zeile" aria-hidden="true" />;
  if (zeilen.length === 0) return null;
  return (
    <Datengitter
      objekt={objekt}
      spalten={spalten}
      zeilen={zeilen}
      gesamt={gesamt}
      bezuege={bezuege}
      sortierung={sortierung}
      onSortieren={onSortieren}
      onBreite={onBreite}
      auswahl={auswahl}
      onAuswahl={onAuswahl}
      darfSchreiben={darfSchreiben}
      onAendern={onAendern}
      ladeMehr={() => void seiten.fetchNextPage()}
      laedtMehr={seiten.isFetchingNextPage}
      beschriftung={beschriftung}
      onOeffnen={onOeffnen}
      fensterHoehe={GRUPPENHOEHE}
    />
  );
}
