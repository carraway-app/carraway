import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Feld, Hinweis, Segment, Status, Tabelle, Textbereich, type TabelleSpalte } from "@carraway/ui";
import { parseWert, wertFuerFeld } from "../extern/abfrage";
import { kennzahlKatalog, kennzahlReihe, useWertAendern, useWertAnlegen, useWertBestaetigen, useWertVerwerfen, SZENARIEN, type OffenerWert, type Punkt, type Reihe, type Szenario } from "../api/kennzahlen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { ABWEICHUNG_SCHWELLE, aktuellesQuartal, formatAbweichung, formatAbweichungKurz, formatKennzahlWert, kennzahlName, periodeKurz, zeitraum, type Periodenart } from "../lib/kennzahlen";
import { useRechte } from "../lib/rechte";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "./FehlerHinweis";
import { Skelettzeilen } from "./Skelett";

type Ansicht = "tabelle" | "diagramme";
const ZAHLENTYPEN = new Set(["betrag", "zahl", "prozent"]);

/**
 * Reiter „Kennzahlen“ an der Beteiligung: Werte je Zeitraum und Szenario (Ist, Plan, Forecast) mit Abweichung gegen den Plan, kleine Diagramme mit
 * Tabelle als Alternative, Erfassen und Ändern sowie die Prüfung offener Werte (Bestätigen, Verwerfen).
 */
export function KennzahlenTab({ beteiligungId, fondsId, lesend }: { beteiligungId: string; fondsId: string; lesend: boolean }) {
  const t = useT();
  const sprache = useSprache();
  const k = t.kennzahlen;
  const { darf } = useRechte();
  const { data, error, isPending } = useQuery(kennzahlReihe(beteiligungId));
  const [szenario, setSzenario] = useState<Szenario>("ist");
  const [ansicht, setAnsicht] = useState<Ansicht>("tabelle");
  const [dialog, setDialog] = useState<{ bearbeiten?: OffenerWert } | null>(null);
  const bestaetigen = useWertBestaetigen();
  const verwerfen = useWertVerwerfen();
  const schreiben = darf("bearbeiter", fondsId, "kennzahlen") && !lesend;

  if (isPending) return <Skelettzeilen anzahl={4} />;
  if (error || !data) return <FehlerHinweis fehler={error} />;

  const reihen = data.kennzahlen;
  const zeitraeume = [...new Set(reihen.flatMap((r) => r.punkte.map((p) => `${p.periodeBeginn}|${p.periodeEnde}`)))].sort();
  const wertDe = (p: Punkt | undefined) => p?.[szenario] ?? null;

  const spalten: TabelleSpalte<Reihe>[] = [
    {
      schluessel: "kennzahl",
      umbruch: true,
      kopf: k.spalteKennzahl,
      zelle: (r) => (
        <span>
          {kennzahlName(r, sprache)}
          {r.einheit && r.typ !== "ja_nein" && r.typ !== "text" ? <span className="app-kz-einheit"> ({r.einheit})</span> : null}
          {r.angefordert ? (
            <>
              {" "}
              <Status variante="pruefung">{k.angefordert}</Status>
            </>
          ) : null}
        </span>
      ),
    },
    ...zeitraeume.map((z): TabelleSpalte<Reihe> => {
      const [beginn = "", ende = ""] = z.split("|");
      return {
        schluessel: z,
        kopf: periodeKurz(beginn, ende),
        zahl: true,
        zelle: (r) => {
          const punkt = r.punkte.find((p) => p.periodeBeginn === beginn && p.periodeEnde === ende);
          const w = wertDe(punkt);
          if (!w) return <span className="app-kz-kein">{k.kein}</span>;
          const abw = szenario === "ist" ? punkt?.abweichung : null;
          const stark = abw?.prozent != null && Math.abs(Number(abw.prozent)) >= ABWEICHUNG_SCHWELLE;
          const richtung = abw ? (Number(abw.absolut) < 0 ? "neg" : Number(abw.absolut) > 0 ? "pos" : "null") : null;
          return (
            <span className="app-kz-zelle">
              <span className="app-zahl">{formatKennzahlWert(r.typ, w.wert, r.einheit, sprache, t)}</span>
              {abw ? (
                // In der Tabelle kurz unter dem Wert (relative Abweichung), die Langform im Titel und für Screenreader; so passt die Tabelle in die Breite.
                <span className={`app-kz-abw app-kz-abw--${richtung}${stark ? " app-kz-abw--stark" : ""}`} title={formatAbweichung(r.typ, r.einheit, abw.absolut, abw.prozent, sprache, t)}>
                  <span aria-hidden="true">{richtung === "neg" ? "▼ " : richtung === "pos" ? "▲ " : "± "}</span>
                  <span className="cw-nur-lesen">{richtung === "neg" ? k.abweichungNeg : k.abweichungPos}: {formatAbweichung(r.typ, r.einheit, abw.absolut, abw.prozent, sprache, t)}</span>
                  <span aria-hidden="true">{formatAbweichungKurz(r.typ, r.einheit, abw.absolut, abw.prozent, sprache, t)}</span>
                </span>
              ) : null}
            </span>
          );
        },
      };
    }),
    ...(szenario === "ist"
      ? [
          {
            schluessel: "verdichtung",
            kopf: k.verdichtungSpalte,
            zahl: true,
            zelle: (r: Reihe) =>
              r.verdichtung ? (
                <span className="app-kz-zelle">
                  <span className="app-zahl">{formatKennzahlWert(r.typ, r.verdichtung.wert, r.einheit, sprache, t)}</span>
                  <span className="app-kz-einheit">{aufzaehlung(k.verdichtung, r.aggregation)}</span>
                </span>
              ) : (
                <span className="app-kz-kein">{k.kein}</span>
              ),
          } satisfies TabelleSpalte<Reihe>,
        ]
      : []),
  ];

  const offeneSpalten: TabelleSpalte<OffenerWert>[] = [
    { schluessel: "kennzahl", kopf: k.offen.spalten.kennzahl, zelle: (o) => (sprache === "de" ? o.bezeichnungDe : o.bezeichnungEn) },
    { schluessel: "zeitraum", kopf: k.offen.spalten.zeitraum, zelle: (o) => periodeKurz(o.periodeBeginn, o.periodeEnde) },
    { schluessel: "szenario", kopf: k.offen.spalten.szenario, zelle: (o) => aufzaehlung(k.szenario, o.szenario) },
    { schluessel: "wert", kopf: k.offen.spalten.wert, zahl: true, zelle: (o) => formatKennzahlWert(o.typ, o.wert, reihen.find((r) => r.schluessel === o.schluessel)?.einheit ?? "", sprache, t) },
    { schluessel: "quelle", kopf: k.offen.spalten.quelle, zelle: (o) => aufzaehlung(k.quelle, o.quelle) },
    { schluessel: "status", kopf: k.offen.spalten.status, zelle: (o) => <Status variante={o.status === "eingereicht" ? "pruefung" : "entwurf"}>{aufzaehlung(k.status, o.status)}</Status> },
    ...(schreiben
      ? [
          {
            schluessel: "aktion",
            kopf: k.offen.spalten.aktion,
            zelle: (o: OffenerWert) => {
              const name = `${sprache === "de" ? o.bezeichnungDe : o.bezeichnungEn}`;
              const z = periodeKurz(o.periodeBeginn, o.periodeEnde);
              return (
                <span className="app-zusammenhang">
                  <Button variante="sekundaer" aria-label={k.bestaetigenFuer(name, z)} disabled={bestaetigen.isPending || (o.quelle === "unternehmen" && o.status !== "eingereicht")} onClick={() => bestaetigen.mutate(o.id)}>
                    {k.bestaetigen}
                  </Button>
                  {o.quelle === "intern" ? (
                    <Button variante="ruhig" aria-label={k.aendernFuer(name, z)} onClick={() => setDialog({ bearbeiten: o })}>
                      {k.aendern}
                    </Button>
                  ) : null}
                  <Button variante="ruhig" aria-label={k.verwerfenFuer(name, z)} disabled={verwerfen.isPending} onClick={() => verwerfen.mutate(o.id)}>
                    {k.verwerfen}
                  </Button>
                </span>
              );
            },
          } satisfies TabelleSpalte<OffenerWert>,
        ]
      : []),
  ];

  return (
    <>
      <section className="app-karte" aria-labelledby="kennzahlen-titel">
        <div className="app-karte__kopf">
          <h2 id="kennzahlen-titel" className="cw-t-untertitel app-karte__titel">
            {k.titel}
          </h2>
          <div className="app-verlauf__steuerung">
            <Segment<Szenario> aria-label={k.szenarioWahl} value={szenario} onChange={setSzenario} options={SZENARIEN.map((s) => ({ wert: s, label: aufzaehlung(k.szenario, s) }))} />
            <Segment<Ansicht>
              aria-label={k.darstellung}
              value={ansicht}
              onChange={setAnsicht}
              options={[
                { wert: "tabelle", label: k.tabelle },
                { wert: "diagramme", label: k.diagramme },
              ]}
            />
            {schreiben ? <Button onClick={() => setDialog({})}>{k.erfassen}</Button> : null}
          </div>
        </div>
        <p className="app-leer-text">{k.einleitung}</p>
        {reihen.length === 0 ? (
          <p className="app-leer-text">{k.keine}</p>
        ) : ansicht === "tabelle" ? (
          <>
            <Tabelle beschriftung={`${k.titel}, ${aufzaehlung(k.szenario, szenario)}`} spalten={spalten} zeilen={reihen} zeilenSchluessel={(r) => r.schluessel} />
            {szenario === "ist" ? <p className="app-leer-text app-kz-hinweis">{k.abweichungHinweis(ABWEICHUNG_SCHWELLE)}</p> : null}
          </>
        ) : (
          <div className="app-kz-multiples">
            {reihen
              .filter((r) => ZAHLENTYPEN.has(r.typ) && r.punkte.length > 0)
              .map((r) => (
                <Diagramm key={r.schluessel} reihe={r} />
              ))}
            {reihen.every((r) => !ZAHLENTYPEN.has(r.typ) || r.punkte.length === 0) ? <p className="app-leer-text">{k.keineWerte}</p> : null}
          </div>
        )}
      </section>

      <section className="app-karte" aria-labelledby="kennzahlen-offen">
        <h2 id="kennzahlen-offen" className="cw-t-untertitel app-karte__titel">
          {k.offen.titel}
        </h2>
        {data.offen.length === 0 ? <p className="app-leer-text">{k.offen.keine}</p> : <Tabelle beschriftung={k.offen.beschriftung} spalten={offeneSpalten} zeilen={data.offen} zeilenSchluessel={(o) => o.id} />}
        {bestaetigen.error ? <FehlerHinweis fehler={bestaetigen.error} /> : null}
        {verwerfen.error ? <FehlerHinweis fehler={verwerfen.error} /> : null}
      </section>

      {dialog ? <WertDialog beteiligungId={beteiligungId} {...(dialog.bearbeiten ? { bearbeiten: dialog.bearbeiten } : {})} onSchliessen={() => setDialog(null)} /> : null}
    </>
  );
}

/** Kleines Diagramm je Kennzahl: Ist als durchgezogene Linie in der Textfarbe, Plan gestrichelt, Skalen je Diagramm eigen; Werte als Text unter dem Diagramm. */
function Diagramm({ reihe }: { reihe: Reihe }) {
  const t = useT();
  const sprache = useSprache();
  const k = t.kennzahlen;
  const punkte = reihe.punkte;
  const werte = punkte.flatMap((p) => [p.ist, p.plan].filter((w) => w !== null).map((w) => Number(w!.wert)));
  const kleinste = Math.min(...werte);
  const groesste = Math.max(...werte);
  const spanne = groesste - kleinste || 1;
  const B = 200;
  const H = 64;
  const x = (i: number) => (punkte.length === 1 ? B / 2 : 8 + (i * (B - 16)) / (punkte.length - 1));
  const y = (w: number) => H - 8 - ((w - kleinste) / spanne) * (H - 16);
  const linie = (feld: "ist" | "plan") =>
    punkte
      .map((p, i) => (p[feld] ? `${x(i).toFixed(1)},${y(Number(p[feld]!.wert)).toFixed(1)}` : null))
      .filter((s): s is string => s !== null)
      .join(" ");
  const erster = punkte[0]!;
  const letzter = punkte.at(-1)!;
  const name = kennzahlName(reihe, sprache);
  const alternative = k.diagrammAlternative(name, punkte.length, periodeKurz(erster.periodeBeginn, erster.periodeEnde), periodeKurz(letzter.periodeBeginn, letzter.periodeEnde));
  const letzterIst = [...punkte].reverse().find((p) => p.ist)?.ist;
  return (
    <figure className="app-kz-diagramm">
      <figcaption className="app-kz-diagramm__titel">{name}</figcaption>
      <svg viewBox={`0 0 ${B} ${H}`} role="img" aria-label={alternative} className="app-kz-svg" style={{ "--punkte": punkte.length } as CSSProperties}>
        <line x1="0" y1={H - 1} x2={B} y2={H - 1} className="app-kz-achse" />
        {linie("plan") ? <polyline points={linie("plan")} className="app-kz-linie app-kz-linie--plan" /> : null}
        {linie("ist") ? <polyline points={linie("ist")} className="app-kz-linie app-kz-linie--ist" /> : null}
        {punkte.map((p, i) => (p.ist ? <circle key={`${p.periodeBeginn}-${p.periodeEnde}`} cx={x(i)} cy={y(Number(p.ist.wert))} r="2.5" className="app-kz-punkt" /> : null))}
      </svg>
      <div className="app-kz-diagramm__fuss">
        <span>
          {periodeKurz(erster.periodeBeginn, erster.periodeEnde)} – {periodeKurz(letzter.periodeBeginn, letzter.periodeEnde)}
        </span>
        <span className="app-zahl">{letzterIst ? formatKennzahlWert(reihe.typ, letzterIst.wert, reihe.einheit, sprache, t) : k.kein}</span>
      </div>
      <div className="app-kz-legende" aria-hidden="true">
        <span className="app-kz-legende__ist">{k.istLinie}</span>
        <span className="app-kz-legende__plan">{k.planLinie}</span>
      </div>
    </figure>
  );
}

/** Erfassen eines neuen Wertes oder Ändern eines offenen Wertes eigener Eingabe. */
function WertDialog({ beteiligungId, bearbeiten, onSchliessen }: { beteiligungId: string; bearbeiten?: OffenerWert; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const k = t.kennzahlen;
  const { data: katalog } = useQuery(kennzahlKatalog());
  const anlegen = useWertAnlegen(beteiligungId);
  const aendern = useWertAendern();
  const q = aktuellesQuartal();
  const [schluessel, setSchluessel] = useState(bearbeiten?.schluessel ?? "");
  const [art, setArt] = useState<Periodenart>("quartal");
  const [jahr, setJahr] = useState(String(q.jahr));
  const [nummer, setNummer] = useState(String(q.nummer));
  const [szenario, setSzenario] = useState<Szenario>(bearbeiten?.szenario ?? "ist");
  const [wert, setWert] = useState(bearbeiten ? wertFuerFeld(bearbeiten.typ, bearbeiten.wert, sprache) : "");
  const [kommentar, setKommentar] = useState(bearbeiten?.kommentar ?? "");
  const [meldung, setMeldung] = useState<string | null>(null);
  const definition = katalog?.find((d) => d.schluessel === (bearbeiten?.schluessel ?? schluessel));
  const typ = (definition?.typ ?? bearbeiten?.typ ?? "betrag") as "betrag" | "zahl" | "prozent" | "ja_nein" | "text";
  const fehler = bearbeiten ? aendern.error : anlegen.error;

  function senden() {
    setMeldung(null);
    const g = parseWert(typ, wert, sprache);
    if ("fehler" in g) return setMeldung(k.wertHilfe[typ] ?? "");
    if (bearbeiten) {
      aendern.mutate({ id: bearbeiten.id, json: { wert: g.wert, kommentar: kommentar.trim() === "" ? null : kommentar.trim() } }, { onSuccess: onSchliessen });
      return;
    }
    if (!definition) return setMeldung(k.felder.kennzahl);
    const z = zeitraum(art, Number(jahr), Number(nummer));
    anlegen.mutate(
      { schluessel: definition.schluessel, periodeBeginn: z.beginn, periodeEnde: z.ende, szenario, wert: g.wert, ...(kommentar.trim() ? { kommentar: kommentar.trim() } : {}) },
      { onSuccess: onSchliessen },
    );
  }

  return (
    <Seitenpanel titel={bearbeiten ? k.aendernTitel : k.erfassenTitel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{bearbeiten ? k.aendernTitel : k.erfassenTitel}</h2>
      {bearbeiten ? null : <Hinweis>{k.korrekturHinweis}</Hinweis>}
      <form
        className="app-formular"
        onSubmit={(e) => {
          e.preventDefault();
          senden();
        }}
      >
        {bearbeiten ? (
          <p>
            <strong>{sprache === "de" ? bearbeiten.bezeichnungDe : bearbeiten.bezeichnungEn}</strong> · {periodeKurz(bearbeiten.periodeBeginn, bearbeiten.periodeEnde)} · {aufzaehlung(k.szenario, bearbeiten.szenario)}
          </p>
        ) : (
          <>
            <Auswahl label={k.felder.kennzahl} value={schluessel} onChange={(e) => setSchluessel(e.target.value)} required>
              <option value="">–</option>
              {(katalog ?? []).map((d) => (
                <option key={d.schluessel} value={d.schluessel}>
                  {kennzahlName(d, sprache)}
                </option>
              ))}
            </Auswahl>
            <Auswahl label={k.felder.zeitraumArt} value={art} onChange={(e) => setArt(e.target.value as Periodenart)}>
              {(["monat", "quartal", "jahr"] as const).map((a) => (
                <option key={a} value={a}>
                  {aufzaehlung(k.zeitraumArt, a)}
                </option>
              ))}
            </Auswahl>
            <Feld label={k.felder.jahr} type="number" min={2000} max={2100} value={jahr} onChange={(e) => setJahr(e.target.value)} required />
            {art === "jahr" ? null : (
              <Auswahl label={k.felder.nummer} value={nummer} onChange={(e) => setNummer(e.target.value)}>
                {Array.from({ length: art === "monat" ? 12 : 4 }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    {art === "monat" ? k.nummerMonat(i + 1) : k.nummerQuartal(i + 1)}
                  </option>
                ))}
              </Auswahl>
            )}
            <Auswahl label={k.felder.szenario} value={szenario} onChange={(e) => setSzenario(e.target.value as Szenario)}>
              {SZENARIEN.map((s) => (
                <option key={s} value={s}>
                  {aufzaehlung(k.szenario, s)}
                </option>
              ))}
            </Auswahl>
          </>
        )}
        {typ === "ja_nein" ? (
          <Auswahl label={k.felder.wert} value={wert} onChange={(e) => setWert(e.target.value)} required>
            <option value="">–</option>
            <option value="ja">{k.jaNein.ja}</option>
            <option value="nein">{k.jaNein.nein}</option>
          </Auswahl>
        ) : (
          <Feld label={k.felder.wert} value={wert} onChange={(e) => setWert(e.target.value)} inputMode={typ === "text" ? "text" : "decimal"} hilfe={k.wertHilfe[typ]} fehler={meldung ?? undefined} required />
        )}
        <Textbereich label={k.felder.kommentar} value={kommentar} onChange={(e) => setKommentar(e.target.value)} maxLength={1000} />
        {fehler ? <FehlerHinweis fehler={fehler} /> : null}
        <Button type="submit" disabled={anlegen.isPending || aendern.isPending}>
          {k.speichern}
        </Button>
      </form>
    </Seitenpanel>
  );
}

