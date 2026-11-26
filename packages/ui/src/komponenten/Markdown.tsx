import { Fragment, useMemo, type ReactNode } from "react";
import { klassen } from "../hilfen";
import { parseMarkdown, sichereUrl, type MdBlock, type MdInline } from "../markdown";

export interface MarkdownProps {
  /** Quelltext des Freitextfelds. Leer ergibt nichts. */
  text: string | null | undefined;
  className?: string;
  /**
   * Eigene Darstellung für Adressen, die kein gewöhnlicher Link sind (z. B. `person:<id>` bei Erwähnungen). Gibt `undefined` zurück,
   * wenn der Link nicht gemeint ist. `kinder` enthält bei Erwähnungen das vorangestellte „@“.
   */
  renderLink?: (href: string, kinder: ReactNode) => ReactNode | undefined;
}

/**
 * Zeigt Markdown aus Freitextfeldern sicher an: Der Text wird zu React-Elementen, nie zu HTML; Skript und HTML im Text bleiben Text.
 * Links nur für http, https, mailto und Pfade der Anwendung, externe mit `rel="noopener noreferrer"`; Bilder werden nicht geladen.
 */
export function Markdown({ text, className, renderLink }: MarkdownProps) {
  const baum = useMemo(() => parseMarkdown(text ?? ""), [text]);
  if (baum.length === 0) return null;
  return <div className={klassen("cw-md", className)}>{bloecke(baum, renderLink)}</div>;
}

function bloecke(liste: MdBlock[], renderLink: MarkdownProps["renderLink"]): ReactNode {
  return liste.map((b, i) => {
    switch (b.t) {
      case "p":
        return <p key={i}>{inline(b.c, renderLink)}</p>;
      case "h":
        return (
          <p key={i} className="cw-md__kopf">
            {inline(b.c, renderLink)}
          </p>
        );
      case "quote":
        return <blockquote key={i}>{bloecke(b.c, renderLink)}</blockquote>;
      case "code":
        return (
          <pre key={i}>
            <code>{b.s}</code>
          </pre>
        );
      case "list": {
        const Liste = b.ordered ? "ol" : "ul";
        return (
          <Liste key={i}>
            {b.items.map((e, j) => (
              <li key={j}>{bloecke(e, renderLink)}</li>
            ))}
          </Liste>
        );
      }
    }
  });
}

function inline(liste: MdInline[], renderLink: MarkdownProps["renderLink"]): ReactNode {
  return liste.map((x, i) => {
    switch (x.t) {
      case "text":
        return <Fragment key={i}>{x.s}</Fragment>;
      case "br":
        return <br key={i} />;
      case "code":
        return <code key={i}>{x.s}</code>;
      case "strong":
        return <strong key={i}>{inline(x.c, renderLink)}</strong>;
      case "em":
        return <em key={i}>{inline(x.c, renderLink)}</em>;
      case "link": {
        const kinder = inline(x.c, renderLink);
        const eigen = renderLink?.(x.href, x.at ? <>@{kinder}</> : kinder);
        if (eigen !== undefined) return <Fragment key={i}>{eigen}</Fragment>;
        const vorn = x.at ? "@" : "";
        if (!sichereUrl(x.href)) return <Fragment key={i}>{vorn}{kinder}</Fragment>;
        const extern = !x.href.startsWith("/");
        return (
          <Fragment key={i}>
            {vorn}
            <a href={x.href} {...(extern ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
              {kinder}
            </a>
          </Fragment>
        );
      }
    }
  });
}
