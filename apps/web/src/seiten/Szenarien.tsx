import { Bereichskopf } from "../komponenten/Bereichskopf";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { Button, DotsThreeIcon, formatDatum, Menue, ScalesIcon, StackIcon, Status, Tabelle, Tabs, type MenueEintrag, type StatusVariante, type TabelleSpalte } from "@carraway/ui";
import { useBerichtAnlegen } from "../api/mutationen";
import { szenarienListe, szenarioBerichtUrl, szenarioDetail, szenarioVorlage, useSzenarioDuplizieren, useSzenarioFestschreiben, useSzenarioLoeschen, type SzenarioKopf } from "../api/szenarien";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { Skelettzeilen } from "../komponenten/Skelett";
import { SzenarioEditor } from "../komponenten/SzenarioEditor";
import { SzenarioVergleich } from "../komponenten/SzenarioVergleich";
import { Bewertungsszenarien } from "../komponenten/Bewertungsszenarien";
import { useTabs } from "../lib/tabs";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { useRechte } from "../lib/rechte";

const route = getRouteApi("/fonds/$fondsId/szenarien");

const STATUS: Record<string, StatusVariante> = { entwurf: "pruefung", festgeschrieben: "freigegeben" };
const MAX_VERGLEICH = 3;

type Offen = null | "neu" | { bearbeiten: string } | { festschreiben: SzenarioKopf } | { loeschen: SzenarioKopf };

/**
 * Szenarien eines Fonds: Liste, Editor mit Annahmen je Beteiligung, Vergleich von bis zu drei Szenarien mit J-Kurve, Festschreiben und
 * Berichtsexport. Anlegen und Ändern darf ein Bearbeiter, Festschreiben ein Freigeber. Die Rechnung liegt auf dem Server.
 */
export function SzenarienSeite() {
  const t = useT();
  const z = t.szenarien;
  const sprache = useSprache();
  const { fondsId } = route.useParams();
  const { data: liste, error, isPending } = useQuery(szenarienListe(fondsId));
  const vorlage = useQuery(szenarioVorlage(fondsId));
  const { darf } = useRechte();
  const [offen, setOffen] = useState<Offen>(null);
  const [auswahl, setAuswahl] = useState<string[]>([]);
  const [zeigeVergleich, setZeigeVergleich] = useState(false);
  const festschreiben = useSzenarioFestschreiben(fondsId);
  const loeschen = useSzenarioLoeschen(fondsId);
  const duplizieren = useSzenarioDuplizieren(fondsId);
  const berichtAnlegen = useBerichtAnlegen();
  const navigate = useNavigate();
  const suche = route.useSearch();
  const { tab, setzeTab } = useTabs(suche, route.useNavigate(), ["szenarien", "bewertung"] as const);
  const bearbeitenId = typeof offen === "object" && offen && "bearbeiten" in offen ? offen.bearbeiten : "";
  const detail = useQuery({ ...szenarioDetail(bearbeitenId), enabled: bearbeitenId !== "" });
  const schreiben = darf("bearbeiter", fondsId, "portfolio");
  const freigeben = darf("freigeber", fondsId, "portfolio");

  const umschalten = (id: string) => setAuswahl((a) => (a.includes(id) ? a.filter((x) => x !== id) : a.length >= MAX_VERGLEICH ? a : [...a, id]));
  const maximal = auswahl.length >= MAX_VERGLEICH;
  const schliessen = () => setOffen(null);

  const spalten: TabelleSpalte<SzenarioKopf>[] = [
    {
      schluessel: "auswahl",
      kopf: <span className="cw-nur-lesen">{z.spalten.auswahl}</span>,
      zelle: (s) => <input type="checkbox" aria-label={z.auswahlFuer(s.name)} checked={auswahl.includes(s.id)} disabled={!auswahl.includes(s.id) && maximal} onChange={() => umschalten(s.id)} />,
    },
    { schluessel: "name", kopf: z.spalten.name, zelle: (s) => s.name },
    { schluessel: "status", kopf: z.spalten.status, zelle: (s) => <Status variante={STATUS[s.status] ?? "entwurf"}>{aufzaehlung(z.status, s.status)}</Status> },
    { schluessel: "basis", kopf: z.spalten.basis, zelle: (s) => formatDatum(s.basisStichtag, sprache) },
    { schluessel: "fest", kopf: z.spalten.festgeschrieben, zelle: (s) => (s.festgeschriebenAm ? formatDatum(s.festgeschriebenAm.slice(0, 10), sprache) : t.gemeinsam.keinWert) },
    {
      schluessel: "aktion",
      kopf: <span className="cw-nur-lesen">{z.spalten.aktion}</span>,
      zelle: (s) => {
        const eintraege: MenueEintrag[] = [
          ...(schreiben && s.status === "entwurf" ? [{ id: "bearbeiten", label: z.bearbeiten, onClick: () => setOffen({ bearbeiten: s.id }) }] : []),
          ...(schreiben ? [{ id: "duplizieren", label: z.duplizieren, deaktiviert: duplizieren.isPending, onClick: () => duplizieren.mutate(s.id) }] : []),
          ...(schreiben && s.status === "festgeschrieben"
            ? [
                {
                  id: "bericht",
                  label: z.alsBericht,
                  deaktiviert: berichtAnlegen.isPending,
                  onClick: () => berichtAnlegen.mutate({ art: "szenariobericht", fondsId, szenarioIds: [s.id], sprache }, { onSuccess: (neu) => void navigate({ to: "/berichte/$id", params: { id: neu.id } }) }),
                },
              ]
            : []),
          ...(freigeben && s.status === "entwurf" ? [{ id: "festschreiben", label: z.festschreiben, onClick: () => setOffen({ festschreiben: s }) }] : []),
          ...(schreiben && s.status === "entwurf" ? [{ id: "loeschen", label: z.loeschen, gefahr: true, trennerDavor: true, onClick: () => setOffen({ loeschen: s }) }] : []),
        ];
        return (
          <div className="app-aktionen__knoepfe app-zeilenaktionen">
            {(["pdf", "xlsx"] as const).map((format) => (
              <a key={format} className="cw-button cw-button--ruhig" href={szenarioBerichtUrl(s.id, format, sprache)} download aria-label={`${s.name}: ${z.vergleich.exportFuer(z.vergleich.export[format])}`}>
                {z.vergleich.export[format]}
              </a>
            ))}
            {eintraege.length > 0 ? <Menue aria-label={`${z.zeilenmenue}: ${s.name}`} ausloeser={<DotsThreeIcon />} ausloeserKlasse="cw-button cw-button--ruhig cw-button--icon" eintraege={eintraege} /> : null}
          </div>
        );
      },
    },
  ];

  return (
    <div className="app-seite">
      <Bereichskopf titel={z.titel}>
        {schreiben ? (
          <Button onClick={() => setOffen("neu")} disabled={!vorlage.data}>
            {z.neu}
          </Button>
        ) : null}
      </Bereichskopf>
      <p className="app-leer-text">{z.beschreibung}</p>
      <FehlerHinweis fehler={festschreiben.error ?? loeschen.error ?? duplizieren.error} />

      {offen === "neu" && vorlage.data ? <SzenarioEditor fondsId={fondsId} vorlage={vorlage.data} onFertig={schliessen} onAbbrechen={schliessen} /> : null}
      {bearbeitenId && detail.data && vorlage.data ? (
        <SzenarioEditor fondsId={fondsId} vorlage={vorlage.data} vorhanden={{ id: detail.data.id, name: detail.data.name, basisStichtag: detail.data.basisStichtag, annahmen: detail.data.annahmen }} onFertig={schliessen} onAbbrechen={schliessen} />
      ) : null}

      <Tabs
        aria-label={t.tabs.bereiche}
        aktiv={tab}
        onWechsel={setzeTab}
        tabs={[
          {
            id: "szenarien",
            icon: StackIcon,
            label: z.tabs.szenarien,
            zaehler: liste?.length,
            inhalt: () => (
              <>
                <section className="app-karte">
                  {isPending ? (
                    <Skelettzeilen anzahl={3} />
                  ) : error ? (
                    <FehlerHinweis fehler={error} />
                  ) : liste.length === 0 ? (
                    <p className="app-leer-text">{z.keine}</p>
                  ) : (
                    <>
                      <Tabelle beschriftung={z.titel} spalten={spalten} zeilen={liste} zeilenSchluessel={(s) => s.id} festeSpalten={2} />
                      {maximal ? <p className="app-leer-text">{z.auswahlMax}</p> : null}
                      <div className="app-aktionen__knoepfe">
                        <Button variante="sekundaer" disabled={auswahl.length === 0} onClick={() => setZeigeVergleich(true)}>
                          {z.vergleichen}
                        </Button>
                        {auswahl.length === 0 ? <span className="app-leer-text">{z.vergleichHinweis}</span> : null}
                      </div>
                    </>
                  )}
                </section>

                {zeigeVergleich && auswahl.length > 0 ? <SzenarioVergleich fondsId={fondsId} ids={auswahl} /> : null}
              </>
            ),
          },
          { id: "bewertung", icon: ScalesIcon, label: z.tabs.bewertung, inhalt: () => <Bewertungsszenarien fondsId={fondsId} liste={liste ?? []} schreiben={schreiben} /> },
        ]}
      />

      {typeof offen === "object" && offen && "festschreiben" in offen ? (
        <Seitenpanel titel={z.festschreiben} onSchliessen={schliessen}>
          <p>{z.festschreibenFrage(offen.festschreiben.name)}</p>
          <FehlerHinweis fehler={festschreiben.error} />
          <Button disabled={festschreiben.isPending} onClick={() => festschreiben.mutate(offen.festschreiben.id, { onSuccess: schliessen })}>
            {z.festschreibenBestaetigen}
          </Button>
        </Seitenpanel>
      ) : null}
      {typeof offen === "object" && offen && "loeschen" in offen ? (
        <Seitenpanel titel={z.loeschen} onSchliessen={schliessen}>
          <p>{z.loeschenFrage(offen.loeschen.name)}</p>
          <Button disabled={loeschen.isPending} onClick={() => loeschen.mutate(offen.loeschen.id, { onSuccess: () => { setAuswahl((a) => a.filter((x) => x !== offen.loeschen.id)); schliessen(); } })}>
            {z.loeschen}
          </Button>
        </Seitenpanel>
      ) : null}
    </div>
  );
}
