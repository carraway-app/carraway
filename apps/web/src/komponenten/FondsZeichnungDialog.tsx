import { useState } from "react";
import { Button, Hinweis, Seitenpanel, Tabelle } from "@carraway/ui";
import { useFondsZeichnungenAnlegen, useFondsZusageBearbeiten, useFondsZusageEntfernen } from "../api/verwaltung";
import { alle } from "../erweiterung";
import { useSprache, useT } from "../i18n";
import { feldText } from "../i18n/fehler";
import { betragRegel } from "../lib/feldpruefung";
import { formatBetragCent, formatSatz } from "../lib/zahl";
import { BetragFeld } from "./BetragFeld";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragFuerFeld, betragOderNichts, pruefungText } from "./formular";
import { OrganisationNeuDialog } from "./OrganisationDialoge";
import { VerknuepfungsFeld, type SuchfeldTreffer } from "./Suchfeld";
import { ZusagenAbdeckung } from "./ZusagenAbdeckung";

export interface ErfassteZusage {
  id: string;
  name: string;
  zusage: string;
  anteil: string;
}

interface Props {
  fondsId: string;
  zeichnungskapital: string;
  waehrung: string;
  /** Bereits erfasste Zusagen und ihre Summe (aus der Sicht der Zeichnungen, nach jeder Änderung neu geladen). */
  zeichnungen: ErfassteZusage[];
  abgedeckt: string;
  onSchliessen: () => void;
}

const zusageRegel = betragRegel({ vorzeichen: "positiv", pflicht: true });

/**
 * Erfassung der LP-Zusagen eines Fonds, auch schrittweise (Issue #275): einzelne Zusagen hinzufügen, bearbeiten und entfernen. Die Summe
 * darf das Zeichnungskapital nicht überschreiten; bis sie es abdeckt, zeigt der Dialog die Abdeckung an.
 */
export function FondsZeichnungDialog({ fondsId, zeichnungskapital, waehrung, zeichnungen, abgedeckt, onSchliessen }: Props) {
  const t = useT();
  const sprache = useSprache();
  const v = t.verwaltung.investoren;
  const z = v.fonds.zeichnungen;
  const anlegen = useFondsZeichnungenAnlegen(fondsId);
  const bearbeiten = useFondsZusageBearbeiten(fondsId);
  const entfernen = useFondsZusageEntfernen(fondsId);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [organisation, setOrganisation] = useState<SuchfeldTreffer | null>(null);
  // „„<Eingabe>“ anlegen“ aus dem Suchfeld: Anlage-Dialog einer Investor-Organisation, vorbefüllt mit der Eingabe.
  const [neuAnlegen, setNeuAnlegen] = useState<string | null>(null);
  const [zusage, setZusage] = useState("");
  const [versucht, setVersucht] = useState(false);
  const [beruehrt, setBeruehrt] = useState(false);
  const [inBearbeitung, setInBearbeitung] = useState<{ id: string; name: string; zusage: string; versucht: boolean } | null>(null);
  const pruefe = (wert: string) => zusageRegel(wert, {}, { sprache });
  const erfasst = new Set(zeichnungen.map((zeile) => zeile.id));
  const vollstaendig = Number(abgedeckt) >= Number(zeichnungskapital);
  const rest = Math.max(0, Math.round((Number(zeichnungskapital) - Number(abgedeckt)) * 100) / 100);

  function hinzufuegen() {
    setVersucht(true);
    if (organisation === null || pruefe(zusage) !== undefined) return;
    setMeldung(null);
    anlegen.mutate({ zeichnungen: [{ organisationId: organisation.id, zusage: betragOderNichts(zusage, sprache) ?? "" }] }, {
      onSuccess: () => {
        setOrganisation(null);
        setZusage("");
        setVersucht(false);
        setBeruehrt(false);
        setMeldung(z.gespeichert);
      },
    });
  }

  function speichern() {
    if (!inBearbeitung) return;
    if (pruefe(inBearbeitung.zusage) !== undefined) {
      setInBearbeitung({ ...inBearbeitung, versucht: true });
      return;
    }
    setMeldung(null);
    bearbeiten.mutate({ organisationId: inBearbeitung.id, zusage: betragOderNichts(inBearbeitung.zusage, sprache) ?? "" }, {
      onSuccess: () => {
        setInBearbeitung(null);
        setMeldung(z.geaendert);
      },
    });
  }

  const zusageFehler = (() => {
    const p = pruefe(zusage);
    return p && (versucht || beruehrt || p.sofort) ? pruefungText(sprache, p) : feldText(t, anlegen.error, "zeichnungen.0.zusage");
  })();

  if (neuAnlegen !== null) {
    return (
      <OrganisationNeuDialog
        namensvorschlag={neuAnlegen}
        art="investor"
        onSchliessen={() => setNeuAnlegen(null)}
        onAngelegt={(neu) => {
          setOrganisation({ id: neu.id, label: neu.name, info: [t.organisationArt[neu.art], neu.ort].filter(Boolean).join(" · ") });
          setNeuAnlegen(null);
        }}
      />
    );
  }

  return (
    <Seitenpanel titel={z.anlegen} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{z.anlegen}</h2>
      <p>{z.verteilung}</p>
      {/* Hinweise der Erweiterungen (z. B. Wirkung auf Konten im LP-Portal); ohne Erweiterung erscheint nichts. */}
      {alle("zeichnungHinweis").map((ZeichnungHinweis, i) => <ZeichnungHinweis key={i} />)}
      <p>{z.kapital} <strong>{formatBetragCent(zeichnungskapital, sprache, waehrung)}</strong></p>
      {vollstaendig ? null : <ZusagenAbdeckung abgedeckt={abgedeckt} zeichnungskapital={zeichnungskapital} waehrung={waehrung} />}
      {meldung ? <Hinweis>{meldung}</Hinweis> : null}
      <FehlerHinweis fehler={entfernen.error} />

      <h3 className="cw-t-untertitel">{z.erfasst}</h3>
      {zeichnungen.length > 0 ? (
        <Tabelle
          beschriftung={z.erfasst}
          zeilen={zeichnungen}
          zeilenSchluessel={(zeile) => zeile.id}
          spalten={[
            { schluessel: "name", kopf: v.form.organisation, zelle: (zeile) => zeile.name },
            { schluessel: "zusage", kopf: z.zusage, zahl: true, zelle: (zeile) => formatBetragCent(zeile.zusage, sprache, waehrung) },
            { schluessel: "anteil", kopf: z.anteil, zahl: true, zelle: (zeile) => formatSatz(zeile.anteil, sprache) },
            {
              schluessel: "aktion",
              kopf: <span className="cw-nur-lesen">{v.spalten.aktion}</span>,
              zelle: (zeile) => (
                <div className="app-knoepfe">
                  <Button variante="ruhig" aria-label={z.bearbeitenFuer(zeile.name)} onClick={() => setInBearbeitung({ id: zeile.id, name: zeile.name, zusage: betragFuerFeld(zeile.zusage), versucht: false })}>{t.gemeinsam.bearbeiten}</Button>
                  <Button
                    variante="ruhig"
                    aria-label={z.entfernenFuer(zeile.name)}
                    disabled={entfernen.isPending}
                    onClick={() => {
                      setMeldung(null);
                      entfernen.mutate(zeile.id, { onSuccess: () => setMeldung(z.entfernt) });
                    }}
                  >
                    {t.gemeinsam.entfernen}
                  </Button>
                </div>
              ),
            },
          ]}
        />
      ) : (
        <p className="app-leer-text">{z.keineErfasst}</p>
      )}

      {inBearbeitung ? (
        <form
          className="app-formular"
          noValidate
          aria-label={z.bearbeitenFuer(inBearbeitung.name)}
          onSubmit={(e) => {
            e.preventDefault();
            speichern();
          }}
        >
          <h3 className="cw-t-untertitel">{z.bearbeitenFuer(inBearbeitung.name)}</h3>
          <FehlerHinweis fehler={bearbeiten.error} bekannt={["zusage"]} />
          <BetragFeld
            label={z.zusage}
            required
            name="zusage-bearbeiten"
            value={inBearbeitung.zusage}
            onChange={(e) => setInBearbeitung({ ...inBearbeitung, zusage: e.target.value })}
            fehler={(() => {
              const p = pruefe(inBearbeitung.zusage);
              return p && (inBearbeitung.versucht || p.sofort) ? pruefungText(sprache, p) : feldText(t, bearbeiten.error, "zusage");
            })()}
          />
          <div className="app-knoepfe">
            <Button variante="sekundaer" onClick={() => setInBearbeitung(null)}>{z.abbrechen}</Button>
            <Button type="submit" disabled={bearbeiten.isPending}>{z.speichern}</Button>
          </div>
        </form>
      ) : null}

      <h3 className="cw-t-untertitel">{z.neu}</h3>
      {vollstaendig ? null : (
        <form
          className="app-formular"
          noValidate
          aria-label={z.neu}
          onSubmit={(e) => {
            e.preventDefault();
            hinzufuegen();
          }}
        >
          <FehlerHinweis fehler={anlegen.error} bekannt={["zeichnungen.0.zusage"]} />
          <p>{z.offen(formatBetragCent(rest, sprache, waehrung))}</p>
          {/* Suche über die Investor-Organisationen statt einer Liste aller; bereits erfasste stehen nicht zur Wahl. */}
          <VerknuepfungsFeld
            label={v.form.organisation}
            name="organisation"
            required
            ziel="organisation"
            art="investor"
            ausschliessen={erfasst}
            wert={organisation}
            onWahl={setOrganisation}
            onNeu={setNeuAnlegen}
            fehler={versucht && organisation === null ? pruefungText(sprache, { code: "pflicht" }) : feldText(t, anlegen.error, "zeichnungen.0.organisationId")}
          />
          <BetragFeld label={z.zusage} required name="zusage-neu" value={zusage} onChange={(e) => setZusage(e.target.value)} onBlur={() => setBeruehrt(true)} fehler={zusageFehler} />
          <div className="app-knoepfe">
            <Button type="submit" disabled={anlegen.isPending}>{z.hinzufuegen}</Button>
          </div>
        </form>
      )}
    </Seitenpanel>
  );
}
