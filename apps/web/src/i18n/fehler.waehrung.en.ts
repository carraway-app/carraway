/** Error texts of the API for the area “currency” (Codes); eigenes Modul, damit sie ohne den ganzen Bereich geladen werden können (`fehlertexte`). */

export const waehrungFehlerEn = {
  KURS_FEHLT: "There is no sufficiently recent exchange rate for the conversion on this date. Please enter or import the rate; no rate is estimated.",
  WAEHRUNG_GLEICH: "This holding has no different local currency. Local amounts are only allowed with a different local currency.",
  KURS_VORHANDEN: "There is already a rate for this day and currency pair. A change is a correction with a reason.",
  KURS_NICHT_GEFUNDEN: "This exchange rate does not exist or belongs to a different day or currency pair.",
  KURSDATEI_UNGUELTIG: "The rate file cannot be read. Please check the layout and the separator.",
  WAEHRUNG_NICHT_AENDERBAR: "The local currency can no longer be changed because local amounts have already been recorded.",
};
