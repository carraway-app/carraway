import "./app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Anwendung } from "./anwendung";
import { gespeicherteSprache, ladeTexte } from "./i18n";
import { erstelleQueryClient, erstelleRouter } from "./router";

/** Startet die Anwendung mit Anmeldung, Router und allen Seiten. */
export async function starteAnwendung(wurzel: HTMLElement) {
  // Das Wörterbuch der gewählten Sprache steht vor dem ersten Zeichnen bereit.
  await ladeTexte(gespeicherteSprache());
  const queryClient = erstelleQueryClient();
  const router = erstelleRouter(queryClient);
  createRoot(wurzel).render(
    <StrictMode>
      <Anwendung queryClient={queryClient} router={router} />
    </StrictMode>,
  );
}
