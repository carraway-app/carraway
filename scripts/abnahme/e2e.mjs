// Browser-Abnahme gegen eine frisch befüllte Instanz mit Beispieldaten.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { axePruefen, meldeAn, uebersetzungsFunde } from "./browser-hilfen.mjs";

export async function pruefeBrowser(basis, ausgabe, pruefeErweiterungen) {
  const variante = pruefeErweiterungen ? "voll" : "kern";
  await mkdir(ausgabe, { recursive: true });
  const befund = { variante, schritte: [], konsole: [], anfragen: [], fehler: [] };
  let browser;
  let aktuelleSeite;
  let schritt = "browser-start";

  function beobachte(page, rolle) {
    // Der Router prüft beim ersten Laden der Anmeldung, ob schon eine Sitzung besteht.
    const ohneSitzung = (url) => page.url() === `${basis}/sign-in` && url === `${basis}/api/v1/me`;
    const merke = (liste, text) => befund[liste].push({ schritt, rolle, text });
    const anfrageText = (r) => `${r.method()} ${new URL(r.url()).pathname}`;
    page.on("console", (m) => {
      if (ohneSitzung(m.location().url) && m.text().startsWith("Failed to load resource: the server responded with a status of 401")) return;
      if (m.type() === "error") merke("konsole", m.text());
    });
    page.on("pageerror", (e) => merke("konsole", e.message));
    page.on("response", (r) => {
      if (r.status() === 401 && r.request().method() === "GET" && ohneSitzung(r.url())) return;
      if (r.status() >= 400) merke("anfragen", `${r.status()} ${anfrageText(r.request())}`);
    });
    page.on("requestfailed", (r) => {
      const fehler = r.failure()?.errorText;
      // Beim Wechsel einer Seite bricht Chromium ausstehende Abrufe des alten Dokuments ab.
      if (fehler !== "net::ERR_ABORTED") merke("anfragen", `${fehler} ${anfrageText(r)}`);
    });
  }

  async function bild(page, name) {
    const schluessel = page.getByRole("dialog").locator("code");
    await page.screenshot({ path: join(ausgabe, `${name}.png`), mask: [schluessel], animations: "disabled", timeout: 5000 });
  }

  async function pruefe(page, name, sprache = "de") {
    schritt = name;
    const { lang, text } = await page.locator("html").evaluate((html) => ({ lang: html.lang, text: document.body.innerText }));
    const funde = uebersetzungsFunde(text);
    if (lang !== sprache) funde.push(`html lang=${lang}, erwartet ${sprache}`);
    const axe = await axePruefen(page, { alleRegeln: true });
    befund.schritte.push({ name, pfad: new URL(page.url()).pathname, funde, axe });
    await bild(page, name);
    console.log(name);
  }

  async function anmelden(rolle, mitAbnahme = false) {
    schritt = `anmelden-${rolle}`;
    const context = await browser.newContext({ locale: "de-DE", viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce" });
    context.setDefaultTimeout(10000);
    context.setDefaultNavigationTimeout(15000);
    await context.addInitScript(() => localStorage.setItem("carraway.sprache", localStorage.getItem("carraway.sprache") ?? "de"));
    const page = await context.newPage();
    aktuelleSeite = page;
    beobachte(page, rolle);
    await meldeAn(page, rolle, { basis, pruefeSchritt: mitAbnahme ? (name) => pruefe(page, `anmeldung-${name}`) : undefined });
    return page;
  }

  async function oeffne(page, pfad, name) {
    schritt = name;
    aktuelleSeite = page;
    const antwort = await page.goto(`${basis}${pfad}`);
    assert.ok(antwort?.ok(), `Seite konnte nicht geladen werden: ${pfad}`);
  }

  async function api(antwort) {
    assert.ok(antwort.ok(), `${antwort.status()} ${new URL(antwort.url()).pathname}`);
    return antwort.json();
  }

  async function pruefeKern(page, fonds) {
    const region = (name) => page.getByRole("region", { name, exact: true });
    await oeffne(page, "/portfolio", "portfolio-dashboard");
    const tabelle = region("Kennzahlen je Fonds");
    await tabelle.getByRole("cell", { name: fonds.name, exact: true }).waitFor();
    assert.equal(await tabelle.getAttribute("tabindex"), "0");
    await pruefe(page, "portfolio-dashboard");

    await oeffne(page, `/funds/${fonds.id}`, "fondsuebersicht");
    await page.getByRole("heading", { name: fonds.name, exact: true }).waitFor();
    const beteiligung = region("Beteiligungen").getByRole("row").filter({ has: page.getByRole("cell", { name: "Offene Beteiligung", exact: true }) }).getByRole("link").first();
    await beteiligung.waitFor();
    await pruefe(page, "fondsuebersicht");

    schritt = "beteiligung";
    await beteiligung.click();
    await page.waitForURL(/\/investments\/[^/]+/);
    const beteiligungPfad = new URL(page.url()).pathname;
    await oeffne(page, `${beteiligungPfad}?tab=financing&subtab=cap-table`, "captable");
    await region("Captable nach Inhaber und Klasse").getByRole("cell").first().waitFor();
    await pruefe(page, "captable");

    await oeffne(page, `/funds?fundId=${fonds.id}&tab=capital`, "kapital");
    await region("Kapitalbewegungen des Fonds").getByRole("cell", { name: "Kapitalabruf", exact: true }).first().waitFor();
    await pruefe(page, "kapital");

    await oeffne(page, "/dealflow", "dealflow");
    await page.getByRole("link").and(page.locator('a[href^="/deals/"]')).first().waitFor();
    await pruefe(page, "dealflow");

    await oeffne(page, "/contacts?object=person", "kontakte");
    await page.getByRole("heading", { name: "Kontakte", exact: true }).waitFor();
    await page.getByRole("main").getByRole("link").and(page.locator('a[href^="/people/"]')).first().waitFor();
    await pruefe(page, "kontakte");

    await page.evaluate(() => localStorage.setItem("carraway.sprache", "en"));
    await oeffne(page, `/funds/${fonds.id}`, "fondsuebersicht-en");
    await region("Holdings").getByRole("link").first().waitFor();
    await pruefe(page, "fondsuebersicht-en", "en");
    await page.evaluate(() => localStorage.setItem("carraway.sprache", "de"));
  }

  async function pruefeBericht(fonds) {
    const berta = await anmelden("berta");
    await oeffne(berta, `/reports?fundId=${fonds.id}`, "bericht-anlegen");
    await berta.getByRole("button", { name: "Bericht anlegen", exact: true }).click();
    const dialog = berta.getByRole("dialog", { name: "Bericht anlegen" });
    await dialog.getByLabel("Stichtag (optional)").fill("2026-09-30");
    await pruefe(berta, "bericht-anlegen");
    await dialog.getByRole("button", { name: "Bericht anlegen", exact: true }).click();
    await berta.waitForURL(/\/reports\/[0-9a-f-]+$/);
    const pfad = new URL(berta.url()).pathname;
    await berta.getByRole("button", { name: / erteilen$/ }).waitFor();
    assert.ok(await berta.getByRole("button", { name: / erteilen$/ }).isDisabled(), "Die Erstellerin darf keine Freigabestufe erteilen.");
    await berta.context().close();

    // Die Demo verwendet drei Stufen. Jede braucht eine andere freigabeberechtigte Person.
    for (const rolle of ["frieda", "friedrich", "vera"]) {
      const page = await anmelden(rolle);
      const [kontrolle] = await Promise.all([
        page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/reports/${pfad.split("/").at(-1)}/checks`),
        oeffne(page, pfad, `bericht-freigabe-${rolle}`),
      ]);
      const ueberschreiben = (await api(kontrolle)).total === "discrepancy" && rolle === "vera";
      if (ueberschreiben) await page.getByLabel("Begründung der Überschreibung").fill("Release-Abnahme mit Beispieldaten");
      await page.getByRole("button", { name: ueberschreiben ? /^Trotz Abweichungen freigeben$/ : / erteilen$/ }).click();
      await page.getByRole("region", { name: "Freigabe in Stufen" }).getByText(new RegExp(`^${rolle} Beispiel,`, "i")).waitFor();
      if (rolle === "vera") {
        await page.getByText("Der Bericht ist freigegeben. Die Datei ist unveränderlich gespeichert.", { exact: true }).waitFor();
        await page.getByRole("tab", { name: "Datei", exact: true }).click();
        const [datei] = await Promise.all([
          page.waitForEvent("download"),
          page.getByRole("link", { name: "Freigegebene Datei herunterladen" }).click(),
        ]);
        assert.equal(await datei.failure(), null);
        assert.match(datei.suggestedFilename(), /\.pdf$/);
      }
      await pruefe(page, `bericht-freigabe-${rolle}`);
      await page.context().close();
    }
  }

  try {
    browser = await chromium.launch();
    const vera = await anmelden("vera", true);
    schritt = "demo-fonds";
    const { data } = await api(await vera.request.get(`${basis}/api/v1/funds`));
    const fonds = data.find((f) => f.shortName === "BF I");
    assert.ok(fonds, "Beispielfonds I ist vorhanden.");
    await pruefeKern(vera, fonds);
    await pruefeBericht(fonds);
    await pruefeErweiterungen?.({
      vera, fonds, basis, anmelden, oeffne, pruefe,
      setzeSchritt: (name) => { schritt = name; },
    });
  } catch (fehler) {
    befund.fehler.push({ schritt, text: fehler.message });
    if (aktuelleSeite && !aktuelleSeite.isClosed()) {
      await bild(aktuelleSeite, "fehler").catch((e) => befund.fehler.push({ schritt, text: e.message }));
    }
  } finally {
    await browser?.close().catch((e) => befund.fehler.push({ schritt: "browser-beenden", text: e.message }));
  }
  const axeFehler = befund.schritte.flatMap(({ axe }) => axe.filter(({ impact }) => impact === "serious" || impact === "critical"));
  const anzahl = axeFehler.length + befund.schritte.reduce((summe, { funde }) => summe + funde.length, 0)
    + befund.fehler.length + befund.konsole.length + befund.anfragen.length;
  await writeFile(join(ausgabe, "bericht.json"), JSON.stringify({ ...befund, bestanden: anzahl === 0 }, null, 2) + "\n");
  if (anzahl) throw new Error(`${anzahl} Fehler in der Browser-Abnahme (${ausgabe}/bericht.json)`);
}
