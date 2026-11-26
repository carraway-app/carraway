import { ErwaehnenAuswahl, NotizText } from "./crm/Notiz";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Etikett, Feld, Hinweis, Status, Textbereich, formatDatum } from "@carraway/ui";
import { heuteIso } from "../api/datum";
import type { Aktivitaet } from "../api/abfragen";
import { useAktivitaetAnlegen, useWiedervorlageErledigt } from "../api/mutationen";
import { mailAnhaenge, useAnhangImportieren, useSyncEntfernen } from "../api/mail";
import { formatZeitpunkt } from "../lib/zeit";
import { QuelleZeichen } from "./QuelleZeichen";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { useRechte } from "../lib/rechte";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "./FehlerHinweis";
import { textOderNichts, useFormular } from "./formular";

export const AKTIVITAET_ARTEN = ["gespraech", "termin", "notiz", "mail"] as const;
type AktivitaetArt = (typeof AKTIVITAET_ARTEN)[number];

const FELDER = ["art", "datum", "titel", "notiz", "personId", "wiedervorlage"];

interface PersonKurz {
  id: string;
  vorname: string;
  nachname: string;
}

/** Aktivität erfassen (Gespräch, Termin, Notiz, Mail), auf Wunsch mit Wiedervorlage. */
export function AktivitaetDialog({
  organisationId,
  dealId,
  personId,
  personen,
  onSchliessen,
}: {
  organisationId: string;
  dealId?: string;
  personId?: string;
  personen: PersonKurz[];
  onSchliessen: () => void;
}) {
  const t = useT();
  const anlegen = useAktivitaetAnlegen();
  const { werte, setWerte, feld } = useFormular({ art: "gespraech", datum: heuteIso(), titel: "", notiz: "", personId: personId ?? "", wiedervorlage: "" });
  const f = t.aktivitaetForm;

  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          anlegen.mutate(
            {
              art: werte.art as AktivitaetArt,
              datum: werte.datum,
              titel: werte.titel.trim(),
              notiz: textOderNichts(werte.notiz),
              organisationId,
              ...(dealId ? { dealId } : {}),
              ...(werte.personId ? { personId: werte.personId } : {}),
              ...(werte.wiedervorlage ? { wiedervorlage: werte.wiedervorlage } : {}),
            },
            { onSuccess: onSchliessen },
          );
        }}
      >
        <FehlerHinweis fehler={anlegen.error} bekannt={FELDER} />
        <Auswahl label={f.art} {...feld("art")} fehler={feldText(t, anlegen.error, "art")}>
          {AKTIVITAET_ARTEN.map((art) => (
            <option key={art} value={art}>
              {t.aktivitaetArt[art]}
            </option>
          ))}
        </Auswahl>
        <Feld label={f.datum} type="date" {...feld("datum")} fehler={feldText(t, anlegen.error, "datum")} />
        <Feld label={f.titelFeld} autoComplete="off" {...feld("titel")} fehler={feldText(t, anlegen.error, "titel")} />
        <Textbereich markdown label={f.notiz} {...feld("notiz")} fehler={feldText(t, anlegen.error, "notiz")} />
        <ErwaehnenAuswahl onWaehlen={(text) => setWerte((alt) => ({ ...alt, notiz: `${alt.notiz}${alt.notiz && !alt.notiz.endsWith(" ") ? " " : ""}${text} ` }))} />
        {personen.length > 0 ? (
          <Auswahl label={f.person} {...feld("personId")} fehler={feldText(t, anlegen.error, "personId")}>
            <option value="">{f.keinePerson}</option>
            {personen.map((p) => (
              <option key={p.id} value={p.id}>
                {p.vorname} {p.nachname}
              </option>
            ))}
          </Auswahl>
        ) : null}
        <Feld
          label={f.wiedervorlage}
          type="date"
          hilfe={f.wiedervorlageHilfe}
          {...feld("wiedervorlage")}
          fehler={feldText(t, anlegen.error, "wiedervorlage")}
        />
        <div>
          <Button type="submit" disabled={anlegen.isPending}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

/** Zeitstrahl der Aktivitäten, neueste zuerst; offene Wiedervorlagen lassen sich als erledigt melden. */
export function AktivitaetenListe({ aktivitaeten }: { aktivitaeten: Aktivitaet[] }) {
  const t = useT();
  const sprache = useSprache();
  const erledigt = useWiedervorlageErledigt();
  const { darf } = useRechte();
  const [offen, setOffen] = useState<string | null>(null);
  const [entfernen, setEntfernen] = useState<Aktivitaet | null>(null);
  const [anhaenge, setAnhaenge] = useState<Aktivitaet | null>(null);
  const heute = heuteIso();

  if (aktivitaeten.length === 0) return <p className="app-leer-text">{t.aktivitaeten.keine}</p>;
  return (
    <>
      <FehlerHinweis fehler={erledigt.error} />
      <ol className="app-zeitstrahl" aria-label={t.aktivitaeten.titel}>
        {aktivitaeten.map((a) => {
          const faellig = a.wiedervorlage !== null && !a.wiedervorlageErledigtAm && a.wiedervorlage <= heute;
          return (
            <li key={a.id} className="app-zeitstrahl__eintrag">
              <div className="app-zeitstrahl__kopf">
                {a.sync ? <QuelleZeichen art={a.art === "termin" ? "termin" : "mail"} /> : null}
                <Etikett>{aufzaehlung(t.aktivitaetArt, a.art)}</Etikett>
                <time className="app-zahl" dateTime={a.sync ? a.sync.beginn : a.datum}>
                  {a.sync && a.art === "termin" ? formatZeitpunkt(a.sync.beginn, sprache) : formatDatum(a.datum, sprache)}
                </time>
                {a.sync ? (
                  <>
                    <Etikett>{aufzaehlung(t.mail.einstellungen.postfach.anbieter, a.sync.anbieter)}</Etikett>
                    {a.sync.richtung ? <span>{aufzaehlung({ eingehend: t.mail.zeitstrahl.eingehend, ausgehend: t.mail.zeitstrahl.ausgehend }, a.sync.richtung)}</span> : null}
                    <span>
                      {t.mail.zeitstrahl.aus} {a.sync.eigene ? t.mail.zeitstrahl.eigene : t.mail.zeitstrahl.fremde}
                    </span>
                  </>
                ) : null}
              </div>
              <p className="app-zeitstrahl__titel">{a.titel}</p>
              {a.sync?.absageGemeldet ? <p className="app-zeitstrahl__notiz">{t.mail.zeitstrahl.absageGemeldet}</p> : null}
              {a.sync && a.art === "termin" && a.sync.ende ? <p className="app-zeitstrahl__notiz">{t.mail.zeitstrahl.zeit(formatZeitpunkt(a.sync.beginn, sprache), formatZeitpunkt(a.sync.ende, sprache))}</p> : null}
              {a.notiz ? <NotizText text={a.notiz} /> : null}
              {a.wiedervorlage ? (
                <p className="app-zeitstrahl__wiedervorlage">
                  <span>
                    {t.aktivitaeten.wiedervorlage} {formatDatum(a.wiedervorlage, sprache)}
                  </span>
                  {a.wiedervorlageErledigtAm ? <Status variante="freigegeben">{t.aktivitaeten.erledigt}</Status> : null}
                  {faellig ? <Status variante="pruefung">{t.aktivitaeten.faellig}</Status> : null}
                  {!a.wiedervorlageErledigtAm && darf("bearbeiter") ? (
                    <Button
                      variante="sekundaer"
                      disabled={erledigt.isPending && offen === a.id}
                      aria-label={t.aktivitaeten.erledigtMelden(a.titel)}
                      onClick={() => {
                        setOffen(a.id);
                        erledigt.mutate(a.id);
                      }}
                    >
                      {t.aktivitaeten.erledigtKnopf}
                    </Button>
                  ) : null}
                </p>
              ) : null}
              {a.sync?.eigene && darf("betrachter") ? (
                <p className="app-zeitstrahl__wiedervorlage">
                  {a.art === "mail" && (a.sync.anbieter === "microsoft" || a.sync.anbieter === "google") ? (
                    <Button variante="sekundaer" aria-label={t.mail.anhaenge.knopfFuer(a.titel)} onClick={() => setAnhaenge(a)}>
                      {t.mail.anhaenge.knopf}
                    </Button>
                  ) : null}
                  <Button variante="ruhig" aria-label={t.mail.zeitstrahl.entfernenFuer(a.titel)} onClick={() => setEntfernen(a)}>
                    {t.mail.zeitstrahl.entfernen}
                  </Button>
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      {entfernen ? <EntfernenDialog aktivitaet={entfernen} onSchliessen={() => setEntfernen(null)} /> : null}
      {anhaenge ? <AnhaengeDialog aktivitaet={anhaenge} onSchliessen={() => setAnhaenge(null)} /> : null}
    </>
  );
}

/** Anhänge einer synchronisierten Mail: Die Liste kommt erst beim Öffnen, live vom Anbieter; übernommen wird nur, was die Person einzeln anklickt. */
function AnhaengeDialog({ aktivitaet, onSchliessen }: { aktivitaet: Aktivitaet; onSchliessen: () => void }) {
  const t = useT();
  const a = t.mail.anhaenge;
  const sprache = useSprache();
  const liste = useQuery(mailAnhaenge(aktivitaet.id));
  const importieren = useAnhangImportieren();
  const [fertig, setFertig] = useState<Record<string, string>>({});
  const { darf } = useRechte();
  return (
    <Seitenpanel titel={a.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{a.titel}</h2>
      <p className="app-leer-text">{aktivitaet.titel}</p>
      <Hinweis>{a.hinweis}</Hinweis>
      <FehlerHinweis fehler={liste.error ?? importieren.error} />
      {liste.isPending ? <div className="app-skelett app-skelett--zeile" aria-hidden="true" /> : null}
      {liste.data && liste.data.length === 0 ? <p className="app-leer-text">{a.keine}</p> : null}
      {liste.data && liste.data.length > 0 ? (
        <ul className="app-termine__liste">
          {liste.data.map((x) => (
            <li key={x.id} className="app-zusammenhang">
              <strong>{x.name}</strong>
              <span className="app-leer-text">{Math.max(1, Math.round(x.groesse / 1024)).toLocaleString(sprache === "de" ? "de-DE" : "en-GB")} KB</span>
              {fertig[x.id] ? (
                <>
                  <Status variante="freigegeben">{a.uebernommen}</Status>
                  <Link to="/dokumente/$id" params={{ id: fertig[x.id]! }} search={{}}>
                    {a.zumDokument}
                  </Link>
                </>
              ) : darf("bearbeiter") ? (
                <Button
                  variante="sekundaer"
                  aria-label={a.uebernehmenFuer(x.name)}
                  disabled={importieren.isPending}
                  onClick={() => importieren.mutate({ id: aktivitaet.id, anhangId: x.id }, { onSuccess: (r) => setFertig((f) => ({ ...f, [x.id]: r.dokumentId })) })}
                >
                  {a.uebernehmen}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <Button variante="sekundaer" onClick={onSchliessen}>
          {a.schliessen}
        </Button>
      </div>
    </Seitenpanel>
  );
}

/** Entfernt eine synchronisierte Mail oder einen Termin aus dem Verlauf; der Abgleich holt sie danach nicht wieder. */
function EntfernenDialog({ aktivitaet, onSchliessen }: { aktivitaet: Aktivitaet; onSchliessen: () => void }) {
  const t = useT();
  const entfernen = useSyncEntfernen();
  const z = t.mail.zeitstrahl;
  return (
    <Seitenpanel titel={z.entfernenTitel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{z.entfernenTitel}</h2>
      <p>{z.entfernenFrage(aktivitaet.titel)}</p>
      <FehlerHinweis fehler={entfernen.error} />
      <div className="app-zusammenhang">
        <Button disabled={entfernen.isPending} onClick={() => entfernen.mutate(aktivitaet.id, { onSuccess: onSchliessen })}>
          {z.entfernenBestaetigen}
        </Button>
        <Button variante="sekundaer" onClick={onSchliessen}>
          {z.abbrechen}
        </Button>
      </div>
    </Seitenpanel>
  );
}
