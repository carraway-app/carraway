import { useEffect, useRef, type MouseEvent, type RefObject } from "react";
import { ArrowLeftIcon, CaretDownIcon, Logo, Menue, NavLeiste, SidebarSimpleIcon, XIcon, type NavGruppe } from "@carraway/ui";
import { Kontomenue } from "./Kontomenue";
import { useT } from "../i18n";

interface Link {
  href: string;
  onClick: (e: MouseEvent<HTMLAnchorElement>) => void;
  onVorladen: () => void;
}

/** Kopf des Kontexts (Fonds oder Objekt): Name, kurze Angaben und ein Umschalter zu einem anderen Fonds oder Objekt. */
export interface LeistenKopf {
  titel: string;
  untertitel?: string | undefined;
  titelSprache?: string | undefined;
  umschalter?: { label: string; optionen: ({ id: string; label: string; aktiv: boolean } & Link)[] } | undefined;
}

export interface SeitenleisteProps {
  gruppen: NavGruppe[];
  schmal: boolean;
  onSchmal: (schmal: boolean) => void;
  eingeklappt: string[];
  onGruppe: (id: string, eingeklappt: boolean) => void;
  /** Kontext der Leiste; im Fonds und im Objekt stehen Rückweg und Kopf über den Einträgen. */
  kontextArt: "global" | "fonds" | "objekt";
  kopf?: LeistenKopf | undefined;
  zurueck?: ({ label: string } & Link) | undefined;
  /** Schmale Fenster: Die Leiste liegt als Schublade über dem Inhalt und ist nur offen, solange das Menü offen ist. */
  mobilOffen: boolean;
  mobilAusloeser: RefObject<HTMLButtonElement | null>;
  onMobilSchliessen: () => void;
}

/**
 * Seitenleiste: klebt am linken Rand über die volle Höhe und scrollt für sich. Sie wechselt in den Kontext: global, im Fonds (Portfolio,
 * Kapital, Finanzen, Fonds) oder im Objekt (Beteiligung, Deal, Organisation, Person). Oben ein Rückweg und der Kopf des Kontexts mit Umschalter,
 * darunter die Orte, unten das Konto. Auf schmalen Fenstern ist sie eine Schublade über dem Inhalt.
 */
export function Seitenleiste({ gruppen, schmal, onSchmal, eingeklappt, onGruppe, kontextArt, kopf, zurueck, mobilOffen, mobilAusloeser, onMobilSchliessen }: SeitenleisteProps) {
  const t = useT();
  const huelle = useRef<HTMLElement>(null);
  const schliessenKnopf = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobilOffen) return;
    const ausloeser = mobilAusloeser.current;
    schliessenKnopf.current?.focus({ preventScroll: true });
    return () => ausloeser?.focus({ preventScroll: true });
  }, [mobilOffen, mobilAusloeser]);

  return (
    <>
      {mobilOffen ? <div className="app-leiste-hintergrund cw-dialoghintergrund" onClick={onMobilSchliessen} aria-hidden="true" /> : null}
      <aside
        ref={huelle}
        id="app-seitenleiste"
        className="app-seitenleiste"
        data-schmal={schmal ? "ja" : undefined}
        data-mobil-offen={mobilOffen ? "ja" : undefined}
        data-kontext={kontextArt}
        role={mobilOffen ? "dialog" : undefined}
        aria-modal={mobilOffen || undefined}
        aria-label={mobilOffen ? t.nav.beschriftung : t.nav.seitenleiste}
        onKeyDown={(e) => {
          if (!mobilOffen || e.defaultPrevented || huelle.current?.querySelector('[role="menu"]')) return;
          if (e.key === "Escape") onMobilSchliessen();
          if (e.key !== "Tab") return;
          const knoepfe = huelle.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), a[href]');
          const erster = knoepfe?.[0];
          const letzter = knoepfe?.[knoepfe.length - 1];
          if (e.shiftKey && e.target === erster) {
            e.preventDefault();
            letzter?.focus();
          } else if (!e.shiftKey && e.target === letzter) {
            e.preventDefault();
            erster?.focus();
          }
        }}
      >
        <div className="app-seitenleiste__kopf">
          <Logo nurZeichen={schmal} />
          {mobilOffen ? (
            <button type="button" ref={schliessenKnopf} className="app-menueknopf" onClick={onMobilSchliessen} aria-label={t.nav.menueSchliessen}>
              <XIcon />
            </button>
          ) : (
            <button
              type="button"
              className="app-leiste-umschalter"
              aria-label={schmal ? t.nav.ausklappen : t.nav.einklappen}
              aria-expanded={!schmal}
              aria-controls="app-seitenleiste"
              title={schmal ? t.nav.ausklappen : t.nav.einklappen}
              onClick={() => onSchmal(!schmal)}
            >
              <SidebarSimpleIcon />
            </button>
          )}
        </div>
        <div className="app-seitenleiste__mitte">
          {zurueck || kopf ? (
            <div className="app-kontext">
              {zurueck ? (
                <a className="app-kontext__zurueck" href={zurueck.href} onClick={zurueck.onClick} onPointerEnter={zurueck.onVorladen} onFocus={zurueck.onVorladen} title={schmal ? zurueck.label : undefined} aria-label={schmal ? zurueck.label : undefined}>
                  <ArrowLeftIcon />
                  {schmal ? null : <span>{zurueck.label}</span>}
                </a>
              ) : null}
              {kopf && !schmal ? (
                kopf.umschalter && kopf.umschalter.optionen.length > 1 ? (
                  <Menue
                    className="app-kontext__umschalter"
                    aria-label={kopf.umschalter.label}
                    ausloeserLabel={`${[kopf.titel, kopf.untertitel].filter(Boolean).join(" ")}, ${kopf.umschalter.label}`}
                    ausloeserKlasse="app-kontext__kopf"
                    kante="links"
                    portal
                    ausloeser={<KopfText kopf={kopf} mitPfeil />}
                    eintraege={kopf.umschalter.optionen.map((o) => ({ id: o.id, label: o.label, href: o.href, onClick: o.onClick as (e: MouseEvent<HTMLElement>) => void, ausgewaehlt: o.aktiv }))}
                  />
                ) : (
                  <div className="app-kontext__kopf">
                    <KopfText kopf={kopf} />
                  </div>
                )
              ) : null}
            </div>
          ) : null}
          <NavLeiste aria-label={t.nav.beschriftung} gruppen={gruppen} schmal={schmal} eingeklappt={eingeklappt} onGruppe={onGruppe} />
        </div>
        <div className="app-seitenleiste__fuss">
          <Kontomenue schmal={schmal} />
        </div>
      </aside>
    </>
  );
}

function KopfText({ kopf, mitPfeil }: { kopf: LeistenKopf; mitPfeil?: boolean }) {
  return (
    <>
      <span className="app-kontext__text">
        <span className="app-kontext__titel" lang={kopf.titelSprache}>
          {kopf.titel}
        </span>
        {kopf.untertitel ? " " : null}
        {kopf.untertitel ? <span className="app-kontext__untertitel">{kopf.untertitel}</span> : null}
      </span>
      {mitPfeil ? <CaretDownIcon /> : null}
    </>
  );
}
