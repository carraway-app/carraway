import { describe, expect, it } from "vitest";
import { AbrufFehler, holeOeffentlicheSeite, pruefeAbrufZiel, textAusHtml, type Transport, type TransportAnfrage } from "../http/oeffentlicher-abruf";

/**
 * Begrenzter Abruf öffentlicher Seiten mit Schutz vor Server-Side Request Forgery. Auflösung und Transport sind Fakes; kein Test erreicht ein Netzwerk.
 */

const OEFFENTLICH = "93.184.216.34";
const aufloeserFuer = (karte: Record<string, string[]>) => async (host: string) => {
  const a = karte[host];
  if (!a) throw new Error("nxdomain");
  return a;
};

function fakeTransport(seiten: Record<string, { status?: number; kopf?: Record<string, string>; text?: string; stuecke?: string[]; haengt?: boolean }>) {
  const anfragen: TransportAnfrage[] = [];
  let abgebrochen = 0;
  let gelesen = 0;
  const transport: Transport = async (a) => {
    anfragen.push(a);
    const s = seiten[a.url.toString()];
    if (!s) throw new Error("kein Netz");
    if (s.haengt) await new Promise<never>(() => undefined);
    const stuecke = s.stuecke ?? [s.text ?? ""];
    return {
      status: s.status ?? 200,
      kopf: { "content-type": "text/html", ...s.kopf },
      abbrechen: () => void abgebrochen++,
      rumpf: (async function* () {
        for (const st of stuecke) {
          gelesen += st.length;
          yield new TextEncoder().encode(st);
        }
      })(),
    };
  };
  return { transport, anfragen, abgebrochen: () => abgebrochen, gelesen: () => gelesen };
}

const aufloeser = aufloeserFuer({ "firma.example": [OEFFENTLICH], "www.firma.example": [OEFFENTLICH], "intern.firma.example": ["10.0.0.5"], "gemischt.example": [OEFFENTLICH, "192.168.1.1"], "rebind.example": ["127.0.0.1"], "meta.example": ["169.254.169.254"], "v6.example": ["::ffff:7f00:1"], "nat.example": ["64:ff9b::a00:1"] });

describe("Ziel prüfen (SSRF-Schutz)", () => {
  it("erlaubt öffentliche Namen über http und https und gibt die geprüfte Adresse zurück", async () => {
    expect(await pruefeAbrufZiel("https://firma.example/start", aufloeser)).toMatchObject({ ip: OEFFENTLICH });
    expect(await pruefeAbrufZiel("http://firma.example", aufloeser)).toMatchObject({ ip: OEFFENTLICH });
  });

  it.each([
    ["Schema file", "file:///etc/passwd", "ABRUF_ADRESSE_UNGUELTIG"],
    ["Schema ftp", "ftp://firma.example/x", "ABRUF_ADRESSE_UNGUELTIG"],
    ["Schema gopher", "gopher://firma.example", "ABRUF_ADRESSE_UNGUELTIG"],
    ["Zugangsdaten in der Adresse", "https://user:pw@firma.example/", "ABRUF_ADRESSE_UNGUELTIG"],
    ["kein Standardport", "https://firma.example:8443/", "ABRUF_ZIEL_VERBOTEN"],
    ["Port 22", "http://firma.example:22/", "ABRUF_ZIEL_VERBOTEN"],
    ["IPv4-Loopback als Host", "http://127.0.0.1/", "ABRUF_ZIEL_VERBOTEN"],
    ["Metadatendienst als IP", "http://169.254.169.254/latest/meta-data/", "ABRUF_ZIEL_VERBOTEN"],
    ["IPv6-Loopback als Host", "http://[::1]/", "ABRUF_ZIEL_VERBOTEN"],
    ["IPv4-abgebildetes IPv6 als Host", "http://[::ffff:7f00:1]/", "ABRUF_ZIEL_VERBOTEN"],
    ["dezimal geschriebene Loopback-Adresse", "http://2130706433/", "ABRUF_ZIEL_VERBOTEN"],
    ["Name mit privater Adresse (10/8)", "https://intern.firma.example/", "ABRUF_ZIEL_VERBOTEN"],
    ["Name mit gemischten Adressen", "https://gemischt.example/", "ABRUF_ZIEL_VERBOTEN"],
    ["Name zeigt auf Loopback (Rebinding)", "https://rebind.example/", "ABRUF_ZIEL_VERBOTEN"],
    ["Name zeigt auf den Metadatendienst", "https://meta.example/", "ABRUF_ZIEL_VERBOTEN"],
    ["Name zeigt auf abgebildetes IPv6-Loopback", "https://v6.example/", "ABRUF_ZIEL_VERBOTEN"],
    ["Name zeigt auf NAT64 mit privatem IPv4", "https://nat.example/", "ABRUF_ZIEL_VERBOTEN"],
    ["localhost", "http://localhost/", "ABRUF_NICHT_AUFLOESBAR"],
    ["unbekannter Name", "https://gibt-es-nicht.example/", "ABRUF_NICHT_AUFLOESBAR"],
    ["keine Adresse", "kaputt", "ABRUF_ADRESSE_UNGUELTIG"],
  ])("lehnt ab: %s", async (_name, url, code) => {
    await expect(pruefeAbrufZiel(url, aufloeser)).rejects.toMatchObject({ code });
  });

  it("der echte Auflöser lässt localhost nie durch", async () => {
    await expect(pruefeAbrufZiel("http://localhost/")).rejects.toBeInstanceOf(AbrufFehler);
  });
});

describe("Abruf", () => {
  it("ruft über die geprüfte Adresse ab, nicht über den Namen, und gibt Text zurück", async () => {
    const { transport, anfragen } = fakeTransport({ "https://firma.example/": { text: "<html><title>Firma</title><body>Hallo</body></html>" } });
    const e = await holeOeffentlicheSeite("https://firma.example/", { aufloeser, transport });
    expect(e).toMatchObject({ url: "https://firma.example/", typ: "text/html", gekuerzt: false });
    expect(e.text).toContain("Hallo");
    expect(anfragen).toHaveLength(1);
    expect(anfragen[0]!.ip).toBe(OEFFENTLICH);
    expect(anfragen[0]!.url.hostname).toBe("firma.example");
  });

  it("folgt Weiterleitungen und prüft jedes Ziel neu: eine Weiterleitung nach innen wird abgelehnt, ohne dass dorthin verbunden wird", async () => {
    const a = fakeTransport({
      "https://firma.example/": { status: 301, kopf: { location: "https://www.firma.example/start" } },
      "https://www.firma.example/start": { text: "angekommen" },
    });
    expect((await holeOeffentlicheSeite("https://firma.example/", { aufloeser, transport: a.transport })).text).toBe("angekommen");
    expect(a.anfragen.map((x) => x.url.hostname)).toEqual(["firma.example", "www.firma.example"]);

    for (const ziel of ["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data/", "https://intern.firma.example/", "http://[::1]/", "file:///etc/passwd", "https://firma.example:6379/"]) {
      const b = fakeTransport({ "https://firma.example/": { status: 302, kopf: { location: ziel } } });
      await expect(holeOeffentlicheSeite("https://firma.example/", { aufloeser, transport: b.transport })).rejects.toBeInstanceOf(AbrufFehler);
      expect(b.anfragen).toHaveLength(1); // nur der erste, öffentliche Schritt
    }
  });

  it("begrenzt die Weiterleitungen", async () => {
    const a = fakeTransport({ "https://firma.example/": { status: 302, kopf: { location: "https://firma.example/" } } });
    await expect(holeOeffentlicheSeite("https://firma.example/", { aufloeser, transport: a.transport, grenzen: { maxWeiterleitungen: 3 } })).rejects.toMatchObject({ code: "ABRUF_ZU_VIELE_WEITERLEITUNGEN" });
    expect(a.anfragen).toHaveLength(4);
  });

  it("liest höchstens maxBytes (gezählt beim Lesen, Content-Length zählt nicht) und bricht danach ab", async () => {
    const a = fakeTransport({ "https://firma.example/": { kopf: { "content-length": "10" }, stuecke: ["a".repeat(600), "b".repeat(600), "c".repeat(600)] } });
    const e = await holeOeffentlicheSeite("https://firma.example/", { aufloeser, transport: a.transport, grenzen: { maxBytes: 1000 } });
    expect(e.gekuerzt).toBe(true);
    expect(e.text).toHaveLength(1000);
    expect(a.abgebrochen()).toBe(1);
    expect(a.gelesen()).toBeLessThan(1800); // das dritte Stück wird nicht mehr gelesen
  });

  it("Zeitlimit: eine hängende Gegenstelle bricht ab", async () => {
    const a = fakeTransport({ "https://firma.example/": { haengt: true } });
    await expect(holeOeffentlicheSeite("https://firma.example/", { aufloeser, transport: a.transport, grenzen: { zeitlimitMs: 50 } })).rejects.toMatchObject({ code: "ABRUF_ZEITLIMIT" });
  });

  it("nur Textinhalte, nur Status 200", async () => {
    const pdf = fakeTransport({ "https://firma.example/": { kopf: { "content-type": "application/pdf" }, text: "%PDF" } });
    await expect(holeOeffentlicheSeite("https://firma.example/", { aufloeser, transport: pdf.transport })).rejects.toMatchObject({ code: "ABRUF_KEIN_TEXT" });
    const fehler = fakeTransport({ "https://firma.example/": { status: 500, text: "x" } });
    await expect(holeOeffentlicheSeite("https://firma.example/", { aufloeser, transport: fehler.transport })).rejects.toMatchObject({ code: "ABRUF_STATUS", status: 500 });
    const netz = fakeTransport({});
    await expect(holeOeffentlicheSeite("https://firma.example/", { aufloeser, transport: netz.transport })).rejects.toMatchObject({ code: "ABRUF_FEHLER" });
  });

  it("Fehlermeldungen enthalten nie Inhalte oder Adressen", async () => {
    const a = fakeTransport({ "https://firma.example/": { status: 403, text: "geheimer Inhalt" } });
    const e = await holeOeffentlicheSeite("https://firma.example/", { aufloeser, transport: a.transport }).then(() => new Error("kein Fehler"), (x: unknown) => x as Error);
    expect(e.message).not.toMatch(/geheim|firma\.example/);
  });
});

describe("Text aus HTML", () => {
  it("Titel, Beschreibung, sichtbarer Text; ohne Skripte, Stile, Kommentare; mit Profilen bei LinkedIn", () => {
    const t = textAusHtml(
      `<html><head><title>Beispiel &amp; Söhne</title><meta name="description" content="Wir bauen Brücken"><style>.a{color:red}</style><script>var geheim = 1;</script></head>
       <body><!-- Kommentar --><h1>Willkommen</h1><p>Sitz in Hamburg</p><a href="https://www.linkedin.com/company/beispiel-soehne/">LinkedIn</a></body></html>`,
    );
    expect(t).toContain("Titel: Beispiel & Söhne");
    expect(t).toContain("Beschreibung: Wir bauen Brücken");
    expect(t).toContain("Sitz in Hamburg");
    expect(t).toContain("LinkedIn: https://www.linkedin.com/company/beispiel-soehne/");
    expect(t).not.toMatch(/geheim|color:red|Kommentar/);
  });

  it("pathologische Eingaben (viele offene script ohne Ende, viele meta ohne >, viele &) sind schnell fertig", () => {
    const eingaben = ["<script ".repeat(20_000), "<script>".repeat(20_000), '<meta name="description" content="'.repeat(5_000), "<meta ".repeat(30_000), "<a href=".repeat(20_000), "<title>".repeat(20_000), "&" + "a".repeat(50_000), "&a".repeat(50_000), "<!--".repeat(30_000)];
    const start = performance.now();
    for (const e of eingaben) textAusHtml(`<html><body>Sitz in Hamburg ${e}`);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(textAusHtml(`<p>Sichtbar</p>${"<script ".repeat(10)}`)).toContain("Sichtbar");
    expect(textAusHtml(`<p>${"x".repeat(200_000)}</p><p>zu spät</p>`)).not.toContain("zu spät");
  });
});
