import { lazy, Suspense, useState } from "react";
import { useQueries, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Auswahl, Button, ButtonLink, Feld, Hinweis, Seitenkopf, Status, Tabelle, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { fondsListe, type FondsEintrag } from "../api/abfragen";
import { umgebungAbfrage } from "../api/anmeldung";
import { DOKU_URL, EXPORT_URL } from "../api/import";
import FondsPeriodensperre from "../komponenten/FondsPeriodensperre";
import {
  aufbewahrungAnsicht,
  benutzerListe,
  betriebsstatus,
  fondsRollen,
  useEinladungSenden,
  schluesselListe,
  useBenutzerAendern,
  useBenutzerAnlegen,
  useRolleEntziehen,
  useRolleSetzen,
  useSchluesselWiderrufen,
  useVariantenNachholen,
  legeSchluesselAn,
  schluesselListeEntwerten,
  type Aufbewahrung,
  type BenutzerZeile,
  type RollenZeile,
  type SchluesselZeile,
} from "../api/verwaltung";
import { ZugangWahl } from "../komponenten/ZugangWahl";
import { alle } from "../erweiterung";
import { useAnmeldeschritt } from "../komponenten/anmeldeschritt";
import { Wechselkurse } from "../komponenten/Wechselkurse";
import { ManagerProfilBereich } from "../komponenten/ManagerProfilBereich";
import { KontaktabgleichVerwaltung } from "../komponenten/KontakteAusPostfach";
import { Seitenpanel } from "@carraway/ui";
import { MailversandBereich } from "../komponenten/MailversandBereich";
import { KennzahlenBereich } from "../komponenten/KennzahlKatalog";
import { MeldewesenBereich } from "../komponenten/MeldeVerwaltung";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { useFormular } from "../komponenten/formular";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { MINDESTLAENGE_PASSWORT } from "../lib/passwort";
import { aktiverEintrag, type InhaltsEintrag } from "../lib/tabs";
import { BereichsLeiste } from "../komponenten/BereichsLeiste";
import { ROLLEN, useRechte } from "../lib/rechte";
import { formatZeitpunkt } from "../lib/zeit";

const route = getRouteApi("/administration");

/** Rollen, Nutzergruppen und Fondszugriff: eigenes Paket, geladen erst beim Öffnen des Eintrags. */
const RechteVerwaltung = lazy(() => import("../komponenten/RechteVerwaltung"));

const DataProviderSettings = lazy(() => import("../komponenten/DataProviderSettings"));
const CrmIntegrationen = lazy(() => import("../komponenten/CrmIntegrationen"));

export const BEREICHE = ["benutzer", "rollen", "rechte", "schluessel", "sperre", "kennzahlen", "meldewesen", "profil", "kurse", "kontaktabgleich", "integrationen", "datenanbieter", "daten", "betrieb", "mail"] as const;
export type Bereich = (typeof BEREICHE)[number];

type GruppenId = "zugaenge" | "vorgaben" | "betrieb";
/** Gliederung des Inhaltsverzeichnisses; die Kennungen sind die bisherigen Reiter (`?tab=…`). Der erste Eintrag ist der Standard. */
const GRUPPEN: readonly { id: GruppenId; bereiche: readonly Bereich[] }[] = [
  { id: "zugaenge", bereiche: ["benutzer", "rechte", "rollen", "schluessel"] },
  { id: "vorgaben", bereiche: ["kennzahlen", "meldewesen", "profil", "kurse", "kontaktabgleich", "integrationen", "datenanbieter"] },
  { id: "betrieb", bereiche: ["sperre", "daten", "betrieb", "mail"] },
];
/** Bereiche, deren Inhalt keinen eigenen benannten Abschnitt mitbringt: Die Karte trägt den Namen des Eintrags. */
const OHNE_EIGENEN_NAMEN: ReadonlySet<string> = new Set(["rollen", "sperre"]);
/** Bereiche mit mehreren Blöcken: Sie legen jeden Block selbst als Karte an, alle anderen sind eine einzige Karte. */
const MEHRERE_BLOECKE: ReadonlySet<string> = new Set(["kennzahlen", "meldewesen", "daten", "rechte", "mail"]);

/** Gruppen samt den sichtbaren Bereichen der Erweiterungen (z. B. „Investoren“ des LP-Portals), jeweils hinter dem genannten Bereich des Kerns. */
function gruppenMitErweiterungen(sichtbar: (id: string) => boolean): { id: GruppenId; bereiche: string[] }[] {
  return GRUPPEN.map((g) => {
    const bereiche: string[] = [...g.bereiche];
    for (const z of alle("verwaltungBereiche").filter((x) => x.gruppe === g.id && sichtbar(x.id))) {
      const nach = bereiche.indexOf(z.nach);
      bereiche.splice(nach < 0 ? bereiche.length : nach + 1, 0, z.id);
    }
    return { id: g.id, bereiche };
  });
}

/** Verwaltung für globale Verwalter: Benutzer, Rollen je Fonds, API-Schlüssel und Periodensperre. Die API prüft jede Anfrage selbst. */
export function VerwaltungSeite() {
  const t = useT();
  const v = t.verwaltung;
  const suche = route.useSearch();
  const mitBedingung = alle("verwaltungBereiche").filter((z) => z.sichtbar);
  const bedingungen = useQueries({ queries: mitBedingung.map((z) => ({ queryKey: [...z.sichtbar!.schluessel], queryFn: z.sichtbar!.pruefe, staleTime: 60_000 })) });
  const verborgen = new Set(mitBedingung.filter((_, i) => bedingungen[i]?.data !== true).map((z) => z.id));
  const gruppen = gruppenMitErweiterungen((id) => !verborgen.has(id));
  const alleBereiche = gruppen.flatMap((g) => g.bereiche);
  const erster = alleBereiche[0];
  const aktiv = aktiverEintrag(suche, alleBereiche.map((b): InhaltsEintrag => ({ id: b, tab: b })))?.id ?? "";
  const { ich } = useRechte();
  if (!ich?.globalVerwalter) return null;
  const zusatz = alle("verwaltungBereiche");
  const inhalte: Record<Bereich, () => React.ReactNode> = {
    benutzer: () => <BenutzerBereich selbstId={ich.id} />,
    rollen: () => <RollenBereich />,
    rechte: () => (
      <Suspense fallback={<section className="app-karte" aria-busy="true" />}>
        <RechteVerwaltung />
      </Suspense>
    ),
    schluessel: () => <SchluesselBereich />,
    sperre: () => <SperreBereich />,
    kennzahlen: () => <KennzahlenBereich />,
    meldewesen: () => <MeldewesenBereich />,
    profil: () => <ManagerProfilBereich />,
    kurse: () => <Wechselkurse />,
    kontaktabgleich: () => <KontaktabgleichVerwaltung />,
    datenanbieter: () => <Suspense fallback={null}><DataProviderSettings /></Suspense>,
    integrationen: () => <Suspense fallback={<section aria-busy="true" />}><CrmIntegrationen /></Suspense>,
    daten: () => <DatenBereich />,
    betrieb: () => <BetriebBereich />,
    mail: () => (
      <Suspense fallback={<section className="app-karte" aria-busy="true" />}>
        <MailversandBereich />
      </Suspense>
    ),
  };
  return (
    <div className="app-seite">
      <Seitenkopf meta={v.etikett} titel={v.titel} />
      <BereichsLeiste
        aria-label={v.bereiche}
        aktiv={aktiv}
        zurueck={{ label: t.nav.alleBereiche, ziel: { to: "/funds", search: {} } }}
        kopf={{ titel: v.titel, untertitel: v.etikett }}
        pfad={[{ label: t.nav.verwaltung }]}
        gruppen={gruppen.map((g) => ({
          id: g.id,
          label: v.gruppen[g.id],
          eintraege: g.bereiche.map((b) => {
            const ziel = { to: "/administration" as const, search: { tab: b === erster ? undefined : b } };
            const z = zusatz.find((x) => x.id === b);
            if (z) return { id: b, label: z.label(t), ziel, inhalt: () => <section className="app-karte" aria-label={z.label(t)}>{z.inhalt()}</section> };
            const k = b as Bereich;
            return { id: b, label: v.reiter[k], ziel, inhalt: () => (MEHRERE_BLOECKE.has(k) ? inhalte[k]() : <section className="app-karte" aria-label={OHNE_EIGENEN_NAMEN.has(k) ? v.reiter[k] : undefined}>{inhalte[k]()}</section>) };
          }),
        }))}
      />
    </div>
  );
}

// Benutzer ---------------------------------------------------------------------------------------------------------

function BenutzerBereich({ selbstId }: { selbstId: string }) {
  const t = useT();
  const v = t.verwaltung.benutzer;
  const { data, isPending, error } = useQuery(benutzerListe());
  const aendern = useBenutzerAendern();
  const einladen = useEinladungSenden();
  const sprache = useSprache();
  const [neu, setNeu] = useState(false);
  const [angelegt, setAngelegt] = useState<{ name: string; einladung: boolean } | null>(null);
  const [erneut, setErneut] = useState<string | null>(null);
  // Technische Benutzer (je API-Schlüssel einer) gehören zur Schlüsselverwaltung.
  const personen = (data ?? []).filter((b) => !b.technisch);

  const spalten: TabelleSpalte<BenutzerZeile>[] = [
    { schluessel: "name", kopf: v.spalten.name, zelle: (b) => b.name },
    { schluessel: "email", kopf: v.spalten.email, zelle: (b) => b.email },
    { schluessel: "status", kopf: v.spalten.status, zelle: (b) => <Status variante={b.aktiv ? "freigegeben" : "fehlt"}>{b.aktiv ? v.aktiv : v.gesperrt}</Status> },
    { schluessel: "verwalter", kopf: v.spalten.verwalter, zelle: (b) => (b.globalVerwalter ? v.ja : v.nein) },
    {
      schluessel: "zweiFaktor",
      kopf: v.spalten.zweiFaktor,
      zelle: (b) => (
        <span className="app-zusammenhang">
          {b.zweiFaktorAktiv ? v.zweiFaktorAktiv : v.zweiFaktorFehlt}
          {b.einladungOffen ? <Status variante="pruefung">{t.verwaltung.einladung.offen}</Status> : b.passwortAendern ? <Status variante="pruefung">{v.startpasswort}</Status> : null}
        </span>
      ),
    },
    {
      schluessel: "aktion",
      kopf: <span className="cw-nur-lesen">{v.spalten.aktion}</span>,
      zelle: (b) => {
        const selbst = b.id === selbstId;
        return (
          <span className="app-knoepfe">
            {b.einladungOffen && b.aktiv ? (
              <Button
                variante="sekundaer"
                disabled={einladen.isPending}
                aria-label={t.verwaltung.einladung.erneutFuer(b.name)}
                onClick={() => einladen.mutate({ id: b.id, sprache }, { onSuccess: () => setErneut(b.name) })}
              >
                {t.verwaltung.einladung.erneut}
              </Button>
            ) : null}
            <Button
              variante="sekundaer"
              disabled={aendern.isPending || selbst}
              aria-label={b.aktiv ? v.sperrenFuer(b.name) : v.entsperrenFuer(b.name)}
              onClick={() => aendern.mutate({ id: b.id, json: { aktiv: !b.aktiv } })}
            >
              {b.aktiv ? v.sperren : v.entsperren}
            </Button>
            <Button
              variante="sekundaer"
              disabled={aendern.isPending || selbst}
              aria-label={b.globalVerwalter ? v.verwaltungEntziehenFuer(b.name) : v.zumVerwalterFuer(b.name)}
              onClick={() => aendern.mutate({ id: b.id, json: { globalVerwalter: !b.globalVerwalter } })}
            >
              {b.globalVerwalter ? v.verwaltungEntziehen : v.zumVerwalter}
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <>
      <div className="app-abschnittskopf">
        <h2 className="cw-t-untertitel app-karte__titel">{v.titel}</h2>
        <Button onClick={() => setNeu(true)}>{v.anlegen}</Button>
      </div>
      <p className="app-leer-text">{v.einleitung}</p>
      {angelegt ? <Hinweis titel={v.angelegtTitel}>{angelegt.einladung ? t.verwaltung.einladung.angelegtText(angelegt.name) : v.angelegtText(angelegt.name)}</Hinweis> : null}
      {erneut ? <Hinweis>{t.verwaltung.einladung.erneutGesendet(erneut)}</Hinweis> : null}
      <FehlerHinweis fehler={error ?? aendern.error ?? einladen.error} />
      {isPending ? <p className="app-leer-text">{t.gemeinsam.laedt}</p> : null}
      {data ? <Tabelle beschriftung={v.titel} spalten={spalten} zeilen={personen} zeilenSchluessel={(b) => b.id} /> : null}
      <p className="app-leer-text">{v.selbstHinweis}</p>
      {neu ? (
        <BenutzerDialog
          onSchliessen={() => setNeu(false)}
          onAngelegt={(name, einladung) => {
            setAngelegt({ name, einladung });
            setErneut(null);
            setNeu(false);
          }}
        />
      ) : null}
    </>
  );
}

function BenutzerDialog({ onSchliessen, onAngelegt }: { onSchliessen: () => void; onAngelegt: (name: string, einladung: boolean) => void }) {
  const t = useT();
  const f = t.verwaltung.benutzer.form;
  const sprache = useSprache();
  const { data: umgebung } = useQuery(umgebungAbfrage());
  const mailMoeglich = Boolean(umgebung?.anmeldung.passwortZuruecksetzen);
  const [zugang, setZugang] = useState<"passwort" | "einladung">("passwort");
  const einladung = mailMoeglich && zugang === "einladung";
  const anlegen = useBenutzerAnlegen();
  const { werte, feld, setWerte } = useFormular({ name: "", email: "", passwort: "", globalVerwalter: "nein" });
  const zuKurz = !einladung && werte.passwort.length < MINDESTLAENGE_PASSWORT;
  const [versucht, setVersucht] = useState(false);
  const fehler = (name: string) => feldText(t, anlegen.error, name);
  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <p className="app-leer-text">{f.beschreibung}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setVersucht(true);
          if (zuKurz) return;
          anlegen.mutate(
            einladung
              ? { name: werte.name.trim(), email: werte.email.trim(), globalVerwalter: werte.globalVerwalter === "ja", sprache }
              : { name: werte.name.trim(), email: werte.email.trim(), passwort: werte.passwort, globalVerwalter: werte.globalVerwalter === "ja" },
            {
              onSuccess: (neu) => {
                // Das Startpasswort steht nur hier im Formular und wird nach dem Anlegen verworfen.
                setWerte((alt) => ({ ...alt, passwort: "" }));
                onAngelegt(neu.name, einladung);
              },
            },
          );
        }}
      >
        <FehlerHinweis fehler={anlegen.error} bekannt={["name", "email", "password", "globalAdmin"]} />
        <Feld label={f.name} {...feld("name")} fehler={fehler("name")} />
        <Feld label={f.email} type="email" {...feld("email")} fehler={fehler("email")} />
        {mailMoeglich ? <ZugangWahl wert={zugang} onWahl={setZugang} /> : null}
        {einladung ? null : (
          <Feld zugang
            label={f.passwort}
            type="password"
            autoComplete="new-password"
            hilfe={f.passwortHilfe(MINDESTLAENGE_PASSWORT)}
            {...feld("passwort")}
            fehler={versucht && zuKurz ? t.passwort.zuKurz(MINDESTLAENGE_PASSWORT) : fehler("password")}
          />
        )}
        <label className="app-haken">
          <input type="checkbox" checked={werte.globalVerwalter === "ja"} onChange={(e) => setWerte((alt) => ({ ...alt, globalVerwalter: e.target.checked ? "ja" : "nein" }))} />
          <span>{f.globalVerwalter}</span>
        </label>
        <div>
          <Button type="submit" disabled={anlegen.isPending}>
            {f.anlegen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

// Rollen -----------------------------------------------------------------------------------------------------------

/** Wahl des Fonds für die Bereiche Rollen und Periodensperre. */
function FondsWahl({ fonds, wert, onWahl }: { fonds: FondsEintrag[]; wert: string; onWahl: (id: string) => void }) {
  const t = useT();
  return (
    <Auswahl label={t.verwaltung.fonds} value={wert} onChange={(e) => onWahl(e.target.value)}>
      {fonds.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </Auswahl>
  );
}

function RollenBereich() {
  const t = useT();
  const { data: fonds } = useSuspenseQuery(fondsListe());
  const [gewaehlt, setGewaehlt] = useState(fonds[0]?.id ?? "");
  if (fonds.length === 0) return <p className="app-leer-text">{t.platzhalter.fondsAnlegen} <Link to="/funds" search={{}}>{t.nav.fonds}</Link></p>;
  return (
    <>
      <h2 className="cw-t-untertitel app-karte__titel">{t.verwaltung.rollen.titel}</h2>
      <p className="app-leer-text">{t.verwaltung.rollen.einleitung}</p>
      <FondsWahl fonds={fonds} wert={gewaehlt} onWahl={setGewaehlt} />
      <RollenFuerFonds key={gewaehlt} fondsId={gewaehlt} />
    </>
  );
}

function RollenFuerFonds({ fondsId }: { fondsId: string }) {
  const t = useT();
  const v = t.verwaltung.rollen;
  const { data, isPending, error } = useQuery(fondsRollen(fondsId));
  const { data: personen } = useQuery(benutzerListe());
  const setzen = useRolleSetzen(fondsId);
  const entziehen = useRolleEntziehen(fondsId);
  const [person, setPerson] = useState("");
  const [rolle, setRolle] = useState<(typeof ROLLEN)[number]>("betrachter");
  const waehlbar = (personen ?? []).filter((b) => !b.technisch && b.aktiv);

  const spalten: TabelleSpalte<RollenZeile>[] = [
    { schluessel: "name", kopf: v.spalten.name, zelle: (r) => r.name },
    { schluessel: "email", kopf: v.spalten.email, zelle: (r) => r.email },
    {
      schluessel: "rolle",
      kopf: v.spalten.rolle,
      zelle: (r) => (
        <select
          className="app-auswahl app-auswahl--klein"
          aria-label={v.rolleFuer(r.name)}
          value={r.rolle}
          disabled={setzen.isPending}
          onChange={(e) => setzen.mutate({ benutzerId: r.benutzerId, rolle: e.target.value as (typeof ROLLEN)[number] })}
        >
          {ROLLEN.map((x) => (
            <option key={x} value={x}>
              {aufzaehlung(t.rolle, x)}
            </option>
          ))}
        </select>
      ),
    },
    {
      schluessel: "aktion",
      kopf: <span className="cw-nur-lesen">{v.spalten.aktion}</span>,
      zelle: (r) => (
        <Button variante="gefahr" disabled={entziehen.isPending} aria-label={v.entziehenFuer(r.name)} onClick={() => entziehen.mutate(r.benutzerId)}>
          {v.entziehen}
        </Button>
      ),
    },
  ];

  return (
    <>
      <FehlerHinweis fehler={error ?? setzen.error ?? entziehen.error} />
      {isPending ? <p className="app-leer-text">{t.gemeinsam.laedt}</p> : null}
      {data && data.length === 0 ? <p className="app-leer-text">{v.keine}</p> : null}
      {data && data.length > 0 ? <Tabelle beschriftung={v.tabelle} spalten={spalten} zeilen={data} zeilenSchluessel={(r) => r.benutzerId} /> : null}
      <p className="app-leer-text">{v.globaleHinweis}</p>
      <form
        className="app-filter"
        aria-label={v.zuweisen}
        onSubmit={(e) => {
          e.preventDefault();
          if (person) setzen.mutate({ benutzerId: person, rolle }, { onSuccess: () => setPerson("") });
        }}
      >
        <Auswahl label={v.person} value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">{v.personWaehlen}</option>
          {waehlbar.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.email})
            </option>
          ))}
        </Auswahl>
        <Auswahl label={v.spalten.rolle} value={rolle} onChange={(e) => setRolle(e.target.value as (typeof ROLLEN)[number])}>
          {ROLLEN.map((x) => (
            <option key={x} value={x}>
              {aufzaehlung(t.rolle, x)}
            </option>
          ))}
        </Auswahl>
        <Button type="submit" disabled={setzen.isPending || person === ""}>
          {v.zuweisen}
        </Button>
      </form>
    </>
  );
}

// API-Schlüssel ----------------------------------------------------------------------------------------------------

function SchluesselBereich() {
  const t = useT();
  const sprache = useSprache();
  const v = t.verwaltung.schluessel;
  const { data: fonds } = useSuspenseQuery(fondsListe());
  const { data, isPending, error } = useQuery(schluesselListe());
  const widerrufen = useSchluesselWiderrufen();
  const [neu, setNeu] = useState(false);
  const [sicher, setSicher] = useState<string | null>(null);
  const fondsName = (id: string) => fonds.find((f) => f.id === id)?.name ?? id;

  const spalten: TabelleSpalte<SchluesselZeile>[] = [
    { schluessel: "name", kopf: v.spalten.name, zelle: (s) => s.name },
    { schluessel: "vorschau", kopf: v.spalten.vorschau, zelle: (s) => <code className="app-code">{s.vorschau}…</code> },
    {
      schluessel: "scopes",
      kopf: v.spalten.rechte,
      zelle: (s) => (
        <ul className="app-kapital-liste">
          {s.scopes.map((x) => (
            <li key={`${x.fondsId}-${x.recht}`}>{`${fondsName(x.fondsId)}: ${aufzaehlung(v.recht, x.recht)}`}</li>
          ))}
        </ul>
      ),
    },
    { schluessel: "ablauf", kopf: v.spalten.ablauf, zelle: (s) => formatDatum(s.ablauf.slice(0, 10), sprache) },
    { schluessel: "genutzt", kopf: v.spalten.genutzt, zelle: (s) => (s.zuletztGenutzt ? formatZeitpunkt(s.zuletztGenutzt, sprache) : t.gemeinsam.keinWert) },
    {
      schluessel: "status",
      kopf: v.spalten.status,
      zelle: (s) => <Status variante={s.status === "aktiv" ? "freigegeben" : "fehlt"}>{aufzaehlung(v.status, s.status)}</Status>,
    },
    {
      schluessel: "aktion",
      kopf: <span className="cw-nur-lesen">{v.spalten.aktion}</span>,
      zelle: (s) =>
        s.status === "aktiv" ? (
          sicher === s.id ? (
            <span className="app-knoepfe">
              <Button variante="gefahr" disabled={widerrufen.isPending} aria-label={v.endgueltigFuer(s.name)} onClick={() => widerrufen.mutate(s.id, { onSettled: () => setSicher(null) })}>
                {v.endgueltig}
              </Button>
              <Button variante="ruhig" onClick={() => setSicher(null)}>
                {v.abbrechen}
              </Button>
            </span>
          ) : (
            <Button variante="sekundaer" aria-label={v.widerrufenFuer(s.name)} onClick={() => setSicher(s.id)}>
              {v.widerrufen}
            </Button>
          )
        ) : null,
    },
  ];

  return (
    <>
      <div className="app-abschnittskopf">
        <h2 className="cw-t-untertitel app-karte__titel">{v.titel}</h2>
        <Button onClick={() => setNeu(true)}>{v.anlegen}</Button>
      </div>
      <p className="app-leer-text">{v.einleitung}</p>
      <FehlerHinweis fehler={error ?? widerrufen.error} />
      {isPending ? <p className="app-leer-text">{t.gemeinsam.laedt}</p> : null}
      {data && data.length === 0 ? <p className="app-leer-text">{v.keine}</p> : null}
      {data && data.length > 0 ? <Tabelle beschriftung={v.titel} spalten={spalten} zeilen={data} zeilenSchluessel={(s) => s.id} /> : null}
      <div className="app-gruppe">
        <h3 className="app-gruppen-titel">{v.api.titel}</h3>
        <p className="app-leer-text">{v.api.text}</p>
        <p>
          {v.api.basis}: <code className="app-code">{`${window.location.origin}/api/v1`}</code>
        </p>
        <div className="app-aktionen__knoepfe">
          <ButtonLink variante="sekundaer" href={DOKU_URL} target="_blank" rel="noopener noreferrer">
            {v.api.doku}
          </ButtonLink>
          <ButtonLink variante="sekundaer" href="/api/v1/openapi.json" target="_blank" rel="noopener noreferrer">
            {v.api.spec}
          </ButtonLink>
        </div>
      </div>
      {neu ? <SchluesselDialog fonds={fonds} onSchliessen={() => setNeu(false)} /> : null}
    </>
  );
}

const LAUFZEITEN = [30, 90, 180, 365] as const;
const TAG_MS = 24 * 60 * 60 * 1000;

/** Legt einen Schlüssel an. Danach zeigt derselbe Dialog den Klartext genau einmal; er liegt nur im Zustand dieser Komponente. */
function SchluesselDialog({ fonds, onSchliessen }: { fonds: FondsEintrag[]; onSchliessen: () => void }) {
  const t = useT();
  const f = t.verwaltung.schluessel.form;
  const qc = useQueryClient();
  const anlegen = useAnmeldeschritt();
  const [name, setName] = useState("");
  const [laufzeit, setLaufzeit] = useState<number>(90);
  const [rechte, setRechte] = useState<Record<string, "" | "lesen" | "schreiben">>({});
  const [klartext, setKlartext] = useState<string | null>(null);
  const [kopiert, setKopiert] = useState<boolean | null>(null);
  const [versucht, setVersucht] = useState(false);
  const scopes = Object.entries(rechte).flatMap(([fondsId, recht]) => (recht ? [{ fondsId, recht }] : []));

  async function kopieren(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setKopiert(true);
    } catch {
      setKopiert(false);
    }
  }

  if (klartext) {
    return (
      <Seitenpanel titel={f.erzeugtTitel} onSchliessen={onSchliessen}>
        <h2 className="cw-t-untertitel">{f.erzeugtTitel}</h2>
        <Hinweis titel={f.einmalig}>{f.einmaligText}</Hinweis>
        <p>
          <code className="app-code app-schluessel" aria-label={f.schluessel}>
            {klartext}
          </code>
        </p>
        <div className="app-aktionen__knoepfe">
          <Button onClick={() => void kopieren(klartext)}>{f.kopieren}</Button>
          <span role="status" className="app-leer-text">
            {kopiert === true ? f.kopiert : kopiert === false ? t.zweiFaktor.kopierenFehlt : ""}
          </span>
        </div>
      </Seitenpanel>
    );
  }

  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <p className="app-leer-text">{f.beschreibung}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setVersucht(true);
          if (name.trim() === "" || scopes.length === 0) return;
          void anlegen.ausfuehren(async () => {
            const antwort = await legeSchluesselAn({ name: name.trim(), scopes, ablauf: new Date(Date.now() + (laufzeit - 1) * TAG_MS).toISOString() });
            setKlartext(antwort.schluessel);
            await schluesselListeEntwerten(qc);
          });
        }}
      >
        <FehlerHinweis fehler={anlegen.fehler} bekannt={["name", "scopes", "expiresAt"]} />
        <Feld label={f.name} hilfe={f.nameHilfe} value={name} onChange={(e) => setName(e.target.value)} fehler={versucht && name.trim() === "" ? f.nameFehlt : feldText(t, anlegen.fehler, "name")} />
        <Auswahl label={f.laufzeit} value={String(laufzeit)} onChange={(e) => setLaufzeit(Number(e.target.value))} fehler={feldText(t, anlegen.fehler, "expiresAt")}>
          {LAUFZEITEN.map((tage) => (
            <option key={tage} value={tage}>
              {f.tage(tage)}
            </option>
          ))}
        </Auswahl>
        <fieldset className="app-gruppe">
          <legend className="cw-t-beschriftung">{f.rechte}</legend>
          {fonds.map((x) => (
            <Auswahl
              key={x.id}
              label={x.name}
              value={rechte[x.id] ?? ""}
              onChange={(e) => setRechte((alt) => ({ ...alt, [x.id]: e.target.value as "" | "lesen" | "schreiben" }))}
            >
              <option value="">{f.keinZugriff}</option>
              <option value="lesen">{t.verwaltung.schluessel.recht.lesen}</option>
              <option value="schreiben">{t.verwaltung.schluessel.recht.schreiben}</option>
            </Auswahl>
          ))}
          {versucht && scopes.length === 0 ? <p className="app-leer-text">{f.rechteFehlen}</p> : <p className="app-leer-text">{f.rechteHilfe}</p>}
        </fieldset>
        <div>
          <Button type="submit" disabled={anlegen.laeuft}>
            {f.anlegen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

// Export und API ---------------------------------------------------------------------------------------------------

/** Gelöschte Dokumente, deren Datei noch in der Ablage liegt, mit dem Datum, ab dem der Worker sie entfernt. */
function AufbewahrungAbschnitt() {
  const t = useT();
  const a = t.datenuebernahme.aufbewahrung;
  const sprache = useSprache();
  const { data, isPending, error } = useQuery(aufbewahrungAnsicht());
  const spalten: TabelleSpalte<Aufbewahrung["daten"][number]>[] = [
    { schluessel: "dokument", kopf: a.spalten.dokument, zelle: (z) => z.dateiname },
    { schluessel: "geloescht", kopf: a.spalten.geloescht, zelle: (z) => formatDatum(z.geloeschtAm.slice(0, 10), sprache) },
    { schluessel: "entferntAb", kopf: a.spalten.entferntAb, zelle: (z) => formatDatum(z.entferntAb.slice(0, 10), sprache) },
    {
      schluessel: "stand",
      kopf: a.spalten.stand,
      zelle: (z) => (z.haltegrund ? aufzaehlung(a.haltegrund, z.haltegrund) : z.faellig ? a.stand.faellig : a.stand.wartet),
    },
  ];
  return (
    <section className="app-karte" aria-labelledby="daten-aufbewahrung-titel">
      <h2 id="daten-aufbewahrung-titel" className="cw-t-untertitel app-karte__titel">{a.titel}</h2>
      {data ? <p className="app-leer-text">{a.text(data.aufbewahrungTage)}</p> : null}
      <FehlerHinweis fehler={error} />
      {isPending ? <p className="app-leer-text">{t.gemeinsam.laedt}</p> : null}
      {data && data.daten.length === 0 ? <p className="app-leer-text">{a.keine}</p> : null}
      {data && data.daten.length > 0 ? <Tabelle beschriftung={a.tabelle} spalten={spalten} zeilen={data.daten} zeilenSchluessel={(z) => z.id} /> : null}
      {data && data.endgueltigGeloescht > 0 ? <p className="app-leer-text">{a.endgueltig(data.endgueltigGeloescht)}</p> : null}
    </section>
  );
}

/** Fassungen je Investor für früher freigegebene LP-Berichte nachholen (Aktion für globale Verwalter). */
function VariantenAbschnitt() {
  const t = useT();
  const x = t.datenuebernahme.varianten;
  const nachholen = useVariantenNachholen();
  const e = nachholen.data;
  return (
    <section className="app-karte" aria-labelledby="daten-varianten-titel">
      <h2 id="daten-varianten-titel" className="cw-t-untertitel app-karte__titel">{x.titel}</h2>
      <p className="app-leer-text">{x.text}</p>
      <FehlerHinweis fehler={nachholen.error} />
      <div>
        <Button variante="sekundaer" disabled={nachholen.isPending} onClick={() => nachholen.mutate()}>
          {nachholen.isPending ? x.laeuft : x.knopf}
        </Button>
      </div>
      {e ? (
        <div aria-live="polite">
          <p className="app-leer-text">{x.ergebnis(e.geprueft, e.angelegt.length)}</p>
          {e.uebersprungen.length > 0 ? (
            <ul className="app-liste">
              {e.uebersprungen.map((u) => (
                <li key={u.berichtId}>{x.uebersprungen(aufzaehlung(x.gruende, u.grund), u.berichtId)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function DatenBereich() {
  const t = useT();
  const d = t.datenuebernahme;
  return (
    <>
      <section className="app-karte" aria-labelledby="daten-export-titel">
      <h2 id="daten-export-titel" className="cw-t-untertitel app-karte__titel">{d.export.titel}</h2>
      <p className="app-leer-text">{d.export.text}</p>
      <div className="app-formular">
        <div className="app-gruppe">
          <span className="cw-t-beschriftung">{d.export.enthaelt}</span>
          <ul className="app-liste">
            {d.export.enthaeltListe.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div className="app-gruppe">
          <span className="cw-t-beschriftung">{d.export.ausgeschlossen}</span>
          <ul className="app-liste">
            {d.export.ausgeschlossenListe.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <Hinweis>{d.export.protokolliert}</Hinweis>
        <div>
          <ButtonLink href={EXPORT_URL} download>
            {d.export.knopf}
          </ButtonLink>
        </div>
        <p className="app-leer-text">{d.export.knopfHinweis}</p>
      </div>
      </section>

      <AufbewahrungAbschnitt />

      <VariantenAbschnitt />

      <section className="app-karte" aria-labelledby="daten-api-titel">
      <h2 id="daten-api-titel" className="cw-t-untertitel app-karte__titel">{d.api.titel}</h2>
      <p className="app-leer-text">{d.api.text}</p>
      <div className="app-aktionen__knoepfe">
        <ButtonLink variante="sekundaer" href={DOKU_URL} target="_blank" rel="noopener noreferrer">
          {d.api.doku}
        </ButtonLink>
        <ButtonLink variante="sekundaer" href="/api/v1/openapi.json" target="_blank" rel="noopener noreferrer">
          {d.api.spec}
        </ButtonLink>
      </div>
      <div className="app-gruppe">
        <span className="cw-t-beschriftung">{d.api.hilfeTitel}</span>
        <ul className="app-liste">
          {d.api.hilfe.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
      </section>
    </>
  );
}

// Betrieb ----------------------------------------------------------------------------------------------------------

type Zustand = "ok" | "warnung" | "fehler";
const STATUS_VARIANTE = { ok: "freigegeben", warnung: "pruefung", fehler: "fehlt" } as const;

interface BetriebZeile {
  id: string;
  pruefung: string;
  zustand: Zustand | null;
  einzelheit: string;
}

function BetriebBereich() {
  const t = useT();
  const b = t.verwaltung.betrieb;
  const sprache = useSprache();
  const { data, isPending, error, refetch, isFetching } = useQuery(betriebsstatus());
  const dauer = (sekunden: number) =>
    sekunden < 90 ? `${Math.round(sekunden)} ${b.einheiten.sekunden}` : sekunden < 5400 ? `${Math.round(sekunden / 60)} ${b.einheiten.minuten}` : `${Math.round(sekunden / 3600)} ${b.einheiten.stunden}`;
  const rueckstand = (name: "snapshots" | "mail" | "auslesung" | "register", r: { anzahl: number; aeltesterSekunden: number } | null, warnungSekunden: number): BetriebZeile => ({
    id: name,
    pruefung: b.rueckstand[name],
    zustand: r === null ? null : r.anzahl > 0 && r.aeltesterSekunden > warnungSekunden ? "warnung" : "ok",
    einzelheit: r === null ? b.rueckstand.unbekannt : r.anzahl === 0 ? b.rueckstand.leer : b.rueckstand.wartend(r.anzahl, dauer(r.aeltesterSekunden)),
  });
  const zeilen: BetriebZeile[] = data
    ? [
        { id: "datenbank", pruefung: b.datenbank.name, zustand: data.datenbank.erreichbar ? "ok" : "fehler", einzelheit: data.datenbank.erreichbar ? b.datenbank.ok : b.datenbank.fehler },
        {
          id: "migrationen",
          pruefung: b.migrationen.name,
          zustand: data.migrationen.ok ? "ok" : "fehler",
          einzelheit: data.migrationen.ok ? b.migrationen.ok(data.migrationen.angewendet ?? 0) : b.migrationen.fehler,
        },
        {
          id: "worker",
          pruefung: b.worker.name,
          zustand: data.worker.status === "ok" ? "ok" : "warnung",
          einzelheit:
            data.worker.herzschlagAlterSekunden === null || data.worker.status === "unbekannt"
              ? b.worker.unbekannt
              : data.worker.status === "ok"
                ? b.worker.ok(dauer(data.worker.herzschlagAlterSekunden))
                : b.worker.ausgefallen(dauer(data.worker.herzschlagAlterSekunden)),
        },
        rueckstand("snapshots", data.rueckstaende.snapshots, data.rueckstaende.warnungSekunden),
        rueckstand("mail", data.rueckstaende.mail, data.rueckstaende.warnungSekunden),
        // Rückstand der KI-Auslesung (Tabelle `auslesung`, gemeinsames Schema): nur, wenn eine Erweiterung ihn braucht.
        ...(Object.keys(data.erweiterungen).includes("ki") ? [rueckstand("auslesung", data.rueckstaende.auslesung, data.rueckstaende.warnungSekunden)] : []),
        rueckstand("register", data.rueckstaende.register, data.rueckstaende.warnungSekunden),
        { id: "speicher", pruefung: b.speicher.name, zustand: data.speicher.beschreibbar ? "ok" : "fehler", einzelheit: data.speicher.beschreibbar ? b.speicher.ok : b.speicher.fehler },
        { id: "smtp", pruefung: b.smtp.name, zustand: null, einzelheit: data.smtp.konfiguriert ? b.smtp.an : b.smtp.aus },
        // Angaben der Erweiterungen (z. B. KI-Anbieter).
        ...alle("betriebZeilen").flatMap((zeilen) => zeilen(data.erweiterungen, t).map((z) => ({ ...z, zustand: null }))),
      ]
    : [];
  const spalten: TabelleSpalte<BetriebZeile>[] = [
    { schluessel: "pruefung", kopf: b.spalten.pruefung, zelle: (z) => z.pruefung },
    { schluessel: "zustand", kopf: b.spalten.zustand, zelle: (z) => (z.zustand ? <Status variante={STATUS_VARIANTE[z.zustand]}>{b.zustand[z.zustand]}</Status> : b.zustand.info) },
    { schluessel: "einzelheit", kopf: b.spalten.einzelheit, umbruch: true, zelle: (z) => z.einzelheit },
  ];
  return (
    <>
      <h2 className="cw-t-untertitel app-karte__titel">{b.titel}</h2>
      <p className="app-leer-text">{b.einleitung}</p>
      <FehlerHinweis fehler={error} />
      {isPending ? <p className="app-leer-text">{t.gemeinsam.laedt}</p> : null}
      {data ? (
        <>
          <p className="app-zusammenhang">
            <Status variante={STATUS_VARIANTE[data.ampel as Zustand]}>{b.ampel[data.ampel as Zustand]}</Status>
            <span className="app-leer-text">{b.stand(formatZeitpunkt(data.erzeugtAm, sprache))}</span>
          </p>
          <Tabelle beschriftung={b.tabelle} spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => z.id} />
        </>
      ) : null}
      <div className="app-aktionen__knoepfe">
        <Button variante="sekundaer" disabled={isFetching} onClick={() => void refetch()}>
          {b.aktualisieren}
        </Button>
      </div>
    </>
  );
}

// Periodensperre ---------------------------------------------------------------------------------------------------

function SperreBereich() {
  const t = useT();
  const { data: fonds } = useSuspenseQuery(fondsListe());
  const [gewaehlt, setGewaehlt] = useState(fonds[0]?.id ?? "");
  if (fonds.length === 0) return <p className="app-leer-text">{t.platzhalter.fondsAnlegen} <Link to="/funds" search={{}}>{t.nav.fonds}</Link></p>;
  return (
    <>
      <h2 className="cw-t-untertitel app-karte__titel">{t.verwaltung.sperre.titel}</h2>
      <p className="app-leer-text">{t.verwaltung.sperre.einleitung}</p>
      <FondsWahl fonds={fonds} wert={gewaehlt} onWahl={setGewaehlt} />
      <FondsPeriodensperre key={gewaehlt} fondsId={gewaehlt} />
    </>
  );
}
