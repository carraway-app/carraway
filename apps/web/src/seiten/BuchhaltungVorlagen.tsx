import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Auswahl, Button, CaretDownIcon, CaretUpIcon, Etikett, Feld, Hinweis, PlusIcon, Tabelle, Textbereich, XIcon } from "@carraway/ui";
import { belegvorlagen, useBelegartAendern, useBelegartAnlegen, useBelegartLoeschen, useVorlageSetzen, type BelegArt, type BelegVorlageDaten } from "../api/buchhaltung";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { aufzaehlung, useSprache, useT } from "../i18n";

/** Eindeutiger Schlüssel einer Zeile: Id der eigenen Belegart oder Name der festen. */
const zeilenId = (v: BelegVorlageDaten) => v.eigeneArtId ?? v.art;

/** Anzeigename einer Belegart: eigener Name in der Oberflächensprache oder die feste Bezeichnung. */
export function useArtName() {
  const t = useT();
  const sprache = useSprache();
  return (v: Pick<BelegVorlageDaten, "art" | "bezeichnungDe" | "bezeichnungEn">) => (sprache === "de" ? v.bezeichnungDe : v.bezeichnungEn) ?? aufzaehlung(t.buchhaltung.belegArt, v.art);
}

/** Belegvorlagen: erst die Belegart wählen (feste oder eigene, auch neu anlegen), dann Felder aus dem Katalog hinzufügen, ordnen und als Pflicht markieren. */
export function VorlagenKarte({ fondsId, aenderbar }: { fondsId: string; aenderbar: boolean }) {
  const t = useT();
  const e = t.buchhaltung.einstellungen;
  const { data } = useSuspenseQuery(belegvorlagen(fondsId));
  const artName = useArtName();
  const [gewaehlt, setGewaehlt] = useState<string>(data[0] ? zeilenId(data[0]) : "");
  const [neu, setNeu] = useState(false);
  const vorlage = data.find((v) => zeilenId(v) === gewaehlt) ?? data[0];
  return (
    <section className="app-karte" aria-label={e.belegvorlagen}>
      <h3 className="app-gruppen-titel">{e.belegvorlagen}</h3>
      <p className="app-leer-text app-vorlage__hilfe">{e.vorlageHilfe}</p>
      <div className="cw-formularraster app-vorlage__art">
        <Auswahl label={e.vorlageArt} hilfe={e.vorlageArtHilfe} value={vorlage ? zeilenId(vorlage) : ""} onChange={(ev) => setGewaehlt(ev.target.value)}>
          {data.map((v) => (
            <option key={zeilenId(v)} value={zeilenId(v)}>
              {`${artName(v)} (${v.eigeneArtId ? (v.aktiv ? e.eigeneArt.eigenMarke : e.eigeneArt.stillgelegt) : v.standard ? e.vorlageStandard : e.vorlageEigen})`}
            </option>
          ))}
        </Auswahl>
      </div>
      {aenderbar ? (
        neu ? (
          <NeueArt
            fondsId={fondsId}
            onFertig={(id) => {
              setNeu(false);
              if (id) setGewaehlt(id);
            }}
          />
        ) : (
          <div>
            <Button variante="sekundaer" icon={<PlusIcon />} onClick={() => setNeu(true)}>
              {e.eigeneArt.neu}
            </Button>
          </div>
        )
      ) : null}
      {vorlage?.eigeneArtId ? <ArtEinstellungen key={`art-${vorlage.eigeneArtId}`} fondsId={fondsId} vorlage={vorlage} aenderbar={aenderbar} onGeloescht={() => setGewaehlt("")} /> : null}
      {vorlage ? <VorlageEditor key={`${zeilenId(vorlage)}-${vorlage.standard}`} fondsId={fondsId} vorlage={vorlage} aenderbar={aenderbar} /> : null}
    </section>
  );
}

/** Formular „Eigene Belegart anlegen“: Name in beiden Sprachen und Basis-Art. */
function NeueArt({ fondsId, onFertig }: { fondsId: string; onFertig: (neueId: string | null) => void }) {
  const t = useT();
  const k = t.buchhaltung.einstellungen.eigeneArt;
  const anlegen = useBelegartAnlegen(fondsId);
  const [form, setForm] = useState<{ basisArt: BelegArt; de: string; en: string }>({ basisArt: "auszahlung", de: "", en: "" });
  const [fehlt, setFehlt] = useState(false);
  return (
    <form
      className="app-formular"
      noValidate
      aria-label={k.neu}
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!form.de.trim() || !form.en.trim()) return setFehlt(true);
        setFehlt(false);
        anlegen.mutate({ basisArt: form.basisArt, bezeichnungDe: form.de.trim(), bezeichnungEn: form.en.trim() }, { onSuccess: (art) => onFertig(art.id) });
      }}
    >
      <p className="app-leer-text app-vorlage__hilfe">{k.hilfe}</p>
      <div className="cw-formularraster">
        <Feld label={k.nameDe} value={form.de} onChange={(ev) => setForm({ ...form, de: ev.target.value })} />
        <Feld label={k.nameEn} value={form.en} onChange={(ev) => setForm({ ...form, en: ev.target.value })} />
        <Auswahl label={k.basis} value={form.basisArt} onChange={(ev) => setForm({ ...form, basisArt: ev.target.value as BelegArt })}>
          {BASIS_ARTEN.map((a) => (
            <option key={a} value={a}>
              {aufzaehlung(t.buchhaltung.belegArt, a)}
            </option>
          ))}
        </Auswahl>
      </div>
      {fehlt ? <Hinweis>{k.pflichtName}</Hinweis> : null}
      <FehlerHinweis fehler={anlegen.error} />
      <div className="app-aktionen__knoepfe">
        <Button type="submit" disabled={anlegen.isPending}>
          {k.anlegen}
        </Button>
        <Button type="button" variante="sekundaer" onClick={() => onFertig(null)}>
          {k.abbrechen}
        </Button>
      </div>
    </form>
  );
}

const BASIS_ARTEN: BelegArt[] = ["vertragsanlage", "auszahlung", "zinsbuchung", "verkauf", "wandlung", "kapitalabruf", "ausschuettung", "frei"];

/** Name, Stilllegung und Löschen einer eigenen Belegart; die Basis-Art steht fest. */
function ArtEinstellungen({ fondsId, vorlage, aenderbar, onGeloescht }: { fondsId: string; vorlage: BelegVorlageDaten; aenderbar: boolean; onGeloescht: () => void }) {
  const t = useT();
  const k = t.buchhaltung.einstellungen.eigeneArt;
  const artId = vorlage.eigeneArtId!;
  const aendern = useBelegartAendern(fondsId, artId);
  const loeschen = useBelegartLoeschen(fondsId, artId);
  const [form, setForm] = useState({ de: vorlage.bezeichnungDe ?? "", en: vorlage.bezeichnungEn ?? "", aktiv: vorlage.aktiv });
  const [frage, setFrage] = useState(false);
  return (
    <fieldset className="app-vorlage" disabled={!aenderbar} aria-label={k.titel}>
      <Etikett>{`${k.titel} · ${k.basisFest(aufzaehlung(t.buchhaltung.belegArt, vorlage.art))}`}</Etikett>
      <div className="cw-formularraster">
        <Feld label={k.nameDe} value={form.de} onChange={(ev) => setForm({ ...form, de: ev.target.value })} />
        <Feld label={k.nameEn} value={form.en} onChange={(ev) => setForm({ ...form, en: ev.target.value })} />
      </div>
      <label className="app-vorlage__knoepfe">
        <input type="checkbox" checked={!form.aktiv} onChange={(ev) => setForm({ ...form, aktiv: !ev.target.checked })} />
        <span>{k.stilllegen}</span>
      </label>
      <FehlerHinweis fehler={aendern.error ?? loeschen.error} />
      {aendern.isSuccess ? <Hinweis>{k.geaendert}</Hinweis> : null}
      {frage ? (
        <Hinweis titel={k.loeschenFrage(vorlage.bezeichnungDe ?? "")}>
          <span className="app-aktionen__knoepfe">
            <Button disabled={loeschen.isPending} onClick={() => loeschen.mutate(undefined, { onSuccess: onGeloescht })}>
              {k.loeschenBestaetigen}
            </Button>
            <Button variante="sekundaer" onClick={() => setFrage(false)}>
              {k.abbrechen}
            </Button>
          </span>
        </Hinweis>
      ) : null}
      {aenderbar ? (
        <div className="app-aktionen__knoepfe">
          <Button disabled={aendern.isPending || !form.de.trim() || !form.en.trim()} onClick={() => aendern.mutate({ bezeichnungDe: form.de.trim(), bezeichnungEn: form.en.trim(), aktiv: form.aktiv })}>
            {k.aendern}
          </Button>
          <Button variante="sekundaer" onClick={() => setFrage(true)}>
            {k.loeschen}
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}

type Eintrag = BelegVorlageDaten["felder"][number];

function VorlageEditor({ fondsId, vorlage, aenderbar }: { fondsId: string; vorlage: BelegVorlageDaten; aenderbar: boolean }) {
  const t = useT();
  const sprache = useSprache();
  const e = t.buchhaltung.einstellungen;
  const setzen = useVorlageSetzen(fondsId, zeilenId(vorlage));
  const artName = useArtName();
  const katalog = new Map(vorlage.katalog.map((k) => [k.schluessel, k]));
  const [liste, setListe] = useState<Eintrag[]>(() => vorlage.felder.filter((f) => f.manuell || katalog.has(f.schluessel)));
  const [texte, setTexte] = useState({ kopfDe: vorlage.kopfDe, kopfEn: vorlage.kopfEn, fussDe: vorlage.fussDe, fussEn: vorlage.fussEn });
  const art = artName(vorlage);
  const name = (schluessel: string) => {
    const k = katalog.get(schluessel);
    const eigen = liste.find((f) => f.schluessel === schluessel && f.manuell);
    if (eigen) return (sprache === "de" ? eigen.bezeichnungDe : eigen.bezeichnungEn) || e.vorlageSpalten.feld;
    return k ? (sprache === "de" ? k.bezeichnungDe : k.bezeichnungEn) : schluessel;
  };
  const gewaehlt = new Set(liste.map((x) => x.schluessel));
  const frei = vorlage.katalog.filter((k) => !gewaehlt.has(k.schluessel));
  const verschiebe = (i: number, richtung: -1 | 1) =>
    setListe((alt) => {
      const j = i + richtung;
      if (j < 0 || j >= alt.length) return alt;
      const neu = [...alt];
      [neu[i], neu[j]] = [neu[j]!, neu[i]!];
      return neu;
    });
  function aendereFeld(schluessel: string, aenderung: Partial<Eintrag>) {
    setListe((alt) => alt.map((f) => f.schluessel === schluessel ? { ...f, ...aenderung } : f));
  }
  const sp = e.vorlageSpalten;
  return (
    <fieldset className="app-vorlage" disabled={!aenderbar}>
      <div className="app-vorlage__spalten">
        <div className="app-vorlage__block">
          <Etikett>{e.vorlageAufBeleg}</Etikett>
          {liste.length === 0 ? (
            <p className="app-leer-text">{e.vorlageNochKeine}</p>
          ) : (
            <Tabelle
              beschriftung={`${e.vorlageAufBeleg}: ${art}`}
              zeilen={liste}
              zeilenSchluessel={(z) => z.schluessel}
              spalten={[
                { schluessel: "nr", kopf: sp.nr, zahl: true, zelle: (z) => liste.indexOf(z) + 1 },
                { schluessel: "feld", kopf: sp.feld, zelle: (z) => z.manuell && aenderbar ? (
                  <div className="cw-formularraster">
                    <Feld kompakt label={e.eigeneArt.feldDe} value={z.bezeichnungDe ?? ""} maxLength={100} onChange={(ev) => aendereFeld(z.schluessel, { bezeichnungDe: ev.target.value })} />
                    <Feld kompakt label={e.eigeneArt.feldEn} value={z.bezeichnungEn ?? ""} maxLength={100} onChange={(ev) => aendereFeld(z.schluessel, { bezeichnungEn: ev.target.value })} />
                  </div>
                ) : name(z.schluessel) },
                { schluessel: "typ", kopf: sp.typ, zelle: (z) => z.manuell && aenderbar ? (
                  <Auswahl label={sp.typ} value={z.manuell} onChange={(ev) => aendereFeld(z.schluessel, { manuell: ev.target.value as Eintrag["manuell"] })}>
                    {["text", "betrag", "datum"].map((typ) => <option key={typ} value={typ}>{aufzaehlung(e.vorlageTyp, typ)}</option>)}
                  </Auswahl>
                ) : aufzaehlung(e.vorlageTyp, z.manuell ?? katalog.get(z.schluessel)?.typ ?? "text") },
                {
                  schluessel: "pflicht",
                  kopf: sp.pflicht,
                  zelle: (z) => (
                    <input
                      type="checkbox"
                      checked={z.pflicht}
                      aria-label={`${e.pflicht}: ${name(z.schluessel)}`}
                      onChange={(ev) => setListe((alt) => alt.map((x) => (x.schluessel === z.schluessel ? { ...x, pflicht: ev.target.checked } : x)))}
                    />
                  ),
                },
                {
                  schluessel: "reihenfolge",
                  kopf: sp.reihenfolge,
                  zelle: (z) => {
                    const i = liste.indexOf(z);
                    return (
                      <span className="app-vorlage__knoepfe">
                        <Button variante="ruhig" groesse="s" icon={<CaretUpIcon />} aria-label={e.vorlageNachOben(name(z.schluessel))} disabled={i === 0} onClick={() => verschiebe(i, -1)} />
                        <Button variante="ruhig" groesse="s" icon={<CaretDownIcon />} aria-label={e.vorlageNachUnten(name(z.schluessel))} disabled={i === liste.length - 1} onClick={() => verschiebe(i, 1)} />
                      </span>
                    );
                  },
                },
                {
                  schluessel: "aktion",
                  kopf: sp.aktion,
                  zelle: (z) => <Button variante="ruhig" groesse="s" icon={<XIcon />} aria-label={e.vorlageEntfernen(name(z.schluessel))} onClick={() => setListe((alt) => alt.filter((x) => x.schluessel !== z.schluessel))} />,
                },
              ]}
            />
          )}
        </div>
        <div className="app-vorlage__block app-vorlage__verfuegbar">
          <Etikett>{e.vorlageVerfuegbar}</Etikett>
          {vorlage.eigeneArtId && aenderbar ? (
            <Button variante="sekundaer" groesse="s" icon={<PlusIcon />} disabled={liste.length >= 60} onClick={() => setListe([...liste, { schluessel: `eigen_${crypto.randomUUID()}`, manuell: "text", abschnitt: "details", pflicht: false, bezeichnungDe: "", bezeichnungEn: "" }])}>{e.eigeneArt.feldNeu}</Button>
          ) : null}
          {frei.length === 0 ? (
            <p className="app-leer-text">{e.vorlageAlleGewaehlt}</p>
          ) : (
            <ul className="app-vorlage__liste" aria-label={e.vorlageVerfuegbar}>
              {frei.map((k) => (
                <li key={k.schluessel}>
                  <span>{sprache === "de" ? k.bezeichnungDe : k.bezeichnungEn}</span>
                  <Button
                    variante="sekundaer"
                    groesse="s"
                    icon={<PlusIcon />}
                    aria-label={e.vorlageHinzufuegen(sprache === "de" ? k.bezeichnungDe : k.bezeichnungEn)}
                    onClick={() => setListe((alt) => [...alt, { schluessel: k.schluessel, abschnitt: "details" as const, pflicht: false }])}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="cw-formularraster app-vorlage__texte">
        <Etikett className="cw-formularraster__voll">{e.vorlageTexte}</Etikett>
        <Textbereich markdown label={e.kopftext + " (de)"} rows={2} value={texte.kopfDe} onChange={(ev) => setTexte((alt) => ({ ...alt, kopfDe: ev.target.value }))} />
        <Textbereich markdown label={e.kopftext + " (en)"} rows={2} value={texte.kopfEn} onChange={(ev) => setTexte((alt) => ({ ...alt, kopfEn: ev.target.value }))} />
        <Textbereich markdown label={e.fusstext + " (de)"} rows={2} value={texte.fussDe} onChange={(ev) => setTexte((alt) => ({ ...alt, fussDe: ev.target.value }))} />
        <Textbereich markdown label={e.fusstext + " (en)"} rows={2} value={texte.fussEn} onChange={(ev) => setTexte((alt) => ({ ...alt, fussEn: ev.target.value }))} />
      </div>
      <FehlerHinweis fehler={setzen.error} />
      {setzen.isSuccess ? <Hinweis>{e.gespeichert}</Hinweis> : null}
      {aenderbar ? (
        <div>
          <Button disabled={setzen.isPending || liste.some((f) => f.manuell && (!f.bezeichnungDe?.trim() || !f.bezeichnungEn?.trim()))} onClick={() => setzen.mutate({ felder: liste, ...texte })}>
            {`${e.speichern}: ${art}`}
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}
