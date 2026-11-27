import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button, Hinweis, Segment, Textbereich } from "@carraway/ui";
import {
  kontaktabgleichEinstellung,
  kontaktabgleichTeilnahme,
  kontaktvorschlaege,
  useKontaktabgleichEinstellen,
  useKontaktabgleichTeilnehmen,
  zeilen,
} from "../api/kontaktvorschlaege";
import { useSprache, useT } from "../i18n";
import { useRechte } from "../lib/rechte";
import { formatZeitpunkt } from "../lib/zeit";
import { FehlerHinweis } from "./FehlerHinweis";
import { Skelettzeilen } from "./Skelett";

/**
 * Bausteine für Kontakte aus Postfach und Kalender: eigene Teilnahme (Einstellungen), Einstellung der Installation (Verwaltung), Hinweis auf offene Vorschläge
 * (Kontakte) und die Herkunft am Kontakt.
 */

type Modus = "aus" | "vorschlag" | "direkt";

/** Eigene Teilnahme und Sperrliste; nur die Person selbst sieht sie. */
export function KontakteTeilnahmeKarte() {
  const t = useT();
  const k = t.mail.kontakte;
  const abfrage = useQuery(kontaktabgleichTeilnahme());
  const speichern = useKontaktabgleichTeilnehmen();
  const [teilnehmen, setTeilnehmen] = useState(false);
  const [sperrliste, setSperrliste] = useState("");
  const [gespeichert, setGespeichert] = useState(false);
  useEffect(() => {
    if (!abfrage.data) return;
    setTeilnehmen(abfrage.data.teilnehmen);
    setSperrliste(abfrage.data.sperrliste.join("\n"));
  }, [abfrage.data]);
  const d = abfrage.data;
  return (
    <section className="app-karte" aria-labelledby="einst-kontakte">
      <h2 id="einst-kontakte" className="cw-t-untertitel app-karte__titel">
        {k.titel}
      </h2>
      <p>{k.einleitung}</p>
      {abfrage.isPending ? <Skelettzeilen /> : null}
      <FehlerHinweis fehler={abfrage.error ?? speichern.error} />
      {d ? (
        d.modus === "aus" ? (
          <p className="app-leer-text">{k.aus}</p>
        ) : (
          <form
            className="app-formular"
            onSubmit={(ev) => {
              ev.preventDefault();
              setGespeichert(false);
              speichern.mutate({ teilnehmen, sperrliste: zeilen(sperrliste) }, { onSuccess: () => setGespeichert(true) });
            }}
          >
            <Hinweis>{k.modusHinweis[d.modus]}</Hinweis>
            {!d.darfAnlegen ? <Hinweis>{k.ohneRecht}</Hinweis> : null}
            <label className="app-schalter">
              <input type="checkbox" checked={teilnehmen} onChange={(ev) => setTeilnehmen(ev.target.checked)} />
              <span>{k.teilnehmen}</span>
            </label>
            <p className="app-leer-text">{k.teilnehmenHilfe}</p>
            <Textbereich label={k.sperrliste} hilfe={k.sperrlisteHilfe} rows={4} value={sperrliste} onChange={(ev) => setSperrliste(ev.target.value)} />
            <div className="app-aktionen">
              <Button type="submit" disabled={speichern.isPending}>
                {k.speichern}
              </Button>
            </div>
            <p role="status">{gespeichert ? k.gespeichert : ""}</p>
          </form>
        )
      ) : null}
    </section>
  );
}

/** Einstellung der Installation (nur globale Verwalter): Modus, eigene Domains, Sperrliste. */
export function KontaktabgleichVerwaltung() {
  const t = useT();
  const k = t.mail.kontakte;
  const v = k.verwaltung;
  const abfrage = useQuery(kontaktabgleichEinstellung());
  const speichern = useKontaktabgleichEinstellen();
  const [modus, setModus] = useState<Modus>("aus");
  const [domains, setDomains] = useState("");
  const [sperrliste, setSperrliste] = useState("");
  const [gespeichert, setGespeichert] = useState(false);
  useEffect(() => {
    if (!abfrage.data) return;
    setModus(abfrage.data.modus);
    setDomains(abfrage.data.eigeneDomains.join("\n"));
    setSperrliste(abfrage.data.sperrliste.join("\n"));
  }, [abfrage.data]);
  return (
    <>
      <h2 className="cw-t-untertitel app-karte__titel">{k.titel}</h2>
      <p>{v.einleitung}</p>
      {abfrage.isPending ? <Skelettzeilen /> : null}
      <FehlerHinweis fehler={abfrage.error ?? speichern.error} />
      {abfrage.data ? (
        <form
          className="app-formular"
          onSubmit={(ev) => {
            ev.preventDefault();
            setGespeichert(false);
            speichern.mutate({ modus, eigeneDomains: zeilen(domains), sperrliste: zeilen(sperrliste) }, { onSuccess: () => setGespeichert(true) });
          }}
        >
          <div className="app-gruppe">
            <span className="cw-feld__label" id="kontaktabgleich-modus">
              {v.modus}
            </span>
            <Segment<Modus> aria-labelledby="kontaktabgleich-modus" value={modus} onChange={setModus} options={(["aus", "vorschlag", "direkt"] as const).map((m) => ({ wert: m, label: v.modi[m] ?? m }))} />
            <p className="app-leer-text">{v.modusHilfe[modus]}</p>
          </div>
          <Textbereich label={v.eigeneDomains} hilfe={v.eigeneDomainsHilfe} rows={3} value={domains} onChange={(ev) => setDomains(ev.target.value)} />
          <Textbereich label={v.sperrliste} hilfe={v.sperrlisteHilfe} rows={4} value={sperrliste} onChange={(ev) => setSperrliste(ev.target.value)} />
          <div className="app-aktionen">
            <Button type="submit" disabled={speichern.isPending}>
              {v.speichern}
            </Button>
          </div>
          <p role="status">{gespeichert ? v.gespeichert : ""}</p>
        </form>
      ) : null}
    </>
  );
}

/** Hinweis auf offene Vorschläge über der Kontaktliste; nur für Bearbeiter im Bereich Kontakte, ohne Vorschläge nichts. */
export function KontaktvorschlaegeHinweis() {
  const k = useT().mail.kontakte;
  const { darf } = useRechte();
  const erlaubt = darf("bearbeiter", null, "kontakte");
  const abfrage = useQuery({ ...kontaktvorschlaege(), enabled: erlaubt });
  const anzahl = abfrage.data?.daten.length ?? 0;
  if (!erlaubt || anzahl === 0) return null;
  return (
    <Hinweis>
      {k.einstieg(anzahl)} <Link to="/contacts/suggestions">{k.ansehen}</Link>
    </Hinweis>
  );
}

/** Herkunft eines Kontakts aus Postfach oder Kalender: aus wessen Postfach, wann; nie welche Mails. */
export function KontaktHerkunft({ herkunft }: { herkunft: { bereich: string; angelegtAm: string; von: string | null } | null | undefined }) {
  const k = useT().mail.kontakte;
  const sprache = useSprache();
  if (!herkunft) return null;
  return <p className="app-leer-text">{k.herkunft(herkunft.von, k.herkunftBereich[herkunft.bereich] ?? herkunft.bereich, formatZeitpunkt(herkunft.angelegtAm, sprache))}</p>;
}
