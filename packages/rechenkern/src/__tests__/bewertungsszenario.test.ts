import { describe, expect, it } from "vitest";
import { GewichteFehler, bewertungNachMethode, bewertungsszenario, unternehmenswertNachMethode, type MethodeEingabe } from "../index.js";

// Erwartungswerte aus referenz/referenz_bewertungsszenario.py (exakte Brüche, kaufmännisch gerundet), Zahlen erfunden.

type Fall = { schluessel: string; gewicht: string; methode: MethodeEingabe };
interface Eingabe {
  nav: string;
  ausschuettungen: string;
  abgerufen: string;
  carrySatz: string;
  beteiligungen: { id: string; aktuell: string; faelle: Fall[] }[];
}

const EINGABEN: Record<string, Eingabe> = {
  "A": {
    "nav": "5000000.00",
    "ausschuettungen": "400000.00",
    "abgerufen": "3000000.00",
    "carrySatz": "0.2",
    "beteiligungen": [
      {
        "id": "b1",
        "aktuell": "1500000.00",
        "faelle": [
          {
            "schluessel": "bear",
            "gewicht": "0.25",
            "methode": {
              "art": "wert",
              "betrag": "900000.00"
            }
          },
          {
            "schluessel": "base",
            "gewicht": "0.5",
            "methode": {
              "art": "letzte_runde",
              "preisJeAnteil": "12.3456",
              "anteile": "100000",
              "abschlag": "0.1"
            }
          },
          {
            "schluessel": "bull",
            "gewicht": "0.25",
            "methode": {
              "art": "multiple",
              "kennzahlWert": "2400000.00",
              "multiple": "3.5",
              "abzug": "500000.00",
              "anteil": "0.18"
            }
          }
        ]
      },
      {
        "id": "b2",
        "aktuell": "800000.00",
        "faelle": [
          {
            "schluessel": "bear",
            "gewicht": "0.3",
            "methode": {
              "art": "letzte_runde",
              "preisJeAnteil": "7.77",
              "anteile": "90000",
              "abschlag": "0.5"
            }
          },
          {
            "schluessel": "base",
            "gewicht": "0.45",
            "methode": {
              "art": "letzte_runde",
              "preisJeAnteil": "7.77",
              "anteile": "90000",
              "abschlag": "-0.1"
            }
          },
          {
            "schluessel": "bull",
            "gewicht": "0.25",
            "methode": {
              "art": "wert",
              "betrag": "1500000.00"
            }
          }
        ]
      },
      {
        "id": "b3",
        "aktuell": "2700000.00",
        "faelle": []
      }
    ]
  },
  "B": {
    "nav": "1234567.89",
    "ausschuettungen": "0.00",
    "abgerufen": "1000000.00",
    "carrySatz": "0.15",
    "beteiligungen": [
      {
        "id": "x",
        "aktuell": "600000.00",
        "faelle": [
          {
            "schluessel": "base",
            "gewicht": "0.333333",
            "methode": {
              "art": "wert",
              "betrag": "700000.01"
            }
          },
          {
            "schluessel": "bull",
            "gewicht": "0.333333",
            "methode": {
              "art": "wert",
              "betrag": "950000.99"
            }
          },
          {
            "schluessel": "bear",
            "gewicht": "0.333334",
            "methode": {
              "art": "wert",
              "betrag": "100000.00"
            }
          }
        ]
      },
      {
        "id": "y",
        "aktuell": "634567.89",
        "faelle": [
          {
            "schluessel": "base",
            "gewicht": "0.7",
            "methode": {
              "art": "multiple",
              "kennzahlWert": "1000000",
              "multiple": "1.5",
              "abzug": "0",
              "anteil": "0.4"
            }
          },
          {
            "schluessel": "bear",
            "gewicht": "0.3",
            "methode": {
              "art": "multiple",
              "kennzahlWert": "1000000",
              "multiple": "0.5",
              "abzug": "800000",
              "anteil": "0.4"
            }
          }
        ]
      }
    ]
  },
  "C": {
    "nav": "2000000.00",
    "ausschuettungen": "100000.00",
    "abgerufen": "1500000.00",
    "carrySatz": "0.2",
    "beteiligungen": [
      {
        "id": "p",
        "aktuell": "1200000.00",
        "faelle": [
          {
            "schluessel": "base",
            "gewicht": "0.6",
            "methode": {
              "art": "wert",
              "betrag": "1300000.00"
            }
          },
          {
            "schluessel": "bull",
            "gewicht": "0.4",
            "methode": {
              "art": "multiple",
              "kennzahlWert": null,
              "multiple": "4",
              "abzug": "0",
              "anteil": "0.1"
            }
          }
        ]
      },
      {
        "id": "q",
        "aktuell": "800000.00",
        "faelle": [
          {
            "schluessel": "base",
            "gewicht": "0.5",
            "methode": {
              "art": "wert",
              "betrag": "850000.00"
            }
          },
          {
            "schluessel": "bear",
            "gewicht": "0.5",
            "methode": {
              "art": "letzte_runde",
              "preisJeAnteil": null,
              "anteile": null,
              "abschlag": "0"
            }
          }
        ]
      }
    ]
  },
  "D": {
    "nav": "300000.00",
    "ausschuettungen": "0.00",
    "abgerufen": "0.00",
    "carrySatz": "0.2",
    "beteiligungen": [
      {
        "id": "m",
        "aktuell": "300000.00",
        "faelle": [
          {
            "schluessel": "base",
            "gewicht": "0.5",
            "methode": {
              "art": "multiple",
              "kennzahlWert": "100000",
              "multiple": "2",
              "abzug": "500000",
              "anteil": "0.5"
            }
          },
          {
            "schluessel": "bull",
            "gewicht": "0.5",
            "methode": {
              "art": "wert",
              "betrag": "400000.50"
            }
          }
        ]
      }
    ]
  },
  "E": {
    "nav": "900000.00",
    "ausschuettungen": "50000.00",
    "abgerufen": "2000000.00",
    "carrySatz": "0.2",
    "beteiligungen": [
      {
        "id": "n",
        "aktuell": "900000.00",
        "faelle": [
          {
            "schluessel": "base",
            "gewicht": "0.5",
            "methode": {
              "art": "wert",
              "betrag": "800000.00"
            }
          },
          {
            "schluessel": "bull",
            "gewicht": "0.5",
            "methode": {
              "art": "wert",
              "betrag": "1700000.00"
            }
          }
        ]
      }
    ]
  },
  "F": {
    "nav": "4000000.00",
    "ausschuettungen": "200000.00",
    "abgerufen": "2500000.00",
    "carrySatz": "0.2",
    "beteiligungen": [
      {
        "id": "u",
        "aktuell": "900000.00",
        "faelle": [
          {
            "schluessel": "base",
            "gewicht": "0.6",
            "methode": {
              "art": "multiple",
              "kennzahlWert": "3000000.00",
              "multiple": "8",
              "abzug": "4000000.00",
              "anteil": "0.12",
              "umrechnung": {
                "zaehler": "1",
                "nenner": "1.0850"
              }
            }
          },
          {
            "schluessel": "bull",
            "gewicht": "0.4",
            "methode": {
              "art": "multiple",
              "kennzahlWert": "3000000.00",
              "multiple": "8",
              "abzug": "4000000.00",
              "anteil": "0.12"
            }
          }
        ]
      },
      {
        "id": "v",
        "aktuell": "1100000.00",
        "faelle": [
          {
            "schluessel": "base",
            "gewicht": "0.7",
            "methode": {
              "art": "multiple",
              "kennzahlWert": "1250000.50",
              "multiple": "6.5",
              "abzug": "1000000.00",
              "anteil": "0.2",
              "umrechnung": {
                "zaehler": "1.0850",
                "nenner": "0.8600"
              }
            }
          },
          {
            "schluessel": "bull",
            "gewicht": "0.3",
            "methode": {
              "art": "multiple",
              "kennzahlWert": "2000000",
              "multiple": "10",
              "abzug": "0",
              "anteil": "0.2",
              "umrechnung": {
                "zaehler": "1.0850",
                "nenner": "0.8600"
              }
            }
          }
        ]
      },
      {
        "id": "w",
        "aktuell": "500000.00",
        "faelle": [
          {
            "schluessel": "base",
            "gewicht": "0.5",
            "methode": {
              "art": "multiple",
              "kennzahlWert": "800000",
              "multiple": "3",
              "abzug": "5000000",
              "anteil": "0.3",
              "umrechnung": {
                "zaehler": "1",
                "nenner": "1.1000"
              }
            }
          },
          {
            "schluessel": "bull",
            "gewicht": "0.5",
            "methode": {
              "art": "multiple",
              "kennzahlWert": "800000",
              "multiple": "9",
              "abzug": "0",
              "anteil": "0.3",
              "umrechnung": null
            }
          }
        ]
      }
    ]
  }
};

const ERWARTET = {
  "A": {
    "beteiligungen": [
      {
        "id": "b1",
        "aktuell": "1500000.00",
        "erwartet": "1136052.00",
        "abweichung": "-363948.00",
        "faelle": [
          {
            "schluessel": "bear",
            "wert": "900000.00"
          },
          {
            "schluessel": "base",
            "wert": "1111104.00"
          },
          {
            "schluessel": "bull",
            "wert": "1422000.00"
          }
        ]
      },
      {
        "id": "b2",
        "aktuell": "800000.00",
        "erwartet": "826048.50",
        "abweichung": "26048.50",
        "faelle": [
          {
            "schluessel": "bear",
            "wert": "349650.00"
          },
          {
            "schluessel": "base",
            "wert": "769230.00"
          },
          {
            "schluessel": "bull",
            "wert": "1500000.00"
          }
        ]
      },
      {
        "id": "b3",
        "aktuell": "2700000.00",
        "erwartet": null,
        "abweichung": null,
        "faelle": []
      }
    ],
    "aktuell": {
      "nav": "5000000.00",
      "tvpi": "1.8000",
      "dpi": "0.1333",
      "rvpi": "1.6667",
      "carry": "480000.00",
      "navNetto": "4520000.00"
    },
    "faelle": [
      {
        "schluessel": "bear",
        "nav": "3949650.00",
        "tvpi": "1.4499",
        "dpi": "0.1333",
        "rvpi": "1.3166",
        "carry": "269930.00",
        "navNetto": "3679720.00"
      },
      {
        "schluessel": "base",
        "nav": "4580334.00",
        "tvpi": "1.6601",
        "dpi": "0.1333",
        "rvpi": "1.5268",
        "carry": "396066.80",
        "navNetto": "4184267.20"
      },
      {
        "schluessel": "bull",
        "nav": "5622000.00",
        "tvpi": "2.0073",
        "dpi": "0.1333",
        "rvpi": "1.8740",
        "carry": "604400.00",
        "navNetto": "5017600.00"
      }
    ],
    "erwartet": {
      "nav": "4662100.50",
      "tvpi": "1.6874",
      "dpi": "0.1333",
      "rvpi": "1.5540",
      "carry": "412420.10",
      "navNetto": "4249680.40"
    }
  },
  "B": {
    "beteiligungen": [
      {
        "id": "x",
        "aktuell": "600000.00",
        "erwartet": "583333.18",
        "abweichung": "-16666.82",
        "faelle": [
          {
            "schluessel": "base",
            "wert": "700000.01"
          },
          {
            "schluessel": "bull",
            "wert": "950000.99"
          },
          {
            "schluessel": "bear",
            "wert": "100000.00"
          }
        ]
      },
      {
        "id": "y",
        "aktuell": "634567.89",
        "erwartet": "420000.00",
        "abweichung": "-214567.89",
        "faelle": [
          {
            "schluessel": "base",
            "wert": "600000.00"
          },
          {
            "schluessel": "bear",
            "wert": "0.00"
          }
        ]
      }
    ],
    "aktuell": {
      "nav": "1234567.89",
      "tvpi": "1.2346",
      "dpi": "0.0000",
      "rvpi": "1.2346",
      "carry": "35185.18",
      "navNetto": "1199382.71"
    },
    "faelle": [
      {
        "schluessel": "base",
        "nav": "1300000.01",
        "tvpi": "1.3000",
        "dpi": "0.0000",
        "rvpi": "1.3000",
        "carry": "45000.00",
        "navNetto": "1255000.01"
      },
      {
        "schluessel": "bull",
        "nav": "1584568.88",
        "tvpi": "1.5846",
        "dpi": "0.0000",
        "rvpi": "1.5846",
        "carry": "87685.33",
        "navNetto": "1496883.55"
      },
      {
        "schluessel": "bear",
        "nav": "100000.00",
        "tvpi": "0.1000",
        "dpi": "0.0000",
        "rvpi": "0.1000",
        "carry": "0.00",
        "navNetto": "100000.00"
      }
    ],
    "erwartet": {
      "nav": "1003333.18",
      "tvpi": "1.0033",
      "dpi": "0.0000",
      "rvpi": "1.0033",
      "carry": "499.98",
      "navNetto": "1002833.20"
    }
  },
  "C": {
    "beteiligungen": [
      {
        "id": "p",
        "aktuell": "1200000.00",
        "erwartet": null,
        "abweichung": null,
        "faelle": [
          {
            "schluessel": "base",
            "wert": "1300000.00"
          },
          {
            "schluessel": "bull",
            "wert": null
          }
        ]
      },
      {
        "id": "q",
        "aktuell": "800000.00",
        "erwartet": null,
        "abweichung": null,
        "faelle": [
          {
            "schluessel": "base",
            "wert": "850000.00"
          },
          {
            "schluessel": "bear",
            "wert": null
          }
        ]
      }
    ],
    "aktuell": {
      "nav": "2000000.00",
      "tvpi": "1.4000",
      "dpi": "0.0667",
      "rvpi": "1.3333",
      "carry": "120000.00",
      "navNetto": "1880000.00"
    },
    "faelle": [
      {
        "schluessel": "base",
        "nav": "2150000.00",
        "tvpi": "1.5000",
        "dpi": "0.0667",
        "rvpi": "1.4333",
        "carry": "150000.00",
        "navNetto": "2000000.00"
      },
      {
        "schluessel": "bull",
        "nav": null,
        "tvpi": null,
        "dpi": null,
        "rvpi": null,
        "carry": null,
        "navNetto": null
      },
      {
        "schluessel": "bear",
        "nav": null,
        "tvpi": null,
        "dpi": null,
        "rvpi": null,
        "carry": null,
        "navNetto": null
      }
    ],
    "erwartet": {
      "nav": null,
      "tvpi": null,
      "dpi": null,
      "rvpi": null,
      "carry": null,
      "navNetto": null
    }
  },
  "D": {
    "beteiligungen": [
      {
        "id": "m",
        "aktuell": "300000.00",
        "erwartet": "200000.25",
        "abweichung": "-99999.75",
        "faelle": [
          {
            "schluessel": "base",
            "wert": "0.00"
          },
          {
            "schluessel": "bull",
            "wert": "400000.50"
          }
        ]
      }
    ],
    "aktuell": {
      "nav": "300000.00",
      "tvpi": null,
      "dpi": null,
      "rvpi": null,
      "carry": "60000.00",
      "navNetto": "240000.00"
    },
    "faelle": [
      {
        "schluessel": "base",
        "nav": "0.00",
        "tvpi": null,
        "dpi": null,
        "rvpi": null,
        "carry": "0.00",
        "navNetto": "0.00"
      },
      {
        "schluessel": "bull",
        "nav": "400000.50",
        "tvpi": null,
        "dpi": null,
        "rvpi": null,
        "carry": "80000.10",
        "navNetto": "320000.40"
      }
    ],
    "erwartet": {
      "nav": "200000.25",
      "tvpi": null,
      "dpi": null,
      "rvpi": null,
      "carry": "40000.05",
      "navNetto": "160000.20"
    }
  },
  "E": {
    "beteiligungen": [
      {
        "id": "n",
        "aktuell": "900000.00",
        "erwartet": "1250000.00",
        "abweichung": "350000.00",
        "faelle": [
          {
            "schluessel": "base",
            "wert": "800000.00"
          },
          {
            "schluessel": "bull",
            "wert": "1700000.00"
          }
        ]
      }
    ],
    "aktuell": {
      "nav": "900000.00",
      "tvpi": "0.4750",
      "dpi": "0.0250",
      "rvpi": "0.4500",
      "carry": "0.00",
      "navNetto": "900000.00"
    },
    "faelle": [
      {
        "schluessel": "base",
        "nav": "800000.00",
        "tvpi": "0.4250",
        "dpi": "0.0250",
        "rvpi": "0.4000",
        "carry": "0.00",
        "navNetto": "800000.00"
      },
      {
        "schluessel": "bull",
        "nav": "1700000.00",
        "tvpi": "0.8750",
        "dpi": "0.0250",
        "rvpi": "0.8500",
        "carry": "0.00",
        "navNetto": "1700000.00"
      }
    ],
    "erwartet": {
      "nav": "1250000.00",
      "tvpi": "0.6500",
      "dpi": "0.0250",
      "rvpi": "0.6250",
      "carry": "0.00",
      "navNetto": "1250000.00"
    }
  },
  "F": {
    "beteiligungen": [
      {
        "id": "u",
        "aktuell": "900000.00",
        "erwartet": "2287188.94",
        "abweichung": "1387188.94",
        "faelle": [
          {
            "schluessel": "base",
            "wert": "2211981.57"
          },
          {
            "schluessel": "bull",
            "wert": "2400000.00"
          }
        ]
      },
      {
        "id": "v",
        "aktuell": "1100000.00",
        "erwartet": "2772427.90",
        "abweichung": "1672427.90",
        "faelle": [
          {
            "schluessel": "base",
            "wert": "1797820.59"
          },
          {
            "schluessel": "bull",
            "wert": "5046511.63"
          }
        ]
      },
      {
        "id": "w",
        "aktuell": "500000.00",
        "erwartet": null,
        "abweichung": null,
        "faelle": [
          {
            "schluessel": "base",
            "wert": "0.00"
          },
          {
            "schluessel": "bull",
            "wert": null
          }
        ]
      }
    ],
    "aktuell": {
      "nav": "4000000.00",
      "tvpi": "1.6800",
      "dpi": "0.0800",
      "rvpi": "1.6000",
      "carry": "340000.00",
      "navNetto": "3660000.00"
    },
    "faelle": [
      {
        "schluessel": "base",
        "nav": "5509802.16",
        "tvpi": "2.2839",
        "dpi": "0.0800",
        "rvpi": "2.2039",
        "carry": "641960.43",
        "navNetto": "4867841.73"
      },
      {
        "schluessel": "bull",
        "nav": null,
        "tvpi": null,
        "dpi": null,
        "rvpi": null,
        "carry": null,
        "navNetto": null
      }
    ],
    "erwartet": {
      "nav": null,
      "tvpi": null,
      "dpi": null,
      "rvpi": null,
      "carry": null,
      "navNetto": null
    }
  }
} as const;

/** Wertet die Methoden aus und reicht die Fälle an den Kern. */
function rechne(e: Eingabe) {
  return bewertungsszenario({
    nav: e.nav,
    ausschuettungen: e.ausschuettungen,
    abgerufen: e.abgerufen,
    carrySatz: e.carrySatz,
    beteiligungen: e.beteiligungen.map((b) => ({
      id: b.id,
      aktuell: b.aktuell,
      faelle: b.faelle.map((f) => ({ schluessel: f.schluessel, gewicht: f.gewicht, wert: bewertungNachMethode(f.methode)?.toFixed(2) ?? null })),
    })),
  });
}

describe("Bewertungsszenarien (Referenz mit Brüchen)", () => {
  it.each(Object.keys(EINGABEN))("Fall %s: Beteiligungen, Fälle, Erwartungswert und Fondswirkung stimmen mit der Referenz", (k) => {
    const r = rechne(EINGABEN[k]!);
    const soll = ERWARTET[k as keyof typeof ERWARTET];
    expect(r.aktuell).toEqual(soll.aktuell);
    expect(r.erwartet).toEqual(soll.erwartet);
    expect(r.faelle).toEqual(soll.faelle);
    expect(r.beteiligungen.map((b) => ({ id: b.id, aktuell: b.aktuell, erwartet: b.erwartet, abweichung: b.abweichung, faelle: b.faelle.map((f) => ({ schluessel: f.schluessel, wert: f.wert })) }))).toEqual(soll.beteiligungen);
  });

  it("Gewichte, die nicht genau 1 ergeben, werden abgelehnt (kein Spielraum)", () => {
    const falsch = { nav: "1000.00", ausschuettungen: "0", abgerufen: "1000", carrySatz: "0", beteiligungen: [{ id: "x", aktuell: "1000.00", faelle: [{ schluessel: "a", gewicht: "0.5", wert: "1.00" }, { schluessel: "b", gewicht: "0.49", wert: "2.00" }] }] };
    expect(() => bewertungsszenario(falsch)).toThrow(GewichteFehler);
    const gut = { ...falsch, beteiligungen: [{ id: "x", aktuell: "1000.00", faelle: [{ schluessel: "a", gewicht: "0.333333", wert: "1.00" }, { schluessel: "b", gewicht: "0.666667", wert: "2.00" }] }] };
    expect(bewertungsszenario(gut).beteiligungen[0]!.erwartet).toBe("1.67");
  });

  it("Methoden: Aufschlag, Abzug über dem Unternehmenswert, Lücken bei fehlenden Eingaben", () => {
    expect(bewertungNachMethode({ art: "letzte_runde", preisJeAnteil: "10", anteile: "100", abschlag: "-0.25" })?.toFixed(2)).toBe("1250.00");
    expect(bewertungNachMethode({ art: "multiple", kennzahlWert: "100", multiple: "2", abzug: "500", anteil: "0.5" })?.toFixed(2)).toBe("0.00");
    expect(bewertungNachMethode({ art: "multiple", kennzahlWert: null, multiple: "2", abzug: "0", anteil: "0.5" })).toBeNull();
    expect(bewertungNachMethode({ art: "multiple", kennzahlWert: "100", multiple: "2", abzug: "0", anteil: null })).toBeNull();
    expect(bewertungNachMethode({ art: "letzte_runde", preisJeAnteil: null, anteile: "1", abschlag: "0" })).toBeNull();
    expect(bewertungNachMethode({ art: "wert", betrag: "12.345" })?.toFixed(2)).toBe("12.35");
  });

  it("Unternehmenswert für den Exit-Wasserfall stimmt mit der Referenz (Fälle F und G): Multiple mit und ohne Fremdwährung, letzte Runde, fester Wert hat keinen", () => {
    const wert = (m: MethodeEingabe) => unternehmenswertNachMethode(m)?.toFixed(2) ?? null;
    const mult = (kz: string | null, multiple: string, abzug: string, umrechnung?: { zaehler: string; nenner: string } | null): MethodeEingabe => ({ art: "multiple", kennzahlWert: kz, multiple, abzug, anteil: "0.1", ...(umrechnung !== undefined ? { umrechnung } : {}) });
    // Fall F (Multiples in Fremdwährung)
    expect(wert(mult("3000000.00", "8", "4000000.00", { zaehler: "1", nenner: "1.0850" }))).toBe("18433179.72");
    expect(wert(mult("3000000.00", "8", "4000000.00"))).toBe("20000000.00");
    expect(wert(mult("1250000.50", "6.5", "1000000.00", { zaehler: "1.0850", nenner: "0.8600" }))).toBe("8989102.94");
    expect(wert(mult("2000000", "10", "0", { zaehler: "1.0850", nenner: "0.8600" }))).toBe("25232558.14");
    expect(wert(mult("800000", "3", "5000000", { zaehler: "1", nenner: "1.1000" }))).toBe("0.00");
    expect(wert(mult("800000", "9", "0", null))).toBeNull();
    // Fall G
    expect(wert(mult("5000000", "4", "2500000"))).toBe("17500000.00");
    expect(wert(mult("5000000", "4", "2500000", { zaehler: "1", nenner: "1.0850" }))).toBe("16129032.26");
    const runde = (abschlag: string, gesamt?: string | null): MethodeEingabe => ({ art: "letzte_runde", preisJeAnteil: "12.3456", anteile: "100000", abschlag, ...(gesamt !== undefined ? { anteileGesamt: gesamt } : {}) });
    expect(wert(runde("0.1", "850000"))).toBe("9444384.00");
    expect(wert(runde("-0.2", "850000"))).toBe("12592512.00");
    expect(wert(runde("0.1"))).toBeNull();
    expect(wert({ art: "wert", betrag: "900000.00" })).toBeNull();
  });

  it("Kennzahl in Fremdwährung: Umrechnung des Unternehmenswerts mit dem Kurs des Basistags, ein Rundungsschritt am Ende; fehlender Kurs ist eine Lücke", () => {
    const m = { art: "multiple", kennzahlWert: "1000", multiple: "2", abzug: "0", anteil: "0.5" } as const;
    // ohne Angabe: gleiche Währung wie bisher
    expect(bewertungNachMethode(m)?.toFixed(2)).toBe("1000.00");
    expect(bewertungNachMethode({ ...m, umrechnung: { zaehler: "1", nenner: "1" } })?.toFixed(2)).toBe("1000.00");
    // 2000 USD Unternehmenswert / 1,085 = 1843,32 EUR, mal 0,5 = 921,66 (nicht erst den Kehrwert runden)
    expect(bewertungNachMethode({ ...m, umrechnung: { zaehler: "1", nenner: "1.0850" } })?.toFixed(2)).toBe("921.66");
    expect(bewertungNachMethode({ ...m, umrechnung: null })).toBeNull();
    // Der Abzug gilt in der Währung der Kennzahl, vor der Umrechnung
    expect(bewertungNachMethode({ ...m, abzug: "500", umrechnung: { zaehler: "2", nenner: "1" } })?.toFixed(2)).toBe("1500.00");
  });
});
