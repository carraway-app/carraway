import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { api, authAnfrage, auspacken } from "./client";
import { schluesselAnmeldung } from "./anmeldung";
import { useApiMutation } from "./mutationen";

/**
 * Eigene Sicherheit (Einstellungen → Sicherheit): Übersicht, Sitzungen, Passwort, zweiter Faktor. Nur von der nachgeladenen Seite gelesen.
 * Passwörter, Codes und Wiederherstellungscodes laufen bewusst nicht über Mutationen: Deren Ergebnis bliebe im Cache von TanStack Query.
 */
const basis = ["sicherheit"] as const;

const ladeUebersicht = async () => {
  const s = await auspacken(api.api.v1.account.security.$get());
  return {
    passwortVorhanden: s.passwordSet,
    passwortGeaendertAm: s.passwordChangedAt,
    anbieter: s.providers,
    zweiFaktorAktiv: s.twoFactorEnabled,
    zweiFaktorPflicht: s.twoFactorRequired,
    codesUebrig: s.recoveryCodesRemaining,
    sitzungenAnzahl: s.sessionCount,
  };
};
const ladeSitzungen = async () =>
  (await auspacken(api.api.v1.account.sessions.$get())).map((s) => ({
    id: s.id,
    aktuell: s.current,
    erstelltAm: s.createdAt,
    zuletztAktivAm: s.lastActiveAt,
    laeuftAbAm: s.expiresAt,
    ip: s.ip,
    geraet: s.device,
  }));

export type Sicherheit = Awaited<ReturnType<typeof ladeUebersicht>>;
export type Sitzung = Awaited<ReturnType<typeof ladeSitzungen>>[number];
export interface ZweiFaktorAnsatz {
  totpURI: string;
  backupCodes: string[];
}

export const sicherheitUebersicht = () => queryOptions({ queryKey: [...basis, "uebersicht"], queryFn: ladeUebersicht, staleTime: 0 });
export const sitzungenListe = () => queryOptions({ queryKey: [...basis, "sitzungen"], queryFn: ladeSitzungen, staleTime: 0 });
export const sicherheitEntwerten = (qc: QueryClient) => qc.invalidateQueries({ queryKey: basis });

export const passwortAendern = (json: { aktuell: string; neu: string; andereSitzungenBeenden: boolean }) =>
  auspacken(api.api.v1.account.password.$post({ json: { currentPassword: json.aktuell, newPassword: json.neu, endOtherSessions: json.andereSitzungenBeenden } }));

export const useSitzungBeenden = () =>
  useApiMutation({
    aufruf: (id: string) => auspacken(api.api.v1.account.sessions[":id"].$delete({ param: { id } })),
    invalidiert: () => [basis],
  });
export const useAndereSitzungenBeenden = () =>
  useApiMutation({
    aufruf: () => auspacken(api.api.v1.account.sessions["end-others"].$post({ json: {} })),
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
  starten: async (passwort: string): Promise<ZweiFaktorAnsatz> => {
    const a = await auspacken(api.api.v1.account["two-factor"].restart.$post({ json: passwort ? { password: passwort } : {} }));
    return { totpURI: a.totpUri, backupCodes: a.recoveryCodes };
  },
  bestaetigen: async (code: string, andereSitzungenBeenden: boolean, qc: QueryClient): Promise<void> => {
    await auspacken(api.api.v1.account["two-factor"].restart.confirm.$post({ json: { code, endOtherSessions: andereSitzungenBeenden } }));
    await sicherheitEntwerten(qc);
  },
};

export const wiederherstellungscodesErneuern = async (passwort: string, qc: QueryClient): Promise<string[]> => {
  const antwort = await auspacken(api.api.v1.account["recovery-codes"].$post({ json: passwort ? { password: passwort } : {} }));
  await sicherheitEntwerten(qc);
  return antwort.recoveryCodes;
};
