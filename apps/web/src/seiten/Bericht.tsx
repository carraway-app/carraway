import { useEffect, useState } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Button, ButtonLink, CheckIcon, FileTextIcon, FolderOpenIcon, formatDatum, Hinweis, ListChecksIcon, ListMagnifyingGlassIcon, Markdown, Schrittfolge, Seitenkopf, Status, Tabelle, Tabs, Textbereich, type Sprache, type TabelleSpalte } from "@carraway/ui";
import { berichtDetail, berichtKontrolle, fondsListe, type BerichtDetail, type BerichtKontrolle } from "../api/abfragen";
import { useAbschnittSetzen, useBerichtigungAnlegen, useBerichtStufe } from "../api/mutationen";
import { BERICHT_STATUS } from "../komponenten/BerichteListe";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { Skelettzeilen } from "../komponenten/Skelett";
import { feldCodeText, feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT, type Texte } from "../i18n";
import { aktiveStufen, ausgeschlosseneStufen, FREITEXTE, stufenNamen, vorlagenAbschnitte } from "../lib/berichte";
import { berichtDateiUrl } from "../lib/berichteUrl";
import { useTabs } from "../lib/tabs";
import { useNamen } from "../lib/namen";
import { useRechte } from "../lib/rechte";
import { formatBetragCent } from "../lib/zahl";
import { formatZeitpunkt } from "../lib/zeit";
import { merkeFonds } from "../zustand";
import { alle } from "../erweiterung";

const route = getRouteApi("/reports/$id");

type Protokoll = BerichtDetail["protokoll"][number];
type Abschnitt = BerichtDetail["abschnitte"][number];
type Pruefung = BerichtKontrolle["pruefungen"][number];

/** Bericht mit Freigabe: Stufen, Kontrollbericht, Freitexte, Datei und Protokoll. Die API entscheidet über jede Stufe; die Seite erklärt nur, was sie ablehnen würde. */
export function BerichtSeite() {
  const t = useT();
  const sprache = useSprache();
  const d = t.bericht.detail;
  const { id } = route.useParams();
  const { data: b } = useSuspenseQuery(berichtDetail(id));
  const { data: fonds } = useSuspenseQuery(fondsListe());
  const suche = route.useSearch();
  const navigate = route.useNavigate();
  const { tab: gewaehlt, setzeTab } = useTabs(suche, navigate, ["freigabe", "kontrolle", "inhalt", "datei", "protokoll"] as const);
  const kontrolle = useQuery(berichtKontrolle(id));
  const fondsName = fonds.find((f) => f.id === b.fondsId)?.name ?? "";
  const alleIds = [b.erstelltVon, ...b.protokoll.map((p) => p.akteur), ...b.abschnitte.map((a) => a.geaendertVon)];
  const person = useNamen(alleIds);
  useEffect(() => (b.fondsId ? merkeFonds(b.fondsId) : undefined), [b.fondsId]);

  const art = aufzaehlung(t.bericht.art, b.art);
  // Inhalt (Freitexte): LP-Bericht im Kern, Arten der Erweiterungen mit eigenem Inhalt (PAI-Erklärung).
  const Inhalt = alle("berichtsarten").find((a) => a.art === b.art)?.inhalt;
  const tab = gewaehlt === "inhalt" && b.art !== "lp_bericht" && !Inhalt ? "freigabe" : gewaehlt;
  return (
    <div className="app-seite">
      <Seitenkopf
        meta={
          <>
            <Link to="/reports" search={b.fondsId ? { fondsId: b.fondsId } : {}}>
              {d.zurListe}
            </Link>
            {fondsName ? ` · ${fondsName}` : ""}
            <Status variante={BERICHT_STATUS[b.status] ?? "entwurf"}>{aufzaehlung(t.bericht.status, b.status)}</Status>
          </>
        }
        titel={`${art} ${formatDatum(b.stichtag, sprache)}`}
      />

      <section className="app-karte" aria-label={d.etikett}>
        <dl className="app-fakten">
          <div>
            <dt>{d.stichtag}</dt>
            <dd className="app-zahl">{formatDatum(b.stichtag, sprache)}</dd>
          </div>
          <div>
            <dt>{d.sprache}</dt>
            <dd>{aufzaehlung(t.bericht.sprachen, b.sprache)}</dd>
          </div>
          <div>
            <dt>{d.format}</dt>
            <dd>{b.format === "pdf" ? "PDF" : "Excel"}</dd>
          </div>
        </dl>
        <p className="app-leer-text">{d.angelegt(person(b.erstelltVon) ?? "", formatZeitpunkt(b.erstelltAm, sprache))}</p>
        <p className="app-leer-text">{b.stand ? d.standFest(formatZeitpunkt(b.stand, sprache)) : b.standVorgabe ? d.standVorgabe(formatZeitpunkt(b.standVorgabe, sprache)) : d.standOffen}</p>
        <Berichtigung key={id} b={b} />
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
            inhalt: () => <Stufen b={b} kontrolle={kontrolle.data} person={person} />,
          },
          {
            id: "kontrolle",
            icon: ListChecksIcon,
            label: t.bericht.kontrolle.titel,
            ...(kontrolle.data && kontrolle.data.pruefungen.some((p) => p.status !== "ok") ? { zaehler: kontrolle.data.pruefungen.filter((p) => p.status !== "ok").length } : {}),
            inhalt: () => <KontrollKachel b={b} abfrage={kontrolle} />,
          },
          ...(b.art === "lp_bericht" || Inhalt
            ? [{ id: "inhalt", icon: FileTextIcon, label: t.tabs.inhalt, inhalt: () => (Inhalt ? <Inhalt b={b} person={person} /> : <Abschnitte b={b} person={person} />) }]
            : []),
          { id: "datei", icon: FolderOpenIcon, label: t.tabs.datei, inhalt: () => <DateiKachel b={b} /> },
          { id: "protokoll", icon: ListMagnifyingGlassIcon, label: t.tabs.protokoll, zaehler: b.protokoll.length, inhalt: () => <ProtokollKachel b={b} person={person} /> },
        ]}
      />
    </div>
  );
}

function Berichtigung({ b }: { b: BerichtDetail }) {
  const t = useT();
  const d = t.bericht.detail;
  const { darf } = useRechte();
  const navigate = route.useNavigate();
  const anlegen = useBerichtigungAnlegen(b.id);
  const [grund, setGrund] = useState("");
  return (
    <>
      {b.vorfassungId && <p><Link to="/reports/$id" params={{ id: b.vorfassungId }}>{d.vorfassung}</Link> · {d.berichtigungsgrund}: {b.berichtigungsgrund}</p>}
      {b.nachfassungId ? <Link to="/reports/$id" params={{ id: b.nachfassungId }}>{d.nachfassung}</Link> :
        b.status === "freigegeben" && b.fondsId && darf("bearbeiter", b.fondsId, "berichte") && (
          <details>
            <summary>{d.berichtigen}</summary>
            <form className="cw-formularraster" onSubmit={(e) => {
              e.preventDefault();
              if (grund.trim()) anlegen.mutate(grund.trim(), { onSuccess: (neu) => void navigate({ to: "/reports/$id", params: { id: neu.id } }) });
            }}>
              <Textbereich label={d.berichtigungsgrund} hilfe={d.grundHilfe} rows={2} required maxLength={1000} value={grund} onChange={(e) => setGrund(e.target.value)} fehler={feldText(t, anlegen.error, "grund")} />
              <FehlerHinweis fehler={anlegen.error} bekannt={["grund"]} />
              <Button type="submit" disabled={!grund.trim() || anlegen.isPending}>{d.entwurfAnlegen}</Button>
            </form>
          </details>
        )}
    </>
  );
}

export type Namen = (id: string | null | undefined) => string | null;

function Stufen({ b, kontrolle, person }: { b: BerichtDetail; kontrolle: BerichtKontrolle | undefined; person: Namen }) {
  const t = useT();
  const sprache = useSprache();
  const s = t.bericht.stufen;
  const a = t.bericht.aktion;
  const v = t.bericht.vierAugen;
  const { ich, darf } = useRechte();
  const aktion = useBerichtStufe(b.id);
  const [kommentar, setKommentar] = useState("");
  const [grund, setGrund] = useState("");
  const [lokal, setLokal] = useState<{ feld: "kommentar" | "grund"; text: string } | null>(null);
  const stufen = stufenNamen(b);
  const aktiv = aktiveStufen(b.protokoll);
  const freigegeben = b.status === "freigegeben";
  const name = b.naechsteStufeName ?? stufen[b.naechsteStufe] ?? "";
  const letzte = b.naechsteStufe === stufen.length - 1;
  const rot = kontrolle?.gesamt === "abweichung";
  const ueberschreiben = letzte && rot;
  const ausgeschlossen = ausgeschlosseneStufen(b);
  const darfStufe = b.fondsId ? darf("freigeber", b.fondsId, "berichte") : false;
  const selbst = ich?.id;
  const sperrgrund = !darfStufe
    ? v.rolle(aufzaehlung(t.rolle, "freigeber"))
    : selbst && selbst === ausgeschlossen.ersteller
      ? v.selbstErsteller
      : selbst && ausgeschlossen.bearbeiter.includes(selbst)
        ? v.selbstBearbeiter
        : selbst && ausgeschlossen.freigeber.includes(selbst)
          ? v.selbstFreigeber
          : null;
  const namenAusgeschlossen = [...new Set([ausgeschlossen.ersteller, ...ausgeschlossen.bearbeiter, ...ausgeschlossen.freigeber])].map((x) => person(x) ?? "").filter(Boolean);
  const zurueckMoeglich = b.naechsteStufe > 0;
  const letzteRueckgabe = [...b.protokoll].reverse().find((p) => p.ergebnis === "zurueck");

  const schritte = [
    ...stufen.map((stufe, i) => {
      const erteilt = aktiv[i];
      return {
        id: `s${i}`,
        label: (
          <span className="app-stufe">
            <span>{stufe}</span>
            <span className="app-stufe__zeit">{erteilt ? s.erteilt(person(erteilt.akteur) ?? "", formatZeitpunkt(erteilt.am, sprache)) : s.ausstehend}</span>
          </span>
        ),
      };
    }),
    { id: "fertig", label: <span className="app-stufe">{s.freigegebenLabel}</span> },
  ];

  function ausfuehren(ergebnis: "ok" | "zurueck") {
    setLokal(null);
    if (ergebnis === "zurueck" && kommentar.trim() === "") {
      setLokal({ feld: "kommentar", text: feldCodeText(t, "comment_required") });
      return;
    }
    if (ergebnis === "ok" && ueberschreiben && grund.trim() === "") {
      setLokal({ feld: "grund", text: a.grundPflicht });
      return;
    }
    aktion.mutate(
      {
        stufe: name,
        ergebnis,
        ...(kommentar.trim() ? { kommentar: kommentar.trim() } : {}),
        ...(ergebnis === "ok" && ueberschreiben ? { kontrolleUeberschreiben: { grund: grund.trim() } } : {}),
      },
      {
        onSuccess: () => {
          setKommentar("");
          setGrund("");
        },
      },
    );
  }

  return (
    <section className="app-karte" aria-labelledby="stufen-titel">
      <h2 id="stufen-titel" className="cw-t-untertitel app-karte__titel">
        {s.titel}
      </h2>
      <Schrittfolge aria-label={s.beschriftung} aktuell={freigegeben ? "fertig" : `s${b.naechsteStufe}`} schritte={schritte} />
      {letzteRueckgabe && !freigegeben ? <p className="app-leer-text">{s.zurueckgegeben(letzteRueckgabe.stufe, person(letzteRueckgabe.akteur) ?? "", formatZeitpunkt(letzteRueckgabe.am, sprache))}</p> : null}
      {freigegeben ? <Hinweis>{b.dateiSha256 ? a.freigegeben : a.freigegebenOhne}</Hinweis> : null}

      {!freigegeben ? (
        <div className="app-formular" role="group" aria-label={a.titel}>
          <h3 className="app-gruppen-titel">{a.titel}</h3>
          <p className="app-leer-text">{v.regel}</p>
          {namenAusgeschlossen.length > 0 ? <p className="app-leer-text">{v.ausgeschlossen(namenAusgeschlossen.join(", "))}</p> : null}
          {letzte && !ueberschreiben ? <p className="app-leer-text">{a.letzteHinweis}</p> : null}
          {ueberschreiben ? (
            <>
              <Hinweis variante="fehler" titel={a.ueberschreibenTitel}>
                {a.ueberschreibenText}
              </Hinweis>
              <Textbereich label={a.ueberschreibenGrund} rows={3} value={grund} onChange={(e) => setGrund(e.target.value)} fehler={lokal?.feld === "grund" ? lokal.text : feldText(t, aktion.error, "kontrolleUeberschreiben")} />
            </>
          ) : null}
          <Textbereich markdown label={a.kommentar} hilfe={a.kommentarHilfe} rows={3} value={kommentar} onChange={(e) => setKommentar(e.target.value)} fehler={lokal?.feld === "kommentar" ? lokal.text : feldText(t, aktion.error, "kommentar")} />
          <FehlerHinweis fehler={aktion.error} bekannt={["kommentar", "kontrolleUeberschreiben", "stufe", "ergebnis"]} />
          <div className="app-aktionen__knoepfe">
            <Button
              variante={ueberschreiben ? "gefahr" : "primaer"}
              disabled={aktion.isPending || sperrgrund !== null}
              aria-describedby={sperrgrund ? "stufe-sperrgrund" : undefined}
              onClick={() => ausfuehren("ok")}
            >
              {ueberschreiben ? a.ueberschreiben : a.erteilen(name)}
            </Button>
            <Button variante="sekundaer" disabled={aktion.isPending || sperrgrund !== null || !zurueckMoeglich} aria-describedby={sperrgrund ? "stufe-sperrgrund" : undefined} onClick={() => ausfuehren("zurueck")}>
              {a.zurueck}
            </Button>
          </div>
          {sperrgrund ? (
            <p id="stufe-sperrgrund" className="app-leer-text">
              {sperrgrund}
            </p>
          ) : null}
          <p className="app-leer-text">{zurueckMoeglich ? a.zurueckHilfe : a.keineZurueck}</p>
        </div>
      ) : null}
    </section>
  );
}

const BETRAGSFELDER = new Set(["portfolio", "vorgaenge", "nav", "bewertungen", "eigenkapital", "differenz", "wertansatz", "abgerufen", "zeichnungskapital", "kapitalkonten", "fonds"]);

/** Ein betroffener Datensatz einer Prüfung als Satz aus bekannten Feldern; Unbekanntes bleibt als Text. */
function detailText(t: Texte, sprache: Sprache, detail: unknown): string {
  const k = t.bericht.kontrolle;
  if (typeof detail !== "object" || detail === null) return String(detail);
  const d = detail as Record<string, unknown>;
  if (d.feld === "zeichnungen") return k.keineZeichnungen;
  return Object.entries(d)
    .filter(([name]) => name !== "hinweis" && (name !== "beteiligungId" || !("organisation" in d)) && name !== "bewertungId")
    .map(([name, wert]) => {
      const text = name === "feld" ? aufzaehlung(k.summenFelder, String(wert)) : typeof wert === "string" && BETRAGSFELDER.has(name) ? formatBetragCent(wert, sprache) : String(wert);
      return `${aufzaehlung(k.detailFelder, name)}: ${text}`;
    })
    .join(", ");
}

/** Satz zur Prüfung aus Code und Parametern; ein unbekannter Code fällt auf die Bezeichnung der API zurück. */
function pruefungText(t: Texte, p: Pruefung): string {
  const eintrag = Object.hasOwn(t.bericht.kontrolle.codes, p.code) ? t.bericht.kontrolle.codes[p.code] : undefined;
  if (!eintrag) return p.bezeichnung;
  return p.status === "ok" ? eintrag.ok : eintrag.abweichung(Number((p.params as { anzahl?: unknown }).anzahl ?? 0));
}

function KontrollKachel({ b, abfrage }: { b: BerichtDetail; abfrage: ReturnType<typeof useQuery<BerichtKontrolle>> }) {
  const t = useT();
  const sprache = useSprache();
  const k = t.bericht.kontrolle;
  const { data, error, isPending } = abfrage;
  const ueberschrieben = b.kontrolleUeberschrieben as { grund?: string } | null;
  return (
    <section className="app-karte" aria-labelledby="kontrolle-titel">
      <h2 id="kontrolle-titel" className="cw-t-untertitel app-karte__titel">
        {k.titel}
      </h2>
      <p className="app-leer-text">{k.beschreibung}</p>
      {isPending ? <Skelettzeilen anzahl={3} /> : null}
      {error ? <FehlerHinweis fehler={error} /> : null}
      {data ? (
        <>
          <Hinweis>{data.gesamt === "ok" ? k.gesamtOk : k.gesamtRot}</Hinweis>
          {ueberschrieben?.grund ? <Hinweis variante="fehler">{k.ueberschrieben(ueberschrieben.grund)}</Hinweis> : null}
          <ul className="app-kontrollen" aria-label={k.titel}>
            {data.pruefungen.map((p) => (
              <li key={p.schluessel} className="app-kontrolle">
                <div className="app-kontrolle__kopf">
                  <Status variante={p.status === "ok" ? "freigegeben" : "fehlt"}>{p.status === "ok" ? k.ok : k.abweichung}</Status>
                  <strong>{pruefungText(t, p)}</strong>
                </div>
                {Array.isArray(p.details) && p.details.length > 0 ? (
                  <ul className="app-liste-klein" aria-label={k.details}>
                    {(p.details as unknown[]).map((x, i) => (
                      <li key={i}>{detailText(t, sprache, x)}</li>
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

function Abschnitte({ b, person }: { b: BerichtDetail; person: Namen }) {
  const t = useT();
  const sprache = useSprache();
  const a = t.bericht.abschnitte;
  const { darf } = useRechte();
  const vorlage = vorlagenAbschnitte(b);
  const sichtbar = FREITEXTE.filter((s) => vorlage.includes(s));
  const bearbeitbar = b.status === "entwurf" && b.fondsId !== null && darf("bearbeiter", b.fondsId, "berichte");
  return (
    <section className="app-karte" aria-labelledby="abschnitte-titel">
      <h2 id="abschnitte-titel" className="cw-t-untertitel app-karte__titel">
        {a.titel}
      </h2>
      <p className="app-leer-text">{a.beschreibung}</p>
      {b.status !== "entwurf" ? <Hinweis>{a.gesperrt}</Hinweis> : null}
      {sichtbar.length === 0 ? <p className="app-leer-text">{a.keine}</p> : null}
      {sichtbar.map((s) => {
        const zeile = b.abschnitte.find((x) => x.schluessel === s);
        return bearbeitbar ? (
          <AbschnittEditor key={`${s}-${zeile?.geaendertAm ?? ""}`} berichtId={b.id} schluessel={s} zeile={zeile} person={person} />
        ) : (
          <div key={s} className="app-abschnitt-text">
            <h3 className="app-gruppen-titel">{aufzaehlung(a.namen, s)}</h3>
            <p lang="de">{zeile?.textDe || a.leer}</p>
            <p lang="en">{zeile?.textEn || a.leer}</p>
            {zeile ? <p className="app-leer-text">{a.bearbeitetVon(person(zeile.geaendertVon) ?? "", formatZeitpunkt(zeile.geaendertAm, sprache))}</p> : null}
          </div>
        );
      })}
    </section>
  );
}

export function AbschnittEditor({ berichtId, schluessel, zeile, person, name: nameVorgabe }: { berichtId: string; schluessel: string; zeile: Abschnitt | undefined; person: Namen; name?: string }) {
  const t = useT();
  const sprache = useSprache();
  const a = t.bericht.abschnitte;
  const setzen = useAbschnittSetzen(berichtId);
  const [textDe, setTextDe] = useState(zeile?.textDe ?? "");
  const [textEn, setTextEn] = useState(zeile?.textEn ?? "");
  const name = nameVorgabe ?? aufzaehlung(a.namen, schluessel);
  return (
    <form
      className="app-formular app-abschnitt-text"
      noValidate
      aria-label={name}
      onSubmit={(e) => {
        e.preventDefault();
        setzen.mutate({ schluessel, textDe, textEn });
      }}
    >
      <h3 className="app-gruppen-titel">{name}</h3>
      <div className="app-zwei-spalten">
        <Textbereich label={`${name}: ${a.textDe}`} lang="de" rows={5} value={textDe} onChange={(e) => setTextDe(e.target.value)} />
        <Textbereich label={`${name}: ${a.textEn}`} lang="en" rows={5} value={textEn} onChange={(e) => setTextEn(e.target.value)} />
      </div>
      <FehlerHinweis fehler={setzen.error} />
      {setzen.isSuccess ? <p className="app-leer-text" role="status">{a.gespeichert}</p> : null}
      {zeile ? <p className="app-leer-text">{a.bearbeitetVon(person(zeile.geaendertVon) ?? "", formatZeitpunkt(zeile.geaendertAm, sprache))}</p> : null}
      <div>
        <Button type="submit" variante="sekundaer" disabled={setzen.isPending}>
          {a.speichern(name)}
        </Button>
      </div>
    </form>
  );
}

function DateiKachel({ b }: { b: BerichtDetail }) {
  const t = useT();
  const sprache = useSprache();
  const d = t.bericht.datei;
  const freigegeben = b.status === "freigegeben";
  return (
    <section className="app-karte" aria-labelledby="datei-titel">
      <div className="app-karte__kopf">
        <h2 id="datei-titel" className="cw-t-untertitel app-karte__titel">
          {d.titel}
        </h2>
        {freigegeben ? <Status variante="freigegeben">{d.marke}</Status> : null}
      </div>
      {freigegeben ? (
        <>
          <dl className="app-fakten">
            <div>
              <dt>{d.name}</dt>
              <dd>{b.dateiName}</dd>
            </div>
            {b.dateiGroesse !== null ? (
              <div>
                <dt>{d.groesse}</dt>
                <dd className="app-zahl">{d.kb(new Intl.NumberFormat(sprache === "en" ? "en-GB" : "de-DE", { maximumFractionDigits: 1 }).format(b.dateiGroesse / 1024))}</dd>
              </div>
            ) : null}
            {b.erzeugtAm ? (
              <div>
                <dt>{d.erzeugt}</dt>
                <dd>{formatZeitpunkt(b.erzeugtAm, sprache)}</dd>
              </div>
            ) : null}
            <div>
              <dt>{d.hash}</dt>
              <dd className="app-hash">{b.dateiSha256}</dd>
            </div>
          </dl>
          <p className="app-leer-text">{d.hinweis}</p>
          <div className="app-aktionen__knoepfe">
            <ButtonLink href={berichtDateiUrl(b.id)} download>
              {d.freigegeben}
            </ButtonLink>
          </div>
        </>
      ) : (
        <>
          <p className="app-leer-text">{d.entwurfHinweis}</p>
          <div className="app-aktionen__knoepfe">
            <ButtonLink variante="sekundaer" href={berichtDateiUrl(b.id)} download>
              {d.entwurf}
            </ButtonLink>
          </div>
        </>
      )}
    </section>
  );
}

function ProtokollKachel({ b, person }: { b: BerichtDetail; person: Namen }) {
  const t = useT();
  const sprache = useSprache();
  const p = t.bericht.protokoll;
  const spalten: TabelleSpalte<Protokoll>[] = [
    { schluessel: "stufe", kopf: p.spalten.stufe, zelle: (z) => z.stufe },
    { schluessel: "ergebnis", kopf: p.spalten.ergebnis, zelle: (z) => aufzaehlung(p.ergebnisse, z.ergebnis) },
    { schluessel: "person", kopf: p.spalten.person, zelle: (z) => person(z.akteur) ?? "" },
    { schluessel: "zeit", kopf: p.spalten.zeit, zelle: (z) => formatZeitpunkt(z.am, sprache) },
    {
      schluessel: "kommentar",
      kopf: p.spalten.kommentar,
      umbruch: true,
      zelle: (z) => (
        <>
          {z.kommentar ? <Markdown text={z.kommentar} /> : t.gemeinsam.keinWert}
          {z.kontrolleUeberschreibung ? <span className="app-leer-text"> {p.ueberschreibung(z.kontrolleUeberschreibung)}</span> : null}
        </>
      ),
    },
  ];
  return (
    <section className="app-karte" aria-labelledby="protokoll-titel">
      <h2 id="protokoll-titel" className="cw-t-untertitel app-karte__titel">
        {p.titel}
      </h2>
      {b.protokoll.length === 0 ? <p className="app-leer-text">{p.keine}</p> : <Tabelle beschriftung={p.tabelle} spalten={spalten} zeilen={b.protokoll} zeilenSchluessel={(z) => z.id} />}
    </section>
  );
}
