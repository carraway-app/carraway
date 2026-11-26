import { sichereUrl } from "../lib/sichereUrl";

/**
 * Vom Nutzer eingegebene Adresse: nur http und https werden zum Link (in neuem Tab, ohne Rückbezug),
 * alles andere erscheint als einfacher Text.
 */
export function ExternerLink({ url }: { url: string }) {
  const sicher = sichereUrl(url);
  return sicher ? (
    <a href={sicher} target="_blank" rel="noopener noreferrer">
      {url}
    </a>
  ) : (
    <span>{url}</span>
  );
}
