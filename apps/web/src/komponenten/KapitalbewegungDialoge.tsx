import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button, Feld, Hinweis, Seitenpanel, Tabelle, formatDatum } from "@carraway/ui";
import { heuteIso } from "../api/datum";
import { bewegungsDetails, ladeAufteilungsVorschau, type AufteilungsEingabe, type BewegungsAufteilung, type Kapitalart } from "../api/kapitalbewegungen";
import { useBuchungAnlegen } from "../api/mutationen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { feldText } from "../i18n/fehler";
import { kapitalTexte } from "../i18n/kapitalbewegung";
import { DATENSPRACHE } from "../lib/datensprache";
import { useRechte } from "../lib/rechte";
import { formatBetragCent, formatSatz } from "../lib/zahl";
import { FehlerHinweis } from "./FehlerHinweis";
import { Skelettzeilen } from "./Skelett";
import { betragOderNichts, textOderNichts, useFormular } from "./formular";
import { AbrufZahlungen } from "./AbrufZahlungen";
import { BetragFeld } from "./BetragFeld";
import { betragRegel, datumRegel } from "../lib/feldpruefung";

function Aufteilung({ daten }: { daten: BewegungsAufteilung }) {
  const sprache = useSprache();
  const k = kapitalTexte[sprache];
  const { darf } = useRechte();
  const { fondsId, aufteilung, waehrung, verteilungsbasis } = daten;
  const ausMitteilungen = daten.verteilungsquelle === "mitteilungen";
  if (aufteilung.length === 0) {
    return (
      <Hinweis>
        {k.keine}
        {darf("verwalter", fondsId, "fondsverwaltung") ? <> <Link to="/funds" search={{ fondsId, tab: "investoren" }}>{k.zeichnungenOeffnen}</Link></> : null}
      </Hinweis>
    );
  }

  return (
    <div>
      {ausMitteilungen ? <p>{k.mitteilungen}</p> : verteilungsbasis ? <p>{k.basis[verteilungsbasis]}</p> : null}
      <Tabelle
        beschriftung={k.aufteilung}
        className="app-kapitalaufteilung"
        dicht
        zeilen={aufteilung}
        zeilenSchluessel={(z) => z.organisationId}
        spalten={[
          {
            schluessel: "investor",
            kopf: k.investor,
            zelle: (z) => (
              <>
                <strong lang={DATENSPRACHE}>{z.investor}</strong>
                {!ausMitteilungen ? (
                  <span className="app-kapitalaufteilung__basis">
                    {z.zusage !== null ? <span>{k.zusage} {formatBetragCent(z.zusage, sprache, waehrung)}</span> : null}
                    {z.anteil !== null ? <span>{k.anteil} {formatSatz(z.anteil, sprache)}</span> : null}
                  </span>
                ) : null}
              </>
            ),
          },
          { schluessel: "betrag", kopf: k.betragInvestor, zahl: true, zelle: (z) => formatBetragCent(z.betrag, sprache, waehrung) },
        ]}
      />
    </div>
  );
}

export function KapitalbewegungAnlegen({ fondsId, art, waehrung, onSchliessen }: { fondsId: string; art: Kapitalart; waehrung: string; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const k = kapitalTexte[sprache];
  const { werte, feld, pruefeAlle } = useFormular(() => ({ valuta: heuteIso(), faelligAm: "", betrag: "", bemerkung: "" }), { valuta: datumRegel({ pflicht: true }), betrag: betragRegel({ vorzeichen: "positiv", pflicht: true }) });
  const anlegen = useBuchungAnlegen(fondsId);
  const vorschau = useMutation({ mutationFn: (eingabe: AufteilungsEingabe) => ladeAufteilungsVorschau(fondsId, eingabe) });
  const eingabe = { art, valuta: werte.valuta, ...(art === "abruf" && werte.faelligAm ? { faelligAm: werte.faelligAm } : {}), betrag: betragOderNichts(werte.betrag, sprache) ?? "" };
  const geprueft = vorschau.data && vorschau.variables.valuta === eingabe.valuta && vorschau.variables.betrag === eingabe.betrag && vorschau.variables.faelligAm === eingabe.faelligAm ? vorschau.data : null;
  const buchbar = Boolean(geprueft?.aufteilung.length);
  const fehler = anlegen.error ?? vorschau.error;
  const titel = k.anlegen[art];

  return (
    <Seitenpanel breit titel={titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{titel}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (vorschau.isPending || anlegen.isPending || !pruefeAlle()) return;
          if (!buchbar) {
            anlegen.reset();
            vorschau.mutate(eingabe);
            return;
          }
          anlegen.mutate({ typ: "fondsbewegung", ...eingabe, bemerkung: textOderNichts(werte.bemerkung) }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={fehler} bekannt={["valuta", "betrag", "bemerkung"]} />
        <Feld label={t.bewegungen.spalten.valuta} type="date" required {...feld("valuta", feldText(t, fehler, "valuta"))} disabled={anlegen.isPending} />
        {art === "abruf" ? <Feld label={k.faellig} type="date" min={werte.valuta} {...feld("faelligAm")} value={werte.faelligAm || werte.valuta} disabled={anlegen.isPending} /> : null}
        <BetragFeld label={k.betrag(waehrung)} required {...feld("betrag", feldText(t, fehler, "betrag"))} disabled={anlegen.isPending} />
        <Feld label={k.bemerkung} maxLength={1000} {...feld("bemerkung")} fehler={feldText(t, fehler, "bemerkung")} disabled={anlegen.isPending} />
        {geprueft ? <Aufteilung daten={geprueft} /> : null}
        {vorschau.isPending ? <p role="status">{t.gemeinsam.laedt}</p> : null}
        <div>
          <Button type="submit" disabled={vorschau.isPending || anlegen.isPending}>{buchbar ? k.buchen[art] : k.vorschau}</Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

export function KapitalbewegungDetails({ fondsId, id, stand, stichtag, onSchliessen }: { fondsId: string; id: string; stand?: string; stichtag: string; onSchliessen: () => void }) {
  const sprache = useSprache();
  const t = useT();
  const k = kapitalTexte[sprache];
  const { darf } = useRechte();
  const { data, error, isPending } = useQuery(bewegungsDetails(fondsId, id));
  return (
    <Seitenpanel breit titel={k.details} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{k.details}</h2>
      {stand ? <Hinweis>{t.fondsVerwaltung.liveKapital}</Hinweis> : null}
      {isPending ? <Skelettzeilen anzahl={2} /> : null}
      <FehlerHinweis fehler={error} />
      {data ? (
        <>
          <p>{aufzaehlung(t.bewegungen.art, data.art)} · {formatDatum(data.valuta, sprache)} · {formatBetragCent(data.betrag, sprache, data.waehrung)}</p>
          {data.bemerkung ? <p lang={DATENSPRACHE}>{data.bemerkung}</p> : null}
          <Aufteilung daten={data} />
          {data.art === "abruf" && !data.storniertBewegungId ? <AbrufZahlungen id={id} fondsId={fondsId} waehrung={data.waehrung} investoren={data.aufteilung} stand={stand} stichtagVorgabe={stichtag} buchbar={!stand && !data.storniertDurchId && darf("bearbeiter", fondsId, "finanzen")} /> : null}
        </>
      ) : null}
    </Seitenpanel>
  );
}
