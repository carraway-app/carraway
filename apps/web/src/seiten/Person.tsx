import { useState } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Button, Hinweis, Seitenkopf, formatDatum } from "@carraway/ui";
import { alle } from "../erweiterung";
import { KontaktHerkunft } from "../komponenten/KontakteAusPostfach";
import { personAktivitaeten, personDetail, personenDubletten } from "../api/abfragen";
import { AktivitaetDialog, AktivitaetenListe } from "../komponenten/Aktivitaeten";
import { AufgabenAbschnitt, Datensatzpanel, VerknuepftAbschnitt } from "../komponenten/crm/Datensatzpanel";
import { Verbindungen, useVerbindungen } from "../komponenten/crm/Verbindungen";
import { Schnellaktionen } from "../komponenten/crm/Zelle";
import { NaechsteTermine } from "../komponenten/NaechsteTermine";
import { NurLesen } from "../komponenten/NurLesen";
import { ZusammenfuehrenDialog } from "../komponenten/Zusammenfuehren";
import { useSprache, useT } from "../i18n";
import { BereichsLeiste, mitZielen } from "../komponenten/BereichsLeiste";
import { DATENSPRACHE } from "../lib/datensprache";
import { useRechte } from "../lib/rechte";
import { aktiverEintrag } from "../lib/tabs";

const route = getRouteApi("/people/$id");

export function PersonSeite() {
  const t = useT();
  const sprache = useSprache();
  const { id } = route.useParams();
  const suche = route.useSearch();
  const { data: p } = useSuspenseQuery(personDetail(id));
  const aktivitaeten = useQuery(personAktivitaeten(id));
  const { darf } = useRechte();
  const [offen, setOffen] = useState<null | "zusammenfuehren" | "aktivitaet">(null);
  const weg = p.zusammengefuehrtIn !== null;
  const managedBy = p.providerSources?.find(source => source.mirrored)?.anbieter;
  const schreiben = !managedBy && darf("bearbeiter") && !weg;
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
  const aktiv = aktiverEintrag(suche, eintraege)?.id ?? "";
  // Die Attribute sind ein Abschnitt des ersten Bereichs, keine dauerhafte dritte Spalte.
  const attribute = <Datensatzpanel objekt="person" id={id} darfSchreiben={schreiben} titel={name} doppelt={["funktion", "unternehmen"]} />;
  const gruppen = [{ id: "bereiche", eintraege: eintraege.map(({ tab: _t, unter: _u, ...e }) => (e.id === eintraege[0]?.id ? { ...e, inhalt: () => <>{e.inhalt()}{attribute}</> } : e)) }];

  return (
    <div className="app-seite">
      {managedBy && <Hinweis>{sprache === "de" ? "Wird in " + managedBy + " gepflegt." : "Managed in " + managedBy + "."}</Hinweis>}
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
      <KontaktHerkunft herkunft={p.herkunft} />
      {alle("datensatzErgaenzung").map((E, i) => (
        <E key={i} objekt="person" id={p.id} darfSchreiben={schreiben} />
      ))}
      {weg ? (
        <Hinweis>
          {t.person.zusammengefuehrt}{" "}
          <Link to="/people/$id" params={{ id: p.zusammengefuehrtIn! }}>
            {t.person.zumBleibenden}
          </Link>
        </Hinweis>
      ) : null}

      <BereichsLeiste
        aria-label={t.tabs.bereiche}
        aktiv={aktiv}
        zurueck={{ label: t.nav.kontakte, ziel: { to: "/contacts", search: { objekt: "person" } } }}
        kopf={{ titel: name, titelSprache: DATENSPRACHE, untertitel: [p.funktion, p.organisation?.name].filter(Boolean).join(" · ") || undefined }}
        pfad={[{ label: t.nav.kontakte, ziel: { to: "/contacts", search: { objekt: "person" } } }, { label: name }]}
        gruppen={mitZielen(gruppen, eintraege, { to: "/people/$id", params: { id } })}
      />

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
