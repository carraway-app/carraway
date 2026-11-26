/** Verlässt die Anwendung zu einer Adresse (Anmeldeseite eines Anbieters). Als Objekt, damit Tests den Aufruf ersetzen können (jsdom lässt `location.assign` nicht ersetzen). */
export const navigation = {
  zu: (url: string) => window.location.assign(url),
};
