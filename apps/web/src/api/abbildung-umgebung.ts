/** Abbildung von `/environment` auf die Namen der Oberfläche; eigener Abschnitt, damit der Start (LP-Portal) sie nicht mitlädt. */
interface UmgebungApi {
  environment: "demo" | "test" | "production";
  pseudonymized: boolean;
  setupOpen: boolean;
  signIn: { twoFactorRequired: boolean; registrationOpen: boolean; providers: string[]; passwordResetAvailable: boolean };
}

export const umgebung = ({ environment: e, pseudonymized, setupOpen, signIn: s }: UmgebungApi) => ({
  umgebung: e === "production" ? ("echt" as const) : e,
  pseudonymisiert: pseudonymized,
  einrichtungOffen: setupOpen,
  anmeldung: { zweiFaktorPflicht: s.twoFactorRequired, registrierungOffen: s.registrationOpen, anbieter: s.providers, passwortZuruecksetzen: s.passwordResetAvailable },
});
