import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DEAL_ID, FONDS_ID, ORG_A, dealDetailDaten, fehler, rendereApp, spieleApi, zustimmung } from "../test/hilfen";

type Antwort = { status?: number; koerper: unknown };

const alsAbgelehnt = { ...zustimmung, id: "bs2", datum: "2026-10-20", ergebnis: "abgelehnt", betrag: null };

describe("Dealflow: Phase ändern", () => {
  /** Nimmt die Karte mit der Tastatur auf und legt sie zwei Spalten weiter rechts ab (Anfrage, Erstgespräch, Prüfung). */
  const verschiebe = async (nutzer: ReturnType<typeof userEvent.setup>, spalten: number) => {
    const griff = await screen.findByRole("button", { name: "Verschieben: Alpha, Wachstum" });
    griff.focus();
    await nutzer.keyboard(" ");
    for (let i = 0; i < spalten; i++) await nutzer.keyboard("{ArrowRight}");
    await nutzer.keyboard("{Enter}");
  };

  it("verschiebt die Karte sofort und stellt sie bei einem Fehler wieder her", async () => {
    let antworte: (a: Antwort) => void = () => {};
    const api = spieleApi({ [`POST /api/v1/deals/${DEAL_ID}/phase`]: () => new Promise<Antwort>((ok) => (antworte = ok)) });
    rendereApp("/dealflow");
    const nutzer = userEvent.setup();
    await verschiebe(nutzer, 2);
    // optimistisch: die Anfrage läuft noch, die Karte steht schon in der neuen Spalte
    await waitFor(() => expect(within(screen.getByRole("region", { name: /^Prüfung/ })).getByText("Alpha, Wachstum")).toBeTruthy());
    expect(within(screen.getByRole("region", { name: /^Anfrage/ })).queryByText("Alpha, Wachstum")).toBeNull();
    expect(api.anfragen("POST", `/api/v1/deals/${DEAL_ID}/phase`)[0]?.koerper).toEqual({ nachPhase: "pruefung" });

    antworte(fehler(409, "resolution_missing"));
    const meldung = await screen.findByRole("alert");
    expect(meldung.textContent).toContain("zustimmender Beschluss");
    expect(within(screen.getByRole("region", { name: /^Anfrage/ })).getByText("Alpha, Wachstum")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: /^Prüfung/ })).queryByText("Alpha, Wachstum")).toBeNull();
  });

  it("lädt nach Erfolg das Board neu, aber nicht die Fondsliste", async () => {
    let phase = "anfrage";
    const api = spieleApi({
      "POST /api/v1/crm/objekte/deal/board": () => ({
        koerper: {
          spalten: ["anfrage", "erstgespraech", "pruefung", "due_diligence", "investitionsausschuss", "closing"].map((p) => ({
            wert: p,
            anzahl: p === phase ? 1 : 0,
            summe: p === phase ? "2450000.00" : "0",
            karten: p === phase ? [{ id: DEAL_ID, titel: "Alpha, Wachstum", unternehmen: ORG_A, phase, status: "offen", ticket: "2450000.00", quelle: null, betreuung: null, aktualisiertAm: "2026-09-29" }] : [],
          })),
          bezuege: { [`organisation:${ORG_A}`]: "Alpha Energie" },
        },
      }),
      [`POST /api/v1/deals/${DEAL_ID}/phase`]: () => {
        phase = "erstgespraech";
        return { koerper: { deal: {}, phasenwechsel: {} } };
      },
    });
    rendereApp("/dealflow");
    const nutzer = userEvent.setup();
    await verschiebe(nutzer, 1);
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/crm/objekte/deal/board")).toHaveLength(2));
    expect(within(screen.getByRole("region", { name: /^Erstgespräch/ })).getByText("Alpha, Wachstum")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Deals nach Phase" })).getByRole("status").textContent).toContain("verschoben");
    expect(api.anfragen("GET", "/api/v1/fonds")).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Dealflow: Neuer Deal", () => {
  const neuerDeal = (id = DEAL_ID) => ({ status: 201, koerper: { ...dealDetailDaten, id, organisation: { id: ORG_A, name: "Alpha Energie" } } });

  it("legt einen Deal zu einer gesuchten Organisation an und öffnet ihn", async () => {
    const api = spieleApi({ "POST /api/v1/deals": () => neuerDeal() });
    const { router } = rendereApp("/dealflow");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neuer Deal" }));
    const dialog = await screen.findByRole("dialog", { name: "Neuer Deal" });

    await nutzer.type(within(dialog).getByLabelText("Titel des Deals"), "Alpha, Serie A");
    await nutzer.click(within(dialog).getByRole("button", { name: "Deal anlegen" }));
    expect(await within(dialog).findByText("Bitte eine Organisation auswählen.")).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/deals")).toHaveLength(0);

    await nutzer.type(within(dialog).getByLabelText("Organisation suchen"), "alp");
    await nutzer.click(await within(dialog).findByRole("button", { name: /^Alpha Energie/ }));
    await nutzer.type(within(dialog).getByLabelText("Ticket in Euro"), "2450000,50");
    fireEvent.change(within(dialog).getByLabelText("Eingang"), { target: { value: "2026-10-20" } });
    await nutzer.selectOptions(within(dialog).getByLabelText("Herkunft"), "sourcing");
    expect(within(dialog).getByRole("option", { name: "Ohne Dealtyp" })).toBeTruthy();
    await nutzer.selectOptions(within(dialog).getByLabelText("Dealtyp"), "anschlussinvestment");
    await nutzer.click(within(dialog).getByRole("checkbox", { name: "Mir zuweisen" }));
    await nutzer.click(within(dialog).getByRole("button", { name: "Deal anlegen" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/deals/${DEAL_ID}`));
    expect(api.anfragen("POST", "/api/v1/deals")[0]?.koerper).toEqual({ titel: "Alpha, Serie A", organisationId: ORG_A, ticket: "2450000.50", eingangsdatum: "2026-10-20", herkunft: "sourcing", dealtyp: "anschlussinvestment", selbstUebernehmen: true });
    expect(await screen.findByRole("heading", { level: 1, name: "Alpha, Wachstum" })).toBeTruthy();
  });

  it("legt mit neuer Organisation an und verlangt bei Dublette die Bestätigung", async () => {
    const kandidat = { id: ORG_A, name: "Alpha Energie", art: "unternehmen", ort: "Hamburg", score: 0.9 };
    const api = spieleApi({
      "POST /api/v1/deals": (a) =>
        (a.koerper as { dubletteBestaetigt?: boolean }).dubletteBestaetigt ? neuerDeal() : fehler(409, "possible_duplicate", { kandidaten: [kandidat] }),
    });
    const { router } = rendereApp("/dealflow");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neuer Deal" }));
    const dialog = await screen.findByRole("dialog");
    await nutzer.type(within(dialog).getByLabelText("Titel des Deals"), "Alpha, Serie A");
    fireEvent.change(within(dialog).getByLabelText("Eingang"), { target: { value: "2026-10-20" } });
    await nutzer.click(within(dialog).getByRole("button", { name: "Neue" }));
    await nutzer.type(within(dialog).getByLabelText("Name der Organisation"), "Alpha Energie GmbH");
    await nutzer.click(within(dialog).getByRole("button", { name: "Deal anlegen" }));

    await within(dialog).findByRole("button", { name: "Trotzdem neu anlegen" });
    expect(router.state.location.pathname).toBe("/dealflow");
    await nutzer.click(within(dialog).getByRole("button", { name: "Trotzdem neu anlegen" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/deals/${DEAL_ID}`));
    const [erster, zweiter] = api.anfragen("POST", "/api/v1/deals");
    expect(erster?.koerper).toEqual({ titel: "Alpha, Serie A", eingangsdatum: "2026-10-20", organisation: { name: "Alpha Energie GmbH", art: "unternehmen" } });
    expect(zweiter?.koerper).toEqual({ titel: "Alpha, Serie A", eingangsdatum: "2026-10-20", organisation: { name: "Alpha Energie GmbH", art: "unternehmen" }, dubletteBestaetigt: true });
  });
});

describe("Deal", () => {
  it("bearbeitet und leert den Dealtyp im Detail", async () => {
    const pfad = `/api/v1/deals/${DEAL_ID}`;
    let dealtyp: "erstinvestment" | "anschlussinvestment" | null = "erstinvestment";
    const api = spieleApi({
      [`GET ${pfad}`]: () => ({ koerper: { ...dealDetailDaten, dealtyp } }),
      [`PATCH ${pfad}`]: (a) => {
        ({ dealtyp } = a.koerper as { dealtyp: typeof dealtyp });
        return { koerper: { ...dealDetailDaten, dealtyp } };
      },
    });
    rendereApp(`/deals/${DEAL_ID}`);
    const nutzer = userEvent.setup();
    expect(await screen.findByText("Erstinvestment")).toBeTruthy();

    for (const [wert, label, gespeichert] of [
      ["anschlussinvestment", "Anschlussinvestment", "anschlussinvestment"],
      ["", "Ohne Dealtyp", null],
    ] as const) {
      await nutzer.click(screen.getByRole("button", { name: "Dealtyp bearbeiten" }));
      const dialog = await screen.findByRole("dialog", { name: "Dealtyp bearbeiten" });
      await nutzer.selectOptions(within(dialog).getByLabelText("Dealtyp"), wert);
      await nutzer.click(within(dialog).getByRole("button", { name: "Speichern" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Dealtyp bearbeiten" })).toBeNull());
      expect(within(screen.getByRole("region", { name: "Eckdaten" })).getByText(label)).toBeTruthy();
      expect(api.anfragen("PATCH", pfad).at(-1)?.koerper).toEqual({ dealtyp: gespeichert });
    }
  });

  it("zeigt Eckdaten, Phasenverlauf, Aktivitäten und Beschlüsse", async () => {
    spieleApi({ [`/api/v1/deals/${DEAL_ID}`]: { koerper: { ...dealDetailDaten, beschluesse: [zustimmung] } } });
    rendereApp(`/deals/${DEAL_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Alpha, Wachstum" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Alpha Energie" })).toBeTruthy();
    expect((within(screen.getByRole("region", { name: "Eckdaten" })).getByText(/2\.450\.000/).textContent ?? "").replace(/\s/g, " ")).toBe("2.450.000 €");
    const nutzer = userEvent.setup();
    await nutzer.click(within(screen.getByRole("navigation", { name: /^(Hauptnavigation|Main navigation)$/ })).getByRole("link", { name: /^Verlauf/ }));
    const verlauf = await screen.findByRole("list", { name: "Phasenverlauf" });
    expect(within(verlauf).getByText("Angelegt in der Phase Anfrage")).toBeTruthy();
    expect(within(verlauf).getByText("Anfrage nach Prüfung")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Eckdaten" })).toBeNull();
    await nutzer.click(within(screen.getByRole("navigation", { name: /^(Hauptnavigation|Main navigation)$/ })).getByRole("link", { name: /^Aktivitäten/ }));
    expect(within(await screen.findByRole("list", { name: "Aktivitäten" })).getByText("Erstes Gespräch")).toBeTruthy();
    await nutzer.click(within(screen.getByRole("navigation", { name: /^(Hauptnavigation|Main navigation)$/ })).getByRole("link", { name: /^Beschluss/ }));
    expect(within(await screen.findByRole("region", { name: "Beschlüsse" })).getByText("Investitionsausschuss")).toBeTruthy();
  });

  it("gliedert die Bereiche und öffnet alte Links mit tab und unter", async () => {
    spieleApi();
    rendereApp(`/deals/${DEAL_ID}?tab=activity&subtab=appointments`);
    expect(await screen.findByRole("heading", { level: 1, name: "Alpha, Wachstum" })).toBeTruthy();
    const verzeichnis = screen.getByRole("navigation", { name: "Hauptnavigation" });
    for (const gruppe of ["Deal", "Zusammenarbeit", "Entscheidung", "Ablage"]) expect(within(verzeichnis).getByRole("button", { name: gruppe })).toBeTruthy();
    await waitFor(() => expect(within(verzeichnis).getByRole("link", { name: /^Termine/ }).getAttribute("aria-current")).toBe("page"));
    expect(within(verzeichnis).getByRole("link", { name: /^Aktivitäten/ }).getAttribute("aria-current")).toBeNull();
    // Rückweg zum Dealflow oben in der Leiste
    expect(within(screen.getByRole("complementary", { name: "Seitenleiste" })).getAllByRole("link", { name: "Dealflow" })[0]!.getAttribute("href")).toBe("/dealflow");
    expect(screen.queryByRole("region", { name: "Eckdaten" })).toBeNull();
  });

  it("zeigt Feldfehler eines 400 beim Beschluss am Feld und schließt nach Erfolg", async () => {
    let versuch = 0;
    const api = spieleApi({
      [`POST /api/v1/deals/${DEAL_ID}/beschluesse`]: () =>
        ++versuch === 1
          ? fehler(400, "invalid_input", {
              felder: [
                { feld: "gremium", code: "too_small", meldung: "zu kurz" },
                { feld: "betrag", code: "invalid_format", meldung: "falsch" },
              ],
            })
          : { status: 201, koerper: zustimmung },
    });
    rendereApp(`/deals/${DEAL_ID}?tab=decision`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Beschluss erfassen" }));
    const dialog = await screen.findByRole("dialog", { name: "Beschluss erfassen" });
    await nutzer.type(within(dialog).getByLabelText("Beschlossener Betrag in Euro"), "abc");
    await nutzer.click(within(dialog).getByRole("button", { name: "Beschluss speichern" }));

    const gremium = within(dialog).getByLabelText("Gremium");
    await waitFor(() => expect(gremium.getAttribute("aria-invalid")).toBe("true"));
    expect(document.getElementById(gremium.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Bitte eine Angabe machen.");
    const betrag = within(dialog).getByLabelText("Beschlossener Betrag in Euro");
    expect(betrag.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(betrag.getAttribute("aria-describedby") ?? "")?.textContent).toContain("Das Format passt nicht");
    expect(within(dialog).getByRole("alert").textContent).toContain("Die Eingabe ist ungültig");
    // nicht gezeigte Felder (Datum, Ergebnis) sind nicht betroffen
    expect(within(dialog).getByLabelText("Datum").getAttribute("aria-invalid")).toBeNull();

    await nutzer.clear(within(dialog).getByLabelText("Beschlossener Betrag in Euro"));
    await nutzer.type(gremium, "Investitionsausschuss");
    await nutzer.click(within(dialog).getByRole("button", { name: "Beschluss speichern" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("POST", `/api/v1/deals/${DEAL_ID}/beschluesse`)[1]?.koerper).toMatchObject({ gremium: "Investitionsausschuss", ergebnis: "zugestimmt" });
    await waitFor(() => expect(api.anfragen("GET", `/api/v1/deals/${DEAL_ID}`)).toHaveLength(2));
  });

  it("sperrt die Übernahme ohne zustimmenden Beschluss und erklärt warum", async () => {
    spieleApi();
    rendereApp(`/deals/${DEAL_ID}`);
    const knopf = (await screen.findByRole("button", { name: "Ins Portfolio übernehmen" })) as HTMLButtonElement;
    expect(knopf.disabled).toBe(true);
    const grund = screen.getByText(/^Beschluss fehlt:/);
    expect(document.getElementById(knopf.getAttribute("aria-describedby") ?? "")?.contains(grund)).toBe(true);
    // auch Closing ist in der Phasenauswahl gesperrt
    expect((screen.getByRole("option", { name: "Closing (Beschluss fehlt)" }) as HTMLOptionElement).disabled).toBe(true);
  });

  it("sperrt die Übernahme auch, wenn der jüngste Beschluss ablehnt", async () => {
    spieleApi({ [`/api/v1/deals/${DEAL_ID}`]: { koerper: { ...dealDetailDaten, beschluesse: [alsAbgelehnt, zustimmung] } } });
    rendereApp(`/deals/${DEAL_ID}`);
    expect(((await screen.findByRole("button", { name: "Ins Portfolio übernehmen" })) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/^Beschluss fehlt:/)).toBeTruthy();
  });

  it("belegt die Übernahme aus dem Beschluss vor und führt zum Portfolio mit markierter Beteiligung", async () => {
    const api = spieleApi({
      [`/api/v1/deals/${DEAL_ID}`]: { koerper: { ...dealDetailDaten, beschluesse: [zustimmung] } },
      [`POST /api/v1/deals/${DEAL_ID}/beteiligung`]: () => ({
        status: 201,
        koerper: { beteiligung: { id: "b1", fondsId: FONDS_ID, erstinvestment: "2026-10-15" }, zusage: {}, deal: {} },
      }),
    });
    const { router } = rendereApp(`/deals/${DEAL_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Ins Portfolio übernehmen" }));
    const dialog = await screen.findByRole("dialog", { name: "Ins Portfolio übernehmen" });

    // Zusage aus dem Beschlussbetrag (2 Mio.), nicht aus dem Ticket (2,45 Mio.)
    expect((within(dialog).getByLabelText("Zusage in Euro") as HTMLInputElement).value).toBe("2000000");
    expect((within(dialog).getByLabelText("Fonds") as HTMLSelectElement).value).toBe(FONDS_ID);
    fireEvent.change(within(dialog).getByLabelText("Erstinvestment"), { target: { value: "2026-10-15" } });
    await nutzer.selectOptions(within(dialog).getByLabelText("Instrument"), "Wandeldarlehen");
    await nutzer.click(within(dialog).getByRole("button", { name: "Beteiligung anlegen" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/funds/${FONDS_ID}`));
    expect(api.anfragen("POST", `/api/v1/deals/${DEAL_ID}/beteiligung`)[0]?.koerper).toEqual({
      fondsId: FONDS_ID,
      instrument: "wandeldarlehen",
      erstinvestment: "2026-10-15",
      zusage: "2000000",
    });
    // Erstinvestment nach dem Standard-Stichtag: der Stichtag folgt, damit die Beteiligung sichtbar ist
    expect(router.state.location.search).toEqual({ hervorgehoben: "b1", stichtag: "2026-10-15" });
    const zeile = await screen.findByRole("row", { name: /Alpha Energie/ });
    expect(zeile.getAttribute("aria-current")).toBe("true");
    // Deal, Fonds und Portfolio werden neu geladen, Kontakte nicht
    expect(api.anfragen("GET", "/api/v1/organisationen")).toHaveLength(0);
  });

  it("meldet investment_exists im Dialog und verweist auf die vorhandene Beteiligung", async () => {
    spieleApi({
      [`/api/v1/deals/${DEAL_ID}`]: { koerper: { ...dealDetailDaten, beschluesse: [zustimmung] } },
      [`POST /api/v1/deals/${DEAL_ID}/beteiligung`]: () => fehler(409, "investment_exists", { beteiligungId: "b9" }),
    });
    rendereApp(`/deals/${DEAL_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Ins Portfolio übernehmen" }));
    const dialog = await screen.findByRole("dialog");
    await nutzer.click(within(dialog).getByRole("button", { name: "Beteiligung anlegen" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("hält diese Organisation bereits");
    expect(within(dialog).getByRole("link", { name: "Zur vorhandenen Beteiligung" }).getAttribute("href")).toBe("/investments/b9");
  });

  it("sagt einen Deal mit Grund ab und nimmt ihn wieder auf", async () => {
    let status = "offen";
    const api = spieleApi({
      [`/api/v1/deals/${DEAL_ID}`]: () => ({ koerper: { ...dealDetailDaten, status, absagegrund: status === "abgesagt" ? "Bewertung zu hoch" : null } }),
      [`POST /api/v1/deals/${DEAL_ID}/absage`]: () => {
        status = "abgesagt";
        return { koerper: {} };
      },
      [`POST /api/v1/deals/${DEAL_ID}/wiederaufnahme`]: () => {
        status = "offen";
        return { koerper: {} };
      },
    });
    rendereApp(`/deals/${DEAL_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Absagen" }));
    const dialog = await screen.findByRole("dialog", { name: "Deal absagen" });
    await nutzer.type(within(dialog).getByLabelText("Grund der Absage"), "Bewertung zu hoch");
    await nutzer.click(within(dialog).getByRole("button", { name: "Deal absagen" }));
    expect(await screen.findByText("Bewertung zu hoch")).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/deals/${DEAL_ID}/absage`)[0]?.koerper).toEqual({ grund: "Bewertung zu hoch" });
    expect(screen.getByText("Der Deal ist abgesagt. Zuerst wiederaufnehmen.")).toBeTruthy();

    await nutzer.click(screen.getByRole("button", { name: "Wiederaufnehmen" }));
    expect(await screen.findByRole("button", { name: "Absagen" })).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/deals/${DEAL_ID}/wiederaufnahme`)).toHaveLength(1);
  });

  it("ist auch auf Englisch vollständig", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi();
    rendereApp(`/deals/${DEAL_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Alpha, Wachstum" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move into portfolio" })).toBeTruthy();
    expect(screen.getByText("No deal type")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit deal type" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
    expect(screen.getByText(/^Decision missing:/)).toBeTruthy();
    await userEvent.setup().click(within(screen.getByRole("navigation", { name: /^(Hauptnavigation|Main navigation)$/ })).getByRole("link", { name: /^History/ }));
    expect(await screen.findByRole("list", { name: "Stage history" })).toBeTruthy();
    expect(screen.getByText("Created in stage Enquiry")).toBeTruthy();
  });
});
