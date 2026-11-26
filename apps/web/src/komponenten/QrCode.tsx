import { useEffect, useState } from "react";
import { useT } from "../i18n";

const RAND = 4;

/**
 * QR-Code als SVG, lokal berechnet (`qrcode-generator`, erst beim Öffnen der Seite nachgeladen). Der Inhalt, hier die
 * Einrichtungsadresse des zweiten Faktors, verlässt den Browser nie. Dunkle Module auf hellem Grund mit Ruhezone, damit
 * Scanner ihn auch im dunklen Erscheinungsbild lesen.
 */
export function QrCode({ wert }: { wert: string }) {
  const t = useT();
  const [pfad, setPfad] = useState<{ d: string; groesse: number } | null>(null);

  useEffect(() => {
    let aktiv = true;
    void import("qrcode-generator").then(({ default: qrcode }) => {
      const code = qrcode(0, "M");
      code.addData(wert);
      code.make();
      const n = code.getModuleCount();
      let d = "";
      for (let zeile = 0; zeile < n; zeile++) for (let spalte = 0; spalte < n; spalte++) if (code.isDark(zeile, spalte)) d += `M${spalte + RAND} ${zeile + RAND}h1v1h-1z`;
      if (aktiv) setPfad({ d, groesse: n + 2 * RAND });
    });
    return () => {
      aktiv = false;
    };
  }, [wert]);

  if (!pfad) return <div className="app-qr app-qr--laedt" role="status">{t.gemeinsam.laedt}</div>;
  return (
    <svg className="app-qr" role="img" aria-label={t.zweiFaktor.qrBeschriftung} viewBox={`0 0 ${pfad.groesse} ${pfad.groesse}`} shapeRendering="crispEdges">
      <rect width={pfad.groesse} height={pfad.groesse} className="app-qr__grund" />
      <path d={pfad.d} className="app-qr__modul" />
    </svg>
  );
}
