// Anmeldung und Prüfungen für Browserläufe mit Beispieldaten.
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as warte } from "node:timers/promises";

const require = createRequire(import.meta.url);
const axeQuelle = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

// Demo-Zugänge aus der Zugangsdatei lesen (Adresse, Passwort, Geheimnis).
const zugangsDatei = fs.readFileSync(new URL("../../packages/db/demo-accounts.md", import.meta.url), "utf8");
const ZUGAENGE = {};
for (const zeile of zugangsDatei.split("\n")) {
  const m = /^\| ([A-Za-zäöüß]+) Beispiel \| `([^`]+)` \| `([^`]+)` \| `([^`]+)` \|/.exec(zeile);
  if (m) ZUGAENGE[m[1].toLowerCase()] = { name: m[1], email: m[2], passwort: m[3], geheimnis: m[4] };
}

function base32(text) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of text.replace(/=+$/, "")) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
}
function totp(geheimnis) {
  const zaehler = Math.floor(Date.now() / 30000);
  const puffer = Buffer.alloc(8);
  puffer.writeBigUInt64BE(BigInt(zaehler));
  const h = createHmac("sha1", base32(geheimnis)).update(puffer).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

export async function meldeAn(page, wer, { basis, pruefeSchritt }) {
  const z = ZUGAENGE[wer];
  if (!z) throw new Error(`Unbekannter Zugang ${wer}`);
  await page.goto(`${basis}/sign-in`);
  const adresse = page.getByLabel(/E-Mail-Adresse|Email address/);
  await adresse.fill(z.email);
  await pruefeSchritt?.("adresse");
  await page.getByRole("button", { name: /^(Weiter|Next)$/ }).click();
  await page.getByLabel(/^(Passwort|Password)$/).fill(z.passwort);
  await pruefeSchritt?.("passwort");
  await page.getByRole("button", { name: /^(Anmelden|Sign in)$/ }).click();
  const codeFeld = page.getByLabel(/^(Ziffer 1 von 6|Digit 1 of 6)$/);
  await codeFeld.waitFor({ timeout: 10000 });
  await pruefeSchritt?.("zweiter-faktor");
  // Kurz vor dem Wechsel auf das nächste Zeitfenster warten, damit der Code auch beim Absenden gültig ist.
  const rest = 30000 - Date.now() % 30000;
  if (rest < 2000) await warte(rest + 50);
  await codeFeld.pressSequentially(totp(z.geheimnis));
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 10000 });
  return z;
}

// Muster für Texte, die nach einem nicht übersetzten Schlüssel oder einem Platzhalter aussehen.
const SCHLUESSEL_MUSTER = [/\b(?:undefined|NaN)\b|\[object Object\]/, /\b[a-z]+(?:\.[a-z][A-Za-z]+){2,}\b/, /\b[A-Z]{3,}(?:_[A-Z]+){1,}\b/];
export function uebersetzungsFunde(text) {
  const bereinigt = text.replace(/\bhttps?:\/\/\S+|\S+@\S+|\b\d[\d.:-]*\b/g, "");
  return SCHLUESSEL_MUSTER.flatMap((muster) => {
    const treffer = muster.exec(bereinigt);
    return treffer ? [`verdächtiger Text „${treffer[0]}“`] : [];
  });
}

export async function axePruefen(page, { alleRegeln = false } = {}) {
  await page.evaluate(axeQuelle);
  return page.evaluate(async (alleRegeln) => {
    const optionen = { resultTypes: ["violations"] };
    if (!alleRegeln) optionen.runOnly = { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] };
    const r = await globalThis.axe.run(document, optionen);
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, hilfe: v.help, knoten: v.nodes.length, beispiele: v.nodes.slice(0, 3).map((n) => ({ ziel: n.target.join(" "), html: n.html.slice(0, 160), grund: (n.any[0] ?? n.all[0] ?? n.none[0])?.message?.slice(0, 200) })) }));
  }, alleRegeln);
}
