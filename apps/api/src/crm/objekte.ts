import { sql, type SQL } from "drizzle-orm";
import { benutzer, beschaeftigung, deal, dealHerkunft, dealPhase, dealStatus, dealTyp, fonds, listeEintrag, organisation, organisationArt, person } from "@carraway/db";
import { type FeldDef, type FeldTyp, type Objekt } from "./felder";

/**
 * Das Verzeichnis der Objekte des CRM: je Objekt die Tabelle, die immer geltenden Bedingungen und die Systemfelder mit Typ und SQL-Ausdruck.
 * Der Abfragebauer (`abfrage.ts`) kennt Felder ausschließlich über dieses Verzeichnis und die Felddefinitionen: Ein Feldschlüssel aus einer Anfrage
 * ist entweder ein Systemschlüssel von hier oder die ID einer Definition, alles andere wird abgelehnt.
 */

export interface Systemfeld {
  schluessel: string;
  name: string;
  typ: FeldTyp;
  /** SQL-Ausdruck im Wert des Typs (Text, `numeric`, `date`, `boolean`, `jsonb`). */
  ausdruck: SQL;
  /** Ausdruck für die Anzeige in der Ergebniszeile, wenn er vom Vergleichsausdruck abweicht (z. B. Datum als Text). */
  ausgabe?: SQL;
  /** Auswahlwerte (feste Aufzählung der Datenbank). */
  optionen?: string[];
  /** Verknüpfung zu einem Objekt (die Werte sind IDs). */
  ziel?: Objekt;
  /** Ausdruck zum Sortieren, wenn der Vergleichsausdruck dafür nicht taugt (z. B. der Name statt der ID). */
  sortAusdruck?: SQL;
  /** Schreibbar über `PATCH /crm/objekte/:objekt/:id`; sonst nur lesbar. */
  schreibbar?: { spalte: string };
  /** Wird in der Schnellsuche durchsucht. */
  suche?: boolean;
}

export interface ObjektDef {
  objekt: Objekt;
  tabelle: typeof organisation | typeof person | typeof deal;
  name: string;
  /** Immer geltende Bedingungen (nicht zusammengeführt, nicht archiviert). */
  basis: SQL[];
  felder: Systemfeld[];
  /** Standardreihenfolge. */
  standardSortierung: { schluessel: string; richtung: "auf" | "ab" }[];
  /** Spalte der Verknüpfung, mit der eine Liste Einträge zu `id` hat (immer `id`). */
  anzeigeName: SQL;
}

const datumText = (ausdruck: SQL) => sql`to_char(${ausdruck}, 'YYYY-MM-DD')`;

const organisationFelder: Systemfeld[] = [
  { schluessel: "name", name: "Name", typ: "text", ausdruck: sql`${organisation.name}`, schreibbar: { spalte: "name" }, suche: true },
  { schluessel: "art", name: "Art", typ: "auswahl", ausdruck: sql`${organisation.art}::text`, optionen: [...organisationArt.enumValues], schreibbar: { spalte: "art" } },
  { schluessel: "sektor", name: "Sektor", typ: "text", ausdruck: sql`${organisation.sektor}`, schreibbar: { spalte: "sektor" }, suche: true },
  { schluessel: "ort", name: "Ort", typ: "text", ausdruck: sql`${organisation.ort}`, schreibbar: { spalte: "ort" }, suche: true },
  { schluessel: "rechtsform", name: "Rechtsform", typ: "text", ausdruck: sql`${organisation.rechtsform}`, schreibbar: { spalte: "rechtsform" } },
  { schluessel: "website", name: "Website", typ: "url", ausdruck: sql`${organisation.website}`, schreibbar: { spalte: "website" } },
  { schluessel: "email", name: "E-Mail", typ: "email", ausdruck: sql`${organisation.email}`, schreibbar: { spalte: "email" }, suche: true },
  { schluessel: "telefon", name: "Telefon", typ: "telefon", ausdruck: sql`${organisation.telefon}`, schreibbar: { spalte: "telefon" } },
  { schluessel: "linkedin", name: "LinkedIn", typ: "url", ausdruck: sql`${organisation.linkedin}`, schreibbar: { spalte: "linkedin" } },
  {
    schluessel: "kontakte",
    name: "Kontakte",
    typ: "zahl",
    ausdruck: sql`(SELECT count(*) FROM ${beschaeftigung} b JOIN ${person} p ON p.id = b.person_id WHERE b.organisation_id = ${organisation.id} AND b.bis IS NULL AND p.zusammengefuehrt_in IS NULL AND p.archiviert_am IS NULL)`,
  },
  { schluessel: "erstelltAm", name: "Angelegt", typ: "datum", ausdruck: sql`(${organisation.erstelltAm} AT TIME ZONE 'UTC')::date`, ausgabe: datumText(sql`(${organisation.erstelltAm} AT TIME ZONE 'UTC')::date`) },
];

const personName = sql`(${person.vorname} || ' ' || ${person.nachname})`;

const personFelder: Systemfeld[] = [
  { schluessel: "name", name: "Name", typ: "text", ausdruck: personName, suche: true },
  { schluessel: "vorname", name: "Vorname", typ: "text", ausdruck: sql`${person.vorname}`, schreibbar: { spalte: "vorname" } },
  { schluessel: "nachname", name: "Nachname", typ: "text", ausdruck: sql`${person.nachname}`, schreibbar: { spalte: "nachname" } },
  { schluessel: "unternehmen", name: "Unternehmen", typ: "verknuepfung", ziel: "organisation", ausdruck: sql`${person.organisationId}::text`, sortAusdruck: sql`lower((SELECT o.name FROM ${organisation} o WHERE o.id = ${person.organisationId}))` },
  { schluessel: "funktion", name: "Funktion", typ: "text", ausdruck: sql`${person.funktion}`, schreibbar: { spalte: "funktion" }, suche: true },
  { schluessel: "email", name: "E-Mail", typ: "email", ausdruck: sql`${person.email}`, schreibbar: { spalte: "email" }, suche: true },
  { schluessel: "telefon", name: "Telefon", typ: "telefon", ausdruck: sql`${person.telefon}`, schreibbar: { spalte: "telefon" } },
  { schluessel: "linkedin", name: "LinkedIn", typ: "url", ausdruck: sql`${person.linkedin}`, schreibbar: { spalte: "linkedin" } },
  { schluessel: "erstelltAm", name: "Angelegt", typ: "datum", ausdruck: sql`(${person.erstelltAm} AT TIME ZONE 'UTC')::date`, ausgabe: datumText(sql`(${person.erstelltAm} AT TIME ZONE 'UTC')::date`) },
];

const dealFelder: Systemfeld[] = [
  { schluessel: "titel", name: "Titel", typ: "text", ausdruck: sql`${deal.titel}`, schreibbar: { spalte: "titel" }, suche: true },
  { schluessel: "unternehmen", name: "Unternehmen", typ: "verknuepfung", ziel: "organisation", ausdruck: sql`${deal.organisationId}::text`, sortAusdruck: sql`lower((SELECT o.name FROM ${organisation} o WHERE o.id = ${deal.organisationId}))` },
  { schluessel: "phase", name: "Phase", typ: "auswahl", ausdruck: sql`${deal.phase}::text`, optionen: [...dealPhase.enumValues] },
  { schluessel: "status", name: "Status", typ: "auswahl", ausdruck: sql`${deal.status}::text`, optionen: [...dealStatus.enumValues] },
  { schluessel: "ticket", name: "Ticket", typ: "betrag", ausdruck: sql`${deal.ticket}`, ausgabe: sql`${deal.ticket}::text`, schreibbar: { spalte: "ticket" } },
  { schluessel: "eingangsdatum", name: "Eingangsdatum", typ: "datum", ausdruck: sql`${deal.eingangsdatum}`, ausgabe: datumText(sql`${deal.eingangsdatum}`) },
  { schluessel: "herkunft", name: "Herkunft", typ: "auswahl", ausdruck: sql`${deal.herkunft}::text`, optionen: [...dealHerkunft.enumValues] },
  { schluessel: "dealtyp", name: "Dealtyp", typ: "auswahl", ausdruck: sql`${deal.dealtyp}::text`, optionen: [...dealTyp.enumValues] },
  { schluessel: "fonds", name: "Fonds", typ: "text", ausdruck: sql`(SELECT f.name FROM ${fonds} f WHERE f.id = ${deal.fondsId})` },
  { schluessel: "fondsId", name: "Fonds-ID", typ: "text", ausdruck: sql`${deal.fondsId}::text` },
  { schluessel: "investmentmanagerId", name: "Investmentmanager-ID", typ: "text", ausdruck: sql`${deal.investmentmanagerId}::text` },
  { schluessel: "projektleiterId", name: "Projektleiter-ID", typ: "text", ausdruck: sql`${deal.projektleiterId}::text` },
  { schluessel: "investmentmanager", name: "Investmentmanager", typ: "text", ausdruck: sql`(SELECT b.name FROM ${benutzer} b WHERE b.id = ${deal.investmentmanagerId})` },
  { schluessel: "projektleiter", name: "Projektleiter", typ: "text", ausdruck: sql`(SELECT b.name FROM ${benutzer} b WHERE b.id = ${deal.projektleiterId})` },
  // Kontaktwege des Unternehmens (nur lesbar): damit Zeilen und Karten der Deals dieselben Schnellaktionen zeigen wie Unternehmen und Kontakte.
  { schluessel: "unternehmenEmail", name: "E-Mail des Unternehmens", typ: "email", ausdruck: sql`(SELECT o.email FROM ${organisation} o WHERE o.id = ${deal.organisationId})` },
  { schluessel: "unternehmenTelefon", name: "Telefon des Unternehmens", typ: "telefon", ausdruck: sql`(SELECT o.telefon FROM ${organisation} o WHERE o.id = ${deal.organisationId})` },
  { schluessel: "unternehmenWebsite", name: "Website des Unternehmens", typ: "url", ausdruck: sql`(SELECT o.website FROM ${organisation} o WHERE o.id = ${deal.organisationId})` },
  { schluessel: "quelle", name: "Quelle", typ: "text", ausdruck: sql`${deal.quelle}`, schreibbar: { spalte: "quelle" } },
  { schluessel: "betreuung", name: "Betreuung", typ: "text", ausdruck: sql`${deal.betreuung}`, schreibbar: { spalte: "betreuung" } },
  { schluessel: "aktualisiertAm", name: "Aktualisiert", typ: "datum", ausdruck: sql`(${deal.aktualisiertAm} AT TIME ZONE 'UTC')::date`, ausgabe: datumText(sql`(${deal.aktualisiertAm} AT TIME ZONE 'UTC')::date`) },
  { schluessel: "erstelltAm", name: "Angelegt", typ: "datum", ausdruck: sql`(${deal.erstelltAm} AT TIME ZONE 'UTC')::date`, ausgabe: datumText(sql`(${deal.erstelltAm} AT TIME ZONE 'UTC')::date`) },
];

export const OBJEKT_DEFS: Record<Objekt, ObjektDef> = {
  organisation: {
    objekt: "organisation",
    tabelle: organisation,
    name: "Unternehmen",
    basis: [sql`${organisation.zusammengefuehrtIn} IS NULL`, sql`${organisation.archiviertAm} IS NULL`],
    felder: organisationFelder,
    standardSortierung: [{ schluessel: "name", richtung: "auf" }],
    anzeigeName: sql`${organisation.name}`,
  },
  person: {
    objekt: "person",
    tabelle: person,
    name: "Kontakte",
    basis: [sql`${person.zusammengefuehrtIn} IS NULL`, sql`${person.archiviertAm} IS NULL`],
    felder: personFelder,
    standardSortierung: [
      { schluessel: "nachname", richtung: "auf" },
      { schluessel: "vorname", richtung: "auf" },
    ],
    anzeigeName: personName,
  },
  deal: {
    objekt: "deal",
    tabelle: deal,
    name: "Deals",
    basis: [],
    felder: dealFelder,
    standardSortierung: [{ schluessel: "aktualisiertAm", richtung: "ab" }],
    anzeigeName: sql`${deal.titel}`,
  },
};

/** Ein Feld, wie der Abfragebauer es nutzt: System- oder eigenes Feld (`quelle` sagt, wo der Wert liegt). */
export interface AufgeloestesFeld {
  schluessel: string;
  name: string;
  typ: FeldTyp;
  ausdruck: SQL;
  ausgabe: SQL;
  optionen: Record<string, unknown>;
  ziel?: Objekt;
  sortAusdruck?: SQL;
  system: boolean;
  schreibbar: boolean;
  definition?: FeldDef;
}

/** Der Wertausdruck eines eigenen Feldes: je Typ aus dem JSON gelesen und umgewandelt; die ID der Definition wird immer als Parameter gebunden. */
function eigenerAusdruck(spalte: SQL, def: FeldDef): { ausdruck: SQL; ausgabe: SQL } {
  const roh = sql`(${spalte} ->> ${def.id}::text)`;
  switch (def.typ) {
    case "zahl":
    case "betrag":
      return { ausdruck: sql`${roh}::numeric`, ausgabe: roh };
    case "datum":
      return { ausdruck: sql`${roh}::date`, ausgabe: roh };
    case "kontrollkaestchen":
      return { ausdruck: sql`${roh}::boolean`, ausgabe: sql`${roh}::boolean` };
    case "mehrfachauswahl": {
      const j = sql`(${spalte} -> ${def.id}::text)`;
      return { ausdruck: j, ausgabe: j };
    }
    default:
      return { ausdruck: roh, ausgabe: roh };
  }
}

/** Alle Felder eines Objekts im Zusammenhang einer Abfrage: Systemfelder, eigene Felder und (in einer Liste) Listenfelder. */
export function loeseFelder(objekt: Objekt, eigene: FeldDef[], mitListe: boolean): Map<string, AufgeloestesFeld> {
  const def = OBJEKT_DEFS[objekt];
  const karte = new Map<string, AufgeloestesFeld>();
  for (const f of def.felder) {
    karte.set(f.schluessel, {
      schluessel: f.schluessel,
      name: f.name,
      typ: f.typ,
      ausdruck: f.ausdruck,
      ausgabe: f.ausgabe ?? f.ausdruck,
      optionen: f.optionen ? { optionen: f.optionen.map((o) => ({ schluessel: o, label: o, farbe: "grau" })) } : {},
      ...(f.ziel ? { ziel: f.ziel } : {}),
      ...(f.sortAusdruck ? { sortAusdruck: f.sortAusdruck } : {}),
      system: true,
      schreibbar: Boolean(f.schreibbar),
    });
  }
  for (const d of eigene) {
    if (d.listeId && !mitListe) continue;
    const spalte = d.listeId ? sql`${listeEintrag.felder}` : sql`${def.tabelle.felder}`;
    const { ausdruck, ausgabe } = eigenerAusdruck(spalte, d);
    karte.set(d.id, {
      schluessel: d.id,
      name: d.name,
      typ: d.typ,
      ausdruck,
      ausgabe,
      optionen: d.optionen,
      ...(d.typ === "verknuepfung" ? { ziel: d.optionen.ziel as Objekt } : {}),
      system: false,
      schreibbar: true,
      definition: d,
    });
  }
  return karte;
}
