/** Fonds, für den der jüngste Beschluss (Liste: jüngster zuerst) gilt. Die API liefert ihn bei zustimmenden Beschlüssen mit, sonst `null`. */
export function beschlussFonds(beschluesse: readonly { fondsId: string | null }[]): string | null {
  return beschluesse[0]?.fondsId ?? null;
}
