// Anmeldung an der API eines laufenden Stacks mit der Demo-Verwalterin (Adresse, Passwort und Geheimnis des zweiten Faktors aus
// packages/db/demo-zugaenge.md, erfunden und öffentlich); für die Probeskripte in scripts/ops. Nur für Demo- und Testbestände.
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function zugang() {
  const zeile = fs
    .readFileSync(path.resolve("packages/db/demo-zugaenge.md"), "utf8")
    .split("\n")
    .map((z) => /^\| Vera Beispiel \| `([^`]+)` \| `([^`]+)` \| `([^`]+)` \|/.exec(z))
    .find(Boolean);
  if (!zeile) throw new Error("Zugang der Verwalterin nicht in packages/db/demo-zugaenge.md gefunden (erst pnpm db:seed).");
  return { email: zeile[1], passwort: zeile[2], geheimnis: zeile[3] };
}

function base32(text) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of text.replace(/=+$/, "")) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
}
function totp(geheimnis, versatz = 0) {
  const puffer = Buffer.alloc(8);
  puffer.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + versatz));
  const h = createHmac("sha1", base32(geheimnis)).update(puffer).digest();
  const o = h[h.length - 1] & 15;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, "0");
}

/** Meldet sich an und liefert `anfrage(pfad, optionen)` (Pfad unter /api/v1, Sitzungs-Cookies werden mitgeführt). */
export async function meldeAn(basis) {
  const { email, passwort, geheimnis } = zugang();
  const kekse = new Map();
  const anfrage = async (pfad, optionen = {}) => {
    const r = await fetch(`${basis}/api/v1${pfad}`, {
      ...optionen,
      headers: { origin: basis, cookie: [...kekse].map(([k, v]) => `${k}=${v}`).join("; "), ...optionen.headers },
    });
    for (const c of r.headers.getSetCookie()) {
      const [name, ...rest] = c.split(";")[0].split("=");
      if (rest.join("=") === "") kekse.delete(name);
      else kekse.set(name, rest.join("="));
    }
    return r;
  };
  const json = (pfad, koerper) => anfrage(pfad, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(koerper) });
  await json("/auth/sign-in/email", { email, password: passwort });
  for (const versatz of [0, 1, -1]) {
    if ((await json("/auth/two-factor/verify-totp", { code: totp(geheimnis, versatz) })).ok) return { anfrage };
  }
  throw new Error("Anmeldung mit zweitem Faktor fehlgeschlagen.");
}
