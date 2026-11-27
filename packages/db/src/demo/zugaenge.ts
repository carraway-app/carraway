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
    beschreibung: "Admin on all funds: users, roles, period lock and API keys",
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
    beschreibung: "Approver: can review and approve (first person in the four-eyes workflow)",
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
    beschreibung: "Approver: second person in the four-eyes workflow",
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
    beschreibung: "Editor: records data without approval rights",
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
    beschreibung: "Viewer on the first fund only",
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
    beschreibung: "Relationship Management group: maintains contacts and has no access to finance, deals or accounting",
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
    beschreibung: "Fondsmanagement und Controlling group (editor on the first fund only), with a viewer override on the second fund",
  },
];

/** Beispielrollen des Rechtemodells (Bündel von Bereichen, Schlüssel wie `BEREICHE` der API). */
export const DEMO_ROLLEN: { name: string; beschreibung: string; bereiche: string[] }[] = [
  { name: "Investments", beschreibung: "Portfolio, Einzelzuteilungen, Dealflow, Kontakte, Kennzahlen und Dokumente", bereiche: ["portfolio", "einzelzuteilungen", "dealflow", "kontakte", "kennzahlen", "dokumente"] },
  { name: "Finanzen und Berichte", beschreibung: "Portfolio, Finanzen, Berichte, Meldewesen und Kennzahlen", bereiche: ["portfolio", "finanzen", "berichte", "meldewesen", "kennzahlen"] },
  { name: "Kontakte", beschreibung: "Nur Kontakte: keine Finanzdaten", bereiche: ["kontakte"] },
];

/** Beispielgruppen: Stufe an den Fonds der Gruppe, Rollen und Fondszugriff (`fonds`: Nummern; ohne Angabe gilt die zentrale Einstellung). */
export const DEMO_GRUPPEN: { name: string; beschreibung: string; beschreibungEn: string; stufe: (typeof s.fondsRolle.enumValues)[number]; rollen: string[]; fonds?: number[] }[] = [
  { name: "Investmentmanagement", beschreibung: "Beteiligungen und Dealflow aller Fonds", beschreibungEn: "Investments and dealflow across all funds", stufe: "bearbeiter", rollen: ["Investments"] },
  { name: "Fondsmanagement und Controlling", beschreibung: "Finanzen und Berichte des ersten Fonds", beschreibungEn: "Finance and reports for the first fund", stufe: "bearbeiter", rollen: ["Finanzen und Berichte"], fonds: [1] },
  { name: "Relationship Management", beschreibung: "Kontaktpflege ohne Finanzdaten", beschreibungEn: "Manage contacts without access to financial data", stufe: "bearbeiter", rollen: ["Kontakte"] },
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
    beschreibung: "Investor portal account: sees only the first demo investor’s account",
  },
  {
    name: "Ingo Beispiel",
    email: "ingo.lp@beispiel.example",
    passwort: "Demo-Lokal-Portal-2",
    totpGeheimnis: "PFXGK5BAOBSXEYLSNFXHGZLTMVWGK3TF",
    wiederherstellungscodes: ["demo-port-0003", "demo-port-0004"],
    investorNr: 2,
    beschreibung: "Investor portal account: sees only the second demo investor’s account",
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
  const stufen = { betrachter: "viewer", bearbeiter: "editor", freigeber: "approver", verwalter: "admin" };
  const zeilen = DEMO_ZUGAENGE.map(
    (z) =>
      `| ${z.name} | \`${z.email}\` | \`${z.passwort}\` | \`${z.totpGeheimnis}\` | ${z.beschreibung} |`,
  );
  const investorZeilen = DEMO_INVESTOR_ZUGAENGE.map(
    (z) => `| ${z.name} | \`${z.email}\` | \`${z.passwort}\` | \`${z.totpGeheimnis}\` | ${z.beschreibung} |`,
  ).join("\n");
  return `# Demo accounts (local development only)

> **For local development only.** The names, addresses, passwords and TOTP secrets below are fictional and public.
> They provide no protection and must never be used in production, on a reachable server or in a customer environment.
> The seed script rejects \`CARRAWAY_UMGEBUNG=echt\`.
>
> The seed script (\`pnpm db:seed\`) generates this file. Make changes in the generator.

Sign in with the email address and password, then enter the six-digit code from an authenticator app. Enter the secret
as its key (Base32, SHA-1, 6 digits, 30 seconds). To calculate a code without an app, run, for example,
\`oathtool --totp -b <secret>\`, substituting the TOTP secret.

| Name | Email | Password | TOTP secret | Role |
|---|---|---|---|---|
${zeilen.join("\n")}

Recovery codes (each works once in place of a TOTP code): ${DEMO_ZUGAENGE.map((z) => z.wiederherstellungscodes.map((c) => `\`${c}\``).join(", ")).join("; ")}.

## Try four-eyes approval

1. As Berta (editor), calculate an interest run.
2. As Frieda (approver), review it.
3. Try to approve as Frieda. The request is rejected (\`four_eyes_violated\`) because one person cannot both review and approve.
4. Approve as Friedrich (approver). The request succeeds.

The seed script assigns roles based on the demo data. Vera is an admin on all funds, Frieda and Friedrich are
approvers, Berta is an editor and Bernd can see only the first fund.

## Try roles and groups

The seed script creates example roles and user groups (Administration → Roles and groups, see \`docs/permissions-model.md\`).
${DEMO_GRUPPEN.map((g) => `- **${g.name}** (${g.beschreibungEn}): Level ${stufen[g.stufe]}, roles ${g.rollen.join(", ")}${g.fonds ? `, fund ${g.fonds.join(", ")} only` : ", funds follow the central setting"}`).join("\n")}

Rita belongs to Relationship Management and sees only contacts. Carl belongs to Fondsmanagement und Controlling (first fund)
and has a direct viewer override on the second fund. The other accounts belong to no group and keep all areas.

## LP portal accounts

The two investor accounts have no fund role and only see the managed hosting portal at \`/portal\`. They see their own capital
account, approved reports and capital call and distribution notices. All internal pages and routes are blocked. Sign in as above
with the password and then the TOTP code. The interface takes the investor to the portal after sign-in.

| Name | Email | Password | TOTP secret | Access |
|---|---|---|---|---|
${investorZeilen}

Recovery codes: ${DEMO_INVESTOR_ZUGAENGE.map((z) => z.wiederherstellungscodes.map((c) => `\`${c}\``).join(", ")).join("; ")}.

Notices appear in the portal once an approver approves them for a fund movement
(\`POST /api/v1/funds/:id/movements/:movementId/notices/approve\`). The approver must be someone other than the person who recorded the movement.
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
