import { KeinFonds } from "./Platzhalter";
import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Auswahl, Seitenkopf, Status, Tabelle, formatDatum, type StatusVariante, type TabelleSpalte, Leer } from "@carraway/ui";
import { belegListe, type BelegZeile } from "../api/buchhaltung";
import { fondsListe } from "../api/abfragen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { wirksamerFonds } from "../lib/fonds";
import { formatBetragCent } from "../lib/zahl";
import { merkeFonds } from "../zustand";

const route = getRouteApi("/vouchers");

export const BELEG_STATUS: Record<string, StatusVariante> = { entwurf: "entwurf", geprueft: "pruefung", freigegeben: "freigegeben", storniert: "fehlt" };

/** Belege eines Fonds: Liste mit Nummer, Art, Datum, Betrag, Status und fehlenden Angaben. */
export function BelegeSeite() {
  const t = useT();
  const { data: fonds } = useSuspenseQuery(fondsListe());
  const { fondsId } = route.useSearch();
  const gewaehlt = wirksamerFonds(fonds, fondsId);
  if (!gewaehlt) return <KeinFonds titel={t.buchhaltung.belege.titel} />;
  return <BelegeFuerFonds key={gewaehlt.id} fondsId={gewaehlt.id} fondsName={gewaehlt.name} />;
}

function BelegeFuerFonds({ fondsId, fondsName }: { fondsId: string; fondsName: string }) {
  const t = useT();
  const sprache = useSprache();
  const b = t.buchhaltung.belege;
  const [status, setStatus] = useState("");
  const artText = (z: BelegZeile) => (sprache === "de" ? z.artNameDe : z.artNameEn) ?? aufzaehlung(t.buchhaltung.belegArt, z.art);
  const { data: belege } = useSuspenseQuery(belegListe(fondsId, status || undefined));
  merkeFonds(fondsId);

  const spalten: TabelleSpalte<BelegZeile>[] = [
    { schluessel: "nummer", kopf: b.spalten.nummer, zelle: (z) => z.belegnummer ?? b.ohneNummer },
    { schluessel: "art", kopf: b.spalten.art, zelle: (z) => artText(z) },
    { schluessel: "datum", kopf: b.spalten.datum, zelle: (z) => (z.datum ? formatDatum(z.datum, sprache) : t.gemeinsam.keinWert) },
    { schluessel: "betrag", kopf: b.spalten.betrag, zahl: true, zelle: (z) => (z.betrag ? formatBetragCent(z.betrag, sprache) : t.gemeinsam.keinWert) },
    { schluessel: "status", kopf: b.spalten.status, zelle: (z) => <Status variante={BELEG_STATUS[z.status] ?? "entwurf"}>{aufzaehlung(t.buchhaltung.belegStatus, z.status)}</Status> },
    { schluessel: "befunde", kopf: b.spalten.befunde, zelle: (z) => b.befunde((z.befunde as unknown[]).length) },
    {
      schluessel: "aktion",
      kopf: b.spalten.aktion,
      zelle: (z) => (
        <Link to="/vouchers/$id" params={{ id: z.id }} aria-label={b.oeffnenFuer(artText(z), z.belegnummer ?? b.ohneNummer)}>
          {b.oeffnen}
        </Link>
      ),
    },
  ];

  return (
    <div className="app-seite">
      <Seitenkopf meta={`${fondsName} · ${b.etikett}`} titel={b.titel} />
      <section className="app-karte" aria-label={b.titel}>
        <div className="app-filter app-filter--leiste">
          <Auswahl label={b.filterStatus} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{b.alle}</option>
            {Object.entries(t.buchhaltung.belegStatus).map(([wert, text]) => (
              <option key={wert} value={wert}>
                {text}
              </option>
            ))}
          </Auswahl>
        </div>
        {belege.length === 0 ? <Leer titel={b.keine} beschreibung="" /> : <Tabelle dicht beschriftung={b.liste} spalten={spalten} zeilen={belege} zeilenSchluessel={(z) => z.id} />}
      </section>
    </div>
  );
}
