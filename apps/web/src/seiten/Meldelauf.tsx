import { useEffect, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { Button, CheckIcon, Feld, FileTextIcon, FolderOpenIcon, formatDatum, Hinweis, ListMagnifyingGlassIcon, Schrittfolge, Seitenkopf, Status, Tabelle, Tabs, Textbereich, type TabelleSpalte } from "@carraway/ui";
import { useTabs } from "../lib/tabs";
import { fondsListe } from "../api/abfragen";
import { meldeDateiUrl, meldeLauf, useBefundKommentar, useLaufAnlegen, useMeldeEingabe, useMeldeStufe, type MeldeLauf } from "../api/meldewesen";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { MeldeHerkunftDialog } from "../komponenten/MeldeHerkunft";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { formatMeldeWert } from "../lib/meldewerte";
import { useNamen } from "../lib/namen";
import { useRechte } from "../lib/rechte";
import { formatZeitpunkt } from "../lib/zeit";
import { merkeFonds } from "../zustand";
import { LAUF_STATUS, zeitraumText } from "./Meldungen";

const route = getRouteApi("/filings/$id");

type Abschnitt = MeldeLauf["definition"]["abschnitte"][number];
type Feldname = { id: string; bezeichnung: { de: string; en: string }; format: string; einheit?: string | undefined; quelle: { art: string; feld?: string }; hinweis?: { de: string; en: string } | undefined; pflicht?: boolean | undefined; summe?: boolean | undefined };

/** Gültige Freigaben nach Wiedergabe des Protokolls (wie die API): ein `ok` fügt hinzu, ein `zurueck` nimmt die zuletzt erteilte zurück. */
function aktiveStufen(protokoll: MeldeLauf["protokoll"]) {
  const aktiv: MeldeLauf["protokoll"] = [];
  for (const p of protokoll) {
    if (p.ergebnis === "ok") aktiv.push(p);
    else aktiv.pop();
  }
  return aktiv;
}

/** Meldelauf: Stufen, Befunde, Werte mit Herkunft und Eingaben von Hand, Dateien und Protokoll. Die API entscheidet über jede Stufe; die Seite erklärt, was sie ablehnen würde. */
export function MeldelaufSeite() {
  const t = useT();
  const m = t.melde;
  const l = m.lauf;
  const sprache = useSprache();
  const { id } = route.useParams();
  const { data: lauf } = useSuspenseQuery(meldeLauf(id));
  const { data: fonds } = useSuspenseQuery(fondsListe());
  const fondsName = fonds.find((f) => f.id === lauf.fondsId)?.name ?? "";
  const waehrung = fonds.find((f) => f.id === lauf.fondsId)?.waehrung ?? "EUR";
  const person = useNamen([lauf.erstelltVon, ...lauf.protokoll.map((p) => p.akteur), ...lauf.werte.map((w) => w.geaendertVon), ...lauf.befunde.map((b) => b.kommentar?.von)]);
  const { tab, setzeTab } = useTabs(route.useSearch(), route.useNavigate(), ["freigabe", "inhalt", "datei", "protokoll"] as const);
  const neueFassung = useLaufAnlegen();
  const navigate = useNavigate();
  const { darf } = useRechte();
  const [herkunft, setHerkunft] = useState<{ schluessel: string; titel: string } | null>(null);
  useEffect(() => merkeFonds(lauf.fondsId), [lauf.fondsId]);
  const name = sprache === "de" ? lauf.meta.bezeichnungDe : lauf.meta.bezeichnungEn;
  const hinweis = lauf.definition.hinweis ? lauf.definition.hinweis[sprache] : null;
  const zeitraum = zeitraumText(lauf.periodeKennung, sprache);

  return (
    <div className="app-seite">
      <Seitenkopf
        meta={
          <>
            <Link to="/funds/$fundId/filings" params={{ fundId: lauf.fondsId }}>
              {l.zurListe}
            </Link>
            {fondsName ? ` · ${fondsName}` : ""}
            <Status variante={LAUF_STATUS[lauf.status] ?? "entwurf"}>{aufzaehlung(m.status, lauf.status)}</Status>
          </>
        }
        titel={`${name} ${zeitraum} · ${l.fassung(lauf.fassung)}`}
      />
      {hinweis ? <Hinweis>{hinweis}</Hinweis> : null}

      <section className="app-karte" aria-label={l.etikett}>
        <dl className="app-fakten">
          <div>
            <dt>{l.zeitraum}</dt>
            <dd className="app-zahl">{lauf.periodeBeginn === lauf.periodeEnde ? formatDatum(lauf.periodeEnde, sprache) : `${formatDatum(lauf.periodeBeginn, sprache)} – ${formatDatum(lauf.periodeEnde, sprache)}`}</dd>
          </div>
          <div>
            <dt>{l.definition}</dt>
            <dd>{`${lauf.meta.schluessel} (${lauf.definitionVersion})`}</dd>
          </div>
          <div>
            <dt>{l.sprache}</dt>
            <dd>{aufzaehlung(m.sprachen, lauf.sprache)}</dd>
          </div>
          {lauf.foerderprogramm ? (
            <div>
              <dt>{l.programm}</dt>
              <dd>{lauf.foerderprogramm.bezeichnung}</dd>
            </div>
          ) : null}
        </dl>
        <p className="app-leer-text">{l.angelegt(person(lauf.erstelltVon) ?? "", formatZeitpunkt(lauf.erstelltAm, sprache))}</p>
        <p className="app-leer-text">{l.standText(formatZeitpunkt(lauf.stand, sprache))}</p>
        {darf("bearbeiter", lauf.fondsId, "meldewesen") ? (
          <p>
            <Button
              variante="sekundaer"
              disabled={neueFassung.isPending}
              onClick={() =>
                neueFassung.mutate(
                  {
                    fondsId: lauf.fondsId,
                    definition: lauf.meta.schluessel,
                    sprache: lauf.sprache as "de" | "en",
                    ...(lauf.periodeArt === "stichtag" ? { stichtag: lauf.periodeEnde } : { jahr: Number(lauf.periodeKennung.slice(0, 4)), ...(lauf.periodeArt === "jahr" ? {} : { nummer: Number(lauf.periodeKennung.slice(-1)) }) }),
                  },
                  { onSuccess: (neu) => void navigate({ to: "/filings/$id", params: { id: neu.id } }) },
                )
              }
            >
              {l.neueFassung}
            </Button>{" "}
            <span className="app-leer-text">{l.neueFassungHinweis}</span>
          </p>
        ) : null}
        {neueFassung.error ? <FehlerHinweis fehler={neueFassung.error} /> : null}
      </section>

      <Tabs
        aria-label={t.tabs.bereiche}
        aktiv={tab}
        onWechsel={setzeTab}
        tabs={[
          {
            id: "freigabe",
            icon: CheckIcon,
            label: t.tabs.freigabe,
            inhalt: () => (
              <>
                <Stufen lauf={lauf} person={person} />
                <Befunde lauf={lauf} person={person} />
              </>
            ),
          },
          {
            id: "inhalt",
            icon: FileTextIcon,
            label: t.tabs.inhalt,
            zaehler: lauf.definition.abschnitte.length,
            inhalt: () => (
              <>
                {lauf.definition.abschnitte.map((a) => (
                  <AbschnittKachel key={a.id} lauf={lauf} abschnitt={a} waehrung={waehrung} onHerkunft={(schluessel, titel) => setHerkunft({ schluessel, titel })} />
                ))}
              </>
            ),
          },
          { id: "datei", icon: FolderOpenIcon, label: t.tabs.datei, inhalt: () => <Dateien lauf={lauf} /> },
          { id: "protokoll", icon: ListMagnifyingGlassIcon, label: t.tabs.protokoll, zaehler: lauf.protokoll.length, inhalt: () => <Protokoll lauf={lauf} person={person} /> },
        ]}
      />
      {herkunft ? <MeldeHerkunftDialog laufId={lauf.id} schluessel={herkunft.schluessel} titel={herkunft.titel} onSchliessen={() => setHerkunft(null)} /> : null}
    </div>
  );
}

type Namen = (id: string | null | undefined) => string | null;

function Stufen({ lauf, person }: { lauf: MeldeLauf; person: Namen }) {
  const t = useT();
  const sprache = useSprache();
  const s = t.melde.lauf.stufen;
  const { ich, darf } = useRechte();
  const aktion = useMeldeStufe(lauf.id);
  const [kommentar, setKommentar] = useState("");
  const [lokal, setLokal] = useState<string | null>(null);
  const stufen = lauf.freigabestufen as string[];
  const aktiv = aktiveStufen(lauf.protokoll);
  const freigegeben = lauf.status === "freigegeben";
  const name = lauf.naechsteStufeName ?? stufen[lauf.naechsteStufe] ?? "";
  const letzte = lauf.naechsteStufe === stufen.length - 1;
  const fehler = lauf.befunde.filter((b) => b.schwere === "fehler");
  const ohneKommentar = lauf.befunde.filter((b) => b.schwere === "warnung" && !b.kommentar);
  const bearbeiter = [...new Set([...lauf.werte.filter((w) => w.manuell && w.geaendertVon).map((w) => w.geaendertVon as string), ...lauf.befunde.flatMap((b) => (b.kommentar ? [b.kommentar.von] : []))])];
  const selbst = ich?.id;
  const sperrgrund = !darf("freigeber", lauf.fondsId, "meldewesen")
    ? s.rolle(aufzaehlung(t.rolle, "freigeber"))
    : selbst && selbst === lauf.erstelltVon
      ? s.selbstErsteller
      : selbst && bearbeiter.includes(selbst)
        ? s.selbstBearbeiter
        : selbst && aktiv.some((p) => p.akteur === selbst)
          ? s.selbstFreigeber
          : letzte && fehler.length > 0
            ? s.fehlerOffen
            : letzte && ohneKommentar.length > 0
              ? s.warnungenOffen
              : null;
  const ausgeschlossen = [...new Set([lauf.erstelltVon, ...bearbeiter, ...aktiv.map((p) => p.akteur)])].map((x) => person(x) ?? "").filter(Boolean);

  const schritte = [
    ...stufen.map((stufe, i) => ({
      id: `s${i}`,
      label: (
        <span className="app-stufe">
          <span>{stufe}</span>
          <span className="app-stufe__zeit">{aktiv[i] ? s.erteilt(person(aktiv[i]!.akteur) ?? "", formatZeitpunkt(aktiv[i]!.am, sprache)) : s.ausstehend}</span>
        </span>
      ),
    })),
    { id: "fertig", label: <span className="app-stufe">{s.freigegebenLabel}</span> },
  ];

  function ausfuehren(ergebnis: "ok" | "zurueck") {
    setLokal(null);
    if (ergebnis === "zurueck" && kommentar.trim() === "") {
      setLokal(t.feldfehler.comment_required ?? t.feldfehler.unbekannt);
      return;
    }
    aktion.mutate({ stufe: name, ergebnis, ...(kommentar.trim() ? { kommentar: kommentar.trim() } : {}) }, { onSuccess: () => setKommentar("") });
  }

  return (
    <section className="app-karte" aria-label={s.titel}>
      <h2 className="cw-t-untertitel app-karte__titel">{s.titel}</h2>
      <Schrittfolge aria-label={s.titel} aktuell={freigegeben ? "fertig" : `s${lauf.naechsteStufe}`} schritte={schritte} />
      {freigegeben ? (
        <Hinweis>{s.fertig}</Hinweis>
      ) : (
        <div className="app-formular">
          {sperrgrund ? <Hinweis>{sperrgrund}</Hinweis> : null}
          {ausgeschlossen.length > 0 ? <p className="app-leer-text">{s.ausgeschlossen(ausgeschlossen.join(", "))}</p> : null}
          <Textbereich label={s.kommentar} value={kommentar} onChange={(e) => setKommentar(e.target.value)} fehler={lokal ?? undefined} rows={2} />
          {aktion.error ? <FehlerHinweis fehler={aktion.error} /> : null}
          <div className="app-knoepfe">
            <Button disabled={aktion.isPending || sperrgrund !== null} onClick={() => ausfuehren("ok")}>
              {s.erteilen(name)}
            </Button>
            {lauf.naechsteStufe > 0 ? (
              <Button variante="sekundaer" disabled={aktion.isPending} onClick={() => ausfuehren("zurueck")}>
                {s.zurueckgeben(name)}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

function befundText(t: ReturnType<typeof useT>, b: MeldeLauf["befunde"][number]): string {
  const c = t.melde.lauf.befunde.codes[b.code];
  const p = b.params as Record<string, string>;
  if (typeof c === "string") return c;
  if (!c) return b.code;
  switch (b.code) {
    case "WERT_UNTER_MINIMUM": return c(p.wert ?? "", p.minimum ?? "", "");
    case "WERT_UEBER_MAXIMUM": return c(p.wert ?? "", p.maximum ?? "", "");
    case "VERGLEICH_VERLETZT": return c(p.links ?? "", p.operator ?? "", p.rechts ?? "");
    case "SUMME_ABWEICHUNG": return c(p.summe ?? "", p.erwartet ?? "", "");
    default: return b.code;
  }
}

function Befunde({ lauf, person }: { lauf: MeldeLauf; person: Namen }) {
  const t = useT();
  const sprache = useSprache();
  const b = t.melde.lauf.befunde;
  const { darf } = useRechte();
  const kommentieren = useBefundKommentar(lauf.id);
  const [texte, setTexte] = useState<Record<string, string>>({});
  const darfSchreiben = darf("bearbeiter", lauf.fondsId, "meldewesen") && lauf.status !== "freigegeben";
  return (
    <section className="app-karte" aria-label={b.titel}>
      <h2 className="cw-t-untertitel app-karte__titel">{b.titel}</h2>
      <p className="app-leer-text">{b.einleitung}</p>
      {lauf.befunde.length === 0 ? <p className="app-leer-text">{b.keine}</p> : null}
      {kommentieren.error ? <FehlerHinweis fehler={kommentieren.error} /> : null}
      <ul className="app-liste">
        {lauf.befunde.map((x) => (
          <li key={x.regelId}>
            <Status variante={x.schwere === "fehler" ? "fehlt" : "pruefung"}>{x.schwere === "fehler" ? b.fehler : b.warnung}</Status> <strong>{x.meldung[sprache]}</strong> <span className="app-leer-text">{befundText(t, x)}</span>
            {x.kommentar ? (
              <p className="app-leer-text">
                {x.kommentar.text} · {b.kommentarVon(person(x.kommentar.von) ?? "")}
              </p>
            ) : null}
            {x.schwere === "warnung" && darfSchreiben ? (
              <form
                className="app-zusammenhang"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = (texte[x.regelId] ?? "").trim();
                  if (text) kommentieren.mutate({ regelId: x.regelId, text });
                }}
              >
                <Feld label={b.kommentarFuer(x.meldung[sprache])} value={texte[x.regelId] ?? ""} onChange={(e) => setTexte((alt) => ({ ...alt, [x.regelId]: e.target.value }))} />
                <Button type="submit" variante="sekundaer" disabled={kommentieren.isPending}>
                  {b.kommentieren}
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AbschnittKachel({ lauf, abschnitt, waehrung, onHerkunft }: { lauf: MeldeLauf; abschnitt: Abschnitt; waehrung: string; onHerkunft: (schluessel: string, titel: string) => void }) {
  const t = useT();
  const sprache = useSprache();
  const w = t.melde.lauf.werte;
  const anzeige = lauf.anzeige.find((a) => a.id === abschnitt.id);
  const wert = (schluessel: string) => lauf.werte.find((x) => x.schluessel === schluessel);
  const titel = abschnitt.titel[sprache];
  if (!anzeige) return null;

  const zelle = (feld: Feldname, schluessel: string, wertText: string | null, ctx: { je: string | null; ohne: boolean }, anzeigeName: string) => {
    const text = formatMeldeWert(wertText, feld, sprache, waehrung, ctx);
    return (
      <button type="button" className="cw-link-knopf" aria-label={w.herkunftFuer(anzeigeName, text)} onClick={() => onHerkunft(schluessel, anzeigeName)}>
        {text}
      </button>
    );
  };

  if (abschnitt.typ === "felder" && anzeige.typ === "felder") {
    return (
      <section className="app-karte">
        <h2 className="cw-t-untertitel app-karte__titel">{titel}</h2>
        <div className="cw-tabelle-huelle" role="region" aria-label={`${titel} · ${w.wert}`} tabIndex={0}>
        <table className="cw-tabelle">
          <thead>
            <tr>
              <th scope="col" className="cw-fest cw-fest--kante">{titel}</th>
              <th scope="col" className="cw-zahl">
                {w.wert}
              </th>
            </tr>
          </thead>
          <tbody>
            {abschnitt.felder.map((f) => {
              const a = anzeige.felder.find((x) => x.id === f.id)!;
              const manuell = f.quelle.art === "manuell";
              return (
                <tr key={f.id}>
                  <th scope="row" className="cw-fest cw-fest--kante">
                    {f.bezeichnung[sprache]}
                    {manuell ? <span className="app-leer-text"> ({w.manuell})</span> : null}
                    {f.hinweis ? <span className="app-leer-text"> {f.hinweis[sprache]}</span> : null}
                  </th>
                  <td className="cw-zahl">
                    {manuell && lauf.status === "entwurf" ? (
                      <Eingabe lauf={lauf} feld={f} schluessel={a.schluessel} wert={wert(a.schluessel)?.wert ?? null} />
                    ) : (
                      zelle(f, a.schluessel, a.wert, { je: null, ohne: false }, f.bezeichnung[sprache])
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {abschnitt.felder.some((f) => f.quelle.art === "manuell") && lauf.status !== "entwurf" ? <p className="app-leer-text">{w.nurEntwurf}</p> : null}
      </section>
    );
  }
  if (abschnitt.typ === "tabelle" && anzeige.typ === "tabelle") {
    type Zeile = (typeof anzeige.zeilen)[number] | { summe: true };
    const zeilen: Zeile[] = [...anzeige.zeilen, ...(anzeige.summen ? [{ summe: true as const }] : [])];
    const spalten: TabelleSpalte<Zeile>[] = abschnitt.spalten.map((s, i) => ({
      schluessel: s.id,
      kopf: s.bezeichnung[sprache],
      zahl: ["betrag", "zahl", "ganzzahl", "prozent"].includes(s.format),
      zelle: (z) => {
        if ("summe" in z) {
          const sum = anzeige.summen?.[s.id];
          if (!s.summe || !sum) return i === 0 ? w.summe : "";
          return zelle(s, sum.schluessel, sum.wert, { je: null, ohne: false }, `${w.summe}: ${s.bezeichnung[sprache]}`);
        }
        const c = z.zellen[s.id]!;
        return zelle(s, c.schluessel, c.wert, { je: abschnitt.je, ohne: z.gruppeOhne }, `${s.bezeichnung[sprache]}${z.bezeichnung ? ` (${z.bezeichnung})` : ""}`);
      },
    }));
    return (
      <section className="app-karte">
        <h2 className="cw-t-untertitel app-karte__titel">{titel}</h2>
        <Tabelle beschriftung={titel} spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => ("summe" in z ? "_summe" : z.schluessel)} />
      </section>
    );
  }
  return null;
}

/** Eingabe von Hand für ein Feld mit Quelle `manuell`; die API prüft das Format (Zahlen nur als Dezimalzahl, Ja/Nein nur `ja` oder `nein`). */
function Eingabe({ lauf, feld, schluessel, wert }: { lauf: MeldeLauf; feld: Feldname; schluessel: string; wert: string | null }) {
  const t = useT();
  const sprache = useSprache();
  const w = t.melde.lauf.werte;
  const { darf } = useRechte();
  const speichern = useMeldeEingabe(lauf.id);
  const [text, setText] = useState(wert ?? "");
  if (!darf("bearbeiter", lauf.fondsId, "meldewesen")) return <>{formatMeldeWert(wert, feld, sprache, "EUR")}</>;
  const name = feld.bezeichnung[sprache];
  return (
    <form
      className="app-zusammenhang"
      onSubmit={(e) => {
        e.preventDefault();
        speichern.mutate({ schluessel, wert: text.trim() === "" ? null : text.trim() });
      }}
    >
      <Feld label={w.eingabeFuer(name)} labelVersteckt kompakt title={aufzaehlung(w.hilfe, feld.format)} value={text} onChange={(e) => setText(e.target.value)} fehler={speichern.error ? <FehlerHinweis fehler={speichern.error} /> : undefined} />
      <Button type="submit" variante="sekundaer" disabled={speichern.isPending}>
        {w.speichern}
      </Button>
      {wert !== null ? (
        <Button type="button" variante="ruhig" disabled={speichern.isPending} onClick={() => (setText(""), speichern.mutate({ schluessel, wert: null }))}>
          {w.leeren}
        </Button>
      ) : null}
    </form>
  );
}

function Dateien({ lauf }: { lauf: MeldeLauf }) {
  const t = useT();
  const d = t.melde.lauf.dateien;
  const arten = lauf.status === "freigegeben" ? lauf.dateien.map((x) => x.art) : lauf.format === "pdf" ? (["meldung"] as const) : (["meldung", "pruefansicht"] as const);
  return (
    <section className="app-karte" aria-label={d.titel}>
      <h2 className="cw-t-untertitel app-karte__titel">{d.titel}</h2>
      {lauf.status !== "freigegeben" ? <p className="app-leer-text">{d.entwurf}</p> : null}
      <ul className="app-liste">
        {arten.map((art) => {
          const datei = lauf.dateien.find((x) => x.art === art);
          const label = art === "meldung" ? `${d.meldung} (${aufzaehlung(t.melde.format, lauf.format)})` : d.pruefansicht;
          return (
            <li key={art}>
              <a href={meldeDateiUrl(lauf.id, art)} download aria-label={d.herunterladen(label)}>
                {label}
              </a>
              {datei ? (
                <span className="app-leer-text">
                  {" "}
                  · {datei.name} · {d.groesse((datei.groesse / 1024).toFixed(1))} · {d.sha} <code className="app-hash">{datei.sha256}</code>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Protokoll({ lauf, person }: { lauf: MeldeLauf; person: Namen }) {
  const t = useT();
  const sprache = useSprache();
  const p = t.melde.lauf.protokoll;
  const spalten: TabelleSpalte<MeldeLauf["protokoll"][number]>[] = [
    { schluessel: "stufe", kopf: p.spalten.stufe, zelle: (x) => x.stufe },
    { schluessel: "ergebnis", kopf: p.spalten.ergebnis, zelle: (x) => (x.ergebnis === "ok" ? p.ok : p.zurueck) },
    { schluessel: "person", kopf: p.spalten.person, zelle: (x) => person(x.akteur) ?? "" },
    { schluessel: "wann", kopf: p.spalten.wann, zelle: (x) => formatZeitpunkt(x.am, sprache) },
    { schluessel: "kommentar", kopf: p.spalten.kommentar, umbruch: true, zelle: (x) => x.kommentar ?? "" },
  ];
  return (
    <section className="app-karte" aria-label={p.titel}>
      <h2 className="cw-t-untertitel app-karte__titel">{p.titel}</h2>
      {lauf.protokoll.length === 0 ? <p className="app-leer-text">{p.keine}</p> : <Tabelle beschriftung={p.titel} spalten={spalten} zeilen={lauf.protokoll} zeilenSchluessel={(x) => x.id} />}
    </section>
  );
}
