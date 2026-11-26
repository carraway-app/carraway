import { createEvent, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ANDERE_ID, FONDS_ID, ICH_ID, ORG_A, alsRolle, arbeitsdealDaten, crmDealAntworten, crmZeilenDaten, dealDetailDaten, fehler, rendereApp, spieleApi } from "../test/hilfen";

const spalte = (name: RegExp) => screen.getByRole("region", { name });
const boardAnfragen = (api: ReturnType<typeof spieleApi>) => api.anfragen("POST", "/api/v1/crm/objekte/deal/board");

describe("Dealflow", () => {
  it("zeigt standardmäßig offene Deals mit Anzahl, Summe und persönlichen Feldern", async () => {
    spieleApi();
    rendereApp("/dealflow");
    const anfrage = await screen.findByRole("region", { name: /^Anfrage/ });
    expect(within(anfrage).getByRole("link", { name: "Alpha, Wachstum" })).toBeTruthy();
    expect(within(anfrage).getByRole("link", { name: "Alpha Energie" })).toBeTruthy();
    expect(within(anfrage).queryByText("Investmentmanagement")).toBeNull();
    expect(within(anfrage).queryByText("Empfehlung")).toBeNull();
    // Ticket der Karte und Summe der Spalte
    expect(within(anfrage).getAllByText(/2\.450\.000/)).toHaveLength(2);
    expect(within(anfrage).getByLabelText("1 Deal in dieser Spalte")).toBeTruthy();
    expect(screen.queryByText("Beta, Serie A")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Alle" }));
    expect(await within(await screen.findByRole("region", { name: /^Due Diligence/ })).findByText("Beta, Serie A")).toBeTruthy();
    expect(within(spalte(/^Closing/)).getByText("Keine Deals")).toBeTruthy();
    expect(within(spalte(/^Closing/)).getByLabelText("0 Deals in dieser Spalte")).toBeTruthy();
  });

  it("behält den Statusfilter beim Wechsel zur Liste innerhalb der Pipeline", async () => {
    const api = spieleApi();
    const { router } = rendereApp("/dealflow");
    const nutzer = userEvent.setup();
    await screen.findByRole("region", { name: /^Anfrage/ });

    await nutzer.click(screen.getByRole("button", { name: "Abgesagt" }));
    await waitFor(() => expect(screen.queryByText("Alpha, Wachstum")).toBeNull());
    expect(await screen.findByText("Beta, Serie A")).toBeTruthy();
    expect(router.state.location.search).toEqual({ status: "abgesagt" });
    expect((boardAnfragen(api).at(-1)!.koerper as { filter: unknown }).filter).toEqual({ verknuepfung: "und", elemente: [{ feld: "status", operator: "ist", wert: "abgesagt" }] });

    await nutzer.click(screen.getByRole("button", { name: "Liste" }));
    const tabelle = await screen.findByRole("region", { name: "Deals in der Pipeline" });
    expect(within(tabelle).getByRole("link", { name: "Beta, Serie A" })).toBeTruthy();
    expect(within(tabelle).queryByRole("link", { name: "Alpha, Wachstum" })).toBeNull();
    expect(router.state.location.pathname).toBe("/dealflow");
    expect(router.state.location.search).toEqual({ darstellung: "liste", status: "abgesagt" });
  });

  it("übersetzt Phasen und Bedienung ins Englische", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi();
    rendereApp("/dealflow");
    expect(await screen.findByRole("region", { name: /^Enquiry/ })).toBeTruthy();
    expect(within(spalte(/^Enquiry/)).getByRole("button", { name: "Move: Alpha, Wachstum" })).toBeTruthy();
    expect(within(spalte(/^Due diligence/)).queryByRole("button", { name: /^Move:/ })).toBeNull();
    expect(within(spalte(/^Enquiry/)).getByRole("button", { name: "Create deal in “Enquiry”" })).toBeTruthy();
  });

  it("verschiebt per Ziehen und Ablegen und ändert die Phase über die API", async () => {
    const api = spieleApi({ "POST /api/v1/deals/d1/phase": { koerper: { deal: {}, phasenwechsel: {} } } });
    rendereApp("/dealflow?status=alle");
    await screen.findByRole("region", { name: /^Anfrage/ });
    const karte = screen.getByRole("link", { name: "Alpha, Wachstum" }).closest("article")!;
    const daten = new Map<string, string>();
    const uebertragung = { setData: (k: string, v: string) => daten.set(k, v), getData: (k: string) => daten.get(k) ?? "", effectAllowed: "" };
    fireEvent(karte, Object.assign(createEvent.dragStart(karte), { dataTransfer: uebertragung }));
    const ziel = spalte(/^Prüfung/);
    fireEvent(ziel, Object.assign(createEvent.dragOver(ziel), { dataTransfer: uebertragung }));
    fireEvent(ziel, Object.assign(createEvent.drop(ziel), { dataTransfer: uebertragung }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/deals/d1/phase")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/deals/d1/phase")[0]!.koerper).toEqual({ nachPhase: "pruefung" });
    // abgesagte Deals lassen sich nicht ziehen
    expect(screen.getByRole("link", { name: "Beta, Serie A" }).closest("article")!.getAttribute("draggable")).toBe("false");
  });

  it("verschiebt mit der Tastatur und sagt Aufnahme, Ziel und Ablage an; Escape bricht ab", async () => {
    const api = spieleApi({ "POST /api/v1/deals/d1/phase": { koerper: { deal: {}, phasenwechsel: {} } } });
    rendereApp("/dealflow");
    const nutzer = userEvent.setup();
    const griff = await screen.findByRole("button", { name: "Verschieben: Alpha, Wachstum" });
    // Abgesagte Deals haben keinen Griff
    expect(screen.queryByRole("button", { name: "Verschieben: Beta, Serie A" })).toBeNull();
    const ansage = () => screen.getAllByRole("status").find((e) => e.getAttribute("aria-live") === "assertive")!;

    griff.focus();
    await nutzer.keyboard(" ");
    expect(ansage().textContent).toContain("Alpha, Wachstum aufgenommen, Spalte Anfrage, 1 von 6");
    expect(griff.getAttribute("aria-pressed")).toBe("true");
    await nutzer.keyboard("{ArrowRight}");
    expect(ansage().textContent).toBe("Ziel: Erstgespräch, Spalte 2 von 6");
    await nutzer.keyboard("{Escape}");
    expect(ansage().textContent).toBe("Verschieben von Alpha, Wachstum abgebrochen");
    expect(api.anfragen("POST", "/api/v1/deals/d1/phase")).toHaveLength(0);

    await nutzer.keyboard(" {ArrowRight}{ArrowRight}{ArrowLeft}{Enter}");
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/deals/d1/phase")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/deals/d1/phase")[0]!.koerper).toEqual({ nachPhase: "erstgespraech" });
    await waitFor(() => expect(ansage().textContent).toBe("Alpha, Wachstum nach Erstgespräch verschoben"));
  });

  it("meldet die Regel „Closing nur mit Beschluss“ und lässt die Karte stehen", async () => {
    spieleApi({ "POST /api/v1/deals/d1/phase": () => fehler(409, "resolution_missing") });
    rendereApp("/dealflow");
    const nutzer = userEvent.setup();
    const griff = await screen.findByRole("button", { name: "Verschieben: Alpha, Wachstum" });
    griff.focus();
    await nutzer.keyboard(" {ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{Enter}");
    expect((await screen.findByRole("alert")).textContent).toContain("zustimmender Beschluss");
    await waitFor(() => expect(within(spalte(/^Anfrage/)).getByText("Alpha, Wachstum")).toBeTruthy());
    expect(within(spalte(/^Closing/)).queryByText("Alpha, Wachstum")).toBeNull();
    expect(screen.getAllByRole("status").find((e) => e.getAttribute("aria-live") === "assertive")!.textContent).toBe("Alpha, Wachstum konnte nicht verschoben werden");
  });

  it("legt in einer Spalte einen Deal an (Startphase) und bleibt auf dem Board", async () => {
    const api = spieleApi({ "POST /api/v1/deals": { status: 201, koerper: { ...dealDetailDaten, id: "d9", organisation: { id: ORG_A, name: "Alpha Energie" } } } });
    const { router } = rendereApp("/dealflow");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Deal in „Prüfung“ anlegen" }));
    // Das Closing nimmt keine Neuanlage an
    expect(screen.queryByRole("button", { name: "Deal in „Closing“ anlegen" })).toBeNull();
    const dialog = await screen.findByRole("dialog", { name: "Neuer Deal" });
    await nutzer.type(within(dialog).getByLabelText("Titel des Deals"), "Alpha, Serie B");
    await nutzer.type(within(dialog).getByLabelText("Organisation suchen"), "alp");
    await nutzer.click(await within(dialog).findByRole("button", { name: /^Alpha Energie/ }));
    await nutzer.click(within(dialog).getByRole("button", { name: "Deal anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/deals")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/deals")[0]!.koerper).toMatchObject({ titel: "Alpha, Serie B", organisationId: ORG_A, phase: "pruefung" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(router.state.location.pathname).toBe("/dealflow");
  });
});

describe("Dealflow-Arbeitslisten und Kartenfelder", () => {
  it("öffnet die Eingangsliste per Direktlink, zählt offene unzugeordnete Deals und sortiert älteste zuerst", async () => {
    const neuer = { ...arbeitsdealDaten, id: "d3", titel: "Aardvark", eingangsdatum: "2026-09-03", betreuung: null };
    const projekt = { ...arbeitsdealDaten, id: "d4", titel: "Nur Projektleitung", projektleiterId: ICH_ID, projektleiterName: "Vera Beispiel" };
    spieleApi({ "/api/v1/dealflow/arbeitsliste": { koerper: { deals: [neuer, projekt, arbeitsdealDaten], benutzerId: ICH_ID } } });
    rendereApp("/dealflow?bereich=eingang");
    const nutzer = userEvent.setup();
    const nav = await screen.findByRole("tablist", { name: "Dealflow-Ansichten" });
    const eingang = within(nav).getByRole("tab", { name: /Ohne Zuordnung/ });
    expect(eingang.getAttribute("aria-selected")).toBe("true");
    expect(within(nav).getByRole("tab", { name: "Meine Deals" }).getAttribute("aria-selected")).toBe("false");
    const tabelle = (await screen.findByRole("table"));
    await within(tabelle).findByRole("link", { name: arbeitsdealDaten.titel });
    expect(within(nav).getByLabelText("2 Deals").textContent).toBe("2");
    expect(within(tabelle).getAllByRole("link").map((link) => link.textContent)).toEqual(["Alpha, Wachstum", "Aardvark"]);
    expect(within(tabelle).getByText("Anna Berger")).toBeTruthy();
    await nutzer.click(within(tabelle).getByRole("button", { name: "Nach Deal sortieren" }));
    expect(within(tabelle).getAllByRole("link").map((link) => link.textContent)).toEqual(["Aardvark", "Alpha, Wachstum"]);
  });

  it("übernimmt atomar und wechselt per Tastatur zu einklappbaren, überschneidungsfreien Rollengruppen", async () => {
    const eigene = { investmentmanagerId: ICH_ID, investmentmanagerName: "Vera Beispiel" };
    const projekt = { projektleiterId: ICH_ID, projektleiterName: "Vera Beispiel" };
    let deals = [
      arbeitsdealDaten,
      { ...arbeitsdealDaten, id: "d3", titel: "Nur Projektleitung", ...projekt },
      { ...arbeitsdealDaten, id: "d4", titel: "Beide Rollen", ...eigene, ...projekt },
    ];
    const api = spieleApi({
      "/api/v1/dealflow/arbeitsliste": () => ({ koerper: { deals, benutzerId: ICH_ID } }),
      "PATCH /api/v1/deals/d1/zuordnung": () => {
        deals = [{ ...arbeitsdealDaten, ...eigene }, ...deals.slice(1)];
        return { koerper: deals[0] };
      },
    });
    rendereApp("/dealflow?bereich=eingang");
    const nutzer = userEvent.setup();
    const uebernehmen = await screen.findByRole("button", { name: "Übernehmen: Alpha, Wachstum" });
    uebernehmen.focus();
    await nutzer.keyboard("{Enter}");
    await screen.findByText("Alle offenen Deals sind zugeordnet.");
    expect(api.anfragen("PATCH", "/api/v1/deals/d1/zuordnung")[0]?.koerper).toEqual({
      investmentmanagerId: ICH_ID, erwartetInvestmentmanagerId: null, erwartetProjektleiterId: null,
    });
    expect(await screen.findByLabelText("0 Deals")).toBeTruthy();
    const nav = screen.getByRole("tablist", { name: "Dealflow-Ansichten" });
    within(nav).getByRole("tab", { name: "Meine Deals" }).focus();
    await nutzer.keyboard("{Enter}");
    const im = await screen.findByRole("region", { name: "Investmentmanagement" });
    expect(within(im).getByRole("link", { name: "Alpha, Wachstum" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Projektleitung" })).getByRole("link", { name: "Nur Projektleitung" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Investmentmanagement und Projektleitung" })).getByRole("link", { name: "Beide Rollen" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Beide Rollen" })).toHaveLength(1);
    const details = im.closest("details")!;
    await nutzer.click(details.querySelector("summary")!);
    expect(details.open).toBe(false);
  });

  it("schlägt berechtigte Alt-Betreuung vor und verlangt nach einem Konflikt eine neue Entscheidung", async () => {
    let deal = arbeitsdealDaten;
    let speicherungen = 0;
    const anna = { id: ANDERE_ID, name: "Anna Berger" };
    const andere = { id: ICH_ID, name: "Vera Beispiel" };
    const api = spieleApi({
      "/api/v1/dealflow/arbeitsliste": () => ({ koerper: { deals: [deal], benutzerId: ICH_ID } }),
      "/api/v1/deals/d1/zustaendige": { koerper: { benutzer: [anna, andere] } },
      "PATCH /api/v1/deals/d1/zuordnung": () => {
        speicherungen++;
        if (speicherungen === 1) {
          deal = { ...deal, projektleiterId: andere.id, projektleiterName: andere.name };
          return fehler(409, "deal_assignment_conflict");
        }
        return { koerper: deal };
      },
    });
    rendereApp("/dealflow?bereich=eingang");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Zuweisen: Alpha, Wachstum" }));
    const dialog = await screen.findByRole("dialog", { name: "Zuordnung bearbeiten" });
    const im = within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Investmentmanagement" });
    expect(im.value).toBe("");
    const vorschlag = await within(dialog).findByRole("button", { name: "Anna Berger als Investmentmanagement übernehmen" });
    await nutzer.click(vorschlag);
    expect(im.value).toBe(anna.id);
    expect(document.activeElement).toBe(im);
    expect(api.anfragen("PATCH", "/api/v1/deals/d1/zuordnung")).toHaveLength(0);
    await nutzer.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Die Zuordnung hat sich geändert");
    expect(im.disabled).toBe(true);
    await nutzer.click(within(dialog).getByRole("button", { name: "Zuordnung neu laden" }));
    await waitFor(() => expect(im.disabled).toBe(false));
    expect(im.value).toBe("");
    const pl = within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Projektleitung" });
    expect(pl.value).toBe(andere.id);
    await nutzer.selectOptions(pl, "");
    await nutzer.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("PATCH", "/api/v1/deals/d1/zuordnung").map((a) => a.koerper)).toEqual([
      { investmentmanagerId: anna.id, erwartetInvestmentmanagerId: null, erwartetProjektleiterId: null },
      { projektleiterId: null, erwartetInvestmentmanagerId: null, erwartetProjektleiterId: andere.id },
    ]);
  });

  it("bewahrt den Übernahmekonflikt sichtbar, auch wenn der Deal inzwischen aus dem Eingang verschwunden ist", async () => {
    let deal = arbeitsdealDaten;
    const api = spieleApi({
      "/api/v1/dealflow/arbeitsliste": () => ({ koerper: { deals: [deal], benutzerId: ICH_ID } }),
      "PATCH /api/v1/deals/d1/zuordnung": () => {
        deal = { ...deal, investmentmanagerId: ANDERE_ID, investmentmanagerName: "Anna Berger" };
        return fehler(409, "deal_assignment_conflict");
      },
    });
    rendereApp("/dealflow?bereich=eingang");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Übernehmen: Alpha, Wachstum" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Die Zuordnung hat sich geändert");
    expect(screen.queryByRole("link", { name: deal.titel })).toBeNull();
    expect(api.anfragen("PATCH", "/api/v1/deals/d1/zuordnung")).toHaveLength(1);
  });

  it("kombiniert Fonds, IM und PL per ID im CRM-Board und im CSV-Export", async () => {
    const api = spieleApi({
      "/api/v1/dealflow/arbeitsliste": { koerper: { benutzerId: ICH_ID, deals: [
        { ...arbeitsdealDaten, investmentmanagerId: ICH_ID, investmentmanagerName: "Alex Beispiel", projektleiterId: ANDERE_ID, projektleiterName: "Alex Beispiel" },
      ] } },
      "POST /api/v1/crm/objekte/deal/export": { koerper: [] },
    });
    rendereApp("/dealflow?bereich=pipeline");
    const nutzer = userEvent.setup();
    await screen.findByRole("region", { name: "Deals nach Phase" });
    const main = within(screen.getByRole("main"));
    expect(main.queryByRole("button", { name: "Zuweisen: Alpha, Wachstum" })).toBeNull();
    await nutzer.selectOptions(main.getByRole("combobox", { name: "Fonds" }), FONDS_ID);
    const im = main.getByRole("combobox", { name: "Investmentmanagement" });
    const pl = main.getByRole("combobox", { name: "Projektleitung" });
    await within(im).findByRole("option", { name: "Alex Beispiel" });
    await nutzer.selectOptions(im, ICH_ID);
    await nutzer.selectOptions(pl, ANDERE_ID);
    const filter = { verknuepfung: "und", elemente: [
      { feld: "status", operator: "ist", wert: "offen" },
      { feld: "fondsId", operator: "ist", wert: FONDS_ID },
      { feld: "investmentmanagerId", operator: "ist", wert: ICH_ID },
      { feld: "projektleiterId", operator: "ist", wert: ANDERE_ID },
    ] };
    await waitFor(() => expect(boardAnfragen(api).at(-1)?.koerper).toMatchObject({ filter }));
    await nutzer.click(main.getByRole("button", { name: "Als CSV exportieren" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/crm/objekte/deal/export").at(-1)?.koerper).toMatchObject({ filter }));
    await nutzer.selectOptions(pl, "-");
    await waitFor(() => expect(boardAnfragen(api).at(-1)?.koerper).toMatchObject({
      filter: { ...filter, elemente: [...filter.elemente.slice(0, 3), { feld: "projektleiterId", operator: "leer" }] },
    }));
  });

  it("zeigt eine Live-Vorschau persönlicher Kartenfelder und behält die gespeicherte Auswahl", async () => {
    let felder = ["ticket", "investmentmanager"];
    const api = spieleApi({
      "GET /api/v1/dealflow/kartenfelder": () => ({ koerper: { felder } }),
      "PUT /api/v1/dealflow/kartenfelder": (a) => {
        felder = (a.koerper as { felder: string[] }).felder;
        return { koerper: { felder } };
      },
    });
    rendereApp("/dealflow");
    const nutzer = userEvent.setup();
    await screen.findByRole("region", { name: "Deals nach Phase" });
    await nutzer.click(screen.getByRole("button", { name: "Kartenfelder" }));
    const dialog = await screen.findByRole("dialog", { name: "Kartenfelder" });
    const vorschau = within(dialog).getByRole("region", { name: "Kartenvorschau" });
    await within(vorschau).findByText("Alpha, Wachstum");
    expect(within(vorschau).queryByText("Investmentmanagement")).toBeNull();
    expect(within(dialog).queryByRole("checkbox", { name: /-ID/ })).toBeNull();
    await nutzer.click(within(dialog).getByRole("checkbox", { name: "Ticket" }));
    await nutzer.click(within(dialog).getByRole("checkbox", { name: "Quelle" }));
    expect(within(vorschau).getByText("Empfehlung")).toBeTruthy();
    expect(within(vorschau).queryByText("Ticket")).toBeNull();
    await nutzer.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("PUT", "/api/v1/dealflow/kartenfelder")[0]?.koerper).toEqual({ felder: ["investmentmanager", "quelle"] });
    expect(await within(spalte(/^Anfrage/)).findByText("Empfehlung")).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Kartenfelder" }));
    const erneut = await screen.findByRole("dialog", { name: "Kartenfelder" });
    expect(within(erneut).getByRole<HTMLInputElement>("checkbox", { name: "Quelle" }).checked).toBe(true);
  });
});

const pipelineDeal = (id: string, titel: string, werte: Record<string, unknown> = {}) => ({
  ...crmZeilenDaten.deal[0]!, id, titel, dealtyp: null, ...werte,
});

describe("Persönliche Pipeline und Dealtyp-Gruppen", () => {
  it("öffnet Meine Deals aus der Arbeitsliste und wertet beide Rollen als Oder nach Benutzer-ID aus", async () => {
    const zeilen = [
      pipelineDeal("d1", "Beide Rollen", { investmentmanagerId: ICH_ID, projektleiterId: ICH_ID, investmentmanager: "Alex Beispiel", projektleiter: "Alex Beispiel" }),
      pipelineDeal("d2", "Nur Projektleitung", { projektleiterId: ICH_ID, projektleiter: "Alex Beispiel" }),
      pipelineDeal("d3", "Andere Person", { investmentmanagerId: ANDERE_ID, investmentmanager: "Alex Beispiel", projektleiterId: ANDERE_ID }),
      pipelineDeal("d4", "Eigener abgesagter Deal", { investmentmanagerId: ICH_ID, status: "abgesagt" }),
    ];
    const api = spieleApi(crmDealAntworten(zeilen));
    const { router } = rendereApp("/dealflow?bereich=meine");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("link", { name: "Zur persönlichen Pipeline" }));
    const board = await screen.findByRole("region", { name: "Deals nach Phase" });
    expect(router.state.location.search).toEqual({ umfang: "meine" });
    expect(within(board).getAllByRole("link", { name: "Beide Rollen" })).toHaveLength(1);
    expect(within(board).getByRole("link", { name: "Nur Projektleitung" })).toBeTruthy();
    expect(within(board).queryByRole("link", { name: "Andere Person" })).toBeNull();
    expect(within(board).queryByRole("link", { name: "Eigener abgesagter Deal" })).toBeNull();
    expect(boardAnfragen(api).at(-1)?.koerper).toMatchObject({ filter: {
      verknuepfung: "und", elemente: [
        { verknuepfung: "oder", elemente: [
          { feld: "investmentmanagerId", operator: "ist", wert: ICH_ID },
          { feld: "projektleiterId", operator: "ist", wert: ICH_ID },
        ] },
        { feld: "status", operator: "ist", wert: "offen" },
      ],
    } });

    await nutzer.click(screen.getByRole("button", { name: "Abgesagt" }));
    expect(await screen.findByRole("link", { name: "Eigener abgesagter Deal" })).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Offen" }));
    await nutzer.click(screen.getByRole("button", { name: "Alle Deals" }));
    expect(await screen.findByRole("link", { name: "Andere Person" })).toBeTruthy();
  });

  it("zählt Gruppen vor dem Kartenlimit und findet weitere Deals auf der richtigen Listenseite", async () => {
    const zeilen = [
      ...Array.from({ length: 51 }, (_, i) => pipelineDeal(`e${i + 1}`, `Erst ${i + 1}`, { dealtyp: "erstinvestment" })),
      pipelineDeal("a1", "Anschluss Nord", { dealtyp: "anschlussinvestment", phase: "due_diligence" }),
      pipelineDeal("o1", "Ungetypt", { phase: "pruefung" }),
    ];
    const api = spieleApi(crmDealAntworten(zeilen));
    rendereApp("/dealflow?gruppe=dealtyp");
    const nutzer = userEvent.setup();
    const erstesBoard = await screen.findByRole("region", { name: "Deals nach Phase · Erstinvestment" });
    expect(within(erstesBoard).getAllByRole("region")).toHaveLength(6);
    const anfrage = within(erstesBoard).getByRole("region", { name: /^Anfrage/ });
    expect(within(anfrage).getAllByRole("article")).toHaveLength(50);
    expect(within(anfrage).getByLabelText("51 Deals in dieser Spalte")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Erstinvestment 51 Deals" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Anschlussinvestment 1 Deal" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Ohne Dealtyp 1 Deal" }).getAttribute("aria-expanded")).toBe("false");
    await nutzer.click(screen.getByRole("button", { name: "Anschlussinvestment 1 Deal" }));
    const anschlussBoard = await screen.findByRole("region", { name: "Deals nach Phase · Anschlussinvestment" });
    expect(within(anschlussBoard).getAllByRole("region")).toHaveLength(6);
    expect(within(anschlussBoard).getByRole("link", { name: "Anschluss Nord" })).toBeTruthy();
    const spaltenIds = [...erstesBoard.querySelectorAll("[aria-labelledby]"), ...anschlussBoard.querySelectorAll("[aria-labelledby]")]
      .map((e) => e.getAttribute("aria-labelledby"));
    expect(new Set(spaltenIds).size).toBe(12);
    await nutzer.click(screen.getByRole("button", { name: "1 weiterer Deal in der Liste" }));
    const liste = await screen.findByRole("region", { name: "Deals in der Pipeline · Erstinvestment" });
    expect(within(liste).queryByRole("link", { name: "Erst 51" })).toBeNull();
    await nutzer.click(screen.getByRole("button", { name: "Nächste Seite" }));
    expect(await screen.findByRole("link", { name: "Erst 51" })).toBeTruthy();
    const naechsteSeite = screen.getByRole("region", { name: "Deals in der Pipeline · Erstinvestment" });
    expect(within(naechsteSeite).queryByRole("link", { name: "Anschluss Nord" })).toBeNull();
    expect(screen.getByText("51–51 von 51 Deals")).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/crm/objekte/deal/abfrage").map((a) => a.koerper)).toContainEqual(expect.objectContaining({
      limit: 50, offset: 50, filter: { verknuepfung: "und", elemente: [
        { feld: "status", operator: "ist", wert: "offen" },
        { feld: "dealtyp", operator: "ist", wert: "erstinvestment" },
      ] },
    }));
    await nutzer.click(screen.getByRole("button", { name: "Ohne Dealtyp 1 Deal" }));
    const ohne = await screen.findByRole("region", { name: "Deals in der Pipeline · Ohne Dealtyp" });
    expect(within(ohne).getByRole("link", { name: "Ungetypt" })).toBeTruthy();
  });

  it("behält Suche, Status, Scope und Schnellfilter für Board, Liste und Gruppenzähler", async () => {
    const zeilen = [
      pipelineDeal("d1", "Solar Beta", { dealtyp: "erstinvestment", investmentmanagerId: ICH_ID, projektleiterId: ANDERE_ID, status: "investiert" }),
      pipelineDeal("d2", "Wind Alpha", { dealtyp: "erstinvestment", investmentmanagerId: ICH_ID, projektleiterId: ANDERE_ID, status: "investiert" }),
      pipelineDeal("d3", "Solar Gamma", { dealtyp: "anschlussinvestment", investmentmanagerId: ANDERE_ID, projektleiterId: ANDERE_ID, status: "investiert" }),
    ];
    const api = spieleApi(crmDealAntworten(zeilen));
    const { router } = rendereApp(`/dealflow?gruppe=dealtyp&umfang=meine&status=investiert&fondsId=${FONDS_ID}&investmentmanagerId=${ICH_ID}&projektleiterId=${ANDERE_ID}`);
    const nutzer = userEvent.setup();
    await screen.findByRole("link", { name: "Solar Beta" });
    await nutzer.type(screen.getByRole("searchbox"), "Solar");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ suche: "Solar" }));
    expect(await screen.findByRole("link", { name: "Solar Beta" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Wind Alpha" })).toBeNull();
    expect(screen.getByRole("button", { name: "Erstinvestment 1 Deal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Anschlussinvestment 0 Deals" })).toBeTruthy();

    const filter = (boardAnfragen(api).at(-1)?.koerper as { filter: unknown }).filter;
    await nutzer.click(screen.getByRole("button", { name: "Liste" }));
    expect(await screen.findByRole("link", { name: "Solar Beta" })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("Solar");
    expect(router.state.location.search).toMatchObject({
      gruppe: "dealtyp", darstellung: "liste", umfang: "meine", status: "investiert",
      fondsId: FONDS_ID, investmentmanagerId: ICH_ID, projektleiterId: ANDERE_ID, suche: "Solar",
    });
    expect(api.anfragen("POST", "/api/v1/crm/objekte/deal/abfrage").at(-1)?.koerper).toMatchObject({ suche: "Solar", filter });
    await nutzer.click(screen.getByRole("button", { name: "Board" }));
    expect(await screen.findByRole("link", { name: "Solar Beta" })).toBeTruthy();
    expect(boardAnfragen(api).at(-1)?.koerper).toMatchObject({ suche: "Solar", filter });
  });

  it("zeigt sichtbare Deals in der Gruppe auch ohne Bearbeitungsrecht", async () => {
    spieleApi({
      ...crmDealAntworten([pipelineDeal("d1", "Nur lesbarer Deal", { dealtyp: "erstinvestment", investmentmanagerId: ICH_ID })]),
      "/api/v1/me": alsRolle("betrachter"),
      "/api/v1/dealflow/arbeitsliste": { koerper: { deals: [{ ...arbeitsdealDaten, investmentmanagerId: ICH_ID }], benutzerId: ICH_ID } },
    });
    rendereApp("/dealflow?gruppe=dealtyp&umfang=meine");
    const board = await screen.findByRole("region", { name: "Deals nach Phase · Erstinvestment" });
    expect(within(board).getByRole("link", { name: "Nur lesbarer Deal" })).toBeTruthy();
    expect(within(board).queryByRole("button", { name: /anlegen|Verschieben:/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Erstinvestment 1 Deal" })).toBeTruthy();
  });

  it("gibt bei der Schnellanlage Phase und Gruppentyp gemeinsam vor", async () => {
    const api = spieleApi({
      ...crmDealAntworten([pipelineDeal("d1", "Folgerunde", { dealtyp: "anschlussinvestment" })]),
      "POST /api/v1/deals": { status: 201, koerper: dealDetailDaten },
    });
    rendereApp("/dealflow?gruppe=dealtyp");
    const nutzer = userEvent.setup();
    const board = await screen.findByRole("region", { name: "Deals nach Phase · Anschlussinvestment" });
    expect(within(board).queryByRole("button", { name: "Deal in „Closing“ anlegen" })).toBeNull();
    await nutzer.click(within(board).getByRole("button", { name: "Deal in „Prüfung“ anlegen" }));
    const dialog = screen.getByRole("dialog", { name: "Neuer Deal" });
    expect(within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Dealtyp" }).value).toBe("anschlussinvestment");
    await nutzer.type(within(dialog).getByLabelText("Titel des Deals"), "Neue Folgerunde");
    await nutzer.click(await within(dialog).findByRole("button", { name: /^Alpha Energie/ }));
    await nutzer.click(within(dialog).getByRole("button", { name: "Deal anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/deals").at(-1)?.koerper).toMatchObject({
      phase: "pruefung", dealtyp: "anschlussinvestment",
    }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await nutzer.click(screen.getByRole("button", { name: "Ohne Dealtyp 0 Deals" }));
    const ohne = await screen.findByRole("region", { name: "Deals nach Phase · Ohne Dealtyp" });
    await nutzer.click(within(ohne).getByRole("button", { name: "Deal in „Anfrage“ anlegen" }));
    expect(within(screen.getByRole("dialog", { name: "Neuer Deal" })).getByRole<HTMLSelectElement>("combobox", { name: "Dealtyp" }).value).toBe("");
  });
});
