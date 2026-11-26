# @carraway/ui

React-Komponenten des Designsystems Carraway (Quelle: `design/README.md`, `design/tokens.json`; die Klassen stehen in `src/styles/komponenten.css`). Das Paket wird als Quelltext von einer Vite-Anwendung eingebunden, es gibt keinen Build.

## Einbinden

```ts
import "@carraway/ui/styles.css";
import { Button, Seitenkopf, UiSprache } from "@carraway/ui";
```

Die Schriften liefert das Paket selbst mit (`@font-face` in `src/styles/schriften.css`, Dateien in `src/schriften`). Die Anwendung braucht keinen Link im `<head>` und lädt nichts von Drittanbietern.

## Sprache

Deutsch ist Quelle und Standard, Englisch ist britisches Englisch. Die Komponenten enthalten keine festen Texte: sichtbarer Text kommt über Props, eingebaute Texte (Beschriftungen für Screenreader, Standardtexte, Statusnamen) stehen in `src/texte.ts` mit `de` und `en`. Ein Test schlägt fehl, wenn ein Schlüssel nur in einer Sprache existiert.

```tsx
<UiSprache sprache="en">
  <App />
</UiSprache>
```

Ohne `UiSprache` gilt `de`. Die Formatierer nehmen die Sprache als zweites Argument:

| Funktion | `de` | `en` |
|---|---|---|
| `formatBetrag(12400000, sprache)` | `12.400.000 €` | `€12,400,000` |
| `formatBetrag(12400000, sprache, { kompakt: true })` | `12,4 Mio. €` | `€12.4m` |
| `formatMultiple(1.42, sprache)` | `1,42x` | `1.42x` |
| `formatProzent(8.4, sprache)` | `8,4 %` | `8.4%` |
| `formatDatum("2026-09-30", sprache)` | `30.09.2026` | `30/09/2026` |

Daten (Namen, Eingaben) werden nie übersetzt. Komponenten, die formatieren (`Delta`, `Herkunft`), lesen die Sprache aus dem Kontext.

## Komponenten

`Button`, `ButtonLink`, `IconButton` (nur Symbol verlangt `aria-label`), `Feld`, `Segment`, `Status`, `Delta`, `Kennzahl`, `KennzahlenReihe`, `Herkunft` (zeigt `Rechenschritt[]` aus `@carraway/rechenkern`), `Initiale`, `Tabelle` (dicht, stehender Kopf, Laden, leerer Zustand, Zeilenmenü), `NavLeiste` (Gruppen, Zeichen, schmal), `Tabs` und `UnterTabs`, `Menue`, `Seitenpanel`, `Dialog`, `Werkzeugleiste`, `Fakten`, `Hinweis`, `Etikett`, `Leer`, `Seitenkopf`, `Logo` und die Zeichen (`<Name>Icon`, Phosphor Light).

Alle geben `className` und die nativen Props weiter. Die CSS-Klassen tragen den Präfix `cw-`.

## Zeichen

Alle Zeichen kommen aus `src/icons.tsx` (Phosphor, Gewichtung Light); direkte Importe aus `@phosphor-icons/react` verbietet ESLint. Die Dateien in `src/icons` erzeugt `scripts/icons.ts` und enthalten nur die Gewichtung Light, je Zeichen eine Datei, damit jeder Einstieg nur seine Zeichen trägt. Neues Zeichen: in `scripts/icons.ts` ergänzen und

```sh
pnpm --filter @carraway/ui icons
```

ausführen.

## Tokens

`src/styles/tokens.css` wird aus `design/tokens.json` erzeugt und eingecheckt. Nach Änderungen an den Tokens:

```sh
pnpm --filter @carraway/ui tokens
```

Der Test `src/tokens.test.ts` schlägt fehl, wenn die Datei nicht zu `tokens.json` passt.

## Befehle

```sh
pnpm --filter @carraway/ui typecheck
pnpm --filter @carraway/ui test
```
