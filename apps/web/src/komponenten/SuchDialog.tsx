import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, BankIcon, BuildingsIcon, BriefcaseIcon, Button, Dialog, FileTextIcon, IconButton, MagnifyingGlassIcon, UserCircleIcon, XIcon } from "@carraway/ui";
import { fondsListe, suche } from "../api/abfragen";
import { crmListen } from "../api/crm";
import { useRechte } from "../lib/rechte";
import { aufzaehlung, useT } from "../i18n";
import { Schnellaktionen } from "./crm/Zelle";
import { useEntprellt } from "./formular";
import "./SuchDialog.css";

type Ziel = { to: "/organisationen/$id" | "/personen/$id" | "/deals/$id" | "/dokumente/$id"; id: string; seite?: number } | { to: "/fonds"; fondsId: string };
interface Eintrag {
  schluessel: string;
  gruppe: "fonds" | "organisationen" | "personen" | "deals" | "dokumente";
  label: string;
  info: string;
  ziel: Ziel;
  /** Kontaktwege des Treffers für die Schnellaktionen neben dem Eintrag (bei Deals die des Unternehmens). */
  kontakt?: Record<string, unknown>;
  /** Name, den die Schnellaktionen nennen. */
  kontaktName?: string;
}

const MAX_SUCHBEGRIFF = 100;
const gruppenIcons = { fonds: BankIcon, organisationen: BuildingsIcon, personen: UserCircleIcon, deals: BriefcaseIcon, dokumente: FileTextIcon };

/** Globale Suche: serverseitig gerankt und nach Rechten gefiltert; mit Pfeiltasten wählen, mit Eingabe öffnen. */
export default function SuchDialog({ onSchliessen }: { onSchliessen: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const [eingabe, setEingabe] = useState("");
  const suchbegriff = eingabe.trim();
  const q = useEntprellt(suchbegriff, 200);
  const sucheAktuell = q === suchbegriff && q.length >= 2;
  const abfrage = useQuery({ ...suche(q), enabled: sucheAktuell });
  const feld = useRef<HTMLInputElement>(null);
  const liste = useRef<HTMLUListElement>(null);
  const hinweisId = useId();
  const daten = sucheAktuell ? abfrage.data : undefined;
  const fonds = useQuery(fondsListe());
  const normalisiert = suchbegriff.toLowerCase();
  const fondsTreffer = suchbegriff.length >= 2
    ? fonds.data?.filter((f) => [f.name, f.kurzname].some((name) => name.toLowerCase().includes(normalisiert))).slice(0, 8)
    : [];
  const eintraege: Eintrag[] = [
    ...(fondsTreffer ?? []).map((f): Eintrag => ({ schluessel: `f${f.id}`, gruppe: "fonds", label: f.name, info: f.kurzname, ziel: { to: "/fonds", fondsId: f.id } })),
    ...(daten?.organisationen ?? []).map((o): Eintrag => ({ schluessel: `o${o.id}`, gruppe: "organisationen", label: o.name, info: [aufzaehlung(t.organisationArt, o.art), o.ort].filter(Boolean).join(" · "), ziel: { to: "/organisationen/$id", id: o.id }, kontakt: o, kontaktName: o.name })),
    ...(daten?.personen ?? []).map((p): Eintrag => ({ schluessel: `p${p.id}`, gruppe: "personen", label: `${p.vorname} ${p.nachname}`, info: p.organisation?.name ?? t.suche.ohneOrganisation, ziel: { to: "/personen/$id", id: p.id }, kontakt: p, kontaktName: `${p.vorname} ${p.nachname}` })),
    ...(daten?.deals ?? []).map((d): Eintrag => ({ schluessel: `d${d.id}`, gruppe: "deals", label: d.titel, info: `${d.organisation.name} · ${aufzaehlung(t.dealPhase, d.phase)}`, ziel: { to: "/deals/$id", id: d.id }, kontakt: d.organisation, kontaktName: d.organisation.name })),
    ...(daten?.dokumente ?? []).map((x): Eintrag => ({ schluessel: `x${x.id}-${x.seite}`, gruppe: "dokumente", label: x.dateiname, info: `${t.suche.dokumentSeite(x.seite)}${x.quelle === "ocr" ? ` (${t.suche.dokumentOcr})` : ""} · ${x.ausschnitt.replaceAll("\u27e6", "").replaceAll("\u27e7", "")}`, ziel: { to: "/dokumente/$id", id: x.id, seite: x.seite } })),
  ];

  const { darf } = useRechte();
  const kontakteLesen = darf("betrachter", null, "kontakte");
  const dealsLesen = darf("betrachter", null, "dealflow");
  const listen = useQuery({ ...crmListen(), enabled: kontakteLesen });
  const b = t.suche.befehle;
  // Die Zielseite kann ein neues Formular öffnen, das als einzige Überlagerung den Fokus übernimmt.
  const geheZu: typeof navigate = (optionen) => {
    onSchliessen();
    return navigate(optionen);
  };
  const alleBefehle: { schluessel: string; label: string; aktion: () => void }[] = [
    ...(darf("bearbeiter", null, "kontakte")
      ? [
          { schluessel: "neu-o", label: b.neuUnternehmen, aktion: () => geheZu({ to: "/kontakte", search: { neu: "1" } }) },
          { schluessel: "neu-p", label: b.neuKontakt, aktion: () => geheZu({ to: "/kontakte", search: { objekt: "person", neu: "1" } }) },
          { schluessel: "import", label: b.importieren, aktion: () => geheZu({ to: "/kontakte/import" }) },
        ]
      : []),
    ...(darf("bearbeiter", null, "dealflow") ? [{ schluessel: "neu-d", label: b.neuDeal, aktion: () => geheZu({ to: "/dealflow", search: { neu: "1" } }) }] : []),
    { schluessel: "fonds", label: b.fonds, aktion: () => geheZu({ to: "/fonds", search: {} }) },
    ...(kontakteLesen ? [
      { schluessel: "o", label: b.unternehmen, aktion: () => geheZu({ to: "/kontakte", search: {} }) },
      { schluessel: "p", label: b.kontakte, aktion: () => geheZu({ to: "/kontakte", search: { objekt: "person" } }) },
      { schluessel: "h", label: b.heute, aktion: () => geheZu({ to: "/kontakte", search: { objekt: "heute" } }) },
      ...(dealsLesen ? [{ schluessel: "dt", label: b.dealTabelle, aktion: () => geheZu({ to: "/kontakte", search: { objekt: "deal" } }) }] : []),
      ...(listen.data ?? []).filter((l) => l.objekt !== "deal" || dealsLesen).map((l) => ({ schluessel: `l${l.id}`, label: b.liste(l.name), aktion: () => geheZu({ to: "/kontakte", search: { liste: l.id, ...(l.objekt === "organisation" ? {} : { objekt: l.objekt }) } }) })),
    ] : []),
    ...(dealsLesen ? [{ schluessel: "db", label: b.board, aktion: () => geheZu({ to: "/dealflow", search: {} }) }] : []),
  ];
  const befehle = alleBefehle.filter((x) => x.label.toLowerCase().includes(normalisiert)).slice(0, 14);

  // Mit den Pfeiltasten wandert der Fokus über die Treffer; die Schnellaktionen daneben erreicht man mit dem Tabulator.
  const knoepfe = () => Array.from(liste.current?.querySelectorAll<HTMLElement>("button.app-auswahlliste__knopf") ?? []);
  function oeffne({ ziel }: Eintrag) {
    if (ziel.to === "/fonds") {
      void geheZu({ to: ziel.to, search: { fondsId: ziel.fondsId } });
    } else {
      void geheZu({ to: ziel.to, params: { id: ziel.id }, ...(ziel.seite ? { search: { seite: ziel.seite } } : {}) });
    }
  }

  function beiEingabeTaste(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      knoepfe()[0]?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      knoepfe()[0]?.click();
    }
  }

  function beiListenTaste(e: KeyboardEvent<HTMLUListElement>) {
    if (e.nativeEvent.isComposing) return;
    const alle = knoepfe();
    const i = alle.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (e.key === "ArrowDown") alle[Math.min(i + 1, alle.length - 1)]?.focus();
      else if (i === 0) feld.current?.focus();
      else alle[i - 1]?.focus();
    } else if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      feld.current?.focus();
      setEingabe((wert) => wert.length < MAX_SUCHBEGRIFF ? wert + e.key : wert);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      feld.current?.focus();
      setEingabe((wert) => Array.from(wert).slice(0, -1).join(""));
    }
  }

  const gruppen = (Object.keys(gruppenIcons) as Eintrag["gruppe"][])
    .map((g) => ({ g, zeilen: eintraege.filter((e) => e.gruppe === g) }))
    .filter((x) => x.zeilen.length > 0);
  const quellen = [listen, ...(suchbegriff.length >= 2 ? [fonds] : []), ...(sucheAktuell ? [abfrage] : [])];
  const fehler = quellen.filter((quelle) => quelle.isError && !quelle.isFetching);
  const offline = quellen.some((quelle) => quelle.fetchStatus === "paused");
  const laedt = (suchbegriff.length >= 2 && !sucheAktuell) || quellen.some((quelle) => quelle.isPending && quelle.isFetching);
  const status = offline
    ? t.suche.offline
    : laedt
      ? t.suche.laedt
      : fehler.length > 0
        ? t.suche.fehler
        : eintraege.length > 0
          ? t.suche.ergebnisse(eintraege.length)
          : suchbegriff.length === 1
            ? t.suche.zuKurz
            : suchbegriff && befehle.length === 0
              ? t.suche.keine
              : "";

  return (
    <Dialog titel={t.suche.titel} onSchliessen={onSchliessen} breit aktionen={<span className="app-suchpalette__hinweis" id={hinweisId}>{t.suche.hinweis}</span>}>
      <div className="app-suchpalette__eingabe">
        <MagnifyingGlassIcon />
        <input
          ref={feld}
          type="search"
          aria-label={t.suche.feld}
          aria-describedby={hinweisId}
          placeholder={t.suche.eingabePlatzhalter}
          maxLength={MAX_SUCHBEGRIFF}
          autoComplete="off"
          value={eingabe}
          onChange={(e) => setEingabe(e.target.value.slice(0, MAX_SUCHBEGRIFF))}
          onKeyDown={beiEingabeTaste}
        />
      </div>
      <IconButton className="app-suchpalette__schliessen" variante="ruhig" icon={<XIcon />} aria-label={t.gemeinsam.schliessen} onClick={onSchliessen} />
      <div className="app-suchpalette__status">
        <span role="status">{status}</span>
        {!offline && !laedt && fehler.length > 0 ? (
          <Button variante="sekundaer" onClick={() => {
            feld.current?.focus();
            for (const quelle of fehler) void quelle.refetch();
          }}>{t.suche.erneut}</Button>
        ) : null}
      </div>
      <ul className="app-suchpalette__liste" ref={liste} aria-label={t.auswahl.treffer} onKeyDown={beiListenTaste}>
        {gruppen.map(({ g, zeilen }) => {
          const Icon = gruppenIcons[g];
          return (
            <li key={g}>
              <h3 className="app-gruppen-titel">{g === "fonds" ? t.nav.fonds : t.suche[g]}</h3>
              <ul>
                {zeilen.map((e) => (
                  <li key={e.schluessel} className="app-suchpalette__zeile">
                    <button type="button" className="app-auswahlliste__knopf" onClick={() => oeffne(e)}>
                      <Icon />
                      <span>
                        {e.label}
                        <span className="app-suchpalette__info">{e.info}</span>
                      </span>
                    </button>
                    {e.kontakt ? <Schnellaktionen werte={e.kontakt} name={e.kontaktName ?? e.label} /> : null}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
        {befehle.length > 0 ? (
          <li>
            <h3 className="app-gruppen-titel">{b.titel}</h3>
            <ul>
              {befehle.map((x) => (
                <li key={x.schluessel}>
                  <button type="button" className="app-auswahlliste__knopf" onClick={x.aktion}>
                    <ArrowRightIcon />
                    <span>{x.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ) : null}
      </ul>
    </Dialog>
  );
}
