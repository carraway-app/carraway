import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { wiedervorlagenAnzahl } from "../api/abfragen-kern";
import { useT } from "../i18n";

/** Kopfzeile: Zahl der fälligen und überfälligen Wiedervorlagen der angemeldeten Person, als Link zur Liste. */
export function WiedervorlagenZaehler() {
  const t = useT();
  const { data: z } = useQuery(wiedervorlagenAnzahl);
  return (
    <Link
      to="/follow-ups"
      search={{ zustaendig: "ich" }}
      className="app-zaehler"
      aria-label={z ? t.wiedervorlagenSeite.zaehlerName(z.total, z.overdue) : t.wiedervorlagenSeite.zaehlerText}
    >
      <span className="app-kopf__text">{t.wiedervorlagenSeite.zaehlerText}</span>{" "}
      <span className={(z?.overdue ?? 0) > 0 ? "app-zaehler__zahl app-zaehler__zahl--ueberfaellig" : "app-zaehler__zahl"}>
        {z?.total ?? t.gemeinsam.keinWert}
      </span>
    </Link>
  );
}
