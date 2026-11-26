import { Hono } from "hono";
import { aktuellerAkteur, type Akteur } from "../anmeldung/akteur";
import { Fachfehler } from "../fehler";
import type { Konfiguration } from "../konfiguration";

/**
 * `GET /live` (#161): Einstieg der Live-Aktualisierung über WebSocket. Die Anfrage durchläuft wie jede andere die Rechteprüfung (Regel in
 * `rechte/tabelle.ts`, Bereich `alle` wie `/changes`): Anmeldung über Sitzung oder API-Schlüssel (`Authorization: Bearer`, nie in der
 * Adresse), zweiter Faktor, Startpasswort, Sperre für Investor-Benutzer und Werteschlüssel. Erst danach nimmt `live/dienst.ts` die Verbindung an.
 *
 * Herkunft: Browser senden beim WebSocket-Aufbau immer `Origin`, Cookies aber ohne Rücksicht auf die Herkunft. Deshalb muss `Origin` zu
 * `APP_ORIGIN` gehören; ohne `Origin` geht es nur mit API-Schlüssel (kein Browser). `ursprungPruefung` prüft nur schreibende Methoden.
 *
 * Ohne WebSocket (gewöhnliche HTTP-Anfrage, Stapel) antwortet die Route 426 `upgrade_required`.
 */

/** Umgebung, die `live/dienst.ts` beim Aufbau übergibt; der Handler meldet ihr den geprüften Akteur. */
export interface LiveUmgebung {
  carrawayLive?: (akteur: Akteur) => void;
}

export function liveRouten(konfig: Pick<Konfiguration, "appOrigins">) {
  return new Hono<{ Bindings: LiveUmgebung }>().get("/", (c) => {
    const ursprung = c.req.header("Origin");
    const mitSchluessel = /^Bearer /i.test(c.req.header("Authorization") ?? "");
    if (ursprung !== undefined ? !konfig.appOrigins.includes(ursprung) : !mitSchluessel) {
      throw new Fachfehler(403, "origin_invalid", "The origin of the request is not allowed.");
    }
    const akteur = aktuellerAkteur(c);
    const anmelden = c.env?.carrawayLive;
    if (!anmelden || c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      throw new Fachfehler(426, "upgrade_required", "Connect to this address with a WebSocket client.");
    }
    anmelden(akteur);
    return c.body(null, 204);
  });
}
