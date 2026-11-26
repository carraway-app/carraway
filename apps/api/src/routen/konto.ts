import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { bereicheJeFondsAuszug } from "../rechte/aufloesung";
import { bereichAnApi, stufeAnApi, stufeAnApiOderNull } from "../rechte/api-namen";
import type { Konfiguration } from "../konfiguration";
import { istPseudonymisiert } from "../pseudonymisierung";
import { lese } from "../zeitlimit";

/** Wer bin ich, in welcher Umgebung läuft der Server: für Anmeldeseite, Kopfzeile und das Banner „Test-/Demobestand“. */
/** `anbieter`: Namen der Anmeldeanbieter aus den Erweiterungen (Single Sign-On); im Kern leer. */
export function kontoRouten(konfig: Konfiguration, db: Db, anbieter: readonly string[] = []) {
  const pseudonymisiert = istPseudonymisiert(db);
  return new Hono()
    .get("/environment", async (c) => {
      // Wie `POST /setup`: offen, solange es noch keine Person gibt (technische Benutzer zählen nicht).
      const { rows } = await lese(db, (tx) => tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM benutzer WHERE NOT technisch`));
      return c.json(
        {
          /** `demo`, `test` oder `production`. */
          environment: konfig.umgebung === "echt" ? ("production" as const) : konfig.umgebung,
          /** `true` in einer pseudonymisierten Kopie (Zeile in `pseudonymisierung`): Die Oberfläche zeigt es im Band der Umgebung, auch auf der Anmeldeseite. */
          pseudonymized: await pseudonymisiert(),
          setupOpen: (rows[0]?.n ?? 0) === 0,
          signIn: {
            twoFactorRequired: konfig.zweiFaktorPflicht,
            registrationOpen: konfig.registrierungOffen,
            providers: [...anbieter],
            /** `true`, wenn Mailversand eingerichtet ist: Die Anmeldeseite bietet dann „Passwort vergessen“ an, und Einladungen per Mail sind möglich. */
            passwordResetAvailable: Boolean(konfig.mail && konfig.schluessel),
          },
        },
        200,
      );
    })
    .get("/me", (c) => {
      const akteur = aktuellerAkteur(c);
      return c.json(
        {
          id: akteur.id,
          name: akteur.name,
          email: akteur.email,
          technicalUser: akteur.technisch,
          globalAdmin: akteur.globalVerwalter,
          twoFactorEnabled: akteur.zweiFaktorAktiv,
          /** `true`: bis zur Änderung des Startpassworts antwortet jede andere Route mit 403 `password_change_required`. */
          passwordChangeRequired: akteur.passwortAendern,
          /** `true`: bis zur Einrichtung des zweiten Faktors antwortet jede andere Route mit 403 `two_factor_required`. */
          twoFactorSetupRequired: akteur.zweiFaktorFehlt,
          /** Wirksame Stufe je Fonds (eigene Fondsrolle, sonst aus den Gruppen): `viewer`, `editor`, `approver` oder `admin`. */
          roles: [...akteur.rollen].map(([fondsId, rolle]) => ({ fundId: fondsId, role: stufeAnApi(rolle) })),
          /** Bereiche aus den Rollen der Gruppen; `null` = alle Bereiche. Die Oberfläche blendet Bereiche ohne Recht aus. */
          areas: akteur.globalVerwalter || akteur.bereiche === null ? null : [...akteur.bereiche].map(bereichAnApi).sort(),
          /** Höchste Stufe der Gruppen unabhängig vom Fonds (Daten ohne Fonds wie Kontakte); `null` ohne Gruppe. */
          levelWithoutFund: stufeAnApiOderNull(akteur.stufeOhneFonds),
          /**
           * Bereiche je Fonds: Stufe je Fonds und Bereich (`areaLevelsPerFund`) und je Bereich für Daten ohne Fonds (`levelWithoutFundPerArea`);
           * `null` = keine Unterscheidung, dann gelten `roles` und `areas`.
           */
          ...bereicheJeFondsAuszug(akteur),
          /** `true`: Investor-Benutzer des LP-Portals; die Oberfläche führt ihn nach `/portal`, alle internen Routen sind für ihn gesperrt. */
          investor: akteur.investor,
        },
        200,
      );
    });
}
