import type { HTMLAttributes, ReactNode } from "react";
import type { Rechenschritt } from "@carraway/rechenkern";
import { formatDatum } from "../format";
import { klassen } from "../hilfen";
import { useUiSprache, useUiTexte } from "../sprache";

export interface HerkunftQuelle {
  label: string;
  href: string;
}

export interface HerkunftProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  titel: string;
  /** Stichtag als `JJJJ-MM-TT`. */
  stichtag?: string;
  schritte: Rechenschritt[];
  quellen?: HerkunftQuelle[];
  details?: readonly ReactNode[];
}

export function Herkunft({ titel, stichtag, schritte, quellen, details, className, ...rest }: HerkunftProps) {
  const sprache = useUiSprache();
  const t = useUiTexte();
  return (
    <section className={klassen("cw-herkunft", className)} {...rest}>
      <h3 className="cw-herkunft__titel">
        <span>{titel}</span>
        {stichtag ? (
          <span className="cw-herkunft__stichtag">
            {t.herkunftStichtag.toUpperCase()} {formatDatum(stichtag, sprache)}
          </span>
        ) : null}
      </h3>
      <ol className="cw-herkunft__schritte">
        {schritte.map((s, i) => (
          details?.[i] ? (
            <li key={i} className="cw-herkunft__aufklappbar">
              <details>
                <summary tabIndex={0}><span>{s.zeichen} {s.bezeichnung}</span><strong>{s.wert}</strong></summary>
                {details[i]}
              </details>
            </li>
          ) : <li key={i} className={s.zeichen === "=" ? "cw-herkunft__ergebnis" : undefined}>
            <span>
              <span className="cw-herkunft__zeichen">{s.zeichen}</span>
              {s.bezeichnung}
            </span>
            <span>{s.wert}</span>
          </li>
        ))}
      </ol>
      {quellen && quellen.length > 0 ? (
        <>
          <span className="cw-nur-lesen">{t.herkunftQuellen}</span>
          <ul className="cw-herkunft__quellen">
            {quellen.map((q) => (
              <li key={q.href}>
                <a href={q.href}>{q.label}</a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
