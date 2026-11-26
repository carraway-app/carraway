import { useEffect, useRef, useState } from "react";
import { Button } from "@carraway/ui";
import { useT } from "../i18n";

/**
 * PDF-Betrachter mit PDF.js (selbst gehostet, Version fest, Worker von Vite gebündelt, kein CDN). Der Browser-eigene Betrachter lässt sich im
 * sandboxed Rahmen der API (CSP `sandbox`) nicht benutzen; hier lädt die Seite die Bytes mit der Sitzung und zeichnet die gewünschte Seite
 * auf eine Fläche. Die Bibliothek ist ein eigener Block und wird erst geladen, wenn ein PDF angezeigt wird. Ohne Textebene: Auswahl und
 * Suche im Dokument gibt es nicht, der Download bleibt.
 */
export default function PdfBetrachter({ url, seite, titel, klasse }: { url: string; seite?: number | undefined; titel: string; klasse?: string }) {
  const t = useT();
  const b = t.dokumente.ansicht.betrachter;
  const flaeche = useRef<HTMLCanvasElement>(null);
  const [aktuell, setAktuell] = useState(Math.max(1, seite ?? 1));
  const [anzahl, setAnzahl] = useState(0);
  const [fehler, setFehler] = useState(false);
  const [dokument, setDokument] = useState<import("pdfjs-dist").PDFDocumentProxy | null>(null);

  useEffect(() => setAktuell(Math.max(1, seite ?? 1)), [seite, url]);

  useEffect(() => {
    let abgebrochen = false;
    let geladen: import("pdfjs-dist").PDFDocumentProxy | null = null;
    setFehler(false);
    setDokument(null);
    void (async () => {
      try {
        const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const antwort = await fetch(url, { credentials: "include" });
        if (!antwort.ok) throw new Error(String(antwort.status));
        const daten = new Uint8Array(await antwort.arrayBuffer());
        geladen = await pdfjs.getDocument({ data: daten, isEvalSupported: false, enableXfa: false }).promise;
        if (abgebrochen) return void geladen.destroy();
        setDokument(geladen);
        setAnzahl(geladen.numPages);
      } catch {
        if (!abgebrochen) setFehler(true);
      }
    })();
    return () => {
      abgebrochen = true;
      void geladen?.destroy();
    };
  }, [url]);

  useEffect(() => {
    if (!dokument || !flaeche.current) return;
    let abgebrochen = false;
    const leinwand = flaeche.current;
    void (async () => {
      try {
        const nummer = Math.min(Math.max(1, aktuell), dokument.numPages);
        const page = await dokument.getPage(nummer);
        const breite = leinwand.parentElement?.clientWidth || 800;
        const basis = page.getViewport({ scale: 1 });
        const skala = Math.min(2, Math.max(0.5, breite / basis.width));
        const dpr = window.devicePixelRatio || 1;
        const ansicht = page.getViewport({ scale: skala * dpr });
        leinwand.width = Math.floor(ansicht.width);
        leinwand.height = Math.floor(ansicht.height);
        leinwand.style.width = `${Math.floor(ansicht.width / dpr)}px`;
        const kontext = leinwand.getContext("2d");
        if (!kontext || abgebrochen) return;
        await page.render({ canvasContext: kontext, viewport: ansicht }).promise;
      } catch {
        if (!abgebrochen) setFehler(true);
      }
    })();
    return () => {
      abgebrochen = true;
    };
  }, [dokument, aktuell]);

  if (fehler) return <p className="app-fehlertext">{b.fehler}</p>;
  return (
    <div className={klasse ?? "app-betrachter"} role="group" aria-label={titel} style={{ overflow: "auto" }}>
      <div className="app-betrachter__leiste">
        <Button type="button" disabled={aktuell <= 1} onClick={() => setAktuell((n) => n - 1)}>
          {b.zurueck}
        </Button>
        <span aria-live="polite">{anzahl ? b.seite(Math.min(aktuell, anzahl), anzahl) : b.laedt}</span>
        <Button type="button" disabled={!anzahl || aktuell >= anzahl} onClick={() => setAktuell((n) => n + 1)}>
          {b.weiter}
        </Button>
      </div>
      <canvas ref={flaeche} role="img" aria-label={titel} data-seite={aktuell} />
    </div>
  );
}
