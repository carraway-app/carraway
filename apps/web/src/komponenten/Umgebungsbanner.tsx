import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { umgebungAbfrage } from "../api/anmeldung";
import { useT } from "../i18n";

/**
 * Band über der Anwendung in Demo- und Testumgebungen und in einer pseudonymisierten Kopie (Etappe 22); im Echtbestand erscheint nichts. Die Art steht im Text,
 * nicht nur in der Farbe. Das Band steht im Fluss über Seitenleiste und Kopf, deckt also nie Inhalt ab, und erscheint auch auf der Anmeldeseite.
 */
export function Umgebungsbanner() {
  const t = useT();
  const { data } = useQuery(umgebungAbfrage());
  const band = useRef<HTMLDivElement>(null);
  const art = data && data.umgebung !== "echt" ? data.umgebung : null;
  const sichtbar = Boolean(art || data?.pseudonymisiert);
  // Seitenleiste und Kopfzeile kleben unter dem Band: Seine Höhe (0 ohne Band) steht als Variable bereit.
  useEffect(() => {
    const setze = () => document.documentElement.style.setProperty("--umgebung-h", `${band.current?.offsetHeight ?? 0}px`);
    setze();
    window.addEventListener("resize", setze);
    return () => {
      window.removeEventListener("resize", setze);
      document.documentElement.style.removeProperty("--umgebung-h");
    };
  }, [sichtbar]);
  if (!data || !sichtbar) return null;
  const teile = [...(art ? [{ id: art, ...t.umgebung[art] }] : []), ...(data.pseudonymisiert ? [{ id: "pseudonymisiert", ...t.umgebung.pseudonymisiert }] : [])];
  return (
    <div ref={band} className="app-umgebung" role="status" data-umgebung={art ?? "pseudonymisiert"}>
      {teile.map((teil) => (
        <span key={teil.id} className="app-umgebung__teil" data-teil={teil.id}>
          <strong className="app-umgebung__titel">{teil.titel}</strong>
          <span>{teil.text}</span>
        </span>
      ))}
    </div>
  );
}
