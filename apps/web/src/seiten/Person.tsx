import { useState } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Button, Hinweis, Inhaltsverzeichnis, Seitenkopf, formatDatum } from "@carraway/ui";
import { personAktivitaeten, personDetail, personenDubletten } from "../api/abfragen";
import { AktivitaetDialog, AktivitaetenListe } from "../komponenten/Aktivitaeten";
import { AufgabenAbschnitt, Datensatzpanel, VerknuepftAbschnitt } from "../komponenten/crm/Datensatzpanel";
import { Verbindungen, useVerbindungen } from "../komponenten/crm/Verbindungen";
import { Schnellaktionen } from "../komponenten/crm/Zelle";
import { NaechsteTermine } from "../komponenten/NaechsteTermine";
import { NurLesen } from "../komponenten/NurLesen";
import { ZusammenfuehrenDialog } from "../komponenten/Zusammenfuehren";
import { useSprache, useT } from "../i18n";
import { DATENSPRACHE } from "../lib/datensprache";
import { useRechte } from "../lib/rechte";
import { useInhalt } from "../lib/tabs";

const route = getRouteApi("/personen/$id");

export function PersonSeite() {
  const t = useT();
  const sprache = useSprache();
  const { id } = route.useParams();
  const suche = route.useSearch();
  const navigate = route.useNavigate();
  const { data: p } = useSuspenseQuery(personDetail(id));
  const aktivitaeten = useQuery(personAktivitaeten(id));
  const { darf } = useRechte();
  const [offen, setOffen] = useState<null | "zusammenfuehren" | "aktivitaet">(null);
  const weg = p.zusammengefuehrtIn !== null;
  const schreiben = darf("bearbeiter") && !weg;
  const dubletten = useQuery({ ...personenDubletten({ vorname: p.vorname, nachname: p.nachname, ...(p.email ? { email: p.email } : {}), ausser: id }), enabled: offen === "zusammenfuehren" });
  const name = `${p.vorname} ${p.nachname}`;
  const { zeilen: verbindungen } = useVerbindungen("person", id, p.rollen);
  const eintraege = [
    { id: "unternehmen", tab: "uebersicht", label: t.crm.tabUnternehmen, zaehler: verbindungen.length, inhalt: () => <Verbindungen seite="person" id={id} rollen={p.rollen} schreiben={schreiben} /> },
    {
      id: "aktivitaeten",
      tab: "aktivitaet",
      unter: "aktivitaeten",
      label: t.tabs.aktivitaeten,
      zaehler: (aktivitaeten.data ?? []).length,
      inhalt: () => (
        <section className="app-karte" aria-labelledby="abschnitt-person-aktivitaeten">
          <div className="app-karte__kopf">
            <h2 id="abschnitt-person-aktivitaeten" className="cw-t-untertitel app-karte__titel">
              {t.person.aktivitaeten}
            </h2>
            {schreiben && p.organisation ? (
              <Button variante="sekundaer" onClick={() => setOffen("aktivitaet")}>
                {t.aktivitaeten.erfassen}
              </Button>
            ) : null}
          </div>
          <AktivitaetenListe aktivitaeten={aktivitaeten.data ?? []} />
        </section>
      ),
    },
    { id: "termine", tab: "aktivitaet", unter: "termine", label: t.tabs.termine, inhalt: () => <NaechsteTermine filter={{ personId: p.id }} /> },
    { id: "aufgaben", tab: "aufgaben", label: t.crm.tabAufgaben, inhalt: () => <AufgabenAbschnitt bezug={{ personId: id }} /> },
    { id: "verknuepft", tab: "verknuepft", label: t.crm.tabVerknuepft, inhalt: () => <VerknuepftAbschnitt objekt="person" id={id} /> },
  ];
  const { aktiv, setzeAktiv } = useInhalt(suche, navigate, eintraege);
  const gruppen = [{ id: "bereiche", eintraege: eintraege.map(({ tab: _t, unter: _u, ...e }) => e) }];

  return (
    <div className="app-seite">
      <Seitenkopf
        meta={[p.funktion, p.organisation?.name, p.letzteAktivitaet ? `${t.person.letzteAktivitaet}: ${formatDatum(p.letzteAktivitaet, sprache)}` : null].filter(Boolean).join(" · ") || t.person.etikett}
        titel={name}
        titelSprache={DATENSPRACHE}
        aktionen={
          <>
            <Schnellaktionen werte={{ telefon: p.telefon, linkedin: p.linkedin }} name={name} />
            {p.email ? (
              <a className="cw-button cw-button--sekundaer" href={`mailto:${p.email}`}>
                {t.crm.mailSchreiben}
              </a>
            ) : null}
            {schreiben ? (
              <Button variante="sekundaer" onClick={() => setOffen("zusammenfuehren")}>
                {t.zusammenfuehren.knopf}
              </Button>
            ) : null}
          </>
        }
      />
      <NurLesen />
      {weg ? (
        <Hinweis>
          {t.person.zusammengefuehrt}{" "}
          <Link to="/personen/$id" params={{ id: p.zusammengefuehrtIn! }}>
            {t.person.zumBleibenden}
          </Link>
        </Hinweis>
      ) : null}

      <div className="app-datensatz">
        <div className="app-datensatz__haupt">
          <Inhaltsverzeichnis aria-label={t.tabs.bereiche} gruppen={gruppen} aktiv={aktiv} onWechsel={setzeAktiv} />
        </div>
        <Datensatzpanel objekt="person" id={id} darfSchreiben={schreiben} titel={name} />
      </div>

      {offen === "zusammenfuehren" ? (
        <ZusammenfuehrenDialog
          art="person"
          id={id}
          name={name}
          vorschlaege={(dubletten.data ?? []).map((k) => ({ id: k.id, label: `${k.vorname} ${k.nachname}`, info: [k.email, k.organisation?.name].filter(Boolean).join(" · ") }))}
          onSchliessen={() => setOffen(null)}
        />
      ) : null}
      {offen === "aktivitaet" && p.organisation ? (
        <AktivitaetDialog organisationId={p.organisation.id} personId={id} personen={[{ id, vorname: p.vorname, nachname: p.nachname }]} onSchliessen={() => setOffen(null)} />
      ) : null}
    </div>
  );
}
