import "./extern.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ExternesFormular } from "./Formular";

/**
 * Startet die öffentliche Abfrageseite. Das Token steht in der Adresse; damit es nicht an andere Stellen gelangt, sendet die Seite ab hier keine
 * Referrer mehr (zusätzlich zur Angabe an jeder Anfrage).
 */
export function starteExtern(wurzel: HTMLElement, token: string) {
  const meta = document.createElement("meta");
  meta.name = "referrer";
  meta.content = "no-referrer";
  document.head.append(meta);
  const robots = document.createElement("meta");
  robots.name = "robots";
  robots.content = "noindex, nofollow";
  document.head.append(robots);
  createRoot(wurzel).render(
    <StrictMode>
      <ExternesFormular token={token} />
    </StrictMode>,
  );
}
