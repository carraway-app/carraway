import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BEWEGUNG_OFFEN_ID, BET_ID, FONDS_ID, ICH_ID, ORG_A, aktivitaetDaten, alsRolle, bewegungenDaten, fehler, ichDaten, rendereApp, spieleApi } from "../test/hilfen";
import { navigation } from "../lib/navigation";
import { de } from "../i18n/de";
import { en } from "../i18n/en";

/** Mail und Kalender in der Oberfläche (Etappe 17), in beiden Sprachen: Einstellungen, Verlauf, nächste Termine, Dialoge, Verwaltung. Alle Daten sind erfunden. */

const dialog = () => within(screen.getByRole("dialog"));
afterEach(() => vi.restoreAllMocks());

const einstellungen = (extra: Record<string, unknown> = {}) => ({ sprache: "de", mailBerichtFreigegeben: false, mailRegisterEreignis: false, mailVerfuegbar: true, ...extra });
const verbindung = (extra: Record<string, unknown> = {}) => ({
  id: "v1",
  bereich: "mail",
  anbieter: "microsoft",
  adresse: "vera@fonds.example.org",
  status: "verbunden",
  letzterFehler: null,
  letzterAbgleichAm: "2026-11-20T08:30:00.000Z",
  inhaltSpeichern: false,
  erstelltAm: "2026-11-01T08:00:00.000Z",
  ...extra,
});
const postfach = (verbindungen: unknown[] = [], extra: Record<string, unknown> = {}) => ({ anbieter: { microsoft: true, google: false, imap: true }, schluesselVorhanden: true, verbindungen, ...extra });

const einstellungenApi = (abweichend: Parameters<typeof spieleApi>[0] = {}) =>
  spieleApi({
    "/api/v1/me": alsRolle("bearbeiter"),
    "/api/v1/postfach": { koerper: postfach() },
    "/api/v1/settings": { koerper: einstellungen() },
    "/api/v1/settings/calendar-link": { koerper: { aktiv: false, erstelltAm: null, letzterZugriffAm: null } },
    ...abweichend,
  });
const zuEnglisch = () => localStorage.setItem("carraway.sprache", "en");

describe("Einstellungen: Postfach und Kalender", () => {
  it("zeigt die Datenschutzhinweise; Verbinden geht erst nach der Zustimmung und führt zur Anbieterseite (OAuth)", async () => {
    const weiter = vi.spyOn(navigation, "zu").mockImplementation(() => {});
    const api = einstellungenApi({ "POST /api/v1/postfach/oauth/start": { koerper: { url: "https://login.example.org/authorize?x=1" } } });
    rendereApp("/einstellungen/postfach?tab=postfach");
    const nutzer = userEvent.setup();
    expect(await screen.findByRole("heading", { level: 1, name: de.nav.einstellungen })).toBeTruthy();
    expect(screen.getByText(de.mail.einstellungen.postfach.datenschutz.punkte[0]!)).toBeTruthy();
    expect(screen.getByText(/für alle sichtbar, die den verknüpften Kontakt oder Deal sehen dürfen/)).toBeTruthy();
    const knopf = await screen.findByRole("button", { name: "Postfach mit Microsoft 365 verbinden" });
    expect((knopf as HTMLButtonElement).disabled).toBe(true);
    // Google ist in dieser Installation nicht eingerichtet, IMAP schon.
    expect(screen.queryByRole("button", { name: /Google/ })).toBeNull();
    await nutzer.click(screen.getByLabelText(de.mail.einstellungen.postfach.zustimmung));
    expect((knopf as HTMLButtonElement).disabled).toBe(false);
    await nutzer.click(knopf);
    await waitFor(() => expect(weiter).toHaveBeenCalledWith("https://login.example.org/authorize?x=1"));
    expect(api.anfragen("POST", "/api/v1/postfach/oauth/start")[0]!.koerper).toEqual({ anbieter: "microsoft", bereich: "mail", zustimmung: true });
    await nutzer.click(screen.getByRole("button", { name: "Kalender mit Microsoft 365 verbinden" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/postfach/oauth/start")).toHaveLength(2));
    expect(api.anfragen("POST", "/api/v1/postfach/oauth/start")[1]!.koerper).toEqual({ anbieter: "microsoft", bereich: "kalender", zustimmung: true });
  });

  it("ohne Schlüssel oder ohne Anbieter bleibt Verbinden aus und die Seite erklärt warum", async () => {
    einstellungenApi({ "/api/v1/postfach": { koerper: postfach([], { schluesselVorhanden: false, anbieter: { microsoft: false, google: false, imap: false } }) } });
    rendereApp("/einstellungen/postfach?tab=postfach");
    expect(await screen.findByText(de.mail.einstellungen.postfach.schluesselFehlt)).toBeTruthy();
    expect(screen.getByText(de.mail.einstellungen.postfach.keinAnbieter)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /verbinden/ })).toBeNull();
  });

  it("zeigt verbundene Konten mit Status, letztem Abgleich und Fehler; Textauszug, Abgleich anfordern und Trennen mit Bestätigung", async () => {
    const api = einstellungenApi({
      "/api/v1/postfach": { koerper: postfach([verbindung({ status: "fehler", letzterFehler: "ANBIETER_NICHT_ERREICHBAR" }), verbindung({ id: "v2", bereich: "kalender", anbieter: "google", adresse: "vera@gmail.example.com", status: "erneut_anmelden", letzterFehler: "ZUGANG_UNGUELTIG", letzterAbgleichAm: null })]) },
      "PATCH /api/v1/postfach/v1": { koerper: verbindung({ inhaltSpeichern: true }) },
      "POST /api/v1/postfach/v1/abgleichen": { status: 202, koerper: { angefordert: true } },
      "DELETE /api/v1/postfach/v2": { status: 204, koerper: null },
    });
    rendereApp("/einstellungen/postfach?tab=postfach");
    const nutzer = userEvent.setup();
    expect(await screen.findByText("Microsoft 365, vera@fonds.example.org")).toBeTruthy();
    expect(screen.getByText("Fehler, wird erneut versucht")).toBeTruthy();
    expect(screen.getByText(/Der Anbieter war nicht erreichbar\. \(Fehlercode ANBIETER_NICHT_ERREICHBAR\)/)).toBeTruthy();
    expect(screen.getByText("Google, vera@gmail.example.com")).toBeTruthy();
    expect(screen.getByText("Bitte neu verbinden")).toBeTruthy();
    expect(screen.getByText(/Letzter Abgleich: noch nie/)).toBeTruthy();
    // Kein Zugang, kein Token irgendwo auf der Seite
    expect(document.body.textContent).not.toMatch(/token|passwort/i);

    await nutzer.click(screen.getByLabelText(de.mail.einstellungen.postfach.inhalt));
    await waitFor(() => expect(api.anfragen("PATCH", "/api/v1/postfach/v1")[0]!.koerper).toEqual({ inhaltSpeichern: true }));
    await nutzer.click(screen.getByRole("button", { name: "Jetzt abgleichen: Postfach" }));
    expect(await screen.findByText(de.mail.einstellungen.postfach.abgleichAngefordert)).toBeTruthy();

    await nutzer.click(screen.getByRole("button", { name: "Kalender trennen" }));
    expect(dialog().getByText(de.mail.einstellungen.postfach.trennenHinweis)).toBeTruthy();
    await nutzer.click(dialog().getByRole("button", { name: "Trennen" }));
    await waitFor(() => expect(api.anfragen("DELETE", "/api/v1/postfach/v2")).toHaveLength(1));
  });

  it("IMAP: Formular sendet Zugang, Ordner als Liste und die Zustimmung; ein Fehler erscheint übersetzt im Dialog", async () => {
    const api = einstellungenApi({ "POST /api/v1/postfach/imap": fehler(502, "mailbox_connection_failed") });
    rendereApp("/einstellungen/postfach?tab=postfach");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByLabelText(de.mail.einstellungen.postfach.zustimmung));
    await nutzer.click(screen.getByRole("button", { name: "Postfach mit IMAP verbinden" }));
    const d = dialog();
    await nutzer.type(d.getByLabelText("Server"), "imap.example.org");
    await nutzer.type(d.getByLabelText("Benutzername"), "vera");
    await nutzer.type(d.getByLabelText("Passwort"), "geheim-nur-test");
    await nutzer.type(d.getByLabelText("Mailadresse des Postfachs"), "vera@fonds.example.org");
    await nutzer.clear(d.getByLabelText(/Ordner, kommagetrennt/));
    await nutzer.type(d.getByLabelText(/Ordner, kommagetrennt/), "INBOX, Gesendet");
    await nutzer.click(d.getByRole("button", { name: "IMAP verbinden" }));
    expect(await d.findByText(de.mail.fehler.mailbox_connection_failed!)).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/postfach/imap")[0]!.koerper).toEqual({
      host: "imap.example.org",
      port: 993,
      sicherheit: "tls",
      benutzer: "vera",
      passwort: "geheim-nur-test",
      adresse: "vera@fonds.example.org",
      ordner: ["INBOX", "Gesendet"],
      inhaltSpeichern: false,
      zustimmung: true,
    });
  });

  it("Rückkehr vom Anbieter: Erfolg und Fehlercodes stehen als Meldung, nie Tokens", async () => {
    einstellungenApi();
    rendereApp("/einstellungen/postfach?ergebnis=verbunden&bereich=kalender");
    expect(await screen.findByText("Kalender verbunden.")).toBeTruthy();
  });
  it("Rückkehr mit abgelaufenem Vorgang zeigt den Hinweis zum Neustart", async () => {
    einstellungenApi();
    rendereApp("/einstellungen/postfach?fehler=mailbox_state_invalid");
    expect(await screen.findByText(de.mail.einstellungen.postfach.rueckkehr.zustand)).toBeTruthy();
  });

  it("Kalenderabonnement: Link erzeugen und einmalig kopieren, ersetzen, widerrufen", async () => {
    const link = { token: "K".repeat(43), pfad: `/api/v1/kalender/${"K".repeat(43)}.ics`, url: `https://fonds.example.org/api/v1/kalender/${"K".repeat(43)}.ics` };
    let aktiv = false;
    const api = einstellungenApi({
      "/api/v1/settings/calendar-link": () => ({ koerper: { aktiv, erstelltAm: aktiv ? "2026-11-20T08:00:00.000Z" : null, letzterZugriffAm: null } }),
      "POST /api/v1/settings/calendar-link": () => {
        aktiv = true;
        return { status: 201, koerper: link };
      },
      "DELETE /api/v1/settings/calendar-link": () => {
        aktiv = false;
        return { status: 204, koerper: null };
      },
    });
    rendereApp("/einstellungen/postfach?tab=kalender");
    const nutzer = userEvent.setup();
    expect(await screen.findByText(de.mail.einstellungen.kalender.inaktiv)).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Link erzeugen" }));
    const feld = (await screen.findByLabelText("Link")) as HTMLInputElement;
    expect(feld.value).toBe(link.url);
    expect(screen.getByText(/Der Link wird nur jetzt angezeigt/)).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "In die Zwischenablage kopieren" }));
    expect(await screen.findByText("Kopiert.")).toBeTruthy();
    expect(await navigator.clipboard.readText()).toBe(link.url);
    await nutzer.keyboard("{Escape}");
    expect(await screen.findByText(de.mail.einstellungen.kalender.aktiv)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Neuen Link erzeugen" })).toBeTruthy();
    expect(screen.getByText(de.mail.einstellungen.kalender.ersetzenHinweis)).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Link widerrufen" }));
    await waitFor(() => expect(api.anfragen("DELETE", "/api/v1/settings/calendar-link")).toHaveLength(1));
    expect(await screen.findByText(de.mail.einstellungen.kalender.inaktiv)).toBeTruthy();
  });

  it("Mails von Carraway: Sprache und Opt-in für Berichtsfreigaben werden gespeichert; ohne Versand erscheint ein Hinweis", async () => {
    let stand = einstellungen({ mailVerfuegbar: false });
    const api = einstellungenApi({
      "/api/v1/settings": () => ({ koerper: stand }),
      "PUT /api/v1/settings": (a) => {
        const k = a.koerper as { language?: "de" | "en"; mailOnReportApproved?: boolean; mailOnRegisterEvent?: boolean };
        stand = {
          ...stand,
          ...(k.language ? { sprache: k.language } : {}),
          ...(k.mailOnReportApproved === undefined ? {} : { mailBerichtFreigegeben: k.mailOnReportApproved }),
          ...(k.mailOnRegisterEvent === undefined ? {} : { mailRegisterEreignis: k.mailOnRegisterEvent }),
        };
        return { koerper: stand };
      },
    });
    rendereApp("/einstellungen/postfach");
    const nutzer = userEvent.setup();
    expect(await screen.findByText(de.mail.einstellungen.mails.nichtVerfuegbar)).toBeTruthy();
    await nutzer.click(screen.getByLabelText(de.mail.einstellungen.mails.berichtOptIn));
    await waitFor(() => expect(api.anfragen("PUT", "/api/v1/settings")[0]!.koerper).toEqual({ mailOnReportApproved: true }));
    expect(await screen.findByText("Gespeichert.")).toBeTruthy();
    const gruppe = within(screen.getByRole("group", { name: de.mail.einstellungen.mails.sprache }));
    await nutzer.click(gruppe.getByRole("button", { name: "Englisch" }));
    await waitFor(() => expect(api.anfragen("PUT", "/api/v1/settings")[1]!.koerper).toEqual({ language: "en" }));
  });

  it("auf Englisch: alle Texte der Seite sind übersetzt (Titel, Hinweise, Knöpfe, Meldungen)", async () => {
    zuEnglisch();
    const api = einstellungenApi({ "POST /api/v1/postfach/oauth/start": fehler(409, "mailbox_provider_disabled") });
    rendereApp("/einstellungen/postfach?ergebnis=verbunden&bereich=mail");
    const nutzer = userEvent.setup();
    expect(await screen.findByRole("heading", { level: 1, name: en.nav.einstellungen })).toBeTruthy();
    expect(screen.getByText("Mailbox connected.")).toBeTruthy();
    expect(screen.getByText(en.mail.einstellungen.postfach.datenschutz.punkte[1]!)).toBeTruthy();
    await nutzer.click(screen.getByLabelText(en.mail.einstellungen.postfach.zustimmung));
    await nutzer.click(await screen.findByRole("button", { name: "Connect mailbox with Microsoft 365" }));
    expect(await screen.findByText(en.mail.fehler.mailbox_provider_disabled!)).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/postfach/oauth/start")).toHaveLength(1);
    await nutzer.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(await screen.findByRole("button", { name: "Create link" })).toBeTruthy();
  });
});

const syncMail = (extra: Record<string, unknown> = {}, sync: Record<string, unknown> = {}) => ({
  ...aktivitaetDaten,
  id: "m1",
  art: "mail",
  datum: "2026-11-18",
  titel: "Rückfrage zum Finanzierungsstand",
  notiz: null,
  wiedervorlage: null,
  sync: { anbieter: "microsoft", beginn: "2026-11-18T10:15:00.000Z", ende: null, richtung: "eingehend", eigene: true, ...sync },
  ...extra,
});
const syncTermin = (extra: Record<string, unknown> = {}, sync: Record<string, unknown> = {}) => ({
  ...aktivitaetDaten,
  id: "t1",
  art: "termin",
  datum: "2026-11-25",
  titel: "Quartalsgespräch",
  notiz: null,
  wiedervorlage: null,
  sync: { anbieter: "google", beginn: "2026-11-25T09:00:00.000Z", ende: "2026-11-25T10:00:00.000Z", richtung: null, eigene: false, ...sync },
  ...extra,
});
const termin = (extra: Record<string, unknown> = {}) => ({
  id: "t1",
  titel: "Quartalsgespräch",
  datum: "2026-11-25",
  beginn: "2026-11-25T09:00:00.000Z",
  ende: "2026-11-25T10:00:00.000Z",
  anbieter: "microsoft",
  eigene: true,
  organisation: { id: ORG_A, name: "Alpha Energie" },
  person: null,
  deal: { id: "d1", titel: "Alpha, Wachstum" },
  ...extra,
});

describe("Verlauf mit Mails und Terminen", () => {
  it("zeigt Art, Anbieter (als Text, ohne Markenzeichen), Richtung und Herkunft; Entfernen nur bei den eigenen, mit Bestätigung", async () => {
    const api = spieleApi({
      "/api/v1/me": alsRolle("bearbeiter"),
      "/api/v1/aktivitaeten": { koerper: { daten: [syncMail(), syncTermin(), aktivitaetDaten] } },
      "POST /api/v1/aktivitaeten/m1/sync-entfernen": { status: 204, koerper: null },
    });
    rendereApp(`/organisationen/${ORG_A}?tab=aktivitaet`);
    const nutzer = userEvent.setup();
    const liste = within(await screen.findByRole("list", { name: "Aktivitäten" }));
    const mail = within(liste.getByText("Rückfrage zum Finanzierungsstand").closest("li") as HTMLElement);
    expect(mail.getByText("Mail")).toBeTruthy();
    expect(mail.getByText("Microsoft 365")).toBeTruthy();
    expect(mail.getByText("eingehend")).toBeTruthy();
    expect(mail.getByText(/aus Ihr Konto/)).toBeTruthy();
    const kalender = within(liste.getByText("Quartalsgespräch").closest("li") as HTMLElement);
    expect(kalender.getByText("Google")).toBeTruthy();
    expect(kalender.getByText(/aus Konto einer anderen Person/)).toBeTruthy();
    expect(kalender.getByText(/ bis /)).toBeTruthy();
    expect(kalender.queryByRole("button", { name: /entfernen/ })).toBeNull(); // nicht der eigene Termin
    // handgeschriebene Einträge haben weder Anbieter noch Entfernen
    expect(within(liste.getByText("Erstes Gespräch").closest("li") as HTMLElement).queryByRole("button", { name: /entfernen/ })).toBeNull();

    await nutzer.click(mail.getByRole("button", { name: "„Rückfrage zum Finanzierungsstand“ aus dem Verlauf entfernen" }));
    expect(dialog().getByText(/wird gelöscht und beim nächsten Abgleich nicht wieder übernommen/)).toBeTruthy();
    await nutzer.click(dialog().getByRole("button", { name: "Entfernen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/aktivitaeten/m1/sync-entfernen")).toHaveLength(1));
  });

  it("auf Englisch: Richtung, Herkunft und Dialog sind übersetzt", async () => {
    zuEnglisch();
    spieleApi({ "/api/v1/me": alsRolle("bearbeiter"), "/api/v1/aktivitaeten": { koerper: { daten: [syncMail()] } } });
    rendereApp(`/organisationen/${ORG_A}?tab=aktivitaet`);
    const nutzer = userEvent.setup();
    const liste = within(await screen.findByRole("list", { name: "Activities" }));
    expect(liste.getByText("incoming")).toBeTruthy();
    expect(liste.getByText(/from your account/)).toBeTruthy();
    await nutzer.click(liste.getByRole("button", { name: "Remove “Rückfrage zum Finanzierungsstand” from the timeline" }));
    expect(dialog().getByText(/will be deleted and not imported again at the next sync/)).toBeTruthy();
  });

  it("Betrachter dürfen eigene synchronisierte Einträge ebenfalls entfernen (es sind ihre Daten)", async () => {
    spieleApi({ "/api/v1/me": alsRolle("betrachter"), "/api/v1/aktivitaeten": { koerper: { daten: [syncMail()] } } });
    rendereApp(`/organisationen/${ORG_A}?tab=aktivitaet`);
    expect(await screen.findByRole("button", { name: /aus dem Verlauf entfernen/ })).toBeTruthy();
  });
});

describe("Anhänge auf Klick", () => {
  it("die Liste kommt erst beim Öffnen; übernommen wird nur, was einzeln angeklickt wird; danach der Link zum Dokument", async () => {
    const api = spieleApi({
      "/api/v1/me": alsRolle("bearbeiter"),
      "/api/v1/aktivitaeten": { koerper: { daten: [syncMail()] } },
      "/api/v1/aktivitaeten/m1/anhaenge": { koerper: { daten: [{ id: "att-1", name: "Vertrag.pdf", groesse: 20480, typ: "application/pdf" }] } },
      "POST /api/v1/aktivitaeten/m1/anhaenge/att-1/importieren": { status: 201, koerper: { dokumentId: "doc-1", dateiname: "Vertrag.pdf" } },
    });
    rendereApp(`/organisationen/${ORG_A}?tab=aktivitaet`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Anhänge von „Rückfrage zum Finanzierungsstand“ anzeigen" }));
    expect(api.anfragen("GET", "/api/v1/aktivitaeten/m1/anhaenge")).toHaveLength(1);
    expect(dialog().getByText(de.mail.anhaenge.hinweis)).toBeTruthy();
    expect(await dialog().findByText("Vertrag.pdf")).toBeTruthy();
    expect(dialog().getByText("20 KB")).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/aktivitaeten/m1/anhaenge/att-1/importieren")).toHaveLength(0);
    await nutzer.click(dialog().getByRole("button", { name: "In Dokumente übernehmen: „Vertrag.pdf“" }));
    expect(await dialog().findByText("Übernommen")).toBeTruthy();
    expect(dialog().getByRole("link", { name: "Zum Dokument" }).getAttribute("href")).toBe("/dokumente/doc-1");
  });

  it("kein Anhänge-Knopf bei Termine, IMAP oder Mails anderer Personen; Fehler des Anbieters erscheinen übersetzt", async () => {
    spieleApi({
      "/api/v1/me": alsRolle("bearbeiter"),
      "/api/v1/aktivitaeten": { koerper: { daten: [syncMail({ id: "m2", titel: "IMAP-Mail" }, { anbieter: "imap" }), syncMail({ id: "m3", titel: "Fremde Mail" }, { eigene: false }), syncMail({ id: "m4", titel: "Meine Mail" })] } },
      "/api/v1/aktivitaeten/m4/anhaenge": fehler(409, "mailbox_access_expired"),
    });
    rendereApp(`/organisationen/${ORG_A}?tab=aktivitaet`);
    const nutzer = userEvent.setup();
    await screen.findByText("Meine Mail");
    expect(screen.getAllByRole("button", { name: /Anhänge von/ })).toHaveLength(1);
    await nutzer.click(screen.getByRole("button", { name: "Anhänge von „Meine Mail“ anzeigen" }));
    expect(await dialog().findByText(de.mail.fehler.mailbox_access_expired!)).toBeTruthy();
  });

  it("auf Englisch", async () => {
    zuEnglisch();
    spieleApi({ "/api/v1/me": alsRolle("bearbeiter"), "/api/v1/aktivitaeten": { koerper: { daten: [syncMail()] } }, "/api/v1/aktivitaeten/m1/anhaenge": { koerper: { daten: [] } } });
    rendereApp(`/organisationen/${ORG_A}?tab=aktivitaet`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Show attachments of “Rückfrage zum Finanzierungsstand”" }));
    expect(await dialog().findByText(en.mail.anhaenge.keine)).toBeTruthy();
  });
});

describe("Nächste Termine", () => {
  it("Organisationsseite: Termine der Organisation, Fehler der API lassen die Kachel einfach weg", async () => {
    const api = spieleApi({ "/api/v1/termine": { koerper: { daten: [termin()] } } });
    rendereApp(`/organisationen/${ORG_A}?tab=aktivitaet&unter=termine`);
    const kachel = within(await screen.findByRole("region", { name: /Nächste Termine/ }));
    expect(await kachel.findByText("Quartalsgespräch")).toBeTruthy();
    expect(kachel.getByText("Microsoft 365")).toBeTruthy();
    expect(api.anfragen("GET", "/api/v1/termine")[0]!.query.get("organisationId")).toBe(ORG_A);
  });

  it("Kontakte-Seite (Reiter Heute): nur die eigenen Termine, mit Bezug zu Deal oder Organisation; ohne Termine ein Hinweis", async () => {
    const api = spieleApi({ "/api/v1/termine": { koerper: { daten: [termin()] } } });
    rendereApp("/kontakte?objekt=heute");
    const kachel = within(await screen.findByRole("region", { name: /Nächste Termine/ }));
    expect(await kachel.findByRole("link", { name: "Alpha, Wachstum" })).toBeTruthy();
    expect(api.anfragen("GET", "/api/v1/termine")[0]!.query.get("eigene")).toBe("true");
  });

  it("Alter Terminlink führt zu den eigenen kommenden Terminen bei Kontakte", async () => {
    const api = spieleApi({ "/api/v1/termine": { koerper: { daten: [termin({ titel: "Besuch vor Ort" })] } } });
    rendereApp(`/fonds/${FONDS_ID}?tab=termine`);
    const kachel = within(await screen.findByRole("region", { name: /Nächste Termine/ }));
    expect(await kachel.findByText("Besuch vor Ort")).toBeTruthy();
    expect(kachel.getByRole("link", { name: "Alpha, Wachstum" })).toBeTruthy();
    expect(api.anfragen("GET", "/api/v1/termine")[0]!.query.get("eigene")).toBe("true");
  });

  it("zeigt bei leerer Liste den Hinweis und bei einem Fehler nichts", async () => {
    spieleApi();
    const { unmount } = rendereApp(`/organisationen/${ORG_A}?tab=aktivitaet&unter=termine`);
    expect(await screen.findByText(de.mail.termine.keine)).toBeTruthy();
    unmount();
    spieleApi({ "/api/v1/termine": fehler(403, "forbidden") });
    rendereApp(`/organisationen/${ORG_A}?tab=aktivitaet&unter=termine`);
    expect((await screen.findByRole("button", { name: "Termine" })).getAttribute("aria-current")).toBe("page");
    await waitFor(() => expect(screen.queryByText(de.mail.termine.keine)).toBeNull());
  });
});

const uebersichtPfad = `/api/v1/fonds/${FONDS_ID}/kennzahlen/uebersicht`;
const UMSATZ = {
  id: "d-umsatz",
  schluessel: "umsatz",
  katalogVersion: 1,
  bezeichnungDe: "Umsatz",
  bezeichnungEn: "Revenue",
  einheit: "EUR",
  typ: "betrag",
  kategorie: "finanzen",
  periodizitaet: "quartal",
  aggregation: "summe",
  pflicht: true,
  reihenfolge: 10,
  gueltigAb: "2026-01-01",
  gueltigBis: null,
};
const abfrageAntworten = (abfrage: Record<string, unknown> | null) => ({
  "/api/v1/me": alsRolle("bearbeiter"),
  "/api/v1/kennzahlen/katalog": { koerper: { daten: [UMSATZ] } },
  [`/api/v1/fonds/${FONDS_ID}/kennzahlen/auswahl`]: { koerper: { daten: [{ schluessel: "umsatz", reihenfolge: 0, gueltig: true, definition: UMSATZ }] } },
  [`/api/v1/fonds/${FONDS_ID}/kennzahlen/abfragen`]: { koerper: { daten: [] } },
  [uebersichtPfad]: {
    koerper: {
      fondsId: FONDS_ID,
      periode: { beginn: "2026-07-01", ende: "2026-09-30", art: "quartal" },
      kennzahlen: [UMSATZ],
      unternehmen: [{ beteiligungId: BET_ID, organisation: "Alpha Energie", organisationId: ORG_A, angefordert: 1, eingereicht: 0, bestaetigt: 0, fehlend: ["umsatz"], abfrage }],
      summe: { angefordert: 1, eingereicht: 0, bestaetigt: 0 },
    },
  },
});

describe("Kennzahlen-Abfrage: Link per Mail", () => {
  it("beim Anlegen kann der Link per Mail an einen Kontakt des Unternehmens gehen; der Link bleibt zum Kopieren sichtbar", async () => {
    const token = "Z".repeat(43);
    const api = spieleApi({
      ...abfrageAntworten(null),
      [`POST /api/v1/beteiligungen/${BET_ID}/kennzahlen/abfragen`]: { status: 201, koerper: { abfrage: { id: "a9" }, link: { token, pfad: `/extern/abfrage/${token}`, ablauf: "2099-11-30T10:00:00.000Z" } } },
    });
    rendereApp(`/fonds/${FONDS_ID}/kennzahlen`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Abfrage anlegen: Alpha Energie" }));
    const auswahl = (await dialog().findByLabelText(de.mail.abfrage.perMail)) as HTMLSelectElement;
    expect(within(auswahl).getByRole("option", { name: de.mail.abfrage.niemand })).toBeTruthy();
    await nutzer.selectOptions(auswahl, "p1");
    await nutzer.click(dialog().getByRole("button", { name: "Anfrage anlegen" }));
    expect(await screen.findByLabelText("Link zum Kopieren")).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/kennzahlen/abfragen`)[0]!.koerper).toMatchObject({ empfaengerPersonId: "p1" });
  });

  it("ohne Auswahl wird kein Empfänger gesendet", async () => {
    const api = spieleApi({
      ...abfrageAntworten(null),
      [`POST /api/v1/beteiligungen/${BET_ID}/kennzahlen/abfragen`]: { status: 201, koerper: { abfrage: { id: "a9" }, link: { token: "Y".repeat(43), pfad: `/extern/abfrage/${"Y".repeat(43)}`, ablauf: "2099-11-30T10:00:00.000Z" } } },
    });
    rendereApp(`/fonds/${FONDS_ID}/kennzahlen`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Abfrage anlegen: Alpha Energie" }));
    await dialog().findByLabelText(de.mail.abfrage.perMail);
    await nutzer.click(dialog().getByRole("button", { name: "Anfrage anlegen" }));
    await screen.findByLabelText("Link zum Kopieren");
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/kennzahlen/abfragen`)[0]!.koerper).not.toHaveProperty("empfaengerPersonId");
  });

  it("offene Anfrage: „Per Mail senden“ wählt den Empfänger und zeigt den neuen Link; ohne Mailversand erscheint die übersetzte Meldung", async () => {
    const token = "P".repeat(43);
    let sendbar = false;
    const api = spieleApi({
      ...abfrageAntworten({ id: "a1", status: "offen", faelligAm: "2099-10-15", erinnerung: null, abgelaufen: false }),
      "POST /api/v1/kennzahlen/abfragen/a1/per-mail": () => (sendbar ? { koerper: { abfrage: { id: "a1" }, link: { token, pfad: `/extern/abfrage/${token}`, ablauf: "2099-12-01T10:00:00.000Z" } } } : fehler(409, "mail_not_configured")),
    });
    rendereApp(`/fonds/${FONDS_ID}/kennzahlen`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Link für Alpha Energie per Mail senden" }));
    await dialog().findByLabelText("Empfänger");
    await nutzer.click(dialog().getByRole("button", { name: "Per Mail senden" }));
    expect(await dialog().findByText(de.mail.fehler.mail_not_configured!)).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/kennzahlen/abfragen/a1/per-mail")[0]!.koerper).toEqual({ personId: "p1" });
    sendbar = true;
    await nutzer.click(dialog().getByRole("button", { name: "Per Mail senden" }));
    const link = (await screen.findByLabelText("Link zum Kopieren")) as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/extern/abfrage/${token}`);
  });

  it("ein Unternehmen ohne Kontakt mit Mailadresse bekommt einen Hinweis statt der Auswahl", async () => {
    spieleApi({
      ...abfrageAntworten(null),
      [`/api/v1/organisationen/${ORG_A}`]: { koerper: { id: ORG_A, name: "Alpha Energie", art: "unternehmen", sektor: null, ort: null, website: null, erstelltAm: "2020-01-01T00:00:00.000Z", zusammengefuehrtIn: null, rollen: [], beziehungen: [], personen: [{ id: "p9", vorname: "Otto", nachname: "Ohne", email: null, funktion: null }], deals: [], beteiligungen: [] } },
    });
    rendereApp(`/fonds/${FONDS_ID}/kennzahlen`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Abfrage anlegen: Alpha Energie" }));
    expect(await dialog().findByText(de.mail.abfrage.keinKontakt)).toBeTruthy();
  });

  it("auf Englisch", async () => {
    zuEnglisch();
    spieleApi({ ...abfrageAntworten({ id: "a1", status: "offen", faelligAm: "2099-10-15", erinnerung: null, abgelaufen: false }) });
    rendereApp(`/fonds/${FONDS_ID}/kennzahlen`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: en.mail.abfrage.sendenFuer("Alpha Energie") }));
    expect(await dialog().findByLabelText(en.mail.abfrage.empfaenger)).toBeTruthy();
    expect(dialog().getByRole("button", { name: "Send by e-mail" })).toBeTruthy();
  });
});

describe("Mitteilungen freigeben: per Mail hinweisen", () => {
  const freigabePfad = `/api/v1/fonds/${FONDS_ID}/bewegungen/${BEWEGUNG_OFFEN_ID}/mitteilungen/freigeben`;
  const knopf = "Mitteilungen freigeben: Kapitalabruf vom 15.03.2026";

  it("die Option geht als `perMail` an die API, Standard ist aus", async () => {
    const api = spieleApi({ "/api/v1/me": alsRolle("freigeber"), [`/api/v1/fonds/${FONDS_ID}/bewegungen`]: { koerper: bewegungenDaten }, [`POST ${freigabePfad}`]: { status: 201, koerper: { bewegungId: BEWEGUNG_OFFEN_ID, anzahl: 5, mitteilungen: [], mailAuftraege: 3 } } });
    rendereApp(`/fonds?fondsId=${FONDS_ID}&tab=kapital`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: knopf }));
    const feld = dialog().getByLabelText(de.mail.mitteilung.perMail) as HTMLInputElement;
    expect(feld.checked).toBe(false);
    expect(dialog().getByText(de.mail.mitteilung.hilfe)).toBeTruthy();
    await nutzer.click(dialog().getByRole("button", { name: "Jetzt freigeben" }));
    await waitFor(() => expect(api.anfragen("POST", freigabePfad)).toHaveLength(1));
    expect(api.anfragen("POST", freigabePfad)[0]!.koerper).toEqual({ sprache: "de" });
  });

  it("mit gesetzter Option sendet die Oberfläche perMail: true; ohne eingerichteten Versand zeigt der Dialog die Meldung", async () => {
    const api = spieleApi({ "/api/v1/me": alsRolle("freigeber"), [`/api/v1/fonds/${FONDS_ID}/bewegungen`]: { koerper: bewegungenDaten }, [`POST ${freigabePfad}`]: fehler(409, "mail_not_configured") });
    rendereApp(`/fonds?fondsId=${FONDS_ID}&tab=kapital`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: knopf }));
    await nutzer.click(dialog().getByLabelText(de.mail.mitteilung.perMail));
    await nutzer.click(dialog().getByRole("button", { name: "Jetzt freigeben" }));
    expect(await dialog().findByText(de.mail.fehler.mail_not_configured!)).toBeTruthy();
    expect(api.anfragen("POST", freigabePfad)[0]!.koerper).toEqual({ sprache: "de", perMail: true });
  });

  it("auf Englisch", async () => {
    zuEnglisch();
    spieleApi({ "/api/v1/me": alsRolle("freigeber"), [`/api/v1/fonds/${FONDS_ID}/bewegungen`]: { koerper: bewegungenDaten } });
    rendereApp(`/fonds?fondsId=${FONDS_ID}&tab=kapital`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: /Release notices: / }));
    expect(dialog().getByLabelText(en.mail.mitteilung.perMail)).toBeTruthy();
  });
});

describe("Verwaltung: Mailversand", () => {
  const MAIL = "/verwaltung?tab=mail";
  const status = (extra: Record<string, unknown> = {}) => ({ konfiguriert: true, host: "smtp.example.org", port: 587, tls: "starttls", absender: "carraway@example.org", mitAnmeldung: true, limitProStunde: 200, schluesselVorhanden: true, ausgangskorb: { wartend: 2, fehlgeschlagen: 1, gesendetLetzteStunde: 7 }, ...extra });
  const auftrag = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    empfaenger: "anna@alpha.example.com",
    vorlage: "kennzahl_abfrage",
    betreff: "Kennzahlen-Abfrage: Alpha Energie",
    bezugArt: "kennzahl_abfrage",
    bezugId: "a1",
    status: "gesendet",
    versuche: 1,
    letzterFehler: null,
    naechsterVersuchAm: "2026-11-20T08:00:00.000Z",
    erstelltAm: "2026-11-20T08:00:00.000Z",
    gesendetAm: "2026-11-20T08:00:05.000Z",
    ...extra,
  });

  it("zeigt den Status ohne Geheimnisse und den Ausgangskorb ohne Inhalte; Filter und Testmail", async () => {
    const api = spieleApi({
      "/api/v1/mail/status": { koerper: status() },
      "/api/v1/mail/auftraege": (a) => ({ koerper: { daten: a.query.get("status") === "fehlgeschlagen" ? [auftrag("x2", { status: "fehlgeschlagen", versuche: 5, letzterFehler: "SMTP_ECONNECTION", gesendetAm: null })] : [auftrag("x1"), auftrag("x2", { status: "fehlgeschlagen", versuche: 5, letzterFehler: "SMTP_ECONNECTION", gesendetAm: null })] } }),
      "POST /api/v1/mail/test": { status: 202, koerper: { auftragId: "t1" } },
    });
    rendereApp(MAIL);
    const nutzer = userEvent.setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Benutzer, Rechte und Sperren" })).toBeTruthy();
    expect(await screen.findByText("smtp.example.org:587")).toBeTruthy();
    expect(screen.getByText("carraway@example.org")).toBeTruthy();
    expect(screen.getByText("STARTTLS")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/passwort|secret/i);
    const tabelle = within(await screen.findByRole("region", { name: de.mail.versand.korb.tabelle }));
    expect(tabelle.getByRole("row", { name: /SMTP_ECONNECTION/ }).textContent).toContain("Fehlgeschlagen");
    expect(tabelle.getAllByText("Kennzahlen-Abfrage")).toHaveLength(2);
    expect(screen.getByText(de.mail.versand.korb.hinweis)).toBeTruthy();

    await nutzer.selectOptions(screen.getByLabelText("Status", { selector: "select" }), "fehlgeschlagen");
    await waitFor(() => expect(api.anfragen("GET", "/api/v1/mail/auftraege").some((a) => a.query.get("status") === "fehlgeschlagen")).toBe(true));
    await waitFor(() => expect(within(screen.getByRole("region", { name: de.mail.versand.korb.tabelle })).queryAllByRole("row")).toHaveLength(2)); // Kopf + eine Zeile

    await nutzer.click(screen.getByRole("button", { name: de.mail.versand.test.knopf }));
    expect(await screen.findByText(de.mail.versand.test.angelegt)).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/mail/test")[0]!.koerper).toBeUndefined(); // kein Empfänger im Körper
  });

  it("ohne Einrichtung steht der Hinweis da und es gibt keine Testmail", async () => {
    spieleApi({ "/api/v1/mail/status": { koerper: { konfiguriert: false, schluesselVorhanden: false, ausgangskorb: { wartend: 0, fehlgeschlagen: 0, gesendetLetzteStunde: 0 } } }, "/api/v1/mail/auftraege": { koerper: { daten: [] } } });
    rendereApp(MAIL);
    expect(await screen.findByText(de.mail.versand.status.aus)).toBeTruthy();
    expect(screen.queryByRole("button", { name: de.mail.versand.test.knopf })).toBeNull();
    expect(await screen.findByText(de.mail.versand.korb.keine)).toBeTruthy();
  });

  it("nur globale Verwalter: andere gehen zur Startseite zurück und sehen den Menüpunkt im Konto nicht", async () => {
    spieleApi({ "/api/v1/me": alsRolle("verwalter") });
    const { router } = rendereApp(MAIL);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/fonds/${FONDS_ID}`));
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: /Konto/ }));
    expect(screen.getByRole("menuitem", { name: "Einstellungen" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Mailversand" })).toBeNull();
  });

  it("die alte Adresse /verwaltung/mail führt auf den Bereich in der Verwaltung", async () => {
    spieleApi({ "/api/v1/mail/status": { koerper: status() }, "/api/v1/mail/auftraege": { koerper: { daten: [auftrag("x1")] } } });
    const { router } = rendereApp("/verwaltung/mail");
    expect(await screen.findByText("smtp.example.org:587")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/verwaltung");
    expect(router.state.location.search).toEqual({ tab: "mail" });
  });

  it("globale Verwalter finden den Mailversand in der Verwaltung, nicht mehr im Kontomenü; auf Englisch alles übersetzt", async () => {
    zuEnglisch();
    spieleApi({ "/api/v1/me": { koerper: { ...ichDaten, id: ICH_ID } }, "/api/v1/mail/status": { koerper: status() }, "/api/v1/mail/auftraege": { koerper: { daten: [auftrag("x1")] } } });
    rendereApp(MAIL);
    expect(await screen.findByRole("heading", { level: 1, name: en.verwaltung.titel })).toBeTruthy();
    expect(await screen.findByText(en.mail.versand.korb.hinweis)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send test mail to me" })).toBeTruthy();
    const nutzer = userEvent.setup();
    await nutzer.click(screen.getByRole("button", { name: /Account/ }));
    expect(screen.getByRole("menuitem", { name: "Administration" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Mail delivery" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "API help" })).toBeNull();
  });
});

describe("Texte", () => {
  it("de und en haben dieselben Schlüssel für Mail und Kalender (Typ erzwingt es), und kein Text bleibt leer", () => {
    const leer = (tabelle: unknown, pfad = "mail"): string[] =>
      Object.entries(tabelle as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === "string" ? (v.trim() === "" ? [`${pfad}.${k}`] : []) : Array.isArray(v) ? v.flatMap((x, i) => (typeof x === "string" && x.trim() === "" ? [`${pfad}.${k}[${i}]`] : [])) : typeof v === "object" && v !== null ? leer(v, `${pfad}.${k}`) : [],
      );
    expect(leer(de.mail)).toEqual([]);
    expect(leer(en.mail)).toEqual([]);
    expect(Object.keys(de.mail.fehler).sort()).toEqual(Object.keys(en.mail.fehler).sort());
    expect(de.mail.einstellungen.postfach.datenschutz.punkte).toHaveLength(en.mail.einstellungen.postfach.datenschutz.punkte.length);
  });
});
