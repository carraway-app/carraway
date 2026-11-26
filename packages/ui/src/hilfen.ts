/** Fügt Klassennamen zusammen und lässt leere Werte weg. */
export function klassen(...teile: (string | false | null | undefined)[]): string {
  return teile.filter(Boolean).join(" ");
}
