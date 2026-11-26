import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { alsRolle, ANDERE_ID, DRITTE_ID, FONDS_ID, fehler, ICH_ID, rendereApp, spieleApi } from "../test/hilfen";
import { de } from "../i18n/de";
import { en } from "../i18n/en";

const LAUF_ID = "aaaaaaaa-0000-4000-8000-000000000001";

/** Ein Importlauf in der Form der API (Eckdaten, Vorschau, Ergebnis jeweils nach Stand). */
const zaehler = (zeilen: number, neu: number, unveraendert = 0, abweichend = 0) => ({ zeilen, neu, unveraendert, abweichend });
const lauf = (extra: Record<string, unknown> = {}) => ({
  id: LAUF_ID,
  dateiname: "beispiel-de.xlsx",
  dateityp: "xlsx",
  sprache: "de",
  groesse: 20480,
  sha256: "ab".repeat(32),
  status: "hochgeladen",
  hochgeladenVon: ANDERE_ID,
  hochgeladenVonName: "Berta Beispiel",
  hochgeladenAm: "2026-11-20T08:00:00.000Z",
  geprueftVon: null,
  geprueftVonName: null,
  geprueftAm: null,
  fehlerAnzahl: null,
  warnungAnzahl: null,
  befundeGekuerzt: false,
  fonds: null,
  vorschau: null,
  uebernommenVon: null,
  uebernommenVonName: null,
  uebernommenAm: null,
  ergebnis: null,
  eingeschraenkt: false,
  ...extra,
});
const geprueft = (extra: Record<string, unknown> = {}) =>
  lauf({
    status: "geprueft",
    geprueftVon: DRITTE_ID,
    geprueftVonName: "Friedrich Beispiel",
    geprueftAm: "2026-11-20T08:05:00.000Z",
    fehlerAnzahl: 0,
    warnungAnzahl: 1,
    fonds: { ids: [FONDS_ID], neu: [] },
    vorschau: { zaehler: { fonds: zaehler(1, 0, 1), organisationen: zaehler(12, 12), vorgaenge: zaehler(595, 590, 0, 5), bewertungen: zaehler(20, 20) } },
    ...extra,
  });
const befund = (nr: number, extra: Record<string, unknown> = {}) => ({ nr, blatt: "vorgaenge", blattName: "Vorgänge", zeile: 10 + nr, spalte: "betrag", code: "ZAHL_UNGUELTIG", schweregrad: "fehler", meldung: `„abc${nr}“ ist keine Zahl.`, params: { wert: `abc${nr}`, art: "zahl" }, ...extra });
const befundSeite = (daten: unknown[], naechstesAb: number | null = null, eingeschraenkt = false) => ({ koerper: { daten, naechstesAb, eingeschraenkt } });

const pfad = `/api/v1/import/runs/${LAUF_ID}`;
const importApi = (abweichend: Parameters<typeof spieleApi>[0] = {}) =>
  spieleApi({
    "/api/v1/import/runs": { koerper: { daten: [lauf()] } },
    [pfad]: { koerper: lauf() },
    [`${pfad}/findings`]: befundSeite([]),
    ...abweichend,
  });

describe("Datenübernahme: Zugang und Navigation", () => {
  it("zeigt den Menüpunkt ab Bearbeiter", async () => {
    importApi({ "/api/v1/me": alsRolle("bearbeiter") });
    rendereApp("/dealflow");
    expect(await screen.findByRole("link", { name: "Datenübernahme" })).toBeTruthy();
  });

  it("zeigt ihn Betrachtern nicht und führt sie von /import zurück zur Startseite", async () => {
    importApi({ "/api/v1/me": alsRolle("betrachter") });
    const { router } = rendereApp("/import");
    await waitFor(() => expect(router.state.location.pathname).toBe(`/fonds/${FONDS_ID}`));
    expect(screen.queryByRole("link", { name: "Datenübernahme" })).toBeNull();
  });

  it("beschriftet Menüpunkt und Seite auf Englisch", async () => {
    localStorage.setItem("carraway.sprache", "en");
    importApi({ "/api/v1/me": alsRolle("bearbeiter") });
    rendereApp("/import");
    expect(await screen.findByRole("heading", { name: en.datenuebernahme.titel })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Data import" })).toBeTruthy();
    expect(screen.getByRole("link", { name: en.datenuebernahme.vorlage.en })).toBeTruthy();
  });
});

describe("Datenübernahme: Vorlage, Hochladen, Läufe", () => {
  it("bietet die Vorlage in beiden Sprachen und listet die Läufe mit Status", async () => {
    importApi({ "/api/v1/me": alsRolle("bearbeiter"), "/api/v1/import/runs": { koerper: { daten: [lauf(), geprueft({ id: "l2", dateiname: "zweite.csv", fehlerAnzahl: 3, status: "hochgeladen" })] } } });
    rendereApp("/import");
    expect(await screen.findByRole("link", { name: de.datenuebernahme.vorlage.de })).toHaveProperty("href", expect.stringContaining("/api/v1/import/template?language=de"));
    expect(screen.getByRole("link", { name: de.datenuebernahme.vorlage.en })).toHaveProperty("href", expect.stringContaining("language=en"));
    const tabelle = await screen.findByRole("region", { name: de.datenuebernahme.laeufe.tabelle });
    expect(within(tabelle).getByText("beispiel-de.xlsx")).toBeTruthy();
    expect(within(within(tabelle).getByRole("row", { name: /beispiel-de/ })).getByText(de.datenuebernahme.status.hochgeladen)).toBeTruthy();
    expect(within(tabelle).getByText(de.datenuebernahme.status.mitFehlern)).toBeTruthy();
    expect(within(tabelle).getByText("3 Fehler, 1 Warnung")).toBeTruthy();
  });

  it("lädt eine Datei als Formularfeld „datei“ hoch und öffnet den Lauf", async () => {
    const api = importApi({ "/api/v1/me": alsRolle("bearbeiter"), "POST /api/v1/import/runs": { status: 201, koerper: lauf() } });
    const { router } = rendereApp("/import");
    const nutzer = userEvent.setup();
    const eingabe = await screen.findByLabelText(de.datenuebernahme.hochladen.feldLabel);
    expect(screen.getByText(de.datenuebernahme.hochladen.hinweis(20))).toBeTruthy();
    const datei = new File(["x"], "bestand.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    await nutzer.upload(eingabe, datei);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/import/${LAUF_ID}`));
    const gesendet = api.anfragen("POST", "/api/v1/import/runs")[0]!;
    expect((gesendet.formular!.get("file") as File).name).toBe("bestand.xlsx");
    expect(gesendet.credentials).toBe("include");
  });

  it("nimmt auch abgelegte Dateien und weist falsche Endung und zu große Dateien vorab ab", async () => {
    const api = importApi({ "/api/v1/me": alsRolle("bearbeiter"), "POST /api/v1/import/runs": { status: 201, koerper: lauf() } });
    rendereApp("/import");
    const nutzer = userEvent.setup({ applyAccept: false });
    const eingabe = await screen.findByLabelText(de.datenuebernahme.hochladen.feldLabel);
    const ablage = screen.getByTestId("import-datei-dropzone");
    fireEvent.drop(ablage, { dataTransfer: { files: [new File(["x"], "bild.png")] } });
    expect(await screen.findByText(de.datenuebernahme.hochladen.falscheEndung)).toBeTruthy();
    const gross = new File(["x"], "gross.csv");
    Object.defineProperty(gross, "size", { value: 21 * 1024 * 1024 });
    await nutzer.upload(eingabe, gross);
    expect(await screen.findByText(de.datenuebernahme.hochladen.zuGross(20))).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/import/runs")).toHaveLength(0);

    fireEvent.drop(ablage, { dataTransfer: { files: [new File(["x"], "erste.csv"), new File(["y"], "zweite.csv")] } });
    expect(screen.getByText(de.datenuebernahme.hochladen.mehrere)).toBeTruthy();
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/import/runs")).toHaveLength(1));
    expect((api.anfragen("POST", "/api/v1/import/runs")[0]!.formular!.get("file") as File).name).toBe("erste.csv");
  });

  it("übersetzt Fehler der API beim Hochladen", async () => {
    importApi({ "/api/v1/me": alsRolle("bearbeiter"), "POST /api/v1/import/runs": fehler(415, "file_type_unknown") });
    rendereApp("/import");
    const nutzer = userEvent.setup();
    await nutzer.upload(await screen.findByLabelText(de.datenuebernahme.hochladen.feldLabel), new File(["x"], "komisch.csv"));
    expect((await screen.findByRole("alert")).textContent).toContain(de.fehler.file_type_unknown);
  });
});

describe("Datenübernahme: Prüfen und Befunde", () => {
  it("prüft, zeigt Zahlen je Blatt und übersetzt jeden Befund mit Blatt, Zeile und Spalte", async () => {
    let geprueftJetzt = false;
    const api = importApi({
      "/api/v1/me": alsRolle("bearbeiter"),
      [pfad]: () => ({ koerper: geprueftJetzt ? geprueft({ fehlerAnzahl: 1, warnungAnzahl: 1, status: "hochgeladen" }) : lauf() }),
      [`POST ${pfad}/validate`]: () => {
        geprueftJetzt = true;
        return { koerper: geprueft({ fehlerAnzahl: 1, warnungAnzahl: 1, status: "hochgeladen" }) };
      },
      [`${pfad}/findings`]: befundSeite([befund(1), befund(2, { schweregrad: "warnung", code: "BEWERTUNG_ABWEICHEND", blatt: "bewertungen", spalte: null, meldung: "Die Bewertung „B-1“ ist schon übernommen, aber anders." })]),
    });
    rendereApp(`/import/${LAUF_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: de.datenuebernahme.pruefen.knopf }));
    expect(api.anfragen("POST", `${pfad}/validate`)).toHaveLength(1);
    // Nach der Prüfung mit Fehlern öffnet sich der Reiter der Befunde; Hinweis und Zahlen stehen im Reiter „Prüfen“.
    await screen.findByRole("region", { name: de.datenuebernahme.befunde.tabelle });
    await nutzer.click(screen.getByRole("tab", { name: de.datenuebernahme.pruefen.titel }));
    expect(await screen.findByText(de.datenuebernahme.pruefen.mitFehlern(1, 1))).toBeTruthy();
    const zaehlerTabelle = await screen.findByRole("region", { name: de.datenuebernahme.zaehler.tabelle });
    const vorgaenge = within(zaehlerTabelle).getByRole("row", { name: /Vorgänge/ });
    expect(within(vorgaenge).getAllByRole("cell").map((z) => z.textContent)).toEqual(["Vorgänge", "595", "590", "0", "5"]);
    await nutzer.click(screen.getByRole("tab", { name: de.datenuebernahme.befunde.titel }));
    const zeile = within(await screen.findByRole("region", { name: de.datenuebernahme.befunde.tabelle })).getByRole("row", { name: /Zahl ungültig/ });
    expect(within(zeile).getAllByRole("cell").map((z) => z.textContent)).toEqual(["Fehler", "Vorgänge", "11", "betrag", "Zahl ungültig„abc1“ ist keine Zahl."]);
    const befundeNeu = screen.getByRole("region", { name: de.datenuebernahme.befunde.tabelle });
    expect(within(befundeNeu).getByText("Bewertung weicht ab")).toBeTruthy();
    // ohne Zeile steht ein Strich, nicht „null“
    expect(within(within(befundeNeu).getByRole("row", { name: /Bewertung weicht ab/ })).getAllByRole("cell")[3]!.textContent).toBe("–");
  });

  it("zeigt die Befunde auf Englisch übersetzt, mit der deutschen Meldung als Original", async () => {
    localStorage.setItem("carraway.sprache", "en");
    importApi({
      "/api/v1/me": alsRolle("bearbeiter"),
      [pfad]: { koerper: geprueft({ fehlerAnzahl: 1, status: "hochgeladen" }) },
      [`${pfad}/findings`]: befundSeite([befund(1, { code: "PFLICHTFELD_FEHLT", spalte: "betrag", meldung: "Das Pflichtfeld betrag ist leer.", params: { spalte: "betrag" } })]),
    });
    rendereApp(`/import/${LAUF_ID}`);
    const befunde = await screen.findByRole("region", { name: en.datenuebernahme.befunde.tabelle });
    expect(within(befunde).getByText("Required field empty")).toBeTruthy();
    expect(within(befunde).getByText(/The required field “betrag” is empty\./)).toBeTruthy();
    expect(within(befunde).getByText(/Original message \(German\): Das Pflichtfeld betrag ist leer\./)).toBeTruthy();
  });

  it("blättert mit ?ab= und filtert nach Schweregrad und Blatt", async () => {
    const api = importApi({
      "/api/v1/me": alsRolle("bearbeiter"),
      [pfad]: { koerper: geprueft({ fehlerAnzahl: 150, warnungAnzahl: 0, status: "hochgeladen" }) },
      [`${pfad}/findings`]: (a) => {
        const ab = Number(a.query.get("ab"));
        if (a.query.get("schweregrad") === "warnung") return befundSeite([befund(7, { schweregrad: "warnung", code: "FONDS_ABWEICHEND", blatt: "fonds", meldung: "Der Fonds „F“ gibt es schon." })]);
        if (a.query.get("blatt") === "personen") return befundSeite([]);
        return ab === 0 ? befundSeite([befund(1), befund(2)], 2) : befundSeite([befund(3)]);
      },
    });
    rendereApp(`/import/${LAUF_ID}`);
    const nutzer = userEvent.setup();
    await screen.findByText("„abc2“ ist keine Zahl.", { exact: false });
    expect(api.anfragen("GET", `${pfad}/findings`)[0]!.query.get("ab")).toBe("0");
    expect(api.anfragen("GET", `${pfad}/findings`)[0]!.query.get("limit")).toBe("100");
    await nutzer.click(screen.getByRole("button", { name: /Weitere Befunde laden/ }));
    await screen.findByText("„abc3“ ist keine Zahl.", { exact: false });
    expect(api.anfragen("GET", `${pfad}/findings`).at(-1)!.query.get("ab")).toBe("2");
    expect(screen.getByText(de.datenuebernahme.befunde.geladen(3))).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Weitere Befunde laden/ })).toBeNull();

    await nutzer.selectOptions(screen.getByLabelText(de.datenuebernahme.befunde.filter.schweregrad), "warnung");
    await screen.findByText("Fonds weicht ab");
    expect(api.anfragen("GET", `${pfad}/findings`).at(-1)!.query.get("schweregrad")).toBe("warnung");
    expect(screen.queryByText(/abc1/)).toBeNull();

    await nutzer.selectOptions(screen.getByLabelText(de.datenuebernahme.befunde.filter.schweregrad), "");
    await nutzer.selectOptions(screen.getByLabelText(de.datenuebernahme.befunde.filter.blatt), "personen");
    expect(await screen.findByText(de.datenuebernahme.befunde.keine)).toBeTruthy();
    expect(api.anfragen("GET", `${pfad}/findings`).at(-1)!.query.get("blatt")).toBe("personen");
  });

  it("gibt Codes ohne eigenen Eintrag nicht preis, sondern fällt auf die Fehlertabelle und die Meldung zurück", async () => {
    importApi({
      "/api/v1/me": alsRolle("bearbeiter"),
      [pfad]: { koerper: geprueft({ fehlerAnzahl: 2, status: "hochgeladen" }) },
      [`${pfad}/findings`]: befundSeite([befund(1, { code: "book_value_negative", meldung: "Der Buchwert wird negativ." }), befund(2, { code: "NEUER_CODE", meldung: "Etwas Neues." })]),
    });
    rendereApp(`/import/${LAUF_ID}`);
    const befunde = await screen.findByRole("region", { name: de.datenuebernahme.befunde.tabelle });
    expect(within(befunde).getByText(de.fehler.book_value_negative)).toBeTruthy();
    expect(within(befunde).getByText("NEUER_CODE")).toBeTruthy();
  });
});

describe("Datenübernahme: Übernehmen (Vier-Augen)", () => {
  const als = (rolle: "bearbeiter" | "freigeber") => alsRolle(rolle);

  it("sperrt die hochladende Person mit Erklärung, auch mit Freigeberrolle", async () => {
    const api = importApi({ "/api/v1/me": als("freigeber"), [pfad]: { koerper: geprueft({ hochgeladenVon: ICH_ID, hochgeladenVonName: "Vera Beispiel" }) } });
    rendereApp(`/import/${LAUF_ID}`);
    const knopf = (await screen.findByRole("button", { name: de.datenuebernahme.uebernehmen.knopf })) as HTMLButtonElement;
    expect(knopf.disabled).toBe(true);
    expect(screen.getByText(new RegExp(de.datenuebernahme.uebernehmen.selbstHochgeladen.slice(0, 40)))).toBeTruthy();
    expect(knopf.getAttribute("aria-describedby")).toBe("uebernehmen-grund");
    expect(api.anfragen("POST", `${pfad}/apply`)).toHaveLength(0);
  });

  it("sperrt auch die prüfende Person", async () => {
    importApi({ "/api/v1/me": als("freigeber"), [pfad]: { koerper: geprueft({ geprueftVon: ICH_ID, geprueftVonName: "Vera Beispiel" }) } });
    rendereApp(`/import/${LAUF_ID}`);
    expect(((await screen.findByRole("button", { name: de.datenuebernahme.uebernehmen.knopf })) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(new RegExp(de.datenuebernahme.uebernehmen.selbstGeprueft.slice(0, 40)))).toBeTruthy();
  });

  it("sperrt Personen ohne Freigeberrolle und Läufe, die noch Fehler haben", async () => {
    importApi({ "/api/v1/me": als("bearbeiter"), [pfad]: { koerper: geprueft() } });
    rendereApp(`/import/${LAUF_ID}`);
    expect(((await screen.findByRole("button", { name: de.datenuebernahme.uebernehmen.knopf })) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(de.datenuebernahme.uebernehmen.keineRolle)).toBeTruthy();
  });

  it("sperrt, solange der Lauf nicht fehlerfrei geprüft ist", async () => {
    importApi({ "/api/v1/me": als("freigeber"), [pfad]: { koerper: geprueft({ status: "hochgeladen", fehlerAnzahl: 2 }) } });
    rendereApp(`/import/${LAUF_ID}?tab=uebernehmen`);
    expect(((await screen.findByRole("button", { name: de.datenuebernahme.uebernehmen.knopf })) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(de.datenuebernahme.uebernehmen.nichtGeprueft)).toBeTruthy();
  });

  it("lässt eine andere Person mit Freigeberrolle nach Bestätigung übernehmen und zeigt das Ergebnis", async () => {
    let uebernommen = false;
    const ergebnis = {
      zaehler: { vorgaenge: zaehler(595, 590, 0, 5), fonds: zaehler(1, 0, 1) },
      fonds: [
        {
          kurzname: "BF I",
          name: "Beispielfonds I",
          beteiligungen: 11,
          zusagen: "1000000.00",
          auszahlungen: "900000.00",
          rueckfluesse: "0.00",
          tilgungen: "0.00",
          abrufe: "500000.00",
          ausschuettungen: "0.00",
          zeichnungskapital: "60000000.00",
          nav: "25796900.00",
          navStichtag: "2026-09-30",
          kontrollsummen: [{ groesse: "nav", quelle: "25000000.00", ist: "25796900.00", differenz: "796900.00", status: "abweichung", stichtag: "2026-09-30" }],
        },
      ],
    };
    const fertig = geprueft({ status: "uebernommen", uebernommenVon: ICH_ID, uebernommenVonName: "Vera Beispiel", uebernommenAm: "2026-11-20T09:00:00.000Z", ergebnis });
    const api = importApi({
      "/api/v1/me": als("freigeber"),
      [pfad]: () => ({ koerper: uebernommen ? fertig : geprueft() }),
      [`POST ${pfad}/apply`]: () => {
        uebernommen = true;
        return { koerper: fertig };
      },
    });
    rendereApp(`/import/${LAUF_ID}`);
    const nutzer = userEvent.setup();
    const knopf = (await screen.findByRole("button", { name: de.datenuebernahme.uebernehmen.knopf })) as HTMLButtonElement;
    expect(knopf.disabled).toBe(false);
    await nutzer.click(knopf);
    const dialog = within(await screen.findByRole("dialog"));
    expect(api.anfragen("POST", `${pfad}/apply`)).toHaveLength(0);
    await nutzer.click(dialog.getByRole("button", { name: de.datenuebernahme.uebernehmen.knopf }));
    await waitFor(() => expect(api.anfragen("POST", `${pfad}/apply`)).toHaveLength(1));
    // Nach der Übernahme öffnet sich der Reiter „Ergebnis“.
    const kontrolle = await screen.findByRole("region", { name: de.datenuebernahme.ergebnis.kontrollTabelle("Beispielfonds I") });
    expect(within(kontrolle).getByText(de.datenuebernahme.ergebnis.kontrolleStatus.abweichung)).toBeTruthy();
    expect(screen.getByText(de.datenuebernahme.ergebnis.navHinweis)).toBeTruthy();
    expect(screen.getByRole("heading", { name: de.datenuebernahme.ergebnis.titel })).toBeTruthy();
  });

  it("übersetzt Ablehnungen der API (Vier-Augen, Fehler bei der frischen Prüfung)", async () => {
    importApi({ "/api/v1/me": als("freigeber"), [pfad]: { koerper: geprueft() }, [`POST ${pfad}/apply`]: fehler(409, "import_failed", { fehler: 2 }) });
    rendereApp(`/import/${LAUF_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: de.datenuebernahme.uebernehmen.knopf }));
    await nutzer.click(within(await screen.findByRole("dialog")).getByRole("button", { name: de.datenuebernahme.uebernehmen.knopf }));
    expect((await screen.findByRole("alert")).textContent).toContain(de.fehler.import_failed);
  });
});

describe("Datenübernahme: Abnahmeprotokoll", () => {
  it("verlinkt PDF und Excel in der Sprache der Oberfläche", async () => {
    importApi({ "/api/v1/me": alsRolle("freigeber"), [pfad]: { koerper: geprueft() } });
    rendereApp(`/import/${LAUF_ID}?tab=protokoll`);
    const pdf = await screen.findByRole("link", { name: de.datenuebernahme.protokoll.pdf });
    expect(pdf.getAttribute("href")).toBe(`${pfad}/log?format=pdf&language=de`);
    expect(screen.getByRole("link", { name: de.datenuebernahme.protokoll.xlsx }).getAttribute("href")).toBe(`${pfad}/log?format=xlsx&language=de`);
    expect(pdf.hasAttribute("download")).toBe(true);
  });

  it("verlinkt auf Englisch mit language=en", async () => {
    localStorage.setItem("carraway.sprache", "en");
    importApi({ "/api/v1/me": alsRolle("freigeber"), [pfad]: { koerper: geprueft() } });
    rendereApp(`/import/${LAUF_ID}?tab=protokoll`);
    expect((await screen.findByRole("link", { name: en.datenuebernahme.protokoll.pdf })).getAttribute("href")).toBe(`${pfad}/log?format=pdf&language=en`);
  });

  it("bietet es vor der Prüfung noch nicht an", async () => {
    importApi({ "/api/v1/me": alsRolle("bearbeiter") });
    rendereApp(`/import/${LAUF_ID}?tab=protokoll`);
    expect(await screen.findByText(de.datenuebernahme.protokoll.nurNachPruefung)).toBeTruthy();
    expect(screen.queryByRole("link", { name: de.datenuebernahme.protokoll.pdf })).toBeNull();
  });
});

describe("Datenübernahme: eingeschränkte Sicht", () => {
  it("erklärt die Einschränkung und zeigt weder Zahlen noch Protokoll noch Ergebnis", async () => {
    const api = importApi({
      "/api/v1/me": alsRolle("bearbeiter"),
      [pfad]: { koerper: lauf({ hochgeladenVon: ICH_ID, hochgeladenVonName: "Vera Beispiel", geprueftVon: ICH_ID, geprueftVonName: "Vera Beispiel", geprueftAm: "2026-11-20T08:05:00.000Z", eingeschraenkt: true, status: "hochgeladen" }) },
      [`${pfad}/findings`]: befundSeite([befund(1, { code: "KEINE_BERECHTIGUNG_FONDS", blatt: "beteiligungen", meldung: "Für den Fonds, zu dem „X“ gehört, fehlt die Berechtigung (bearbeiter). Der Datensatz wird nicht geprüft." })], null, true),
    });
    rendereApp(`/import/${LAUF_ID}`);
    expect(await screen.findByText(de.datenuebernahme.eingeschraenkt.titel)).toBeTruthy();
    expect(screen.getByText(de.datenuebernahme.eingeschraenkt.text)).toBeTruthy();
    expect(await screen.findByText(de.datenuebernahme.eingeschraenkt.befundeNur)).toBeTruthy();
    expect(await screen.findByText("Keine Berechtigung am Fonds")).toBeTruthy();
    expect(screen.queryByRole("region", { name: de.datenuebernahme.zaehler.tabelle })).toBeNull();
    expect(screen.queryByText(de.datenuebernahme.pruefen.mitFehlernTitel)).toBeNull();
    expect(screen.queryByRole("tab", { name: de.datenuebernahme.ergebnis.titel })).toBeNull();
    await userEvent.setup().click(screen.getByRole("tab", { name: de.datenuebernahme.protokoll.titel }));
    expect(await screen.findByText(de.datenuebernahme.protokoll.nurMitRechten)).toBeTruthy();
    expect(screen.queryByRole("link", { name: de.datenuebernahme.protokoll.pdf })).toBeNull();
    expect(screen.queryByRole("heading", { name: de.datenuebernahme.ergebnis.titel })).toBeNull();
    expect(api.anfragen("GET", `${pfad}/log`)).toHaveLength(0);
  });

  it("zeigt in der Liste „nicht sichtbar“ statt Anzahlen", async () => {
    importApi({ "/api/v1/me": alsRolle("bearbeiter"), "/api/v1/import/runs": { koerper: { daten: [lauf({ eingeschraenkt: true, fehlerAnzahl: null })] } } });
    rendereApp("/import");
    expect(await screen.findByText(de.datenuebernahme.laeufe.eingeschraenkt)).toBeTruthy();
  });

  it("zeigt einen unbekannten oder unsichtbaren Lauf als übersetzten Fehler", async () => {
    importApi({ "/api/v1/me": alsRolle("bearbeiter"), [pfad]: fehler(404, "import_run_not_found") });
    rendereApp(`/import/${LAUF_ID}`);
    expect(await screen.findByText(de.fehler.import_run_not_found)).toBeTruthy();
  });
});
