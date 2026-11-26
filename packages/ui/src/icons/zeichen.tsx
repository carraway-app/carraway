import type { SVGProps } from "react";

/**
 * Baustein der Zeichen (siehe `../icons.tsx`): ein Zeichen aus dem Inhalt des Light-Zeichens von Phosphor.
 * - Standardgröße 18 px; `size` überschreibt sie. Die Farbe ist `currentColor`.
 * - Zeichen sind Schmuck (`aria-hidden`). Ein Icon-Button trägt sein `aria-label` selbst.
 */
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "ref" | "children"> {
  size?: number | string;
}
export type IconKomponente = ((props: IconProps) => React.JSX.Element) & { displayName?: string };

export function zeichen(name: string, inhalt: string): IconKomponente {
  const Icon: IconKomponente = ({ size = 18, ...rest }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      data-glyph={name}
      {...rest}
      dangerouslySetInnerHTML={{ __html: inhalt }}
    />
  );
  Icon.displayName = `${name}Icon`;
  return Icon;
}
