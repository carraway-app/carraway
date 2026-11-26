/** Erst beim Aufruf einer Buchhaltungsroute laden, auch wenn die übergeordnete Seite früh geladen wird. */
export const buchhaltungsAufruf: typeof import("./buchhaltungsantwort").buchhaltungsAufruf = async (senden) => {
  const modul = await import("./buchhaltungsantwort");
  return modul.buchhaltungsAufruf(senden);
};
