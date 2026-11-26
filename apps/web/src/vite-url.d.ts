/** Vite liefert bei `?url` die Adresse der gebündelten Datei (Worker von PDF.js). */
declare module "*.mjs?url" {
  const adresse: string;
  export default adresse;
}
