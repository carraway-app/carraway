/** Heutiges Datum in Ortszeit als `JJJJ-MM-TT`, passend zu `<input type="date">` und zur API. */
export function heuteIso(): string {
  const jetzt = new Date();
  const zwei = (n: number) => String(n).padStart(2, "0");
  return `${jetzt.getFullYear()}-${zwei(jetzt.getMonth() + 1)}-${zwei(jetzt.getDate())}`;
}
