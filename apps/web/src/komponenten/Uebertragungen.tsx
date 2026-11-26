import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Feld, Hinweis, Segment, Seitenpanel, Status, Tabelle, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { fondsListe, kapitaltabelle, uebertragungen, type KapitalZeile, type Uebertragung } from "../api/abfragen";
import { heuteIso } from "../api/datum";
import { useUebertragungAnlegen, useUebertragungStorno, type NeueUebertragung } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { useSprache, useT, type Texte } from "../i18n";
import { betragRegel, datumRegel, ganzzahlRegel } from "../lib/feldpruefung";
import { useRechte } from "../lib/rechte";
import { formatAnzahl, formatBetragCent, formatPreis } from "../lib/zahl";
import { BetragFeld } from "./BetragFeld";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragOderNichts, textOderNichts, useFormular } from "./formular";
import { Skelettzeilen } from "./Skelett";
import { VehikelAuswahl, vehikelLabel, type VehikelTreffer } from "./VehikelAuswahl";

type Inhaber = Uebertragung["seller"];

/** Name eines Inhabers: Stammanteile, ein Fonds (ohne Namen: Sammelzeile „andere Fonds“, deren Details die Rechte nicht zeigen) oder ein Investor mit Vehikel. */
function inhaberText(t: Texte, h: Inhaber): string {
  const u = t.uebertragung;
  if (!h || h.type === "common") return u.stamm;
  if (h.type === "fund") return h.name || u.andereFonds;
  return h.vehicle && h.vehicle.name !== h.name ? vehikelLabel(h.vehicle.name, h.name) : h.name;
}

/** Zeilen der Captable, aus denen eine Übertragung Anteile abgeben kann: Stammanteile, Rundenpositionen, frühere Übertragungen und ausgeübte Optionsscheine (keine verdeckten Sammelzeilen). */
const QUELLE = /^(stamm|uebertragung:[0-9a-f-]{36}|ausuebung:[0-9a-f-]{36}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const alsQuelle = (z: KapitalZeile) => z.ausgegeben && Number(z.anteile) > 0 && QUELLE.test(z.id);

/**
 * Anteilsübertragungen des Unternehmens: Liste (auch stornierte, markiert), Erfassen und Storno als Ganzes. Zeilen eines Fonds, dessen Portfolio die Person
 * nicht sieht, erscheinen als „Andere Fonds“ ohne Preis und Kaufpreis (die API verdeckt sie).
 */
export function UebertragungenAbschnitt({ beteiligungId, organisationId, fondsId, lesend }: { beteiligungId: string; organisationId: string; fondsId: string; lesend: boolean }) {
  const t = useT();
  const u = t.uebertragung;
  const sprache = useSprache();
  const { darf } = useRechte();
  const { data, error, isPending } = useQuery(uebertragungen(organisationId));
  const [dialog, setDialog] = useState<{ art: "neu" } | { art: "storno"; zeile: Uebertragung } | null>(null);
  const darfSchreiben = darf("bearbeiter", fondsId, "portfolio") && !lesend;
  const kein = t.gemeinsam.keinWert;
  const spalten: TabelleSpalte<Uebertragung>[] = [
    { schluessel: "datum", kopf: u.spalten.datum, zelle: (x) => formatDatum(x.date, sprache) },
    { schluessel: "verkaeufer", kopf: u.spalten.verkaeufer, zelle: (x) => inhaberText(t, x.seller) },
    { schluessel: "kaeufer", kopf: u.spalten.kaeufer, zelle: (x) => inhaberText(t, x.buyer) },
    { schluessel: "anteile", kopf: u.spalten.anteile, zahl: true, zelle: (x) => formatAnzahl(x.shares, sprache) },
    { schluessel: "preis", kopf: u.spalten.preis, zahl: true, zelle: (x) => (x.pricePerShare === null ? kein : formatPreis(x.pricePerShare, sprache)) },
    { schluessel: "kaufpreis", kopf: u.spalten.kaufpreis, zahl: true, zelle: (x) => (x.purchasePrice === null ? kein : formatBetragCent(x.purchasePrice, sprache)) },
    {
      schluessel: "stand",
      kopf: u.spalten.stand,
      zelle: (x) => (x.reversedAt ? <Status variante="fehlt">{u.storniert(formatDatum(x.reversedAt.slice(0, 10), sprache))}</Status> : <Status variante="freigegeben">{u.gebucht}</Status>),
    },
    ...(darfSchreiben
      ? [
          {
            schluessel: "aktion",
            kopf: u.spalten.aktion,
            zelle: (x: Uebertragung) =>
              x.reversedAt ? null : (
                <Button variante="ruhig" groesse="s" aria-label={u.stornierenFuer(formatDatum(x.date, sprache), formatAnzahl(x.shares, sprache))} onClick={() => setDialog({ art: "storno", zeile: x })}>
                  {u.stornieren}
                </Button>
              ),
          },
        ]
      : []),
  ];
  return (
    <>
      <section className="app-karte" aria-labelledby="uebertragungen-titel">
        <div className="app-karte__kopf">
          <h2 id="uebertragungen-titel" className="cw-t-untertitel app-karte__titel">
            {u.titel}
          </h2>
          {darfSchreiben ? <Button onClick={() => setDialog({ art: "neu" })}>{u.erfassen}</Button> : null}
        </div>
        <p className="app-leer-text">{u.beschreibung}</p>
        {isPending ? <Skelettzeilen anzahl={2} /> : null}
        {error ? <FehlerHinweis fehler={error} /> : null}
        {data && data.length === 0 ? <p className="app-leer-text">{u.keine}</p> : null}
        {data && data.length > 0 ? <Tabelle beschriftung={u.tabelle} spalten={spalten} zeilen={data} zeilenSchluessel={(x) => x.id} /> : null}
      </section>
      {dialog?.art === "neu" ? <UebertragungDialog beteiligungId={beteiligungId} organisationId={organisationId} onSchliessen={() => setDialog(null)} /> : null}
      {dialog?.art === "storno" ? <UebertragungStornoDialog organisationId={organisationId} zeile={dialog.zeile} onSchliessen={() => setDialog(null)} /> : null}
    </>
  );
}

const FELDER = ["date", "source", "buyerFundId", "buyerVehicleId", "buyerOrganizationId", "shares", "pricePerShare", "purchasePriceFundCurrency", "note"];
const ganzzahl = (wert: string) => wert.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "");

/** Übertragung erfassen: abgebender Bestand (Zeile der Captable zum Datum), Käufer (Fonds oder Investor), Anzahl und Preis. Die API prüft Bestände, Rechte und bucht eigene Fonds. */
function UebertragungDialog({ beteiligungId, organisationId, onSchliessen }: { beteiligungId: string; organisationId: string; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.uebertragung.form;
  const { darf } = useRechte();
  const anlegen = useUebertragungAnlegen(organisationId);
  const fonds = useQuery(fondsListe());
  const [art, setArt] = useState<"fonds" | "investor">("investor");
  const [investor, setInvestor] = useState<VehikelTreffer | null>(null);
  const { werte, feld, pruefeAlle } = useFormular(
    { date: heuteIso(), quelle: "", fondsId: "", shares: "", preis: "", kaufpreisFonds: "", bemerkung: "" },
    { date: datumRegel({ pflicht: true }), shares: ganzzahlRegel({ min: 1, pflicht: true }), preis: betragRegel({ nachkomma: 6, ganzstellen: 12, pflicht: true }), kaufpreisFonds: betragRegel() },
  );
  const tabelle = useQuery({ ...kapitaltabelle(beteiligungId, werte.date), enabled: werte.date.length === 10 });
  const quellen = (tabelle.data?.zeilen ?? []).filter(alsQuelle);
  const quelle = quellen.some((z) => z.id === werte.quelle) ? werte.quelle : (quellen[0]?.id ?? "");
  const eigeneFonds = (fonds.data ?? []).filter((x) => darf("bearbeiter", x.id, "portfolio"));
  const kaeufer = art === "fonds" ? werte.fondsId !== "" : investor !== null;
  const fehler = (name: string) => feldText(t, anlegen.error, name);
  const zeilenText = (z: KapitalZeile) => f.quelleOption(inhaberZeile(t, z), z.klasseName ?? t.kapital.stammanteile, formatAnzahl(z.anteile, sprache));

  function senden() {
    if (!pruefeAlle() || !kaeufer || !quelle) return;
    const koerper: NeueUebertragung = {
      date: werte.date,
      source: quelle,
      shares: ganzzahl(werte.shares),
      pricePerShare: betragOderNichts(werte.preis, sprache) ?? "",
      ...(art === "fonds" ? { buyerFundId: werte.fondsId } : investor?.art === "organisation" ? { buyerOrganizationId: investor.id } : { buyerVehicleId: investor?.id }),
      ...(betragOderNichts(werte.kaufpreisFonds, sprache) ? { purchasePriceFundCurrency: betragOderNichts(werte.kaufpreisFonds, sprache) } : {}),
      ...(textOderNichts(werte.bemerkung) ? { note: textOderNichts(werte.bemerkung) } : {}),
    };
    anlegen.mutate(koerper, { onSuccess: onSchliessen });
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
          senden();
        }}
      >
        <FehlerHinweis fehler={anlegen.error} bekannt={FELDER} />
        <Feld label={f.datum} type="date" max={heuteIso()} {...feld("date", fehler("date"))} />
        {tabelle.isSuccess && quellen.length === 0 ? (
          <Hinweis>{f.keineQuelle}</Hinweis>
        ) : (
          <Auswahl label={f.quelle} value={quelle} onChange={(e) => feld("quelle").onChange(e)} fehler={fehler("source")}>
            {quellen.map((z) => (
              <option key={z.id} value={z.id}>
                {zeilenText(z)}
              </option>
            ))}
          </Auswahl>
        )}
        <fieldset className="app-gruppe">
          <legend className="cw-feld__label">{f.kaeufer}</legend>
          <Segment<"fonds" | "investor">
            aria-label={f.kaeufer}
            value={art}
            onChange={setArt}
            options={[
              { wert: "investor", label: f.artInvestor },
              { wert: "fonds", label: f.artFonds },
            ]}
          />
          {art === "fonds" ? (
            <Auswahl label={f.fonds} {...feld("fondsId")} fehler={fehler("buyerFundId")}>
              <option value="" />
              {eigeneFonds.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Auswahl>
          ) : (
            <VehikelAuswahl label={f.investor} gewaehlt={investor} onWaehlen={setInvestor} ausser={organisationId} fehler={fehler("buyerVehicleId") ?? fehler("buyerOrganizationId")} />
          )}
        </fieldset>
        <BetragFeld label={f.anzahl} inputMode="numeric" {...feld("shares", fehler("shares"))} />
        <BetragFeld label={f.preis} hilfe={f.preisHilfe} {...feld("preis", fehler("pricePerShare"))} />
        <BetragFeld label={f.kaufpreisFonds} hilfe={f.kaufpreisFondsHilfe} {...feld("kaufpreisFonds", fehler("purchasePriceFundCurrency"))} />
        <Feld label={f.bemerkung} autoComplete="off" {...feld("bemerkung", fehler("note"))} />
        <div>
          <Button type="submit" disabled={anlegen.isPending || !kaeufer || !quelle}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

/** Name des Inhabers einer Zeile der Captable (wie die Tabelle: Vehikel · Investor, Fonds, Stammanteile). */
function inhaberZeile(t: Texte, z: KapitalZeile): string {
  const h = z.halter;
  if (h.art === "stamm") return t.kapital.stamm;
  if (h.art === "organisation" && h.vehikel && h.vehikel.name !== h.name) return vehikelLabel(h.vehikel.name, h.name);
  return t.kapital.halter[h.art]?.(h.name) ?? h.name;
}

/** Storno einer Übertragung als Ganzes mit Grund. */
function UebertragungStornoDialog({ organisationId, zeile, onSchliessen }: { organisationId: string; zeile: Uebertragung; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.uebertragung.storno;
  const storno = useUebertragungStorno(organisationId);
  const { werte, feld } = useFormular({ grund: "" });
  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <p className="app-leer-text">{f.beschreibung(formatDatum(zeile.date, sprache), formatAnzahl(zeile.shares, sprache))}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          storno.mutate({ transferId: zeile.id, reason: werte.grund.trim() }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={storno.error} bekannt={["reason"]} />
        <Feld label={f.grund} autoComplete="off" {...feld("grund")} fehler={feldText(t, storno.error, "reason")} />
        <div>
          <Button type="submit" variante="gefahr" disabled={storno.isPending}>
            {f.stornieren}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
