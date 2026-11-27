import { useEffect, useState } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Button, Fakten, formatDatum, Hinweis, ListChecksIcon, ListIcon, Schrittfolge, Seitenkopf, Status, Tabelle, Tabs, type HerkunftProps, type TabelleSpalte } from "@carraway/ui";
import { fondsListe, zinslaufDetail, zinslaufKontrolle, type Kontrollbericht, type Zinslauf } from "../api/abfragen";
import { useZinslaufAktion, type ZinslaufAktion } from "../api/mutationen";
import { BelegKnopf } from "../komponenten/BelegKnopf";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { HerkunftDialog } from "../komponenten/HerkunftDialog";
import { Skelettzeilen } from "../komponenten/Skelett";
import { NurLesen } from "../komponenten/NurLesen";
import { aufzaehlung, useSprache, useT, type Texte } from "../i18n";
import { useNamen } from "../lib/namen";
import { useRechte } from "../lib/rechte";
import { formatBetragCent } from "../lib/zahl";
import { formatZeitpunkt } from "../lib/zeit";
import { merkeFonds } from "../zustand";
import { LAUF_STATUS } from "./Zinslaeufe";
import type { Sprache } from "@carraway/ui";

const route = getRouteApi("/interest-runs/$id");

type Position = Zinslauf["positionen"][number];
const REIHENFOLGE = ["berechnet", "geprueft", "freigegeben", "gebucht"] as const;
/** Aktionen je Status; Verwerfen ist bis zur Buchung möglich. */
const AKTIONEN: Record<string, { weiter?: ZinslaufAktion; verwerfen: boolean }> = {
  berechnet: { weiter: "pruefen", verwerfen: true },
  geprueft: { weiter: "freigeben", verwerfen: true },
  freigegeben: { weiter: "buchen", verwerfen: true },
  gebucht: { verwerfen: false },
  verworfen: { verwerfen: false },
};

export function ZinslaufSeite() {
  const t = useT();
  const sprache = useSprache();
  const z = t.zinslauf;
  const { id } = route.useParams();
  const { data: lauf } = useSuspenseQuery(zinslaufDetail(id));
  const { data: fonds } = useSuspenseQuery(fondsListe());
  const aktion = useZinslaufAktion(id);
  const { ich, darf } = useRechte();
  const person = useNamen([lauf.berechnetVon, lauf.geprueftVon, lauf.freigegebenVon, lauf.gebuchtVon, lauf.verworfenVon]);
  const [herkunft, setHerkunft] = useState<Position | null>(null);
  const [tab, setTab] = useState("positionen");
  // Abweichungen stehen als Zähler am Reiter, damit sie nicht hinter dem Reiter verschwinden (dieselbe Abfrage wie im Reiter).
  const kontrolle = useQuery(zinslaufKontrolle(id));
  const abweichungen = (kontrolle.data?.pruefungen as { status: string }[] | undefined)?.filter((p) => p.status !== "ok").length ?? 0;
  const fondsName = fonds.find((f) => f.id === lauf.fondsId)?.name ?? "";
  useEffect(() => merkeFonds(lauf.fondsId), [lauf.fondsId]);
  const moeglich = AKTIONEN[lauf.status] ?? { verwerfen: false };
  // Prüfen, Freigeben, Verwerfen und Buchen verlangen die Rolle Freigeber am Fonds; die Freigabe zusätzlich eine andere Person als die Prüfung (Vier-Augen).
  const darfFreigeben = darf("freigeber", lauf.fondsId, "finanzen");
  const selbstGeprueft = moeglich.weiter === "freigeben" && ich !== undefined && lauf.geprueftVon === ich.id;
  const sperrgrund = !darfFreigeben ? t.rechte.braucht(aufzaehlung(t.rolle, "freigeber")) : selbstGeprueft ? t.rechte.vierAugenFreigabe : null;
  const verworfen = lauf.status === "verworfen";

  const akteure: [string, string | null, string | null][] = [
    ["berechnet", lauf.berechnetVon, lauf.berechnetAm],
    ["geprueft", lauf.geprueftVon, lauf.geprueftAm],
    ["freigegeben", lauf.freigegebenVon, lauf.freigegebenAm],
    ["gebucht", lauf.gebuchtVon, lauf.gebuchtAm],
    ["verworfen", lauf.verworfenVon, lauf.verworfenAm],
  ];

  const spalten: TabelleSpalte<Position>[] = [
    {
      schluessel: "darlehen",
      kopf: z.spalten.darlehen,
      zelle: (p) => (
        <Link to="/investments/$id" params={{ id: p.beteiligungId }} search={{}}>
          {p.organisation.name}
        </Link>
      ),
    },
    { schluessel: "periode", kopf: z.spalten.periode, zelle: (p) => z.periode(formatDatum(p.von, sprache), formatDatum(p.bis, sprache)) },
    {
      schluessel: "kapital",
      kopf: z.spalten.kapital,
      zahl: true,
      zelle: (p) => (
        <ul className="app-kapital-liste">
          {(p.kapitalien as { von: string; bis: string; kapital: string }[]).map((a) => (
            <li key={`${a.von}-${a.bis}`}>{z.kapitalSegment(formatDatum(a.von, sprache), formatDatum(a.bis, sprache), formatBetragCent(a.kapital, sprache))}</li>
          ))}
        </ul>
      ),
    },
    { schluessel: "fix", kopf: z.spalten.fix, zahl: true, zelle: (p) => formatBetragCent(p.betragFix, sprache) },
    { schluessel: "gewinn", kopf: z.spalten.gewinn, zahl: true, zelle: (p) => formatBetragCent(p.betragGewinn, sprache) },
    {
      schluessel: "gebucht",
      kopf: z.spalten.gebucht,
      zahl: true,
      zelle: (p) => (
        <span className="app-zusammenhang">
          {formatBetragCent(p.betragGebucht, sprache)}
          {p.kapitalisiert ? <Status>{z.kapitalisiert}</Status> : null}
          {p.gestundet ? <Status variante="pruefung">{z.gestundet}</Status> : null}
        </span>
      ),
    },
    {
      schluessel: "herkunft",
      kopf: z.spalten.herkunft,
      zelle: (p) => (
        <Button variante="ruhig" aria-label={z.herkunft(p.organisation.name)} onClick={() => setHerkunft(p)}>
          {z.herkunftKnopf}
        </Button>
      ),
    },
  ];

  return (
    <div className="app-seite">
      <Seitenkopf
        meta={
          <>
            <Link to="/interest-runs" search={{ fondsId: lauf.fondsId }}>
              {z.zurListe}
            </Link>
            {" · "}
            {fondsName}
            <Status variante={LAUF_STATUS[lauf.status] ?? "entwurf"}>{verworfen ? z.akteure.verworfen : aufzaehlung(z.schritte, lauf.status)}</Status>
          </>
        }
        titel={`${z.stichtag} ${formatDatum(lauf.stichtag, sprache)}`}
      />

      <section className="app-karte" aria-label={z.status}>
        <Schrittfolge aria-label={z.status} aktuell={verworfen ? null : lauf.status} schritte={REIHENFOLGE.map((s) => ({ id: s, label: z.schritte[s] }))} />
        {verworfen ? <Hinweis>{z.verworfen}</Hinweis> : null}
        {lauf.status === "gebucht" ? <Hinweis>{z.gebuchtHinweis}</Hinweis> : null}
        {!verworfen ? <BelegKnopf art="zinsbuchung" bezugArt="zinslauf" bezugId={lauf.id} fondsId={lauf.fondsId} /> : null}
        <Fakten
          darstellung="reihe"
          eintraege={akteure.filter(([, wer]) => wer).map(([name, wer, wann]) => ({ id: name, label: aufzaehlung(z.akteure, name), wert: z.von(person(wer) ?? "", wann ? formatZeitpunkt(wann, sprache) : "") }))}
        />
        <NurLesen fondsId={lauf.fondsId} mindest="freigeber" bereich="finanzen" />
        <FehlerHinweis fehler={aktion.error} />
        {moeglich.weiter || moeglich.verwerfen ? (
          <div className="app-aktionen__knoepfe">
            {moeglich.weiter ? (
              <Button disabled={aktion.isPending || sperrgrund !== null} aria-describedby={sperrgrund ? "zinslauf-sperrgrund" : undefined} onClick={() => aktion.mutate(moeglich.weiter!)}>
                {z.aktionen[moeglich.weiter]}
              </Button>
            ) : null}
            {moeglich.verwerfen ? (
              <Button variante="gefahr" disabled={aktion.isPending || !darfFreigeben} aria-describedby={sperrgrund ? "zinslauf-sperrgrund" : undefined} onClick={() => aktion.mutate("verwerfen")}>
                {z.aktionen.verwerfen}
              </Button>
            ) : null}
          </div>
        ) : null}
        {sperrgrund ? (
          <p id="zinslauf-sperrgrund" className="app-leer-text">
            {sperrgrund}
          </p>
        ) : null}
        {AKTIONEN[lauf.status]?.weiter ? <p className="app-leer-text">{z.aktionHinweis[lauf.status as keyof typeof z.aktionHinweis]}</p> : null}
      </section>

      <Tabs
        aria-label={t.tabs.bereiche}
        aktiv={tab}
        onWechsel={setTab}
        tabs={[
          {
            id: "positionen",
            icon: ListIcon,
            label: z.positionen,
            zaehler: lauf.positionen.length,
            inhalt: () => (
              <section className="app-karte" aria-label={z.positionen}>
                {lauf.positionen.length === 0 ? (
                  <p className="app-leer-text">{z.keinePositionen}</p>
                ) : (
                  <>
                    <p className="app-leer-text">{z.summe(lauf.summe.anzahl, formatBetragCent(lauf.summe.gebucht, sprache))}</p>
                    <Tabelle dicht beschriftung={z.tabelle} spalten={spalten} zeilen={lauf.positionen} zeilenSchluessel={(p) => p.id} />
                  </>
                )}
              </section>
            ),
          },
          { id: "kontrolle", icon: ListChecksIcon, label: z.kontrolle.titel, ...(abweichungen > 0 ? { zaehler: abweichungen } : {}), inhalt: () => <Kontrollbericht id={id} /> },
        ]}
      />

      {herkunft ? (
        <HerkunftDialog titel={z.herkunft(herkunft.organisation.name)} stichtag={herkunft.bis} schritte={herkunft.schritte as unknown as HerkunftProps["schritte"]} onSchliessen={() => setHerkunft(null)} />
      ) : null}
    </div>
  );
}

const SUMMEN = new Set(["summePositionen", "summeBuchungen"]);
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

/** Ein betroffener Datensatz einer Prüfung als Satz aus bekannten Feldern; Unbekanntes bleibt als Text. */
function detailText(t: Texte, sprache: Sprache, detail: unknown): string {
  if (typeof detail !== "object" || detail === null) return String(detail);
  return Object.entries(detail as Record<string, unknown>)
    .filter(([name]) => name !== "beteiligungId" || !("organisation" in (detail as object)))
    .map(([name, wert]) => {
      const text = typeof wert === "string" && DATUM.test(wert) ? formatDatum(wert, sprache) : typeof wert === "string" && SUMMEN.has(name) ? formatBetragCent(wert, sprache) : Array.isArray(wert) ? String(wert.length) : String(wert);
      return `${aufzaehlung(t.zinslauf.kontrolle.detailFelder, name)}: ${text}`;
    })
    .join(", ");
}

type Pruefung = Kontrollbericht["pruefungen"][number] & { code?: string; params?: Record<string, unknown>; hinweisCode?: string; hinweisParams?: Record<string, unknown> };

/** Titel der Prüfung aus Code und Parametern; ohne bekannten Code (ältere Stände) gilt die Übersetzung nach `schluessel`, zuletzt die Bezeichnung der API. */
function pruefungTitel(t: Texte, p: Pruefung): string {
  const k = t.zinslauf.kontrolle;
  const eintrag = p.code && Object.hasOwn(k.codes, p.code) ? k.codes[p.code] : undefined;
  if (eintrag) return p.status === "ok" ? eintrag.ok : eintrag.abweichung(Number(p.params?.anzahl ?? 0));
  const alt = aufzaehlung(k.pruefungen, p.schluessel);
  return alt === p.schluessel ? p.bezeichnung : alt;
}

/** Hinweis zur Prüfung aus `hinweisCode` und `hinweisParams`; der deutsche Freitext der API gilt nur, wenn es keinen Code gibt. */
function hinweisText(t: Texte, sprache: Sprache, p: Pruefung, laufStatus: string): string | null {
  const k = t.zinslauf.kontrolle;
  const hinweis = p.hinweisCode && Object.hasOwn(k.hinweise, p.hinweisCode) ? k.hinweise[p.hinweisCode] : undefined;
  if (hinweis) {
    const status = String(p.hinweisParams?.status ?? laufStatus);
    const summe = typeof p.hinweisParams?.summePositionen === "string" ? formatBetragCent(p.hinweisParams.summePositionen, sprache) : "";
    return hinweis(aufzaehlung(t.zinslauf.schritte, status), summe);
  }
  if (p.schluessel === "summe_positionen_gleich_buchungen" && laufStatus !== "gebucht") return k.noch;
  return p.hinweis && !(p.schluessel in k.pruefungen) ? p.hinweis : null;
}

/** Kontrollbericht des Laufs: je Prüfung der Status, Abweichungen mit den betroffenen Darlehen. Übersetzt wird nach `code` und `params`. */
function Kontrollbericht({ id }: { id: string }) {
  const t = useT();
  const sprache = useSprache();
  const k = t.zinslauf.kontrolle;
  const { data, error, isPending } = useQuery(zinslaufKontrolle(id));
  const bericht: Kontrollbericht | undefined = data;
  return (
    <section className="app-karte" aria-label={k.titel}>
      {isPending ? <Skelettzeilen anzahl={3} /> : null}
      {error ? <FehlerHinweis fehler={error} /> : null}
      {bericht ? (
        <>
          <Hinweis>{bericht.gesamt === "ok" ? k.gesamtOk : k.gesamtAbweichung}</Hinweis>
          <ul className="app-kontrollen" aria-label={k.titel}>
            {(bericht.pruefungen as Pruefung[]).map((p) => (
              <li key={p.schluessel} className="app-kontrolle">
                <div className="app-kontrolle__kopf">
                  <Status variante={p.status === "ok" ? "freigegeben" : "fehlt"}>{p.status === "ok" ? k.ok : k.abweichung}</Status>
                  <strong>{pruefungTitel(t, p)}</strong>
                </div>
                {hinweisText(t, sprache, p, bericht.status) ? <span className="app-leer-text">{hinweisText(t, sprache, p, bericht.status)}</span> : null}
                {Array.isArray(p.details) && p.details.length > 0 ? (
                  <ul className="app-liste-klein" aria-label={k.details}>
                    {(p.details as unknown[]).map((d, i) => (
                      <li key={i}>{detailText(t, sprache, d)}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
