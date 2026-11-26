import { useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Dialog, Feld as Eingabe, Hinweis, Seitenpanel, Status, Tabelle, XIcon, formatDatum, type MenueEintrag, type TabelleSpalte } from "@carraway/ui";
import { crmBeschaeftigungen, useBeschaeftigungAendern, useBeschaeftigungAnlegen, useBeschaeftigungLoeschen } from "../../api/crm";
import { useRolleAnlegen, useRolleLoeschen } from "../../api/mutationen";
import { aufzaehlung, useSprache, useT } from "../../i18n";
import { FehlerHinweis } from "../FehlerHinweis";
import { KontaktAuswahl, type Treffer } from "../KontaktAuswahl";
import { PersonDialog } from "../PersonDialog";
import { KONTAKT_ROLLEN, type RollenZeile } from "../Rollen";
import { baueVerbindungen, type AltePerson, type Verbindung } from "./verbindungenLogik";
import { Datensatzlink } from "./Datensatzlink";
import { Chip, Schnellaktionen } from "./Zelle";

type Dialogzustand = null | { art: "verknuepfen" } | { art: "neuerKontakt" } | { art: "bearbeiten"; z: Verbindung } | { art: "rolle"; z: Verbindung } | { art: "loesen"; z: Verbindung } | { art: "kontakt"; person: AltePerson };

interface Props {
  /** Auf welcher Seite die Tabelle steht: `organisation` zeigt ihre Kontakte, `person` die Unternehmen des Kontakts. */
  seite: "organisation" | "person";
  id: string;
  /** Rollen aus dem Datensatz (Begriff der Kontaktrollen, bleibt erhalten und steht als Etiketten in der Zeile). */
  rollen: RollenZeile[];
  /** Ältere Personenliste der Organisation; ihre Personen ohne Beschäftigung erscheinen trotzdem. */
  altePersonen?: AltePerson[];
  schreiben: boolean;
}

/** Zahl der verschiedenen Personen bzw. Unternehmen in der Tabelle (für den Zähler am Reiter). */
export function useVerbindungen(seite: Props["seite"], id: string, rollen: RollenZeile[], altePersonen?: AltePerson[]) {
  const abfrage = useQuery(crmBeschaeftigungen(seite === "organisation" ? { organisationId: id } : { personId: id }));
  const zeilen = useMemo(() => baueVerbindungen(seite, abfrage.data ?? [], rollen, altePersonen), [seite, abfrage.data, rollen, altePersonen]);
  return { abfrage, zeilen };
}

/**
 * Die eine Tabelle der Verbindungen zwischen Kontakten und Unternehmen: auf der Seite des Unternehmens seine Kontakte, auf der Seite des Kontakts seine Unternehmen.
 * Je Zeile Funktion, Zeitraum, Kennzeichen „Hauptunternehmen“, Rollen als Etiketten und die Schnellaktionen (Mail, Telefon, LinkedIn, Website). Verknüpfen läuft in einer Schublade.
 */
export function Verbindungen({ seite, id, rollen, altePersonen, schreiben }: Props) {
  const t = useT();
  const sprache = useSprache();
  const { abfrage, zeilen } = useVerbindungen(seite, id, rollen, altePersonen);
  const entfernen = useRolleLoeschen();
  const [dialog, setDialog] = useState<Dialogzustand>(null);
  const zu = () => setDialog(null);
  const keinWert = t.gemeinsam.keinWert;
  const person = seite === "organisation";

  const spalten: TabelleSpalte<Verbindung>[] = [
    {
      schluessel: "name",
      kopf: person ? t.crm.spalteKontakt : t.crm.spalteUnternehmen,
      zelle: (z) => (
        <span className="app-verbindung__name">
          <Datensatzlink objekt={person ? "person" : "organisation"} id={z.gegenId}>{z.name}</Datensatzlink>
          <Schnellaktionen werte={{ email: z.email, telefon: z.telefon, linkedin: z.linkedin, website: z.website }} name={z.name} />
        </span>
      ),
    },
    { schluessel: "funktion", kopf: t.crm.funktion, zelle: (z) => z.funktion ?? keinWert },
    {
      schluessel: "rollen",
      kopf: t.crm.spalteRollen,
      zelle: (z) =>
        z.rollen.length === 0 ? (
          keinWert
        ) : (
          <span className="app-chips">
            {z.rollen.map((r) => {
              const label = aufzaehlung(t.kontaktRolle, r.rolle);
              return (
                <Chip key={r.id} farbe="grau" title={[r.von ? t.crm.seit(formatDatum(r.von, sprache)) : null, r.bis ? t.crm.bis(formatDatum(r.bis, sprache)) : t.rollen.unbefristet].filter(Boolean).join(" · ")}>
                  {label}
                  {schreiben ? (
                    <button type="button" className="app-chip__entfernen" disabled={entfernen.isPending} aria-label={t.crm.rolleEntfernenChip(label, z.name)} onClick={() => entfernen.mutate(r.id)}>
                      <XIcon />
                    </button>
                  ) : null}
                </Chip>
              );
            })}
          </span>
        ),
    },
    {
      schluessel: "zeitraum",
      kopf: t.crm.spalteZeitraum,
      zelle: (z) => {
        const text = [z.von ? t.crm.seit(formatDatum(z.von, sprache)) : null, z.bis ? t.crm.bis(formatDatum(z.bis, sprache)) : null].filter(Boolean).join(" · ");
        return (
          <span className="app-verbindung__zeitraum">
            {text || (z.beschaeftigungId === null && z.rollen.length > 0 ? <span className="app-zelle__leer">{t.crm.nurRolle}</span> : keinWert)}
            {z.haupt && z.beschaeftigungId !== null ? <Status variante="freigegeben">{t.crm.hauptunternehmen}</Status> : null}
          </span>
        );
      },
    },
  ];

  const aktionen = (z: Verbindung): MenueEintrag[] => {
    if (!schreiben) return [];
    return [
      ...(z.beschaeftigungId ? [{ id: "bearbeiten", label: t.crm.verbindungBearbeiten, onClick: () => setDialog({ art: "bearbeiten", z }) }] : []),
      ...(person && z.altePerson && (z.haupt || z.beschaeftigungId === null) ? [{ id: "kontakt", label: t.crm.kontaktBearbeiten, onClick: () => setDialog({ art: "kontakt", person: z.altePerson! }) }] : []),
      { id: "rolle", label: t.rollen.hinzufuegen, onClick: () => setDialog({ art: "rolle", z }) },
      ...(z.beschaeftigungId ? [{ id: "loesen", label: t.crm.verknuepfungLoesen, gefahr: true, trennerDavor: true, onClick: () => setDialog({ art: "loesen", z }) }] : []),
    ];
  };

  return (
    <div className="app-verbindungen app-karte">
      <div className="app-verbindungen__kopf">
        <span className="app-dubletten__info" role="status">
          {abfrage.data ? t.crm.anzahlVerbindungen(zeilen.length) : t.gemeinsam.laedt}
        </span>
        {schreiben ? (
          <span className="app-verbindungen__aktionen">
            <Button variante="sekundaer" onClick={() => setDialog({ art: "verknuepfen" })}>
              {person ? t.crm.kontaktVerknuepfen : t.crm.unternehmenVerknuepfen}
            </Button>
            {person ? (
              <Button variante="sekundaer" onClick={() => setDialog({ art: "neuerKontakt" })}>
                {t.crm.neuKontakt}
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
      <FehlerHinweis fehler={abfrage.error ?? entfernen.error} />
      <Tabelle
        dicht
        beschriftung={person ? t.crm.kontakteDesUnternehmens : t.crm.unternehmenDerPerson}
        spalten={spalten}
        zeilen={zeilen}
        zeilenSchluessel={(z) => z.schluessel}
        aktionen={aktionen}
        laedt={abfrage.isPending}
        leer={<p className="app-leer-text">{t.crm.keineBeschaeftigungen}</p>}
      />
      {dialog?.art === "verknuepfen" ? <VerknuepfenDialog seite={seite} id={id} vorhanden={zeilen} onOeffnen={(z) => setDialog({ art: "bearbeiten", z })} onSchliessen={zu} /> : null}
      {dialog?.art === "neuerKontakt" ? <PersonDialog organisationId={id} onSchliessen={zu} /> : null}
      {dialog?.art === "kontakt" ? <PersonDialog organisationId={id} person={dialog.person} onSchliessen={zu} /> : null}
      {dialog?.art === "bearbeiten" ? <VerknuepfenDialog seite={seite} id={id} bearbeiten={dialog.z} onSchliessen={zu} /> : null}
      {dialog?.art === "rolle" ? <RolleFestDialog seite={seite} id={id} z={dialog.z} onSchliessen={zu} /> : null}
      {dialog?.art === "loesen" ? <LoesenDialog z={dialog.z} onSchliessen={zu} /> : null}
    </div>
  );
}

/** Verknüpfen (mit Suche, Funktion, Zeitraum, Hauptunternehmen und optionaler Rolle) oder, mit `bearbeiten`, Funktion und Zeitraum einer Beschäftigung ändern. */
function VerknuepfenDialog({ seite, id, bearbeiten, vorhanden = [], onOeffnen, onSchliessen }: { seite: Props["seite"]; id: string; bearbeiten?: Verbindung; vorhanden?: Verbindung[]; onOeffnen?: (z: Verbindung) => void; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const anlegen = useBeschaeftigungAnlegen();
  const aendern = useBeschaeftigungAendern();
  const rolleAnlegen = useRolleAnlegen();
  const [gewaehlt, setGewaehlt] = useState<Treffer | null>(null);
  const [ohneWahl, setOhneWahl] = useState(false);
  const [funktion, setFunktion] = useState(bearbeiten?.funktion ?? "");
  const [von, setVon] = useState(bearbeiten?.von ?? "");
  const [bis, setBis] = useState(bearbeiten?.bis ?? "");
  const [haupt, setHaupt] = useState(bearbeiten?.haupt ?? false);
  const [rolle, setRolle] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  // Schlägt die Rolle fehl, ist die Beschäftigung schon angelegt: ein erneutes Senden legt dann nur noch die Rolle an (keine zweite Beschäftigung).
  const [angelegt, setAngelegt] = useState(false);
  const titel = bearbeiten ? t.crm.verbindungBearbeitenTitel(bearbeiten.name) : seite === "organisation" ? t.crm.kontaktVerknuepfen : t.crm.unternehmenVerknuepfen;
  const art = seite === "organisation" ? "person" : "organisation";
  // Dieselbe Verbindung gibt es schon: Hinweis mit Weg zur bestehenden Zeile; ein weiterer Eintrag (z. B. anderer Zeitraum) bleibt erlaubt.
  const doppelt = !bearbeiten && gewaehlt ? vorhanden.filter((z) => z.gegenId === gewaehlt.id && z.beschaeftigungId !== null) : [];
  const beschreibung = (z: Verbindung) => [z.funktion, z.von ? t.crm.seit(formatDatum(z.von, sprache)) : null, z.bis ? t.crm.bis(formatDatum(z.bis, sprache)) : null].filter(Boolean).join(" · ");

  async function senden(e: FormEvent) {
    e.preventDefault();
    setLaeuft(true);
    try {
      if (bearbeiten?.beschaeftigungId) {
        await aendern.mutateAsync({ id: bearbeiten.beschaeftigungId, funktion: funktion.trim() || null, von: von || null, bis: bis || null, haupt });
      } else {
        if (!gewaehlt) {
          setOhneWahl(true);
          return;
        }
        const personId = seite === "person" ? id : gewaehlt.id;
        const organisationId = seite === "organisation" ? id : gewaehlt.id;
        if (!angelegt) {
          await anlegen.mutateAsync({ personId, organisationId, ...(funktion.trim() ? { funktion: funktion.trim() } : {}), ...(von ? { von } : {}), ...(bis ? { bis } : {}), haupt });
          setAngelegt(true);
        }
        if (rolle) await rolleAnlegen.mutateAsync({ personId, organisationId, rolle: rolle as (typeof KONTAKT_ROLLEN)[number] });
      }
      onSchliessen();
    } catch {
      // Der Fehler steht im Hinweis des Formulars.
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <Seitenpanel titel={titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{titel}</h2>
      <form className="app-formular" noValidate onSubmit={(e) => void senden(e)}>
        <FehlerHinweis fehler={anlegen.error ?? aendern.error ?? rolleAnlegen.error} />
        {bearbeiten ? null : (
          <KontaktAuswahl art={art} label={art === "person" ? t.crm.kontaktWaehlen : t.crm.unternehmenWaehlen} gewaehlt={gewaehlt} onWaehlen={setGewaehlt} fehler={ohneWahl && !gewaehlt ? t.auswahl.waehlen : undefined} />
        )}
        {doppelt.length > 0 ? (
          <div className="app-verbindung__doppelt">
            <Hinweis>{doppelt.length === 1 ? t.crm.verbindungBesteht : t.crm.verbindungenBestehen(doppelt.length)}</Hinweis>
            <ul className="app-verbindung__vorhanden">
              {doppelt.map((z) => (
                <li key={z.schluessel}>
                  <span>{beschreibung(z) || t.gemeinsam.keinWert}</span>
                  {onOeffnen ? (
                    <Button variante="sekundaer" onClick={() => onOeffnen(z)}>
                      {t.crm.bestehendeOeffnen}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <Eingabe label={t.crm.funktion} value={funktion} onChange={(e) => setFunktion(e.target.value)} />
        <Eingabe label={t.crm.seitOptional} type="date" value={von} onChange={(e) => setVon(e.target.value)} />
        <Eingabe label={t.crm.bisOptional} type="date" value={bis} onChange={(e) => setBis(e.target.value)} />
        <label className="app-schalter">
          <input type="checkbox" checked={haupt} onChange={(e) => setHaupt(e.target.checked)} />
          {t.crm.alsHauptunternehmen}
        </label>
        {bearbeiten ? null : (
          <Auswahl label={t.crm.rolleOptional} value={rolle} onChange={(e) => setRolle(e.target.value)}>
            <option value="">{t.crm.ohneRolle}</option>
            {KONTAKT_ROLLEN.map((r) => (
              <option key={r} value={r}>
                {t.kontaktRolle[r]}
              </option>
            ))}
          </Auswahl>
        )}
        <div>
          <Button type="submit" disabled={laeuft}>
            {bearbeiten ? t.crm.speichern : t.crm.verknuepfen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

/** Rolle für eine Zeile hinzufügen: Person und Unternehmen stehen fest. */
function RolleFestDialog({ seite, id, z, onSchliessen }: { seite: Props["seite"]; id: string; z: Verbindung; onSchliessen: () => void }) {
  const t = useT();
  const anlegen = useRolleAnlegen();
  const [rolle, setRolle] = useState<string>("berater");
  const [von, setVon] = useState("");
  const [bis, setBis] = useState("");
  const titel = t.crm.rolleHinzufuegenTitel(z.name);
  return (
    <Seitenpanel titel={titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{titel}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          anlegen.mutate(
            { personId: seite === "person" ? id : z.gegenId, organisationId: seite === "organisation" ? id : z.gegenId, rolle: rolle as (typeof KONTAKT_ROLLEN)[number], ...(von ? { von } : {}), ...(bis ? { bis } : {}) },
            { onSuccess: onSchliessen },
          );
        }}
      >
        <FehlerHinweis fehler={anlegen.error} />
        <Auswahl label={t.rollen.form.rolle} value={rolle} onChange={(e) => setRolle(e.target.value)}>
          {KONTAKT_ROLLEN.map((r) => (
            <option key={r} value={r}>
              {t.kontaktRolle[r]}
            </option>
          ))}
        </Auswahl>
        <Eingabe label={t.rollen.form.von} type="date" value={von} onChange={(e) => setVon(e.target.value)} />
        <Eingabe label={t.rollen.form.bis} type="date" value={bis} onChange={(e) => setBis(e.target.value)} />
        <div>
          <Button type="submit" disabled={anlegen.isPending}>
            {t.rollen.form.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

function LoesenDialog({ z, onSchliessen }: { z: Verbindung; onSchliessen: () => void }) {
  const t = useT();
  const loeschen = useBeschaeftigungLoeschen();
  return (
    <Dialog
      titel={t.crm.verknuepfungLoesenTitel(z.name)}
      onSchliessen={onSchliessen}
      aktionen={
        <>
          <Button variante="sekundaer" onClick={onSchliessen}>
            {t.crm.abbrechen}
          </Button>
          <Button variante="gefahr" disabled={loeschen.isPending} onClick={() => loeschen.mutate(z.beschaeftigungId!, { onSuccess: onSchliessen })}>
            {t.crm.verknuepfungLoesen}
          </Button>
        </>
      }
    >
      <FehlerHinweis fehler={loeschen.error} />
      <p>{t.crm.verknuepfungLoesenFrage}</p>
    </Dialog>
  );
}
