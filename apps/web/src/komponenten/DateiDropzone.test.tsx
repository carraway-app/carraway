import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DateiDropzone } from "./DateiDropzone";

describe("DateiDropzone", () => {
  it("zeigt den Ablagezustand auch beim Wechsel zwischen Kindelementen und beendet ihn beim Verlassen", () => {
    render(<DateiDropzone label="Vertrag" accept=".pdf" onDateien={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Datei auswählen" });
    const text = screen.getByText("Datei hierher ziehen");
    const ziehen = { dataTransfer: { types: ["Files"], files: [] } };
    fireEvent.dragEnter(button, ziehen);
    expect(screen.getByText("Zum Ablegen loslassen")).toBeTruthy();
    fireEvent.dragEnter(text, ziehen);
    fireEvent.dragLeave(button, ziehen);
    expect(screen.getByText("Zum Ablegen loslassen")).toBeTruthy();
    fireEvent.dragLeave(text, ziehen);
    expect(screen.getByText("Datei hierher ziehen")).toBeTruthy();
    fireEvent.dragEnter(button, { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(screen.queryByText("Zum Ablegen loslassen")).toBeNull();
  });

  it("weist mehrere gleichzeitig abgelegte Dateien bei einer Einzelauswahl zurück", () => {
    const onDateien = vi.fn();
    render(<DateiDropzone label="Kursdatei" accept=".csv" onDateien={onDateien} />);
    const ziel = screen.getByRole("button", { name: "Datei auswählen" });
    const csv = new File(["1"], "kurse.csv");
    fireEvent.drop(ziel, { dataTransfer: { types: ["Files"], files: [csv, csv] } });
    expect(screen.getByRole("alert").textContent).toContain("nur eine Datei");
    expect(onDateien).not.toHaveBeenCalled();
    fireEvent.drop(ziel, { dataTransfer: { types: ["Files"], files: [csv] } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onDateien).toHaveBeenCalledWith([csv]);
  });

  it("unterbindet die Browserablage bei gesperrtem Feld und übergibt wiederholte Dateien beim entsperrten Feld", () => {
    const onDateien = vi.fn();
    const props = { label: "Vertrag", accept: ".pdf", onDateien, testId: "ablage" };
    const { rerender } = render(<DateiDropzone {...props} deaktiviert />);
    const ziel = screen.getByTestId("ablage");
    const datei = new File(["Test"], "vertrag.pdf", { type: "application/pdf" });
    const ablegen = () => {
      const event = createEvent.drop(ziel, { dataTransfer: { types: ["Files"], files: [datei] }, cancelable: true });
      fireEvent(ziel, event);
      expect(event.defaultPrevented).toBe(true);
    };
    ablegen();
    expect(onDateien).not.toHaveBeenCalled();
    rerender(<DateiDropzone {...props} />);
    ablegen();
    ablegen();
    expect(onDateien).toHaveBeenCalledTimes(2);
    expect(onDateien).toHaveBeenLastCalledWith([datei]);
  });
});
