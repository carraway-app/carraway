import { letzterFonds } from "../zustand";

/** Der Fonds, der gilt: der gewünschte (aus der URL), sonst der zuletzt gewählte, sonst der erste. */
export function wirksamerFonds<F extends { id: string }>(liste: F[], gewuenscht?: string): F | undefined {
  return liste.find((f) => f.id === gewuenscht) ?? liste.find((f) => f.id === letzterFonds()) ?? liste[0];
}
