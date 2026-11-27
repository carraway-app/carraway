import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ButtonLink, Hinweis, Seitenkopf, Status, Tabelle, type StatusVariante, type TabelleSpalte } from "@carraway/ui";
import { importLaeufe, MAX_UPLOAD, useLaufHochladen, vorlageUrl, type Importlauf } from "../api/import";
import { DateiDropzone } from "../komponenten/DateiDropzone";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { Skelettzeilen } from "../komponenten/Skelett";
import { useSprache, useT, type Texte } from "../i18n";
import { formatZeitpunkt } from "../lib/zeit";

const MB = MAX_UPLOAD / 1024 / 1024;

export const LAUF_VARIANTE: Record<string, StatusVariante> = { hochgeladen: "entwurf", mitFehlern: "fehlt", geprueft: "pruefung", uebernommen: "freigegeben" };

/** Schlüssel des Status zur Anzeige: „hochgeladen“ mit Prüfung heißt „geprüft, mit Fehlern“. */
export function laufStatusSchluessel(lauf: Pick<Importlauf, "status" | "geprueftAm">): "hochgeladen" | "mitFehlern" | "geprueft" | "uebernommen" {
  if (lauf.status === "hochgeladen" && lauf.geprueftAm) return "mitFehlern";
  return lauf.status;
}

export const laufStatusText = (t: Texte, lauf: Pick<Importlauf, "status" | "geprueftAm">) => t.datenuebernahme.status[laufStatusSchluessel(lauf)];

/** Datenübernahme: Vorlage, Hochladen, Liste der Läufe. Die API prüft jede Anfrage selbst. */
export function ImportSeite() {
  const t = useT();
  const d = t.datenuebernahme;
  const sprache = useSprache();
  const { data, isPending, error } = useQuery(importLaeufe());

  const spalten: TabelleSpalte<Importlauf>[] = [
    { schluessel: "datei", kopf: d.laeufe.spalten.datei, zelle: (l) => l.dateiname },
    { schluessel: "status", kopf: d.laeufe.spalten.status, zelle: (l) => <Status variante={LAUF_VARIANTE[laufStatusSchluessel(l)] ?? "entwurf"}>{laufStatusText(t, l)}</Status> },
    { schluessel: "hochgeladen", kopf: d.laeufe.spalten.hochgeladen, zelle: (l) => d.laeufe.von(l.hochgeladenVonName ?? t.rechte.unbekanntePerson, formatZeitpunkt(l.hochgeladenAm, sprache)) },
    {
      schluessel: "befunde",
      kopf: d.laeufe.spalten.befunde,
      zelle: (l) => (l.eingeschraenkt ? d.laeufe.eingeschraenkt : l.fehlerAnzahl === null || l.warnungAnzahl === null ? d.laeufe.ohneBefunde : d.laeufe.befunde(l.fehlerAnzahl, l.warnungAnzahl)),
    },
    {
      schluessel: "aktion",
      kopf: d.laeufe.spalten.aktion,
      zelle: (l) => (
        <Link to="/import/$id" params={{ id: l.id }} aria-label={d.laeufe.oeffnenFuer(l.dateiname)}>
          {d.laeufe.oeffnen}
        </Link>
      ),
    },
  ];

  return (
    <div className="app-seite">
      <Seitenkopf info={d.einleitung} meta={d.etikett} titel={d.titel} />

      <section className="app-karte" aria-labelledby="import-vorlage">
        <h2 id="import-vorlage" className="cw-t-untertitel app-karte__titel">
          {d.vorlage.titel}
        </h2>
        <p className="app-leer-text">{d.vorlage.text}</p>
        <div className="app-aktionen__knoepfe">
          <ButtonLink variante="sekundaer" href={vorlageUrl("de")} download>
            {d.vorlage.de}
          </ButtonLink>
          <ButtonLink variante="sekundaer" href={vorlageUrl("en")} download>
            {d.vorlage.en}
          </ButtonLink>
        </div>
      </section>

      <Hochladen />

      <section className="app-karte" aria-labelledby="import-laeufe">
        <h2 id="import-laeufe" className="cw-t-untertitel app-karte__titel">
          {d.laeufe.titel}
        </h2>
        <p className="app-leer-text">{d.laeufe.beschreibung}</p>
        {isPending ? <Skelettzeilen anzahl={3} /> : null}
        <FehlerHinweis fehler={error} />
        {data && data.length === 0 ? <p className="app-leer-text">{d.laeufe.keine}</p> : null}
        {data && data.length > 0 ? <Tabelle beschriftung={d.laeufe.tabelle} spalten={spalten} zeilen={data} zeilenSchluessel={(l) => l.id} /> : null}
      </section>
    </div>
  );
}

/** Ablegefläche und Dateiauswahl; das Hochladen legt einen Lauf an und öffnet ihn. Größe und Endung prüft die Oberfläche vorab, die API prüft den Inhalt. */
function Hochladen() {
  const t = useT();
  const d = t.datenuebernahme.hochladen;
  const navigate = useNavigate();
  const hochladen = useLaufHochladen();
  const [meldung, setMeldung] = useState<string | null>(null);

  function nimm(dateien: File[]) {
    if (hochladen.isPending) return;
    const datei = dateien[0];
    setMeldung(null);
    if (!datei) return;
    if (!/\.(xlsx|csv)$/i.test(datei.name)) return setMeldung(d.falscheEndung);
    if (datei.size > MAX_UPLOAD) return setMeldung(d.zuGross(MB));
    if (dateien.length > 1) setMeldung(d.mehrere);
    hochladen.mutate(datei, { onSuccess: (lauf) => void navigate({ to: "/import/$id", params: { id: lauf.id } }) });
  }

  return (
    <section className="app-karte" aria-labelledby="import-hochladen">
      <h2 id="import-hochladen" className="cw-t-untertitel app-karte__titel">
        {d.titel}
      </h2>
      <p className="app-leer-text">{d.text}</p>
      <DateiDropzone label={d.feldLabel} mehrfachAblage accept=".xlsx,.csv" deaktiviert={hochladen.isPending} auswahlText={d.auswaehlen} hinweis={d.hinweis(MB)} testId="import-datei-dropzone" onDateien={nimm} />
      {hochladen.isPending ? <Hinweis>{d.laedt}</Hinweis> : null}
      {meldung ? (
        <Hinweis variante="fehler" titel={t.fehler.titel}>
          {meldung}
        </Hinweis>
      ) : null}
      <FehlerHinweis fehler={hochladen.error} />
    </section>
  );
}
