import { Hinweis, formatBetrag, formatDatum, type Sprache } from "@carraway/ui";
import { ApiFehler } from "../api/client";
import { feldCodeText, fehlerText } from "../i18n/fehler";
import { useSprache, useT, type Texte } from "../i18n";

const text = (wert: unknown): string | null => (typeof wert === "string" ? wert : null);

/** Zusatzangaben der API (Beträge) in einem Satz, soweit der Code welche mitschickt. */
function zusatzText(t: Texte, sprache: Sprache, api: ApiFehler | null): string | null {
  if (!api) return null;
  const betrag = (wert: unknown) => {
    const roh = text(wert);
    return roh === null ? null : formatBetrag(roh, sprache);
  };
  const z = api.zusatz;
  switch (api.code) {
    case "ZUSAGE_UEBER_BESCHLUSS": {
      const b = betrag(z.beschlussBetrag);
      return b ? t.fehlerZusatz.beschlussBetrag(b) : null;
    }
    case "AUSZAHLUNG_UEBER_ZUSAGE": {
      const [a, b] = [betrag(z.zusage), betrag(z.investiert)];
      return a && b ? t.fehlerZusatzInstrumente.auszahlungUeberZusage(a, b) : null;
    }
    case "BUCHWERT_NEGATIV": {
      const b = betrag(z.buchwert);
      return b ? t.fehlerZusatzInstrumente.buchwertNegativ(b) : null;
    }
    case "MEILENSTEIN_BETRAG_UEBERSCHRITTEN": {
      const [a, b] = [betrag(z.meilensteinBetrag), betrag(z.bisherAusgezahlt)];
      return a && b ? t.fehlerZusatzInstrumente.meilensteinBetrag(a, b) : null;
    }
    case "VERKAUF_UNGUELTIG": {
      const [a, b, c] = [betrag(z.erloes), betrag(z.treuhand), betrag(z.verkaeuferdarlehen)];
      return a && b && c ? t.fehlerZusatzInstrumente.verkauf(a, b, c) : null;
    }
    case "PERIODE_GESPERRT": {
      const bis = text(z.gesperrtBis);
      return bis ? t.fehlerZusatzAnmeldung.gesperrtBis(formatDatum(bis, sprache)) : null;
    }
    case "ZU_VIELE_VERSUCHE":
      return api.wartenSekunden ? t.fehlerZusatzAnmeldung.warten(Math.ceil(api.wartenSekunden / 60)) : null;
    default:
      return null;
  }
}

/**
 * Fehlermeldung einer schreibenden Anfrage über dem Formular oder der Liste. Feldfehler, die ein Formular
 * nicht selbst am Feld zeigt (`bekannt`), erscheinen hier mit ihrem Feldnamen. Invariantenfehler der Instrumente
 * (`AUSZAHLUNG_UEBER_ZUSAGE`, `BUCHWERT_NEGATIV` …) erscheinen mit ihren Beträgen als Hinweis.
 */
export function FehlerHinweis({ fehler, bekannt = [] }: { fehler: unknown; bekannt?: string[] }) {
  const t = useT();
  const sprache = useSprache();
  if (!fehler) return null;
  const api = fehler instanceof ApiFehler ? fehler : null;
  const zusatz = zusatzText(t, sprache, api);
  const uebrige = api?.felder.filter((f) => !bekannt.includes(f.feld)) ?? [];
  return (
    <Hinweis variante="fehler" titel={t.fehler.titel}>
      {fehlerText(t, fehler)}
      {zusatz ? ` ${zusatz}` : null}
      {uebrige.length > 0 ? ` ${uebrige.map((f) => `${f.feld}: ${feldCodeText(t, f.code)}`).join(" ")}` : null}
    </Hinweis>
  );
}
