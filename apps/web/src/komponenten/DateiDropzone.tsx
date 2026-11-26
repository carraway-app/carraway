import { useId, useRef, useState, type DragEvent } from "react";
import { UploadSimpleIcon } from "@carraway/ui";
import { useSprache } from "../i18n";
import { dateiablageTexte } from "../i18n/dateiablage";
import "./DateiDropzone.css";

interface DateiDropzoneProps {
  label: string;
  accept: string;
  onDateien: (dateien: File[]) => void;
  mehrfach?: boolean;
  /** Übergibt mehrere abgelegte Dateien an Abläufe mit eigener Stapelbehandlung. */
  mehrfachAblage?: boolean;
  deaktiviert?: boolean;
  hinweis?: string;
  auswahlText?: string;
  testId?: string;
  dateiname?: string;
  id?: string;
}

function enthaeltDateien(e: DragEvent) {
  // Vor dem Ablegen ist die Dateiliste im Browser geschützt. Nur die angebotenen Typen sind dann lesbar.
  return Array.from(e.dataTransfer.types ?? []).includes("Files") || e.dataTransfer.files?.length > 0;
}

export function DateiDropzone({ label, accept, onDateien, mehrfach = false, mehrfachAblage = mehrfach, deaktiviert = false, hinweis, auswahlText, testId, dateiname, id }: DateiDropzoneProps) {
  const d = dateiablageTexte[useSprache()];
  const dateifeld = useRef<HTMLInputElement>(null);
  const ebene = useRef(0);
  const [darueber, setDarueber] = useState(false);
  const [zuViele, setZuViele] = useState(false);
  const beschreibungId = useId();
  const kontextId = useId();
  const aktiv = darueber && !deaktiviert;
  const titel = aktiv ? d.loslassen : dateiname || (mehrfach ? d.ziehenMehrere : d.ziehen);
  const formate = accept.split(",").map((typ) => typ.trim()).filter((typ) => typ.startsWith(".")).map((typ) => typ.slice(1).toUpperCase()).join(", ");
  const hilfe = hinweis ?? formate;
  const knopftitel = auswahlText ?? (mehrfach ? d.waehlenMehrere : d.waehlen);
  const kontext = label !== knopftitel ? label : "";

  return (
    <div
      className="app-dateizone"
      data-aktiv={aktiv || undefined}
      data-testid={testId}
      onDragEnter={(e) => {
        if (!enthaeltDateien(e)) return;
        e.preventDefault();
        if (deaktiviert) return;
        ebene.current++;
        setDarueber(true);
      }}
      onDragOver={(e) => {
        if (!enthaeltDateien(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = deaktiviert ? "none" : "copy";
        if (!deaktiviert) setDarueber(true);
      }}
      onDragLeave={() => {
        ebene.current = Math.max(0, ebene.current - 1);
        if (!ebene.current) setDarueber(false);
      }}
      onDrop={(e) => {
        if (!enthaeltDateien(e)) return;
        e.preventDefault();
        e.stopPropagation();
        ebene.current = 0;
        setDarueber(false);
        const dateien = Array.from(e.dataTransfer.files);
        if (deaktiviert || dateien.length === 0) return;
        const einzelnErwartet = !mehrfachAblage && dateien.length > 1;
        setZuViele(einzelnErwartet);
        if (!einzelnErwartet) onDateien(dateien);
      }}
    >
      <input
        ref={dateifeld}
        id={id}
        hidden
        type="file"
        accept={accept}
        multiple={mehrfach}
        disabled={deaktiviert}
        aria-label={label}
        onChange={(e) => {
          const dateien = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (dateien.length > 0 && !deaktiviert) {
            setZuViele(false);
            onDateien(dateien);
          }
        }}
      />
      <button
        type="button"
        className="app-dateizone__flaeche"
        disabled={deaktiviert}
        aria-describedby={kontext ? `${kontextId} ${beschreibungId}` : beschreibungId}
        onClick={() => dateifeld.current?.click()}
      >
        <UploadSimpleIcon className="app-dateizone__symbol" aria-hidden="true" />
        <span id={beschreibungId} className="app-dateizone__text" aria-hidden="true">
          <strong>{titel}</strong>
          {hilfe ? <span className="app-dateizone__hinweis">{hilfe}</span> : null}
        </span>
        <span className="app-dateizone__auswahl">{knopftitel}</span>
      </button>
      {zuViele ? <p className="app-dateizone__fehler" role="alert">{d.einzeln}</p> : null}
      {kontext ? <span hidden id={kontextId}>{kontext}</span> : null}
    </div>
  );
}
