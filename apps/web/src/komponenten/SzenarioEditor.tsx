import { useState, type FormEvent } from "react";
import { Auswahl, Button, Feld, formatBetrag } from "@carraway/ui";
import { BetragFeld } from "./BetragFeld";
import { useZeilenpruefung } from "./formular";
import { betragRegel, datumRegel, ganzzahlRegel, pflichtRegel, prozentRegel, type Regel } from "../lib/feldpruefung";
import type { SzenarioVorlage } from "../api/szenarien";
import { useSzenarioAendern, useSzenarioAnlegen } from "../api/szenarien";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { bauAnnahmen, formAusSzenario, leereNeuinvestition, leeresFormular, type AusstiegArt, type NeuinvestitionForm, type SzenarioForm, type ZeilenForm } from "../lib/szenario";
import { FehlerHinweis } from "./FehlerHinweis";

const ARTEN: AusstiegArt[] = ["keiner", "multiple", "wert", "abschreibung"];

type Leer = Record<string, string>;
// Grenzen wie die Annahmen der API (`szenarien/annahmen.ts`): Jahre 1990 bis 2100, Faktoren bis vier Stellen vor und nach dem Komma, Anteile in Prozent.
const jahrRegel = (pflicht = false): Regel<Leer> => ganzzahlRegel({ min: 1990, max: 2100, stellen: 4, pflicht });
const faktorRegel = (pflicht = false): Regel<Leer> => betragRegel({ nachkomma: 4, ganzstellen: 4, pflicht });
const betragPositiv = (pflicht = false): Regel<Leer> => betragRegel({ vorzeichen: "positiv", pflicht });

/**
 * Editor eines Szenarios: Basistag, Gebühren, Carry und je aktive Beteiligung die Annahmen (Ausstieg, Folgeinvestition). Das Formular
 * schickt die Annahmen als JSON; Prüfung und Rechnung liegen auf dem Server, Fehler kommen als Meldung zurück.
 */
export function SzenarioEditor({
  fondsId,
  vorlage,
  vorhanden,
  onFertig,
  onAbbrechen,
}: {
  fondsId: string;
  vorlage: SzenarioVorlage;
  vorhanden?: { id: string; name: string; basisStichtag: string; annahmen: unknown };
  onFertig: (id: string) => void;
  onAbbrechen: () => void;
}) {
  const t = useT();
  const e = t.szenarien.editor;
  const sprache = useSprache();
  const anlegen = useSzenarioAnlegen(fondsId);
  const aendern = useSzenarioAendern(fondsId, vorhanden?.id ?? "");
  const [f, setF] = useState<SzenarioForm>(() => (vorhanden ? formAusSzenario(vorhanden, vorlage) : leeresFormular(vorlage.basisStichtag, vorlage)));
  const fehler = (vorhanden ? aendern.error : anlegen.error) ?? null;
  const setze = <K extends keyof SzenarioForm>(name: K, wert: SzenarioForm[K]) => setF((x) => ({ ...x, [name]: wert }));
  const setzeZeile = (id: string, teil: Partial<ZeilenForm>) => setF((x) => ({ ...x, zeilen: { ...x.zeilen, [id]: { ...x.zeilen[id]!, ...teil } } }));

  // Die Zeilen sind dynamisch (kein `useFormular`): `pruefe` liefert `onBlur` und `fehler` je Feld.
  const { pruefe, pruefeAlle } = useZeilenpruefung();
  const neuAktiv = (n: NeuinvestitionForm) => Object.values(n).some((w) => w.trim() !== "");
  const setzeNeu = (i: number, teil: Partial<NeuinvestitionForm>) => setF((x) => ({ ...x, neuinvestitionen: x.neuinvestitionen.map((n, j) => (j === i ? { ...n, ...teil } : n)) }));

  function senden(ev: FormEvent) {
    ev.preventDefault();
    if (!pruefeAlle()) return;
    const annahmen = bauAnnahmen(f, sprache);
    const nach = { onSuccess: (z: { id: string }) => onFertig(z.id) };
    if (vorhanden) aendern.mutate({ name: f.name, basisStichtag: f.basisStichtag, annahmen }, nach);
    else anlegen.mutate({ name: f.name, basisStichtag: f.basisStichtag, annahmen }, nach);
  }

  return (
    <form className="app-formular app-karte" noValidate onSubmit={senden} aria-label={vorhanden ? e.titelBearbeiten(vorhanden.name) : e.titelNeu}>
      <h3 className="cw-t-untertitel app-karte__titel">{vorhanden ? e.titelBearbeiten(vorhanden.name) : e.titelNeu}</h3>
      <FehlerHinweis fehler={fehler} />
      <Feld label={e.name} value={f.name} onChange={(ev) => setze("name", ev.target.value)} required maxLength={120} {...pruefe("name", pflichtRegel(), f.name)} />
      <Feld label={e.basisStichtag} hilfe={e.basisHilfe} type="date" value={f.basisStichtag} onChange={(ev) => setze("basisStichtag", ev.target.value)} required {...pruefe("basisStichtag", datumRegel({ pflicht: true }), f.basisStichtag)} />
      <BetragFeld label={e.endJahr} value={f.endJahr} inputMode="numeric" onChange={(ev) => setze("endJahr", ev.target.value)} {...pruefe("endJahr", jahrRegel(), f.endJahr)} />
      <Auswahl label={e.wertpfad} value={f.wertpfad} onChange={(ev) => setze("wertpfad", ev.target.value as SzenarioForm["wertpfad"])}>
        {(["linear", "konstant"] as const).map((w) => (
          <option key={w} value={w}>
            {aufzaehlung(e.wertpfade, w)}
          </option>
        ))}
      </Auswahl>

      <fieldset className="app-karte">
        <legend className="app-gruppen-titel">{e.gebuehren}</legend>
        <div className="app-szenario-zeile">
          <Auswahl label={e.gebuehrenBasis} value={f.gebuehrenBasis} onChange={(ev) => setze("gebuehrenBasis", ev.target.value as SzenarioForm["gebuehrenBasis"])}>
            {(["zeichnungskapital", "investiert"] as const).map((b) => (
              <option key={b} value={b}>
                {aufzaehlung(e.gebuehrenBasen, b)}
              </option>
            ))}
          </Auswahl>
          <BetragFeld label={e.satz} value={f.satz} inputMode="decimal" onChange={(ev) => setze("satz", ev.target.value)} {...pruefe("satz", prozentRegel<Leer>(), f.satz)} />
          <BetragFeld label={e.bisJahr} value={f.bisJahr} inputMode="numeric" onChange={(ev) => setze("bisJahr", ev.target.value)} {...pruefe("bisJahr", jahrRegel(), f.bisJahr)} />
          <BetragFeld label={e.sonstige} value={f.sonstige} inputMode="decimal" onChange={(ev) => setze("sonstige", ev.target.value)} {...pruefe("sonstige", betragRegel<Leer>(), f.sonstige)} />
          <BetragFeld label={e.carry} hilfe={e.carryHilfe} value={f.carry} inputMode="decimal" onChange={(ev) => setze("carry", ev.target.value)} {...pruefe("carry", prozentRegel<Leer>(), f.carry)} />
        </div>
      </fieldset>

      <h4 className="app-gruppen-titel">{e.beteiligungen}</h4>
      {vorlage.beteiligungen.length === 0 ? <p className="app-leer-text">{e.keineBeteiligungen}</p> : null}
      {vorlage.beteiligungen.map((b) => {
        const z = f.zeilen[b.id] ?? { art: "keiner" as const, jahr: "", angabe: "", wahrscheinlichkeit: "100", quote: "", kosten: "", folgeJahr: "", folgeBetrag: "" };
        const mitAusstieg = z.art === "multiple" || z.art === "wert";
        return (
          <fieldset key={b.id} className="app-karte" aria-label={b.organisation}>
            <legend className="app-gruppen-titel">
              {b.organisation} · {e.spalten.wert} {b.wert === null ? t.gemeinsam.keinWert : formatBetrag(b.wert, sprache)}
            </legend>
            <div className="app-szenario-zeile">
              <Auswahl label={e.spalten.ausstieg} value={z.art} onChange={(ev) => setzeZeile(b.id, { art: ev.target.value as AusstiegArt })}>
                {ARTEN.map((a) => (
                  <option key={a} value={a}>
                    {aufzaehlung(e.ausstiegArt, a)}
                  </option>
                ))}
              </Auswahl>
              {z.art !== "keiner" ? <BetragFeld label={e.spalten.jahr} value={z.jahr} inputMode="numeric" onChange={(ev) => setzeZeile(b.id, { jahr: ev.target.value })} {...pruefe(`jahr-${b.id}`, jahrRegel(true), z.jahr)} /> : null}
              {mitAusstieg ? <BetragFeld label={z.art === "multiple" ? e.angabeMultiple : e.angabeWert} value={z.angabe} inputMode="decimal" onChange={(ev) => setzeZeile(b.id, { angabe: ev.target.value })} {...pruefe(`angabe-${b.id}`, z.art === "multiple" ? faktorRegel(true) : betragRegel<Leer>({ pflicht: true }), z.angabe)} /> : null}
              {mitAusstieg ? <BetragFeld label={e.spalten.wahrscheinlichkeit} value={z.wahrscheinlichkeit} inputMode="decimal" onChange={(ev) => setzeZeile(b.id, { wahrscheinlichkeit: ev.target.value })} {...pruefe(`wk-${b.id}`, prozentRegel<Leer>(), z.wahrscheinlichkeit)} /> : null}
              {z.art === "wert" ? <BetragFeld label={e.spalten.kosten} value={z.kosten} inputMode="decimal" onChange={(ev) => setzeZeile(b.id, { kosten: ev.target.value })} {...pruefe(`kosten-${b.id}`, betragRegel<Leer>(), z.kosten)} /> : null}
              {z.art === "wert" ? <BetragFeld label={e.spalten.quote} hilfe={e.quoteHilfe} value={z.quote} inputMode="decimal" onChange={(ev) => setzeZeile(b.id, { quote: ev.target.value })} {...pruefe(`quote-${b.id}`, prozentRegel<Leer>(), z.quote)} /> : null}
              <BetragFeld label={e.spalten.folgeJahr} value={z.folgeJahr} inputMode="numeric" onChange={(ev) => setzeZeile(b.id, { folgeJahr: ev.target.value })} {...pruefe(`fj-${b.id}`, (_w, _a, k) => (z.folgeBetrag.trim() !== "" ? jahrRegel(true) : jahrRegel())(z.folgeJahr, {}, k), z.folgeJahr)} />
              <BetragFeld label={e.spalten.folgeBetrag} value={z.folgeBetrag} inputMode="decimal" onChange={(ev) => setzeZeile(b.id, { folgeBetrag: ev.target.value })} {...pruefe(`fb-${b.id}`, (_w, _a, k) => (z.folgeJahr.trim() !== "" ? betragPositiv(true) : betragPositiv())(z.folgeBetrag, {}, k), z.folgeBetrag)} />
            </div>
          </fieldset>
        );
      })}

      <h4 className="app-gruppen-titel">{e.neuinvestitionen}</h4>
      <p className="app-leer-text">{e.neuinvestitionenHilfe}</p>
      {f.neuinvestitionen.map((n, i) => (
        <fieldset key={i} className="app-karte" aria-label={e.neuinvestitionNr(i + 1)}>
          <legend className="app-gruppen-titel">{e.neuinvestitionNr(i + 1)}</legend>
          <div className="app-szenario-zeile">
            <Feld label={e.neu.name} value={n.name} maxLength={200} onChange={(ev) => setzeNeu(i, { name: ev.target.value })} {...pruefe(`nname-${i}`, neuAktiv(n) ? pflichtRegel() : () => undefined, n.name)} />
            <BetragFeld label={e.neu.jahr} value={n.jahr} inputMode="numeric" onChange={(ev) => setzeNeu(i, { jahr: ev.target.value })} {...pruefe(`njahr-${i}`, jahrRegel(neuAktiv(n)), n.jahr)} />
            <BetragFeld label={e.neu.betrag} value={n.betrag} inputMode="decimal" onChange={(ev) => setzeNeu(i, { betrag: ev.target.value })} {...pruefe(`nbetrag-${i}`, betragPositiv(neuAktiv(n)), n.betrag)} />
            <BetragFeld label={e.neu.ausstiegJahr} value={n.ausstiegJahr} inputMode="numeric" onChange={(ev) => setzeNeu(i, { ausstiegJahr: ev.target.value })} {...pruefe(`naj-${i}`, jahrRegel(), n.ausstiegJahr)} />
            <BetragFeld label={e.neu.multiple} value={n.multiple} inputMode="decimal" onChange={(ev) => setzeNeu(i, { multiple: ev.target.value })} {...pruefe(`nmult-${i}`, faktorRegel(), n.multiple)} />
          </div>
          <div>
            <Button type="button" variante="ruhig" aria-label={e.neuinvestitionEntfernen(i + 1)} onClick={() => setF((x) => ({ ...x, neuinvestitionen: x.neuinvestitionen.filter((_, j) => j !== i) }))}>
              {e.entfernen}
            </Button>
          </div>
        </fieldset>
      ))}
      <div>
        <Button type="button" variante="sekundaer" disabled={f.neuinvestitionen.length >= 50} onClick={() => setF((x) => ({ ...x, neuinvestitionen: [...x.neuinvestitionen, leereNeuinvestition()] }))}>
          {e.neuinvestitionHinzu}
        </Button>
      </div>

      <div className="app-aktionen__knoepfe">
        <Button type="submit" disabled={anlegen.isPending || aendern.isPending}>
          {e.speichern}
        </Button>
        <Button type="button" variante="sekundaer" onClick={onAbbrechen}>
          {e.abbrechen}
        </Button>
      </div>
    </form>
  );
}
