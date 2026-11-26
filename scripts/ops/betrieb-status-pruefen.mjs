// Prüft den Betriebsstatus eines laufenden Stacks (`GET /operations/status`, nur globale Verwalter): Gesamtstatus muss „ok“ (grün) sein.
//   node scripts/ops/betrieb-status-pruefen.mjs [--basis http://127.0.0.1:8790] [--frist 60]
// Wartet bis zur Frist, weil der Worker-Herzschlag nach einem Start einige Sekunden braucht. Nur für Demo- und Testbestände.
import { meldeAn } from "./api-anmeldung.mjs";

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? standard : (process.argv[i + 1] ?? standard);
};
const basis = String(arg("basis", "http://127.0.0.1:8790")).replace(/\/$/, "");
const frist = Number(arg("frist", "60")) * 1000;
const { anfrage } = await meldeAn(basis);
const ende = Date.now() + frist;
let status;
do {
  const r = await anfrage("/operations/status");
  status = await r.json();
  if (status.status === "ok") break;
  await new Promise((f) => setTimeout(f, 2000));
} while (Date.now() < ende);
console.log(JSON.stringify(status, null, 2));
const gruen = status.status === "ok";
console.log(`${gruen ? "OK    " : "FEHLER"} Gesamtstatus: ${status.status}`);
process.exit(gruen ? 0 : 1);
