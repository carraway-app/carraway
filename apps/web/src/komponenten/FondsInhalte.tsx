import { Hinweis } from "@carraway/ui";
import { useT } from "../i18n";
import { AbgrenzungKachel } from "./AbgrenzungKachel";
import { DokumenteAbschnitt } from "./DokumenteAbschnitt";
import { FondsKosten } from "./FondsKosten";
import { Kapitalbewegungen } from "./Kapitalbewegungen";
import { Zusatzfelder } from "./Zusatzfelder";

export const fondsInhalteTabs = ["kapital", "abgrenzung", "dokumente", "felder"] as const;

interface FondsInhalteProps {
  fondsId: string;
  waehrung: string;
  stichtag?: string;
  stand?: string;
  tab: (typeof fondsInhalteTabs)[number];
}

export default function FondsInhalte({ fondsId, waehrung, stichtag, stand, tab }: FondsInhalteProps) {
  const t = useT();
  switch (tab) {
    case "kapital":
      return (
        <>
          {stand ? <Hinweis>{t.fondsVerwaltung.liveKapital}</Hinweis> : null}
          <Kapitalbewegungen stichtag={stichtag} key={`${fondsId}|${stichtag ?? ""}|${stand ?? ""}`} fondsId={fondsId} waehrung={waehrung} stand={stand} />
          <FondsKosten stichtag={stichtag} key={`kosten|${fondsId}|${stichtag ?? ""}|${stand ?? ""}`} fondsId={fondsId} waehrung={waehrung} stand={stand} />
        </>
      );
    case "abgrenzung":
      return (
        <>
          {stand ? <Hinweis>{t.fondsVerwaltung.liveAbgrenzung}</Hinweis> : null}
          {stichtag ? <AbgrenzungKachel key={`${fondsId}|${stichtag}|${stand ?? ""}`} fondsId={fondsId} waehrung={waehrung} stichtag={stichtag} stand={stand} /> : null}
        </>
      );
    case "dokumente":
      return <DokumenteAbschnitt key={`${fondsId}|${stand ?? ""}`} zielTyp="fonds" zielId={fondsId} fondsId={fondsId} lesend={Boolean(stand)} />;
    case "felder":
      return <Zusatzfelder key={`${fondsId}|${stand ?? ""}`} objekt="fonds" id={fondsId} fondsId={fondsId} stand={stand} />;
  }
}
