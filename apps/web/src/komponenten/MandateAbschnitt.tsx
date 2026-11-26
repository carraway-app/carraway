import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Auswahl, Button, Feld, Seitenpanel, Status, Tabelle, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { beteiligungMandate, fondsMandate, useMandatAendern, useMandatAnlegen, useMandatLoeschen, type Gremium, type Mandat, type MandatRolle } from "../api/mandate";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { FehlerHinweis } from "./FehlerHinweis";
import { useFormular } from "./formular";
import { KontaktAuswahl, type Treffer } from "./KontaktAuswahl";
import { Skelettzeilen } from "./Skelett";

const GREMIEN = ["beirat", "aufsichtsrat", "board", "sonstiges"] as const satisfies readonly Gremium[];
const ROLLEN = ["vorsitz", "stellvertretender_vorsitz", "mitglied", "beobachter"] as const satisfies readonly MandatRolle[];
const heute = () => new Date().toISOString().slice(0, 10);
const laeuft = (m: Mandat, tag: string) => m.beginn <= tag && (m.ende === null || m.ende >= tag);
const personName = (m: Mandat) => `${m.person.vorname} ${m.person.nachname}`;

function useGremiumText() {
  const t = useT();
  return (m: Pick<Mandat, "gremium" | "gremiumName">) => m.gremiumName ?? aufzaehlung(t.gremien.arten, m.gremium);
}

/** Abschnitt „Gremien“ an der Beteiligung: Mandate des Fonds in Beirat, Aufsichtsrat oder Board mit Person, Rolle und Zeitraum. */
export function MandateAbschnitt({ beteiligungId, schreiben }: { beteiligungId: string; schreiben: boolean }) {
  const t = useT();
  const g = t.gremien;
  const sprache = useSprache();
  const gremiumText = useGremiumText();
  const { data, error, isPending } = useQuery(beteiligungMandate(beteiligungId));
  const loeschen = useMandatLoeschen(beteiligungId);
  const [dialog, setDialog] = useState<{ mandat?: Mandat } | null>(null);
  const tag = heute();

  const spalten: TabelleSpalte<Mandat>[] = [
    { schluessel: "gremium", kopf: g.spalten.gremium, zelle: (m) => gremiumText(m) },
    { schluessel: "person", kopf: g.spalten.person, zelle: (m) => <Link to="/personen/$id" params={{ id: m.person.id }}>{personName(m)}</Link> },
    { schluessel: "rolle", kopf: g.spalten.rolle, zelle: (m) => aufzaehlung(g.rollen, m.rolle) },
    { schluessel: "zeitraum", kopf: g.spalten.zeitraum, zelle: (m) => g.zeitraum(formatDatum(m.beginn, sprache), m.ende ? formatDatum(m.ende, sprache) : null) },
    { schluessel: "status", kopf: g.spalten.status, zelle: (m) => (laeuft(m, tag) ? <Status variante="freigegeben">{g.laufend}</Status> : <Status variante="entwurf">{g.beendet}</Status>) },
    ...(schreiben
      ? [
          {
            schluessel: "aktion",
            kopf: g.spalten.aktion,
            zelle: (m: Mandat) => (
              <span className="app-zusammenhang">
                <Button variante="sekundaer" aria-label={g.bearbeitenFuer(personName(m))} onClick={() => setDialog({ mandat: m })}>
                  {g.bearbeiten}
                </Button>
                <Button variante="gefahr" aria-label={g.loeschenFuer(personName(m))} disabled={loeschen.isPending} onClick={() => loeschen.mutate(m.id)}>
                  {g.loeschen}
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <section className="app-karte" aria-labelledby="abschnitt-gremien">
        <div className="app-karte__kopf">
          <h2 id="abschnitt-gremien" className="cw-t-untertitel app-karte__titel">
            {g.titel}
          </h2>
          {schreiben ? <Button onClick={() => setDialog({})}>{g.neu}</Button> : null}
        </div>
        <FehlerHinweis fehler={loeschen.error} />
        {isPending ? <Skelettzeilen anzahl={2} /> : null}
        {error ? <FehlerHinweis fehler={error} /> : null}
        {data && data.length === 0 ? <p className="app-leer-text">{g.keine}</p> : null}
        {data && data.length > 0 ? <Tabelle dicht beschriftung={g.tabelle} spalten={spalten} zeilen={data} zeilenSchluessel={(m) => m.id} /> : null}
      </section>
      {dialog ? <MandatDialog beteiligungId={beteiligungId} {...(dialog.mandat ? { mandat: dialog.mandat } : {})} onSchliessen={() => setDialog(null)} /> : null}
    </>
  );
}

/** Liste der Mandate eines Fonds über alle Beteiligungen; Vorgabe: nur die heute laufenden. */
export function FondsMandate({ fondsId }: { fondsId: string }) {
  const t = useT();
  const g = t.gremien;
  const sprache = useSprache();
  const gremiumText = useGremiumText();
  const [nurLaufende, setNurLaufende] = useState(true);
  const { data, error, isPending } = useQuery(fondsMandate(fondsId, nurLaufende ? heute() : undefined));
  const spalten: TabelleSpalte<Mandat>[] = [
    {
      schluessel: "unternehmen",
      kopf: g.spalten.unternehmen,
      zelle: (m) => (
        <Link to="/beteiligungen/$id" params={{ id: m.beteiligungId }} search={{ tab: "gremien" }}>
          {m.organisation.name}
        </Link>
      ),
    },
    { schluessel: "gremium", kopf: g.spalten.gremium, zelle: (m) => gremiumText(m) },
    { schluessel: "person", kopf: g.spalten.person, zelle: (m) => personName(m) },
    { schluessel: "rolle", kopf: g.spalten.rolle, zelle: (m) => aufzaehlung(g.rollen, m.rolle) },
    { schluessel: "zeitraum", kopf: g.spalten.zeitraum, zelle: (m) => g.zeitraum(formatDatum(m.beginn, sprache), m.ende ? formatDatum(m.ende, sprache) : null) },
  ];
  return (
    <section className="app-karte" aria-labelledby="abschnitt-fonds-gremien">
      <div className="app-karte__kopf">
        <h2 id="abschnitt-fonds-gremien" className="cw-t-untertitel app-karte__titel">
          {g.fondsTitel}
        </h2>
        <label className="app-haken">
          <input type="checkbox" checked={nurLaufende} onChange={(e) => setNurLaufende(e.target.checked)} />
          <span>{g.nurLaufende}</span>
        </label>
      </div>
      {isPending ? <Skelettzeilen anzahl={3} /> : null}
      {error ? <FehlerHinweis fehler={error} /> : null}
      {data && data.length === 0 ? <p className="app-leer-text">{nurLaufende ? g.keineLaufenden : g.keineImFonds}</p> : null}
      {data && data.length > 0 ? <Tabelle dicht beschriftung={g.fondsTabelle} spalten={spalten} zeilen={data} zeilenSchluessel={(m) => m.id} /> : null}
    </section>
  );
}

/** Neues Mandat oder Änderung; „Ende“ beendet ein laufendes Mandat. */
function MandatDialog({ beteiligungId, mandat, onSchliessen }: { beteiligungId: string; mandat?: Mandat; onSchliessen: () => void }) {
  const t = useT();
  const g = t.gremien;
  const f = g.form;
  const anlegen = useMandatAnlegen(beteiligungId);
  const aendern = useMandatAendern(beteiligungId);
  const mutation = mandat ? aendern : anlegen;
  const { werte, feld } = useFormular({
    gremium: mandat?.gremium ?? "beirat",
    gremiumName: mandat?.gremiumName ?? "",
    rolle: mandat?.rolle ?? "mitglied",
    beginn: mandat?.beginn ?? heute(),
    ende: mandat?.ende ?? "",
    bemerkung: mandat?.bemerkung ?? "",
  });
  const [person, setPerson] = useState<Treffer | null>(mandat ? { id: mandat.person.id, label: personName(mandat) } : null);
  const titel = mandat ? f.titelAendern : f.titelNeu;

  function absenden() {
    if (!person) return;
    const koerper = {
      gremium: werte.gremium as Gremium,
      gremiumName: werte.gremiumName.trim() || null,
      personId: person.id,
      rolle: werte.rolle as MandatRolle,
      beginn: werte.beginn,
      ende: werte.ende || null,
      bemerkung: werte.bemerkung.trim() || null,
    };
    if (mandat) aendern.mutate({ mandatId: mandat.id, ...koerper }, { onSuccess: onSchliessen });
    else anlegen.mutate(koerper, { onSuccess: onSchliessen });
  }

  return (
    <Seitenpanel titel={titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{titel}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          absenden();
        }}
      >
        <FehlerHinweis fehler={mutation.error} bekannt={["gremium", "gremiumName", "personId", "rolle", "beginn", "ende", "bemerkung"]} />
        <Auswahl label={f.gremium} {...feld("gremium")}>
          {GREMIEN.map((x) => (
            <option key={x} value={x}>
              {aufzaehlung(g.arten, x)}
            </option>
          ))}
        </Auswahl>
        <Feld label={f.gremiumName} hilfe={f.gremiumNameHilfe} autoComplete="off" {...feld("gremiumName")} fehler={feldText(t, mutation.error, "gremiumName")} />
        <KontaktAuswahl art="person" label={f.person} gewaehlt={person} onWaehlen={setPerson} fehler={feldText(t, mutation.error, "personId")} />
        <Auswahl label={f.rolle} {...feld("rolle")}>
          {ROLLEN.map((x) => (
            <option key={x} value={x}>
              {aufzaehlung(g.rollen, x)}
            </option>
          ))}
        </Auswahl>
        <Feld type="date" label={f.beginn} {...feld("beginn")} fehler={feldText(t, mutation.error, "beginn")} />
        <Feld type="date" label={f.ende} hilfe={f.endeHilfe} {...feld("ende")} fehler={feldText(t, mutation.error, "ende")} />
        <Feld label={f.bemerkung} autoComplete="off" {...feld("bemerkung")} fehler={feldText(t, mutation.error, "bemerkung")} />
        <div>
          <Button type="submit" disabled={mutation.isPending || !person || werte.beginn === ""}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
