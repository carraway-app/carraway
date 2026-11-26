import { eq } from "drizzle-orm";
import { pruefeKonfiguration } from "@carraway/berichte";
import {
  erzeugeExitListeExcel,
  erzeugeExitListePdf,
  erzeugeFondsbericht,
  erzeugeFondsberichtExcel,
  erzeugeGremienvorlage,
  erzeugeLpBericht,
  erzeugePortfolioListeExcel,
  erzeugePortfolioListePdf,
  erzeugeQuartalsbericht,
  erzeugeSzenarioberichtExcel,
  erzeugeSzenarioberichtPdf,
  FREITEXT_SCHLUESSEL,
  type BerichtsOptionen,
  type Sprache,
} from "@carraway/berichte";
import { berichtAbschnitt, fonds, organisation, beteiligung, type Bericht } from "@carraway/db";
import { ladeSzenarioberichtDaten } from "../szenarien/bericht";
import { ladeSzenarien } from "../szenarien/dienst";
import { Fachfehler } from "../fehler";
import type { Tx } from "../zeitlimit";
import { ladeExitListe, ladeFondsberichtDaten, ladeGremienDaten, ladeLpBerichtDatenMitInvestoren, ladePortfolioListe, ladeQuartalsDaten, type BerichtsErgaenzung } from "./daten";
import { sichtAusParameter } from "./sicht";
import { berichtsartAusErweiterung } from "./arten";

export const PDF = "application/pdf";
export const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Arten, die eine Erweiterung mitbringt (`berichte/arten.ts`); der Kern erzeugt sie nicht selbst. */
type KernArt = Exclude<Bericht["art"], "pai_erklaerung">;

/** Erlaubte Formate je Art des Kerns. */
const KERN_FORMATE: Record<KernArt, readonly Bericht["format"][]> = {
  fondsbericht: ["pdf", "xlsx"],
  quartalsbericht: ["pdf"],
  lp_bericht: ["pdf"],
  gremienvorlage: ["pdf"],
  portfolioliste: ["pdf", "xlsx"],
  exitliste: ["pdf", "xlsx"],
  szenariobericht: ["pdf", "xlsx"],
};

const ART_NAME: Record<KernArt, Record<Sprache, string>> = {
  fondsbericht: { de: "fondsbericht", en: "fund-report" },
  quartalsbericht: { de: "quartalsbericht", en: "quarterly-report" },
  lp_bericht: { de: "lp-bericht", en: "lp-report" },
  gremienvorlage: { de: "gremienvorlage", en: "committee-paper" },
  portfolioliste: { de: "portfolioliste", en: "portfolio-list" },
  exitliste: { de: "exitliste", en: "exit-list" },
  szenariobericht: { de: "szenariobericht", en: "scenario-report" },
};

const istKernArt = (art: Bericht["art"]): art is KernArt => art in KERN_FORMATE;

/** Erlaubte Formate einer Art (Kern oder Erweiterung); `null`, wenn es die Art in diesem Build nicht gibt. */
export function formateVon(art: Bericht["art"]): readonly Bericht["format"][] | null {
  return istKernArt(art) ? KERN_FORMATE[art] : (berichtsartAusErweiterung(art)?.formate ?? null);
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bericht";

/** Fassung eines LP-Berichts für genau einen Investor (nur dessen Kapitalkonto). */
export interface InvestorFassung {
  organisationId: string;
  investor: string;
  bytes: Uint8Array;
  name: string;
}

export interface ErzeugteDatei {
  bytes: Uint8Array;
  typ: string;
  name: string;
  /** Nur bei `mitFassungen` und einem LP-Bericht mit Abschnitt „Kapitalkonten“: eine Fassung je Zeichnung des Fonds. */
  fassungen?: InvestorFassung[];
}

/** Die Szenarien eines Szenarioberichts aus dem festgehaltenen Parameter (Reihenfolge wie bei der Anlage). */
export const szenarioIdsVon = (parameter: unknown): string[] => {
  const ids = (parameter as { szenarioIds?: unknown } | null)?.szenarioIds;
  return Array.isArray(ids) ? ids.filter((i): i is string => typeof i === "string") : [];
};

/** Enthält die festgehaltene Vorlage des Berichts den Abschnitt „Kapitalkonten“ (LP-Bericht mit den Konten aller Investoren)? */
export const hatKapitalkonten = (b: { art: string; konfiguration: unknown }): boolean =>
  b.art === "lp_bericht" && pruefeKonfiguration("lp_bericht", b.konfiguration).abschnitte.includes("kapitalkonten");

/**
 * Erzeugt die Datei eines Berichts. `entwurf` setzt Wasserzeichen und Entwurfshinweise; `stand` ist der Wissensstand der Rechnung
 * (bei Entwürfen die Vorgabe oder jetzt, bei der Freigabe der festgehaltene Stand).
 */
export async function erzeugeBerichtDatei(tx: Tx, b: Bericht, optionen: { entwurf: boolean; stand: Date; mitFassungen?: boolean }): Promise<ErzeugteDatei> {
  const sprache = b.sprache as Sprache;
  const standIso = optionen.stand.toISOString();
  const typ = b.format === "pdf" ? PDF : XLSX;
  const fondsId = b.fondsId;
  const nichtGefunden = () => new Fachfehler(404, "NICHT_GEFUNDEN", "Die Daten des Berichts gibt es nicht mehr.");

  let kuerzel: string;
  let gemeinsam: BerichtsOptionen = { entwurf: optionen.entwurf };
  if (b.art === "quartalsbericht") {
    const [z] = await tx
      .select({ name: organisation.name })
      .from(beteiligung)
      .innerJoin(organisation, eq(organisation.id, beteiligung.organisationId))
      .where(eq(beteiligung.id, b.beteiligungId ?? ""));
    kuerzel = slug(z?.name ?? "beteiligung");
  } else {
    const [f] = fondsId ? await tx.select().from(fonds).where(eq(fonds.id, fondsId)) : [];
    kuerzel = slug(f?.kurzname ?? "fonds");
  }
  // Die bei der Anlage festgehaltene Vorlage gilt, nie die aktuelle des Fonds.
  gemeinsam = { ...gemeinsam, konfiguration: pruefeKonfiguration(b.art, b.konfiguration) };
  const erweiterung = istKernArt(b.art) ? undefined : berichtsartAusErweiterung(b.art);
  if (!istKernArt(b.art) && !erweiterung) throw new Fachfehler(409, "BERICHTSART_NICHT_VERFUEGBAR", "Diese Berichtsart gibt es in dieser Installation nicht.", { art: b.art });
  const artName = istKernArt(b.art) ? ART_NAME[b.art][sprache] : erweiterung!.dateiname[sprache];
  const name = `${artName}-${kuerzel}-${b.stichtag}${optionen.entwurf ? (sprache === "de" ? "-entwurf" : "-draft") : ""}.${b.format}`;
  const stand = standIso;
  // Eigene Felder und Währungssicht stammen aus der festgehaltenen Vorlage und dem festgehaltenen Parameter des Berichts, nie aus dem heutigen Stand der Vorlage.
  const sicht = sichtAusParameter(b.parameter);
  const ergaenzung: BerichtsErgaenzung = { zusatzfelder: gemeinsam.konfiguration?.zusatzfelder ?? [], ...(sicht.sicht === "fonds" ? {} : { sicht }) };

  let bytes: Uint8Array;
  let fassungen: InvestorFassung[] | undefined;
  switch (b.art) {
    case "fondsbericht": {
      const d = await ladeFondsberichtDaten(tx, fondsId!, b.stichtag, stand, standIso, ergaenzung);
      if (!d) throw nichtGefunden();
      bytes = b.format === "xlsx" ? await erzeugeFondsberichtExcel(d, sprache, gemeinsam) : erzeugeFondsbericht(d, sprache, gemeinsam);
      break;
    }
    case "lp_bericht": {
      const geladen = await ladeLpBerichtDatenMitInvestoren(tx, fondsId!, b.stichtag, stand, standIso, ergaenzung);
      if (!geladen) throw nichtGefunden();
      const d = geladen.daten;
      const abschnitte = await tx.select().from(berichtAbschnitt).where(eq(berichtAbschnitt.berichtId, b.id));
      const freitexte: Record<string, string> = {};
      for (const k of FREITEXT_SCHLUESSEL) {
        const a = abschnitte.find((x) => x.schluessel === k);
        freitexte[k] = (sprache === "de" ? a?.textDe : a?.textEn) ?? "";
      }
      bytes = erzeugeLpBericht(d, sprache, { ...gemeinsam, freitexte });
      if (optionen.mitFassungen && hatKapitalkonten(b)) {
        // Je Zeichnung eine Fassung mit nur diesem Konto: gleiche Daten, gleiche Vorlage, gleiche Freitexte, gleicher Stand wie die Hauptdatei.
        const basisName = name.replace(/\.pdf$/, "");
        fassungen = geladen.investoren.map((i) => ({
          organisationId: i.organisationId,
          investor: i.konto.investor,
          name: `${basisName}-${slug(i.konto.investor)}.pdf`,
          bytes: erzeugeLpBericht({ ...d, kapitalkonten: [i.konto] }, sprache, { ...gemeinsam, freitexte, kapitalkontoEinzeln: true }),
        }));
      }
      break;
    }
    case "quartalsbericht": {
      const d = await ladeQuartalsDaten(tx, b.beteiligungId!, b.stichtag, stand, standIso, gemeinsam.konfiguration?.unternehmenskennzahlen ?? []);
      if (!d) throw nichtGefunden();
      bytes = erzeugeQuartalsbericht(d, sprache, gemeinsam);
      break;
    }
    case "gremienvorlage":
      bytes = erzeugeGremienvorlage(await ladeGremienDaten(tx, fondsId, b.stichtag, standIso), sprache, gemeinsam);
      break;
    case "portfolioliste": {
      const d = await ladePortfolioListe(tx, fondsId!, b.stichtag, stand, standIso, ergaenzung);
      if (!d) throw nichtGefunden();
      bytes = b.format === "xlsx" ? await erzeugePortfolioListeExcel(d, sprache, gemeinsam) : erzeugePortfolioListePdf(d, sprache, gemeinsam);
      break;
    }
    case "exitliste": {
      const d = await ladeExitListe(tx, fondsId!, b.stichtag, stand, standIso, ergaenzung);
      if (!d) throw nichtGefunden();
      bytes = b.format === "xlsx" ? await erzeugeExitListeExcel(d, sprache, gemeinsam) : erzeugeExitListePdf(d, sprache, gemeinsam);
      break;
    }
    case "szenariobericht": {
      // Die Szenarien stehen im Parameter des Berichts; festgeschrieben sind sie unveränderlich (Ergebnis und Prüfsumme gespeichert), der Bericht rechnet also nichts neu.
      const ids = szenarioIdsVon(b.parameter);
      const zeilen = ids.length > 0 ? (await ladeSzenarien(tx, fondsId!, ids)).sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id)) : [];
      if (zeilen.length !== ids.length || zeilen.length === 0) throw nichtGefunden();
      if (!optionen.entwurf && zeilen.some((z) => z.status !== "festgeschrieben")) throw new Fachfehler(409, "SZENARIO_NICHT_FESTGESCHRIEBEN", "Ein Szenarienbericht lässt sich nur mit festgeschriebenen Szenarien freigeben.");
      const d = await ladeSzenarioberichtDaten(tx, fondsId!, zeilen, standIso);
      bytes = b.format === "xlsx" ? await erzeugeSzenarioberichtExcel(d, sprache) : erzeugeSzenarioberichtPdf(d, sprache, { entwurf: optionen.entwurf });
      break;
    }
    default:
      bytes = await erweiterung!.erzeuge({ tx, b, sprache, stand, standIso, gemeinsam, nichtGefunden });
  }
  return { bytes, typ, name, ...(fassungen ? { fassungen } : {}) };
}
