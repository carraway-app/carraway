import { Bereichskopf } from "../komponenten/Bereichskopf";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Auswahl, Button, Fakten, Feld, Hinweis, Seitenpanel, Tabelle, formatBetrag, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { fondsUebersicht } from "../api/abfragen";
import { heuteIso } from "../api/datum";
import { fondsReserven, useReserveSetzen, type ReservenDaten } from "../api/szenarien";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { Rechenweg } from "../komponenten/Rechenweg";
import { Skelettzeilen } from "../komponenten/Skelett";
import { useSprache, useT } from "../i18n";
import { useRechte } from "../lib/rechte";

const route = getRouteApi("/fonds/$fondsId/reserven");

type Zeile = ReservenDaten["reserven"][number];

/**
 * Reserven eines Fonds: geplante Reserve für Folgeinvestitionen je Beteiligung gegen die Auszahlungen seit Planbeginn und der Betrag,
 * der für Neuinvestitionen verfügbar bleibt (mit Rechenweg). Planen darf ein Bearbeiter; die Rechnung liegt auf dem Server.
 */
export function ReservenSeite() {
  const t = useT();
  const z = t.szenarien.reservenSeite;
  const sprache = useSprache();
  const { fondsId } = route.useParams();
  const { data, error, isPending } = useQuery(fondsReserven(fondsId));
  const uebersicht = useQuery(fondsUebersicht(fondsId));
  const { darf } = useRechte();
  const [planen, setPlanen] = useState(false);
  const [beteiligungId, setBeteiligungId] = useState("");
  const [betrag, setBetrag] = useState("");
  const [gueltigAb, setGueltigAb] = useState(heuteIso());
  const [bemerkung, setBemerkung] = useState("");
  const setzen = useReserveSetzen(fondsId, beteiligungId);
  const aktive = (uebersicht.data?.beteiligungen ?? []).filter((b) => b.status === "aktiv");

  const spalten: TabelleSpalte<Zeile>[] = [
    { schluessel: "unternehmen", kopf: z.spalten.unternehmen, zelle: (r) => r.organisation },
    { schluessel: "geplant", kopf: z.spalten.geplant, zahl: true, zelle: (r) => formatBetrag(r.geplant, sprache) },
    { schluessel: "ab", kopf: z.spalten.gueltigAb, zelle: (r) => (r.gueltigAb ? formatDatum(r.gueltigAb, sprache) : t.gemeinsam.keinWert) },
    { schluessel: "verbraucht", kopf: z.spalten.verbraucht, zahl: true, zelle: (r) => formatBetrag(r.verbraucht, sprache) },
    { schluessel: "offen", kopf: z.spalten.offen, zahl: true, zelle: (r) => formatBetrag(r.offen, sprache) },
  ];

  return (
    <div className="app-seite">
      <Bereichskopf titel={z.titel}>
        {darf("bearbeiter", fondsId, "portfolio") ? (
          <Button groesse="s" onClick={() => setPlanen(true)}>
            {z.planen}
          </Button>
        ) : null}
      </Bereichskopf>
      <p className="app-leer-text">{z.beschreibung}</p>

      <section className="app-karte" aria-label={z.titel}>
        {isPending ? (
          <Skelettzeilen anzahl={3} />
        ) : error || !data ? (
          <FehlerHinweis fehler={error} />
        ) : (
          <>
            {data.reserven.length === 0 ? <p className="app-leer-text">{z.keine}</p> : <Tabelle dicht beschriftung={`${z.spalten.unternehmen} · ${z.spalten.geplant}`} spalten={spalten} zeilen={data.reserven} zeilenSchluessel={(r) => r.beteiligungId} />}
            <Fakten
              darstellung="liste"
              eintraege={[
                { label: z.summeOffen, wert: <span className="app-zahl">{formatBetrag(data.summeOffen, sprache)}</span> },
                {
                  label: z.gebuehren,
                  wert: (
                    <>
                      <span className="app-zahl">{formatBetrag(data.gebuehrenPrognose, sprache)}</span> · {data.szenario ? z.szenario(data.szenario.name) : z.keinSzenario}
                    </>
                  ),
                },
                { label: z.verfuegbar, wert: <strong className="app-zahl">{formatBetrag(data.verfuegbar, sprache)}</strong> },
              ]}
            />
            {data.befunde.map((b) => (
              <Hinweis key={b.code} variante={b.schwere === "warnung" ? "fehler" : "info"}>
                {z.befunde[b.code] ?? b.code}
              </Hinweis>
            ))}
            <details>
              <summary>{z.herkunft}</summary>
              <Rechenweg titel={z.verfuegbar} stichtag={data.stichtag} schritte={data.schritte} />
            </details>
          </>
        )}
      </section>

      {planen && darf("bearbeiter", fondsId, "portfolio") ? (
        <Seitenpanel titel={z.planen} onSchliessen={() => setPlanen(false)}>
        <h2 className="cw-t-untertitel">{z.planen}</h2>
        <form
          className="app-formular"
          aria-label={z.planen}
          onSubmit={(e) => {
            e.preventDefault();
            setzen.mutate(
              { betrag, gueltigAb, bemerkung: bemerkung || null },
              {
                onSuccess: () => {
                  setBetrag("");
                  setBemerkung("");
                  setPlanen(false);
                },
              },
            );
          }}
        >
          <FehlerHinweis fehler={setzen.error} />
          <Auswahl label={z.felder.beteiligung} value={beteiligungId} onChange={(e) => setBeteiligungId(e.target.value)} required>
            <option value="">–</option>
            {aktive.map((b) => (
              <option key={b.id} value={b.id}>
                {b.organisation.name}
              </option>
            ))}
          </Auswahl>
          <Feld label={z.felder.betrag} value={betrag} inputMode="decimal" onChange={(e) => setBetrag(e.target.value)} zahl required />
          <Feld label={z.felder.gueltigAb} type="date" value={gueltigAb} onChange={(e) => setGueltigAb(e.target.value)} required />
          <Feld label={z.felder.bemerkung} value={bemerkung} onChange={(e) => setBemerkung(e.target.value)} />
          <div>
            <Button type="submit" disabled={setzen.isPending || !beteiligungId}>
              {z.speichern}
            </Button>
          </div>
        </form>
        </Seitenpanel>
      ) : null}
    </div>
  );
}
