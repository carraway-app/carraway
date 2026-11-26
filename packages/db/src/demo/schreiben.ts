import { eq, sql } from "drizzle-orm";
import type { Db } from "../index";
import * as s from "../schema";
import type { Demodaten } from "./erzeuge";
import { ordneDemoVorgaengeRunden } from "./vorgang-runde";

const BLOCK = 1000;

async function blockweise<T>(zeilen: T[], einfuegen: (teil: T[]) => Promise<unknown>) {
  for (let i = 0; i < zeilen.length; i += BLOCK) await einfuegen(zeilen.slice(i, i + BLOCK));
}

/** Leert alle Tabellen und schreibt die Demo-Daten in einer Transaktion. */
export async function schreibeDemodaten(db: Db, daten: Demodaten) {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`TRUNCATE TABLE wechselkurs, datensatz_link, aufgabe, liste_eintrag, feld_definition, ansicht, liste, deal_kontakt, beschaeftigung, fonds_offenlegung, foerderprogramm, melde_datei, melde_freigabe, melde_wert, melde_lauf, melde_aktivierung, organisation_meldedaten, buchungsexport_position, buchungsexport, buchungsregel, saldo, saldenlauf_befund, saldenlauf, kontenregel, gliederung_position, sachkonto, beleg_stufe, beleg_nummernkreis, beleg, beleg_art_eigen, beleg_vorlage, fonds_mittelart, beteiligung_buchhaltung, fonds_buchhaltung, wert_quelle, auslesung, dokument_seite, dokument_verknuepfung, dokument, bericht_variante, fonds_mitteilung, investor_zugang, abfrage_zugriff, kennzahl_wert, kennzahl_abfrage_position, kennzahl_abfrage, fonds_kennzahl, kontaktrolle, organisationsbeziehung, beschlussvorlage, import_befund, import_zuordnung, import_lauf, idempotenz_schluessel, aenderung, snapshot_auftrag, bericht_vorlage, bericht_freigabestufen, kennzahl_snapshot, rundenposition_zahlung, vorgang_runde, runde_buchung, zuteilung_austritt, mitarbeiterzuteilung, pool_aenderung, mitarbeiterpool, rundenposition, vehikel, anteilsklasse, finanzierungsrunde, vorgang, tranche, instrument, bewertung, beteiligung, aktivitaet, beschluss, deal_phasenwechsel, deal, fonds_bewegung, fonds, person, organisation CASCADE`,
    );
    await blockweise(daten.organisationen, (z) => tx.insert(s.organisation).values(z));
    await blockweise(daten.personen, (z) => tx.insert(s.person).values(z));
    await blockweise(daten.fonds, (z) => tx.insert(s.fonds).values(z));
    await blockweise(daten.fondsBewegungen, (z) => tx.insert(s.fondsBewegung).values(z));
    await blockweise(daten.fondsZeichnungen, (z) => tx.insert(s.fondsZeichnung).values(z));
    await blockweise(daten.abrufAnteile, (z) => tx.insert(s.abrufAnteil).values(z));
    await blockweise(daten.lpZahlungen, (z) => tx.insert(s.lpZahlung).values(z));
    await blockweise(daten.vehikel, (z) => tx.insert(s.vehikel).values(z));
    await blockweise(daten.anteilsklassen, (z) => tx.insert(s.anteilsklasse).values(z));
    await blockweise(daten.finanzierungsrunden, (z) => tx.insert(s.finanzierungsrunde).values(z));
    await blockweise(daten.deals, (z) => tx.insert(s.deal).values(z));
    await blockweise(daten.beschaeftigungen, (z) => tx.insert(s.beschaeftigung).values(z));
    await blockweise(daten.dealKontakte, (z) => tx.insert(s.dealKontakt).values(z));
    await blockweise(daten.listen, (z) => tx.insert(s.liste).values(z));
    await blockweise(daten.feldDefinitionen, (z) => tx.insert(s.feldDefinition).values(z));
    await blockweise(daten.listenEintraege, (z) => tx.insert(s.listeEintrag).values(z));
    await blockweise(daten.aufgaben, (z) => tx.insert(s.aufgabe).values(z));
    await blockweise(daten.datensatzLinks, (z) => tx.insert(s.datensatzLink).values(z));
    await blockweise(daten.dealPhasenwechsel, (z) => tx.insert(s.dealPhasenwechsel).values(z));
    await blockweise(daten.aktivitaeten, (z) => tx.insert(s.aktivitaet).values(z));
    await blockweise(daten.beschluesse, (z) => tx.insert(s.beschluss).values(z));
    await blockweise(daten.beteiligungen, (z) => tx.insert(s.beteiligung).values(z));
    await blockweise(daten.instrumente, (z) => tx.insert(s.instrument).values(z));
    await blockweise(daten.tranchen, (z) => tx.insert(s.tranche).values(z));
    // Positionen eigener Fonds verweisen auf ihr Instrument, deshalb erst nach den Instrumenten.
    await blockweise(daten.rundenpositionen, (z) => tx.insert(s.rundenposition).values(z));
    await blockweise(daten.mitarbeiterpools, (z) => tx.insert(s.mitarbeiterpool).values(z));
    await blockweise(daten.poolAenderungen, (z) => tx.insert(s.poolAenderung).values(z));
    await blockweise(daten.mitarbeiterzuteilungen, (z) => tx.insert(s.mitarbeiterzuteilung).values(z));
    await blockweise(daten.vorgaenge, (z) => tx.insert(s.vorgang).values(z));
    await blockweise(daten.wandlungen, (z) => tx.insert(s.wandlung).values(z));
    // Zuerst die ausdrücklichen Zuordnungen (Buchungen der Wandlung gehören zur Zielrunde), dann die übrigen nach der Runde ihres Instruments.
    await blockweise(daten.vorgangRunden, (z) => tx.insert(s.vorgangRunde).values(z.map((r) => ({ ...r, quelle: "automatisch" as const, geaendertVon: "Demo" }))));
    await ordneDemoVorgaengeRunden(tx, daten.vorgangOhneRunde);
    await blockweise(daten.bewertungen, (z) => tx.insert(s.bewertung).values(z));
    await blockweise(daten.darlehenKonditionen, (z) => tx.insert(s.darlehenKondition).values(z));
    await blockweise(daten.jahresueberschuesse, (z) => tx.insert(s.jahresueberschuss).values(z));
    await blockweise(daten.fondsKennzahlen, (z) => tx.insert(s.fondsKennzahl).values(z));
    // Buchhaltung (Etappe 14); die Saldenläufe tragen die Datei, die Salden zeigen auf den Lauf.
    await blockweise(daten.foerderprogramme, (z) => tx.insert(s.foerderprogramm).values(z));
    await blockweise(daten.fondsBuchhaltung, (z) => tx.insert(s.fondsBuchhaltung).values(z));
    await blockweise(daten.beteiligungBuchhaltung, (z) => tx.insert(s.beteiligungBuchhaltung).values(z));
    await blockweise(daten.fondsMittelarten, (z) => tx.insert(s.fondsMittelart).values(z));
    await blockweise(daten.gliederungPositionen, (z) => tx.insert(s.gliederungPosition).values(z));
    await blockweise(daten.sachkonten, (z) => tx.insert(s.sachkonto).values(z));
    await blockweise(daten.kontenregeln, (z) => tx.insert(s.kontenregel).values(z));
    await blockweise(daten.buchungsregeln, (z) => tx.insert(s.buchungsregel).values(z));
    await blockweise(daten.saldenlaeufe, (z) => tx.insert(s.saldenlauf).values(z));
    await blockweise(daten.salden, (z) => tx.insert(s.saldo).values(z));
    await blockweise(daten.fondsOffenlegungen, (z) => tx.insert(s.fondsOffenlegung).values(z));
    await blockweise(daten.kontaktrollen, (z) => tx.insert(s.kontaktrolle).values(z));
    await blockweise(daten.registereintraege, (z) => tx.insert(s.registereintrag).values(z));
    await blockweise(daten.registerEreignisse, (z) => tx.insert(s.registerEreignis).values(z));
    await blockweise(daten.reserven, (z) => tx.insert(s.reserve).values(z));
    await blockweise(daten.szenarien, (z) => tx.insert(s.szenario).values(z));
    // Der Katalog (Version 1) stammt aus der Migration und bleibt beim Leeren erhalten; die Werte verweisen über den Schlüssel darauf.
    const definitionen = new Map((await tx.select({ id: s.kennzahlDefinition.id, schluessel: s.kennzahlDefinition.schluessel }).from(s.kennzahlDefinition).where(eq(s.kennzahlDefinition.katalogVersion, 1))).map((x) => [x.schluessel, x.id]));
    await blockweise([...daten.kennzahlWerte, ...daten.esgWerte], (z) =>
      tx.insert(s.kennzahlWert).values(
        z.map(({ schluessel, ...rest }) => {
          const definitionId = definitionen.get(schluessel);
          if (!definitionId) throw new Error(`Kennzahl ${schluessel} fehlt im Katalog (Version 1).`);
          return { ...rest, definitionId };
        }),
      ),
    );
  });
}
