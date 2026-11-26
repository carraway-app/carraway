import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { bereicheJeFondsAuszug } from "../rechte/aufloesung";
import type { Konfiguration } from "../konfiguration";
import { istPseudonymisiert } from "../pseudonymisierung";
import { lese } from "../zeitlimit";

/** Wer bin ich, in welcher Umgebung läuft der Server: für Anmeldeseite, Kopfzeile und das Banner „Test-/Demobestand“. */
/** `anbieter`: Namen der Anmeldeanbieter aus den Erweiterungen (Single Sign-On); im Kern leer. */
export function kontoRouten(konfig: Konfiguration, db: Db, anbieter: readonly string[] = []) {
  const pseudonymisiert = istPseudonymisiert(db);
  return new Hono()
    .get("/umgebung", async (c) => {
      // Wie `POST /einrichtung`: offen, solange es noch keine Person gibt (technische Benutzer zählen nicht).
      const { rows } = await lese(db, (tx) => tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM benutzer WHERE NOT technisch`));
      return c.json(
        {
          umgebung: konfig.umgebung,
          /** `true` in einer pseudonymisierten Kopie (Zeile in `pseudonymisierung`): Die Oberfläche zeigt es im Band der Umgebung, auch auf der Anmeldeseite. */
          pseudonymisiert: await pseudonymisiert(),
          einrichtungOffen: (rows[0]?.n ?? 0) === 0,
          anmeldung: {
            zweiFaktorPflicht: konfig.zweiFaktorPflicht,
            registrierungOffen: konfig.registrierungOffen,
            anbieter: [...anbieter],
            /** `true`, wenn Mailversand eingerichtet ist: Die Anmeldeseite bietet dann „Passwort vergessen“ an, und Einladungen per Mail sind möglich. */
            passwortZuruecksetzen: Boolean(konfig.mail && konfig.schluessel),
          },
        },
        200,
      );
    })
    .get("/ich", (c) => {
      const akteur = aktuellerAkteur(c);
      return c.json(
        {
          id: akteur.id,
          name: akteur.name,
          email: akteur.email,
          technisch: akteur.technisch,
          globalVerwalter: akteur.globalVerwalter,
          zweiFaktorAktiv: akteur.zweiFaktorAktiv,
          /** `true`: bis zur Änderung des Startpassworts antwortet jede andere Route mit 403 `PASSWORT_AENDERN`. */
          passwortAendern: akteur.passwortAendern,
          /** `true`: bis zur Einrichtung des zweiten Faktors antwortet jede andere Route mit 403 `ZWEI_FAKTOR_FEHLT`. */
          zweiFaktorErforderlich: akteur.zweiFaktorFehlt,
          /** Wirksame Stufe je Fonds (eigene Fondsrolle, sonst aus den Gruppen). */
          rollen: [...akteur.rollen].map(([fondsId, rolle]) => ({ fondsId, rolle })),
          /** Bereiche aus den Rollen der Gruppen; `null` = alle Bereiche. Die Oberfläche blendet Bereiche ohne Recht aus. */
          bereiche: akteur.globalVerwalter || akteur.bereiche === null ? null : [...akteur.bereiche].sort(),
          /** Höchste Stufe der Gruppen unabhängig vom Fonds (Daten ohne Fonds wie Kontakte); `null` ohne Gruppe. */
          stufeOhneFonds: akteur.stufeOhneFonds,
          /**
           * Bereiche je Fonds: Stufe je Fonds und Bereich (`bereicheJeFonds`) und je Bereich für Daten ohne Fonds (`stufeOhneFondsJeBereich`);
           * `null` = keine Unterscheidung, dann gelten `rollen` und `bereiche`.
           */
          ...bereicheJeFondsAuszug(akteur),
          /** `true`: Investor-Benutzer des LP-Portals; die Oberfläche führt ihn nach `/portal`, alle internen Routen sind für ihn gesperrt. */
          investor: akteur.investor,
        },
        200,
      );
    });
}
