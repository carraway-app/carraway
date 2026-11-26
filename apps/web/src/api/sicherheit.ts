import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { api, authAnfrage, auspacken } from "./client";
import { schluesselAnmeldung } from "./anmeldung";
import { useApiMutation } from "./mutationen";

/**
 * Eigene Sicherheit (Einstellungen → Sicherheit): Übersicht, Sitzungen, Passwort, zweiter Faktor. Nur von der nachgeladenen Seite gelesen.
 * Passwörter, Codes und Wiederherstellungscodes laufen bewusst nicht über Mutationen: Deren Ergebnis bliebe im Cache von TanStack Query.
 */
const basis = ["sicherheit"] as const;

const ladeUebersicht = () => auspacken(api.api.v1.konto.sicherheit.$get());
const ladeSitzungen = () => auspacken(api.api.v1.konto.sitzungen.$get());

export type Sicherheit = Awaited<ReturnType<typeof ladeUebersicht>>;
export type Sitzung = Awaited<ReturnType<typeof ladeSitzungen>>[number];
export interface ZweiFaktorAnsatz {
  totpURI: string;
  backupCodes: string[];
}

export const sicherheitUebersicht = () => queryOptions({ queryKey: [...basis, "uebersicht"], queryFn: ladeUebersicht, staleTime: 0 });
export const sitzungenListe = () => queryOptions({ queryKey: [...basis, "sitzungen"], queryFn: ladeSitzungen, staleTime: 0 });
export const sicherheitEntwerten = (qc: QueryClient) => qc.invalidateQueries({ queryKey: basis });

export const passwortAendern = (json: { aktuell: string; neu: string; andereSitzungenBeenden: boolean }) => auspacken(api.api.v1.konto.passwort.$post({ json }));

export const useSitzungBeenden = () =>
  useApiMutation({
    aufruf: (id: string) => auspacken(api.api.v1.konto.sitzungen[":id"].$delete({ param: { id } })),
    invalidiert: () => [basis],
  });
export const useAndereSitzungenBeenden = () =>
  useApiMutation({
    aufruf: () => auspacken(api.api.v1.konto.sitzungen["andere-beenden"].$post({ json: {} })),
    invalidiert: () => [basis],
  });

/** Ersteinrichtung des zweiten Faktors über Better Auth; aktiv wird er erst mit einem gültigen Code (die Sitzung wird dabei erneuert). */
export const zweiFaktorErst = {
  starten: (passwort: string): Promise<ZweiFaktorAnsatz> => authAnfrage<ZweiFaktorAnsatz>("/two-factor/enable", passwort ? { password: passwort } : {}),
  bestaetigen: async (code: string, qc: QueryClient): Promise<void> => {
    await authAnfrage("/two-factor/verify-totp", { code });
    await Promise.all([sicherheitEntwerten(qc), qc.invalidateQueries({ queryKey: schluesselAnmeldung.ich })]);
  },
};

/** Neueinrichtung: das bisherige Geheimnis gilt, bis ein Code des neuen bestätigt ist. */
export const zweiFaktorNeu = {
  starten: (passwort: string): Promise<ZweiFaktorAnsatz> => auspacken(api.api.v1.konto["zwei-faktor"].neu.$post({ json: passwort ? { passwort } : {} })),
  bestaetigen: async (code: string, andereSitzungenBeenden: boolean, qc: QueryClient): Promise<void> => {
    await auspacken(api.api.v1.konto["zwei-faktor"].neu.bestaetigen.$post({ json: { code, andereSitzungenBeenden } }));
    await sicherheitEntwerten(qc);
  },
};

export const wiederherstellungscodesErneuern = async (passwort: string, qc: QueryClient): Promise<string[]> => {
  const antwort = await auspacken(api.api.v1.konto.wiederherstellungscodes.$post({ json: passwort ? { passwort } : {} }));
  await sicherheitEntwerten(qc);
  return antwort.backupCodes;
};
