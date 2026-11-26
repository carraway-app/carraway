// Prüft gegen einen laufenden Stack (Image oder Compose), dass die lokale Texterkennung im Worker arbeitet:
// lädt ein gescanntes PDF (nur Bild, keine Textebene) über die API hoch und wartet, bis der erkannte Text erscheint.
//   node scripts/ops/ocr-image-pruefen.mjs --pdf <scan.pdf> [--basis http://127.0.0.1:8790] [--erwartet "Rechnung 4711"] [--frist 120]
// Voraussetzung: Stack mit `OCR=lokal` und Demo-Daten (`pnpm db:seed`); gemeldet wird (über `api-anmeldung.mjs`) mit der Verwalterin aus packages/db/demo-zugaenge.md.
// Die Datei ist ein erfundenes Beispiel; es werden keine echten Daten gelesen oder gesendet.
import fs from "node:fs";
import { meldeAn } from "./api-anmeldung.mjs";

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? standard : (process.argv[i + 1] ?? standard);
};
const BASIS = String(arg("basis", "http://127.0.0.1:8790")).replace(/\/$/, "");
const PDF = arg("pdf", "");
const ERWARTET = String(arg("erwartet", "Rechnung 4711"));
const FRIST_S = Number(arg("frist", "120"));
if (!PDF || !fs.existsSync(String(PDF))) {
  console.error("Aufruf: node scripts/ops/ocr-image-pruefen.mjs --pdf <scan.pdf> [--basis <Adresse>] [--erwartet <Text>] [--frist <Sekunden>]");
  process.exit(2);
}

const t0 = Date.now();
const { anfrage } = await meldeAn(BASIS);

const fonds = await (await anfrage("/fonds")).json();
const fondsId = (fonds.daten ?? fonds)[0]?.id;
if (!fondsId) throw new Error("Kein Fonds gefunden (Demo-Daten fehlen).");

const formular = new FormData();
// Ein Kommentar hinter dem Dateiende macht jeden Lauf zu einer neuen Datei (sonst meldet die API eine Dublette) und lässt das PDF gültig.
const inhalt = Buffer.concat([fs.readFileSync(String(PDF)), Buffer.from(`\n% ocr-pruefung ${Date.now()}\n`)]);
formular.set("datei", new Blob([inhalt], { type: "application/pdf" }), `ocr-pruefung-${Date.now()}.pdf`);
formular.set("ziele", JSON.stringify([{ typ: "fonds", id: fondsId }]));
const hoch = await anfrage("/dokumente", { method: "POST", body: formular });
if (hoch.status !== 201) throw new Error(`Upload fehlgeschlagen: ${hoch.status} ${await hoch.text()}`);
const dokument = await hoch.json();
console.log(`Hochgeladen: ${dokument.id}, Stand ${dokument.textStatus}`);

const ende = Date.now() + FRIST_S * 1000;
let stand = dokument.textStatus;
while (Date.now() < ende && !["vorhanden", "fehler", "kein_text"].includes(stand)) {
  await new Promise((r) => setTimeout(r, 1000));
  stand = (await (await anfrage(`/dokumente/${dokument.id}`)).json()).textStatus;
}
const sekunden = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`Stand nach ${sekunden} s: ${stand}`);
const seite = await (await anfrage(`/dokumente/${dokument.id}/seiten/1`)).json();
console.log(`Seite 1: Quelle ${seite.quelle}, Sicherheit ${seite.konfidenz ?? "?"}`);
console.log(`Text: ${String(seite.text ?? "").replace(/\s+/g, " ").trim()}`);
const suche = await (await anfrage(`/dokumente/suche?q=${encodeURIComponent(ERWARTET)}`)).json();
const treffer = (suche.daten ?? []).some((x) => x.dokumentId === dokument.id || x.id === dokument.id);
const gefunden = String(seite.text ?? "").includes(ERWARTET);
console.log(`${gefunden ? "OK    " : "FEHLER"} erwarteter Text "${ERWARTET}" in der Seite; Suche findet das Dokument: ${treffer ? "ja" : "nein"}`);
process.exit(gefunden && stand === "vorhanden" ? 0 : 1);
