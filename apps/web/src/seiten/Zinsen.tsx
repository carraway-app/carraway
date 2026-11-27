import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Hinweis, Karte, Kennzahl, KennzahlenReihe, Leer, Status, Tabelle, formatBetrag, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { fondsZinsen, type FondsZinsen } from "../api/zinsen";
import { Bereichskopf } from "../komponenten/Bereichskopf";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { Skelettzeilen } from "../komponenten/Skelett";
import { StichtagMenue } from "../komponenten/StichtagMenue";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { formatSatz } from "../lib/zahl";

const route = getRouteApi("/funds/$fundId/interest");

type Zeile = FondsZinsen["instrumente"][number];

/**
 * Fonds → Zinsen: die Zinsen aller darlehensartigen Instrumente des Fonds zum eigenen Stichtag und Wissensstand dieser Seite (die Kennzahlen
 * im Rahmen bleiben aktuell). Eine Zinsbuchung ist eine Forderung, erst die Zinszahlung der Geldeingang; die Buchhaltung arbeitet mit der Zinsabgrenzung.
 */
export function FondsZinsenSeite() {
  const t = useT();
  const sprache = useSprache();
  const z = t.fondsZinsen;
  const { fundId: fondsId } = route.useParams();
  const { stichtag, stand } = route.useSearch();
  const navigate = route.useNavigate();
  const { data, error, isPending } = useQuery(fondsZinsen(fondsId, stichtag, stand));
  const keinWert = t.gemeinsam.keinWert;
  const betrag = (wert: string | null) => (wert === null ? keinWert : formatBetrag(wert, sprache));

  const spalten: TabelleSpalte<Zeile>[] = [
    {
      schluessel: "unternehmen",
      kopf: z.spalten.unternehmen,
      zelle: (r) => (
        <Link to="/investments/$id" params={{ id: r.beteiligungId }} search={{ tab: "finanzierung", unter: "zinsen", ...(data ? { stichtag: data.stichtag } : {}) }} aria-label={z.zurBeteiligung(r.organisation.name)}>
          {r.organisation.name}
        </Link>
      ),
    },
    { schluessel: "instrument", kopf: z.spalten.instrument, zelle: (r) => r.bezeichnung },
    { schluessel: "art", kopf: z.spalten.art, zelle: (r) => aufzaehlung(t.instrument, r.art) },
    { schluessel: "satz", kopf: z.spalten.satz, zelle: (r) => (r.konditionen ? `${formatSatz(r.konditionen.satzFix, sprache)} · ${aufzaehlung(t.zinsmethode, r.konditionen.methode)}` : keinWert) },
    { schluessel: "aufgelaufen", kopf: z.spalten.aufgelaufen, zahl: true, zelle: (r) => betrag(r.aufgelaufen) },
    { schluessel: "gebucht", kopf: z.spalten.gebucht, zahl: true, zelle: (r) => betrag(r.gebucht) },
    { schluessel: "kapitalisiert", kopf: z.spalten.kapitalisiert, zahl: true, zelle: (r) => betrag(r.kapitalisiert) },
    { schluessel: "gezahlt", kopf: z.spalten.gezahlt, zahl: true, zelle: (r) => betrag(r.gezahlt) },
    ...(Number(data?.summe.gewandelt ?? 0) !== 0 ? [{ schluessel: "gewandelt", kopf: z.spalten.gewandelt, zahl: true, zelle: (r: Zeile) => betrag(r.gewandelt) }] : []),
    { schluessel: "offen", kopf: z.spalten.offen, zahl: true, zelle: (r) => betrag(r.offen) },
    { schluessel: "faellig", kopf: z.spalten.faellig, zelle: (r) => (r.naechsteFaelligkeit ? formatDatum(r.naechsteFaelligkeit, sprache) : keinWert) },
    {
      schluessel: "status",
      kopf: z.spalten.status,
      zelle: (r) => <Status variante={r.fehler ? "fehlt" : r.status === "aktiv" ? "freigegeben" : "entwurf"}>{r.fehler ? z.fehlerKurz : aufzaehlung(t.instrumenteAbschnitt.status, r.status)}</Status>,
    },
  ];

  return (
    <div className="app-seite">
      <Bereichskopf info={z.beschreibung} titel={z.titel}>
        <StichtagMenue
          fondsId={fondsId}
          stichtag={data?.stichtag ?? stichtag ?? ""}
          onStichtag={(neu) => void navigate({ search: (alt) => ({ ...alt, stichtag: neu }), replace: true })}
          stand={stand}
          onStand={(neu) => void navigate({ search: (alt) => ({ ...alt, stand: neu }), replace: true })}
        />
        <Link to="/interest-runs" search={{ fondsId }}>
          {z.zinslaeufe}
        </Link>
      </Bereichskopf>
      {isPending ? <Skelettzeilen anzahl={3} /> : null}
      {error ? <FehlerHinweis fehler={error} /> : null}
      {data ? (
        <>
          <KennzahlenReihe aria-label={z.summe}>
            <Kennzahl titel={z.spalten.aufgelaufen} wert={betrag(data.summe.aufgelaufen)} />
            <Kennzahl titel={z.spalten.gebucht} wert={betrag(data.summe.gebucht)} />
            <Kennzahl titel={z.spalten.kapitalisiert} wert={betrag(data.summe.kapitalisiert)} />
            <Kennzahl titel={z.spalten.gezahlt} wert={betrag(data.summe.gezahlt)} />
            {Number(data.summe.gewandelt) !== 0 ? <Kennzahl titel={z.spalten.gewandelt} wert={betrag(data.summe.gewandelt)} /> : null}
            <Kennzahl titel={z.spalten.offen} wert={betrag(data.summe.offen)} hervorgehoben />
          </KennzahlenReihe>
          <Karte breit titel={z.tabelle(formatDatum(data.stichtag, sprache))}>
            {data.instrumente.some((r) => r.fehler) ? <Hinweis>{z.fehlerBerechnung}</Hinweis> : null}
            {data.instrumente.length === 0 ? (
              <Leer kompakt beschreibung={z.keine} />
            ) : (
              <Tabelle
                dicht
                beschriftung={z.titel}
                spalten={spalten}
                zeilen={data.instrumente}
                zeilenSchluessel={(r) => r.instrumentId}
                fusszeile={{
                  unternehmen: z.summe,
                  aufgelaufen: betrag(data.summe.aufgelaufen),
                  gebucht: betrag(data.summe.gebucht),
                  kapitalisiert: betrag(data.summe.kapitalisiert),
                  gezahlt: betrag(data.summe.gezahlt),
                  gewandelt: betrag(data.summe.gewandelt),
                  offen: betrag(data.summe.offen),
                }}
              />
            )}
          </Karte>
        </>
      ) : null}
    </div>
  );
}
