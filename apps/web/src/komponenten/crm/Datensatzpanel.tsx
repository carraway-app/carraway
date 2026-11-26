import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Feld as Eingabe, PencilSimpleIcon, Segment, Status, Textbereich, XIcon, formatDatum } from "@carraway/ui";
import { crmAufgaben, crmDatensatz, crmVerknuepfungen, useAufgabeAendern, useAufgabeAnlegen, useAufgabeErledigen, useDatensatzAendern, type Aufgabe, type Feld, type Objekt } from "../../api/crm";
import { FehlerHinweis } from "../FehlerHinweis";
import { useSprache, useT } from "../../i18n";
import { useRechte } from "../../lib/rechte";
import { BenutzerSuche, DatensatzSuche } from "./Sucheingabe";
import { Datensatzlink } from "./Datensatzlink";
import { ZustaendigWahl } from "./ZustaendigWahl";
import { Anzeige, Editor, Schnellaktionen, istInlineBearbeitbar, wertAusEingabe } from "./Zelle";
import { NAMENSFELD, feldName, schnellWerte } from "./typen";

/** Heute als `JJJJ-MM-TT` (Ortszeit des Browsers) für die Markierung überfälliger Aufgaben. */
const heuteIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Attribute eines Datensatzes als Seitenleiste neben den Reitern: alle Felder (System- und eigene) mit Beschriftung und Wert, jedes Feld
 * einzeln bearbeitbar, oben Mail, Telefon, LinkedIn und Website als Schnellaktionen.
 */
export function Datensatzpanel({ objekt, id, darfSchreiben, titel }: { objekt: Objekt; id: string; darfSchreiben: boolean; titel: string }) {
  const t = useT();
  const abfrage = useQuery(crmDatensatz(objekt, id));
  const aendern = useDatensatzAendern(objekt);
  const [bearbeitet, setBearbeitet] = useState<string | null>(null);
  if (abfrage.isPending) return <aside className="app-attribute" aria-busy="true" aria-label={t.crm.attribute}><div className="app-skelett app-skelett--zeile" /></aside>;
  if (abfrage.isError) return <aside className="app-attribute" aria-label={t.crm.attribute}><FehlerHinweis fehler={abfrage.error} /></aside>;
  const { werte, felder, bezuege } = abfrage.data;
  const sichtbar = felder.filter((f) => !(f.system && f.schluessel === NAMENSFELD[objekt]) && f.schluessel !== "kontakte");

  const schreibe = (f: Feld, wert: unknown) =>
    aendern.mutateAsync({ id, ...(f.system ? { system: { [f.schluessel]: wert } } : { eigene: { [f.schluessel]: wert } }) }).then(
      () => setBearbeitet(null),
      () => undefined,
    );

  return (
    <aside className="app-attribute" aria-label={t.crm.attribute}>
      <div className="app-attribute__kopf">
        <h2 className="cw-t-untertitel">{t.crm.attribute}</h2>
        <Schnellaktionen werte={schnellWerte(objekt, werte)} name={titel} />
      </div>
      <FehlerHinweis fehler={aendern.error} />
      <dl className="app-attribute__liste">
        {sichtbar.map((f) => {
          const name = feldName(f, t);
          const bearbeitbar = darfSchreiben && f.schreibbar && (istInlineBearbeitbar(f) || f.typ === "langtext" || f.typ === "verknuepfung" || f.typ === "benutzer");
          const wert = werte[f.schluessel];
          const imEditor = bearbeitet === f.schluessel;
          return (
            <div key={f.schluessel} className="app-attribute__zeile">
              <dt>{name}</dt>
              <dd>
                {imEditor ? (
                  f.typ === "langtext" ? (
                    <LangtextEditor wert={typeof wert === "string" ? wert : ""} beschriftung={name} onFertig={(neu) => (neu === undefined ? setBearbeitet(null) : void schreibe(f, neu))} />
                  ) : f.typ === "verknuepfung" ? (
                    <div className="app-gruppe">
                      <DatensatzSuche ziel={f.ziel ?? "organisation"} onWaehlen={(x) => void schreibe(f, x.id)} onAbbrechen={() => setBearbeitet(null)} />
                      <Button variante="ruhig" onClick={() => setBearbeitet(null)}>
                        {t.crm.abbrechen}
                      </Button>
                    </div>
                  ) : f.typ === "benutzer" ? (
                    <div className="app-gruppe">
                      <BenutzerSuche onWaehlen={(x) => void schreibe(f, x.id)} onAbbrechen={() => setBearbeitet(null)} />
                      <Button variante="ruhig" onClick={() => setBearbeitet(null)}>
                        {t.crm.abbrechen}
                      </Button>
                    </div>
                  ) : (
                    <Editor feld={f} wert={wert} t={t} beschriftung={name} onFertig={(neu) => (neu === undefined ? setBearbeitet(null) : void schreibe(f, neu))} />
                  )
                ) : (
                  <span className="app-attribute__wert">
                    <Anzeige objekt={objekt} feld={f} wert={wert} zeileId={id} bezuege={bezuege} />
                    {bearbeitbar ? (
                      <button
                        type="button"
                        className="app-attribute__bearbeiten"
                        aria-label={t.crm.feldBearbeiten(name)}
                        onClick={() => {
                          if (f.typ === "kontrollkaestchen") void schreibe(f, wert === true ? false : true);
                          else setBearbeitet(f.schluessel);
                        }}
                      >
                        <PencilSimpleIcon />
                      </button>
                    ) : null}
                    {bearbeitbar && wert !== null && wert !== undefined && wert !== "" && (f.typ === "verknuepfung" || f.typ === "benutzer") ? (
                      <button type="button" className="app-attribute__bearbeiten" aria-label={t.crm.wertLoeschenFuer(name)} onClick={() => void schreibe(f, null)}>
                        <XIcon />
                      </button>
                    ) : null}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </aside>
  );
}

function LangtextEditor({ wert, beschriftung, onFertig }: { wert: string; beschriftung: string; onFertig: (neu: string | null | undefined) => void }) {
  const t = useT();
  const [text, setText] = useState(wert);
  return (
    <div className="app-gruppe">
      <Textbereich label={beschriftung} value={text} rows={4} onChange={(e) => setText(e.target.value)} />
      <div className="app-fed__fuss">
        <Button onClick={() => onFertig(wertAusEingabe({ typ: "langtext" } as Feld, text) as string | null)}>{t.crm.speichern}</Button>
        <Button variante="sekundaer" onClick={() => onFertig(undefined)}>
          {t.crm.abbrechen}
        </Button>
      </div>
    </div>
  );
}

/** „Verknüpft mit“: Datensätze, die auf diesen verweisen (Verknüpfungsfelder, Erwähnungen in Notizen), und die, auf die er verweist. */
export function VerknuepftAbschnitt({ objekt, id }: { objekt: Objekt; id: string }) {
  const t = useT();
  const abfrage = useQuery(crmVerknuepfungen(objekt, id));
  if (abfrage.isPending) return <div className="app-skelett app-skelett--zeile" aria-hidden="true" />;
  if (abfrage.isError) return <FehlerHinweis fehler={abfrage.error} />;
  const { eingehend, ausgehend } = abfrage.data;
  const liste = (zeilen: typeof eingehend, titel: string) => (
    <section className="app-karte" aria-label={titel}>
      <h3 className="cw-t-untertitel app-karte__titel">{titel}</h3>
      {zeilen.length === 0 ? (
        <p className="app-leer-text">{t.crm.keineVerknuepfungen}</p>
      ) : (
        <ul className="app-verknuepfungen">
          {zeilen.map((v) => (
            <li key={`${v.typ}:${v.id}:${v.art}:${v.quelleId}`}>
              <Datensatzlink objekt={v.typ} id={v.id}>{v.name}</Datensatzlink>
              <span className="app-dubletten__info">
                {t.crm.objekte[v.typ]} · {v.art === "erwaehnung" ? t.crm.artErwaehnung : t.crm.artFeld}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <>
      {liste(eingehend, t.crm.verknuepftEingehend)}
      {liste(ausgehend, t.crm.verknuepftAusgehend)}
    </>
  );
}

export interface Bezug {
  organisationId?: string;
  personId?: string;
  dealId?: string;
}

/** Aufgabenfilter „Meine“ oder „Alle“ (alle, die die Person sehen darf). */
function AufgabenFilterWahl({ wert, onChange }: { wert: "ich" | "alle"; onChange: (w: "ich" | "alle") => void }) {
  const t = useT();
  return (
    <Segment<"ich" | "alle">
      aria-label={t.crm.aufgabenFilter}
      value={wert}
      onChange={onChange}
      options={[
        { wert: "ich", label: t.crm.aufgabenMeine },
        { wert: "alle", label: t.crm.aufgabenAlle },
      ]}
    />
  );
}

/** Eine Aufgabenzeile: Kontrollkästchen, Titel, Fälligkeit, Zuständigkeit (mit Wahl, wenn die Person schreiben darf), Bezug. */
function AufgabeZeile({ a, schreiben, heute, mitBezug }: { a: Aufgabe; schreiben: boolean; heute: string; mitBezug: boolean }) {
  const t = useT();
  const sprache = useSprache();
  const { ich } = useRechte();
  const erledigen = useAufgabeErledigen();
  const aendern = useAufgabeAendern();
  const erledigt = a.erledigtAm !== null;
  const ueberfaellig = !erledigt && a.faellig !== null && a.faellig < heute;
  const name = a.zustaendigName ?? (a.zustaendigId && a.zustaendigId === ich?.id ? t.crm.ich : null);
  return (
    <li data-erledigt={erledigt || undefined}>
      <label>
        <input type="checkbox" checked={erledigt} disabled={!schreiben || erledigen.isPending} aria-label={t.crm.aufgabeErledigt(a.titel)} onChange={(e) => erledigen.mutate({ id: a.id, erledigt: e.target.checked })} />
        <span className="app-aufgaben__titel">{a.titel}</span>
      </label>
      <span className="app-dubletten__info">{a.faellig ? formatDatum(a.faellig, sprache) : t.crm.ohneFaelligkeit}</span>
      {schreiben ? (
        <ZustaendigWahl
          name={name}
          beschriftung={t.crm.zustaendigAendern(name ?? t.crm.nichtZugewiesen, a.titel)}
          dealId={a.deal?.id}
          onWaehlen={(wer) => aendern.mutate({ id: a.id, zustaendigId: wer?.id ?? null })}
        />
      ) : (
        <span className="app-dubletten__info">{name ?? t.crm.nichtZugewiesen}</span>
      )}
      {mitBezug && a.organisation ? <Datensatzlink objekt="organisation" id={a.organisation.id}>{a.organisation.name}</Datensatzlink> : null}
      {mitBezug && a.person ? <Datensatzlink objekt="person" id={a.person.id}>{`${a.person.vorname} ${a.person.nachname}`}</Datensatzlink> : null}
      {mitBezug && a.deal ? <Datensatzlink objekt="deal" id={a.deal.id}>{a.deal.titel}</Datensatzlink> : null}
      {ueberfaellig ? <Status variante="fehlt">{t.crm.ueberfaellig}</Status> : null}
      {aendern.error ? <FehlerHinweis fehler={aendern.error} /> : null}
    </li>
  );
}

/** Offene Aufgaben quer über alle Datensätze (Reiter „Heute“), Standard „Meine“, wahlweise „Alle“, mit Links zum Bezug. */
export function AufgabenListe({ zustaendig: start = "ich" }: { zustaendig?: "ich" | "alle" }) {
  const t = useT();
  const [zustaendig, setZustaendig] = useState<"ich" | "alle">(start);
  const offen = useQuery(crmAufgaben({ zustaendig, status: "offen" }));
  const { darf } = useRechte();
  const heute = heuteIso();
  const zeilen = offen.data ?? [];
  return (
    <section className="app-karte" aria-label={t.crm.meineAufgaben}>
      <div className="app-karte__kopf">
        <h2 className="cw-t-untertitel app-karte__titel">{t.crm.meineAufgaben}</h2>
        <AufgabenFilterWahl wert={zustaendig} onChange={setZustaendig} />
      </div>
      <FehlerHinweis fehler={offen.error} />
      {offen.data && zeilen.length === 0 ? <p className="app-leer-text">{zustaendig === "ich" ? t.crm.keineMeinenAufgaben : t.crm.keineAufgaben}</p> : null}
      <ul className="app-aufgaben">
        {zeilen.map((a) => (
          <AufgabeZeile key={a.id} a={a} schreiben={darf("bearbeiter")} heute={heute} mitBezug />
        ))}
      </ul>
    </section>
  );
}

/** Aufgaben an einem Datensatz: offene zuerst, erledigen per Kontrollkästchen, neue mit Fälligkeit und Zuständigkeit (Auswahl jeder Person mit Zugriff), Filter „Meine“ und „Alle“. */
export function AufgabenAbschnitt({ bezug, fondsId }: { bezug: Bezug; fondsId?: string | null }) {
  const t = useT();
  const { darf, ich } = useRechte();
  const [zustaendigFilter, setZustaendigFilter] = useState<"ich" | "alle">("alle");
  const offen = useQuery(crmAufgaben({ ...bezug, status: "alle", zustaendig: zustaendigFilter }));
  const anlegen = useAufgabeAnlegen();
  const [titel, setTitel] = useState("");
  const [faellig, setFaellig] = useState("");
  // `undefined`: Standard (die eigene Person), `null`: niemand.
  const [wer, setWer] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const schreiben = darf("bearbeiter", fondsId);
  const heute = heuteIso();

  function senden(e: FormEvent) {
    e.preventDefault();
    if (!titel.trim()) return;
    anlegen.mutate(
      { titel: titel.trim(), ...(faellig ? { faellig } : {}), ...(wer === undefined ? {} : { zustaendigId: wer?.id ?? null }), ...bezug },
      {
        onSuccess: () => {
          setTitel("");
          setFaellig("");
          setWer(undefined);
        },
      },
    );
  }

  const zeilen = offen.data ?? [];
  const gewaehlterName = wer === undefined ? (ich?.name ?? t.crm.ich) : (wer?.name ?? null);
  return (
    <section className="app-karte" aria-label={t.crm.aufgaben}>
      <div className="app-karte__kopf">
        <h3 className="cw-t-untertitel app-karte__titel">{t.crm.aufgaben}</h3>
        <AufgabenFilterWahl wert={zustaendigFilter} onChange={setZustaendigFilter} />
      </div>
      <FehlerHinweis fehler={offen.error ?? anlegen.error} />
      {schreiben ? (
        <form className="app-aufgabenformular" onSubmit={senden} noValidate aria-label={t.crm.aufgabeNeu}>
          <Eingabe label={t.crm.aufgabeTitel} value={titel} onChange={(e) => setTitel(e.target.value)} />
          <Eingabe label={t.crm.aufgabeFaellig} type="date" value={faellig} onChange={(e) => setFaellig(e.target.value)} />
          <div className="app-aufgabenformular__wer">
            <span className="cw-t-beschriftung">{t.crm.zustaendig}</span>
            <ZustaendigWahl name={gewaehlterName} beschriftung={`${gewaehlterName ?? t.crm.nichtZugewiesen}: ${t.crm.zustaendigWaehlen}`} {...(bezug.dealId ? { dealId: bezug.dealId } : {})} onWaehlen={setWer} />
          </div>
          <Button type="submit" disabled={anlegen.isPending}>
            {t.crm.aufgabeAnlegen}
          </Button>
        </form>
      ) : null}
      {offen.isPending ? <div className="app-skelett app-skelett--zeile" aria-hidden="true" /> : null}
      {offen.data && zeilen.length === 0 ? <p className="app-leer-text">{zustaendigFilter === "ich" ? t.crm.keineMeinenAufgaben : t.crm.keineAufgaben}</p> : null}
      <ul className="app-aufgaben">
        {zeilen.map((a) => (
          <AufgabeZeile key={a.id} a={a} schreiben={schreiben} heute={heute} mitBezug={false} />
        ))}
      </ul>
    </section>
  );
}
