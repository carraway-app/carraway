import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { de } from "../i18n/de";
import { en } from "../i18n/en";
import { alsRolle, BET_ID, beteiligungDaten, fehler, rendereApp, spieleApi } from "../test/hilfen";

// PDF.js braucht Canvas und Worker, die jsdom nicht hat; hier zählt, mit welcher Adresse und Seite der Betrachter geöffnet wird.
vi.mock("../komponenten/PdfBetrachter", () => ({
  default: ({ url, seite, titel }: { url: string; seite?: number; titel: string }) => <div role="group" aria-label={titel} data-url={url} data-seite={seite ?? ""} />,
}));

afterEach(() => localStorage.removeItem("carraway.sprache"));

const DOK_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const dokument = (extra: Record<string, unknown> = {}) => ({
  id: DOK_ID,
  dateiname: "vertrag.pdf",
  mime: "application/pdf",
  groesse: 150_000,
  sha256: "ab".repeat(32),
  status: "aktiv",
  klassifikation: "vertrag",
  vertraulich: false,
  textStatus: "vorhanden",
  seitenzahl: 2,
  hochgeladenVon: "u1",
  hochgeladenVonName: "Vera Beispiel",
  hochgeladenAm: "2026-10-01T08:00:00.000Z",
  vorgaengerId: null,
  ersetztAm: null,
  geloeschtAm: null,
  verknuepfungen: [{ typ: "beteiligung", id: BET_ID, name: "Alpha Energie (BF I)" }],
  ...extra,
});
const liste = { koerper: { daten: [dokument()] } };
const url = `/beteiligungen/${BET_ID}?tab=dokumente`;
const dateiSektion = async () => within(await screen.findByRole("heading", { level: 2, name: /^(Dokumente|Documents)$/ }).then((h) => h.closest("section")!));

describe("Dokumente am Datensatz", () => {
  it("zeigt die Liste mit Art, Größe und Verknüpfungen und bietet Hochladen, neue Version und Löschen an", async () => {
    spieleApi({ "/api/v1/documents": liste });
    rendereApp(url);
    const s = await dateiSektion();
    const link = await s.findByRole("link", { name: "vertrag.pdf" });
    expect(link.getAttribute("href")).toBe(`/dokumente/${DOK_ID}`);
    expect(s.getByRole("cell", { name: /Vertrag/ })).toBeTruthy();
    expect(s.getByText(/Beteiligung: Alpha Energie \(BF I\)/)).toBeTruthy();
    expect(s.getByRole("link", { name: "Herunterladen: vertrag.pdf" }).getAttribute("href")).toBe(`/api/v1/documents/${DOK_ID}/file`);
    expect(s.getByTestId("dokument-ablage")).toBeTruthy();
    expect(s.getByRole("button", { name: "Neue Version: vertrag.pdf" })).toBeTruthy();
    expect(s.getByRole("button", { name: "Löschen: vertrag.pdf" })).toBeTruthy();
    // Ohne KI kein KI-Knopf
    expect(s.queryByRole("button", { name: /Mit KI auslesen/ })).toBeNull();
  });

  it("lädt eine Datei mit Ziel, Art und Vertraulichkeit hoch und übersetzt Fehler der API", async () => {
    const api = spieleApi({ "/api/v1/documents": liste, "POST /api/v1/documents": fehler(422, "pdf_encrypted") });
    rendereApp(url);
    const s = await dateiSektion();
    const nutzer = userEvent.setup();
    await nutzer.selectOptions(s.getByLabelText("Dokumentart"), "beschluss");
    await nutzer.click(s.getByRole("checkbox", { name: "Vertraulich" }));
    await nutzer.upload(s.getByLabelText("Dateien auswählen"), new File(["%PDF-1.7"], "geheim.pdf", { type: "application/pdf" }));
    expect(await s.findByText(/geheim\.pdf: Verschlüsselte oder passwortgeschützte PDF-Dateien werden nicht angenommen/)).toBeTruthy();
    const formular = api.anfragen("POST", "/api/v1/documents")[0]!.formular!;
    expect(JSON.parse(formular.get("targets") as string)).toEqual([{ type: "investment", id: BET_ID }]);
    expect([formular.get("classification"), formular.get("confidential")]).toEqual(["resolution", "true"]);
    expect((formular.get("file") as File).name).toBe("geheim.pdf");
  });

  it("weist zu große Dateien ab, ohne sie zu senden", async () => {
    const api = spieleApi({ "/api/v1/documents": liste });
    rendereApp(url);
    const s = await dateiSektion();
    const gross = new File(["x"], "riesig.pdf", { type: "application/pdf" });
    Object.defineProperty(gross, "size", { value: 26 * 1024 * 1024 });
    await userEvent.setup().upload(s.getByLabelText("Dateien auswählen"), gross);
    expect(await s.findByText("riesig.pdf: Die Datei ist größer als 25 MB.")).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/documents")).toHaveLength(0);
  });

  it("lädt abgelegte Dateien der Reihe nach hoch und blockiert eine weitere Ablage während des Stapels", async () => {
    let weiter!: () => void;
    const warten = new Promise<void>((resolve) => { weiter = resolve; });
    const api = spieleApi({
      "/api/v1/documents": liste,
      "POST /api/v1/documents": async ({ formular }) => {
        if ((formular!.get("file") as File).name === "a.pdf") await warten;
        return { koerper: dokument() };
      },
    });
    rendereApp(url);
    const s = await dateiSektion();
    const ablage = s.getByTestId("dokument-ablage");
    const datei = (name: string) => new File(["%PDF-1.7"], name, { type: "application/pdf" });
    try {
      fireEvent.drop(ablage, { dataTransfer: { files: [datei("a.pdf"), datei("b.pdf")] } });
      fireEvent.drop(ablage, { dataTransfer: { files: [datei("zweite-ablage.pdf")] } });
      await waitFor(() => expect(api.anfragen("POST", "/api/v1/documents")).toHaveLength(1));
      expect(s.getByRole("button", { name: /Wird hochgeladen …/ })).toHaveProperty("disabled", true);
    } finally {
      weiter();
    }
    expect((await s.findByRole("status")).textContent).toContain("2 Dokumente hochgeladen.");
    const anfragen = api.anfragen("POST", "/api/v1/documents");
    expect(anfragen.map(({ formular }) => (formular!.get("file") as File).name)).toEqual(["a.pdf", "b.pdf"]);
  });

  it("zeigt Fehler einer neuen Version am ausgewählten Dokument und lässt einen weiteren Versuch zu", async () => {
    const ersetzen = `/api/v1/documents/${DOK_ID}/replace`;
    const api = spieleApi({
      "/api/v1/documents": liste,
      [`POST ${ersetzen}`]: fehler(422, "pdf_encrypted"),
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neue Version: vertrag.pdf" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Neue Version: vertrag.pdf" }));
    const eingabe = dialog.getByLabelText("Datei auswählen");
    const ablage = dialog.getByTestId("dokument-versionsablage");
    fireEvent.drop(ablage, { dataTransfer: { files: [new File(["a"], "a.pdf"), new File(["b"], "b.pdf")] } });
    expect((await dialog.findByRole("alert")).textContent).toContain("Wählen Sie für die neue Version eine einzelne Datei aus.");
    expect(api.anfragen("POST", ersetzen)).toHaveLength(0);
    const gross = new File(["x"], "riesig.pdf", { type: "application/pdf" });
    Object.defineProperty(gross, "size", { value: 26 * 1024 * 1024 });
    await nutzer.upload(eingabe, gross);
    expect((await dialog.findByRole("alert")).textContent).toContain("riesig.pdf: Die Datei ist größer als 25 MB.");
    expect(api.anfragen("POST", ersetzen)).toHaveLength(0);
    await nutzer.upload(eingabe, new File(["%PDF-1.7"], "geheim.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(dialog.getByRole("alert").textContent).toMatch(/geheim\.pdf: Verschlüsselte oder passwortgeschützte PDF-Dateien/));
    expect(api.anfragen("POST", ersetzen)).toHaveLength(1);
    await nutzer.click(dialog.getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByRole("dialog", { name: "Neue Version: vertrag.pdf" })).toBeNull();
  });

  it("neue Version und Löschen (mit Rückfrage) rufen die API auf", async () => {
    const api = spieleApi({ "/api/v1/documents": liste, [`POST /api/v1/documents/${DOK_ID}/replace`]: { koerper: dokument({ id: "neu" }) }, [`DELETE /api/v1/documents/${DOK_ID}`]: { status: 204, koerper: null } });
    rendereApp(url);
    const s = await dateiSektion();
    await s.findByRole("link", { name: "vertrag.pdf" });
    const nutzer = userEvent.setup();
    expect(s.getAllByLabelText(/Dateien? auswählen/)).toHaveLength(1);
    await nutzer.click(s.getByRole("button", { name: "Neue Version: vertrag.pdf" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Neue Version: vertrag.pdf" }));
    await nutzer.upload(dialog.getByLabelText("Datei auswählen"), new File(["%PDF-1.7 neu"], "v2.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/documents/${DOK_ID}/replace`)).toHaveLength(1));
    expect((api.anfragen("POST", `/api/v1/documents/${DOK_ID}/replace`)[0]!.formular!.get("file") as File).name).toBe("v2.pdf");
    expect(await s.findByText("Neue Version für „vertrag.pdf“ hochgeladen.")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Neue Version: vertrag.pdf" })).toBeNull();
    await nutzer.click(s.getByRole("button", { name: "Löschen: vertrag.pdf" }));
    expect(api.anfragen("DELETE", `/api/v1/documents/${DOK_ID}`)).toHaveLength(0);
    await nutzer.click(s.getByRole("button", { name: "Ja, löschen" }));
    await waitFor(() => expect(api.anfragen("DELETE", `/api/v1/documents/${DOK_ID}`)).toHaveLength(1));
  });

  it("Betrachter sehen die Liste, aber weder Hochladen noch Ersetzen noch Löschen", async () => {
    spieleApi({ "/api/v1/documents": liste, "/api/v1/me": alsRolle("betrachter") });
    rendereApp(url);
    const s = await dateiSektion();
    await s.findByRole("link", { name: "vertrag.pdf" });
    expect(s.queryByLabelText("Dateien auswählen")).toBeNull();
    expect(s.queryByRole("button", { name: "Neue Version: vertrag.pdf" })).toBeNull();
    expect(s.queryByRole("button", { name: /Löschen/ })).toBeNull();
  });

  it("Bearbeiter können hochladen und ersetzen, aber nicht löschen", async () => {
    spieleApi({ "/api/v1/documents": liste, "/api/v1/me": alsRolle("bearbeiter") });
    rendereApp(url);
    const s = await dateiSektion();
    await s.findByRole("link", { name: "vertrag.pdf" });
    expect(s.getByTestId("dokument-ablage")).toBeTruthy();
    expect(s.getByRole("button", { name: "Neue Version: vertrag.pdf" })).toBeTruthy();
    expect(s.queryByRole("button", { name: /Löschen/ })).toBeNull();
  });

  it("zeigt Texte und Fehler auf Englisch", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi({ "/api/v1/documents": liste, "POST /api/v1/documents": fehler(415, "document_type_not_allowed") });
    rendereApp(url);
    const s = await dateiSektion();
    expect(await s.findByText("Contract")).toBeTruthy();
    expect(s.getByRole("button", { name: /Choose files/ })).toBeTruthy();
    expect(s.getByRole("button", { name: "Delete: vertrag.pdf" })).toBeTruthy();
    await userEvent.setup().upload(s.getByLabelText("Choose files"), new File(["x"], "a.pdf"));
    expect(await s.findByText(/a\.pdf: This file type is not allowed/)).toBeTruthy();
    expect(de.dokumente.titel).not.toBe(en.dokumente.titel);
  });
});

describe("Herkunft mit Fundstelle", () => {
  const fundstellen = [{ objektTyp: "bewertung", objektId: "bw1", feld: "wert", wert: "2000000.00", dokumentId: DOK_ID, dateiname: "vertrag.pdf", seite: 2, zitat: "Wert der Beteiligung: 2.000.000,00 EUR." }];

  it("die Beteiligung nennt Quelldokument und Seite mit Link; der Herkunftsdialog der Bewertung verweist auf dieselbe Seite", async () => {
    spieleApi({ [`/api/v1/beteiligungen/${BET_ID}`]: { koerper: { ...beteiligungDaten, fundstellen } } });
    rendereApp(url.replace("?tab=dokumente", ""));
    const quelle = await screen.findByRole("link", { name: "Aus Dokument vertrag.pdf, Seite 2" });
    expect(quelle.getAttribute("href")).toBe(`/dokumente/${DOK_ID}?seite=2`);
    const nutzer = userEvent.setup();
    const kennzahlen = screen.getByRole("region", { name: "Kennzahlen" });
    await nutzer.click(within(kennzahlen).getAllByRole("button", { name: /Herkunft/ })[2]!);
    const dialog = await screen.findByRole("dialog");
    const link = within(dialog).getByRole("link", { name: "Aus Dokument vertrag.pdf, Seite 2" });
    expect(link.getAttribute("href")).toBe(`/dokumente/${DOK_ID}?seite=2`);
  });

  it("lädt eine historische Dokumentseite samt Fundstellen mit dem Wissensstand der Kennzahl", async () => {
    const stand = "2026-10-01T10:11:12.345678Z";
    const pfad = `/api/v1/documents/${DOK_ID}`;
    const api = spieleApi({ [pfad]: { koerper: { ...dokument(), ersetztDurch: null, vorgaenger: [], fundstellen } } });
    rendereApp(`/dokumente/${DOK_ID}?seite=2&stichtag=2026-09-30&stand=${stand}`);
    await screen.findByRole("heading", { level: 1, name: "vertrag.pdf" });
    expect(api.anfragen("GET", pfad)[0]!.query.get("stand")).toBe(stand);
    expect(screen.getByText(/Stichtag 30\.09\.2026 · Wissensstand/)).toBeTruthy();
    const verweis = screen.getByRole("link", { name: /wert: .*Seite 2/ });
    expect(new URL(verweis.getAttribute("href")!, "http://localhost").searchParams.get("stand")).toBe(stand);
  });

  it("der Betrachter öffnet das Dokument an der Seite, mit dem PDF-Betrachter (PDF.js, ohne Dienste von außen)", async () => {
    spieleApi({ [`/api/v1/documents/${DOK_ID}`]: { koerper: { ...dokument(), ersetztDurch: null, vorgaenger: [], fundstellen: [{ objektTyp: "bewertung", objektId: "bw1", feld: "wert", wert: "2000000.00", seite: 2, zitat: "x" }] } } });
    rendereApp(`/dokumente/${DOK_ID}?seite=2`);
    expect(await screen.findByRole("heading", { level: 1, name: "vertrag.pdf" })).toBeTruthy();
    // PDF.js statt Browser-Betrachter: kein Rahmen, die Bytes kommen mit der Sitzung von der API, die Seite steht im Betrachter
    const rahmen = await screen.findByRole("group", { name: "Vorschau von vertrag.pdf" });
    expect(rahmen.getAttribute("data-url")).toBe(`/api/v1/documents/${DOK_ID}/file?inline=1`);
    expect(rahmen.getAttribute("data-seite")).toBe("2");
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByText("Geöffnet auf Seite 2")).toBeTruthy();
    expect(screen.getByRole("link", { name: "wert: 2000000.00 (Seite 2)" }).getAttribute("href")).toBe(`/dokumente/${DOK_ID}?seite=2`);
  });
});

describe("Suche", () => {
  it("die globale Suche zeigt Treffer in Dokumenten mit Seite", async () => {
    spieleApi({ "/api/v1/suche": { koerper: { q: "alpen", organisationen: [], personen: [], deals: [], dokumente: [{ id: DOK_ID, dateiname: "vertrag.pdf", klassifikation: "vertrag", seite: 2, ausschnitt: "Projekt ⟦Alpenglühen⟧ und Fristen", score: 0.5 }] } } });
    rendereApp("/");
    await screen.findByRole("heading", { level: 1 });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Suche" });
    await userEvent.setup().type(await within(dialog).findByLabelText("Suchbegriff"), "alpen");
    expect(await within(dialog).findByText("vertrag.pdf")).toBeTruthy();
    expect(within(dialog).getByText(/Seite 2 · Projekt Alpenglühen und Fristen/)).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "Dokumente" })).toBeTruthy();
  });
});
