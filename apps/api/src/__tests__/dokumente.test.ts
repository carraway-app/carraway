import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { sql } from "drizzle-orm";
import * as s from "@carraway/db";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DateiSpeicher } from "../berichte/speicher";
import { bereinigeText } from "../dokumente/text";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, legePersonAn, person, type TestApp, type Testperson } from "./hilfen-auth";
import { baueZip } from "./hilfen-zip";
import { verarbeiteOfficeTexte } from "../dokumente/nachverarbeitung";
import { erzeugeDocx, erzeugeDocxMitText, erzeugePdf, erzeugeXlsx, JPEG, legeWeltAn, PNG, verschluesseltesPdf, zaehleZeilen, type Welt } from "./hilfen-dokumente";

const { db, pool } = oeffneTestdb();
let verzeichnis = "";
let t: TestApp;
let w: Welt;

const BEARB1 = person("dok-bearb1");
const BETRACHTER1 = person("dok-betr1");
const VERWALTER1 = person("dok-verw1");
const BEARB2 = person("dok-bearb2");
const ADMIN = person("dok-admin", { globalVerwalter: true });

beforeAll(async () => {
  verzeichnis = await mkdtemp(join(tmpdir(), "carraway-dokumente-"));
  t = erstelleTestApp(db, { speicher: new DateiSpeicher(verzeichnis) });
});
beforeEach(async () => {
  await leeren(db);
  w = await legeWeltAn(db);
  Object.assign(BEARB1, { rollen: { [w.fonds1]: "bearbeiter" } });
  Object.assign(BETRACHTER1, { rollen: { [w.fonds1]: "betrachter" } });
  Object.assign(VERWALTER1, { rollen: { [w.fonds1]: "verwalter" } });
  Object.assign(BEARB2, { rollen: { [w.fonds2]: "bearbeiter" } });
  // Die Fonds-IDs ändern sich mit jeder Welt: Rollen neu schreiben (die Test-App legt Personen sonst nur einmal an).
  for (const p of [BEARB1, BETRACHTER1, VERWALTER1, BEARB2, ADMIN]) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
  await rm(verzeichnis, { recursive: true, force: true });
});

type Ziele = { typ: string; id: string }[];
const ziel1 = (): Ziele => [{ typ: "beteiligung", id: w.beteiligung1 }];
const ziel2 = (): Ziele => [{ typ: "beteiligung", id: w.beteiligung2 }];

function hochladen(bytes: Uint8Array, name: string, ziele: Ziele, als: Testperson = BEARB1, extra: Record<string, string> = {}) {
  const f = new FormData();
  f.append("datei", new File([new Uint8Array(bytes)], name));
  f.append("ziele", JSON.stringify(ziele));
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return t.request("/documents", { method: "POST", body: f, als });
}
async function lege(bytes: Uint8Array, name = "vertrag.pdf", ziele: Ziele = ziel1(), als: Testperson = BEARB1, extra: Record<string, string> = {}) {
  const antwort = await hochladen(bytes, name, ziele, als, extra);
  expect(antwort.status, await antwort.clone().text()).toBe(201);
  return (await json(antwort)) as { id: string; mime: string; textStatus: string; seitenzahl: number | null; verknuepfungen: { typ: string; id: string; name: string }[]; klassifikation: string; vertraulich: boolean };
}
const eindeutig = (kopf: string) => erzeugePdf([`${kopf} ${Math.random().toString(36).slice(2)}`, "Zweite Seite mit weiterem Text zur Prüfung."]);

describe("Upload: erlaubte Typen nach den ersten Bytes", () => {
  it("nimmt PDF, PNG, JPEG, DOCX und XLSX an; der Typ kommt aus dem Inhalt", async () => {
    const pdf = await lege(eindeutig("Typtest"));
    expect(pdf.mime).toBe("application/pdf");
    expect((await lege(PNG, "bild.png")).mime).toBe("image/png");
    expect((await lege(JPEG, "foto.jpg")).mime).toBe("image/jpeg");
    expect((await lege(erzeugeDocx(), "text.docx")).mime).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect((await lege(await erzeugeXlsx(), "tabelle.xlsx")).mime).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  it("ein PDF mit der Endung .png bleibt ein PDF (Name und Inhaltstyp der Anfrage zählen nicht)", async () => {
    const d = await lege(eindeutig("Umbenannt"), "scan.png");
    expect(d.mime).toBe("application/pdf");
    const antwort = await t.request(`/documents/${d.id}/file`, { als: BEARB1 });
    expect(antwort.headers.get("content-type")).toBe("application/pdf");
  });

  it("lehnt Text, Programme, alte Office-Formate und fremde ZIP-Archive ab (415)", async () => {
    for (const [bytes, name] of [
      [Buffer.from("Das ist nur Text.\n"), "notiz.pdf"],
      [Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), "programm.pdf"],
      [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "alt.doc"],
      [Buffer.from("<html><script>alert(1)</script></html>"), "seite.png"],
    ] as const) {
      const antwort = await hochladen(bytes, name, ziel1());
      expect(antwort.status, name).toBe(415);
      expect((await json(antwort)).error.code).toBe("document_type_not_allowed");
    }
    // gültiges Archiv, aber ohne die Kennzeichen von Word oder Excel
    const ohneKennung = baueZip([{ name: "a.txt", inhalt: Buffer.from("x"), gepackt: deflateRawSync(Buffer.from("x")) }]);
    expect((await hochladen(ohneKennung, "daten.docx", ziel1())).status).toBe(415);
  });

  it("lehnt eine Zip-Bombe im DOCX-Gewand ab, auch bei gefälschten Größenangaben (422 document_unsafe)", async () => {
    const nullen = Buffer.alloc(8 * 1024 * 1024);
    const bombe = erzeugeDocx([{ name: "word/media/riesig.bin", inhalt: nullen }]);
    expect(bombe.length).toBeLessThan(200 * 1024);
    const antwort = await hochladen(bombe, "angebot.docx", ziel1());
    expect(antwort.status).toBe(422);
    expect((await json(antwort)).error.code).toBe("document_unsafe");
    const gefaelscht = erzeugeDocx([{ name: "word/media/riesig.bin", inhalt: nullen, erklaert: 100 }]);
    expect((await hochladen(gefaelscht, "angebot2.docx", ziel1())).status).toBe(422);
    expect(await zaehleZeilen(db, "dokument")).toBe(0);
  });

  it("lehnt Office-Dateien mit Makros ab", async () => {
    const antwort = await hochladen(erzeugeDocx([{ name: "word/vbaProject.bin", inhalt: Buffer.from("makro") }]), "makro.docx", ziel1());
    expect(antwort.status).toBe(422);
    expect((await json(antwort)).error.code).toBe("document_unsafe");
  });

  it("lehnt verschlüsselte PDF-Dateien mit eigener Meldung ab (422 pdf_encrypted)", async () => {
    const antwort = await hochladen(verschluesseltesPdf(), "geheim.pdf", ziel1());
    expect(antwort.status).toBe(422);
    const fehler = (await json(antwort)).error;
    expect(fehler.code).toBe("pdf_encrypted");
    expect(fehler.message).toContain("password");
    expect(await zaehleZeilen(db, "dokument")).toBe(0);
  });

  it("Grenzen: leere Datei 422, mehr als 25 MB 413, ohne Datei oder ohne Ziele 400", async () => {
    expect((await hochladen(Buffer.alloc(0), "leer.pdf", ziel1())).status).toBe(422);
    const gross = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(26 * 1024 * 1024)]);
    const antwort = await hochladen(gross, "gross.pdf", ziel1());
    expect(antwort.status).toBe(413);
    expect((await json(antwort)).error.code).toBe("document_too_large");
    const ohneDatei = new FormData();
    ohneDatei.append("ziele", JSON.stringify(ziel1()));
    const a2 = await t.request("/documents", { method: "POST", body: ohneDatei, als: BEARB1 });
    expect(a2.status).toBe(400);
    expect((await json(a2)).error.code).toBe("file_missing");
    const a3 = await hochladen(PNG, "x.png", []);
    expect(a3.status).toBe(400);
    expect((await json(a3)).error.code).toBe("invalid_input");
    const a4 = await hochladen(PNG, "x.png", ziel1(), BEARB1, { klassifikation: "geheim" });
    expect(a4.status).toBe(400);
  });

  it("Klassifikation, Vertraulichkeit und bereinigter Dateiname", async () => {
    const d = await lege(eindeutig("Name"), "..\\..\\etc/pass\u202ewd\r\n.pdf", ziel1(), BEARB1, { klassifikation: "vertrag", vertraulich: "true" });
    expect(d.klassifikation).toBe("vertrag");
    expect(d.vertraulich).toBe(true);
    const detail = await json(await t.request(`/documents/${d.id}`, { als: BEARB1 }));
    expect(detail.dateiname).not.toMatch(/[\\/\r\n\u202e]/);
    expect(detail.dateiname.endsWith(".pdf")).toBe(true);
  });
});

describe("Dubletten (SHA-256)", () => {
  it("dasselbe Dokument nochmals: 409 mit dem vorhandenen, ohne etwas zu ändern", async () => {
    const bytes = eindeutig("Dublette");
    const erste = await lege(bytes, "a.pdf", ziel1(), BEARB1, { klassifikation: "vertrag", vertraulich: "true" });
    const zweite = await hochladen(bytes, "b.pdf", ziel1(), BEARB1, { klassifikation: "beleg", vertraulich: "false" });
    expect(zweite.status).toBe(409);
    const fehler = (await json(zweite)).error;
    expect(fehler.code).toBe("document_exists");
    expect(fehler.dokumentId).toBe(erste.id);
    const danach = await json(await t.request(`/documents/${erste.id}`, { als: BEARB1 }));
    expect(danach.klassifikation).toBe("vertrag");
    expect(danach.vertraulich).toBe(true);
    expect(await zaehleZeilen(db, "dokument")).toBe(1);
  });

  it("über Fonds hinweg: kein Hinweis auf fremde Dokumente, jeder Fonds bekommt sein eigenes; die Antwort nennt nur sichtbare Verknüpfungen", async () => {
    const bytes = eindeutig("Gemeinsam");
    const a = await lege(bytes, "a.pdf", ziel1(), BEARB1, { klassifikation: "vertrag", vertraulich: "true" });
    // Fonds 2 lädt dieselben Bytes hoch: neues Dokument, kein 409, das Dokument des Fonds 1 bleibt unverändert.
    const b = await lege(bytes, "b.pdf", ziel2(), BEARB2);
    expect(b.id).not.toBe(a.id);
    expect(b.klassifikation).toBe("sonstiges");
    const aNachher = await json(await t.request(`/documents/${a.id}`, { als: BEARB1 }));
    expect([aNachher.klassifikation, aNachher.vertraulich]).toEqual(["vertrag", true]);
    // beide Dokumente zeigen auf dieselbe Datei in der Ablage
    const schluessel = (await db.execute(sql`SELECT DISTINCT gespeichert_unter FROM dokument`)).rows;
    expect(schluessel).toHaveLength(1);
    // Erneut aus Fonds 2: 409 mit dem eigenen Dokument, ohne Verknüpfung zu Fonds 1.
    const nochmal = await hochladen(bytes, "c.pdf", ziel2(), BEARB2);
    expect(nochmal.status).toBe(409);
    const fehler = (await json(nochmal)).error;
    expect(fehler.dokumentId).toBe(b.id);
    expect(JSON.stringify(fehler)).not.toContain(w.beteiligung1);
    expect(JSON.stringify(fehler)).not.toContain(a.id);
  });
});

describe("Rechte folgen den verknüpften Zielen", () => {
  it("Betrachter lesen, laden aber nicht hoch; fremde Fonds sehen das Dokument nicht (404) und können nicht daran verknüpfen", async () => {
    const d = await lege(eindeutig("Rechte"));
    expect((await hochladen(PNG, "x.png", ziel1(), BETRACHTER1)).status).toBe(403);
    expect((await t.request(`/documents/${d.id}`, { als: BETRACHTER1 })).status).toBe(200);
    expect((await t.request(`/documents/${d.id}`, { als: BEARB2 })).status).toBe(404);
    expect((await t.request(`/documents/${d.id}/file`, { als: BEARB2 })).status).toBe(404);
    expect((await t.request(`/documents/${d.id}/pages/1`, { als: BEARB2 })).status).toBe(404);
    expect(((await json(await t.request("/documents", { als: BEARB2 }))).daten as unknown[]).length).toBe(0);
    expect(((await json(await t.request("/documents", { als: BETRACHTER1 }))).daten as unknown[]).length).toBe(1);
    // Hochladen auf ein Ziel eines fremden Fonds und mit gemischten Zielen: 403
    expect((await hochladen(PNG, "y.png", ziel2(), BEARB1)).status).toBe(403);
    expect((await hochladen(PNG, "z.png", [...ziel1(), ...ziel2()], BEARB1)).status).toBe(403);
    // Verknüpfen an einem fremden Ziel ist verboten, an einem eigenen erlaubt
    const fremd = await t.request(`/documents/${d.id}/links`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ziel2()[0]), als: BEARB1 });
    expect(fremd.status).toBe(403);
    expect(await zaehleZeilen(db, "dokument")).toBe(1);
  });

  it("ein Dokument mit zwei Zielen sehen die Personen beider Fonds; nur die eigenen Verknüpfungen stehen in der Antwort", async () => {
    const d = await lege(eindeutig("Zwei Ziele"), "z.pdf", [...ziel1(), ...ziel2()], ADMIN);
    expect(d.verknuepfungen).toHaveLength(2);
    const fuerBearb2 = await json(await t.request(`/documents/${d.id}`, { als: BEARB2 }));
    expect(fuerBearb2.verknuepfungen.map((v: { id: string }) => v.id)).toEqual([w.beteiligung2]);
    expect(fuerBearb2.verknuepfungen[0].name).toContain("Südwind Medizin GmbH");
    // Ändern verlangt Bearbeiter an jedem Ziel: BEARB1 allein darf nicht, ADMIN schon.
    const patch = (als: Testperson) => t.request(`/documents/${d.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ klassifikation: "beschluss" }), als });
    expect((await patch(BEARB1)).status).toBe(403);
    expect((await patch(ADMIN)).status).toBe(200);
  });

  it("Organisation ohne Beteiligung sehen nur globale Verwalter; Deal ohne Fonds jede Person mit Rolle", async () => {
    const ohneBeteiligung = await lege(eindeutig("Ostblick"), "o.pdf", [{ typ: "organisation", id: w.org3 }], ADMIN);
    expect((await t.request(`/documents/${ohneBeteiligung.id}`, { als: BEARB1 })).status).toBe(404);
    const dealOhneFonds = await lege(eindeutig("Deal"), "d.pdf", [{ typ: "deal", id: w.deal2 }], ADMIN);
    expect((await t.request(`/documents/${dealOhneFonds.id}`, { als: BEARB1 })).status).toBe(200);
    // Organisation mit Beteiligung des Fonds 1: sichtbar für Fonds 1, nicht für Fonds 2
    const organisation = await lege(eindeutig("Nordlicht"), "n.pdf", [{ typ: "organisation", id: w.org1 }], BEARB1);
    expect((await t.request(`/documents/${organisation.id}`, { als: BEARB2 })).status).toBe(404);
    expect((await hochladen(PNG, "p.png", [{ typ: "organisation", id: w.org1 }], BEARB2)).status).toBe(403);
  });

  it("ein unbekanntes Ziel ist 404 target_not_found", async () => {
    const antwort = await hochladen(PNG, "p.png", [{ typ: "beteiligung", id: "00000000-0000-4000-8000-000000000000" }], ADMIN);
    expect(antwort.status).toBe(404);
    expect((await json(antwort)).error.code).toBe("target_not_found");
  });
});

describe("Download", () => {
  it("sichere Köpfe: nosniff, Disposition mit ASCII-Name, Sandbox; Protokollzeile `gelesen`", async () => {
    const d = await lege(eindeutig("Kopf"), 'Bericht "Nord"; äöü %n.pdf');
    const antwort = await t.request(`/documents/${d.id}/file`, { als: BEARB1 });
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("x-content-type-options")).toBe("nosniff");
    const kopf = antwort.headers.get("content-disposition")!;
    expect(kopf.startsWith("attachment;")).toBe(true);
    expect(/^[\x20-\x7e]*$/.test(kopf)).toBe(true);
    expect(kopf).toContain("filename*=UTF-8''");
    expect(kopf).not.toMatch(/filename="[^"]*["\\][^"]*"[^;]/);
    expect(antwort.headers.get("content-security-policy")).toContain("sandbox");
    expect(antwort.headers.get("cache-control")).toContain("no-store");
    const bytes = new Uint8Array(await antwort.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(antwort.headers.get("x-file-sha256"));
    const protokoll = await db.execute(sql`SELECT akteur, nachher FROM aenderung WHERE aktion = 'gelesen' AND tabelle = 'dokument' AND datensatz_id = ${d.id}`);
    expect(protokoll.rows).toHaveLength(1);
  });

  it("inline nur für PDF und Bilder, mit strenger Sandbox; Office-Dateien und HTML-artige Inhalte immer als Download", async () => {
    const pdf = await lege(eindeutig("Inline"));
    const inline = await t.request(`/documents/${pdf.id}/file?inline=1`, { als: BEARB1 });
    expect(inline.headers.get("content-disposition")!.startsWith("inline;")).toBe(true);
    const csp = inline.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("sandbox");
    expect(inline.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    const docx = await lege(erzeugeDocx(), "w.docx");
    const antwort = await t.request(`/documents/${docx.id}/file?inline=1`, { als: BEARB1 });
    expect(antwort.headers.get("content-disposition")!.startsWith("attachment;")).toBe(true);
    expect(antwort.headers.get("x-frame-options")).toBe("DENY");
    // ein als HTML getarnter Inhalt kommt gar nicht erst hinein
    expect((await hochladen(Buffer.from("<script>1</script>"), "a.pdf", ziel1())).status).toBe(415);
  });
});

describe("Ersetzen und Löschen", () => {
  it("Ersetzen legt eine neue Version an; die alte bleibt les- und ladbar, Verknüpfungen gehen über", async () => {
    const alt = await lege(eindeutig("Version eins"), "v.pdf", ziel1(), BEARB1, { klassifikation: "vertrag" });
    const f = new FormData();
    const neueBytes = eindeutig("Version zwei");
    f.append("datei", new File([new Uint8Array(neueBytes)], "v2.pdf"));
    const antwort = await t.request(`/documents/${alt.id}/replace`, { method: "POST", body: f, als: BEARB1 });
    expect(antwort.status).toBe(201);
    const neu = await json(antwort);
    expect(neu.vorgaengerId).toBe(alt.id);
    expect(neu.klassifikation).toBe("vertrag");
    expect(neu.verknuepfungen.map((v: { id: string }) => v.id)).toEqual([w.beteiligung1]);
    const altDetail = await json(await t.request(`/documents/${alt.id}`, { als: BEARB1 }));
    expect(altDetail.status).toBe("ersetzt");
    expect(altDetail.ersetztDurch).toBe(neu.id);
    expect((await t.request(`/documents/${alt.id}/file`, { als: BEARB1 })).status).toBe(200);
    const neuDetail = await json(await t.request(`/documents/${neu.id}`, { als: BEARB1 }));
    expect(neuDetail.vorgaenger.map((v: { id: string }) => v.id)).toEqual([alt.id]);
    // Liste: nur die aktive Version; ein zweites Ersetzen der alten Version ist nicht möglich
    const liste = await json(await t.request(`/documents?zielTyp=beteiligung&zielId=${w.beteiligung1}`, { als: BEARB1 }));
    expect(liste.daten.map((x: { id: string }) => x.id)).toEqual([neu.id]);
    const f2 = new FormData();
    f2.append("datei", new File([new Uint8Array(eindeutig("Version drei"))], "v3.pdf"));
    const nochmal = await t.request(`/documents/${alt.id}/replace`, { method: "POST", body: f2, als: BEARB1 });
    expect(nochmal.status).toBe(409);
    expect((await json(nochmal)).error.code).toBe("document_not_active");
  });

  it("Ersetzen mit denselben Bytes ist ein 409 document_exists", async () => {
    const bytes = eindeutig("Gleich");
    const alt = await lege(bytes);
    const f = new FormData();
    f.append("datei", new File([new Uint8Array(bytes)], "gleich.pdf"));
    const antwort = await t.request(`/documents/${alt.id}/replace`, { method: "POST", body: f, als: BEARB1 });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("document_exists");
  });

  it("Löschen ist weich und nur für Verwalter; die Datei bleibt in der Ablage, das Protokoll hält es fest", async () => {
    const d = await lege(eindeutig("Löschen"));
    const loeschen = (als: Testperson) => t.request(`/documents/${d.id}`, { method: "DELETE", als });
    expect((await loeschen(BEARB1)).status).toBe(403);
    expect((await loeschen(BETRACHTER1)).status).toBe(403);
    expect((await loeschen(VERWALTER1)).status).toBe(204);
    // weg aus Liste, Suche und Zugriff der Bearbeiter; Verwalter sehen es mit `status=geloescht`
    expect((await t.request(`/documents/${d.id}`, { als: BEARB1 })).status).toBe(404);
    expect(((await json(await t.request("/documents", { als: BEARB1 }))).daten as unknown[]).length).toBe(0);
    expect(((await json(await t.request("/documents?status=geloescht", { als: BEARB1 }))).daten as unknown[]).length).toBe(0);
    expect(((await json(await t.request("/documents?status=geloescht", { als: VERWALTER1 }))).daten as unknown[]).length).toBe(1);
    const zeile = (await db.execute(sql`SELECT status::text AS status, geloescht_von, gespeichert_unter FROM dokument WHERE id = ${d.id}`)).rows[0] as { status: string; geloescht_von: string; gespeichert_unter: string };
    expect(zeile.status).toBe("geloescht");
    expect(zeile.geloescht_von).toBeTruthy();
    expect((await readFile(join(verzeichnis, zeile.gespeichert_unter))).length).toBeGreaterThan(100);
    const protokoll = await db.execute(sql`SELECT aktion FROM aenderung WHERE tabelle = 'dokument' AND datensatz_id = ${d.id} ORDER BY am, id`);
    expect(protokoll.rows.map((r) => (r as { aktion: string }).aktion)).toEqual(["anlegen", "loeschen"]);
    // erneutes Löschen ändert nichts
    expect((await loeschen(VERWALTER1)).status).toBe(204);
  });

  it("Verknüpfungen: anlegen, entfernen, aber nie die letzte", async () => {
    const d = await lege(eindeutig("Links"));
    const verknuepfen = (ziel: object, als: Testperson = ADMIN) => t.request(`/documents/${d.id}/links`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ziel), als });
    expect((await verknuepfen({ typ: "organisation", id: w.org1 })).status).toBe(200);
    const mit = await json(await t.request(`/documents/${d.id}`, { als: ADMIN }));
    expect(mit.verknuepfungen).toHaveLength(2);
    const entfernen = (typ: string, id: string) => t.request(`/documents/${d.id}/links/${typ}/${id}`, { method: "DELETE", als: ADMIN });
    expect((await entfernen("organization", w.org1)).status).toBe(200);
    const letzte = await entfernen("investment", w.beteiligung1);
    expect(letzte.status).toBe(409);
    expect((await json(letzte)).error.code).toBe("document_last_link");
  });
});

describe("Aktuelle Dokumentansicht: Versionen und Fundstellen nach Fondsrechten (Issue #130)", () => {
  const ersetze = async (id: string, kopf: string) => {
    const f = new FormData();
    f.append("datei", new File([new Uint8Array(eindeutig(kopf))], `${kopf}.pdf`));
    const antwort = await t.request(`/documents/${id}/replace`, { method: "POST", body: f, als: ADMIN });
    expect(antwort.status).toBe(201);
    return (await json(antwort)).id as string;
  };
  const ansicht = async (id: string, als: Testperson) => {
    const d = await json(await t.request(`/documents/${id}`, { als }));
    return { vorgaenger: (d.vorgaenger as { id: string }[]).map((v) => v.id), ersetztDurch: d.ersetztDurch as string | null, fundstellen: (d.fundstellen as { feld: string }[]).map((f) => f.feld).sort() };
  };
  const trenne = (dokumentId: string, beteiligungId: string) => db.execute(sql`DELETE FROM dokument_verknuepfung WHERE dokument_id = ${dokumentId} AND ziel_typ = 'beteiligung' AND ziel_id = ${beteiligungId}`);

  it("zeigt nur Versionen und Fundstellen, die die Person selbst sehen darf; der andere Fonds bleibt verborgen", async () => {
    // Drei Versionen an beiden Fonds; danach hängen Version 1 und 3 nur noch am Fonds 2.
    const v1 = (await lege(eindeutig("Kette eins"), "k1.pdf", [...ziel1(), ...ziel2()], ADMIN)).id;
    const v2 = await ersetze(v1, "kette-zwei");
    const v3 = await ersetze(v2, "kette-drei");
    await trenne(v1, w.beteiligung1);
    await trenne(v3, w.beteiligung1);
    // Fundstellen der Version 2 an Objekten beider Fonds; die Anteilsklasse ist kein Dokumentziel und folgt den haltenden Fonds ihres Unternehmens.
    const [k1, k2] = await db.insert(s.anteilsklasse).values([{ organisationId: w.org1, name: "Serie A" }, { organisationId: w.org2, name: "Serie A" }]).returning();
    const quelle = (objektTyp: string, objektId: string, feld: string) => ({ objektTyp, objektId, feld, wert: "1", dokumentId: v2, seite: 1, zitat: "Zitat", erstelltVon: "test" });
    await db.insert(s.wertQuelle).values([quelle("beteiligung", w.beteiligung1, "a-beteiligung1"), quelle("beteiligung", w.beteiligung2, "b-beteiligung2"), quelle("anteilsklasse", k1!.id, "c-klasse1"), quelle("anteilsklasse", k2!.id, "d-klasse2")]);

    // Ohne Recht am Fonds 2: weder Vorgänger noch Nachfolger noch Fundstellen des Fonds 2.
    expect(await ansicht(v2, BEARB1)).toEqual({ vorgaenger: [], ersetztDurch: null, fundstellen: ["a-beteiligung1", "c-klasse1"] });
    expect((await t.request(`/documents/${v3}`, { als: BEARB1 })).status).toBe(404);
    // Mit Recht nur am Fonds 2 umgekehrt; der globale Verwalter sieht alles.
    expect(await ansicht(v2, BEARB2)).toEqual({ vorgaenger: [v1], ersetztDurch: v3, fundstellen: ["b-beteiligung2", "d-klasse2"] });
    expect(await ansicht(v2, ADMIN)).toEqual({ vorgaenger: [v1], ersetztDurch: v3, fundstellen: ["a-beteiligung1", "b-beteiligung2", "c-klasse1", "d-klasse2"] });

    // Eine unsichtbare Version in der Mitte wird übersprungen, die ältere sichtbare bleibt in der Kette.
    await trenne(v2, w.beteiligung2);
    expect((await ansicht(v3, BEARB2)).vorgaenger).toEqual([v1]);
    expect((await ansicht(v3, ADMIN)).vorgaenger).toEqual([v1, v2]);

    // Eine gelöschte Version sehen wie beim direkten Aufruf nur Verwalter (BEARB2 ist am Fonds 2 nur Bearbeiter).
    expect((await t.request(`/documents/${v1}`, { method: "DELETE", als: ADMIN })).status).toBe(204);
    expect((await ansicht(v3, BEARB2)).vorgaenger).toEqual([]);
    expect((await ansicht(v3, ADMIN)).vorgaenger).toEqual([v1, v2]);
  });

  it("historische Ansicht (Wissensstand): Fundstellen an Anteilsklasse, Rundenposition und Registereintrag folgen den Rechten wie in der aktuellen Ansicht (Issue #209)", async () => {
    const d = (await lege(eindeutig("Historisch"), "h.pdf", [...ziel1(), ...ziel2()], ADMIN)).id;
    const [k1, k2] = await db.insert(s.anteilsklasse).values([{ organisationId: w.org1, name: "Serie H" }, { organisationId: w.org2, name: "Serie H" }]).returning();
    const quelle = (objektTyp: string, objektId: string, feld: string) => ({ objektTyp, objektId, feld, wert: "1", dokumentId: d, seite: 1, zitat: "Zitat", erstelltVon: "test" });
    await db.insert(s.wertQuelle).values([quelle("beteiligung", w.beteiligung1, "a-beteiligung1"), quelle("beteiligung", w.beteiligung2, "b-beteiligung2"), quelle("anteilsklasse", k1!.id, "c-klasse1"), quelle("anteilsklasse", k2!.id, "d-klasse2")]);
    const stand = new Date(Date.now() + 3_600_000).toISOString();
    const historisch = async (als: Testperson) => ((await json(await t.request(`/documents/${d}?stand=${encodeURIComponent(stand)}`, { als }))).fundstellen as { feld: string }[]).map((f) => f.feld).sort();
    expect(await historisch(BEARB1)).toEqual(["a-beteiligung1", "c-klasse1"]);
    expect(await historisch(BEARB2)).toEqual(["b-beteiligung2", "d-klasse2"]);
    expect(await historisch(ADMIN)).toEqual(["a-beteiligung1", "b-beteiligung2", "c-klasse1", "d-klasse2"]);
    // Gleiches Ergebnis wie die aktuelle Ansicht.
    expect((await ansicht(d, BEARB1)).fundstellen).toEqual(await historisch(BEARB1));
    // Fundstellen, die erst nach dem Wissensstand entstanden sind, fehlen weiterhin.
    const frueh = new Date(Date.now() - 86_400_000).toISOString();
    expect(((await json(await t.request(`/documents/${d}?stand=${encodeURIComponent(frueh)}`, { als: ADMIN }))).fundstellen ?? []) as unknown[]).toEqual([]);
  });
});

describe("Fundstellen der Beteiligung (Herkunftsansicht)", () => {
  it("zeigt nur Fundstellen, die die Person am Objekt sehen darf; unbekannte Objekttypen werden abgewiesen", async () => {
    const d = await lege(eindeutig("Herkunft"), "herkunft.pdf", ziel1(), ADMIN);
    const quelle = (objektTyp: string, objektId: string, feld: string) => ({ objektTyp, objektId, feld, wert: "1", dokumentId: d.id, seite: 1, zitat: "Zitat", erstelltVon: "test" });
    await db.insert(s.wertQuelle).values([quelle("beteiligung", w.beteiligung1, "a-sichtbar")]);
    await expect(db.insert(s.wertQuelle).values([quelle("unbekannt", w.beteiligung1, "b-unbekannt")])).rejects.toThrow();
    for (const als of [BEARB1, ADMIN]) {
      const antwort = await json(await t.request(`/beteiligungen/${w.beteiligung1}`, { als }));
      expect((antwort.fundstellen as { feld: string }[]).map((f) => f.feld)).toEqual(["a-sichtbar"]);
    }
  });
});

describe("Verknüpfen erweitert den Kreis der Sichtbarkeit nicht unbefugt", () => {
  const verknuepfe = (id: string, ziel: object, als: Testperson) => t.request(`/documents/${id}/links`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ziel), als });

  it("Betrachter von Fonds 1 mit Bearbeiterrolle an Fonds 2 kann ein Dokument nicht an Fonds 2 hängen", async () => {
    const d = await lege(eindeutig("Quer"));
    const angreifer = person("dok-quer", { rollen: { [w.fonds1]: "betrachter", [w.fonds2]: "bearbeiter" } });
    await legePersonAn(db, angreifer);
    expect((await t.request(`/documents/${d.id}`, { als: angreifer })).status).toBe(200);
    const antwort = await verknuepfe(d.id, ziel2()[0]!, angreifer);
    expect(antwort.status).toBe(403);
    expect(await zaehleZeilen(db, "dokument_verknuepfung")).toBe(1);
    expect((await t.request(`/documents/${d.id}`, { als: BEARB2 })).status).toBe(404);
  });

  it("ein Ziel ohne Fonds (Deal vor der Zuordnung) verlangt Verwalter an den bisherigen Zielen", async () => {
    const d = await lege(eindeutig("Breit"));
    expect((await verknuepfe(d.id, { typ: "deal", id: w.deal2 }, BEARB1)).status).toBe(403);
    expect((await verknuepfe(d.id, { typ: "deal", id: w.deal2 }, VERWALTER1)).status).toBe(200);
  });

  it("ein vertrauliches Dokument verknüpfen nur Verwalter", async () => {
    const d = await lege(eindeutig("Vertraulich"), "v.pdf", ziel1(), BEARB1, { vertraulich: "true" });
    const ziel = { typ: "organisation", id: w.org1 };
    expect((await verknuepfe(d.id, ziel, BEARB1)).status).toBe(403);
    expect((await verknuepfe(d.id, ziel, VERWALTER1)).status).toBe(200);
  });

  it("Entfernen braucht Bearbeiter auch an den verbleibenden Zielen", async () => {
    const d = await lege(eindeutig("Entfernen"), "e.pdf", [...ziel1(), ...ziel2()], ADMIN);
    const zweiRollen = person("dok-zwei", { rollen: { [w.fonds1]: "bearbeiter", [w.fonds2]: "betrachter" } });
    await legePersonAn(db, zweiRollen);
    const entfernen = (als: Testperson) => t.request(`/documents/${d.id}/links/investment/${w.beteiligung1}`, { method: "DELETE", als });
    expect((await entfernen(zweiRollen)).status).toBe(403);
    expect((await entfernen(ADMIN)).status).toBe(200);
  });
});

describe("Textauszug und Volltextsuche", () => {
  it("zieht den Text je Seite; ein PDF ohne Text bekommt kein_text; Bilder nicht_unterstuetzt", async () => {
    const d = await lege(erzeugePdf(["Beteiligungsvertrag über eine Finanzierungsrunde", "Zweite Seite: Liquidationspräferenz 1,0x"]));
    expect(d.textStatus).toBe("vorhanden");
    expect(d.seitenzahl).toBe(2);
    const seiten = (await db.execute(sql`SELECT seite, text FROM dokument_seite WHERE dokument_id = ${d.id} ORDER BY seite`)).rows as { seite: number; text: string }[];
    expect(seiten.map((x) => x.seite)).toEqual([1, 2]);
    expect(seiten[1]!.text).toContain("Liquidationspräferenz");
    const seite = await json(await t.request(`/documents/${d.id}/pages/2`, { als: BEARB1 }));
    expect(seite.text).toContain("Liquidationspräferenz");
    expect((await t.request(`/documents/${d.id}/pages/9`, { als: BEARB1 })).status).toBe(404);
    const scan = await lege(erzeugePdf([]), "scan.pdf");
    expect([scan.textStatus, scan.seitenzahl]).toEqual(["kein_text", 1]);
    expect(await zaehleZeilen(db, "dokument_seite")).toBe(2);
    expect((await lege(PNG, "b.png")).textStatus).toBe("nicht_unterstuetzt");
  });

  it("zieht Text aus DOCX (Absätze, Tabellen, nach Länge und Abschnitt in Seiten) und aus XLSX (eine Seite je Blatt); beides ist durchsuchbar", async () => {
    const lang = Array.from({ length: 12 }, (_, i) => `Absatz ${i + 1}: ${"Die Gesellschafter vereinbaren Folgendes zur Finanzierung. ".repeat(5).trim()}`);
    const docx = await lege(erzeugeDocxMitText(["Vertragsentwurf Zyklon Alpha", ...lang, { text: "Ende des ersten Abschnitts", abschnitt: true }, "Zweiter Abschnitt mit Sonderrecht Q&A <Klausel>"], [["Gesellschafter", "Anteil"], ["Muster GmbH", "12,5 %"]]), "vertrag.docx");
    // Die Anfrage zieht keinen Text; der Worker tut es danach
    expect(docx.textStatus).toBe("ausstehend");
    expect(await zaehleZeilen(db, "dokument_seite")).toBe(0);
    expect(await verarbeiteOfficeTexte(db, new DateiSpeicher(verzeichnis))).toEqual({ verarbeitet: 1, fehler: 0 });
    expect((await json(await t.request(`/documents/${docx.id}`, { als: BEARB1 }))).textStatus).toBe("vorhanden");
    const seiten = (await db.execute(sql`SELECT seite, text FROM dokument_seite WHERE dokument_id = ${docx.id} ORDER BY seite`)).rows as { seite: number; text: string }[];
    expect((await json(await t.request(`/documents/${docx.id}`, { als: BEARB1 }))).seitenzahl).toBe(seiten.length);
    expect(seiten.length).toBeGreaterThanOrEqual(3);
    for (const x of seiten) expect(x.text.length).toBeLessThanOrEqual(3000 + 600);
    expect(seiten[0]!.text.startsWith("Vertragsentwurf Zyklon Alpha")).toBe(true);
    const alle = seiten.map((x) => x.text).join("\n");
    expect(alle).toContain("Sonderrecht Q&A <Klausel>");
    expect(alle).toContain("Muster GmbH\t12,5 %");
    // Der Abschnittswechsel beginnt eine neue Seite
    expect(seiten.find((x) => x.text.includes("Zweiter Abschnitt"))!.text.includes("Ende des ersten Abschnitts")).toBe(false);
    const treffer = await json(await t.request("/documents/search?q=Zyklon", { als: BEARB1 }));
    expect(treffer.daten).toHaveLength(1);

    const mappe = new ExcelJS.Workbook();
    mappe.addWorksheet("Kennzahlen").addRows([["Posten", "Betrag"], ["Umsatzerlöse Orion", 125000], ["", ""], ["Aufwand", 4.5]]);
    mappe.addWorksheet("Leer");
    mappe.addWorksheet("Planung").addRow(["Planwert Meridian", new Date(Date.UTC(2026, 0, 31))]);
    const xlsx = await lege(Buffer.from(await mappe.xlsx.writeBuffer()), "zahlen.xlsx");
    expect(await verarbeiteOfficeTexte(db, new DateiSpeicher(verzeichnis))).toEqual({ verarbeitet: 1, fehler: 0 });
    expect(await verarbeiteOfficeTexte(db, new DateiSpeicher(verzeichnis))).toEqual({ verarbeitet: 0, fehler: 0 });
    expect((await json(await t.request(`/documents/${xlsx.id}`, { als: BEARB1 }))).seitenzahl).toBe(2);
    const blaetter = (await db.execute(sql`SELECT seite, text FROM dokument_seite WHERE dokument_id = ${xlsx.id} ORDER BY seite`)).rows as { seite: number; text: string }[];
    expect(blaetter[0]!.text).toBe("Kennzahlen\nPosten\tBetrag\nUmsatzerlöse Orion\t125000\nAufwand\t4.5");
    expect(blaetter[1]!.text).toContain("Planung\nPlanwert Meridian");
    expect((await json(await t.request("/documents/search?q=Meridian", { als: BEARB1 }))).daten).toHaveLength(1);
  });

  it("ein Office-Dokument ohne Text bekommt kein_text; eine Dokumenttypdeklaration im DOCX macht den Auszug unlesbar (fehler), die Datei bleibt gespeichert", async () => {
    const leer = await lege(erzeugeDocxMitText([]), "leer.docx");
    const entitaet = '<?xml version="1.0"?><!DOCTYPE w [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>';
    const d = await lege(erzeugeDocxMitText(["Inhalt &b; Text"], [], entitaet), "entitaet.docx");
    expect(await verarbeiteOfficeTexte(db, new DateiSpeicher(verzeichnis))).toEqual({ verarbeitet: 1, fehler: 1 });
    expect((await json(await t.request(`/documents/${leer.id}`, { als: BEARB1 }))).textStatus).toBe("kein_text");
    expect((await json(await t.request(`/documents/${d.id}`, { als: BEARB1 }))).textStatus).toBe("fehler");
    expect(await zaehleZeilen(db, "dokument_seite")).toBe(0);
  });

  it("findet Wortformen (deutsche Stämme) und genaue Zahlen, mit Seite und markiertem Ausschnitt", async () => {
    await lege(erzeugePdf(["Deckblatt des Vertrags", "Die Gesellschafter vereinbaren eine Pre-Money-Bewertung von 4.000.000,00 EUR für die Finanzierungsrunde."]));
    const stamm = await json(await t.request("/documents/search?q=Finanzierungsrunden%20Bewertungen", { als: BEARB1 }));
    expect(stamm.daten).toHaveLength(1);
    expect(stamm.daten[0].seite).toBe(2);
    expect(stamm.daten[0].ausschnitt).toContain("\u27e6");
    const zahl = await json(await t.request(`/documents/search?q=${encodeURIComponent("4.000.000,00")}`, { als: BEARB1 }));
    expect(zahl.daten.length).toBeGreaterThanOrEqual(1);
    const nichts = await json(await t.request("/documents/search?q=Fischbrötchen", { als: BEARB1 }));
    expect(nichts.daten).toEqual([]);
    expect((await t.request("/documents/search?q=a", { als: BEARB1 })).status).toBe(400);
  });

  it("Suche nach Rechten: fremde Fonds, gelöschte und ersetzte Versionen erscheinen nicht; die globale Suche zeigt Dokumente", async () => {
    const a = await lege(erzeugePdf(["Geheimprojekt Alpenglühen: Konditionen und Fristen"]), "a.pdf", ziel1());
    const treffer = async (als: Testperson, q = "Alpenglühen") => (await json(await t.request(`/documents/search?q=${encodeURIComponent(q)}`, { als }))).daten as unknown[];
    expect(await treffer(BEARB1)).toHaveLength(1);
    expect(await treffer(BEARB2)).toHaveLength(0);
    const global = await json(await t.request("/suche?q=Alpenglühen", { als: BEARB1 }));
    expect(global.dokumente).toHaveLength(1);
    expect(global.dokumente[0].id).toBe(a.id);
    expect((await json(await t.request("/suche?q=Alpenglühen", { als: BEARB2 }))).dokumente).toHaveLength(0);
    const f = new FormData();
    f.append("datei", new File([new Uint8Array(erzeugePdf(["Neue Fassung ohne das Stichwort"]))], "a2.pdf"));
    expect((await t.request(`/documents/${a.id}/replace`, { method: "POST", body: f, als: BEARB1 })).status).toBe(201);
    expect(await treffer(BEARB1)).toHaveLength(0);
    expect(await treffer(BEARB1, "Fassung")).toHaveLength(1);
  });

  it("Sonderzeichen im Text (NUL, Steuerzeichen) werden vor der Datenbank entfernt", () => {
    expect(bereinigeText("Ab\u0000c\u0001d\u007fe\r\nf\tg")).toBe("Abcde\nf\tg");
  });
});
