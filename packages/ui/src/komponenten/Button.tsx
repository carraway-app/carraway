import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { klassen } from "../hilfen";

export type ButtonVariante = "primaer" | "sekundaer" | "ruhig" | "gefahr";
export type ButtonGroesse = "s" | "m" | "l";

interface Basis {
  variante?: ButtonVariante;
  groesse?: ButtonGroesse;
}

/** Mit Text, optional mit Symbol; oder nur Symbol, dann ist `aria-label` Pflicht. */
type Inhalt =
  | { children: ReactNode; icon?: ReactNode }
  | { children?: undefined; icon: ReactNode; "aria-label": string };

export type ButtonProps = Basis & Inhalt & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;
export type ButtonLinkProps = Basis & Inhalt & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children">;

function buttonKlasse({ variante = "primaer", groesse = "m", nurIcon, className }: Basis & { nurIcon: boolean; className?: string | undefined }) {
  return klassen(
    "cw-button",
    variante !== "primaer" && `cw-button--${variante}`,
    groesse === "s" && "cw-button--s",
    groesse === "l" && "cw-button--l",
    nurIcon && "cw-button--icon",
    className,
  );
}

export function Button({ variante, groesse, icon, children, className, type = "button", ...rest }: ButtonProps) {
  const nurIcon = children === undefined || children === null;
  return (
    <button type={type} className={buttonKlasse({ variante, groesse, nurIcon, className })} {...rest}>
      {icon}
      {children}
    </button>
  );
}

/** Link im Aussehen eines Buttons (echtes `<a>`). */
export function ButtonLink({ variante, groesse, icon, children, className, ...rest }: ButtonLinkProps) {
  const nurIcon = children === undefined || children === null;
  return (
    <a className={buttonKlasse({ variante, groesse, nurIcon, className })} {...rest}>
      {icon}
      {children}
    </a>
  );
}

export type IconButtonProps = Basis & {
  icon: ReactNode;
  "aria-label": string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label">;

export function IconButton({ icon, ...rest }: IconButtonProps) {
  return <Button icon={icon} {...rest} />;
}
