import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { authFehler, fehler, FONDS_ID, ichDaten, rendereApp, spieleApi, umgebungDaten } from "../test/hilfen";
import { de } from "../i18n/de";
import { en } from "../i18n/en";

const nichtAngemeldet = fehler(401, "NICHT_ANGEMELDET");
const ICH = "/api/v1/ich";

/** `/ich` antwortet erst nach der Anmeldung (die Sitzung ist im Test nur ein Schalter). */
function mitSitzung(angemeldet = false) {
  const zustand = { angemeldet };
  return { zustand, ich: () => (zustand.angemeldet ? { koerper: ichDaten } : nichtAngemeldet) };
}

async function fuelleZugang(nutzer: ReturnType<typeof userEvent.setup>, passwort = "Demo-Passwort-123", email = "vera@beispiel.example") {
  await nutzer.type(await screen.findByLabelText(/E-Mail-Adresse|Email address/), email);
  await nutzer.type(screen.getByLabelText(/Passwort|Password/), passwort);
  await nutzer.click(screen.getByRole("button", { name: /^(Anmelden|Sign in)$/ }));
}

describe("Anmeldung", () => {
  it("leitet ohne Sitzung zur Anmeldung und kehrt nach der Anmeldung zur ursprünglichen Adresse zurück", async () => {
    const s = mitSitzung();
    const api = spieleApi({
      [ICH]: s.ich,
      "POST /api/v1/auth/sign-in/email": () => {
        s.zustand.angemeldet = true;
        return { koerper: { token: "t" } };
      },
    });
    const { router } = rendereApp("/dealflow?status=offen");
    expect(await screen.findByRole("heading", { name: "Anmelden" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/anmelden");
    expect(router.state.location.search).toMatchObject({ weiter: "/dealflow?status=offen" });
    await fuelleZugang(userEvent.setup());
    await waitFor(() => expect(router.state.location.pathname).toBe("/dealflow"));
    const anmeldung = api.anfragen("POST", "/api/v1/auth/sign-in/email")[0]!;
    expect(anmeldung.koerper).toEqual({ email: "vera@beispiel.example", password: "Demo-Passwort-123" });
    expect(anmeldung.credentials).toBe("include");
  });

  it("verlangt bei twoFactorRedirect den Code, sendet nie trustDevice und kennt den Wiederherstellungscode", async () => {
    const s = mitSitzung();
    const api = spieleApi({
      [ICH]: s.ich,
      "POST /api/v1/auth/sign-in/email": { koerper: { twoFactorRedirect: true } },
      "POST /api/v1/auth/two-factor/verify-totp": () => {
        s.zustand.angemeldet = true;
        return { koerper: { token: "t" } };
      },
    });
    const { router } = rendereApp("/anmelden");
    const nutzer = userEvent.setup();
    await fuelleZugang(nutzer);
    expect(await screen.findByRole("heading", { name: "Code eingeben" })).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Wiederherstellungscode verwenden" }));
    expect(screen.getByRole("heading", { name: "Wiederherstellungscode eingeben" })).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Stattdessen den Code der App verwenden" }));
    await nutzer.type(screen.getByLabelText("Code"), " 123456 ");
    await nutzer.click(screen.getByRole("button", { name: "Bestätigen" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/fonds/${FONDS_ID}`));
    const verify = api.anfragen("POST", "/api/v1/auth/two-factor/verify-totp")[0]!;
    expect(verify.koerper).toEqual({ code: "123456" });
    expect(JSON.stringify(verify.koerper)).not.toContain("trustDevice");
  });

  it("zeigt falsche Zugangsdaten und die Begrenzung mit Wartezeit übersetzt, in beiden Sprachen", async () => {
    spieleApi({ [ICH]: nichtAngemeldet, "POST /api/v1/auth/sign-in/email": authFehler(401, "INVALID_EMAIL_OR_PASSWORD") });
    const { unmount } = rendereApp("/anmelden");
    await fuelleZugang(userEvent.setup());
    expect((await screen.findByRole("alert")).textContent).toContain(de.fehler.INVALID_EMAIL_OR_PASSWORD);
    unmount();

    localStorage.setItem("carraway.sprache", "en");
    spieleApi({
      [ICH]: nichtAngemeldet,
      "POST /api/v1/auth/sign-in/email": { status: 429, koerper: { fehler: { code: "ZU_VIELE_VERSUCHE", meldung: "x" } }, kopf: { "Retry-After": "900" } },
    });
    rendereApp("/anmelden");
    await fuelleZugang(userEvent.setup(), "falsch", "a@b.example");
    const text = (await screen.findByRole("alert")).textContent ?? "";
    expect(text).toContain(en.fehler.ZU_VIELE_VERSUCHE);
    expect(text).toContain("15 minutes");
  });

  it("nimmt kein fremdes Rücksprungziel an", async () => {
    const s = mitSitzung();
    spieleApi({ [ICH]: s.ich, "POST /api/v1/auth/sign-in/email": () => { s.zustand.angemeldet = true; return { koerper: {} }; } });
    const { router } = rendereApp("/anmelden?weiter=//boese.example");
    await fuelleZugang(userEvent.setup());
    await waitFor(() => expect(router.state.location.pathname).toBe(`/fonds/${FONDS_ID}`));
    expect(router.state.location.href).not.toContain("boese");
  });

  it("meldet ab, verwirft den Cache und führt zur Anmeldung", async () => {
    const s = mitSitzung(true);
    const api = spieleApi({
      [ICH]: s.ich,
      "POST /api/v1/auth/sign-out": () => {
        s.zustand.angemeldet = false;
        return { koerper: { success: true } };
      },
    });
    const { router, queryClient } = rendereApp("/dealflow");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: /Vera Beispiel/ }));
    await nutzer.click(screen.getByRole("menuitem", { name: "Abmelden" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/anmelden"));
    expect(api.anfragen("POST", "/api/v1/auth/sign-out")).toHaveLength(1);
    expect(queryClient.getQueryCache().findAll({ queryKey: ["deals"] })).toHaveLength(0);
  });

  it("führt bei einer 401-Antwort mitten in der Arbeit zur Anmeldung mit Rücksprungziel", async () => {
    const s = mitSitzung(true);
    spieleApi({
      [ICH]: s.ich,
      "POST /api/v1/crm/objekte/deal/board": () => {
        s.zustand.angemeldet = false;
        return nichtAngemeldet;
      },
    });
    const { router } = rendereApp("/kontakte");
    await screen.findByRole("heading", { name: /Kontakte/i });
    await router.navigate({ to: "/dealflow" }).catch(() => undefined);
    await waitFor(() => expect(router.state.location.pathname).toBe("/anmelden"));
  });

  it("zeigt das Umgebungsband für demo und test, nicht für echt", async () => {
    for (const [umgebung, text] of [["demo", "Demobestand"], ["test", "Testbestand"], ["echt", null]] as const) {
      spieleApi({ "/api/v1/umgebung": { koerper: { ...umgebungDaten, umgebung } } });
      const { unmount } = rendereApp("/dealflow");
      await screen.findByRole("heading", { name: /Dealflow/i });
      if (text) expect(screen.getByText(text)).toBeTruthy();
      else expect(screen.queryByText("Demobestand") ?? screen.queryByText("Testbestand")).toBeNull();
      unmount();
    }
  });

  it("zeigt die pseudonymisierte Kopie im selben Band, auch im Echtbestand und auf der Anmeldeseite", async () => {
    spieleApi({ "/api/v1/umgebung": { koerper: { ...umgebungDaten, pseudonymisiert: true } } });
    const { unmount } = rendereApp("/dealflow");
    await screen.findByRole("heading", { name: /Dealflow/i });
    const band = screen.getByText("Pseudonymisierte Kopie").closest(".app-umgebung");
    expect(band?.getAttribute("role")).toBe("status");
    expect(band?.textContent).not.toContain("Demobestand");
    unmount();
    spieleApi({ "/api/v1/umgebung": { koerper: { ...umgebungDaten, umgebung: "demo", pseudonymisiert: true } }, "/api/v1/ich": { status: 401, koerper: { fehler: { code: "NICHT_ANGEMELDET", meldung: "x" } } } });
    rendereApp("/anmelden");
    expect(await screen.findByText("Pseudonymisierte Kopie")).toBeTruthy();
    expect(screen.getByText("Demobestand")).toBeTruthy();
  });
});

describe("Sperren nach der Anmeldung", () => {
  it("erzwingt das Ändern des Startpassworts vor allem anderen und kehrt danach zurück", async () => {
    const zustand = { geaendert: false };
    const api = spieleApi({
      [ICH]: () => ({ koerper: { ...ichDaten, passwortAendern: !zustand.geaendert } }),
      "POST /api/v1/auth/change-password": () => {
        zustand.geaendert = true;
        return { koerper: { status: true } };
      },
    });
    const { router } = rendereApp("/kontakte");
    expect(await screen.findByRole("heading", { name: "Passwort ändern" })).toBeTruthy();
    expect(api.anfragen("GET", "/api/v1/organisationen")).toHaveLength(0);
    const nutzer = userEvent.setup();
    await nutzer.type(screen.getByLabelText("Bisheriges Passwort"), "Startpasswort-123");
    await nutzer.type(screen.getByLabelText("Neues Passwort"), "kurz");
    await nutzer.type(screen.getByLabelText("Neues Passwort wiederholen"), "kurz");
    await nutzer.click(screen.getByRole("button", { name: "Passwort speichern" }));
    expect(screen.getByText("Das Passwort braucht mindestens 12 Zeichen.")).toBeTruthy();
    await nutzer.clear(screen.getByLabelText("Neues Passwort"));
    await nutzer.clear(screen.getByLabelText("Neues Passwort wiederholen"));
    await nutzer.type(screen.getByLabelText("Neues Passwort"), "Ein-ganz-neues-Passwort-1");
    await nutzer.type(screen.getByLabelText("Neues Passwort wiederholen"), "Ein-ganz-neues-Passwort-1");
    await nutzer.click(screen.getByRole("button", { name: "Passwort speichern" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/kontakte"));
    expect(api.anfragen("POST", "/api/v1/auth/change-password")[0]!.koerper).toMatchObject({ currentPassword: "Startpasswort-123", newPassword: "Ein-ganz-neues-Passwort-1" }); // gitleaks:allow
  });

  it("richtet den zweiten Faktor ein: QR-Code lokal, Wiederherstellungscodes einmalig, Aktivierung erst mit Bestätigung und Code", async () => {
    const zustand = { aktiv: false };
    const api = spieleApi({
      [ICH]: () => ({ koerper: { ...ichDaten, zweiFaktorAktiv: zustand.aktiv, zweiFaktorErforderlich: !zustand.aktiv } }),
      "POST /api/v1/auth/two-factor/enable": {
        koerper: { totpURI: "otpauth://totp/Carraway:vera%40beispiel.example?secret=KRSXG5CTMVRXEZLU&issuer=Carraway", backupCodes: ["aaaa-1111", "bbbb-2222"] },
      },
      "POST /api/v1/auth/two-factor/verify-totp": () => {
        zustand.aktiv = true;
        return { koerper: { token: "t" } };
      },
    });
    const { router, queryClient } = rendereApp("/dealflow");
    expect(await screen.findByRole("heading", { name: "Zweiten Faktor einrichten" })).toBeTruthy();
    const nutzer = userEvent.setup();
    await nutzer.type(screen.getByLabelText("Passwort"), "Demo-Passwort-123");
    await nutzer.click(screen.getByRole("button", { name: "Einrichtung beginnen" }));
    expect(await screen.findByRole("img", { name: /QR-Code/ })).toBeTruthy();
    expect((document.querySelector(".app-qr__modul")?.getAttribute("d") ?? "").length).toBeGreaterThan(100);
    expect(screen.getByText("aaaa-1111")).toBeTruthy();
    expect(screen.getByText("KRSX G5CT MVRX EZLU")).toBeTruthy();
    // Die Codes liegen nicht im Cache.
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((q) => q.state.data))).not.toContain("aaaa-1111");
    const aktivieren = screen.getByRole("button", { name: "Aktivieren" });
    await nutzer.type(screen.getByLabelText("Code aus der App"), "123456");
    expect((aktivieren as HTMLButtonElement).disabled).toBe(true);
    await nutzer.click(screen.getByRole("checkbox"));
    await nutzer.click(aktivieren);
    await waitFor(() => expect(router.state.location.pathname).toBe("/dealflow"));
    expect(api.anfragen("POST", "/api/v1/auth/two-factor/verify-totp")[0]!.koerper).toEqual({ code: "123456" });
    expect(screen.queryByText("aaaa-1111")).toBeNull();
  });

  it("führt bei 403 ZWEI_FAKTOR_FEHLT mitten in der Arbeit zur Einrichtung", async () => {
    const zustand = { gesperrt: false };
    spieleApi({
      [ICH]: () => ({ koerper: { ...ichDaten, zweiFaktorErforderlich: zustand.gesperrt } }),
      "POST /api/v1/crm/objekte/deal/board": () => {
        zustand.gesperrt = true;
        return fehler(403, "ZWEI_FAKTOR_FEHLT");
      },
    });
    const { router } = rendereApp("/kontakte");
    await screen.findByRole("heading", { name: /Kontakte/i });
    await router.navigate({ to: "/dealflow" }).catch(() => undefined);
    await waitFor(() => expect(router.state.location.pathname).toBe("/zwei-faktor-einrichten"));
  });
});

describe("Einrichtung", () => {
  it("richtet die erste Person ein und führt zur Anmeldung; ist die Installation fertig, kommt die Meldung", async () => {
    const api = spieleApi({ [ICH]: nichtAngemeldet, "POST /api/v1/einrichtung": { status: 201, koerper: { id: "x" } } });
    const { router, unmount } = rendereApp("/einrichtung");
    const nutzer = userEvent.setup();
    const ausfuellen = async () => {
      await nutzer.type(await screen.findByLabelText("Name"), "Erste Person");
      await nutzer.type(screen.getByLabelText("E-Mail-Adresse"), "erste@beispiel.example");
      await nutzer.type(screen.getByLabelText("Passwort"), "Ein-ganz-neues-Passwort-1");
      await nutzer.type(screen.getByLabelText("Neues Passwort wiederholen"), "Ein-ganz-neues-Passwort-1");
      await nutzer.click(screen.getByRole("button", { name: "Einrichten" }));
    };
    await ausfuellen();
    await waitFor(() => expect(router.state.location.pathname).toBe("/anmelden"));
    expect(api.anfragen("POST", "/api/v1/einrichtung")[0]!.koerper).toEqual({ name: "Erste Person", email: "erste@beispiel.example", passwort: "Ein-ganz-neues-Passwort-1" });
    expect(await screen.findByText(de.anmeldung.eingerichtet)).toBeTruthy();
    unmount();

    spieleApi({ [ICH]: nichtAngemeldet, "POST /api/v1/einrichtung": fehler(403, "REGISTRIERUNG_GESCHLOSSEN") });
    rendereApp("/einrichtung");
    await ausfuellen();
    expect((await screen.findByRole("alert")).textContent).toContain(de.fehler.REGISTRIERUNG_GESCHLOSSEN);
  });
});

describe("Passwort zurücksetzen und Einladung", () => {
  const MIT_MAIL = { "/api/v1/umgebung": { koerper: { ...umgebungDaten, anmeldung: { ...umgebungDaten.anmeldung, passwortZuruecksetzen: true } } } };

  it("verlinkt „Passwort vergessen?“ nur, wenn der Mailversand eingerichtet ist", async () => {
    spieleApi({ [ICH]: nichtAngemeldet });
    const { unmount } = rendereApp("/anmelden");
    await screen.findByRole("heading", { name: "Anmelden" });
    expect(screen.queryByRole("link", { name: de.anmeldung.passwortVergessen })).toBeNull();
    unmount();

    spieleApi({ [ICH]: nichtAngemeldet, ...MIT_MAIL });
    rendereApp("/anmelden");
    expect(await screen.findByRole("link", { name: de.anmeldung.passwortVergessen })).toBeTruthy();
  });

  it("die Anfrage zeigt immer dieselbe Bestätigung und sendet die Sprache der Oberfläche", async () => {
    const api = spieleApi({ [ICH]: nichtAngemeldet, ...MIT_MAIL, "POST /api/v1/passwort/vergessen": { koerper: { ok: true } } });
    rendereApp("/passwort-vergessen");
    const nutzer = userEvent.setup();
    await nutzer.type(await screen.findByLabelText("E-Mail-Adresse"), " person@beispiel.example ");
    await nutzer.click(screen.getByRole("button", { name: de.anmeldung.vergessen.senden }));
    expect(await screen.findByText(de.anmeldung.vergessen.gesendetText)).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/passwort/vergessen")[0]!.koerper).toEqual({ email: "person@beispiel.example", sprache: "de" });
  });

  it("ohne Mailversand erklärt die Seite, wer das Passwort vergibt, und bietet kein Formular an", async () => {
    spieleApi({ [ICH]: nichtAngemeldet });
    rendereApp("/passwort-vergessen");
    expect(await screen.findByText(de.anmeldung.vergessen.keinMail)).toBeTruthy();
    expect(screen.queryByRole("button", { name: de.anmeldung.vergessen.senden })).toBeNull();
  });

  it("legt mit dem Token aus dem Fragment das Passwort fest und verweist zur Anmeldung", async () => {
    const api = spieleApi({ [ICH]: nichtAngemeldet, "POST /api/v1/auth/reset-password": { koerper: { status: true } } });
    rendereApp("/passwort-setzen#token=AbC123_-xyz");
    const nutzer = userEvent.setup();
    await nutzer.type(await screen.findByLabelText("Neues Passwort"), "Ein-ganz-neues-Passwort-1");
    await nutzer.type(screen.getByLabelText("Neues Passwort wiederholen"), "Ein-ganz-neues-Passwort-1");
    await nutzer.click(screen.getByRole("button", { name: de.anmeldung.setzen.senden }));
    expect(await screen.findByRole("heading", { name: de.anmeldung.setzen.fertigTitel })).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/auth/reset-password")[0]!.koerper).toEqual({ token: "AbC123_-xyz", newPassword: "Ein-ganz-neues-Passwort-1" }); // gitleaks:allow
  });

  it("prüft Länge und Wiederholung, bevor etwas gesendet wird", async () => {
    const api = spieleApi({ [ICH]: nichtAngemeldet });
    rendereApp("/passwort-setzen#token=AbC123");
    const nutzer = userEvent.setup();
    await nutzer.type(await screen.findByLabelText("Neues Passwort"), "kurz");
    await nutzer.type(screen.getByLabelText("Neues Passwort wiederholen"), "anders");
    await nutzer.click(screen.getByRole("button", { name: de.anmeldung.setzen.senden }));
    expect(await screen.findByText(de.passwort.zuKurz(12))).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/auth/reset-password")).toHaveLength(0);
  });

  it("meldet einen abgelaufenen oder benutzten Link und einen fehlenden Token", async () => {
    spieleApi({ [ICH]: nichtAngemeldet, "POST /api/v1/auth/reset-password": authFehler(400, "INVALID_TOKEN") });
    const { unmount } = rendereApp("/passwort-setzen#token=Abgelaufen1");
    const nutzer = userEvent.setup();
    await nutzer.type(await screen.findByLabelText("Neues Passwort"), "Ein-ganz-neues-Passwort-1");
    await nutzer.type(screen.getByLabelText("Neues Passwort wiederholen"), "Ein-ganz-neues-Passwort-1");
    await nutzer.click(screen.getByRole("button", { name: de.anmeldung.setzen.senden }));
    expect(await screen.findByRole("heading", { name: de.anmeldung.setzen.ungueltigTitel })).toBeTruthy();
    unmount();

    spieleApi({ [ICH]: nichtAngemeldet });
    rendereApp("/passwort-setzen");
    expect(await screen.findByRole("heading", { name: de.anmeldung.setzen.ungueltigTitel })).toBeTruthy();
  });

  it("der Link aus der Mail öffnet auch bei bestehender Sitzung die Seite zum Festlegen", async () => {
    spieleApi({});
    const { router } = rendereApp("/passwort-setzen#token=AbC123");
    expect(await screen.findByRole("heading", { name: de.anmeldung.setzen.titel })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/passwort-setzen");
  });

  it("zeigt Texte auf Englisch", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi({ [ICH]: nichtAngemeldet });
    rendereApp("/passwort-setzen#token=AbC123");
    expect(await screen.findByRole("heading", { name: en.anmeldung.setzen.titel })).toBeTruthy();
  });
});
