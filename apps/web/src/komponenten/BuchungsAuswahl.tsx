import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Feld, Tabelle, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { fondsUebersicht, journal, type JournalFilter, type JournalZeile } from "../api/abfragen";
import { FehlerHinweis } from "./FehlerHinweis";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { formatBetragCent } from "../lib/zahl";

/** Arten, die der DATEV-Export kennt (Vorgangsarten und Bewegungsarten); Bewertungen und Ereignisse gehören nicht dazu. */
export const EXPORTIERBARE_ARTEN = ["zusage", "auszahlung", "rueckfluss", "zins", "tilgung", "wertberichtigung", "abruf", "ausschuettung"] as const;

/** Gewählte Buchungen: Schlüssel `<quelle>:<id>`, Wert die Quelle. Vorgänge und Fondsbewegungen laufen im Export auf getrennten Listen. */
export type Auswahlstand = Record<string, "vorgang" | "fondsbewegung">;

const schluessel = (z: Pick<JournalZeile, "quelle" | "id">) => `${z.quelle}:${z.id}`;
const exportierbar = (z: JournalZeile): z is JournalZeile & { quelle: "vorgang" | "fondsbewegung" } => z.quelle === "vorgang" || z.quelle === "fondsbewegung";

export function idsAus(stand: Auswahlstand) {
  const ids = (quelle: "vorgang" | "fondsbewegung") =>
    Object.entries(stand)
      .filter(([, q]) => q === quelle)
      .map(([k]) => k.slice(quelle.length + 1));
  return { vorgangIds: ids("vorgang"), fondsBewegungIds: ids("fondsbewegung") };
}

/**
 * Freie Auswahl einzelner Buchungen für den DATEV-Export: Filter nach Zeitraum, Art und Beteiligung, dazu ein Kästchen je Zeile. Die Liste ist das
 * Journal des Fonds (dieselbe API, dieselben Zeilen); die Auswahl bleibt beim Ändern der Filter erhalten. Ob die Auswahl exportierbar ist und welche
 * Probleme sie hat, sagt die Vorschau der API.
 */
export function BuchungsAuswahl({ fondsId, stand, onStand }: { fondsId: string; stand: Auswahlstand; onStand: (neu: Auswahlstand) => void }) {
  const t = useT();
  const sprache = useSprache();
  const a = t.buchhaltung.export.auswahl;
  const j = t.journal;
  const [filter, setFilter] = useState({ von: "", bis: "", art: "", beteiligungId: "", nurNeue: true });
  const { data: uebersicht } = useQuery(fondsUebersicht(fondsId));
  const abfrageFilter: JournalFilter = {
    ...(filter.von ? { von: filter.von } : {}),
    ...(filter.bis ? { bis: filter.bis } : {}),
    typ: filter.art || EXPORTIERBARE_ARTEN.join(","),
    ...(filter.beteiligungId ? { beteiligungId: filter.beteiligungId } : {}),
  };
  const abfrage = useInfiniteQuery(journal(fondsId, abfrageFilter));
  const alle = (abfrage.data?.pages ?? []).flatMap((p) => p.daten).filter(exportierbar);
  const zeilen = filter.nurNeue ? alle.filter((z) => !z.buchhaltung?.exportiertAm) : alle;
  const anzahl = Object.keys(stand).length;
  const alleGewaehlt = zeilen.length > 0 && zeilen.every((z) => stand[schluessel(z)] !== undefined);

  const umschalten = (z: JournalZeile & { quelle: "vorgang" | "fondsbewegung" }, an: boolean) => {
    const neu = { ...stand };
    if (an) neu[schluessel(z)] = z.quelle;
    else delete neu[schluessel(z)];
    onStand(neu);
  };
  const alleUmschalten = (an: boolean) => {
    const neu = { ...stand };
    for (const z of zeilen) {
      if (an) neu[schluessel(z)] = z.quelle;
      else delete neu[schluessel(z)];
    }
    onStand(neu);
  };

  const spalten: TabelleSpalte<(typeof zeilen)[number]>[] = [
    {
      schluessel: "wahl",
      kopf: (
        <input type="checkbox" aria-label={a.alleSichtbaren} checked={alleGewaehlt} disabled={zeilen.length === 0} onChange={(e) => alleUmschalten(e.target.checked)} />
      ),
      zelle: (z) => (
        <input
          type="checkbox"
          aria-label={a.zeileWaehlen(aufzaehlung(j.typen, z.typ), formatDatum(z.valuta, sprache), z.beteiligung?.organisationName ?? t.gemeinsam.keinWert)}
          checked={stand[schluessel(z)] !== undefined}
          onChange={(e) => umschalten(z, e.target.checked)}
        />
      ),
    },
    { schluessel: "valuta", kopf: j.spalten.valuta, zelle: (z) => formatDatum(z.valuta, sprache) },
    { schluessel: "typ", kopf: j.spalten.typ, zelle: (z) => `${aufzaehlung(j.typen, z.typ)}${z.stornoVon ? ` (${j.stornoVon})` : z.storniertDurch ? ` (${j.storniert})` : ""}` },
    { schluessel: "unternehmen", kopf: j.spalten.unternehmen, zelle: (z) => z.beteiligung?.organisationName ?? t.gemeinsam.keinWert },
    { schluessel: "betrag", kopf: j.spalten.betrag, zahl: true, zelle: (z) => (z.betrag === null ? t.gemeinsam.keinWert : formatBetragCent(z.betrag, sprache)) },
    { schluessel: "beleg", kopf: a.beleg, zelle: (z) => z.buchhaltung?.belegnummer ?? a.keinBeleg },
    { schluessel: "exportiert", kopf: a.exportiert, zelle: (z) => (z.buchhaltung?.exportiertAm ? a.exportiertAm(formatDatum(z.buchhaltung.exportiertAm.slice(0, 10), sprache)) : a.offen) },
  ];

  return (
    <div className="app-gruppe">
      <form className="app-filter" aria-label={a.filter} onSubmit={(e) => e.preventDefault()}>
        <Feld label={j.filter.von} type="date" value={filter.von} onChange={(e) => setFilter((f) => ({ ...f, von: e.target.value }))} />
        <Feld label={j.filter.bis} type="date" value={filter.bis} onChange={(e) => setFilter((f) => ({ ...f, bis: e.target.value }))} />
        <Auswahl label={j.filter.typ} value={filter.art} onChange={(e) => setFilter((f) => ({ ...f, art: e.target.value }))}>
          <option value="">{a.alleArten}</option>
          {EXPORTIERBARE_ARTEN.map((x) => (
            <option key={x} value={x}>
              {aufzaehlung(j.typen, x)}
            </option>
          ))}
        </Auswahl>
        <Auswahl label={j.filter.beteiligung} value={filter.beteiligungId} onChange={(e) => setFilter((f) => ({ ...f, beteiligungId: e.target.value }))}>
          <option value="">{j.filter.alleBeteiligungen}</option>
          {(uebersicht?.beteiligungen ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.organisation.name}
            </option>
          ))}
        </Auswahl>
        <label className="app-haken">
          <input type="checkbox" checked={filter.nurNeue} onChange={(e) => setFilter((f) => ({ ...f, nurNeue: e.target.checked }))} /> {a.nurNeue}
        </label>
      </form>
      <FehlerHinweis fehler={abfrage.error} />
      {abfrage.isPending ? <p className="app-leer-text">{t.gemeinsam.laedt}</p> : null}
      {abfrage.data && zeilen.length === 0 ? <p className="app-leer-text">{a.keine}</p> : null}
      {zeilen.length > 0 ? <Tabelle festeSpalten={2} beschriftung={a.tabelle} spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => schluessel(z)} /> : null}
      {abfrage.hasNextPage ? (
        <div>
          <Button variante="sekundaer" disabled={abfrage.isFetchingNextPage} onClick={() => void abfrage.fetchNextPage()}>
            {j.ladeMehr}
          </Button>
        </div>
      ) : null}
      <div className="app-aktionen__knoepfe">
        <p className="app-leer-text" role="status">
          {a.gewaehlt(anzahl)}
        </p>
        {anzahl > 0 ? (
          <Button variante="ruhig" onClick={() => onStand({})}>
            {a.leeren}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
