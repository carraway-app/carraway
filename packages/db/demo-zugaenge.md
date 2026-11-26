# Demo-Zugänge (nur lokale Entwicklung)

> **Nur für die lokale Entwicklung.** Alle Namen, Adressen, Passwörter und TOTP-Geheimnisse hier sind erfunden und
> öffentlich. Sie schützen nichts und dürfen nie in einem Echtbestand, auf einem erreichbaren Server oder in einer
> Kundenumgebung benutzt werden. Das Seed-Skript lehnt `CARRAWAY_UMGEBUNG=echt` ab.
>
> Diese Datei wird vom Seed-Skript (`pnpm db:seed`) geschrieben; ändere sie nicht von Hand.

Anmelden mit Adresse und Passwort, danach den sechsstelligen Code aus einer Authenticator-App. Das Geheimnis wird dort
als Schlüssel eingetragen (Base32, SHA-1, 6 Stellen, 30 Sekunden). Ohne App lässt sich der Code auf der Kommandozeile
ausrechnen, z. B. mit `oathtool --totp -b <Geheimnis>`.

| Name | Adresse | Passwort | TOTP-Geheimnis | Rolle |
|---|---|---|---|---|
| Vera Beispiel | `vera@beispiel.example` | `Demo-Lokal-Verwaltung-1` | `KRSXG5CTMVRXEZLUKN2XAZLSNFXGO4TF` | Verwalterin aller Fonds: Benutzer, Rollen, Periodensperre, API-Schlüssel |
| Frieda Beispiel | `frieda@beispiel.example` | `Demo-Lokal-Freigabe-1` | `MZRWC3TFOJQXIZLTONSWY2LUMVZGKZLB` | Freigeberin: prüft und gibt frei (erste Person im Vier-Augen-Ablauf) |
| Friedrich Beispiel | `friedrich@beispiel.example` | `Demo-Lokal-Freigabe-2` | `MZRWI2LEMJSWK5DSOVZWK4TTNFXGM3DB` | Freigeber: zweite Person im Vier-Augen-Ablauf |
| Berta Beispiel | `berta@beispiel.example` | `Demo-Lokal-Bearbeitung-1` | `MJSXEYLSMNXGG33NNRSWC5DFMZRXGZLT` | Bearbeiterin: erfasst Daten, kann nichts freigeben |
| Bernd Beispiel | `bernd@beispiel.example` | `Demo-Lokal-Ansicht-1` | `MJSXEZLOMFZGK43FNZSWO3DPNRSXE2LO` | Betrachter nur des ersten Fonds: sieht die anderen Fonds nicht |
| Rita Beispiel | `rita@beispiel.example` | `Demo-Lokal-Kontakte-1` | `OJUXIYJAMJSWS43QNFSWYIDLN5XHIYLL` | Gruppe Relationship Management: pflegt Kontakte, sieht keine Finanzdaten, keine Deals und keine Buchhaltung |
| Carl Beispiel | `carl@beispiel.example` | `Demo-Lokal-Controlling-1` | `MNQXE3BAMJSWS43QNFSWYIDDN5XHI4TP` | Gruppe Fondsmanagement und Controlling (nur erster Fonds, Bearbeiter), dazu als Ausnahme Betrachter des zweiten Fonds |

Wiederherstellungscodes (je einmal gültig, statt des TOTP-Codes): `demo-verw-0001`, `demo-verw-0002`; `demo-frei-0001`, `demo-frei-0002`; `demo-frei-0003`, `demo-frei-0004`; `demo-bear-0001`, `demo-bear-0002`; `demo-ansi-0001`, `demo-ansi-0002`; `demo-kont-0001`, `demo-kont-0002`; `demo-cont-0001`, `demo-cont-0002`.

## Vier-Augen-Ablauf ausprobieren

1. Mit Berta (Bearbeiterin) einen Zinslauf berechnen.
2. Mit Frieda (Freigeberin) prüfen.
3. Mit Frieda freigeben: abgelehnt (`VIER_AUGEN_VERLETZT`), dieselbe Person darf nicht beides.
4. Mit Friedrich (Freigeber) freigeben: gelingt.

Die Fondsrollen weist das Seed-Skript nach den Demo-Daten zu: Vera ist Verwalterin aller Fonds, Frieda und Friedrich sind
Freigeber, Berta ist Bearbeiterin, Bernd sieht nur den ersten Fonds.

## Rollen und Gruppen ausprobieren

Das Seed-Skript legt Beispielrollen und Nutzergruppen an (Verwaltung → Rollen und Gruppen, siehe `docs/rechte-modell.md`):
- **Investmentmanagement** (Beteiligungen und Dealflow aller Fonds): Stufe bearbeiter, Rollen Investments, Fonds nach zentraler Einstellung
- **Fondsmanagement und Controlling** (Finanzen und Berichte des ersten Fonds): Stufe bearbeiter, Rollen Finanzen und Berichte, nur Fonds 1
- **Relationship Management** (Kontaktpflege ohne Finanzdaten): Stufe bearbeiter, Rollen Kontakte, Fonds nach zentraler Einstellung

Rita gehört zu Relationship Management und sieht nur Kontakte. Carl gehört zu Fondsmanagement und Controlling (erster Fonds) und hat als
Ausnahme eine eigene Rolle Betrachter am zweiten Fonds. Alle übrigen Zugänge gehören zu keiner Gruppe und behalten alle Bereiche.

## Zugänge zum LP-Portal

Die beiden Investor-Zugänge haben keine Fondsrolle und sehen nur das Portal unter `/portal`: das eigene Kapitalkonto, freigegebene
Berichte und die Mitteilungen zu Kapitalabrufen und Ausschüttungen. Alle internen Seiten und Routen sind für sie gesperrt. Anmelden wie oben
(Passwort, danach der Code aus dem TOTP-Geheimnis); nach der Anmeldung führt die Oberfläche in das Portal.

| Name | Adresse | Passwort | TOTP-Geheimnis | Sicht |
|---|---|---|---|---|
| Ilse Beispiel | `ilse.lp@beispiel.example` | `Demo-Lokal-Portal-1` | `OJXXK3TFNZ2GK4TSMVZGK3DFNZSWIZLT` | Investor-Zugang zum Portal: sieht nur das Konto des ersten Investors der Demo-Daten |
| Ingo Beispiel | `ingo.lp@beispiel.example` | `Demo-Lokal-Portal-2` | `PFXGK5BAOBSXEYLSNFXHGZLTMVWGK3TF` | Investor-Zugang zum Portal: sieht nur das Konto des zweiten Investors der Demo-Daten |

Wiederherstellungscodes: `demo-port-0001`, `demo-port-0002`; `demo-port-0003`, `demo-port-0004`.

Die Mitteilungen erscheinen im Portal, sobald eine Freigeberin oder ein Freigeber sie zu einer Fondsbewegung freigibt
(`POST /api/v1/fonds/:id/bewegungen/:bewegungId/mitteilungen/freigeben`, mit einer anderen Person als der, die die Bewegung erfasst hat).
