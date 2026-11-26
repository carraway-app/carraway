import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Feld, Hinweis, Tabelle, formatDatum } from "@carraway/ui";
import { heuteIso } from "../api/datum";
import { schluessel } from "../api/abfragen-kern";
import { bucheZahlung, zahlungsstand, type Zahlungsbuchung } from "../api/kapitalbewegungen";
import { useSprache } from "../i18n";
import { kapitalTexte } from "../i18n/kapitalbewegung";
import { formatBetragCent } from "../lib/zahl";
import { BetragFeld } from "./BetragFeld";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragOderNichts } from "./formular";

type Auswahl = { organisationId: string; zahlungId?: string };
export function AbrufZahlungen({ fondsId, id, investoren, waehrung, buchbar, stichtagVorgabe, stand }: {
  fondsId: string; id: string; investoren: { organisationId: string; investor: string }[]; waehrung: string; buchbar: boolean; stichtagVorgabe: string; stand?: string;
}) {
  const sprache = useSprache();
  const k = kapitalTexte[sprache];
  const heute = heuteIso();
  const [stichtag, setStichtag] = useState(stichtagVorgabe);
  const [wahl, setWahl] = useState<Auswahl | null>(null);
  const [valuta, setValuta] = useState(heute);
  const [betrag, setBetrag] = useState("");
  const [referenz, setReferenz] = useState("");
  const [grund, setGrund] = useState("");
  const cache = useQueryClient();
  const { data, error } = useQuery(zahlungsstand(fondsId, id, stichtag, stand));
  const buchen = useMutation({
    mutationFn: (eingabe: Zahlungsbuchung) => bucheZahlung(id, eingabe),
    onSuccess: async () => {
      setWahl(null);
      setStichtag(valuta);
      await Promise.all([schluessel.bewegungen, schluessel.fonds].map((queryKey) => cache.invalidateQueries({ queryKey })));
    },
  });
  const oeffnen = (auswahl: Auswahl) => {
    buchen.reset();
    setGrund("");
    setReferenz("");
    setBetrag("");
    setValuta(stichtag);
    setWahl(auswahl);
  };
  const name = (org: string | null) => investoren.find((i) => i.organisationId === org)?.investor ?? "–";
  const geld = (wert: string) => formatBetragCent(wert, sprache, waehrung);
  const aufgehoben = new Set(data?.zahlungen.map((z) => z.storniertZahlungId));
  return <section className="app-formular">
    <h3>{k.zahlungen}</h3>
    <Feld type="date" label={k.stichtag} value={stichtag} onChange={(e) => { if (e.target.value) { setStichtag(e.target.value); setWahl(null); } }} />
    <FehlerHinweis fehler={error ?? buchen.error} />
    {data && <>
      <p>{k.faellig} {formatDatum(data.faelligAm, sprache)}</p>
      {data.positionen.some((p) => Number(p.ungeklaert) > 0) ? <Hinweis>{k.ungeklaert}</Hinweis> : null}
      <Tabelle dicht beschriftung={k.aufteilung} zeilen={data.positionen} zeilenSchluessel={(p) => p.organisationId ?? id} spalten={[
        { schluessel: "lp", kopf: k.investor, zelle: (p) => name(p.organisationId) },
        ...(["eingezahlt", "offen", "ueberfaellig"] as const).map((feld) => ({ schluessel: feld, kopf: k[feld], zahl: true, zelle: (p: typeof data.positionen[number]) => geld(p[feld]) })),
        { schluessel: "aktion", kopf: "", zelle: (p) => buchbar && p.organisationId && Number(p.offen) > 0
          ? <Button variante="ruhig" onClick={() => oeffnen({ organisationId: p.organisationId! })}>{k.erfassen}</Button> : null },
      ]} />
      {data.zahlungen.length > 0 && <Tabelle dicht beschriftung={k.zahlungen} zeilen={data.zahlungen} zeilenSchluessel={(z) => z.id} spalten={[
        { schluessel: "lp", kopf: k.investor, zelle: (z) => name(z.organisationId) },
        { schluessel: "valuta", kopf: k.wertstellung, zelle: (z) => formatDatum(z.valuta, sprache) },
        { schluessel: "betrag", kopf: k.betrag(waehrung), zahl: true, zelle: (z) => geld(z.betrag) },
        { schluessel: "belegreferenz", kopf: k.belegreferenz, zelle: (z) => z.belegreferenz ?? "–" },
        { schluessel: "storno", kopf: k.grund, zelle: (z) => z.grund ?? (buchbar && !aufgehoben.has(z.id) ? <Button variante="ruhig" onClick={() => oeffnen({ organisationId: z.organisationId, zahlungId: z.id })}>{k.stornieren}</Button> : null) },
      ]} />}
    </>}
    {wahl && buchbar && <form className="app-formular" onSubmit={(e) => {
      e.preventDefault();
      const wert = betragOderNichts(betrag, sprache);
      if (wahl.zahlungId) buchen.mutate({ zahlungId: wahl.zahlungId, valuta, grund });
      else if (wert) buchen.mutate({ organisationId: wahl.organisationId, valuta, betrag: wert, ...(referenz.trim() ? { belegreferenz: referenz.trim() } : {}) });
    }}>
      <strong>{name(wahl.organisationId)}</strong>
      <div className="cw-formularraster">
        <Feld type="date" required label={k.wertstellung} value={valuta} onChange={(e) => setValuta(e.target.value)} />
        {wahl.zahlungId
          ? <Feld required label={k.grund} maxLength={500} value={grund} onChange={(e) => setGrund(e.target.value)} />
          : <BetragFeld required label={k.betrag(waehrung)} value={betrag} onChange={(e) => setBetrag(e.target.value)} />}
        {!wahl.zahlungId && <Feld label={k.belegreferenz} maxLength={250} value={referenz} onChange={(e) => setReferenz(e.target.value)} />}
      </div>
      <Button type="submit" disabled={buchen.isPending || (!wahl.zahlungId && !betragOderNichts(betrag, sprache))}>{wahl.zahlungId ? k.stornoBuchen : k.zahlungBuchen}</Button>
    </form>}
  </section>;
}
