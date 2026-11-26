import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { crmAnsichten, crmFelder, type Ansicht, type Feld, type Konfig, type Objekt } from "../../api/crm";
import { NAMENSFELD } from "./typen";

/** Spalten, die eine neue Ansicht ohne Konfiguration zeigt (nur Felder, die es gibt). */
const STANDARD_SPALTEN: Record<Objekt, string[]> = {
  organisation: ["name", "art", "ort", "sektor", "kontakte"],
  person: ["name", "unternehmen", "funktion", "email", "telefon"],
  deal: ["titel", "unternehmen", "phase", "ticket", "betreuung", "aktualisiertAm"],
};

/** Felder, die jede Anfrage zusätzlich mitlädt: der Name für Beschriftungen und die Wege zu Mail, Telefon und Adressen. */
const SCHNELL: Record<Objekt, string[]> = {
  organisation: ["email", "telefon", "linkedin", "website"],
  person: ["email", "telefon", "linkedin"],
  deal: ["unternehmen", "unternehmenEmail", "unternehmenTelefon", "unternehmenWebsite"],
};

export function standardKonfig(objekt: Objekt, felder: Feld[], liste: boolean): Konfig {
  const vorhanden = new Set(felder.map((f) => f.schluessel));
  const spalten = STANDARD_SPALTEN[objekt].filter((k) => vorhanden.has(k));
  // Listenfelder gehören in jede Ansicht der Liste.
  const listenfelder = liste ? felder.filter((f) => f.listeId).map((f) => f.schluessel) : [];
  return { sortierung: [], spalten: [...spalten, ...listenfelder].map((feld) => ({ feld })) };
}

/** Felder einer Anfrage: sichtbare Spalten plus Name und Schnellaktionen (ohne Doppelte, nur vorhandene). */
export function angeforderteFelder(objekt: Objekt, konfig: Konfig, felder: Feld[]): string[] {
  const vorhanden = new Set(felder.map((f) => f.schluessel));
  return [...new Set([...konfig.spalten.map((s) => s.feld), NAMENSFELD[objekt], ...SCHNELL[objekt]])].filter((k) => vorhanden.has(k));
}

export interface AnsichtZustand {
  felder: Feld[];
  ansichten: Ansicht[];
  aktuell: Ansicht | null;
  konfig: Konfig;
  art: "tabelle" | "kanban";
  geaendert: boolean;
  bereit: boolean;
  /** Ändert die Konfiguration im Entwurf, auf Wunsch zugleich die Darstellung. */
  setzeKonfig: (teil: Partial<Konfig>, art?: "tabelle" | "kanban") => void;
  setzeArt: (art: "tabelle" | "kanban") => void;
  verwerfen: () => void;
}

/**
 * Zustand einer Ansicht auf dem Bildschirm: die gewählte gespeicherte Ansicht (oder die Standardansicht des Objekts bzw. der Liste, sonst eine Vorgabe)
 * plus lokale Änderungen („Entwurf“), die erst „Speichern“ festhält. Wechselt Objekt, Liste oder Ansicht, beginnt der Entwurf neu.
 */
export function useAnsicht(objekt: Objekt, listeId: string | undefined, ansichtParam: string | undefined): AnsichtZustand {
  const felderAbfrage = useQuery(crmFelder(objekt, listeId));
  const ansichtenAbfrage = useQuery(crmAnsichten(objekt, listeId));
  const felder = useMemo(() => felderAbfrage.data ?? [], [felderAbfrage.data]);
  const ansichten = useMemo(() => ansichtenAbfrage.data ?? [], [ansichtenAbfrage.data]);
  const aktuell = ansichten.find((a) => a.id === ansichtParam) ?? (ansichtParam === undefined ? (ansichten.find((a) => a.standard) ?? null) : null);
  const schluessel = `${objekt}|${listeId ?? ""}|${aktuell?.id ?? ""}`;
  const [entwurf, setEntwurf] = useState<{ schluessel: string; konfig: Konfig; art: "tabelle" | "kanban" } | null>(null);
  const bereit = felderAbfrage.isSuccess && ansichtenAbfrage.isSuccess;

  const basisKonfig = useMemo(() => aktuell?.konfig ?? standardKonfig(objekt, felder, Boolean(listeId)), [aktuell, objekt, felder, listeId]);
  const basisArt = aktuell?.art ?? "tabelle";
  const mitEntwurf = entwurf?.schluessel === schluessel;
  // Spalten, die es nicht mehr gibt (archivierte Felder), fallen weg; der Server lehnt unbekannte Felder ab.
  const vorhanden = new Set(felder.map((f) => f.schluessel));
  const roh = mitEntwurf ? entwurf.konfig : basisKonfig;
  const konfig: Konfig = { ...roh, spalten: roh.spalten.filter((s) => vorhanden.has(s.feld)), sortierung: roh.sortierung.filter((s) => vorhanden.has(s.feld)) };
  const art = mitEntwurf ? entwurf.art : basisArt;
  const geaendert = mitEntwurf && (JSON.stringify(entwurf.konfig) !== JSON.stringify(basisKonfig) || entwurf.art !== basisArt);

  return {
    felder,
    ansichten,
    aktuell,
    konfig,
    art,
    geaendert,
    bereit,
    setzeKonfig: (teil, neueArt) => setEntwurf({ schluessel, konfig: { ...konfig, ...teil }, art: neueArt ?? art }),
    setzeArt: (neu) => setEntwurf({ schluessel, konfig, art: neu }),
    verwerfen: () => setEntwurf(null),
  };
}
