import type { Demodaten } from "./erzeuge";
import { demoTexte, type DemoTexte } from "./texte";
import { erzeugeRng } from "./zufall";

/**
 * Demo-Daten der Etappe 18 (alle erfunden): Registereinträge mit fiktiven Nummern für einige Unternehmen (bei einem weicht die
 * Geschäftsführung vom CRM ab, bei einem steht eine Insolvenzbekanntmachung), geplante Reserven und je Fonds zwei Szenarien als Entwurf.
 * Eigener Zufallsstrom und nur lesender Zugriff auf die übrigen Daten, damit alle anderen Demo-Daten unverändert bleiben.
 */

const ABSCHLUSS = ["GmbH", "GmbH", "AG", "GmbH", "UG (haftungsbeschränkt)", "GmbH"];
const FREMDE_GF = [
  ["Johanna", "Beispielhalter"],
  ["Marcel", "Musterkamp"],
];

export function erzeugeRegisterUndSzenarien(d: Demodaten, seed: number, tx: DemoTexte = demoTexte()): void {
  const rng = erzeugeRng(seed);
  const orgs = new Map(d.organisationen.map((o) => [o.id, o]));
  const aktive = d.beteiligungen.filter((b) => b.status === "aktiv" || b.status === undefined);
  const gesehen = new Set<string>();
  const ziele = aktive.filter((b) => (gesehen.has(b.organisationId) ? false : (gesehen.add(b.organisationId), orgs.get(b.organisationId)?.art === "unternehmen"))).slice(0, 6);

  ziele.forEach((b, i) => {
    const org = orgs.get(b.organisationId)!;
    const personen = d.personen.filter((p) => p.organisationId === org.id);
    const person = personen[0];
    const rechtsform = ABSCHLUSS[i % ABSCHLUSS.length]!;
    const sitz = org.ort ?? "Beispielstadt";
    org.rechtsform = rechtsform;
    org.ort = sitz;
    const eintragId = rng.uuid();
    // Abweichung bei Nr. 2: Das Register nennt eine andere Geschäftsführung als das CRM.
    const abweichend = i === 1;
    const gf = abweichend ? FREMDE_GF[0]! : person ? [person.vorname, person.nachname] : FREMDE_GF[1]!;
    d.registereintraege.push({
      id: eintragId,
      organisationId: org.id,
      gericht: "Amtsgericht Beispielstadt",
      registerart: "HRB",
      nummer: `HRB ${99001 + i}`,
      firma: `${org.name} ${rechtsform}`,
      rechtsform,
      sitz,
      anschrift: `Beispielweg ${10 + i}, 99999 ${sitz}`,
      gegenstand: tx.register.gegenstand,
      kapital: rechtsform === "AG" ? "120000.00" : "25000.00",
      vertretung: [{ name: `${gf[0]} ${gf[1]}`, funktion: rechtsform === "AG" ? "Vorstand" : "Geschäftsführer", art: "einzelvertretungsberechtigt" }],
      prokura: i === 3 ? [{ name: "Paul Beispielmann", funktion: "Prokurist", art: "Gesamtprokura" }] : [],
      standDatum: "2026-09-30",
      quelle: "manuell",
      erfasstVon: "demo",
    });
    if (person) d.kontaktrollen.push({ personId: person.id, organisationId: org.id, rolle: "geschaeftsfuehrung", von: "2020-01-01" });

    if (i === 1) {
      d.registerEreignisse.push({ id: rng.uuid(), organisationId: org.id, registereintragId: eintragId, datum: "2026-10-05", art: "aenderung_geschaeftsfuehrung", text: tx.register.geschaeftsfuehrung, quelle: "manuell" });
    }
    if (i === 2) {
      d.registerEreignisse.push({ id: rng.uuid(), organisationId: org.id, registereintragId: eintragId, datum: "2026-11-02", art: "insolvenz", text: tx.register.insolvenz, quelle: "manuell" });
    }
    if (i === 3) {
      d.registerEreignisse.push({ id: rng.uuid(), organisationId: org.id, registereintragId: eintragId, datum: "2026-08-14", art: "kapitalerhoehung", text: tx.register.kapitalerhoehung, quelle: "manuell" });
    }
  });

  // Reserven für die ersten drei Beteiligungen
  aktive.slice(0, 3).forEach((b, i) => {
    d.reserven.push({ beteiligungId: b.id, betrag: String((i + 1) * 250_000) + ".00", gueltigAb: "2026-01-01", bemerkung: tx.reserve, erfasstVon: "demo" });
  });

  // Zwei Szenarien je Fonds (Entwurf, festgeschrieben wird in der Oberfläche)
  for (const f of d.fonds) {
    const bets = aktive.filter((b) => b.fondsId === f.id).slice(0, 8);
    const beteiligungen = (multiple: string, wahrscheinlichkeit: string, versatz: number) =>
      Object.fromEntries(bets.map((b, i) => [b.id, { ausstieg: { art: "exit", jahr: 2029 + versatz + (i % 3), multiple, wahrscheinlichkeit }, folgeinvestitionen: [] }]));
    for (const [name, multiple, p, versatz] of [
      [tx.szenarien.basis, "2.5", "1", 0],
      [tx.szenarien.vorsichtig, "1.5", "0.7", 1],
    ] as const) {
      d.szenarien.push({
        id: rng.uuid(),
        fondsId: f.id as string,
        name,
        basisStichtag: "2026-11-20",
        status: "entwurf",
        annahmen: { endJahr: 2036, wertpfad: "linear", gebuehren: { basis: "zeichnungskapital", satz: "0.02", bisJahr: 2031, sonstigeJahr: "0" }, carrySatz: "0.2", beteiligungen: beteiligungen(multiple, p, versatz), neuinvestitionen: [] },
        erstelltVon: "demo",
      });
    }
  }
}
