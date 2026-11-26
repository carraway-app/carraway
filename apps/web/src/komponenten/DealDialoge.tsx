import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "@tanstack/react-router";
import { Auswahl, Button, Feld, Textbereich } from "@carraway/ui";
import { heuteIso } from "../api/datum";
import { fondsUebersicht, type DealDetail, type FondsEintrag } from "../api/abfragen";
import { ApiFehler } from "../api/client";
import { useBeschlussAnlegen, useDealAbsagen, useInsPortfolio } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useT } from "../i18n";
import { useRechte } from "../lib/rechte";
import { letzterFonds } from "../zustand";
import { beschlussFonds } from "../lib/beschluss";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragFuerFeld, betragOderNichts, textOderNichts, useFormular } from "./formular";

export const INSTRUMENTE = ["offene_beteiligung", "stille_beteiligung", "darlehen", "wandeldarlehen"] as const;
export const BESCHLUSS_ERGEBNISSE = ["zugestimmt", "abgelehnt", "vertagt"] as const;
type Instrument = (typeof INSTRUMENTE)[number];
type Ergebnis = (typeof BESCHLUSS_ERGEBNISSE)[number];

export function AbsageDialog({ dealId, onSchliessen }: { dealId: string; onSchliessen: () => void }) {
  const t = useT();
  const absagen = useDealAbsagen(dealId);
  const { werte, feld } = useFormular({ grund: "" });
  const f = t.absage;
  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          absagen.mutate(werte.grund.trim(), { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={absagen.error} bekannt={["grund"]} />
        <Feld label={f.grund} hilfe={f.grundHilfe} autoComplete="off" {...feld("grund")} fehler={feldText(t, absagen.error, "grund")} />
        <div>
          <Button type="submit" variante="gefahr" disabled={absagen.isPending}>
            {f.absagen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

const BESCHLUSS_FELDER = ["gremium", "datum", "ergebnis", "betrag", "auflagen", "protokoll", "fondsId"];

/**
 * Beschluss erfassen. Zustimmen dürfen nur Freigeber (am Fonds des Deals, sonst irgendwo); ohne diese Rolle ist die Auswahl
 * gesperrt. Hat der Deal noch keinen Fonds, wählt die Person bei „Zugestimmt“ den Fonds, für den beschlossen wird.
 */
export function BeschlussDialog({ dealId, dealFondsId, fonds, onSchliessen }: { dealId: string; dealFondsId: string | null; fonds: FondsEintrag[]; onSchliessen: () => void }) {
  const t = useT();
  const { darf } = useRechte();
  const darfZustimmen = darf("freigeber", dealFondsId, "dealflow");
  const waehlbar = dealFondsId ? [] : fonds.filter((x) => darf("freigeber", x.id, "dealflow"));
  const anlegen = useBeschlussAnlegen(dealId);
  const { werte, feld } = useFormular({ gremium: "", datum: heuteIso(), ergebnis: darfZustimmen ? "zugestimmt" : "abgelehnt", betrag: "", auflagen: "", protokoll: "", fondsId: waehlbar.find((x) => x.id === letzterFonds())?.id ?? waehlbar[0]?.id ?? "" });
  const mitFonds = werte.ergebnis === "zugestimmt" && dealFondsId === null;
  const f = t.beschlussForm;
  const fehler = (name: string) => feldText(t, anlegen.error, name);
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
              gremium: werte.gremium.trim(),
              datum: werte.datum,
              ergebnis: werte.ergebnis as Ergebnis,
              betrag: betragOderNichts(werte.betrag),
              auflagen: textOderNichts(werte.auflagen),
              protokoll: textOderNichts(werte.protokoll),
              // Die API verlangt den Fonds bei Zustimmung ohne Fonds am Deal (und lehnt ihn sonst ab).
              ...(mitFonds && werte.fondsId ? { fondsId: werte.fondsId } : {}),
            },
            { onSuccess: onSchliessen },
          );
        }}
      >
        <FehlerHinweis fehler={anlegen.error} bekannt={BESCHLUSS_FELDER} />
        <Feld label={f.gremium} autoComplete="off" {...feld("gremium")} fehler={fehler("gremium")} />
        <Feld label={f.datum} type="date" {...feld("datum")} fehler={fehler("datum")} />
        <Auswahl label={f.ergebnis} {...feld("ergebnis")} fehler={fehler("ergebnis")}>
          {BESCHLUSS_ERGEBNISSE.map((e) => (
            <option key={e} value={e} disabled={e === "zugestimmt" && !darfZustimmen}>
              {t.beschlussErgebnis[e]}
            </option>
          ))}
        </Auswahl>
        {darfZustimmen ? null : <p className="app-leer-text">{t.rechte.zustimmenBraucht(aufzaehlung(t.rolle, "freigeber"))}</p>}
        {mitFonds ? (
          <Auswahl label={f.fonds} hilfe={f.fondsHilfe} {...feld("fondsId")} fehler={fehler("fondsId")}>
            {waehlbar.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Auswahl>
        ) : null}
        <Feld label={f.betrag} zahl inputMode="decimal" hilfe={f.betragHilfe} {...feld("betrag")} fehler={fehler("betrag")} />
        <Textbereich markdown label={f.auflagen} rows={3} {...feld("auflagen")} fehler={fehler("auflagen")} />
        <Textbereich markdown label={f.protokoll} rows={5} {...feld("protokoll")} fehler={fehler("protokoll")} />
        <div>
          <Button type="submit" disabled={anlegen.isPending || (mitFonds && werte.fondsId === "")}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

const UEBERNAHME_FELDER = ["fondsId", "instrument", "erstinvestment", "zusage"];

/** Die Zusage kommt vorbelegt aus dem jüngsten zustimmenden Beschluss, sonst aus dem Ticket des Deals. */
export function zusageVorschlag(deal: DealDetail): string {
  const zugestimmt = deal.beschluesse.find((b) => b.ergebnis === "zugestimmt");
  return betragFuerFeld(zugestimmt?.betrag ?? deal.ticket);
}

/** „Ins Portfolio übernehmen“: legt Beteiligung (und Zusage) aus dem Deal an und springt zum Fonds. */
export function UebernahmeDialog({ deal, fonds, onSchliessen }: { deal: DealDetail; fonds: FondsEintrag[]; onSchliessen: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const uebernehmen = useInsPortfolio(deal.id);
  const vorgabe = beschlussFonds(deal.beschluesse) ?? deal.fondsId ?? fonds.find((x) => x.id === letzterFonds())?.id ?? fonds[0]?.id ?? "";
  const { werte, feld } = useFormular({ fondsId: vorgabe, instrument: "offene_beteiligung", erstinvestment: heuteIso(), zusage: zusageVorschlag(deal) });
  const f = t.uebernahme;
  const vorhanden =
    uebernehmen.error instanceof ApiFehler && uebernehmen.error.code === "investment_exists" && typeof uebernehmen.error.zusatz.beteiligungId === "string"
      ? uebernehmen.error.zusatz.beteiligungId
      : null;

  /**
   * Zum Portfolio des Fonds mit der neuen Beteiligung markiert. Der Standard-Stichtag reicht bis zur letzten
   * Vorgangs-Valuta (Entscheidung 52), die Zusage der Übernahme ist also enthalten. Ohne Zusage und mit einem Erstinvestment
   * nach diesem Stichtag zeigt die Fondsübersicht die Beteiligung noch nicht: dann wird das Erstinvestment als Stichtag gesetzt.
   * Der Standard-Stichtag kommt frisch vom Server (`staleTime: 0`), nicht aus einem älteren Cache-Eintrag.
   */
  async function zumFonds(neu: { id: string; fondsId: string; erstinvestment: string }) {
    let stichtag: string | undefined;
    try {
      const standard = await qc.fetchQuery({ ...fondsUebersicht(neu.fondsId), staleTime: 0 });
      if (neu.erstinvestment > standard.stichtag) stichtag = neu.erstinvestment;
    } catch {
      stichtag = undefined;
    }
    await navigate({ to: "/fonds/$fondsId", params: { fondsId: neu.fondsId }, search: { hervorgehoben: neu.id, ...(stichtag ? { stichtag } : {}) } });
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
          uebernehmen.mutate(
            { fondsId: werte.fondsId, instrument: werte.instrument as Instrument, erstinvestment: werte.erstinvestment, zusage: betragOderNichts(werte.zusage) },
            { onSuccess: (ergebnis) => void zumFonds(ergebnis.beteiligung) },
          );
        }}
      >
        <FehlerHinweis fehler={uebernehmen.error} bekannt={UEBERNAHME_FELDER} />
        {vorhanden ? (
          <p>
            <Link to="/beteiligungen/$id" params={{ id: vorhanden }} search={{}}>
              {f.zurVorhandenen}
            </Link>
          </p>
        ) : null}
        <Auswahl label={f.fonds} {...feld("fondsId")} fehler={feldText(t, uebernehmen.error, "fondsId")}>
          {fonds.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Auswahl>
        <Auswahl label={f.instrument} {...feld("instrument")} fehler={feldText(t, uebernehmen.error, "instrument")}>
          {INSTRUMENTE.map((i) => (
            <option key={i} value={i}>
              {t.instrument[i]}
            </option>
          ))}
        </Auswahl>
        <Feld label={f.erstinvestment} type="date" {...feld("erstinvestment")} fehler={feldText(t, uebernehmen.error, "erstinvestment")} />
        <Feld label={f.zusage} zahl inputMode="decimal" hilfe={f.zusageHilfe} {...feld("zusage")} fehler={feldText(t, uebernehmen.error, "zusage")} />
        <div>
          <Button type="submit" disabled={uebernehmen.isPending || fonds.length === 0}>
            {f.uebernehmen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
