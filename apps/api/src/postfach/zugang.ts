import type { Schluesselring } from "../geheimnis/krypto";
import type { Zugang } from "./typen";

/** Zugangsdaten einer Verbindung als verschlüsselter Text; AAD bindet den Wert an die Zeile (`postfach_verbindung:<id>:zugang`). */
export const zugangAad = (verbindungId: string) => `postfach_verbindung:${verbindungId}:zugang`;

export const verschluesseleZugang = (ring: Schluesselring, verbindungId: string, z: Zugang) => ring.verschluessele(JSON.stringify(z), zugangAad(verbindungId));

export const leseZugang = (ring: Schluesselring, verbindungId: string, text: string): Zugang => JSON.parse(ring.entschluessele(text, zugangAad(verbindungId))) as Zugang;

/** AAD des PKCE-Verifiers im OAuth-Zustand. */
export const verifierAad = (zustandId: string) => `oauth_zustand:${zustandId}:verifier`;
