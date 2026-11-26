import { useRouter, type NavigateOptions } from "@tanstack/react-router";
import { lazy, Suspense, type MouseEvent } from "react";
import { CaretUpIcon, CodeIcon, GearIcon, GlobeSimpleIcon, LockIcon, Menue, SignOutIcon, type MenueEintrag, type Sprache } from "@carraway/ui";
import { aufzaehlung, useSetzeSprache, useSprache, useT } from "../i18n";
import { hoechsteRolle, useRechte } from "../lib/rechte";
import { useAbmelden } from "./abmelden";
import { FehlerHinweis } from "./FehlerHinweis";

// Die Wahl des Themas lädt erst mit dem geöffneten Menü (Budget des Anfangsumfangs).
const ThemaWahl = lazy(() => import("./ThemaWahl").then((m) => ({ default: m.ThemaWahl })));

/** Anfangsbuchstaben von Vor- und Nachname für den Avatar. */
export function initialen(name: string): string {
  const teile = name.trim().split(/\s+/).filter(Boolean);
  const erster = Array.from(teile[0] ?? "")[0] ?? "";
  const letzter = teile.length > 1 ? (Array.from(teile.at(-1) ?? "")[0] ?? "") : "";
  return (erster + letzter).toUpperCase();
}

/**
 * Konto unten links in der Seitenleiste: Avatar und Name öffnen nach oben ein Menü mit Sprache, Thema (System, Hell, Dunkel), Einstellungen, Verwaltung (nur
 * globale Verwalter), API-Hilfe und Abmelden. In der schmalen Leiste bleibt nur der Avatar.
 */
export function Kontomenue({ schmal }: { schmal?: boolean }) {
  const t = useT();
  const { ich } = useRechte();
  const router = useRouter();
  const sprache = useSprache();
  const setzeSprache = useSetzeSprache();
  const { abmelden, laeuft, fehler } = useAbmelden();
  if (!ich) return null;
  const rolle = hoechsteRolle(ich);

  const nach = (ziel: NavigateOptions): Pick<MenueEintrag, "href" | "onClick"> => ({
    href: router.buildLocation(ziel).href,
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      void router.navigate(ziel);
    },
  });

  const eintraege: MenueEintrag[] = [
    ...(["de", "en"] as Sprache[]).map((s, i): MenueEintrag => ({
      id: `sprache-${s}`,
      label: t.konto.sprachen[s],
      icon: i === 0 ? <GlobeSimpleIcon /> : <span aria-hidden="true" style={{ width: 16 }} />,
      ausgewaehlt: s === sprache,
      onClick: () => setzeSprache(s),
      ...(i === 0 ? { gruppe: t.konto.sprache } : {}),
    })),
    { id: "einstellungen", label: t.nav.einstellungen, icon: <GearIcon />, trennerDavor: true, ...nach({ to: "/einstellungen/postfach", search: {} }) },
    ...(ich.globalVerwalter
      ? [
          { id: "verwaltung", label: t.nav.verwaltung, icon: <LockIcon />, ...nach({ to: "/verwaltung" }) },
          { id: "mailversand", label: t.nav.mailversand, icon: <GearIcon />, ...nach({ to: "/verwaltung/mail" }) },
        ]
      : []),
    { id: "api", label: t.konto.apiHilfe, icon: <CodeIcon />, href: "/api/v1/docs", extern: true },
    { id: "abmelden", label: t.konto.abmelden, icon: <SignOutIcon />, trennerDavor: true, deaktiviert: laeuft, onClick: () => void abmelden() },
  ];
  return (
    <div className="app-konto">
      <FehlerHinweis fehler={fehler} />
      <Menue
        aria-label={t.konto.menue}
        ausloeserLabel={`${t.konto.menue}: ${ich.name}`}
        richtung="oben"
        kante="links"
        ausloeserKlasse="app-konto__knopf"
        title={schmal ? ich.name : undefined}
        ausloeser={
          <>
            {/* Die Buchstaben stehen im Stil, nicht im Text: Der Name des Knopfs enthält so genau den sichtbaren Namen. */}
            <span className="app-avatar" aria-hidden="true" data-initialen={initialen(ich.name)} />
            {schmal ? null : (
              <>
                <span className="app-konto__name">{ich.name}</span>
                <CaretUpIcon aria-hidden="true" size={14} />
              </>
            )}
          </>
        }
        kopf={
          <>
            <strong>{ich.name}</strong>
            <span>{ich.email}</span>
            <span>{ich.globalVerwalter ? t.konto.globalVerwalter : rolle ? aufzaehlung(t.rolle, rolle) : t.konto.keineRolle}</span>
          </>
        }
        block={{
          label: t.konto.thema.beschriftung,
          inhalt: (
            <Suspense fallback={<div className="cw-segment cw-segment--leer" aria-hidden="true" />}>
              <ThemaWahl texte={t.konto.thema} inMenue />
            </Suspense>
          ),
        }}
        fuss={t.version}
        eintraege={eintraege}
      />
    </div>
  );
}
