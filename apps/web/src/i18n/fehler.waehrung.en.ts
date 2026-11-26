/** Error texts of the API for the area “currency” (Codes); eigenes Modul, damit sie ohne den ganzen Bereich geladen werden können (`fehlertexte`). */

export const waehrungFehlerEn = {
  rate_missing: "There is no sufficiently recent exchange rate for the conversion on this date. Please enter or import the rate; no rate is estimated.",
  currency_same: "This holding has no different local currency. Local amounts are only allowed with a different local currency.",
  rate_exists: "There is already a rate for this day and currency pair. A change is a correction with a reason.",
  rate_not_found: "This exchange rate does not exist or belongs to a different day or currency pair.",
  rate_file_invalid: "The rate file cannot be read. Please check the layout and the separator.",
  currency_not_changeable: "The local currency can no longer be changed because local amounts have already been recorded.",
};
