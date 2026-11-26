import { Bereichskopf } from "../komponenten/Bereichskopf";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Auswahl, BellIcon, Button, ChartLineUpIcon, Feld, formatDatum, Hinweis, ListChecksIcon, Status, Tabelle, Tabs, Textbereich, type StatusVariante, type TabelleSpalte } from "@carraway/ui";
import { useTabs } from "../lib/tabs";
import { heuteIso } from "../api/datum";
import {
  kennzahlAbfrage,
  kennzahlAbfragen,
  kennzahlAuswahl,
  kennzahlKatalog,
  kennzahlUebersicht,
  useAbfrageAnlegen,
  useAbfrageBestaetigen,
  useAbfrageWiderrufen,
  useNeuerLink,
  useWertBestaetigen,
  useWertVerwerfen,
  type AbfrageZeile,
  type Link as AbfrageLink,
  type Uebersicht,
} from "../api/kennzahlen";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { KennzahlAuswahl } from "../komponenten/KennzahlAuswahl";
import { EmpfaengerAuswahl, PerMailDialog } from "../komponenten/MailEmpfaenger";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { aktuellesQuartal, formatKennzahlWert, kennzahlName, passtZeitraum, periodeKurz, zeitraum, type Periodenart } from "../lib/kennzahlen";
import { useRechte } from "../lib/rechte";

const route = getRouteApi("/fonds/$fondsId/kennzahlen");

type Zeile = Uebersicht["unternehmen"][number];
const ABFRAGE_STATUS: Record<string, StatusVariante> = { offen: "pruefung", eingereicht: "pruefung", bestaetigt: "freigegeben", widerrufen: "fehlt" };

/**
 * Seite „Kennzahlen-Abfragen“ am Fonds: Stand je Unternehmen für einen Zeitraum (angefordert, eingereicht, bestätigt), Anfragen anlegen,
 * Link kopieren, neuer Link, zurückziehen, Angaben prüfen, Erinnerungen an offene Anfragen und die Auswahl der Kennzahlen des Fonds.
 */
export function KennzahlenabfragenSeite() {
  const t = useT();
  const sprache = useSprache();
  const f = t.kennzahlen.fonds;
  const { fondsId } = route.useParams();
  const { darf } = useRechte();
  const q = aktuellesQuartal();
  const [art, setArt] = useState<Periodenart>("quartal");
  const [jahr, setJahr] = useState(String(q.jahr));
  const [nummer, setNummer] = useState(String(q.nummer));
  const jahrZahl = Number(jahr);
  const gueltig = Number.isInteger(jahrZahl) && jahrZahl >= 2000 && jahrZahl <= 2100;
  const z = zeitraum(art, gueltig ? jahrZahl : q.jahr, Number(nummer));
  const { data: uebersicht, error, isPending } = useQuery({ ...kennzahlUebersicht(fondsId, z.kurz), enabled: gueltig });
  const { data: abfragen } = useQuery(kennzahlAbfragen(fondsId));
  const { data: auswahl } = useQuery(kennzahlAuswahl(fondsId));
  const [anlegen, setAnlegen] = useState<Zeile | null>(null);
  const [link, setLink] = useState<{ link: AbfrageLink; name: string } | null>(null);
  const [pruefen, setPruefen] = useState<Zeile | null>(null);
  const [perMail, setPerMail] = useState<{ zeile: Zeile; abfrageId: string } | null>(null);
  const { tab, setzeTab } = useTabs(route.useSearch(), route.useNavigate(), ["uebersicht", "erinnerungen", "auswahl"] as const);
  const neuerLink = useNeuerLink();
  const widerrufen = useAbfrageWiderrufen();
  const schreiben = darf("bearbeiter", fondsId, "kennzahlen");

  const erinnerungen = (abfragen ?? []).filter((a) => a.erinnerung !== null);
  const spalten: TabelleSpalte<Zeile>[] = [
    {
      schluessel: "unternehmen",
      kopf: f.spalten.unternehmen,
      zelle: (u) => (
        <Link to="/beteiligungen/$id" params={{ id: u.beteiligungId }} search={{ tab: "kennzahlen" }}>
          {u.organisation}
        </Link>
      ),
    },
    { schluessel: "angefordert", kopf: f.spalten.angefordert, zahl: true, zelle: (u) => u.angefordert },
    { schluessel: "eingereicht", kopf: f.spalten.eingereicht, zahl: true, zelle: (u) => u.eingereicht },
    { schluessel: "bestaetigt", kopf: f.spalten.bestaetigt, zahl: true, zelle: (u) => u.bestaetigt },
    {
      schluessel: "fehlend",
      kopf: f.spalten.fehlend,
      zelle: (u) =>
        u.fehlend.length === 0
          ? f.keineKennzahlenFuerUnternehmen
          : u.fehlend.map((s) => kennzahlName(uebersicht!.kennzahlen.find((k) => k.schluessel === s) ?? { bezeichnungDe: s, bezeichnungEn: s }, sprache)).join(", "),
    },
    {
      schluessel: "anfrage",
      kopf: f.spalten.anfrage,
      zelle: (u) =>
        u.abfrage ? (
          <span className="app-zusammenhang">
            <Status variante={ABFRAGE_STATUS[u.abfrage.status] ?? "entwurf"}>{aufzaehlung(f.abfrageStatus, u.abfrage.status)}</Status>
            <span>{f.faellig(formatDatum(u.abfrage.faelligAm, sprache))}</span>
            {u.abfrage.abgelaufen ? <Status variante="fehlt">{f.abgelaufen}</Status> : null}
          </span>
        ) : (
          t.gemeinsam.keinWert + " " + f.keineAnfrage
        ),
    },
    ...(schreiben
      ? [
          {
            schluessel: "aktion",
            kopf: f.spalten.aktion,
            zelle: (u: Zeile) => {
              const a = u.abfrage;
              return (
                <span className="app-zusammenhang">
                  {!a || a.status === "widerrufen" ? (
                    <Button variante="sekundaer" aria-label={f.anlegenFuer(u.organisation)} onClick={() => setAnlegen(u)} disabled={uebersicht?.kennzahlen.length === 0}>
                      {f.anlegen}
                    </Button>
                  ) : null}
                  {a?.status === "offen" ? (
                    <>
                      <Button variante="sekundaer" aria-label={f.neuerLinkFuer(u.organisation)} disabled={neuerLink.isPending} onClick={() => neuerLink.mutate(a.id, { onSuccess: (r) => setLink({ link: r.link, name: u.organisation }) })}>
                        {f.neuerLink}
                      </Button>
                      <Button variante="sekundaer" aria-label={t.mail.abfrage.sendenFuer(u.organisation)} onClick={() => setPerMail({ zeile: u, abfrageId: a.id })}>
                        {t.mail.abfrage.senden}
                      </Button>
                      <Button variante="ruhig" aria-label={f.widerrufenFuer(u.organisation)} disabled={widerrufen.isPending} onClick={() => widerrufen.mutate(a.id)}>
                        {f.widerrufen}
                      </Button>
                    </>
                  ) : null}
                  {a && (a.status === "eingereicht" || a.status === "bestaetigt") ? (
                    <Button variante="sekundaer" aria-label={f.pruefenFuer(u.organisation)} onClick={() => setPruefen(u)}>
                      {f.pruefen}
                    </Button>
                  ) : null}
                </span>
              );
            },
          } satisfies TabelleSpalte<Zeile>,
        ]
      : []),
  ];

  const erinnerungSpalten: TabelleSpalte<AbfrageZeile>[] = [
    { schluessel: "unternehmen", kopf: f.spalten.unternehmen, zelle: (a) => a.organisation },
    { schluessel: "zeitraum", kopf: f.periode, zelle: (a) => periodeKurz(a.periodeBeginn, a.periodeEnde) },
    { schluessel: "erinnerung", kopf: f.spalten.anfrage, zelle: (a) => (a.erinnerung === "ueberfaellig" ? f.erinnerungen.ueberfaellig(formatDatum(a.faelligAm, sprache)) : f.erinnerungen.bald(formatDatum(a.faelligAm, sprache))) },
  ];

  return (
    <div className="app-seite">
      <Bereichskopf titel={f.titel} />
      <p className="app-leer-text">{f.einleitung}</p>

      <Tabs
        aria-label={t.tabs.bereiche}
        aktiv={tab}
        onWechsel={setzeTab}
        tabs={[
          { id: "uebersicht", icon: ChartLineUpIcon, label: f.uebersicht, inhalt: () => (
      <section className="app-karte" aria-labelledby="kz-uebersicht">
        <div className="app-karte__kopf">
          <h2 id="kz-uebersicht" className="cw-t-untertitel app-karte__titel">
            {f.uebersicht}
          </h2>
          <div className="app-verlauf__steuerung">
            <Auswahl label={f.zeitraumWaehlen} value={art} onChange={(e) => setArt(e.target.value as Periodenart)}>
              {(["monat", "quartal", "jahr"] as const).map((x) => (
                <option key={x} value={x}>
                  {aufzaehlung(t.kennzahlen.zeitraumArt, x)}
                </option>
              ))}
            </Auswahl>
            <Feld label={t.kennzahlen.felder.jahr} type="number" min={2000} max={2100} value={jahr} onChange={(e) => setJahr(e.target.value)} />
            {art === "jahr" ? null : (
              <Auswahl label={t.kennzahlen.felder.nummer} value={nummer} onChange={(e) => setNummer(e.target.value)}>
                {Array.from({ length: art === "monat" ? 12 : 4 }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    {art === "monat" ? t.kennzahlen.nummerMonat(i + 1) : t.kennzahlen.nummerQuartal(i + 1)}
                  </option>
                ))}
              </Auswahl>
            )}
          </div>
        </div>
        {error ? <FehlerHinweis fehler={error} /> : null}
        {isPending && gueltig ? <p className="app-leer-text">…</p> : null}
        {uebersicht ? (
          uebersicht.kennzahlen.length === 0 ? (
            <Hinweis>{f.keineKennzahlen}</Hinweis>
          ) : (
            <>
              <Tabelle beschriftung={f.uebersichtBeschriftung} spalten={spalten} zeilen={uebersicht.unternehmen} zeilenSchluessel={(u) => u.beteiligungId} />
              <p className="app-leer-text app-kz-hinweis">{f.summe(uebersicht.summe.angefordert, uebersicht.summe.eingereicht, uebersicht.summe.bestaetigt)}</p>
            </>
          )
        ) : null}
        {neuerLink.error ? <FehlerHinweis fehler={neuerLink.error} /> : null}
        {widerrufen.error ? <FehlerHinweis fehler={widerrufen.error} /> : null}
      </section>


          ) },
          { id: "erinnerungen", icon: BellIcon, label: f.erinnerungen.titel, zaehler: erinnerungen.length, inhalt: () => (
      <section className="app-karte" aria-labelledby="kz-erinnerungen">
        <h2 id="kz-erinnerungen" className="cw-t-untertitel app-karte__titel">
          {f.erinnerungen.titel}
        </h2>
        {erinnerungen.length === 0 ? <p className="app-leer-text">{f.erinnerungen.keine}</p> : <Tabelle beschriftung={f.erinnerungen.beschriftung} spalten={erinnerungSpalten} zeilen={erinnerungen} zeilenSchluessel={(a) => a.id} />}
      </section>


          ) },
          { id: "auswahl", icon: ListChecksIcon, label: t.kennzahlen.auswahl.titel, inhalt: () => <KennzahlAuswahl fondsId={fondsId} kannAendern={darf("verwalter", fondsId, "kennzahlen")} /> },
        ]}
      />

      {anlegen ? <AbfrageDialog zeile={anlegen} zeitraumKurz={z} art={art} voreinstellung={(auswahl ?? []).map((x) => x.schluessel)} onFertig={(l) => { setLink({ link: l, name: anlegen.organisation }); setAnlegen(null); }} onSchliessen={() => setAnlegen(null)} /> : null}
      {perMail ? (
        <PerMailDialog
          name={perMail.zeile.organisation}
          organisationId={perMail.zeile.organisationId}
          abfrageId={perMail.abfrageId}
          onFertig={(l) => {
            setLink({ link: l, name: perMail.zeile.organisation });
            setPerMail(null);
          }}
          onSchliessen={() => setPerMail(null)}
        />
      ) : null}
      {link ? <LinkDialog name={link.name} link={link.link} onSchliessen={() => setLink(null)} /> : null}
      {pruefen?.abfrage ? <PruefDialog name={pruefen.organisation} abfrageId={pruefen.abfrage.id} schreiben={schreiben} onSchliessen={() => setPruefen(null)} /> : null}
    </div>
  );
}

function AbfrageDialog({ zeile, zeitraumKurz, art, voreinstellung, onFertig, onSchliessen }: { zeile: Zeile; zeitraumKurz: { beginn: string; ende: string }; art: Periodenart; voreinstellung: string[]; onFertig: (link: AbfrageLink) => void; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const d = t.kennzahlen.fonds.dialog;
  const anlegen = useAbfrageAnlegen(zeile.beteiligungId);
  const [faellig, setFaellig] = useState(() => {
    const in14 = new Date(Date.now() + 14 * 86_400_000);
    return `${in14.getFullYear()}-${String(in14.getMonth() + 1).padStart(2, "0")}-${String(in14.getDate()).padStart(2, "0")}`;
  });
  const [seite, setSeite] = useState<"de" | "en">(sprache);
  const [hinweis, setHinweis] = useState("");
  const [tage, setTage] = useState("30");
  const [empfaenger, setEmpfaenger] = useState("");
  const { data: katalog } = useQuery(kennzahlKatalog());
  // Nur Kennzahlen, die zum Zeitraum passen (eine Jahreskennzahl wird nicht für ein Quartal erfragt); vorbelegt ist die Auswahl des Fonds.
  const passend = (katalog ?? []).filter((k) => passtZeitraum(art, k.periodizitaet));
  const [abgewaehlt, setAbgewaehlt] = useState<string[]>([]);
  const gewaehlt = (voreinstellung.length ? passend.filter((k) => voreinstellung.includes(k.schluessel)) : []).map((k) => k.schluessel).filter((s) => !abgewaehlt.includes(s));
  const [zusaetzlich, setZusaetzlich] = useState<string[]>([]);
  const alleGewaehlt = [...gewaehlt, ...zusaetzlich.filter((s) => !gewaehlt.includes(s))];
  const umschalten = (s: string) => (alleGewaehlt.includes(s) ? (zusaetzlich.includes(s) ? setZusaetzlich((a) => a.filter((x) => x !== s)) : setAbgewaehlt((a) => [...a, s])) : (setAbgewaehlt((a) => a.filter((x) => x !== s)), setZusaetzlich((a) => [...a, s])));
  return (
    <Seitenpanel titel={d.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{t.kennzahlen.fonds.anlegenFuer(zeile.organisation)}</h2>
      <p className="app-leer-text">{periodeKurz(zeitraumKurz.beginn, zeitraumKurz.ende)}</p>
      <form
        className="app-formular"
        onSubmit={(e) => {
          e.preventDefault();
          anlegen.mutate(
            { periodeBeginn: zeitraumKurz.beginn, periodeEnde: zeitraumKurz.ende, faelligAm: faellig, sprache: seite, gueltigTage: Number(tage), ...(hinweis.trim() ? { hinweis: hinweis.trim() } : {}), ...(alleGewaehlt.length ? { schluessel: alleGewaehlt } : {}), ...(empfaenger ? { empfaengerPersonId: empfaenger } : {}) },
            { onSuccess: (r) => onFertig(r.link) },
          );
        }}
      >
        <Feld label={d.faelligAm} type="date" min={heuteIso()} value={faellig} onChange={(e) => setFaellig(e.target.value)} required />
        <Auswahl label={d.sprache} value={seite} onChange={(e) => setSeite(e.target.value as "de" | "en")}>
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </Auswahl>
        <Feld label={d.gueltigTage} type="number" min={1} max={30} value={tage} onChange={(e) => setTage(e.target.value)} required />
        <Textbereich label={d.hinweis} value={hinweis} onChange={(e) => setHinweis(e.target.value)} maxLength={500} />
        <fieldset className="app-kz-auswahl">
          <legend>{d.kennzahlen}</legend>
          {passend.map((k) => (
            <label key={k.schluessel}>
              <input type="checkbox" checked={alleGewaehlt.includes(k.schluessel)} onChange={() => umschalten(k.schluessel)} />
              <span>{kennzahlName(k, sprache)}</span>
            </label>
          ))}
        </fieldset>
        <p className="app-leer-text">{d.kennzahlenHilfe}</p>
        <EmpfaengerAuswahl organisationId={zeile.organisationId} wert={empfaenger} onChange={setEmpfaenger} />
        {anlegen.error ? <FehlerHinweis fehler={anlegen.error} /> : null}
        <Button type="submit" disabled={anlegen.isPending}>
          {d.anlegen}
        </Button>
      </form>
    </Seitenpanel>
  );
}

/** Zeigt den Link einmalig zum Kopieren; die Datenbank hält nur den Hash, der Link lässt sich später nicht mehr anzeigen. */
export function LinkDialog({ name, link, onSchliessen }: { name: string; link: AbfrageLink; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const l = t.kennzahlen.fonds.link;
  const [stand, setStand] = useState<"ok" | "fehler" | null>(null);
  const url = `${window.location.origin}${link.pfad}`;
  async function kopieren() {
    try {
      await navigator.clipboard.writeText(url);
      setStand("ok");
    } catch {
      setStand("fehler");
    }
  }
  return (
    <Seitenpanel titel={l.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">
        {l.titel}: {name}
      </h2>
      <Hinweis>{l.hinweis}</Hinweis>
      <Feld label={l.feld} className="app-kz-link" value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
      <p className="app-leer-text">{l.gueltig(formatDatum(link.ablauf, sprache))}</p>
      <Button onClick={() => void kopieren()}>{l.kopieren}</Button>
      <p role="status">{stand === "ok" ? l.kopiert : stand === "fehler" ? l.kopierFehler : ""}</p>
    </Seitenpanel>
  );
}

/** Angaben einer Anfrage prüfen: Werte, Anmerkungen, Bestätigen oder Verwerfen je Wert, alle bestätigen. */
export function PruefDialog({ name, abfrageId, schreiben, onSchliessen }: { name: string; abfrageId: string; schreiben: boolean; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const p = t.kennzahlen.fonds.pruefDialog;
  const k = t.kennzahlen;
  const { data } = useQuery(kennzahlAbfrage(abfrageId));
  const alle = useAbfrageBestaetigen();
  const einzeln = useWertBestaetigen();
  const verwerfen = useWertVerwerfen();
  const eingereicht = (data?.kennzahlen ?? []).filter((x) => x.wert?.status === "eingereicht" && x.wert.verworfenAm === null);
  const spalten: TabelleSpalte<NonNullable<typeof data>["kennzahlen"][number]>[] = [
    { schluessel: "kennzahl", kopf: p.kennzahl, zelle: (x) => kennzahlName(x, sprache) },
    { schluessel: "wert", kopf: p.wert, zahl: true, zelle: (x) => (x.wert && x.wert.verworfenAm === null ? formatKennzahlWert(x.typ, x.wert.wert, x.einheit, sprache, t) : p.keineWerte) },
    ...(data?.abfrage.art === "esg"
      ? [
          { schluessel: "geschaetzt", kopf: p.geschaetzt, zelle: (x: NonNullable<typeof data>["kennzahlen"][number]) => (x.wert && x.wert.verworfenAm === null && x.wert.geschaetzt ? p.geschaetztWert : t.gemeinsam.keinWert) } satisfies TabelleSpalte<NonNullable<typeof data>["kennzahlen"][number]>,
          { schluessel: "quelle", kopf: p.quelle, umbruch: true, zelle: (x: NonNullable<typeof data>["kennzahlen"][number]) => (x.wert && x.wert.verworfenAm === null ? (x.wert.quellenangabe ?? t.gemeinsam.keinWert) : t.gemeinsam.keinWert) } satisfies TabelleSpalte<NonNullable<typeof data>["kennzahlen"][number]>,
        ]
      : []),
    { schluessel: "anmerkung", kopf: p.anmerkung, umbruch: true, zelle: (x) => x.wert?.kommentar ?? t.gemeinsam.keinWert },
    { schluessel: "stand", kopf: p.stand, zelle: (x) => (x.wert && x.wert.verworfenAm === null ? aufzaehlung(k.status, x.wert.status) : t.gemeinsam.keinWert) },
    ...(schreiben
      ? [
          {
            schluessel: "aktion",
            kopf: k.offen.spalten.aktion,
            zelle: (x: NonNullable<typeof data>["kennzahlen"][number]) =>
              x.wert && x.wert.status === "eingereicht" && x.wert.verworfenAm === null ? (
                <span className="app-zusammenhang">
                  <Button variante="sekundaer" aria-label={k.bestaetigenFuer(kennzahlName(x, sprache), "")} onClick={() => einzeln.mutate(x.wert!.id)}>
                    {k.bestaetigen}
                  </Button>
                  <Button variante="ruhig" aria-label={k.verwerfenFuer(kennzahlName(x, sprache), "")} onClick={() => verwerfen.mutate(x.wert!.id)}>
                    {k.verwerfen}
                  </Button>
                </span>
              ) : null,
          } satisfies TabelleSpalte<NonNullable<typeof data>["kennzahlen"][number]>,
        ]
      : []),
  ];
  return (
    <Seitenpanel titel={p.titel(name)} breit onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{p.titel(name)}</h2>
      {data ? (
        <>
          <p className="app-leer-text">
            {periodeKurz(data.abfrage.periodeBeginn, data.abfrage.periodeEnde)} · {aufzaehlung(t.kennzahlen.fonds.abfrageStatus, data.abfrage.status)}
          </p>
          <Tabelle beschriftung={p.titel(name)} spalten={spalten} zeilen={data.kennzahlen} zeilenSchluessel={(x) => x.schluessel} />
          {schreiben && eingereicht.length > 0 ? (
            <Button disabled={alle.isPending} onClick={() => alle.mutate(abfrageId)}>
              {p.alleBestaetigen}
            </Button>
          ) : null}
        </>
      ) : null}
      {alle.error ? <FehlerHinweis fehler={alle.error} /> : null}
      {einzeln.error ? <FehlerHinweis fehler={einzeln.error} /> : null}
      {verwerfen.error ? <FehlerHinweis fehler={verwerfen.error} /> : null}
    </Seitenpanel>
  );
}
