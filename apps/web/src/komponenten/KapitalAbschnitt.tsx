import { lazy, Suspense, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Auswahl, Button, Feld, Hinweis, Segment, SprungAbschnitt, Sprungmarken, Status, Tabelle, formatBetrag, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { anteilsklassen, kapitaltabelle, type Anteilsklasse, type KapitalZeile, type Kapitaltabelle } from "../api/abfragen";
import { useAnteilsklasseAendern, useAnteilsklasseAnlegen, usePositionKlasse } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { useSprache, useT } from "../i18n";
import { useRechte } from "../lib/rechte";
import { anteilZuProzent, formatAnzahl, formatBetragCent, formatSatz, prozentZuAnteil } from "../lib/zahl";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragOderNichts, useFormular } from "./formular";
import { BetragFeld } from "./BetragFeld";
import { betragRegel, ganzzahlRegel, pflichtRegel, prozentRegel } from "../lib/feldpruefung";
import { MitarbeiterAbschnitt } from "./MitarbeiterAbschnitt";
import { Skelettzeilen } from "./Skelett";

// Übertragungen (Liste und Dialoge) laden erst mit dem Abschnitt der Seite.
const UebertragungenAbschnitt = lazy(() => import("./Uebertragungen").then((m) => ({ default: m.UebertragungenAbschnitt })));

type Klassenzeile = Kapitaltabelle["klassen"][number];
type Inhaberzeile = Kapitaltabelle["inhaber"][number];
type OffeneWandlung = Kapitaltabelle["offeneWandlungen"]["liste"][number];
type Sicht = "unverwaessert" | "voll_verwaessert";

/** Anteil als Bruch der API (`0.120000`) in Prozent mit höchstens zwei Nachkommastellen. */
const anteilText = (anteil: string, sprache: Parameters<typeof formatSatz>[1]) => formatSatz(anteil, sprache);

/**
 * Kapitaltabelle einer Beteiligung nach Inhaber und Klasse mit Umschalter unverwässert / voll verwässert (Standard je Installation, der Pool
 * der Mitarbeiterbeteiligung als eigene Zeilen), die Positionen des Fonds hervorgehoben, dazu die Anteilsklassen des Unternehmens mit Anlegen
 * und Ändern und die Mitarbeiterbeteiligung. Voll verwässert lassen sich offene Wandlungen als Schätzung einbeziehen (Schalter, eigene Zeilen
 * und eine Tabelle der Schätzungen mit ihren Annahmen; was sich nicht schätzen lässt, steht dort als offen). Bearbeiter des Fonds weisen jeder Position ihre Klasse zu. Im früheren
 * Wissensstand (`lesend`) bleibt alles bei der Ansicht.
 */
export function KapitalAbschnitt({ beteiligungId, organisationId, fondsId, stichtag, lesend }: { beteiligungId: string; organisationId: string; fondsId: string; stichtag: string; lesend: boolean }) {
  const t = useT();
  const k = t.kapital;
  const sprache = useSprache();
  const { darf } = useRechte();
  const [mitWandlungen, setMitWandlungen] = useState(false);
  const [gewaehlt, setGewaehlt] = useState<Sicht | null>(null);
  const [standard, setStandard] = useState<Sicht | null>(null);
  const sicht: Sicht = gewaehlt ?? standard ?? "voll_verwaessert";
  const voll = sicht === "voll_verwaessert";
  const { data, error, isPending } = useQuery({ ...kapitaltabelle(beteiligungId, stichtag, voll && mitWandlungen), placeholderData: keepPreviousData });
  if (data && standard === null) setStandard(data.standardSicht as Sicht);
  const klassen = useQuery(anteilsklassen(organisationId));
  const zuweisen = usePositionKlasse();
  const [dialog, setDialog] = useState<{ klasse?: Anteilsklasse } | null>(null);
  const [ansicht, setAnsicht] = useState<"position" | "investor">("position");
  const darfSchreiben = darf("bearbeiter", fondsId, "portfolio") && !lesend;
  const w = k.wandlungen;
  const offeneWandlungen = data?.offeneWandlungen.liste ?? [];
  const mitSchaetzung = voll && mitWandlungen && data?.mitWandlungen === true;
  const anteilIn = (x: { anteilUnverwaessert: string | null; anteilVollVerwaessert: string }) => {
    const wert = voll ? x.anteilVollVerwaessert : x.anteilUnverwaessert;
    return wert === null ? t.gemeinsam.keinWert : anteilText(wert, sprache);
  };
  const inhaberName = (z: KapitalZeile) => (z.halter.art === "stamm" ? k.stamm : (k.halter[z.halter.art]?.(z.halter.name) ?? z.halter.name));
  const schaetzung = (art: string) =>
    art === "wandlung" ? (
      <Status variante="pruefung" title={w.tooltip}>
        {w.schaetzung}
      </Status>
    ) : null;
  const gruppeOhneKlasse = (art: string) => (art === "wandlung" ? k.wandlungGruppe : art === "optionsschein" ? k.optionsscheinGruppe : k.poolGruppe);
  // Nur echte Rundenpositionen haben eine zuweisbare Klasse; Ausübungen, Übertragungen und Sammelzeilen (Id mit Doppelpunkt) erben sie.
  const positionMitKlasse = (z: KapitalZeile) => (z.halter.art === "fonds" || z.halter.art === "organisation") && !z.id.includes(":");
  const investorLink = (id: string, name: string) => (
    <Link to="/organizations/$id" params={{ id }} search={{ tab: "engagement", unter: "vehikel" }}>
      {name}
    </Link>
  );

  const zeilenSpalten: TabelleSpalte<KapitalZeile>[] = [
    {
      schluessel: "inhaber",
      kopf: k.spalten.inhaber,
      umbruch: true,
      zelle: (z) => (
        <span className="app-zusammenhang">
          {z.halter.art === "organisation" && z.halter.id ? (
            <span>
              {z.halter.vehikel && z.halter.vehikel.name !== z.halter.name ? `${z.halter.vehikel.name} · ` : null}
              {investorLink(z.halter.id, z.halter.name)}
            </span>
          ) : (
            inhaberName(z)
          )}
          {schaetzung(z.halter.art)}
          {z.id.startsWith("ausuebung:") ? <Status variante="entwurf">{k.herkunft.ausuebung}</Status> : null}
          {z.id.startsWith("uebertragung:") ? <Status variante="entwurf">{k.herkunft.uebertragung}</Status> : null}
          {z.diesesFonds ? <Status>{k.diesesFonds}</Status> : null}
        </span>
      ),
    },
    {
      schluessel: "klasse",
      kopf: k.spalten.klasse,
      umbruch: true,
      zelle: (z) =>
        !z.ausgegeben ? (
          gruppeOhneKlasse(z.halter.art)
        ) : darfSchreiben && positionMitKlasse(z) && klassen.data ? (
          <Auswahl
            label={k.klasseWaehlen(z.halter.name, z.runde?.bezeichnung ?? "")}
            labelVersteckt
            kompakt
            className="app-zellwahl"
            value={z.klasseId ?? ""}
            disabled={zuweisen.isPending}
            onChange={(e) => zuweisen.mutate({ id: z.id, anteilsklasseId: e.target.value === "" ? null : e.target.value })}
          >
            <option value="">{k.stammanteile}</option>
            {klassen.data.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Auswahl>
        ) : (
          (z.klasseName ?? k.stammanteile)
        ),
    },
    { schluessel: "runde", kopf: k.spalten.runde, zelle: (z) => (z.runde ? <>{z.runde.bezeichnung}<span className="app-zelle-zusatz">{formatDatum(z.runde.datum, sprache)}</span></> : t.gemeinsam.keinWert) },
    { schluessel: "anteile", kopf: k.spalten.anteile, zahl: true, zelle: (z) => formatAnzahl(z.anteile, sprache) },
    { schluessel: "anteil", kopf: k.spalten.anteil, zahl: true, zelle: (z) => anteilIn(z) },
    { schluessel: "investiert", kopf: k.spalten.investiert, zahl: true, zelle: (z) => (Number(z.investiert) > 0 ? formatBetragCent(z.investiert, sprache) : t.gemeinsam.keinWert) },
  ];
  const inhaberSpalten: TabelleSpalte<Inhaberzeile>[] = [
    {
      schluessel: "inhaber",
      kopf: k.spalten.inhaber,
      zelle: (x) => (
        <span className="app-zusammenhang">
          {x.halter.art === "stamm" ? k.stamm : x.halter.art === "organisation" && x.halter.id ? investorLink(x.halter.id, x.halter.name) : (k.halter[x.halter.art]?.(x.halter.name) ?? x.halter.name)}
          {x.vehikel.length > 0 ? <span className="app-dubletten__info">{k.vehikelAnzahl(x.vehikel.length)}</span> : null}
          {schaetzung(x.halter.art)}
          {x.diesesFonds ? <Status>{k.diesesFonds}</Status> : null}
        </span>
      ),
    },
    { schluessel: "positionen", kopf: k.spalten.positionen, zahl: true, zelle: (x) => (x.positionen > 0 ? x.positionen : t.gemeinsam.keinWert) },
    { schluessel: "anteile", kopf: k.spalten.anteile, zahl: true, zelle: (x) => formatAnzahl(x.anteile, sprache) },
    { schluessel: "anteil", kopf: k.spalten.anteil, zahl: true, zelle: (x) => anteilIn(x) },
    { schluessel: "investiert", kopf: k.spalten.investiert, zahl: true, zelle: (x) => (Number(x.investiert) > 0 ? formatBetragCent(x.investiert, sprache) : t.gemeinsam.keinWert) },
  ];
  const klassenSpalten: TabelleSpalte<Klassenzeile>[] = [
    { schluessel: "klasse", kopf: k.klassenSpalten.klasse, zelle: (x) => (x.art === "pool" || x.art === "wandlung" || x.art === "optionsschein" ? gruppeOhneKlasse(x.art) : (x.name ?? k.stammanteile)) },
    { schluessel: "rang", kopf: k.klassenSpalten.rang, zelle: (x) => (x.rang === null ? t.gemeinsam.keinWert : k.rang(x.rang)) },
    { schluessel: "anteile", kopf: k.klassenSpalten.anteile, zahl: true, zelle: (x) => formatAnzahl(x.anteile, sprache) },
    { schluessel: "anteil", kopf: k.klassenSpalten.anteil, zahl: true, zelle: (x) => anteilIn(x) },
    { schluessel: "investiert", kopf: k.klassenSpalten.investiert, zahl: true, zelle: (x) => (Number(x.investiert) > 0 ? formatBetragCent(x.investiert, sprache) : t.gemeinsam.keinWert) },
  ];

  // Abschnitte, die man zusammen liest (Captable, Übertragungen, Klassen, Mitarbeiterbeteiligung): untereinander mit Sprungmarken.
  const marken = [
    { id: "captable", label: k.titel },
    { id: "uebertragungen", label: t.uebertragung.titel },
    { id: "klassen", label: k.klassen.titel },
    { id: "mitarbeiter", label: t.mitarbeiter.titel },
  ];
  return (
    <>
      <Sprungmarken className="cw-sprungmarken--fest" aria-label={k.bereich} marken={marken} />
      <SprungAbschnitt id="captable" label={k.titel}>
        <section className="app-karte" aria-label={k.bereich}>
          <div className="app-karte__kopf">
            <h2 className="cw-t-untertitel app-karte__titel">
              {k.titel}
            </h2>
            {data && data.letzteRunde ? (
              <Segment<Sicht>
                aria-label={k.sicht}
                value={sicht}
                onChange={setGewaehlt}
                options={[
                  { wert: "unverwaessert", label: k.sichten.unverwaessert },
                  { wert: "voll_verwaessert", label: k.sichten.voll_verwaessert },
                ]}
              />
            ) : null}
          </div>
          <p className="app-leer-text">{k.beschreibung(formatDatum(stichtag, sprache))}</p>
          {lesend ? <Hinweis>{k.stand}</Hinweis> : null}
          <FehlerHinweis fehler={zuweisen.error} />
          {isPending ? <Skelettzeilen anzahl={3} /> : null}
          {error ? <FehlerHinweis fehler={error} /> : null}
          {data && data.zeilen.length === 0 ? <p className="app-leer-text">{k.keine}</p> : null}
          {data && data.letzteRunde ? (
            <>
              <p className="app-leer-text">
                {k.sichtHinweis[sicht]} {data.mitPool ? null : k.ohnePool}
              </p>
              {voll && offeneWandlungen.length > 0 ? (
                <label className="app-haken">
                  <input type="checkbox" checked={mitWandlungen} onChange={(e) => setMitWandlungen(e.target.checked)} />
                  <span>{w.schalter}</span>
                </label>
              ) : null}
              <p className="app-leer-text">
                {k.zusammenfassung(
                  mitSchaetzung ? w.sicht : (k.sichten[sicht] ?? ""),
                  formatAnzahl(mitSchaetzung ? data.anteileMitWandlungen : voll ? data.anteileVollVerwaessert : data.anteileUnverwaessert, sprache),
                  data.letzteRunde.bezeichnung,
                  formatBetrag(data.letzteRunde.postMoney, sprache),
                )}
              </p>
              <p className="app-leer-text">
                {k.diesesFondsZeile(formatAnzahl(data.diesesFonds.anteile, sprache), anteilIn(data.diesesFonds), formatBetragCent(data.diesesFonds.investiert, sprache))}{" "}
                {data.mitPool ? k.diesesFondsBeide(anteilText(data.diesesFonds.anteilUnverwaessert ?? "0", sprache), anteilText(data.diesesFonds.anteilVollVerwaessert, sprache)) : null}
              </p>
              {data.inhaber.length < data.zeilen.length ? (
                <Segment<"position" | "investor">
                  aria-label={k.ansicht}
                  value={ansicht}
                  onChange={setAnsicht}
                  options={[
                    { wert: "position", label: k.jePosition },
                    { wert: "investor", label: k.jeInvestor },
                  ]}
                />
              ) : null}
              {ansicht === "investor" && data.inhaber.length < data.zeilen.length ? (
                <Tabelle beschriftung={k.tabelleInvestor} spalten={inhaberSpalten} zeilen={data.inhaber.filter((x) => voll || x.ausgegeben)} zeilenSchluessel={(x) => `${x.halter.art}:${x.halter.id ?? ""}`} ausgewaehlt={(x) => x.diesesFonds} />
              ) : (
                <Tabelle beschriftung={k.tabelle} className="app-tabelle-schmal" spalten={zeilenSpalten} zeilen={data.zeilen.filter((z) => voll || z.ausgegeben)} zeilenSchluessel={(z) => z.id} ausgewaehlt={(z) => z.diesesFonds} />
              )}
              <Tabelle beschriftung={k.klassenTabelle} spalten={klassenSpalten} zeilen={data.klassen.filter((x) => voll || (x.art !== "pool" && x.art !== "wandlung" && x.art !== "optionsschein"))} zeilenSchluessel={(x) => x.id ?? x.art} />
              {voll && mitWandlungen && offeneWandlungen.length > 0 ? <OffeneWandlungen liste={offeneWandlungen} referenzpreis={data.offeneWandlungen.referenzpreis} anteileVor={data.offeneWandlungen.anteileVorWandlung} /> : null}
            </>
          ) : null}
        </section>
      </SprungAbschnitt>

      <SprungAbschnitt id="uebertragungen" label={t.uebertragung.titel}>
        <Suspense fallback={null}>
          <UebertragungenAbschnitt beteiligungId={beteiligungId} organisationId={organisationId} fondsId={fondsId} lesend={lesend} />
        </Suspense>
      </SprungAbschnitt>

      <SprungAbschnitt id="klassen" label={k.klassen.titel}>
        <section className="app-karte" aria-labelledby="klassen-titel">
          <div className="app-karte__kopf">
            <h2 id="klassen-titel" className="cw-t-untertitel app-karte__titel">
              {k.klassen.titel}
            </h2>
            {darfSchreiben ? <Button onClick={() => setDialog({})}>{k.klassen.neu}</Button> : null}
          </div>
          <p className="app-leer-text">{k.klassen.beschreibung}</p>
          {klassen.isPending ? <Skelettzeilen anzahl={2} /> : null}
          {klassen.error ? <FehlerHinweis fehler={klassen.error} /> : null}
          {klassen.data && klassen.data.length === 0 ? <p className="app-leer-text">{k.klassen.keine}</p> : null}
          {klassen.data && klassen.data.length > 0 ? <KlassenTabelle klassen={klassen.data} darfAendern={darfSchreiben} onAendern={(klasse) => setDialog({ klasse })} /> : null}
        </section>
      </SprungAbschnitt>
      <SprungAbschnitt id="mitarbeiter" label={t.mitarbeiter.titel}>
        <MitarbeiterAbschnitt organisationId={organisationId} stichtag={stichtag} darfSchreiben={darfSchreiben} />
      </SprungAbschnitt>
      {dialog ? <KlasseDialog organisationId={organisationId} {...(dialog.klasse ? { klasse: dialog.klasse } : {})} onSchliessen={() => setDialog(null)} /> : null}
    </>
  );
}

/** Schätzungen offener Wandlungen mit ihren Annahmen; was sich nicht schätzen lässt, steht mit Grund und fehlenden Angaben als offen. */
function OffeneWandlungen({ liste, referenzpreis, anteileVor }: { liste: OffeneWandlung[]; referenzpreis: string | null; anteileVor: string }) {
  const t = useT();
  const sprache = useSprache();
  const w = t.kapital.wandlungen;
  const kein = t.gemeinsam.keinWert;
  const preis = (wert: string) => new Intl.NumberFormat(sprache === "de" ? "de-DE" : "en-GB", { maximumFractionDigits: 4 }).format(Number(wert));
  const stand = (x: OffeneWandlung) => {
    const teile: string[] = [];
    if (x.status === "offen") teile.push(w.gruende[x.grund ?? ""] ?? x.grund ?? "");
    if (x.massgeblich) teile.push(w.regel(w.massgeblich[x.massgeblich] ?? x.massgeblich));
    if (x.fehlend.length > 0 && x.grund !== "keine_parameter") teile.push(w.fehlt(x.fehlend.map((f) => (f === "abschlag" ? w.spalten.abschlag : w.spalten.cap)).join(", ")));
    if (x.hinweise.includes("ohne_zinsen")) teile.push(w.ohneZinsen);
    if (!x.zinsenWandeln) teile.push(w.zinsenAusgezahlt);
    return teile.join(" · ");
  };
  const spalten: TabelleSpalte<OffeneWandlung>[] = [
    {
      schluessel: "instrument",
      kopf: w.spalten.instrument,
      zelle: (x) => (
        <span className="app-zusammenhang">
          {x.bezeichnung}
          {x.status === "geschaetzt" ? (
            <Status variante="pruefung" title={w.tooltip}>
              {w.schaetzung}
            </Status>
          ) : (
            <Status variante="fehlt">{w.offen}</Status>
          )}
        </span>
      ),
    },
    { schluessel: "fonds", kopf: w.spalten.fonds, zelle: (x) => x.fonds.name },
    { schluessel: "betrag", kopf: w.spalten.betrag, zahl: true, zelle: (x) => formatBetragCent(x.betrag, sprache) },
    { schluessel: "abschlag", kopf: w.spalten.abschlag, zahl: true, zelle: (x) => (x.abschlag === null ? kein : formatSatz(x.abschlag, sprache)) },
    { schluessel: "cap", kopf: w.spalten.cap, zahl: true, zelle: (x) => (x.bewertungsobergrenze === null ? kein : formatBetrag(x.bewertungsobergrenze, sprache)) },
    { schluessel: "preis", kopf: w.spalten.preis, zahl: true, zelle: (x) => (x.preisJeAnteil === null ? kein : preis(x.preisJeAnteil)) },
    { schluessel: "anteile", kopf: w.spalten.anteile, zahl: true, zelle: (x) => (x.anteile === null ? kein : formatAnzahl(x.anteile, sprache)) },
    { schluessel: "stand", kopf: w.spalten.stand, zelle: (x) => stand(x) || kein },
  ];
  return (
    <>
      <h3 className="cw-t-untertitel">{w.titel}</h3>
      <Hinweis titel={w.annahmenTitel}>{w.annahmen(referenzpreis === null ? kein : preis(referenzpreis), formatAnzahl(anteileVor, sprache))}</Hinweis>
      {liste.every((x) => x.anteile === null) ? <p className="app-leer-text">{w.keineSchaetzung}</p> : null}
      <Tabelle beschriftung={w.tabelle} spalten={spalten} zeilen={liste} zeilenSchluessel={(x) => x.instrumentId} />
    </>
  );
}

function KlassenTabelle({ klassen, darfAendern, onAendern }: { klassen: Anteilsklasse[]; darfAendern: boolean; onAendern: (klasse: Anteilsklasse) => void }) {
  const t = useT();
  const sprache = useSprache();
  const c = t.kapital.klassen;
  const faktor = (wert: string) => c.faktor(new Intl.NumberFormat(sprache === "de" ? "de-DE" : "en-GB", { maximumFractionDigits: 4 }).format(Number(wert)));
  const spalten: TabelleSpalte<Anteilsklasse>[] = [
    { schluessel: "name", kopf: c.spalten.name, zelle: (x) => x.name },
    { schluessel: "rang", kopf: c.spalten.rang, zahl: true, zelle: (x) => x.rang },
    { schluessel: "praeferenz", kopf: c.spalten.praeferenz, zahl: true, zelle: (x) => faktor(x.praeferenzFaktor) },
    { schluessel: "partizipierend", kopf: c.spalten.partizipierend, zelle: (x) => (x.partizipierend ? c.ja : c.nein) },
    { schluessel: "cap", kopf: c.spalten.cap, zahl: true, zelle: (x) => (x.capFaktor ? faktor(x.capFaktor) : t.gemeinsam.keinWert) },
    { schluessel: "verzinsung", kopf: c.spalten.verzinsung, zahl: true, zelle: (x) => (x.kumulierteVerzinsung ? formatSatz(x.kumulierteVerzinsung, sprache) : t.gemeinsam.keinWert) },
    { schluessel: "umwandelbar", kopf: c.spalten.umwandelbar, zelle: (x) => (x.umwandelbar ? c.ja : c.nein) },
    { schluessel: "verwendet", kopf: c.spalten.verwendet, zahl: true, zelle: (x) => x.verwendet },
    ...(darfAendern
      ? [
          {
            schluessel: "aktion",
            kopf: c.spalten.aktion,
            zelle: (x: Anteilsklasse) => (
              <Button variante="sekundaer" aria-label={c.aendernFuer(x.name)} onClick={() => onAendern(x)}>
                {c.aendern}
              </Button>
            ),
          },
        ]
      : []),
  ];
  return <Tabelle beschriftung={c.tabelle} spalten={spalten} zeilen={klassen} zeilenSchluessel={(x) => x.id} />;
}

/** Neue Klasse oder Änderung; der Zinssatz wird in Prozent eingegeben und als Bruch gesendet. */
function KlasseDialog({ organisationId, klasse, onSchliessen }: { organisationId: string; klasse?: Anteilsklasse; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.kapital.klassen.form;
  const anlegen = useAnteilsklasseAnlegen(organisationId);
  const aendern = useAnteilsklasseAendern(organisationId);
  const mutation = klasse ? aendern : anlegen;
  const [partizipierend, setPartizipierend] = useState(klasse?.partizipierend ?? false);
  // Faktoren wie die API: von null an, bis vier Stellen vor und nach dem Komma.
  const faktor = betragRegel({ nachkomma: 4, ganzstellen: 4 });
  const { werte, feld, setWerte, pruefeAlle } = useFormular(
    {
      name: klasse?.name ?? "",
      rang: String(klasse?.rang ?? 1),
      faktor: klasse ? klasse.praeferenzFaktor.replace(/\.?0+$/, "") : "1",
      cap: klasse?.capFaktor ? klasse.capFaktor.replace(/\.?0+$/, "") : "",
      verzinsung: klasse?.kumulierteVerzinsung ? anteilZuProzent(klasse.kumulierteVerzinsung) : "",
    },
    {
      name: pflichtRegel(),
      rang: ganzzahlRegel({ min: 1, max: 20, stellen: 2, pflicht: true }),
      faktor: betragRegel({ nachkomma: 4, ganzstellen: 4, pflicht: true }),
      ...(partizipierend ? { cap: faktor } : {}),
      verzinsung: prozentRegel(),
    },
  );
  const [umwandelbar, setUmwandelbar] = useState(klasse?.umwandelbar ?? true);
  const fehler = (name: string) => feldText(t, mutation.error, name);
  const titel = klasse ? f.titelAendern : f.titelNeu;

  function absenden() {
    const cap = partizipierend ? (betragOderNichts(werte.cap, sprache) ?? null) : null;
    const verzinsung = werte.verzinsung.trim() === "" ? null : prozentZuAnteil(werte.verzinsung);
    const koerper = { name: werte.name.trim(), rang: Number(werte.rang), praeferenzFaktor: betragOderNichts(werte.faktor, sprache) ?? "", partizipierend, capFaktor: cap, kumulierteVerzinsung: verzinsung, umwandelbar };
    if (klasse) aendern.mutate({ klasseId: klasse.id, ...koerper }, { onSuccess: onSchliessen });
    else anlegen.mutate(koerper, { onSuccess: onSchliessen });
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
          if (!pruefeAlle()) return;
          absenden();
        }}
      >
        <FehlerHinweis fehler={mutation.error} bekannt={["name", "rang", "praeferenzFaktor", "capFaktor", "kumulierteVerzinsung"]} />
        <Feld label={f.name} {...feld("name", fehler("name"))} />
        <BetragFeld label={f.rang} inputMode="numeric" hilfe={f.rangHilfe} {...feld("rang", fehler("rang"))} />
        <BetragFeld label={f.faktor} hilfe={f.faktorHilfe} {...feld("faktor", fehler("praeferenzFaktor"))} />
        <label className="app-haken">
          <input
            type="checkbox"
            checked={partizipierend}
            onChange={(e) => {
              setPartizipierend(e.target.checked);
              if (!e.target.checked) setWerte((alt) => ({ ...alt, cap: "" }));
            }}
          />
          <span>{f.partizipierend}</span>
        </label>
        {partizipierend ? <BetragFeld label={f.cap} hilfe={f.capHilfe} {...feld("cap", fehler("capFaktor"))} /> : null}
        <BetragFeld label={f.verzinsung} hilfe={f.verzinsungHilfe} {...feld("verzinsung", fehler("kumulierteVerzinsung"))} />
        <label className="app-haken">
          <input type="checkbox" checked={umwandelbar} onChange={(e) => setUmwandelbar(e.target.checked)} />
          <span>{f.umwandelbar}</span>
        </label>
        <div>
          <Button type="submit" disabled={mutation.isPending}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
