import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SpracheProvider } from "../i18n";
import { feldpruefungTexte } from "../i18n/feldpruefung";
import { betragRegel, datumRegel, pflichtRegel, waehrungRegel } from "../lib/feldpruefung";
import { BetragFeld } from "./BetragFeld";
import { betragOderNichts, useFormular } from "./formular";
import { WaehrungAuswahl } from "./WaehrungAuswahl";

function Beispiel({ serverFehler, bei }: { serverFehler?: string; bei?: (gueltig: boolean) => void }) {
  const { feld, pruefeAlle, gueltig } = useFormular(
    { betrag: "", waehrung: "", datum: "2026-01-31", name: "" },
    { betrag: betragRegel({ vorzeichen: "positiv", pflicht: true }), waehrung: waehrungRegel({ pflicht: true }), datum: datumRegel({ min: "2026-01-01" }), name: pflichtRegel() },
  );
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        bei?.(pruefeAlle());
      }}
    >
      <BetragFeld label="Betrag" {...feld("betrag", serverFehler)} />
      <WaehrungAuswahl label="Währung" {...feld("waehrung")} />
      <input aria-label="Datum" type="date" {...feld("datum")} />
      <input aria-label="Name" {...feld("name")} />
      <output>{gueltig ? "gueltig" : "ungueltig"}</output>
      <button type="submit">Senden</button>
    </form>
  );
}

const zeige = (el: React.ReactElement) => render(<SpracheProvider>{el}</SpracheProvider>);

describe("useFormular mit Regeln", () => {
  it("zeigt Pflichtangaben erst nach dem Verlassen des Feldes", async () => {
    zeige(<Beispiel />);
    const u = userEvent.setup();
    expect(screen.queryByText(feldpruefungTexte.de.pflicht)).toBeNull();
    await u.click(screen.getByLabelText("Betrag"));
    await u.tab();
    expect(screen.getByText(feldpruefungTexte.de.pflicht)).toBeTruthy();
    expect(screen.getByLabelText("Betrag").getAttribute("aria-invalid")).toBe("true");
    await u.type(screen.getByLabelText("Betrag"), "12,50");
    expect(screen.getByLabelText("Betrag").getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByLabelText("Betrag").getAttribute("aria-describedby")).toBeNull();
  });

  it("meldet Fehler, die weiteres Tippen nicht behebt, sofort", async () => {
    zeige(<Beispiel />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Betrag"), "12a");
    expect(screen.getByText(feldpruefungTexte.de.zahlFormat)).toBeTruthy();
    await u.clear(screen.getByLabelText("Betrag"));
    await u.type(screen.getByLabelText("Betrag"), "12,505");
    expect(screen.getByText(feldpruefungTexte.de.nachkomma(2))).toBeTruthy();
    await u.clear(screen.getByLabelText("Betrag"));
    // Ein halbes Komma stört beim Tippen nicht, erst beim Verlassen.
    await u.type(screen.getByLabelText("Betrag"), "12,");
    expect(screen.queryByText(feldpruefungTexte.de.zahlFormat)).toBeNull();
    await u.tab();
    expect(screen.getByText(feldpruefungTexte.de.zahlFormat)).toBeTruthy();
  });

  it("prüft beim Absenden alle Felder und lässt nur Gültiges durch", async () => {
    const ergebnisse: boolean[] = [];
    zeige(<Beispiel bei={(g) => ergebnisse.push(g)} />);
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: "Senden" }));
    expect(ergebnisse).toEqual([false]);
    expect(screen.getAllByText(feldpruefungTexte.de.pflicht)).toHaveLength(2); // Betrag und Währung
    await u.type(screen.getByLabelText("Betrag"), "1.250,50");
    await u.selectOptions(screen.getByLabelText("Währung"), "USD");
    await u.type(screen.getByLabelText("Name"), "x");
    expect(screen.getByText("gueltig")).toBeTruthy();
    await u.click(screen.getByRole("button", { name: "Senden" }));
    expect(ergebnisse).toEqual([false, true]);
  });

  it("zeigt den Fehler der API am Feld, solange die Eingabe sonst in Ordnung ist", async () => {
    zeige(<Beispiel serverFehler="Vom Server abgelehnt." />);
    const u = userEvent.setup();
    expect(screen.getByText("Vom Server abgelehnt.")).toBeTruthy();
    await u.type(screen.getByLabelText("Betrag"), "-3");
    expect(screen.getByText(feldpruefungTexte.de.negativ)).toBeTruthy();
    expect(screen.queryByText("Vom Server abgelehnt.")).toBeNull();
  });
});

describe("Bausteine", () => {
  it("BetragFeld ist ein Dezimalfeld mit Zifferntastatur", () => {
    zeige(<BetragFeld label="Betrag" />);
    const feld = screen.getByLabelText("Betrag");
    expect(feld.getAttribute("inputmode")).toBe("decimal");
    expect(feld.getAttribute("autocomplete")).toBe("off");
    expect(feld.className).toContain("cw-feld__eingabe--zahl");
  });

  it("WaehrungAuswahl bietet ISO-Codes mit Namen, behält fremde Werte und kann leer sein", () => {
    const { rerender } = zeige(<WaehrungAuswahl label="Währung" value="" onChange={() => {}} />);
    const auswahl = screen.getByLabelText<HTMLSelectElement>("Währung");
    const optionen = Array.from(auswahl.options).map((o) => o.value);
    expect(optionen[0]).toBe("");
    expect(optionen.slice(1, 5)).toEqual(["EUR", "USD", "GBP", "CHF"]);
    expect(auswahl.options[2]?.textContent).toMatch(/^USD – /);
    rerender(
      <SpracheProvider>
        <WaehrungAuswahl label="Währung" value="XAU" leer="wie Fonds" onChange={() => {}} />
      </SpracheProvider>,
    );
    const neu = screen.getByLabelText<HTMLSelectElement>("Währung");
    expect(neu.value).toBe("XAU");
    expect(neu.options[0]?.textContent).toBe("wie Fonds");
  });

  it("betragOderNichts liest die Schreibweise der Sprache", () => {
    expect(betragOderNichts("")).toBeUndefined();
    expect(betragOderNichts("1.250,50")).toBe("1250.50");
    expect(betragOderNichts("1,250.50", "en")).toBe("1250.50");
    expect(betragOderNichts("12 000")).toBe("12000");
    expect(betragOderNichts("abc")).toBe("abc");
  });
});
