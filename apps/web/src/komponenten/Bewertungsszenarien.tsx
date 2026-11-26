import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Feld, Hinweis, Seitenpanel, Status, Tabelle, formatBetrag, formatDatum, formatMultiple, formatProzent, type TabelleSpalte } from "@carraway/ui";
import { szenarioBerichtUrl, szenarioDetail, szenarioVorlage, useSzenarioAendern, type SzenarioDetail, type SzenarioKopf } from "../api/szenarien";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { bruchZuProzent, prozentZuBruch } from "../lib/szenario";
import { FehlerHinweis } from "./FehlerHinweis";
import { BetragFeld } from "./BetragFeld";
import { useZeilenpruefung } from "./formular";
import { betragRegel, pflichtRegel, prozentRegel, zahlNormalisiert } from "../lib/feldpruefung";

const schluesselRegel = pflichtRegel();

type Ergebnis = NonNullable<SzenarioDetail["ergebnis"]["bewertungsszenario"]>;
type Annahmen = NonNullable<SzenarioDetail["annahmen"]["bewertung"]>;
type BeteiligungErgebnis = Ergebnis["beteiligungen"][number];

/**
 * Bewertungsszenarien je Beteiligung (Etappe 21) im Bereich Szenarien: Fälle mit Wahrscheinlichkeit und Methode, Erwartungswert und Wirkung auf den Fonds.
 * Gerechnet wird auf dem Server (Rechenkern); hier stehen Auswahl, Anzeige und der Editor der Fälle. Festgeschriebene Szenarien sind schreibgeschützt.
 */
export function Bewertungsszenarien({ fondsId, liste, schreiben }: { fondsId: string; liste: SzenarioKopf[]; schreiben: boolean }) {
  const t = useT();
  const z = t.szenarien.bewertung;
  const sprache = useSprache();
  const [gewaehlt, setGewaehlt] = useState<string>(liste[0]?.id ?? "");
  const id = liste.some((s) => s.id === gewaehlt) ? gewaehlt : (liste[0]?.id ?? "");
  const { data: detail, error } = useQuery({ ...szenarioDetail(id), enabled: id !== "" });
  const { data: vorlage } = useQuery(szenarioVorlage(fondsId));
  const [bearbeitet, setBearbeitet] = useState<string | null>(null);
  if (liste.length === 0) return <p className="app-leer-text">{z.keinSzenario}</p>;
  const b = detail?.ergebnis.bewertungsszenario;
  const entwurf = detail?.status === "entwurf";
  const darfAendern = schreiben && entwurf;
  const betrag = (w: string | null) => (w === null ? <span className="app-luecke" title={z.lueckeTitel}>{z.luecke}</span> : formatBetrag(w, sprache));
  const fallName = (f: { schluessel: string; name: string | null }) => f.name ?? (z.standardFaelle[f.schluessel] ?? f.schluessel);

  type Zeile = { id: string; name: string; aktuell: string; erg: BeteiligungErgebnis | null };
  const zeilen: Zeile[] = (vorlage?.beteiligungen ?? []).map((v) => ({ id: v.id, name: v.organisation, aktuell: v.wert ?? "0", erg: b?.beteiligungen.find((x) => x.id === v.id) ?? null }));
  const spalten: TabelleSpalte<Zeile>[] = [
    { schluessel: "name", kopf: z.spalten.unternehmen, zelle: (r) => r.name },
    { schluessel: "aktuell", kopf: z.spalten.aktuell, zahl: true, zelle: (r) => formatBetrag(r.aktuell, sprache) },
    {
      schluessel: "faelle",
      kopf: z.spalten.faelle,
      zelle: (r) =>
        r.erg ? (
          <ul className="app-liste-klein">
            {r.erg.faelle.map((f) => (
              <li key={f.schluessel}>
                {fallName(f)} ({formatProzent(Number(f.gewicht) * 100, sprache, 0)}): {betrag(f.wert)} · {z.methoden[f.methode] ?? f.methode}
                {f.eingaben.kennzahlWaehrung ? ` · ${z.kennzahlWaehrung(f.eingaben.kennzahlWaehrung, f.eingaben.kurs ?? "", f.eingaben.kursDatum ? formatDatum(f.eingaben.kursDatum, sprache) : "")}` : null}
                {f.eingaben.anteilBasis ? ` · ${z.anteilBasis[f.eingaben.anteilBasis] ?? f.eingaben.anteilBasis}` : null}
              </li>
            ))}
          </ul>
        ) : (
          t.gemeinsam.keinWert
        ),
    },
    { schluessel: "erwartet", kopf: z.spalten.erwartet, zahl: true, zelle: (r) => (r.erg ? betrag(r.erg.erwartet) : t.gemeinsam.keinWert) },
    {
      // Erlös des Fonds aus dem Exit-Wasserfall je Fall (nur Fälle mit Unternehmenswert); ältere Szenarien haben die Angabe nicht.
      schluessel: "wasserfall",
      kopf: z.spalten.wasserfall,
      zelle: (r) =>
        r.erg && r.erg.faelle.some((f) => f.exit) ? (
          <ul className="app-liste-klein">
            {r.erg.faelle.map((f) => (
              <li key={f.schluessel}>
                {fallName(f)}: {!f.exit ? t.gemeinsam.keinWert : f.exit.erloesFonds === null ? z.ohneTabelle : formatBetrag(f.exit.erloesFonds, sprache)}
              </li>
            ))}
          </ul>
        ) : (
          t.gemeinsam.keinWert
        ),
    },
    { schluessel: "abweichung", kopf: z.spalten.abweichung, zahl: true, zelle: (r) => (r.erg?.abweichung ? formatBetrag(r.erg.abweichung, sprache) : t.gemeinsam.keinWert) },
    {
      schluessel: "aktion",
      kopf: <span className="cw-nur-lesen">{z.spalten.aktion}</span>,
      zelle: (r) =>
        darfAendern ? (
          <Button variante="sekundaer" aria-label={r.erg ? z.bearbeitenFuer(r.name) : z.erfassenFuer(r.name)} onClick={() => setBearbeitet(r.id)}>
            {r.erg ? z.bearbeiten : z.erfassen}
          </Button>
        ) : (
          t.gemeinsam.keinWert
        ),
    },
  ];

  type Wirkung = { name: string; w: Ergebnis["aktuell"] };
  const wirkung: Wirkung[] = b ? [{ name: z.aktuellZeile, w: b.aktuell }, ...b.faelle.map((f) => ({ name: fallName(f), w: f })), { name: z.erwartetZeile, w: b.erwartet }] : [];
  const wSpalten: TabelleSpalte<Wirkung>[] = [
    { schluessel: "fall", kopf: z.spalten.fall, zelle: (r) => r.name },
    { schluessel: "nav", kopf: z.spalten.nav, zahl: true, zelle: (r) => betrag(r.w.nav) },
    { schluessel: "tvpi", kopf: z.spalten.tvpi, zahl: true, zelle: (r) => (r.w.tvpi === null ? t.gemeinsam.keinWert : formatMultiple(r.w.tvpi, sprache)) },
    { schluessel: "dpi", kopf: z.spalten.dpi, zahl: true, zelle: (r) => (r.w.dpi === null ? t.gemeinsam.keinWert : formatMultiple(r.w.dpi, sprache)) },
    { schluessel: "carry", kopf: z.spalten.carry, zahl: true, zelle: (r) => (r.w.carry === null ? t.gemeinsam.keinWert : formatBetrag(r.w.carry, sprache)) },
    { schluessel: "netto", kopf: z.spalten.navNetto, zahl: true, zelle: (r) => (r.w.navNetto === null ? t.gemeinsam.keinWert : formatBetrag(r.w.navNetto, sprache)) },
  ];
  const befundText = (code: string, name: string, p: Record<string, string | number>) => {
    const f = t.szenarien.vergleich.befunde.codes[code];
    return f ? f(name, p) : code;
  };

  return (
    <section className="app-karte" aria-label={z.titel}>
      <p className="app-leer-text">{z.beschreibung}</p>
      <div className="app-aktionen__knoepfe">
        <Auswahl kompakt label={z.szenarioWaehlen} value={id} onChange={(e) => setGewaehlt(e.target.value)}>
          {liste.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {aufzaehlung(t.szenarien.status, s.status)}
            </option>
          ))}
        </Auswahl>
        {detail ? <Status variante={entwurf ? "pruefung" : "freigegeben"}>{aufzaehlung(t.szenarien.status, detail.status)}</Status> : null}
        {id && b
          ? (["pdf", "xlsx"] as const).map((format) => (
              <a key={format} className="cw-button cw-button--sekundaer" href={szenarioBerichtUrl(id, format, sprache)} download>
                {format === "pdf" ? z.berichtPdf : z.berichtExcel}
              </a>
            ))
          : null}
      </div>
      {error ? <FehlerHinweis fehler={error} /> : null}
      {detail ? <Hinweis>{entwurf ? z.entwurfHinweis : z.festHinweis(detail.ergebnisHash ?? "")}</Hinweis> : null}
      {detail && !b ? <p className="app-leer-text">{z.keineFaelle}</p> : null}
      {b && b.beteiligungen.some((x) => x.faelle.some((f) => f.exit)) ? <p className="app-leer-text">{z.wasserfallHinweis}</p> : null}
      {vorlage && vorlage.beteiligungen.length > 0 ? <Tabelle dicht beschriftung={z.beteiligungenTabelle} spalten={spalten} zeilen={zeilen} zeilenSchluessel={(r) => r.id} /> : null}
      {b ? (
        <>
          <Tabelle dicht beschriftung={z.wirkungTabelle} spalten={wSpalten} zeilen={wirkung} zeilenSchluessel={(r) => r.name} />
          <p className="app-leer-text">{z.carryHinweis}</p>
          <h3 className="app-gruppen-titel">{z.befunde}</h3>
          {b.befunde.length === 0 ? (
            <p className="app-leer-text">{z.keineBefunde}</p>
          ) : (
            <ul className="app-liste-klein">
              {b.befunde.map((x, i) => (
                <li key={i}>{befundText(x.code, b.beteiligungen.find((y) => y.id === x.beteiligungId)?.name ?? "", (x.params ?? {}) as Record<string, string | number>)}</li>
              ))}
            </ul>
          )}
        </>
      ) : null}
      {bearbeitet && detail ? <FallEditor fondsId={fondsId} detail={detail} beteiligungId={bearbeitet} name={zeilen.find((r) => r.id === bearbeitet)?.name ?? ""} onSchliessen={() => setBearbeitet(null)} /> : null}
    </section>
  );
}

interface FallForm {
  schluessel: string;
  name: string;
  prozent: string;
  art: "multiple" | "letzte_runde" | "wert";
  kennzahl: string;
  multiple: string;
  abzug: string;
  anteil: string;
  abschlag: string;
  betrag: string;
}

const leererFall = (schluessel = "", prozent = ""): FallForm => ({ schluessel, name: "", prozent, art: "wert", kennzahl: "umsatz", multiple: "", abzug: "", anteil: "", abschlag: "", betrag: "" });

function formAus(f: Annahmen["beteiligungen"][string]["faelle"][number]): FallForm {
  const x = leererFall(f.schluessel, bruchZuProzent(f.gewicht));
  x.name = f.name ?? "";
  x.art = f.methode.art;
  if (f.methode.art === "multiple") Object.assign(x, { kennzahl: f.methode.kennzahl, multiple: f.methode.multiple, abzug: f.methode.abzug === "0" ? "" : f.methode.abzug, anteil: f.methode.anteil ? bruchZuProzent(f.methode.anteil) : "" });
  if (f.methode.art === "letzte_runde") x.abschlag = f.methode.abschlag === "0" ? "" : bruchZuProzent(f.methode.abschlag);
  if (f.methode.art === "wert") x.betrag = f.methode.betrag;
  return x;
}

/** Summe der Prozentangaben als Text (Dezimalstellen exakt, ohne Gleitkomma): in Hundertstel-Prozent gerechnet. */
function summeProzent(faelle: FallForm[]): string {
  let hundertstel = 0;
  for (const f of faelle) {
    const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(f.prozent.trim());
    if (!m) continue;
    hundertstel += Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  }
  return `${Math.floor(hundertstel / 100)}${hundertstel % 100 === 0 ? "" : `,${String(hundertstel % 100).padStart(2, "0").replace(/0$/, "")}`}`;
}

function FallEditor({ fondsId, detail, beteiligungId, name, onSchliessen }: { fondsId: string; detail: SzenarioDetail; beteiligungId: string; name: string; onSchliessen: () => void }) {
  const t = useT();
  const z = t.szenarien.bewertung;
  const e = z.editor;
  const aendern = useSzenarioAendern(fondsId, detail.id);
  const bisher = detail.annahmen.bewertung?.beteiligungen[beteiligungId]?.faelle;
  const [faelle, setFaelle] = useState<FallForm[]>(() => (bisher ? bisher.map(formAus) : [leererFall("base", "50"), leererFall("bear", "25"), leererFall("bull", "25")]));
  const setze = (i: number, teil: Partial<FallForm>) => setFaelle((alt) => alt.map((f, j) => (j === i ? { ...f, ...teil } : f)));
  const sprache = useSprache();
  const { pruefe, pruefeAlle } = useZeilenpruefung();
  const summe = summeProzent(faelle);
  const ok = summe === "100" && faelle.length >= 2;

  function speichern(ev: React.FormEvent) {
    ev.preventDefault();
    if (!pruefeAlle()) return;
    const bruch = (p: string) => prozentZuBruch(p) ?? undefined;
    const neu = faelle.map((f) => ({
      schluessel: f.schluessel.trim(),
      ...(f.name.trim() ? { name: f.name.trim() } : {}),
      gewicht: bruch(f.prozent) ?? "0",
      methode:
        f.art === "wert"
          ? { art: "wert" as const, betrag: zahlNormalisiert(f.betrag, sprache) ?? f.betrag.trim() }
          : f.art === "letzte_runde"
            ? { art: "letzte_runde" as const, abschlag: f.abschlag.trim() ? (bruch(f.abschlag) ?? "0") : "0" }
            : { art: "multiple" as const, kennzahl: f.kennzahl.trim(), multiple: zahlNormalisiert(f.multiple, sprache) ?? f.multiple.trim(), abzug: f.abzug.trim() ? (zahlNormalisiert(f.abzug, sprache) ?? f.abzug.trim()) : "0", ...(f.anteil.trim() ? { anteil: bruch(f.anteil) } : {}) },
    }));
    const alle = { ...(detail.annahmen.bewertung?.beteiligungen ?? {}), [beteiligungId]: { faelle: neu } };
    aendern.mutate({ annahmen: { ...detail.annahmen, bewertung: { beteiligungen: alle } } as never }, { onSuccess: onSchliessen });
  }
  function entfernen() {
    const rest = { ...(detail.annahmen.bewertung?.beteiligungen ?? {}) };
    delete rest[beteiligungId];
    const { bewertung: _alt, ...ohne } = detail.annahmen;
    aendern.mutate({ annahmen: { ...ohne, ...(Object.keys(rest).length ? { bewertung: { beteiligungen: rest } } : {}) } as never }, { onSuccess: onSchliessen });
  }

  return (
    <Seitenpanel titel={z.bearbeitenFuer(name)} onSchliessen={onSchliessen} breit>
      <h2 className="cw-t-untertitel">{z.bearbeitenFuer(name)}</h2>
      <p className="app-leer-text">{e.beschreibung}</p>
      <form className="app-formular" noValidate onSubmit={speichern}>
        <FehlerHinweis fehler={aendern.error} />
        {faelle.map((f, i) => (
          <fieldset key={i} className="app-gruppe">
            <legend className="cw-t-beschriftung">{e.fall(i + 1)}</legend>
            <Feld label={e.schluessel} value={f.schluessel} onChange={(ev) => setze(i, { schluessel: ev.target.value })} maxLength={20} autoComplete="off" {...pruefe(`schluessel-${i}`, schluesselRegel, f.schluessel)} />
            <Feld label={e.name} value={f.name} onChange={(ev) => setze(i, { name: ev.target.value })} maxLength={60} autoComplete="off" />
            <BetragFeld label={e.wahrscheinlichkeit} value={f.prozent} onChange={(ev) => setze(i, { prozent: ev.target.value })} {...pruefe(`prozent-${i}`, prozentRegel({ pflicht: true }), f.prozent)} />
            <Auswahl label={e.methode} value={f.art} onChange={(ev) => setze(i, { art: ev.target.value as FallForm["art"] })}>
              {(["wert", "letzte_runde", "multiple"] as const).map((m) => (
                <option key={m} value={m}>
                  {z.methoden[m]}
                </option>
              ))}
            </Auswahl>
            {f.art === "wert" ? <BetragFeld label={e.betrag} value={f.betrag} onChange={(ev) => setze(i, { betrag: ev.target.value })} {...pruefe(`betrag-${i}`, betragRegel({ pflicht: true }), f.betrag)} /> : null}
            {f.art === "letzte_runde" ? <BetragFeld label={e.abschlag} hilfe={e.abschlagHilfe} value={f.abschlag} onChange={(ev) => setze(i, { abschlag: ev.target.value })} {...pruefe(`abschlag-${i}`, prozentRegel({ min: -100, max: 99.9999 }), f.abschlag)} /> : null}
            {f.art === "multiple" ? (
              <>
                <Feld label={e.kennzahl} hilfe={e.kennzahlHilfe} value={f.kennzahl} onChange={(ev) => setze(i, { kennzahl: ev.target.value })} autoComplete="off" {...pruefe(`kennzahl-${i}`, pflichtRegel(), f.kennzahl)} />
                <BetragFeld label={e.multiple} value={f.multiple} onChange={(ev) => setze(i, { multiple: ev.target.value })} {...pruefe(`multiple-${i}`, betragRegel({ nachkomma: 4, ganzstellen: 4, pflicht: true }), f.multiple)} />
                <BetragFeld label={e.abzug} value={f.abzug} onChange={(ev) => setze(i, { abzug: ev.target.value })} {...pruefe(`abzug-${i}`, betragRegel(), f.abzug)} />
                <BetragFeld label={e.anteil} hilfe={e.anteilHilfe} value={f.anteil} onChange={(ev) => setze(i, { anteil: ev.target.value })} {...pruefe(`anteil-${i}`, prozentRegel(), f.anteil)} />
              </>
            ) : null}
            {faelle.length > 2 ? (
              <Button variante="ruhig" aria-label={e.fallEntfernen(i + 1)} onClick={() => setFaelle((alt) => alt.filter((_, j) => j !== i))}>
                {e.fallEntfernen(i + 1)}
              </Button>
            ) : null}
          </fieldset>
        ))}
        <p role="status" className={ok ? "app-leer-text" : "app-luecke"}>
          {e.summe(summe)} · {ok ? e.summeOk : e.summeFalsch}
        </p>
        <div className="app-aktionen__knoepfe">
          <Button variante="sekundaer" disabled={faelle.length >= 6} onClick={() => setFaelle((alt) => [...alt, leererFall()])}>
            {e.fallHinzufuegen}
          </Button>
          <Button variante="sekundaer" onClick={() => setFaelle([leererFall("base", "50"), leererFall("bear", "25"), leererFall("bull", "25")])}>
            {e.vorbelegen}
          </Button>
        </div>
        <div className="app-fed__fuss">
          <Button type="submit" disabled={!ok || aendern.isPending}>
            {e.speichern}
          </Button>
          {bisher ? (
            <Button variante="ruhig" disabled={aendern.isPending} onClick={entfernen}>
              {e.entfernen}
            </Button>
          ) : null}
        </div>
      </form>
    </Seitenpanel>
  );
}
