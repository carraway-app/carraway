import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { kontaktRolle, kontaktrolle, organisation, organisationArt, person } from "@carraway/db";
import { findeDubletten, findePersonenDubletten, type DublettenKandidat, type PersonenKandidat } from "../dubletten";
import { setzeHauptunternehmen } from "../crm/datensatz";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import type { Rohzeile } from "./import-datei";

/**
 * Kontaktimport (Etappe 7): Planung und Übernahme laufen durch dieselbe Funktion. Die Vorschau führt sie ohne Protokollant
 * (nichts wird geschrieben), die Übernahme mit Protokollant in einer Transaktion. Dadurch zeigt die Vorschau genau das, was
 * die Übernahme tut. Idempotent: Organisationen gelten über den Namen ohne Rechtsform als vorhanden, Personen über die
 * E-Mail-Adresse (ohne Adresse über Name und Organisation); vorhandene Datensätze werden nur ergänzt, nie überschrieben.
 */

export type Aktion = "anlegen" | "zusammenfuehren" | "ueberspringen";
export interface Entscheidung {
  zeile: number;
  aktion: Aktion;
  /** Ziel bei `zusammenfuehren`; ohne Angabe der vorhandene Datensatz mit gleichem Schlüssel. */
  zielId?: string | undefined;
}

export type Ergebnis = "angelegt" | "ergaenzt" | "unveraendert" | "uebersprungen" | "fehler";

export interface Plan {
  zeile: number;
  typ: "organisation" | "person" | null;
  anzeige: string;
  werte: Record<string, string | null>;
  /** Maschinenlesbare Gründe; die Oberfläche übersetzt sie. */
  fehler: string[];
  status: "neu" | "vorhanden" | "fehler";
  /** Datensatz mit gleichem Schlüssel: in Carraway (`id`) oder weiter oben in der Datei (`zeileInDatei`). */
  vorhanden: { id: string | null; name: string; zeileInDatei: number | null } | null;
  kandidaten: (DublettenKandidat | PersonenKandidat)[];
  organisation: { name: string; zuordnung: "datei" | "vorhanden" } | null;
  vorschlag: Aktion;
  /** Was mit der Zeile geschieht (Vorschlag oder Entscheidung). */
  aktion: Aktion;
  /** Nur nach der Übernahme. */
  ergebnis: Ergebnis | null;
  id: string | null;
}

export interface Zusammenfassung {
  zeilen: number;
  neu: number;
  vorhanden: number;
  mitKandidaten: number;
  fehler: number;
}

// Prüfen und Umsetzen -----------------------------------------------------------------------------------------------

const ohneAkzente = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "");
const schluessel = (t: string) => ohneAkzente(t.trim().toLowerCase()).replace(/[\s-]+/g, "_");

const ARTEN: Record<string, (typeof organisationArt.enumValues)[number]> = {
  unternehmen: "unternehmen",
  company: "unternehmen",
  startup: "unternehmen",
  investor: "investor",
  berater: "berater",
  advisor: "berater",
  adviser: "berater",
  sonstige: "sonstige",
  other: "sonstige",
};
const ROLLEN: Record<string, (typeof kontaktRolle.enumValues)[number]> = {
  gruender: "gruender",
  founder: "gruender",
  geschaeftsfuehrung: "geschaeftsfuehrung",
  geschaeftsfuehrer: "geschaeftsfuehrung",
  geschaeftsfuehrerin: "geschaeftsfuehrung",
  managing_director: "geschaeftsfuehrung",
  ceo: "geschaeftsfuehrung",
  co_investor: "co_investor",
  coinvestor: "co_investor",
  berater: "berater",
  advisor: "berater",
  adviser: "berater",
  investor_lp: "investor_lp",
  lp: "investor_lp",
  sonstige: "sonstige",
  other: "sonstige",
};

const emailPruefung = z.email().max(300);
const webPruefung = z.string().max(300).refine((w) => {
  try {
    const u = new URL(w);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
});

/** `JJJJ-MM-TT` oder `TT.MM.JJJJ` als ISO-Datum; sonst `undefined`. */
function datum(text: string): string | undefined {
  const deutsch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  const iso = deutsch ? `${deutsch[3]}-${deutsch[2]!.padStart(2, "0")}-${deutsch[1]!.padStart(2, "0")}` : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : undefined;
}

interface Geprueft {
  typ: "organisation" | "person" | null;
  anzeige: string;
  werte: Record<string, string | null>;
  fehler: string[];
}

function pruefeZeile(roh: Rohzeile): Geprueft {
  const typ = schluessel(roh.typ ?? "");
  const fehler: string[] = [];
  const zuLang = (text: string | undefined, max: number, name: string) => {
    if (text !== undefined && text.length > max) fehler.push(`${name}_zu_lang`);
  };
  if (typ === "organisation" || typ === "organization") {
    if (!roh.name) fehler.push("name_fehlt");
    const art = roh.art ? ARTEN[schluessel(roh.art)] : undefined;
    if (!roh.art) fehler.push("art_fehlt");
    else if (!art) fehler.push("art_unbekannt");
    zuLang(roh.name, 300, "name");
    zuLang(roh.sektor, 200, "sektor");
    zuLang(roh.ort, 200, "ort");
    if (roh.website && !webPruefung.safeParse(roh.website).success) fehler.push("website_ungueltig");
    return {
      typ: "organisation",
      anzeige: roh.name ?? "",
      werte: { name: roh.name ?? null, art: art ?? null, sektor: roh.sektor ?? null, ort: roh.ort ?? null, website: roh.website ?? null },
      fehler,
    };
  }
  if (typ === "person") {
    if (!roh.vorname) fehler.push("vorname_fehlt");
    if (!roh.nachname) fehler.push("nachname_fehlt");
    zuLang(roh.vorname, 200, "vorname");
    zuLang(roh.nachname, 200, "nachname");
    zuLang(roh.funktion, 200, "funktion");
    if (roh.email && !emailPruefung.safeParse(roh.email).success) fehler.push("email_ungueltig");
    const rolle = roh.rolle ? ROLLEN[schluessel(roh.rolle)] : undefined;
    if (roh.rolle && !rolle) fehler.push("rolle_unbekannt");
    if (roh.rolle && !roh.organisation) fehler.push("rolle_ohne_organisation");
    const von = roh.von ? datum(roh.von) : undefined;
    const bis = roh.bis ? datum(roh.bis) : undefined;
    if ((roh.von && !von) || (roh.bis && !bis)) fehler.push("datum_ungueltig");
    else if (von && bis && bis < von) fehler.push("zeitraum_ungueltig");
    return {
      typ: "person",
      anzeige: [roh.vorname, roh.nachname].filter(Boolean).join(" "),
      werte: {
        vorname: roh.vorname ?? null,
        nachname: roh.nachname ?? null,
        email: roh.email?.toLowerCase() ?? null,
        funktion: roh.funktion ?? null,
        organisation: roh.organisation ?? null,
        rolle: rolle ?? null,
        von: von ?? null,
        bis: bis ?? null,
      },
      fehler,
    };
  }
  return { typ: null, anzeige: roh.name ?? [roh.vorname, roh.nachname].filter(Boolean).join(" "), werte: {}, fehler: ["typ_unbekannt"] };
}

// Lauf --------------------------------------------------------------------------------------------------------------

interface Eintrag {
  id: string | null;
  zeile: number;
  /** Die Zeile wird übersprungen (Kandidaten ohne Entscheidung): Personen, die auf sie verweisen, scheitern bei der Übernahme. */
  uebersprungen?: boolean;
}

/**
 * Plant (ohne `protokoll`) oder übernimmt (mit `protokoll`) die Zeilen. Organisationszeilen laufen vor den Personen, damit
 * Personen auf Organisationen derselben Datei verweisen können.
 */
export async function verarbeiteImport(
  tx: Tx,
  protokoll: Protokollant | null,
  zeilen: { zeile: number; werte: Rohzeile }[],
  entscheidungen: Entscheidung[],
): Promise<{ plaene: Plan[]; zusammenfassung: Zusammenfassung }> {
  const entscheidung = new Map(entscheidungen.map((e) => [e.zeile, e]));
  const geprueft = zeilen.map((z) => ({ zeile: z.zeile, ...pruefeZeile(z.werte) }));

  // Schlüssel der Organisationsnamen (Name ohne Rechtsform und Satzzeichen) in einer Abfrage.
  const namen = [...new Set(geprueft.flatMap((g) => [g.typ === "organisation" ? g.werte.name : null, g.typ === "person" ? g.werte.organisation : null]).filter((n): n is string => Boolean(n)))];
  const schluesselVon = new Map<string, string>();
  if (namen.length > 0) {
    const { rows } = await tx.execute<{ name: string; schluessel: string }>(sql`
      SELECT n AS name, organisation_name_normalisiert(n) AS schluessel FROM unnest(ARRAY[${sql.join(namen.map((n) => sql`${n}`), sql`, `)}]::text[]) AS n`);
    for (const r of rows) schluesselVon.set(r.name, r.schluessel || r.name.toLowerCase());
  }

  const orgKarte = new Map<string, Eintrag>();
  const personKarte = new Map<string, Eintrag>();
  const ergebnisse = new Map<number, Plan>();

  const leerPlan = (g: (typeof geprueft)[number]): Plan => ({
    zeile: g.zeile,
    typ: g.typ,
    anzeige: g.anzeige,
    werte: g.werte,
    fehler: g.fehler,
    status: g.fehler.length > 0 ? "fehler" : "neu",
    vorhanden: null,
    kandidaten: [],
    organisation: null,
    vorschlag: "ueberspringen",
    aktion: "ueberspringen",
    ergebnis: null,
    id: null,
  });

  /** Wählt die Aktion: Entscheidung der Person oder Vorschlag; ein vorhandener Schlüssel erzwingt Ergänzen statt Doppelanlage (Idempotenz). */
  function waehle(plan: Plan): { aktion: Aktion; zielId: string | null; fehler: string | null } {
    const e = entscheidung.get(plan.zeile);
    let aktion = e?.aktion ?? plan.vorschlag;
    if (aktion === "anlegen" && plan.vorhanden) aktion = "zusammenfuehren";
    plan.aktion = aktion;
    if (aktion !== "zusammenfuehren") return { aktion, zielId: null, fehler: null };
    const zielId = e?.zielId ?? plan.vorhanden?.id ?? null;
    if (!zielId && !plan.vorhanden) return { aktion, zielId: null, fehler: "ziel_fehlt" };
    return { aktion, zielId, fehler: null };
  }

  const fertig = (plan: Plan, ergebnis: Ergebnis, id: string | null) => {
    if (protokoll) {
      plan.ergebnis = ergebnis;
      plan.id = id;
    }
  };

  // Zeilen mit unbekanntem Typ ----------------------------------------------------------------------------------------
  for (const g of geprueft.filter((x) => x.typ === null)) {
    const plan = leerPlan(g);
    ergebnisse.set(g.zeile, plan);
    fertig(plan, "fehler", null);
  }

  // Organisationen ----------------------------------------------------------------------------------------------------
  for (const g of geprueft.filter((x) => x.typ === "organisation")) {
    const plan = leerPlan(g);
    ergebnisse.set(g.zeile, plan);
    if (plan.status === "fehler") {
      fertig(plan, "fehler", null);
      continue;
    }
    const name = g.werte.name!;
    const key = schluesselVon.get(name)!;
    const inDatei = orgKarte.get(key);
    let exakt: { id: string; name: string } | null = null;
    if (inDatei) plan.vorhanden = { id: inDatei.id, name, zeileInDatei: inDatei.zeile };
    else {
      const { rows } = await tx.execute<{ id: string; name: string }>(sql`
        SELECT id, name FROM organisation WHERE zusammengefuehrt_in IS NULL AND organisation_name_normalisiert(name) = ${key} ORDER BY id`);
      if (rows.length === 1) {
        exakt = rows[0]!;
        plan.vorhanden = { id: exakt.id, name: exakt.name, zeileInDatei: null };
      }
    }
    plan.kandidaten = plan.vorhanden ? [] : (await findeDubletten(tx, name)).filter((k) => k.id !== exakt?.id);
    plan.status = plan.vorhanden ? "vorhanden" : "neu";
    plan.vorschlag = plan.vorhanden ? "zusammenfuehren" : plan.kandidaten.length > 0 ? "ueberspringen" : "anlegen";

    const wahl = waehle(plan);
    if (wahl.fehler) {
      plan.fehler = [wahl.fehler];
      plan.status = "fehler";
      fertig(plan, "fehler", null);
      continue;
    }
    if (wahl.aktion === "ueberspringen") {
      if (!orgKarte.has(key)) orgKarte.set(key, { id: null, zeile: g.zeile, uebersprungen: true });
      fertig(plan, "uebersprungen", null);
      continue;
    }
    if (wahl.aktion === "anlegen") {
      if (!protokoll) {
        orgKarte.set(key, { id: null, zeile: g.zeile });
        continue;
      }
      const [neu] = await tx
        .insert(organisation)
        .values({ name, art: g.werte.art as (typeof organisationArt.enumValues)[number], sektor: g.werte.sektor, ort: g.werte.ort, website: g.werte.website })
        .returning();
      await protokoll("anlegen", "organisation", neu!.id, null, neu);
      orgKarte.set(key, { id: neu!.id, zeile: g.zeile });
      fertig(plan, "angelegt", neu!.id);
      continue;
    }
    // Ergänzen: nur leere Felder des vorhandenen Datensatzes füllen.
    const ziel = wahl.zielId ?? plan.vorhanden?.id ?? null;
    if (ziel === null) {
      // Vorhanden weiter oben in der Datei und dort nur geplant (Vorschau): nichts zu tun.
      continue;
    }
    const [vorher] = await tx.select().from(organisation).where(and(eq(organisation.id, ziel), isNull(organisation.zusammengefuehrtIn)));
    if (!vorher) {
      plan.fehler = ["ziel_unbekannt"];
      plan.status = "fehler";
      fertig(plan, "fehler", null);
      continue;
    }
    orgKarte.set(key, { id: ziel, zeile: g.zeile });
    const fuellen = {
      ...(vorher.sektor === null && g.werte.sektor ? { sektor: g.werte.sektor } : {}),
      ...(vorher.ort === null && g.werte.ort ? { ort: g.werte.ort } : {}),
      ...(vorher.website === null && g.werte.website ? { website: g.werte.website } : {}),
    };
    if (protokoll && Object.keys(fuellen).length > 0) {
      const [nachher] = await tx.update(organisation).set(fuellen).where(eq(organisation.id, ziel)).returning();
      await protokoll("aendern", "organisation", ziel, vorher, nachher);
      fertig(plan, "ergaenzt", ziel);
    } else fertig(plan, "unveraendert", ziel);
  }

  // Personen ----------------------------------------------------------------------------------------------------------
  for (const g of geprueft.filter((x) => x.typ === "person")) {
    const plan = leerPlan(g);
    ergebnisse.set(g.zeile, plan);
    // Organisation der Person: aus der Datei oder vorhanden (genau ein Treffer über den Namensschlüssel).
    let orgId: string | null = null;
    let orgKey: string | null = null;
    if (g.werte.organisation && plan.status !== "fehler") {
      orgKey = schluesselVon.get(g.werte.organisation)!;
      const inDatei = orgKarte.get(orgKey);
      if (inDatei) {
        orgId = inDatei.id;
        plan.organisation = { name: g.werte.organisation, zuordnung: "datei" };
        // In der Vorschau steht die Entscheidung über die Organisation noch aus; bei der Übernahme muss sie angelegt oder ergänzt sein.
        if (inDatei.uebersprungen && protokoll) {
          plan.fehler = [...plan.fehler, "organisation_unbekannt"];
          plan.status = "fehler";
        }
      } else {
        const { rows } = await tx.execute<{ id: string }>(sql`
          SELECT id FROM organisation WHERE zusammengefuehrt_in IS NULL AND organisation_name_normalisiert(name) = ${orgKey} ORDER BY id`);
        if (rows.length === 1) {
          orgId = rows[0]!.id;
          plan.organisation = { name: g.werte.organisation, zuordnung: "vorhanden" };
        } else {
          plan.fehler = [...plan.fehler, "organisation_unbekannt"];
          plan.status = "fehler";
        }
      }
    }
    if (plan.status === "fehler") {
      fertig(plan, "fehler", null);
      continue;
    }
    const email = g.werte.email;
    const vorname = g.werte.vorname!;
    const nachname = g.werte.nachname!;
    const key = email ? `email:${email}` : `name:${vorname.toLowerCase()}|${nachname.toLowerCase()}|${orgKey ?? ""}`;
    const inDatei = personKarte.get(key);
    let exakt: { id: string } | null = null;
    if (inDatei) plan.vorhanden = { id: inDatei.id, name: plan.anzeige, zeileInDatei: inDatei.zeile };
    else {
      const { rows } = email
        ? await tx.execute<{ id: string }>(sql`SELECT id FROM person WHERE zusammengefuehrt_in IS NULL AND lower(email) = ${email} ORDER BY id`)
        : orgId
          ? await tx.execute<{ id: string }>(sql`
              SELECT id FROM person WHERE zusammengefuehrt_in IS NULL AND email IS NULL AND lower(vorname) = ${vorname.toLowerCase()} AND lower(nachname) = ${nachname.toLowerCase()} AND organisation_id = ${orgId} ORDER BY id`)
          : { rows: [] as { id: string }[] };
      if (rows.length === 1) {
        exakt = rows[0]!;
        plan.vorhanden = { id: exakt.id, name: plan.anzeige, zeileInDatei: null };
      }
    }
    plan.kandidaten = plan.vorhanden ? [] : (await findePersonenDubletten(tx, { vorname, nachname, email })).filter((k) => k.id !== exakt?.id);
    plan.status = plan.vorhanden ? "vorhanden" : "neu";
    plan.vorschlag = plan.vorhanden ? "zusammenfuehren" : plan.kandidaten.length > 0 ? "ueberspringen" : "anlegen";

    const wahl = waehle(plan);
    if (wahl.fehler) {
      plan.fehler = [wahl.fehler];
      plan.status = "fehler";
      fertig(plan, "fehler", null);
      continue;
    }
    if (wahl.aktion === "ueberspringen") {
      fertig(plan, "uebersprungen", null);
      continue;
    }
    if (!protokoll) {
      if (wahl.aktion === "anlegen") personKarte.set(key, { id: null, zeile: g.zeile });
      continue;
    }

    let personId: string;
    let ergebnis: Ergebnis;
    if (wahl.aktion === "anlegen") {
      const [neu] = await tx.insert(person).values({ vorname, nachname, email, funktion: g.werte.funktion, organisationId: orgId }).returning();
      await protokoll("anlegen", "person", neu!.id, null, neu);
      if (orgId) await setzeHauptunternehmen(tx, neu!.id, orgId, neu!.funktion);
      personId = neu!.id;
      ergebnis = "angelegt";
    } else {
      const ziel = wahl.zielId ?? plan.vorhanden?.id ?? null;
      const [vorher] = ziel ? await tx.select().from(person).where(and(eq(person.id, ziel), isNull(person.zusammengefuehrtIn))) : [];
      if (!vorher) {
        plan.fehler = ["ziel_unbekannt"];
        plan.status = "fehler";
        fertig(plan, "fehler", null);
        continue;
      }
      personId = vorher.id;
      const fuellen = {
        ...(vorher.email === null && email ? { email } : {}),
        ...(vorher.funktion === null && g.werte.funktion ? { funktion: g.werte.funktion } : {}),
        ...(vorher.organisationId === null && orgId ? { organisationId: orgId } : {}),
      };
      ergebnis = "unveraendert";
      if (Object.keys(fuellen).length > 0) {
        const [nachher] = await tx.update(person).set(fuellen).where(eq(person.id, personId)).returning();
        await protokoll("aendern", "person", personId, vorher, nachher);
        if (fuellen.organisationId && nachher) await setzeHauptunternehmen(tx, personId, nachher.organisationId, nachher.funktion);
        ergebnis = "ergaenzt";
      }
    }
    personKarte.set(key, { id: personId, zeile: g.zeile });

    // Rolle: nur anlegen, wenn die Person sie bei der Organisation nicht schon mit gleichem Beginn hat.
    if (g.werte.rolle && orgId) {
      const rolle = g.werte.rolle as (typeof kontaktRolle.enumValues)[number];
      const [vorhanden] = await tx
        .select({ id: kontaktrolle.id })
        .from(kontaktrolle)
        .where(
          and(
            eq(kontaktrolle.personId, personId),
            eq(kontaktrolle.organisationId, orgId),
            eq(kontaktrolle.rolle, rolle),
            g.werte.von ? eq(kontaktrolle.von, g.werte.von) : isNull(kontaktrolle.von),
          ),
        );
      if (!vorhanden) {
        const [neueRolle] = await tx.insert(kontaktrolle).values({ personId, organisationId: orgId, rolle, von: g.werte.von, bis: g.werte.bis }).returning();
        await protokoll("anlegen", "kontaktrolle", neueRolle!.id, null, neueRolle);
        if (ergebnis === "unveraendert") ergebnis = "ergaenzt";
      }
    }
    fertig(plan, ergebnis, personId);
  }

  const plaene = [...ergebnisse.values()].sort((a, b) => a.zeile - b.zeile);
  const zusammenfassung: Zusammenfassung = {
    zeilen: plaene.length,
    neu: plaene.filter((p) => p.status === "neu" && p.kandidaten.length === 0).length,
    vorhanden: plaene.filter((p) => p.status === "vorhanden").length,
    mitKandidaten: plaene.filter((p) => p.kandidaten.length > 0).length,
    fehler: plaene.filter((p) => p.status === "fehler").length,
  };
  if (protokoll) {
    const zaehle = (e: Ergebnis) => plaene.filter((p) => p.ergebnis === e).length;
    await protokoll("import", "kontaktimport", randomUUID(), null, {
      zeilen: plaene.length,
      angelegt: zaehle("angelegt"),
      ergaenzt: zaehle("ergaenzt"),
      unveraendert: zaehle("unveraendert"),
      uebersprungen: zaehle("uebersprungen"),
      fehler: zaehle("fehler"),
    });
  }
  return { plaene, zusammenfassung };
}
