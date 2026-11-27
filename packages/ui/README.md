# @carraway/ui

React components for the Carraway design system (see `design/README.md` and `design/tokens.json`). The classes live in `src/styles/komponenten.css`. Vite applications consume the package as source. The package has no build step.

## Use the package

```ts
import "@carraway/ui/styles.css";
import { Button, Seitenkopf, UiSprache } from "@carraway/ui";
```

The package ships its own fonts (`@font-face` in `src/styles/schriften.css`, files in `src/schriften`). The application needs no link in `<head>` and fetches nothing from third parties.

## Language

German is the source and default language. The English locale uses British English. Components receive visible text through props. Built-in copy (screen reader labels, defaults and status names) lives in `src/texte.ts` under `de` and `en`. A test fails if a key exists in only one language.

```tsx
<UiSprache sprache="en">
  <App />
</UiSprache>
```

Without `UiSprache`, the default is `de`. The formatters take the language as their second argument.

| Function | `de` | `en` |
|---|---|---|
| `formatBetrag(12400000, sprache)` | `12.400.000 €` | `€12,400,000` |
| `formatBetrag(12400000, sprache, { kompakt: true })` | `12,4 Mio. €` | `€12.4m` |
| `formatMultiple(1.42, sprache)` | `1,42x` | `1.42x` |
| `formatProzent(8.4, sprache)` | `8,4 %` | `8.4%` |
| `formatDatum("2026-09-30", sprache)` | `30.09.2026` | `30/09/2026` |

Data such as names and user input stays in its original language. Components that format values (`Delta`, `Herkunft`) read the language from context.

## Components

`Button`, `ButtonLink`, `IconButton` (an icon-only button needs `aria-label`), `Feld`, `Segment`, `Status`, `Delta`, `Kennzahl`, `KennzahlenReihe`, `Herkunft` (shows `Rechenschritt[]` from `@carraway/rechenkern`), `Tabelle` (compact, sticky header, loading and empty states, row menu), `NavLeiste` (groups, icons, narrow layout), `Tabs` and `UnterTabs` (overflow menu “More”), `FilterChips`, `Sprungmarken` and `SprungAbschnitt`, `Detailbereich`, `InfoKnopf`, `Menue`, `Seitenpanel`, `Dialog`, `Werkzeugleiste`, `Fakten`, `Hinweis`, `Etikett`, `Leer`, `Seitenkopf`, `Logo` and the icons (`<Name>Icon`, Phosphor Light).

All components forward `className` and native props. CSS classes use the `cw-` prefix.

## Icons

All icons come from `src/icons.tsx` (Phosphor, Light weight). ESLint disallows direct imports from `@phosphor-icons/react`. The `scripts/icons.ts` script generates the files in `src/icons`, one file per icon in Light weight only, so each entry point includes just the icons it uses. To add an icon, add it to `scripts/icons.ts` and run the following command.

```sh
pnpm --filter @carraway/ui icons
```

## Tokens

The generated file `src/styles/tokens.css` is checked in and comes from `design/tokens.json`. After changing the tokens, run the following command.

```sh
pnpm --filter @carraway/ui tokens
```

The test `src/tokens.test.ts` fails if the file differs from the output for `tokens.json`.

## Commands

```sh
pnpm --filter @carraway/ui typecheck
pnpm --filter @carraway/ui test
```
