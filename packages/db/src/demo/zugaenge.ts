import { inArray, sql } from "drizzle-orm";
import { hashPassword, symmetricEncrypt } from "better-auth/crypto";
import type { Db } from "../index";
import * as s from "../schema";
import { LOKALES_ENTWICKLUNGSGEHEIMNIS } from "../zugang";
import { DEMO_FELD } from "./crm";

/**
 * Demo-Zugänge für die lokale Entwicklung. ALLES HIER IST ERFUNDEN UND ÖFFENTLICH: Namen, Adressen (reservierte
 * Domain `.example`), Passwörter und TOTP-Geheimnisse stehen im Repository und schützen nichts. Sie dürfen nie in
 * einem Echtbestand oder auf einem erreichbaren Server verwendet werden; das Seed-Skript lehnt `echt` ab.
 */

export interface DemoZugang {
  name: string;
  email: string;
  passwort: string;
  /** TOTP-Geheimnis in Base32, wie es eine Authenticator-App erwartet (SHA-1, 6 Stellen, 30 Sekunden). */
  totpGeheimnis: string;
  wiederherstellungscodes: string[];
  /** Verwalter aller Fonds. */
  globalVerwalter: boolean;
  rolle: (typeof s.fondsRolle.enumValues)[number];
  /** `alle` oder die Nummer des Fonds (1 = erster Fonds nach Auflegung); `[]` ohne eigene Fondsrolle. */
  fonds: "alle" | number[];
  /** Name einer Gruppe aus `DEMO_GRUPPEN` (Rechtemodell); ohne Angabe keine Gruppe, also alle Bereiche wie bisher. */
  gruppe?: string;
  beschreibung: string;
}

export const DEMO_ZUGAENGE: DemoZugang[] = [
  {
    name: "Vera Beispiel",
    email: "vera@beispiel.example",
    passwort: "Demo-Lokal-Verwaltung-1",
    totpGeheimnis: "KRSXG5CTMVRXEZLUKN2XAZLSNFXGO4TF",
    wiederherstellungscodes: ["demo-verw-0001", "demo-verw-0002"],
    globalVerwalter: true,
    rolle: "verwalter",
    fonds: "alle",
    beschreibung: "Verwalterin aller Fonds: Benutzer, Rollen, Periodensperre, API-Schlüssel",
  },
  {
    name: "Frieda Beispiel",
    email: "frieda@beispiel.example",
    passwort: "Demo-Lokal-Freigabe-1",
    totpGeheimnis: "MZRWC3TFOJQXIZLTONSWY2LUMVZGKZLB",
    wiederherstellungscodes: ["demo-frei-0001", "demo-frei-0002"],
    globalVerwalter: false,
    rolle: "freigeber",
    fonds: "alle",
    beschreibung: "Freigeberin: prüft und gibt frei (erste Person im Vier-Augen-Ablauf)",
  },
  {
    name: "Friedrich Beispiel",
    email: "friedrich@beispiel.example",
    passwort: "Demo-Lokal-Freigabe-2",
    totpGeheimnis: "MZRWI2LEMJSWK5DSOVZWK4TTNFXGM3DB",
    wiederherstellungscodes: ["demo-frei-0003", "demo-frei-0004"],
    globalVerwalter: false,
    rolle: "freigeber",
    fonds: "alle",
    beschreibung: "Freigeber: zweite Person im Vier-Augen-Ablauf",
  },
  {
    name: "Berta Beispiel",
    email: "berta@beispiel.example",
    passwort: "Demo-Lokal-Bearbeitung-1",
    totpGeheimnis: "MJSXEYLSMNXGG33NNRSWC5DFMZRXGZLT",
    wiederherstellungscodes: ["demo-bear-0001", "demo-bear-0002"],
    globalVerwalter: false,
    rolle: "bearbeiter",
    fonds: "alle",
    beschreibung: "Bearbeiterin: erfasst Daten, kann nichts freigeben",
  },
  {
    name: "Bernd Beispiel",
    email: "bernd@beispiel.example",
    passwort: "Demo-Lokal-Ansicht-1",
    totpGeheimnis: "MJSXEZLOMFZGK43FNZSWO3DPNRSXE2LO",
    wiederherstellungscodes: ["demo-ansi-0001", "demo-ansi-0002"],
    globalVerwalter: false,
    rolle: "betrachter",
    fonds: [1],
    beschreibung: "Betrachter nur des ersten Fonds: sieht die anderen Fonds nicht",
  },
  {
    name: "Rita Beispiel",
    email: "rita@beispiel.example",
    passwort: "Demo-Lokal-Kontakte-1",
    totpGeheimnis: "OJUXIYJAMJSWS43QNFSWYIDLN5XHIYLL",
    wiederherstellungscodes: ["demo-kont-0001", "demo-kont-0002"],
    globalVerwalter: false,
    rolle: "betrachter",
    fonds: [],
    gruppe: "Relationship Management",
    beschreibung: "Gruppe Relationship Management: pflegt Kontakte, sieht keine Finanzdaten, keine Deals und keine Buchhaltung",
  },
  {
    name: "Carl Beispiel",
    email: "carl@beispiel.example",
    passwort: "Demo-Lokal-Controlling-1",
    totpGeheimnis: "MNQXE3BAMJSWS43QNFSWYIDDN5XHI4TP",
    wiederherstellungscodes: ["demo-cont-0001", "demo-cont-0002"],
    globalVerwalter: false,
    rolle: "betrachter",
    fonds: [2],
    gruppe: "Fondsmanagement und Controlling",
    beschreibung: "Gruppe Fondsmanagement und Controlling (nur erster Fonds, Bearbeiter), dazu als Ausnahme Betrachter des zweiten Fonds",
  },
];

/** Beispielrollen des Rechtemodells (Bündel von Bereichen, Schlüssel wie `BEREICHE` der API). */
export const DEMO_ROLLEN: { name: string; beschreibung: string; bereiche: string[] }[] = [
  { name: "Investments", beschreibung: "Portfolio, Dealflow, Kontakte, Kennzahlen und Dokumente", bereiche: ["portfolio", "dealflow", "kontakte", "kennzahlen", "dokumente"] },
  { name: "Finanzen und Berichte", beschreibung: "Portfolio, Finanzen, Berichte, Meldewesen und Kennzahlen", bereiche: ["portfolio", "finanzen", "berichte", "meldewesen", "kennzahlen"] },
  { name: "Kontakte", beschreibung: "Nur Kontakte: keine Finanzdaten", bereiche: ["kontakte"] },
];

/** Beispielgruppen: Stufe an den Fonds der Gruppe, Rollen und Fondszugriff (`fonds`: Nummern; ohne Angabe gilt die zentrale Einstellung). */
export const DEMO_GRUPPEN: { name: string; beschreibung: string; stufe: (typeof s.fondsRolle.enumValues)[number]; rollen: string[]; fonds?: number[] }[] = [
  { name: "Investmentmanagement", beschreibung: "Beteiligungen und Dealflow aller Fonds", stufe: "bearbeiter", rollen: ["Investments"] },
  { name: "Fondsmanagement und Controlling", beschreibung: "Finanzen und Berichte des ersten Fonds", stufe: "bearbeiter", rollen: ["Finanzen und Berichte"], fonds: [1] },
  { name: "Relationship Management", beschreibung: "Kontaktpflege ohne Finanzdaten", stufe: "bearbeiter", rollen: ["Kontakte"] },
];

/** Investor-Zugang für das LP-Portal (Etappe 12): kein Fondsrecht, nur das eigene Kapitalkonto, Berichte und Mitteilungen. */
export interface DemoInvestorZugang {
  name: string;
  email: string;
  passwort: string;
  totpGeheimnis: string;
  wiederherstellungscodes: string[];
  /** Nummer des Investors (1 = erster erzeugter Investor der Demo-Daten), dessen Konto der Zugang sieht. */
  investorNr: number;
  beschreibung: string;
}

export const DEMO_INVESTOR_ZUGAENGE: DemoInvestorZugang[] = [
  {
    name: "Ilse Beispiel",
    email: "ilse.lp@beispiel.example",
    passwort: "Demo-Lokal-Portal-1",
    totpGeheimnis: "OJXXK3TFNZ2GK4TSMVZGK3DFNZSWIZLT",
    wiederherstellungscodes: ["demo-port-0001", "demo-port-0002"],
    investorNr: 1,
    beschreibung: "Investor-Zugang zum Portal: sieht nur das Konto des ersten Investors der Demo-Daten",
  },
  {
    name: "Ingo Beispiel",
    email: "ingo.lp@beispiel.example",
    passwort: "Demo-Lokal-Portal-2",
    totpGeheimnis: "PFXGK5BAOBSXEYLSNFXHGZLTMVWGK3TF",
    wiederherstellungscodes: ["demo-port-0003", "demo-port-0004"],
    investorNr: 2,
    beschreibung: "Investor-Zugang zum Portal: sieht nur das Konto des zweiten Investors der Demo-Daten",
  },
];

/** Legt die Demo-Zugänge an (vorhandene mit gleicher Adresse werden ersetzt) und weist die Fondsrollen zu. */
export async function schreibeDemoZugaenge(
  db: Db,
  fondsIds: string[],
  geheimnis: string = process.env.BETTER_AUTH_SECRET ?? LOKALES_ENTWICKLUNGSGEHEIMNIS,
  /** IDs der Investor-Organisationen in der Reihenfolge der Demo-Daten; ohne sie entstehen keine Investor-Zugänge. */
  investorIds: string[] = [],
) {
  const zeilen: { zugang: DemoZugang; hash: string; secret: string; codes: string }[] = [];
  for (const z of DEMO_ZUGAENGE) {
    zeilen.push({
      zugang: z,
      hash: await hashPassword(z.passwort),
      secret: await symmetricEncrypt({ key: geheimnis, data: `base32:${z.totpGeheimnis}` }),
      codes: await symmetricEncrypt({ key: geheimnis, data: JSON.stringify(z.wiederherstellungscodes) }),
    });
  }
  const investorZeilen: { zugang: DemoInvestorZugang; hash: string; secret: string; codes: string }[] = [];
  for (const z of investorIds.length ? DEMO_INVESTOR_ZUGAENGE : []) {
    investorZeilen.push({
      zugang: z,
      hash: await hashPassword(z.passwort),
      secret: await symmetricEncrypt({ key: geheimnis, data: `base32:${z.totpGeheimnis}` }),
      codes: await symmetricEncrypt({ key: geheimnis, data: JSON.stringify(z.wiederherstellungscodes) }),
    });
  }
  await db.transaction(async (tx) => {
    await tx.delete(s.benutzer).where(inArray(s.benutzer.email, [...DEMO_ZUGAENGE, ...DEMO_INVESTOR_ZUGAENGE].map((z) => z.email)));
    await tx.delete(s.nutzergruppe).where(inArray(s.nutzergruppe.name, DEMO_GRUPPEN.map((g) => g.name)));
    await tx.delete(s.rechterolle).where(inArray(s.rechterolle.name, DEMO_ROLLEN.map((r) => r.name)));
    const rollen = await tx.insert(s.rechterolle).values(DEMO_ROLLEN).returning();
    const gruppen = new Map<string, string>();
    for (const g of DEMO_GRUPPEN) {
      const [zeile] = await tx.insert(s.nutzergruppe).values({ name: g.name, beschreibung: g.beschreibung, stufe: g.stufe, fondsBeschraenkt: g.fonds !== undefined }).returning();
      gruppen.set(g.name, zeile!.id);
      const rollenIds = rollen.filter((r) => g.rollen.includes(r.name)).map((r) => r.id);
      if (rollenIds.length) await tx.insert(s.nutzergruppeRolle).values(rollenIds.map((rolleId) => ({ gruppeId: zeile!.id, rolleId })));
      const fonds = (g.fonds ?? []).map((n) => fondsIds[n - 1]).filter((f): f is string => f !== undefined);
      if (fonds.length) await tx.insert(s.nutzergruppeFonds).values(fonds.map((fondsId) => ({ gruppeId: zeile!.id, fondsId })));
    }
    for (const { zugang, hash, secret, codes } of zeilen) {
      const [benutzer] = await tx
        .insert(s.benutzer)
        .values({ name: zugang.name, email: zugang.email, emailVerified: true, twoFactorEnabled: true, globalVerwalter: zugang.globalVerwalter })
        .returning();
      if (!benutzer) throw new Error("Benutzer nicht angelegt");
      await tx.insert(s.konto).values({ accountId: benutzer.id, providerId: "credential", userId: benutzer.id, password: hash });
      await tx.insert(s.zweiFaktor).values({ userId: benutzer.id, secret, backupCodes: codes, verified: true });
      const fonds = zugang.fonds === "alle" ? fondsIds : zugang.fonds.map((n) => fondsIds[n - 1]).filter((f): f is string => f !== undefined);
      if (fonds.length) await tx.insert(s.fondsrolle).values(fonds.map((fondsId) => ({ benutzerId: benutzer.id, fondsId, rolle: zugang.rolle })));
      const gruppeId = zugang.gruppe ? gruppen.get(zugang.gruppe) : undefined;
      if (gruppeId) await tx.insert(s.nutzergruppeMitglied).values({ gruppeId, benutzerId: benutzer.id });
    }
    for (const { zugang, hash, secret, codes } of investorZeilen) {
      const organisationId = investorIds[zugang.investorNr - 1];
      if (!organisationId) continue;
      const [benutzer] = await tx.insert(s.benutzer).values({ name: zugang.name, email: zugang.email, emailVerified: true, twoFactorEnabled: true }).returning();
      if (!benutzer) throw new Error("Benutzer nicht angelegt");
      await tx.insert(s.konto).values({ accountId: benutzer.id, providerId: "credential", userId: benutzer.id, password: hash });
      await tx.insert(s.zweiFaktor).values({ userId: benutzer.id, secret, backupCodes: codes, verified: true });
      await tx.insert(s.investorBenutzer).values({ benutzerId: benutzer.id, erstelltVon: "system" });
      await tx.insert(s.investorZugang).values({ benutzerId: benutzer.id, organisationId, erstelltVon: "system" });
    }
  });
}

/** Markdown-Dokument mit allen Zugangsdaten (Inhalt ist deterministisch und liegt im Repository). */
export function zugangsdokument(): string {
  const zeilen = DEMO_ZUGAENGE.map(
    (z) =>
      `| ${z.name} | \`${z.email}\` | \`${z.passwort}\` | \`${z.totpGeheimnis}\` | ${z.beschreibung} |`,
  );
  const investorZeilen = DEMO_INVESTOR_ZUGAENGE.map(
    (z) => `| ${z.name} | \`${z.email}\` | \`${z.passwort}\` | \`${z.totpGeheimnis}\` | ${z.beschreibung} |`,
  ).join("\n");
  return `# Demo-Zugänge (nur lokale Entwicklung)

> **Nur für die lokale Entwicklung.** Alle Namen, Adressen, Passwörter und TOTP-Geheimnisse hier sind erfunden und
> öffentlich. Sie schützen nichts und dürfen nie in einem Echtbestand, auf einem erreichbaren Server oder in einer
> Kundenumgebung benutzt werden. Das Seed-Skript lehnt \`CARRAWAY_UMGEBUNG=echt\` ab.
>
> Diese Datei wird vom Seed-Skript (\`pnpm db:seed\`) geschrieben; ändere sie nicht von Hand.

Anmelden mit Adresse und Passwort, danach den sechsstelligen Code aus einer Authenticator-App. Das Geheimnis wird dort
als Schlüssel eingetragen (Base32, SHA-1, 6 Stellen, 30 Sekunden). Ohne App lässt sich der Code auf der Kommandozeile
ausrechnen, z. B. mit \`oathtool --totp -b <Geheimnis>\`.

| Name | Adresse | Passwort | TOTP-Geheimnis | Rolle |
|---|---|---|---|---|
${zeilen.join("\n")}

Wiederherstellungscodes (je einmal gültig, statt des TOTP-Codes): ${DEMO_ZUGAENGE.map((z) => z.wiederherstellungscodes.map((c) => `\`${c}\``).join(", ")).join("; ")}.

## Vier-Augen-Ablauf ausprobieren

1. Mit Berta (Bearbeiterin) einen Zinslauf berechnen.
2. Mit Frieda (Freigeberin) prüfen.
3. Mit Frieda freigeben: abgelehnt (\`four_eyes_violated\`), dieselbe Person darf nicht beides.
4. Mit Friedrich (Freigeber) freigeben: gelingt.

Die Fondsrollen weist das Seed-Skript nach den Demo-Daten zu: Vera ist Verwalterin aller Fonds, Frieda und Friedrich sind
Freigeber, Berta ist Bearbeiterin, Bernd sieht nur den ersten Fonds.

## Rollen und Gruppen ausprobieren

Das Seed-Skript legt Beispielrollen und Nutzergruppen an (Verwaltung → Rollen und Gruppen, siehe \`docs/rechte-modell.md\`):
${DEMO_GRUPPEN.map((g) => `- **${g.name}** (${g.beschreibung}): Stufe ${g.stufe}, Rollen ${g.rollen.join(", ")}${g.fonds ? `, nur Fonds ${g.fonds.join(", ")}` : ", Fonds nach zentraler Einstellung"}`).join("\n")}

Rita gehört zu Relationship Management und sieht nur Kontakte. Carl gehört zu Fondsmanagement und Controlling (erster Fonds) und hat als
Ausnahme eine eigene Rolle Betrachter am zweiten Fonds. Alle übrigen Zugänge gehören zu keiner Gruppe und behalten alle Bereiche.

## Zugänge zum LP-Portal

Die beiden Investor-Zugänge haben keine Fondsrolle und sehen nur das Portal unter \`/portal\`: das eigene Kapitalkonto, freigegebene
Berichte und die Mitteilungen zu Kapitalabrufen und Ausschüttungen. Alle internen Seiten und Routen sind für sie gesperrt. Anmelden wie oben
(Passwort, danach der Code aus dem TOTP-Geheimnis); nach der Anmeldung führt die Oberfläche in das Portal.

| Name | Adresse | Passwort | TOTP-Geheimnis | Sicht |
|---|---|---|---|---|
${investorZeilen}

Wiederherstellungscodes: ${DEMO_INVESTOR_ZUGAENGE.map((z) => z.wiederherstellungscodes.map((c) => `\`${c}\``).join(", ")).join("; ")}.

Die Mitteilungen erscheinen im Portal, sobald eine Freigeberin oder ein Freigeber sie zu einer Fondsbewegung freigibt
(\`POST /api/v1/funds/:id/movements/:movementId/notices/approve\`, mit einer anderen Person als der, die die Bewegung erfasst hat).
`;
}

/** Entfernt die Demo-Zugänge wieder (z. B. in Tests). */
export async function entferneDemoZugaenge(db: Db) {
  await db.transaction(async (tx) => {
    const ids = (await tx.select({ id: s.benutzer.id }).from(s.benutzer).where(inArray(s.benutzer.email, [...DEMO_ZUGAENGE, ...DEMO_INVESTOR_ZUGAENGE].map((z) => z.email)))).map((b) => b.id);
    if (ids.length > 0) {
      // Was im CRM an diesen Personen hängt: ihre gemeinsamen Ansichten entfallen, Zuständigkeiten und die Betreuung der Unternehmen werden leer.
      await tx.delete(s.ansicht).where(inArray(s.ansicht.besitzerId, ids));
      await tx.update(s.aufgabe).set({ zustaendig: null }).where(inArray(s.aufgabe.zustaendig, ids));
      await tx.execute(sql`UPDATE organisation SET felder = felder - ${DEMO_FELD.betreuung}::text WHERE felder ? ${DEMO_FELD.betreuung}`);
    }
    await tx.delete(s.benutzer).where(inArray(s.benutzer.email, [...DEMO_ZUGAENGE, ...DEMO_INVESTOR_ZUGAENGE].map((z) => z.email)));
    await tx.delete(s.nutzergruppe).where(inArray(s.nutzergruppe.name, DEMO_GRUPPEN.map((g) => g.name)));
    await tx.delete(s.rechterolle).where(inArray(s.rechterolle.name, DEMO_ROLLEN.map((r) => r.name)));
  });
}
