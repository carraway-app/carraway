# Carraway

Die Anwendung übernimmt Zeichen, Schrift und die Palette aus `DESIGN.md` der Carraway-Website und der internen Markennotiz vom 25.11.2026. Das gemeinsame Raster und die Komponenten bestimmen die Dichte der Fachanwendung.

## Grundsätze

- **Zwei Themen, eine Sprache.** Dunkel ist Standard, Hell gleichwertig; beide lesen dieselben semantischen Tokens. Jede Schrift erreicht in beiden Themen mindestens 4,5 : 1, auch Beschriftungen mit 12 px.
- **Ein Akzent für Orientierung.** Petrol (`--cw-accent`) kennzeichnet aktive Navigation und Tastaturfokus. Der aktive Hauptreiter hat zusätzlich eine zarte Petrol-Hinterlegung. Beschriftungen und primäre Buttons nutzen neutrale Farben.
- **Dicht, aber ruhig.** Der Inhalt zählt, nicht der Rand: Lesetext und Tabellenwerte 14 px, kompakte Beschriftungen 12 bis 13 px, Tabellenzeilen 36 px hoch. Viel Inhalt je Bildschirm, wenig Rollen.
- **Nie alles untereinander.** Auf einer Seite ist immer nur ein Inhaltsblock sichtbar; alles weitere steht hinter Reitern (siehe „Reiter und Seitenmuster“).
- **Herkunft sichtbar.** Jede berechnete Zahl hat einen Herkunftshinweis (Komponente Herkunft). Zahlen stehen in Mono, rechtsbündig, mit festen Ziffernbreiten.
- **Raster.** Seitenabstände und Lücken zwischen Kacheln im 8er-Raster (`s-1` bis `s-8`). Innerhalb von Bedienelementen und dichten Listen sind 4 und 12 px erlaubt (`s-0`, `s-1h`); alle Maße sind Vielfache von 4.

## Sprache

- Deutsch, sachlich, neutral. Kurze Sätze, Fachbegriffe aus dem Fondsalltag (Stichtag, Kapitalabruf, Ausschüttung, NAV, TVPI, DPI).
- Buttons sagen, was passiert: „Bericht erstellen“, „Bewertung erfassen“, nicht „OK“ oder „Weiter“.
- Keine Namen echter Fonds, Unternehmen oder Personen in Beispielen. Beispiele heißen „Beispielfonds I“, „Unternehmen A“. Erfundene Werte tragen den Status „Beispieldaten“.
- Zahlen im deutschen Format: `12.400.000 €`, `1,42x`, `8,4 %`, Datumsangaben `30.09.2026`.
- Keine Em-Dashes und keine Emoji in der Oberfläche.

## Farben

Die Palette folgt der 60-30-10-Regel der Website. Papier, Weiß und Tinte bilden die Basis. Salbei gliedert helle Ansichten, Wald die dunklen. Petrol und Jade kennzeichnen Bedienbares. Gold hebt einzelne Ergebnisse hervor. Die dunklen Flächen und das Gold für kleinen Text sind für die Kontrastpaare der App abgestuft.

### Aufbau der Tokens

- **Primitive** (`--p-…`, in `tokens.json` unter `color.primitives`): die Palette mit festen Werten. Sie werden nur von semantischen Tokens gelesen.
- **Semantische Tokens** (`--cw-…`, unter `color.semantic`): die Rolle einer Farbe (`--cw-bg`, `--cw-surface`, `--cw-text`, `--cw-accent`, `--cw-focus`, `--cw-line`, Status, Kategorien, Diagramme) mit je einem Wert für `dunkel` und `hell`. Ein Wert ist der Name eines Primitivs oder ein fester Wert (rgba für Hinterlegungen).
- **Komponenten und Seiten lesen nur semantische Tokens.** Kein fester Farbwert, kein Primitiv, kein alter Farbname in einer Stilvorlage; `pnpm design:kontrast` prüft das zusammen mit dem Kontrast.

### So werden Themen angewendet

`pnpm --filter @carraway/ui tokens` erzeugt `packages/ui/src/styles/tokens.css` aus `tokens.json`:

```css
:root { --p-…: …; /* Primitive, Schrift, Maße */ }
:root, :root[data-theme="dunkel"] { color-scheme: dark;  --cw-bg: var(--p-tinte-900); … }
:root[data-theme="hell"]          { color-scheme: light; --cw-bg: var(--p-papier-100); … }
@media (prefers-color-scheme: light) { :root[data-theme="system"] { color-scheme: light; … } }
```

- Ohne `data-theme` am Element `<html>` gilt Dunkel.
- `data-theme="hell"` oder `"dunkel"` erzwingt ein Thema, `data-theme="system"` folgt der Einstellung des Betriebssystems (`prefers-color-scheme`).
- `color-scheme` stellt Rollbalken, native Auswahllisten, Datumsfelder und Kontrollkästchen passend ein.
- Die Person wählt das Thema im Kontomenü (Block „Thema“ mit „System | Hell | Dunkel“) und in den Einstellungen (Reiter „Darstellung“); im LP-Portal im Menü am Namen. Die Wahl gilt sofort ohne Neuladen und wird je Person gespeichert (`GET` und `PATCH /thema`, Standard `system`). Der Browser merkt sie zusätzlich unter `carraway.thema`; ein kleines Skript in `apps/web/index.html` setzt `data-theme` und `<meta name="theme-color">` (aus `--cw-bg`) vor dem ersten Anstrich, noch ohne Sitzung. Die öffentliche Abfrageseite hat keine Wahl und folgt dem Merkzettel des Browsers, sonst dem System.
- Ein Wechsel blendet die Farben 200 ms über; bei `prefers-reduced-motion: reduce` gibt es keinen Übergang.

### Petrol als Akzent

Petrol kennzeichnet die aktuelle Ansicht und den Tastaturfokus. Hervorgehobene Kennzahlen werden nur über Gewicht und Farbe des Werts betont, ohne Kontur.

| Einsatz | Umsetzung |
|---|---|
| Fokus | 2 px Ring in `--cw-focus` mit 2 px Abstand, auf allen Flächen mindestens 3 : 1 |
| Aktiver Hauptreiter | umlaufende Kontur von 1 px in `--cw-accent`, Hinterlegung `--cw-accent-tint`, kräftigere Beschriftung |
| Aktive Navigation | umlaufende Kontur von 1 px in `--cw-accent` |
| Gewählte Tabellenzeile | Fläche `--cw-accent-tint`, ohne Randstreifen |
| Etikett, Zeichen | goldener Strich vor der Rubrik, Punkt in Petrol oder Jade im Zeichen |
| Hervorgehobene Kennzahl | Wert in `--cw-highlight`, Titel in der Textfarbe |
| Aktueller Schritt | umgekehrte Kachel mit Ring im Akzent |
| Links | Text in `--cw-text`, unterstrichen; beim Hover wird die Unterstreichung Petrol |
| Diagramme | höchstens eine Reihe oder Säule je Diagramm (`--cw-chart-2`), zum Beispiel die jüngste Bewertung |

Beschriftungen verwenden die Textfarbe des jeweiligen Themas.

Primäre Buttons verwenden `--cw-primary` als Fläche und `--cw-on-primary` für die Beschriftung.

Auf Hell ist der Bedienakzent Petrol (`#096D69`), auf Dunkel Jade (`#7CCFC2`). Hervorgehobene Werte erscheinen auf Dunkel in Gold (`#C4A25A`). Für kleinen Text auf Salbei ist das Textgold der Website (`#8A6D2F`) auf `#806429` abgedunkelt. Feldränder verwenden den kontrastgeprüften Token `--cw-line-control`.

### Tokens in beiden Themen

| Token | Dunkel | Hell | Rolle |
|---|---|---|---|
| **Fläche** | | | |
| `--cw-bg` | `#0E2621` (tinte-900) | `#FAF9F6` (papier-100) | Grund der Anwendung, Kopfzeile, Zeilen des Datengitters. |
| `--cw-surface` | `#102922` (wald-850) | `#FFFFFF` (papier-0) | Fläche 1: Kacheln, Seitenleiste, Tabellenkopf, Dialoge. |
| `--cw-surface-2` | `#112E28` (wald-840) | `#EDF3EC` (papier-200) | Fläche 2: verschachtelte Kacheln, Spuren von Segmenten und Unterreitern, Platzhalter beim Laden, Zähler. |
| `--cw-raised` | `#112E28` (wald-840) | `#FFFFFF` (papier-0) | Schwebende Flächen: Menüs, Popover, Vorschaukarten. |
| `--cw-field` | `#112E28` (wald-840) | `#FFFFFF` (papier-0) | Grund von Eingabefeldern und Auswahllisten. |
| `--cw-hover` | `#112E28` (wald-840) | `#EDF3EC` (papier-200) | Hover auf Grund und Fläche: Tabellenzeilen, Navigation, ruhige Buttons. |
| `--cw-hover-raised` | `#15352E` (wald-825) | `#EDF3EC` (papier-200) | Hover und Tastaturfokus in Menüs und Trefferlisten. |
| `--cw-selected` | `#15352E` (wald-825) | `#E1EBE3` (papier-300) | Gewählte Zeilen und Einträge, aktives Unterreiter-Segment. Neutral; die Linie im Akzent zeigt die Auswahl. |
| `--cw-well` | `#102922` (wald-850) | `#EDF3EC` (papier-200) | Spur unter Karten: Spalten des Boards. Karten darauf liegen auf `raised`. |
| `--cw-tile` | `#EEF3EE` (hellgruen) | `#E1EBE3` (papier-300) | Initialkachel und Avatar. |
| `--cw-on-tile` | `#0E2621` (tinte-900) | `#18211D` (tinte-850) | Buchstabe auf der Initialkachel und im Avatar. |
| `--cw-thumb` | `#3A594F` (wald-700) | `#FFFFFF` (papier-0) | Gewähltes Segment und gewählter Unterreiter auf der Spur `surface-2`. |
| **Linie** | | | |
| `--cw-line` | `#3D5C53` (tinte-650) | `#D3D9D3` (papier-400) | Haarlinie: Tabellenzeilen, Trenner, Rahmen von Kacheln. |
| `--cw-line-strong` | `#536A60` (tinte-625) | `#8A9A91` (papier-500) | Kräftige Linie: Tabellenkopf, Rahmen von Menüs und Dialogen, Status-Pillen, Zeitstrahl. |
| `--cw-line-control` | `#717D77` (tinte-600) | `#73877D` (stein-400) | Rand von Feldern und Sekundär-Buttons; 3 : 1 auf Grund und Fläche. |
| **Text** | | | |
| `--cw-text` | `#EEF3EE` (hellgruen) | `#18211D` (tinte-850) | Text und Titel. |
| `--cw-text-muted` | `#B9CFC4` (salbei-dunkel) | `#505E56` (stein-700) | Nebentext, Beschriftungen, Tabellenköpfe, inaktive Navigation. |
| `--cw-text-subtle` | `#97AAA0` (tinte-400) | `#5E6C63` (stein-600) | Platzhalter, Hilfetext, leere Zellen. Erreicht noch 4,5 : 1. |
| `--cw-text-disabled` | `#66706A` (tinte-500) | `#929D96` (stein-300) | Schrift deaktivierter Bedienelemente (von der Kontrastregel ausgenommen). |
| **Akzent** | | | |
| `--cw-accent` | `#7CCFC2` (jade) | `#096D69` (petrol-700) | Petrol und Jade für Bedienbares, Auswahl und den Markenpunkt. |
| `--cw-accent-tint` | `rgba(124, 207, 194, 0.13)` | `rgba(9, 109, 105, 0.13)` | Zarte Hinterlegung für den aktiven Hauptreiter; darüber steht die normale Textfarbe. |
| `--cw-highlight` | `#C4A25A` (gold) | `#806429` (gold-text) | Sparsame Hervorhebung von Kennzahlen und Ergebnislinien. |
| `--cw-focus` | `#7CCFC2` (jade) | `#096D69` (petrol-700) | Fokusring, 2 px. |
| **Handlung** | | | |
| `--cw-primary` | `#EEF3EE` (hellgruen) | `#18211D` (tinte-850) | Primärer Button: umgekehrte Fläche, Text auf Grund und Fläche dreht sich um. |
| `--cw-primary-hover` | `#FFFFFF` (papier-0) | `#163B33` (wald-800) | Hover des primären Buttons. |
| `--cw-on-primary` | `#0E2621` (tinte-900) | `#FFFFFF` (papier-0) | Schrift auf dem primären Button. |
| `--cw-inverse` | `#EEF3EE` (hellgruen) | `#18211D` (tinte-850) | Umgekehrte Kacheln: Zeichen, aktueller Schritt, gedrückte Umschalter. |
| `--cw-on-inverse` | `#0E2621` (tinte-900) | `#EEF3EE` (hellgruen) | Schrift auf umgekehrten Kacheln. |
| **Status** | | | |
| `--cw-success` | `#78D87A` (gruen-300) | `#27742A` (gruen-700) | Erfolg, freigegeben, Zuwachs mit ▲. Text und Zeichen. |
| `--cw-success-tint` | `rgba(120, 216, 122, 0.14)` | `rgba(39, 116, 42, 0.10)` | Hinterlegung für Erfolg; Schrift darauf `text`. |
| `--cw-warning` | `#E8C547` (gelb-300) | `#7A5F00` (gelb-700) | Warnung, fällig, unvollständig. Gelb, nie Orange. |
| `--cw-warning-tint` | `rgba(232, 197, 71, 0.14)` | `rgba(122, 95, 0, 0.12)` | Hinterlegung für Warnungen; Schrift darauf `text`. |
| `--cw-danger` | `#FF6B70` (rot-300) | `#A5280E` (rot-700) | Fehler, Rückgang mit ▼, fehlende Daten, gefährliche Handlung. |
| `--cw-danger-tint` | `rgba(255, 107, 112, 0.14)` | `rgba(165, 40, 14, 0.10)` | Hinterlegung für Fehler; Schrift darauf `text`. |
| `--cw-info` | `#7EA8FF` (blau-300) | `#2556B8` (blau-700) | Information, Hinweis. |
| `--cw-info-tint` | `rgba(126, 168, 255, 0.14)` | `rgba(37, 86, 184, 0.10)` | Hinterlegung für Informationen; Schrift darauf `text`. |
| `--cw-neutral` | `#BCCAC2` (tinte-300) | `#505E56` (stein-700) | Neutraler Status: Entwurf, offen. |
| `--cw-neutral-tint` | `rgba(188, 202, 194, 0.12)` | `rgba(80, 94, 86, 0.08)` | Hinterlegung für neutrale Hinweise. |
| **Kategorie** | | | |
| `--cw-kat-grau` | `#BCCAC2` (tinte-300) | `#5E6C63` (stein-600) | Optionsfarbe Grau. |
| `--cw-kat-gruen` | `#78D87A` (gruen-300) | `#27742A` (gruen-700) | Optionsfarbe Grün (gespeicherter Schlüssel `signal`). |
| `--cw-kat-blau` | `#7EA8FF` (blau-300) | `#2556B8` (blau-700) | Optionsfarbe Blau. |
| `--cw-kat-violett` | `#B49BFF` (violett-300) | `#6B47C9` (violett-700) | Optionsfarbe Violett. |
| `--cw-kat-tuerkis` | `#4FC9B8` (tuerkis-300) | `#0F7C70` (tuerkis-700) | Optionsfarbe Türkis. |
| `--cw-kat-rose` | `#FF6B70` (rot-300) | `#B42328` (rose-700) | Optionsfarbe Rose. |
| `--cw-kat-sand` | `#CDBB8C` (sand-300) | `#7E6E45` (sand-700) | Optionsfarbe Sand. |
| **Diagramm** | | | |
| `--cw-chart-1` | `#F2F5EC` (papier-150) | `#18211D` (tinte-850) | Hauptreihe: Ist, Abschluss, Säulen und Balken. |
| `--cw-chart-2` | `#65CEC0` (petrol-300) | `#096D69` (petrol-700) | Die eine hervorgehobene Reihe oder Säule (aktueller Stand, Szenario). Höchstens einmal je Diagramm. |
| `--cw-chart-3` | `#BCCAC2` (tinte-300) | `#505E56` (stein-700) | Vergleich und Plan, gestrichelt. |
| `--cw-chart-4` | `#7EA8FF` (blau-300) | `#2556B8` (blau-700) | Weitere Reihe. |
| `--cw-chart-5` | `#CDBB8C` (sand-300) | `#7E6E45` (sand-700) | Weitere Reihe. |
| `--cw-chart-6` | `#B49BFF` (violett-300) | `#6B47C9` (violett-700) | Weitere Reihe. |
| `--cw-chart-neutral` | `#717D77` (tinte-600) | `#73877D` (stein-400) | Neutrale Säulen hinter der hervorgehobenen. |
| **Fest** | | | |
| `--cw-scrim` | `rgba(5, 7, 6, 0.72)` | `rgba(24, 33, 29, 0.36)` | Abdunklung hinter Dialogen und dem mobilen Menü. |
| `--cw-document` | `#FFFFFF` (papier-0) | `#FFFFFF` (papier-0) | Papier der Dokument- und PDF-Ansicht, in beiden Themen weiß. |
| `--cw-qr-grund` | `#FFFFFF` (papier-0) | `#FFFFFF` (papier-0) | Grund des QR-Codes, in beiden Themen gleich (lesbar für Kameras). |
| `--cw-qr-modul` | `#050706` (tinte-950) | `#050706` (tinte-950) | Module des QR-Codes. |

### Palette (Primitive)

| Primitiv | Wert | Einsatz |
|---|---|---|
| `tinte-950` | `#050706` | Fast Schwarz. Module des QR-Codes. |
| `tinte-900` | `#0E2621` | Grund des dunklen Themas; Schrift auf hellen Kacheln im dunklen Thema. |
| `tinte-850` | `#18211D` | Text, primäre Buttons und Kacheln im hellen Thema. |
| `wald-840` | `#112E28` | Zweite Fläche, Felder und Menüs im dunklen Thema. |
| `wald-825` | `#15352E` | Auswahl und Hover in Menüs im dunklen Thema. |
| `wald-700` | `#3A594F` | Gewähltes Segment im dunklen Thema. |
| `tinte-650` | `#3D5C53` | Haarlinie im dunklen Thema. |
| `tinte-625` | `#536A60` | Kräftige Linie im dunklen Thema. |
| `tinte-600` | `#717D77` | Rand von Bedienelementen im dunklen Thema (3 : 1 auf Grund, Fläche, Fläche 2 und auf Menüs, Popovern und Feldern). |
| `tinte-500` | `#66706A` | Deaktivierte Schrift im dunklen Thema. |
| `tinte-400` | `#97AAA0` | Leiser Text im dunklen Thema. |
| `tinte-300` | `#BCCAC2` | Nebentext im dunklen Thema. |
| `papier-0` | `#FFFFFF` | Weiße Oberflächen, Felder, Menüs und Dialoge im hellen Thema sowie Dokumentpapier. |
| `papier-100` | `#FAF9F6` | Grund des hellen Themas. |
| `papier-150` | `#F2F5EC` | Hauptreihe der Diagramme im dunklen Thema. |
| `papier-200` | `#EDF3EC` | Zweite Fläche und Hover im hellen Thema. |
| `papier-300` | `#E1EBE3` | Auswahl im hellen Thema. |
| `papier-400` | `#D3D9D3` | Haarlinie im hellen Thema. |
| `papier-500` | `#8A9A91` | Kräftige Linie im hellen Thema. |
| `stein-300` | `#929D96` | Deaktivierte Schrift im hellen Thema. |
| `stein-400` | `#73877D` | Rand von Bedienelementen im hellen Thema (3 : 1 auf Grund und Fläche). |
| `stein-600` | `#5E6C63` | Leiser Text im hellen Thema. |
| `stein-700` | `#505E56` | Nebentext im hellen Thema. |
| `petrol-300` | `#65CEC0` | Hervorgehobene Diagrammreihe im dunklen Thema. |
| `petrol-700` | `#096D69` | Petrol auf hellem Grund, Akzent der Marke Carraway. |
| `wald-800` | `#163B33` | Dunkle Fläche beim Überfahren des primären Buttons. |
| `wald-850` | `#102922` | Karten und Tabellenköpfe im dunklen Thema. |
| `jade` | `#7CCFC2` | Bedienbares und Markenpunkt auf Dunkel. |
| `hellgruen` | `#EEF3EE` | Text auf Dunkel. |
| `salbei-dunkel` | `#B9CFC4` | Nebentext auf Dunkel. |
| `gold` | `#C4A25A` | Hervorhebung auf Dunkel. |
| `gold-text` | `#806429` | Hervorhebung auf Hell. |
| `gruen-300` | `#78D87A` | Erfolg und Kategorie Grün im dunklen Thema. |
| `gruen-700` | `#27742A` | Erfolg und Kategorie Grün im hellen Thema. |
| `gelb-300` | `#E8C547` | Warnung im dunklen Thema (Gelb, kein Orange). |
| `gelb-700` | `#7A5F00` | Warnung im hellen Thema (dunkles Gelb, kein Orange). |
| `rot-300` | `#FF6B70` | Fehler und Kategorie Rose im dunklen Thema. |
| `rot-700` | `#A5280E` | Fehler im hellen Thema (Ziegelrot). |
| `rose-700` | `#B42328` | Kategorie Rose im hellen Thema. |
| `blau-300` | `#7EA8FF` | Information und Kategorie Blau im dunklen Thema. |
| `blau-700` | `#2556B8` | Information und Kategorie Blau im hellen Thema. |
| `violett-300` | `#B49BFF` | Kategorie Violett im dunklen Thema. |
| `violett-700` | `#6B47C9` | Kategorie Violett im hellen Thema. |
| `tuerkis-300` | `#4FC9B8` | Kategorie Türkis im dunklen Thema. |
| `tuerkis-700` | `#0F7C70` | Kategorie Türkis im hellen Thema. |
| `sand-300` | `#CDBB8C` | Kategorie Sand im dunklen Thema. |
| `sand-700` | `#7E6E45` | Kategorie Sand im hellen Thema. |

### Status

Erfolg (Grün), Warnung (Gelb, nie Orange), Fehler (Rot), Information (Blau) und Neutral. Jede Statusfarbe ist zugleich Schrift- und Zeichenfarbe und erreicht 4,5 : 1 auf Grund, Flächen und auf ihrer eigenen Hinterlegung (`--cw-<status>-tint`); auf der Hinterlegung steht sonst `--cw-text`. Ein Status steht nie nur in Farbe: immer mit Text, Punkt oder Zeichen (▲ ▼). Rückgänge in `--cw-danger` mit ▼, Zuwächse in `--cw-text` mit ▲.

### Kategorien und Diagramme

- **Optionsfarben** eigener Felder (`--cw-kat-grau`, `-gruen`, `-blau`, `-violett`, `-tuerkis`, `-rose`, `-sand`): Rand mit 55 % und Fläche mit 14 % der Farbe, Text in `--cw-text`. Der gespeicherte Schlüssel `signal` zeigt Grün. Das Grün von Erfolg und Optionsfarbe liegt bewusst im Grünton (#78D87A dunkel, #27742A hell) und nicht im Blaugrün des Akzents. Petrol ist keine Optionsfarbe, damit der Akzent nicht neben einer zweiten, ähnlichen Farbe steht und Auswahl nicht mit Kategorie verwechselt wird.
- **Diagramme:** `--cw-chart-1` Hauptreihe (Textfarbe), `--cw-chart-2` die eine hervorgehobene Reihe (Akzent), `--cw-chart-3` Vergleich und Plan (gestrichelt), `--cw-chart-4` bis `-6` weitere Reihen (Blau, Sand, Violett), `--cw-chart-neutral` Säulen hinter der hervorgehobenen. Reihen unterscheiden sich immer auch in der Strichart.

### Fest in beiden Themen

`--cw-document` (Papier der PDF- und Dokumentansicht, weiß) sowie `--cw-qr-grund` und `--cw-qr-modul` (QR-Codes bleiben dunkel auf hell, damit Kameras sie lesen).

### Kontrast

`pnpm design:kontrast` (`scripts/design/kontrast.mjs`, läuft in der CI) prüft die Paare aus `color.kontrast` in beiden Themen gegen WCAG 2.2 AA: Text 4,5 : 1, Linien, Ränder von Feldern und Diagrammreihen 3 : 1. Durchscheinende Hinterlegungen werden über die Fläche gerechnet, auf der sie liegen. `--tabelle` gibt alle Paare aus. Deaktivierte Schrift (`--cw-text-disabled`) ist nach WCAG ausgenommen. Danach prüft das Skript die Stilvorlagen auf feste Farben und alte Namen.

### Tun und Lassen

| Tun | Lassen |
|---|---|
| Rollen-Token wählen (`--cw-surface`, `--cw-text-muted`) | Primitive (`--p-…`) oder Hexwerte in Komponenten |
| Petrol als feine Kontur für Navigation, 2-px-Ring für Fokus | Sattes Petrol als Fläche oder als Schriftfarbe |
| Neutrale Auswahl (`--cw-selected`) für Zeilen und `--cw-accent-tint` für aktive Hauptreiter | Dieselbe Hervorhebung für Haupt- und Unterreiter |
| Status mit Text, Punkt oder Zeichen | Bedeutung nur über die Farbe |
| Tiefe aus Flächen und Haarlinien | Schatten, Glas, Unschärfe, Verläufe |
| Gelb für Warnungen | Orange, auch nicht als Status- oder Optionsfarbe |
| Ein neues Paar in `color.kontrast` eintragen, wenn eine neue Kombination entsteht | Kontrast nach Augenmaß |

Gedruckte Berichte verwenden eine helle Seite mit Tinte, salbeifarbenen Kacheln und einer feinen Messinglinie unter dem Berichtskopf.

## Schrift und Dichte

Schriftstufen stehen in `tokens.json` und werden als `--fs-<name>` und `--lh-<name>` erzeugt. Komponenten und Seiten schreiben nie eine eigene Größe, sie lesen diese Variablen.

| Stufe | Größe | Einsatz |
|---|---|---|
| `display`, `display-mobil` | 28 / 24 px, 700 | Seitentitel, einmal je Seite, in Groß- und Kleinschreibung |
| `kennzahl-reihe` | 24 px, 700 | Wert in der Kennzahlenreihe, mobil bis 18 px |
| `kennzahl` | 18 px, 700 | Wert einer einzelnen Kennzahl |
| `titel` | 16 px, 700 | Dialoge und große Bereiche |
| `untertitel` | 14 px, 700 | Titel einer Kachel |
| `hauptreiter` | 16 px, 500 / 600 | inaktive / aktive Hauptreiter |
| `text` | 14 px | Lesetext, Felder, Tabellen, Metadaten, Navigation |
| `text-stark`, `klein` | 13 px | Buttons, Tabellenköpfe, Hilfetext, Unterreiter |
| `beschriftung` | 12 px Mono, Versalien | Gruppen und Etiketten |
| `zahl` | 14 px Mono | Zahlen in Tabellen |

- **Instrument Sans** trägt Titel, Kennzahlen, Lesetext und Bedienelemente. Die lokale WOFF2-Datei enthält die Achsen für Gewicht (400–700) und Breite (75–100 %).
- **IBM Plex Mono** kennzeichnet Zahlen in Tabellen, Stichtage, Code und technische Beschriftungen.
- Einbinden: selbst ausgeliefert, nie von einem Drittanbieter (`packages/ui/src/styles/schriften.css`).
- Zeilenhöhe 1,45 im Fließtext, 1,3 bis 1,4 in Titeln und Tabellen.

## Maße und Formen

- Abstände `s-0` 4 · `s-1` 8 · `s-1h` 12 · `s-2` 16 · `s-3` 24 · `s-4` 32 · `s-5` 40 · `s-6` 48 · `s-7` 64 · `s-8` 80. Seitenrand `s-3`, Kacheln mit Innenabstand `s-2` und Lücke `s-1` bis `s-2`.
- Radien `r-s` 4 · `r-m` 6 · `r-l` 8 · `r-xl` 12 · `r-voll` · `r-initiale` 22 %.
- Höhen `h-xs` 28 (dicht: Unterreiter, Segmente, Filter) · `h-s` 32 (Standard für Button, Feld, Navigationseintrag) · `h-m` 40 (großer Button) · `h-l` 48 (Kopfzeile). Hauptreiter `h-hauptreiter` mindestens 44 px breit und hoch. Tabellenzeile `zeile` 36, Tabellenkopf `zeile-dicht` 32. Die kompakte Tabellenvariante verwendet engere Spaltenabstände.
- Klickflächen: mindestens 24 × 24 px (WCAG 2.2, 2.5.8). Auf Geräten mit grobem Zeiger (Touch) wachsen `h-xs` und `h-s` auf 36 und 40 px.
- Seitenleiste `leiste` 240 px, eingeklappt `leiste-schmal` 56 px, auf `--cw-surface`. Kopfzeile 48 px.

## Zeichen und Initialkachel

„Bis zum Ursprung“ besteht aus zwei offenen Bögen um einen Punkt. Bis einschließlich 32 px hat jeder Bogen im 64er-Raster eine Strichstärke von 6, darüber 4,5. Auf Hell stehen die Bögen in Tinte und der Punkt in Petrol, auf Dunkel in hellem Grün und Jade. Die Wortmarke „Carraway“ steht in Instrument Sans mit Gewicht 650 und −0,02 em Laufweite. Die schmale Seitenleiste zeigt das Zeichen allein. Browser, installierte App, Excel-Add-in und Berichtskopf verwenden die zur Größe passende Fassung.

Typst erhält statische TTF-Schnitte (400, 650, 700) aus der variablen Schrift bei 100 % Breite. Die Mailvorlagen bevorzugen lokal verfügbares Instrument Sans und verwenden Arial als Ersatz. Beide Schriftfamilien stehen unter der SIL Open Font License 1.1.

Die Initialkachel für Beteiligungen und Fonds zeigt den ersten Buchstaben, 1,75-mal so groß wie die Kachel, oben und links angeschnitten, Radius `r-initiale`, auf `--cw-tile` (im hellen Thema eine warme Kachel statt eines dunklen Blocks). Sie ersetzt Logos, solange keines hinterlegt ist.

## Icons

- Eine Quelle: Phosphor, Gewichtung Light, im Modul `packages/ui/src/icons.tsx`. Jedes Zeichen heißt `<Name>Icon` (Schreibweise von phosphoricons.com), trägt `data-glyph` und ist Schmuck (`aria-hidden`).
- Standardgröße 18 px, in Menüs und Buttons 16 px, in der Navigation 18 px. Farbe immer `currentColor`.
- Nie direkt aus `@phosphor-icons/react` importieren; ESLint verbietet es. Das Paket liefert alle Gewichtungen, im Code steht nur Light (`scripts/icons.ts` erzeugt `icons.generated.ts`), damit der Anfangsumfang klein bleibt. Neues Zeichen: in `scripts/icons.ts` ergänzen, `pnpm --filter @carraway/ui icons`, eine Zeile in `icons.tsx`.
- Icon-Buttons tragen immer ein `aria-label`. Keine gefüllten oder farbigen Icons, keine Emoji.

## Bewegung

Übergänge 150 ms, ease-out, nur Farbe, Deckkraft und Lage. Fokus: 2 px Ring in `--cw-focus` mit 2 px Abstand. Unter `prefers-reduced-motion` ohne Übergänge.

## Reiter und Seitenmuster

**Regel: nie alle Bereiche untereinander.** Eine Seite zeigt Kopf, eine Kennzahlenreihe und darunter genau einen Inhaltsblock. Alles weitere liegt hinter Reitern oder, auf großen Seiten, hinter einem Inhaltsverzeichnis.

- **Tabs** (erste Stufe): die Bereiche einer Seite mit mehr Platz und klarer Kontur für den aktiven Reiter. **UnterTabs** (zweite Stufe): neutrale Segmentleiste für Unterbereiche des aktiven Reiters, zum Beispiel unter „Finanzierung“ die Reiter „Runden | Transaktionen | Kapitaltabelle | Wasserfall“. Mehr als zwei Stufen gibt es nicht.
- **Wann Inhaltsverzeichnis, wann Tabs.** Detailseiten und Arbeitsbereiche mit vielen Bereichen (bisher zwei Reiterstufen oder mehr als etwa fünf Bereiche) nehmen das **Inhaltsverzeichnis** (`Inhaltsverzeichnis`, `cw-inhalt`): eine zweite, gegliederte Spalte links neben dem Inhalt mit Gruppenköpfen (kleine Versalien mit Laufweite wie in der Seitenleiste) und Einträgen; der aktive Eintrag trägt die Fläche `--cw-selected`. Seitenkopf und Kennzahlenreihe bleiben oben, rechts neben dem Verzeichnis steht genau ein Bereich, nie mehrere untereinander. **Tabs** bleiben für Schrittfolgen (Bericht, Meldelauf, Import), kleine Seiten mit zwei bis fünf Bereichen und das Portal.
- Inhaltsverzeichnis: Die Adresse bleibt `?tab=…&unter=…` mit den bisherigen Kennungen (Hook `useInhalt`; jeder Eintrag hat ein Ziel aus `tab` und optional `unter`, der erste Eintrag ist der Standard und steht nicht in der Adresse); ein Wechsel schreibt beide Parameter in einer Navigation als neuer Verlaufseintrag. Die Einträge sind Knöpfe mit `aria-current="page"` in einer `nav` mit Listen (keine Tablist): Tab erreicht jeden Eintrag, Enter und Leertaste wählen, deaktivierte Einträge sind nicht wählbar. Nach einem Wechsel durch die Person geht der Fokus auf den Inhaltsbereich (benannt nach dem Eintrag), damit Screenreader dort weiterlesen; beim ersten Anzeigen und bei Wechseln über die Adresse nicht. Der Inhalt wird nur für den aktiven Eintrag gebaut, mit eigener Suspense-Grenze; leere Gruppen entfallen.
- Schmale Fenster (bis 807 px): Das Verzeichnis wird zu einer Zeile „Bereich: Name“, die die gegliederte Liste aufklappt (`aria-expanded`); die Wahl klappt sie wieder zu.
- Seitenleiste: Die App-Seitenleiste bleibt, wie die Person sie eingestellt hat (breit oder schmal); das Inhaltsverzeichnis ist die zweite Ebene daneben. Ein automatisches Einklappen gibt es nicht, damit Fondsauswahl und Navigation an derselben Stelle bleiben.
- Der Zustand der Reiter steht in der Adresse: `?tab=…&unter=…`. Ein Wechsel ist ein neuer Verlaufseintrag (Zurück-Knopf), ein Wechsel des Reiters setzt `unter` zurück. Unbekannte Werte fallen auf den ersten Reiter zurück.
- Der Inhalt eines Reiters wird erst gebaut, wenn er aktiv ist; jedes Panel hat eine eigene Suspense-Grenze, die Leiste bleibt beim Laden stehen.
- Tastatur: Pfeile links und rechts, Pos1 und Ende bewegen den Fokus (ein Tabulator-Stopp in der Leiste), Enter und Leertaste wählen. Deaktivierte Reiter werden übersprungen.
- Passen die Reiter nicht in die Breite, scrollt die Leiste waagerecht (ohne Rollbalken) und blendet an den Kanten aus, hinter denen weitere Reiter liegen; der aktive Reiter kommt beim Wechsel ins Bild. Das gilt für Tabs und UnterTabs und ist Verhalten der Komponente (Maske mit Scroll-Zeitleiste, `scrollIntoView`), nicht der Seite.
- Zähler in einem Reiter nur, wenn sie etwas sagen (Anzahl Einträge, offene Aufgaben).
- Mehrere Blöcke in einem Bereich stehen je in einer eigenen Karte (`app-karte`, Überschrift links, Aktionen rechts in derselben Zeile), getrennt durch den Abstand des Bereichs. Keine Karte in einer Karte.
- Tabellen brechen nicht um. Lieber breiter und waagerecht scrollbar, die erste Spalte bleibt stehen. Freitext darf umbrechen, sonst nichts; Felder in Zellen ohne sichtbare Beschriftung.
- Innerhalb eines Bereichs mit mehreren gleichartigen Datensätzen (z. B. Finanzierungsrunden) stehen die Datensätze als Reiter über dem gewählten Datensatz, mit den Eckdaten im Reiter (Name, Status, Datum, Volumen). Keine dritte Spalte links neben Seitenleiste und Inhaltsverzeichnis.
- Die Portfolioübersicht und ihre Analyseseiten stehen im Inhaltsverzeichnis neben dem Inhalt (Gruppen Bestand, Planung, Bewertung, Nachhaltigkeit). Kopf, Stand und Kennzahlenreihe des Fonds stehen über allen diesen Seiten (gemeinsamer Fondsrahmen); jede Unterseite beginnt mit einem Bereichskopf (Titel als h2, ihre Aktionen rechts). Stichtag und Wissensstand stehen nur auf der Übersicht. Der Navigationseintrag „Fonds“ führt zur Fondsliste. Jeder Fonds hat ein eigenes Inhaltsverzeichnis für Stammdaten, Kapitaltransaktionen, Investoren (Zeichnungen und Portalzugänge), Abgrenzung, Dokumente, Periodensperre und Felder.
- Datei-Uploads und Importe verwenden dieselbe petrolfarbene Ablagefläche. Beim Ziehen einer Datei wechseln Kontur und Aufforderung. Die ganze Fläche lässt sich auch per Tastatur oder Klick bedienen. Uploadoptionen stehen vor der Ablage.
- Formulare, Detailansichten, Bestätigungen und die Suche öffnen als zentrierte Dialoge. Längere Formulare scrollen im Dialog. Der gedämpfte, leicht unscharfe Hintergrund zeigt den Ursprung des Aufrufs.

**Seitenaufbau.** Titel und Metadaten wie Fondsname und Status stehen links. Seitenaktionen beginnen oben auf Titelhöhe und schließen rechts bündig ab. Hat die Ansicht einen einstellbaren Stichtag, steht das beschriftete Datumsfeld ganz rechts, der Wissensstand unmittelbar davor. Auf schmalen Fenstern folgt die Aktionsgruppe direkt unter dem Titelblock. Filter für einzelne Listen, Exporte gefilterter Zeilen und Eingaben zur Neuanlage bleiben bei ihrem Inhalt.

**Rahmen:** Seitenleiste links, klebend über die volle Höhe, mit eigenem Scrollen. Oben Zeichen und Umschalter (schmale Leiste nur mit Zeichen und Tooltips), darunter die Fondsauswahl, dann die gruppierte Navigation (Gruppen einklappbar, Zustand je Person gespeichert), unten Avatar und Name des Kontos mit einem Menü nach oben (Sprache, Einstellungen, Verwaltung, API-Hilfe, Abmelden). Die Kopfzeile zeigt den Pfad links, das Suchfeld mittig und die Wiedervorlagen rechts. Ein Klick ins Suchfeld, Strg+K oder ⌘K öffnet das zentrierte Suchfenster. Auf schmalen Fenstern (bis 807 px) öffnet die Hauptnavigation als zentriertes Menü mit eigenem Scrollbereich.

## Formularraster

Felder einer Zeile stehen immer auf einer Höhe. Klasse `cw-formularraster` (Raster, Spalten ab 14 rem) oder ein `app-formular` in einer Karte: Felder sind oben ausgerichtet, die Beschriftung ist einzeilig (Auslassung statt Umbruch), Hilfe und Fehler stehen unter dem Feld und schieben Nachbarn nicht. Auswahllisten sind so breit wie Eingaben; lange Optionen bekommen `breit` an `Feld` oder `Auswahl` (zwei Spalten). Feldbezogene Hilfe steht unter dem Feld, lange Erklärungen einmal unter dem Kartentitel. Der Titel einer Karte wird nicht als Legende wiederholt (Legende `cw-nur-lesen`). Schreibgeschützte Angaben stehen als ruhige Infozeile, die Fußleiste (`app-formular__fuss`) trägt den Stand links und die Hauptaktion rechts.

## Komponenten

Alle Komponenten sind als CSS-Klassen in `packages/ui/src/styles/komponenten.css` gepflegt und lesen nur Tokens. Präfix `cw-`; die React-Komponenten liegen in `packages/ui/src/komponenten`.

| Komponente | Klasse | Zweck |
|---|---|---|
| Button | `cw-button` | Handlungen; primär, sekundär, ruhig, gefährlich; Größen s (28), m (32), l (40) |
| Feld | `cw-feld` | Text, Auswahl, Suche mit Beschriftung und Hilfetext; `kompakt` (28 px) und `labelVersteckt` für Werkzeugleisten |
| Status | `cw-status` | Zustand eines Datensatzes |
| Kennzahl, KennzahlenReihe | `cw-kennzahl`, `cw-kennzahlen` | Gemeinsame Fläche mit einer hervorgehobenen Kennzahl und drei Spalten auf schmalen Fenstern. Einzelne Kennzahlen können als separate Kacheln stehen. Ist ein Rechenweg verfügbar, zeigt die Kachel ein Rechner-Zeichen und die ganze Kachel öffnet ihn. Mit `onZiel` springt die Kachel stattdessen zur passenden Stelle (die Seite entscheidet, wohin), und der Rechenweg erscheint als eigener kleiner Symbolknopf in der Kachel. `hervorgehoben` betont nur dezent (Gewicht und Farbe), ohne Umrandung, damit sie nicht wie eine aktive Auswahl wirkt. Eine dezente Petrolfläche zeigt Hover und ein umlaufender Fokusrahmen die Tastaturauswahl. |
| Herkunft | `cw-herkunft` | Rechenweg und Quellen einer Zahl |
| Initiale | `cw-initiale` | Initialkachel für Beteiligungen und Fonds |
| Tabelle | `cw-tabelle` | Stehender Kopf, rechtsbündige Zahlen in Mono, dezenter Trenner nach jeder fünften Zeile, Laden, leerer Zustand, Zeilenmenü, Summenzeile als Fuß (`fusszeile`, erste Zelle als Zeilenkopf, Linie oben); einzeilig und waagerecht scrollbar, erste Spalte fest (`festeSpalten`), Freitextspalten mit `umbruch` |
| NavLeiste | `cw-nav` | Seitenleiste mit Gruppen, Zeichen und Schmal-Modus |
| Tabs, UnterTabs | `cw-tabs`, `cw-untertabs` | Reiter der ersten und zweiten Stufe |
| Inhaltsverzeichnis | `cw-inhalt` | Gegliederte Spalte links mit Gruppen und Einträgen, rechts genau ein Bereich; auf schmalen Fenstern eine aufklappbare Zeile |
| Seitenkopf | `cw-seitenkopf` | Titel, Meta-Zeile, Aktionen |
| Werkzeugleiste | `cw-werkzeugleiste` | Suche, Filter, Umschalter über einer Liste |
| Fakten | `cw-fakten` | Beschriftung und Wert; Darstellung Raster, `liste` (Beschriftung links, Wert rechts, für Karten) oder `reihe` (eine umbrechende Zeile) |
| Kennwerte | `cw-kennwerte` | Faktenwand in Gruppen: `gruppen[]` mit `titel` und `eintraege[]` (`label`, `wert`, `primaer` für Kopfzahlen, `ruhig` für leere oder Standardwerte, `hinweis`); jede Gruppe eine eingesetzte Fläche (`--cw-surface-2`), Beschriftungen in Satzschrift, Zahlen tabellarisch; Varianten `kompakt` und `gedaempft` (abgeschlossener Gegenstand). Raster bricht selbst um, schmal untereinander. Statt mehrerer `Fakten` in einer Karte verwenden; `Fakten` bleibt für einzelne kurze Zeilen und Beschriftung/Wert-Listen |
| Karte, KartenRaster | `cw-karte`, `cw-kartenraster` | Kompakte Karte mit Titel und einer Aktion im Kopf; Raster aus zwei bis drei Spalten |
| Popover | `cw-popover` | Kleine Fläche am Auslöser für ein oder zwei Felder (zum Beispiel Wissensstand) |
| Leer (`kompakt`) | `cw-leer--zeile` | Leerer Zustand in einer Zeile, gedämpft, mit Aktion am Ende |
| Menue | `cw-menue` | Auslöser mit aufklappender Liste (nach unten oder oben) |
| Dialog | `cw-dialog` | Mittiges Fenster mit kompakter oder breiter Darstellung, auf kleinen Bildschirmen mit Platz zum Rand |
| Leer | `cw-leer` | leerer Zustand mit Zeichen und Aktion |
| Hinweis | `cw-hinweis` | Information und Fehler auf Seitenebene |
| Etikett | `cw-etikett` | Rubrik über Abschnitten |

---

Quelle: Designsystem-Artefakt „Carraway“ (v0.1, 20.11.2026), fortgeführt in v0.2 und v0.3 (Themen). `tokens.json` ist die Quelle der Tokens (`pnpm --filter @carraway/ui tokens` erzeugt `tokens.css`); die Komponenten stehen in `packages/ui`.
