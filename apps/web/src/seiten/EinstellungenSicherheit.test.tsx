import { waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fehler, rendereApp, spieleApi, letzteRegion } from "../test/hilfen";
import { geraetAus } from "../lib/geraet";

const SICHERHEIT = "/api/v1/account/security";
const SITZUNGEN = "/api/v1/account/sessions";
const PASSWORT = "/api/v1/account/password";

const uebersicht = { passwortVorhanden: true, passwortGeaendertAm: "2026-10-01T08:00:00.000Z", anbieter: [], zweiFaktorAktiv: true, zweiFaktorPflicht: true, codesUebrig: 7, sitzungenAnzahl: 2 };
const sitzungen = [
  { id: "00000000-0000-4000-8000-0000000000a1", aktuell: true, erstelltAm: "2026-11-24T08:00:00.000Z", zuletztAktivAm: "2026-11-24T09:00:00.000Z", laeuftAbAm: "2026-11-24T20:00:00.000Z", ip: "192.0.2.1", geraet: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15" },
  { id: "00000000-0000-4000-8000-0000000000a2", aktuell: false, erstelltAm: "2026-11-23T08:00:00.000Z", zuletztAktivAm: "2026-11-23T09:00:00.000Z", laeuftAbAm: "2026-11-24T19:00:00.000Z", ip: null, geraet: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36" },
];
const grundlage = { [SICHERHEIT]: { koerper: uebersicht }, [SITZUNGEN]: { koerper: sitzungen } };

describe("Einstellungen: Reiter Sicherheit", () => {
  it("zeigt Kennwerte, Sitzungen mit Gerät und markiert die aktuelle", async () => {
    spieleApi(grundlage);
    rendereApp("/settings/mailbox?tab=security");
    const uebersichtKarte = within(await letzteRegion("Übersicht"));
    expect(await uebersichtKarte.findByText("7 Codes übrig")).toBeTruthy();
    expect(uebersichtKarte.getByText("Aktiv")).toBeTruthy();
    const tabelle = within(await letzteRegion("Aktive Anmeldungen"));
    expect(await tabelle.findByText(/Safari auf macOS/)).toBeTruthy();
    expect(tabelle.getByText(/Chrome auf Windows/)).toBeTruthy();
    expect(tabelle.getByText("Diese Anmeldung")).toBeTruthy();
    // Nur die andere Sitzung lässt sich beenden.
    expect(tabelle.getAllByRole("button", { name: /Anmeldung beenden:/ })).toHaveLength(1);
  });

  it("beendet eine einzelne Anmeldung erst nach Bestätigung", async () => {
    const nutzer = userEvent.setup();
    const api = spieleApi({ ...grundlage, [`DELETE ${SITZUNGEN}/${sitzungen[1]!.id}`]: { status: 204, koerper: null } });
    rendereApp("/settings/mailbox?tab=security");
    const karte = within(await letzteRegion("Aktive Anmeldungen"));
    await nutzer.click(await karte.findByRole("button", { name: "Anmeldung beenden: Chrome auf Windows" }));
    expect(api.anfragen("DELETE", `${SITZUNGEN}/${sitzungen[1]!.id}`)).toHaveLength(0);
    await nutzer.click(karte.getByRole("button", { name: "Anmeldung beenden: Chrome auf Windows" }));
    await waitFor(() => expect(api.anfragen("DELETE", `${SITZUNGEN}/${sitzungen[1]!.id}`)).toHaveLength(1));
  });

  it("ändert das Passwort mit aktuellem Passwort und Option für andere Anmeldungen; prüft Länge und Wiederholung vor dem Senden", async () => {
    const nutzer = userEvent.setup();
    const api = spieleApi({ ...grundlage, [`POST ${PASSWORT}`]: { koerper: { ok: true, andereSitzungenBeendet: 1 } } });
    rendereApp("/settings/mailbox?tab=security");
    const karte = within(await letzteRegion("Passwort ändern"));
    fireEvent.change(await karte.findByLabelText("Aktuelles Passwort"), { target: { value: "alt-alt-alt-alt-1" } });
    fireEvent.change(karte.getByLabelText("Neues Passwort"), { target: { value: "kurz" } });
    fireEvent.change(karte.getByLabelText("Neues Passwort wiederholen"), { target: { value: "anders" } });
    await nutzer.click(karte.getByRole("button", { name: "Passwort speichern" }));
    expect(await karte.findByText(/braucht mindestens 12 Zeichen/)).toBeTruthy();
    expect(karte.getByText("Die beiden Eingaben stimmen nicht überein.")).toBeTruthy();
    expect(api.anfragen("POST", PASSWORT)).toHaveLength(0);

    fireEvent.change(karte.getByLabelText("Neues Passwort"), { target: { value: "neues-Passwort-2026" } });
    fireEvent.change(karte.getByLabelText("Neues Passwort wiederholen"), { target: { value: "neues-Passwort-2026" } });
    await nutzer.click(karte.getByRole("checkbox", { name: /alle anderen Anmeldungen beenden/ }));
    await nutzer.click(karte.getByRole("button", { name: "Passwort speichern" }));
    await waitFor(() => expect(api.anfragen("POST", PASSWORT)).toHaveLength(1));
    expect(api.anfragen("POST", PASSWORT)[0]!.koerper).toEqual({ currentPassword: "alt-alt-alt-alt-1", newPassword: "neues-Passwort-2026", endOtherSessions: false }); // gitleaks:allow
    expect(await karte.findByText("Das Passwort ist geändert, 1 andere Anmeldung wurde beendet.")).toBeTruthy();
    expect((karte.getByLabelText("Aktuelles Passwort") as HTMLInputElement).value).toBe("");
  });

  it("zeigt ein falsches aktuelles Passwort als Fehler", async () => {
    const nutzer = userEvent.setup();
    spieleApi({ ...grundlage, [`POST ${PASSWORT}`]: fehler(400, "password_incorrect") });
    rendereApp("/settings/mailbox?tab=security");
    const karte = within(await letzteRegion("Passwort ändern"));
    fireEvent.change(await karte.findByLabelText("Aktuelles Passwort"), { target: { value: "falsch" } });
    fireEvent.change(karte.getByLabelText("Neues Passwort"), { target: { value: "neues-Passwort-2026" } });
    fireEvent.change(karte.getByLabelText("Neues Passwort wiederholen"), { target: { value: "neues-Passwort-2026" } });
    await nutzer.click(karte.getByRole("button", { name: "Passwort speichern" }));
    expect(await karte.findByText("Das aktuelle Passwort ist nicht richtig.")).toBeTruthy();
  });

  it("Wiederherstellungscodes erneuern: Passwort wird mitgesendet, die neuen Codes erscheinen einmal", async () => {
    const nutzer = userEvent.setup();
    const api = spieleApi({ ...grundlage, [`POST /api/v1/account/recovery-codes`]: { koerper: { backupCodes: ["aaaaa-11111", "bbbbb-22222"] } } });
    rendereApp("/settings/mailbox?tab=security");
    const karte = within(await letzteRegion("Zweiter Faktor"));
    await nutzer.click(await karte.findByRole("button", { name: "Wiederherstellungscodes erneuern" }));
    fireEvent.change(karte.getByLabelText("Aktuelles Passwort"), { target: { value: "geheim-geheim-1" } });
    await nutzer.click(karte.getByRole("button", { name: "Neue Codes erzeugen" }));
    expect(await karte.findByText("aaaaa-11111")).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/account/recovery-codes")[0]!.koerper).toEqual({ password: "geheim-geheim-1" });
  });

  it("Neu einrichten: Passwort, dann QR-Code und Codes; Bestätigen erst nach dem Sichern der Codes und mit Code", async () => {
    const nutzer = userEvent.setup();
    const api = spieleApi({
      ...grundlage,
      "POST /api/v1/account/two-factor/restart": { koerper: { totpURI: "otpauth://totp/Carraway:a%40b.example?secret=ABCDEFGH&issuer=Carraway", backupCodes: ["aaaaa-11111"], ablaufSekunden: 900 } },
      "POST /api/v1/account/two-factor/restart/confirm": { koerper: { ok: true, andereSitzungenBeendet: 0 } },
    });
    rendereApp("/settings/mailbox?tab=security");
    const karte = within(await letzteRegion("Zweiter Faktor"));
    await nutzer.click(await karte.findByRole("button", { name: "Neu einrichten" }));
    fireEvent.change(karte.getByLabelText("Aktuelles Passwort"), { target: { value: "geheim-geheim-1" } });
    await nutzer.click(karte.getByRole("button", { name: "Weiter" }));
    expect(await karte.findByText("aaaaa-11111")).toBeTruthy();
    expect(karte.getByText(/ABCD EFGH/)).toBeTruthy();
    await nutzer.type(karte.getByLabelText("Ziffer 1 von 6"), "123456");
    const bestaetigen = karte.getByRole("button", { name: "Bestätigen und aktivieren" });
    expect(bestaetigen.matches(":disabled")).toBe(true);
    await nutzer.click(karte.getByRole("checkbox", { name: /Codes sicher abgelegt/ }));
    await nutzer.click(bestaetigen);
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/account/two-factor/restart/confirm")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/account/two-factor/restart/confirm")[0]!.koerper).toEqual({ code: "123456", endOtherSessions: false });
    expect(await karte.findByText("Der zweite Faktor ist eingerichtet.")).toBeTruthy();
  });

  it("ohne Passwort-Zugang entfallen die Passwortabfragen", async () => {
    spieleApi({ ...grundlage, [SICHERHEIT]: { koerper: { ...uebersicht, passwortVorhanden: false, passwortGeaendertAm: null, anbieter: ["google"] } } });
    rendereApp("/settings/mailbox?tab=security");
    expect(await within(await letzteRegion("Passwort ändern")).findByText(/kein Passwort/)).toBeTruthy();
  });
});

describe("Gerät aus dem User-Agent", () => {
  it("erkennt gängige Browser und Systeme, sonst nichts", () => {
    expect(geraetAus("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1")).toEqual({ browser: "Safari", system: "iOS" });
    expect(geraetAus("Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0")).toEqual({ browser: "Firefox", system: "Linux" });
    expect(geraetAus("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120")).toEqual({ browser: "Edge", system: "Windows" });
    expect(geraetAus(null)).toBeNull();
    expect(geraetAus("curl/8")).toBeNull();
  });
});
