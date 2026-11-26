import { useEffect, useRef, type RefObject } from "react";
import { Initiale, Logo, NavLeiste, SidebarSimpleIcon, XIcon, type NavGruppe } from "@carraway/ui";
import { Kontomenue } from "./Kontomenue";
import { useT } from "../i18n";

export interface FondsAuswahl {
  liste: { id: string; name: string }[] | undefined;
  fehler: boolean;
  aktuell: string | undefined;
  onWahl: (id: string) => void;
  onVorladen: () => void;
  /** Adresse des aktuellen Fonds im gewählten Bereich (für das Zeichen in der schmalen Leiste). */
  href: string;
  onNavigieren: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}

export interface SeitenleisteProps {
  gruppen: NavGruppe[];
  schmal: boolean;
  onSchmal: (schmal: boolean) => void;
  eingeklappt: string[];
  onGruppe: (id: string, eingeklappt: boolean) => void;
  fonds: FondsAuswahl;
  /** Schmale Fenster: Die Leiste liegt über dem Inhalt und ist nur offen, solange das Menü offen ist. */
  mobilOffen: boolean;
  mobilAusloeser: RefObject<HTMLButtonElement | null>;
  onMobilSchliessen: () => void;
}

/**
 * Seitenleiste: klebt am linken Rand über die volle Höhe und scrollt für sich. Kopf mit Zeichen und Umschalter (schmal = nur Zeichen),
 * Fondsauswahl, gruppierte Navigation, unten das Konto. Auf schmalen Fenstern ist sie ein Menü über dem Inhalt.
 */
export function Seitenleiste({ gruppen, schmal, onSchmal, eingeklappt, onGruppe, fonds, mobilOffen, mobilAusloeser, onMobilSchliessen }: SeitenleisteProps) {
  const t = useT();
  const huelle = useRef<HTMLElement>(null);
  const schliessenKnopf = useRef<HTMLButtonElement>(null);
  const aktuellerFonds = fonds.liste?.find((f) => f.id === fonds.aktuell);
  const aktuellerName = aktuellerFonds?.name;

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
          {fonds.liste && fonds.liste.length > 0 ? (
            schmal ? (
              <a className="app-fonds-zeichen" href={fonds.href} title={aktuellerName} aria-label={aktuellerName ?? t.kopf.fonds} onClick={fonds.onNavigieren}>
                <Initiale name={aktuellerName ?? "F"} groesse="m" />
              </a>
            ) : (
              <div className="app-fondsauswahl">
                <label className="app-fondsauswahl__label" htmlFor="app-fondsauswahl">
                  {t.kopf.fonds}
                </label>
                <select id="app-fondsauswahl" className="app-auswahl" value={aktuellerFonds?.id ?? ""} onChange={(e) => fonds.onWahl(e.target.value)} onFocus={fonds.onVorladen}>
                  {!aktuellerFonds ? <option value="" disabled>{t.nav.fondsWaehlen}</option> : null}
                  {fonds.liste.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            )
          ) : (
            <div className="app-fondsauswahl">
              <label className="app-fondsauswahl__label" htmlFor="app-fondsauswahl">
                {t.kopf.fonds}
              </label>
              <select id="app-fondsauswahl" className="app-auswahl" disabled value="">
                <option value="">{fonds.liste ? t.platzhalter.keinFondsTitel : fonds.fehler ? t.kopf.fondsFehler : t.kopf.fondsLaedt}</option>
              </select>
            </div>
          )}
          <NavLeiste aria-label={t.nav.beschriftung} gruppen={gruppen} schmal={schmal} eingeklappt={eingeklappt} onGruppe={onGruppe} />
        </div>
        <div className="app-seitenleiste__fuss">
          <Kontomenue schmal={schmal} />
        </div>
      </aside>
    </>
  );
}
