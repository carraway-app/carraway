import Decimal from "decimal.js";

// Genug Stellen für Beträge bis in den Milliardenbereich mit Zwischenergebnissen bei Zinsanteilen.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
