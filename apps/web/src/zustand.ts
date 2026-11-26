/** Zuletzt gewählter Fonds: Das Portfolio in der Navigation führt dorthin zurück, auch von anderen Seiten aus. */
const SCHLUESSEL = "carraway.fonds";

export function letzterFonds(): string | null {
  try {
    return localStorage.getItem(SCHLUESSEL);
  } catch {
    return null;
  }
}

export function merkeFonds(fondsId: string): void {
  try {
    localStorage.setItem(SCHLUESSEL, fondsId);
  } catch {
    // Speicher gesperrt: wird nur nicht gemerkt
  }
}

/** Zustand der Seitenleiste je angemeldeter Person: schmal (nur Zeichen) und die eingeklappten Gruppen. */
export interface NavZustand {
  schmal: boolean;
  eingeklappt: string[];
}

const NAV_STANDARD: NavZustand = { schmal: false, eingeklappt: [] };
const navSchluessel = (nutzerId: string) => `carraway.nav.${nutzerId}`;

export function ladeNavZustand(nutzerId: string): NavZustand {
  try {
    const roh = localStorage.getItem(navSchluessel(nutzerId));
    if (!roh) return NAV_STANDARD;
    const w = JSON.parse(roh) as Partial<NavZustand>;
    return { schmal: w.schmal === true, eingeklappt: Array.isArray(w.eingeklappt) ? w.eingeklappt.filter((g): g is string => typeof g === "string") : [] };
  } catch {
    return NAV_STANDARD;
  }
}

export function speichereNavZustand(nutzerId: string, zustand: NavZustand): void {
  try {
    localStorage.setItem(navSchluessel(nutzerId), JSON.stringify(zustand));
  } catch {
    // Speicher gesperrt: wird nur nicht gemerkt
  }
}
