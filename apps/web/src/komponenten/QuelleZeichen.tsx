/**
 * Zeichen für synchronisierte Mails und Termine im Verlauf: ein Umschlag für Mails, ein Kalenderblatt für Termine. Reine Formen in der Textfarbe (Tokens), keine
 * Markenlogos der Anbieter; der Anbieter steht als Beschriftung daneben. Für Hilfstechnik ausgeblendet, die Art steht im Etikett.
 */
export function QuelleZeichen({ art }: { art: "mail" | "termin" }) {
  return (
    <svg className="app-quelle" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" focusable="false">
      {art === "mail" ? (
        <>
          <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5" />
          <path d="M2.5 4.5 8 9l5.5-4.5" />
        </>
      ) : (
        <>
          <rect x="1.75" y="3" width="12.5" height="10.75" rx="1.5" />
          <path d="M1.75 6.5h12.5M5 1.75v2.5M11 1.75v2.5" />
        </>
      )}
    </svg>
  );
}
