# Carraway

The application shares the mark, typefaces and palette defined in the Carraway website's `DESIGN.md`. The common spacing grid and components determine the density of the application.

## Principles

- **Two equally supported themes.** Dark is the default. Light uses the same semantic tokens. All text achieves at least 4.5:1 contrast in both themes, including 12 px labels.
- **One accent for orientation.** Teal (`--cw-accent`) marks active navigation and keyboard focus. The active primary tab also has a light teal tint. Labels and primary buttons use neutral colours.
- **Compact layout.** Body text and table values are 14 px, compact labels are 12 to 13 px and table rows are 36 px high. This keeps more content visible with less scrolling.
- **One visible content block per page.** Additional sections sit behind tabs. See [Tabs and page patterns](#tabs-and-page-patterns).
- **Visible provenance.** Every calculated number has a provenance control (the `Herkunft` component). Numbers are right-aligned in monospace with tabular digits.
- **Grid.** Page spacing and card gaps follow an 8 px grid (`s-1` to `s-8`). Controls and dense lists may use 4 and 12 px (`s-0`, `s-1h`). All dimensions are multiples of 4.

## Language

- German is the source language. Use short, factual, neutral sentences and familiar fund terms (as-of date, capital call, distribution, NAV, TVPI, DPI).
- Buttons describe their action, for example “Create report” or “Record valuation”. Generic labels such as “OK” and “Next” give less context.
- Examples use fictional funds, companies and people, such as “Example Fund I” and “Company A”. Mark fictional values as “Sample data”.
- German locale examples are `12.400.000 €`, `1,42x`, `8,4 %` and `30.09.2026`.
- Avoid em dashes and emoji in the interface.

## Colours

The palette follows the website's 60-30-10 rule. Paper, white and ink are the base. Sage separates light surfaces and forest green separates dark surfaces. Teal and jade mark interactive controls. Gold highlights selected results. Dark surfaces and the gold for small print are adjusted for the app's contrast pairs.

### Token structure

- **Primitives** (`--p-…`, in `color.primitives` in `tokens.json`) are fixed palette values. Only semantic tokens read them.
- **Semantic tokens** (`--cw-…`, in `color.semantic`) express roles (`--cw-bg`, `--cw-surface`, `--cw-text`, `--cw-accent`, `--cw-focus`, `--cw-line`, status, categories and charts), with a value for each of `dunkel` and `hell`. A value is a primitive name or a literal (rgba for tints).
- **Components and pages use semantic tokens only.** `pnpm design:kontrast` checks contrast and disallows literal colours, primitives and legacy colour names in stylesheets.

### Applying themes

`pnpm --filter @carraway/ui tokens` generates `packages/ui/src/styles/tokens.css` from `tokens.json`.

```css
:root { --p-…: …; /* Primitives, type and dimensions */ }
:root, :root[data-theme="dunkel"] { color-scheme: dark;  --cw-bg: var(--p-tinte-900); … }
:root[data-theme="hell"]          { color-scheme: light; --cw-bg: var(--p-papier-100); … }
@media (prefers-color-scheme: light) { :root[data-theme="system"] { color-scheme: light; … } }
```

- Without `data-theme` on `<html>`, the theme is dark.
- `data-theme="hell"` or `"dunkel"` forces a theme. `data-theme="system"` follows the operating system's `prefers-color-scheme`.
- `color-scheme` aligns scrollbars, native selects, date fields and checkboxes with the theme.
- Choose in the account menu (“Theme”, options “System | Light | Dark”) or Settings → Appearance. The LP portal has the same choice in the menu under the user's name. The choice takes effect immediately and is saved per person (`GET` and `PATCH /thema`, default `system`). The browser also stores it under `carraway.thema`. Before first paint and before a session exists, a script in `apps/web/index.html` sets `data-theme` and `<meta name="theme-color">` from `--cw-bg`. The public request page uses the browser's saved choice or the system theme and has no selector.
- Theme changes crossfade colours over 200 ms. `prefers-reduced-motion: reduce` disables the transition.

### Teal accent

Teal marks the current view and keyboard focus. Highlighted metrics use only the weight and colour of the value, with no outline.

| Use | Treatment |
|---|---|
| Focus | 2 px `--cw-focus` ring with a 2 px offset and at least 3:1 contrast on all surfaces |
| Active primary tab | 1 px `--cw-accent` outline, `--cw-accent-tint` fill and stronger label |
| Active navigation | 1 px `--cw-accent` outline |
| Selected table row | `--cw-accent-tint` fill without a side stripe |
| Section label and mark | Gold line before the label, teal or jade dot in the mark |
| Highlighted metric | `--cw-highlight` value with title in the normal text colour |
| Current step | Inverted tile with an accent ring |
| Links | Underlined `--cw-text`, with a teal underline on hover |
| Charts | At most one highlighted series or bar per chart (`--cw-chart-2`), e.g. the latest valuation |

Labels use the theme's text colour. Primary buttons use `--cw-primary` for the background and `--cw-on-primary` for the label.

The interaction accent is teal (`#096D69`) in light and jade (`#7CCFC2`) in dark. Highlighted values use gold (`#C4A25A`) in dark. For small text on sage, the website's text gold (`#8A6D2F`) is darkened to `#806429`. Field borders use the contrast-tested token `--cw-line-control`.

### Tokens in both themes

| Token | Dark | Light | Role |
|---|---|---|---|
| **Surface** | | | |
| `--cw-bg` | `#0E2621` (tinte-900) | `#FAF9F6` (papier-100) | Application background, header and data grid rows. |
| `--cw-surface` | `#102922` (wald-850) | `#FFFFFF` (papier-0) | Surface 1 for cards, sidebar, table headers and dialogs. |
| `--cw-surface-2` | `#112E28` (wald-840) | `#EDF3EC` (papier-200) | Surface 2 for nested cards, segment and subtab tracks, loading placeholders and counts. |
| `--cw-raised` | `#112E28` (wald-840) | `#FFFFFF` (papier-0) | Raised surfaces for menus, popovers and preview cards. |
| `--cw-field` | `#112E28` (wald-840) | `#FFFFFF` (papier-0) | Input and select backgrounds. |
| `--cw-hover` | `#112E28` (wald-840) | `#EDF3EC` (papier-200) | Hover on background and surface, including table rows, navigation and quiet buttons. |
| `--cw-hover-raised` | `#15352E` (wald-825) | `#EDF3EC` (papier-200) | Hover and keyboard focus in menus and result lists. |
| `--cw-selected` | `#15352E` (wald-825) | `#E1EBE3` (papier-300) | Selected rows, selected items and active subtab segments. A neutral fill with an accent line for selection. |
| `--cw-well` | `#102922` (wald-850) | `#EDF3EC` (papier-200) | Track beneath cards in board columns. Cards use `raised`. |
| `--cw-tile` | `#EEF3EE` (hellgruen) | `#E1EBE3` (papier-300) | Initial tile and avatar. |
| `--cw-on-tile` | `#0E2621` (tinte-900) | `#18211D` (tinte-850) | Letter in initial tiles and avatars. |
| `--cw-thumb` | `#3A594F` (wald-700) | `#FFFFFF` (papier-0) | Selected segment or subtab on the `surface-2` track. |
| **Line** | | | |
| `--cw-line` | `#3D5C53` (tinte-650) | `#D3D9D3` (papier-400) | Hairline for table rows, dividers and card borders. |
| `--cw-line-strong` | `#536A60` (tinte-625) | `#8A9A91` (papier-500) | Stronger line for table headers, menu and dialog borders, status pills and timelines. |
| `--cw-line-control` | `#717D77` (tinte-600) | `#73877D` (stein-400) | Field and secondary button borders, 3:1 on background and surface. |
| **Text** | | | |
| `--cw-text` | `#EEF3EE` (hellgruen) | `#18211D` (tinte-850) | Text and titles. |
| `--cw-text-muted` | `#B9CFC4` (salbei-dunkel) | `#505E56` (stein-700) | Secondary text, labels, table headers and inactive navigation. |
| `--cw-text-subtle` | `#97AAA0` (tinte-400) | `#5E6C63` (stein-600) | Placeholders, hints and empty cells. Still achieves 4.5:1. |
| `--cw-text-disabled` | `#66706A` (tinte-500) | `#929D96` (stein-300) | Disabled control text (exempt from the contrast rule). |
| **Accent** | | | |
| `--cw-accent` | `#7CCFC2` (jade) | `#096D69` (petrol-700) | Teal and jade for controls, selection and the brand dot. |
| `--cw-accent-tint` | `rgba(124, 207, 194, 0.13)` | `rgba(9, 109, 105, 0.13)` | Light tint under the active primary tab. Use the normal text colour on top. |
| `--cw-highlight` | `#C4A25A` (gold) | `#806429` (gold-text) | Sparse highlights for metrics and result rows. |
| `--cw-focus` | `#7CCFC2` (jade) | `#096D69` (petrol-700) | 2 px focus ring. |
| **Action** | | | |
| `--cw-primary` | `#EEF3EE` (hellgruen) | `#18211D` (tinte-850) | Primary button uses an inverted surface and reverses foreground and background. |
| `--cw-primary-hover` | `#FFFFFF` (papier-0) | `#163B33` (wald-800) | Primary button hover. |
| `--cw-on-primary` | `#0E2621` (tinte-900) | `#FFFFFF` (papier-0) | Text on the primary button. |
| `--cw-inverse` | `#EEF3EE` (hellgruen) | `#18211D` (tinte-850) | Inverted tiles for the mark, current step and pressed toggles. |
| `--cw-on-inverse` | `#0E2621` (tinte-900) | `#EEF3EE` (hellgruen) | Text on inverted tiles. |
| **Status** | | | |
| `--cw-success` | `#78D87A` (gruen-300) | `#27742A` (gruen-700) | Success, approved, increase with ▲. Text and icon colour. |
| `--cw-success-tint` | `rgba(120, 216, 122, 0.14)` | `rgba(39, 116, 42, 0.10)` | Success tint with `text` on top. |
| `--cw-warning` | `#E8C547` (gelb-300) | `#7A5F00` (gelb-700) | Warning, due, incomplete. Use yellow. |
| `--cw-warning-tint` | `rgba(232, 197, 71, 0.14)` | `rgba(122, 95, 0, 0.12)` | Warning tint with `text` on top. |
| `--cw-danger` | `#FF6B70` (rot-300) | `#A5280E` (rot-700) | Error, decline with ▼, missing data and destructive action. |
| `--cw-danger-tint` | `rgba(255, 107, 112, 0.14)` | `rgba(165, 40, 14, 0.10)` | Error tint with `text` on top. |
| `--cw-info` | `#7EA8FF` (blau-300) | `#2556B8` (blau-700) | Information and notices. |
| `--cw-info-tint` | `rgba(126, 168, 255, 0.14)` | `rgba(37, 86, 184, 0.10)` | Information tint with `text` on top. |
| `--cw-neutral` | `#BCCAC2` (tinte-300) | `#505E56` (stein-700) | Neutral status such as draft or open. |
| `--cw-neutral-tint` | `rgba(188, 202, 194, 0.12)` | `rgba(80, 94, 86, 0.08)` | Tint for neutral notices. |
| **Category** | | | |
| `--cw-kat-grau` | `#BCCAC2` (tinte-300) | `#5E6C63` (stein-600) | Grey option. |
| `--cw-kat-gruen` | `#78D87A` (gruen-300) | `#27742A` (gruen-700) | Green option (stored key `signal`). |
| `--cw-kat-blau` | `#7EA8FF` (blau-300) | `#2556B8` (blau-700) | Blue option. |
| `--cw-kat-violett` | `#B49BFF` (violett-300) | `#6B47C9` (violett-700) | Violet option. |
| `--cw-kat-tuerkis` | `#4FC9B8` (tuerkis-300) | `#0F7C70` (tuerkis-700) | Turquoise option. |
| `--cw-kat-rose` | `#FF6B70` (rot-300) | `#B42328` (rose-700) | Rose option. |
| `--cw-kat-sand` | `#CDBB8C` (sand-300) | `#7E6E45` (sand-700) | Sand option. |
| **Chart** | | | |
| `--cw-chart-1` | `#F2F5EC` (papier-150) | `#18211D` (tinte-850) | Main series for actuals, final values, columns and bars. |
| `--cw-chart-2` | `#65CEC0` (petrol-300) | `#096D69` (petrol-700) | The single highlighted series or column, such as current values or a scenario. At most one per chart. |
| `--cw-chart-3` | `#BCCAC2` (tinte-300) | `#505E56` (stein-700) | Comparison and plan, dashed. |
| `--cw-chart-4` | `#7EA8FF` (blau-300) | `#2556B8` (blau-700) | Additional series. |
| `--cw-chart-5` | `#CDBB8C` (sand-300) | `#7E6E45` (sand-700) | Additional series. |
| `--cw-chart-6` | `#B49BFF` (violett-300) | `#6B47C9` (violett-700) | Additional series. |
| `--cw-chart-neutral` | `#717D77` (tinte-600) | `#73877D` (stein-400) | Neutral columns behind the highlighted one. |
| **Fixed** | | | |
| `--cw-scrim` | `rgba(5, 7, 6, 0.72)` | `rgba(24, 33, 29, 0.36)` | Scrim behind dialogs and the mobile menu. |
| `--cw-document` | `#FFFFFF` (papier-0) | `#FFFFFF` (papier-0) | Document and PDF paper, white in both themes. |
| `--cw-qr-grund` | `#FFFFFF` (papier-0) | `#FFFFFF` (papier-0) | QR background, identical in both themes for camera readability. |
| `--cw-qr-modul` | `#050706` (tinte-950) | `#050706` (tinte-950) | QR code modules. |

### Palette primitives

| Primitive | Value | Use |
|---|---|---|
| `tinte-950` | `#050706` | Near-black for QR modules. |
| `tinte-900` | `#0E2621` | Dark theme background and text on light tiles in dark theme. |
| `tinte-850` | `#18211D` | Text, primary buttons and tiles in light theme. |
| `wald-840` | `#112E28` | Second surface, fields and menus in dark theme. |
| `wald-825` | `#15352E` | Selection and menu hover in dark theme. |
| `wald-700` | `#3A594F` | Selected segment in dark theme. |
| `tinte-650` | `#3D5C53` | Hairline in dark theme. |
| `tinte-625` | `#536A60` | Strong line in dark theme. |
| `tinte-600` | `#717D77` | Control border in dark theme (3:1 against background, both surfaces, menus, popovers and fields). |
| `tinte-500` | `#66706A` | Disabled text in dark theme. |
| `tinte-400` | `#97AAA0` | Subtle text in dark theme. |
| `tinte-300` | `#BCCAC2` | Secondary text in dark theme. |
| `papier-0` | `#FFFFFF` | White surfaces, fields, menus and dialogs in light theme, plus document paper. |
| `papier-100` | `#FAF9F6` | Light theme background. |
| `papier-150` | `#F2F5EC` | Main chart series in dark theme. |
| `papier-200` | `#EDF3EC` | Second surface and hover in light theme. |
| `papier-300` | `#E1EBE3` | Selection in light theme. |
| `papier-400` | `#D3D9D3` | Hairline in light theme. |
| `papier-500` | `#8A9A91` | Strong line in light theme. |
| `stein-300` | `#929D96` | Disabled text in light theme. |
| `stein-400` | `#73877D` | Control border in light theme (3:1 against background and surface). |
| `stein-600` | `#5E6C63` | Subtle text in light theme. |
| `stein-700` | `#505E56` | Secondary text in light theme. |
| `petrol-300` | `#65CEC0` | Highlighted chart series in dark theme. |
| `petrol-700` | `#096D69` | Teal on light backgrounds, the Carraway brand accent. |
| `wald-800` | `#163B33` | Dark fill for primary button hover. |
| `wald-850` | `#102922` | Cards and table headers in dark theme. |
| `jade` | `#7CCFC2` | Interactive elements and the brand dot on dark backgrounds. |
| `hellgruen` | `#EEF3EE` | Text on dark backgrounds. |
| `salbei-dunkel` | `#B9CFC4` | Secondary text on dark backgrounds. |
| `gold` | `#C4A25A` | Highlights on dark backgrounds. |
| `gold-text` | `#806429` | Highlights on light backgrounds. |
| `gruen-300` | `#78D87A` | Success and green category in dark theme. |
| `gruen-700` | `#27742A` | Success and green category in light theme. |
| `gelb-300` | `#E8C547` | Yellow warning in dark theme, with no orange. |
| `gelb-700` | `#7A5F00` | Dark yellow warning in light theme, with no orange. |
| `rot-300` | `#FF6B70` | Error and rose category in dark theme. |
| `rot-700` | `#A5280E` | Brick red error in light theme. |
| `rose-700` | `#B42328` | Rose category in light theme. |
| `blau-300` | `#7EA8FF` | Information and blue category in dark theme. |
| `blau-700` | `#2556B8` | Information and blue category in light theme. |
| `violett-300` | `#B49BFF` | Violet category in dark theme. |
| `violett-700` | `#6B47C9` | Violet category in light theme. |
| `tuerkis-300` | `#4FC9B8` | Turquoise category in dark theme. |
| `tuerkis-700` | `#0F7C70` | Turquoise category in light theme. |
| `sand-300` | `#CDBB8C` | Sand category in dark theme. |
| `sand-700` | `#7E6E45` | Sand category in light theme. |

### Status

Success (green), warning (yellow only), error (red), information (blue) and neutral. Each status colour serves as text and icon colour and reaches 4.5:1 on the background, surfaces and its own tint (`--cw-<status>-tint`). Other text on a tint uses `--cw-text`. Always accompany colour with text, a dot or an icon (▲ ▼). Declines use `--cw-danger` with ▼ and increases use `--cw-text` with ▲.

### Categories and charts

- **Options** for custom fields (`--cw-kat-grau`, `-gruen`, `-blau`, `-violett`, `-tuerkis`, `-rose`, `-sand`) use a border at 55% and a fill at 14% of the colour, with `--cw-text`. Stored key `signal` is green. The success and option green (#78D87A dark, #27742A light) is distinct from the blue-green accent. Reserve the teal accent for selection so it cannot be confused with a category.
- **Charts** use `--cw-chart-1` for the main series (text colour), `--cw-chart-2` for one highlighted series (accent), `--cw-chart-3` for comparison and plan (dashed), `--cw-chart-4` through `-6` for further series (blue, sand, violet), and `--cw-chart-neutral` for columns behind the highlight. Series also differ by stroke pattern.

### Fixed across themes

`--cw-document` is white paper for PDF and document views. `--cw-qr-grund` and `--cw-qr-modul` keep QR codes dark on light for camera readability.

### Contrast

`pnpm design:kontrast` (`scripts/design/kontrast.mjs`, also in CI) checks the pairs in `color.kontrast` for both themes against WCAG 2.2 AA: 4.5:1 for text and 3:1 for lines, field borders and chart series. It composites translucent tints over their surface. `--tabelle` lists all pairs. WCAG exempts disabled text (`--cw-text-disabled`). The script then checks stylesheets for literal colours and legacy names.

### Do and avoid

| Do | Avoid |
|---|---|
| Use semantic tokens (`--cw-surface`, `--cw-text-muted`) | Primitives (`--p-…`) or hex values in components |
| Use teal as a fine navigation outline and a 2 px focus ring | Saturated teal as a fill or text colour |
| Use neutral selection (`--cw-selected`) for rows and `--cw-accent-tint` for active primary tabs | Identical highlights for primary tabs and subtabs |
| Use text, a dot or an icon for status | Conveying meaning by colour alone |
| Build depth with surfaces and hairlines | Shadows, glass, blur and gradients |
| Use yellow for warnings | Orange, including for status and options |
| Add a pair to `color.kontrast` for each new combination | Judging contrast by eye |

Printed reports use light paper with ink, sage-coloured cards and a fine brass line below the report header.

## Type and density

Type scales in `tokens.json` generate `--fs-<name>` and `--lh-<name>`. Components and pages use these variables for all sizes.

| Scale | Size | Use |
|---|---|---|
| `display`, `display-mobil` | 28 / 24 px, 700 | Page title, once per page, in mixed case |
| `kennzahl-reihe` | 24 px, 700 | Value in the metric row, down to 18 px on mobile |
| `kennzahl` | 18 px, 700 | Single metric value |
| `titel` | 16 px, 700 | Dialogs and large sections |
| `untertitel` | 14 px, 700 | Card title |
| `hauptreiter` | 16 px, 500 / 600 | Inactive / active primary tabs |
| `text` | 14 px | Body, fields, tables, metadata and navigation |
| `text-stark`, `klein` | 13 px | Buttons, table headers, hints and subtabs |
| `beschriftung` | 12 px monospace, uppercase | Groups and labels |
| `zahl` | 14 px monospace | Numbers in tables |

- **Instrument Sans** is used for titles, metrics, body text and controls. The local WOFF2 has weight (400–700) and width (75–100%) axes.
- **IBM Plex Mono** is used for table numbers, as-of dates, code and technical labels.
- Fonts are self-hosted through `packages/ui/src/styles/schriften.css`.
- Line height is 1.45 for body text and 1.3 to 1.4 for titles and tables.

## Dimensions and shapes

- Spacing: `s-0` 4 · `s-1` 8 · `s-1h` 12 · `s-2` 16 · `s-3` 24 · `s-4` 32 · `s-5` 40 · `s-6` 48 · `s-7` 64 · `s-8` 80. Page margin `s-3`, card padding `s-2`, gap `s-1` to `s-2`.
- Radii: `r-s` 4 · `r-m` 6 · `r-l` 8 · `r-xl` 12 · `r-voll` · `r-initiale` 22%.
- Heights: `h-xs` 28 (compact: subtabs, segments, filters) · `h-s` 32 (standard button, field, nav item) · `h-m` 40 (large button) · `h-l` 48 (header). Primary tab `h-hauptreiter` is at least 44 px wide and high. Table row `zeile` 36, table header `zeile-dicht` 32. Compact tables use narrower column spacing.
- Hit areas are at least 24 × 24 px (WCAG 2.2, 2.5.8). For coarse pointers (touch), `h-xs` grows to 36 px and `h-s` to 40 px.
- Sidebar `leiste` is 240 px, collapsed `leiste-schmal` is 56 px, on `--cw-surface`. Header is 48 px.

## Mark and initial tile

“Back to the source” consists of two open arcs around a dot. Through 32 px, each arc is 6 units thick on the 64-unit grid, and above 32 px it is 4.5 units. On light backgrounds the arcs are ink and the dot is teal. On dark backgrounds the arcs are light green and the dot is jade. The Carraway wordmark uses Instrument Sans at weight 650 and −0.02 em tracking. The narrow sidebar shows the mark alone. The browser, installed app, Excel add-in and report header use the appropriate size variant.

Typst uses static TTF instances (400, 650 and 700) from the variable font at 100% width. Email templates prefer locally available Instrument Sans and fall back to Arial. Both font families use the SIL Open Font License 1.1.

The initial tile for investments and funds shows the first letter at 1.75 times the tile size, clipped at the top and left, with radius `r-initiale` and fill `--cw-tile` (a warm tile in light theme). It substitutes for a logo until one is available.

## Icons

- Use the Light weight of Phosphor from `packages/ui/src/icons.tsx`. Each icon is named `<Name>Icon` (matching phosphoricons.com), carries `data-glyph` and is decorative (`aria-hidden`).
- Default size 18 px, 16 px in menus and buttons, 18 px in navigation. Always use `currentColor`.
- ESLint disallows direct imports from `@phosphor-icons/react`. It ships all weights, and the application uses only Light to keep the initial bundle small (`scripts/icons.ts` generates `icons.generated.ts`). Add an icon to `scripts/icons.ts`, run `pnpm --filter @carraway/ui icons`, then add a line to `icons.tsx`.
- Icon buttons always need an `aria-label`. Avoid filled or coloured icons and emoji.

## Motion

Use 150 ms ease-out transitions for colour, opacity and position. Focus uses a 2 px `--cw-focus` ring with a 2 px offset. Disable transitions with `prefers-reduced-motion`.

## Tabs and page patterns

**Show one content block.** A page has a heading, a metric row and one content block below it. Other sections are behind tabs or, on larger pages, a table of contents.

- **`Tabs`** (first level) give page sections more room and outline the active tab. **`UnterTabs`** (second level) use a neutral segmented control for subsections of the active tab, such as “Rounds | Transactions | Cap table | Waterfall” under Financing. Two levels are the maximum.
- Detail pages and workspaces with many sections (previously two tab levels or more than roughly five sections) use the **table of contents** (`Inhaltsverzeichnis`, `cw-inhalt`). A secondary column to the left of the content has group headings (small tracked capitals like the sidebar) and entries. The active entry uses `--cw-selected`. The heading and metrics stay above, with one section to the right of the list. **Tabs** suit step-by-step flows (report, regulatory reporting run, import), pages with two to five sections and the portal.
- The table of contents keeps the URL format `?tab=…&unter=…` and existing identifiers (hook `useInhalt`). An entry targets `tab` and optionally `unter`. The first is the default and omitted from the URL. Switching writes both parameters in one navigation and creates a history entry. Entries are buttons with `aria-current="page"` inside a `nav` with lists. Tab reaches every enabled entry and Enter or Space selects it. User-initiated switches focus the named content section for screen readers. Initial display and URL-driven switches do not move focus. Only the active section is built, within its own Suspense boundary. Empty groups are omitted.
- On narrow windows (up to 807 px), the table of contents becomes a “Section: Name” row that expands the grouped list (`aria-expanded`) and collapses after selection.
- The app sidebar retains the person's wide or narrow setting. The table of contents is a second level beside it. Keeping the sidebar from collapsing automatically keeps the fund selector and navigation in the same place.
- Tab state lives at `?tab=…&unter=…`. Switching adds a history entry for Back and resets `unter` when switching the primary tab. Unknown values fall back to the first tab.
- Only build tab content when active. Each panel has its own Suspense boundary and the bar stays visible while it loads.
- Left and Right arrows, Home and End move keyboard focus (one Tab stop in the bar). Enter and Space select. Disabled tabs are skipped.
- When tabs overflow, the bar scrolls horizontally without scrollbars and fades at edges with more content. On switching, scroll the active tab into view. Both `Tabs` and `UnterTabs` handle this within the components (scroll-timeline mask and `scrollIntoView`).
- Put counts on tabs when informative, such as number of entries or open tasks.
- Use a separate card (`app-karte`) for each block in a section, with heading left and actions right on the same line. Separate them by the section gap and avoid nesting cards.
- Tables scroll horizontally and keep the first column fixed. Only free text wraps. Fields in cells have no visible label.
- A section containing like records, such as financing rounds, shows the records as tabs above the selected record. Include name, status, date and volume in the tab. Avoid adding a third left column beside the sidebar and table of contents.
- The portfolio overview and analysis pages share a table of contents (Holdings, Planning, Valuation and Sustainability). Fund heading, dates and metric row sit above these pages in the shared fund shell. Each subpage starts with a section header (h2 and actions at right). As-of and knowledge dates appear on the overview alone. “Funds” links to the fund list. Each fund has its own table of contents for master data, capital transactions, investors (subscriptions and portal access), accruals, documents, period locks and fields.
- Uploads and imports use the same teal drop area. Its outline and prompt change while dragging a file. The whole area works by click or keyboard. Put upload options before the drop area.
- Forms, detail views, confirmations and search open in centred dialogs. Long forms scroll within the dialog. The dimmed, slightly blurred background preserves the context of the action.

**Page layout.** Title and metadata such as fund name and status sit at left. Page actions start level with the title and align to the right edge. If as-of date is editable, the labelled date field is at the far right, with knowledge date immediately before it. On narrow windows actions sit directly below the title block. List-specific filters, filtered-row exports and record creation inputs stay with their content.

**Shell.** Sticky full-height sidebar on the left with its own scrolling. Mark and toggle at the top (narrow mode shows only the mark with tooltips), then fund selector, then grouped navigation (collapsible groups, state saved per person). The bottom shows the account avatar and name with a menu opening upwards (language, settings, administration, API help, sign-out). The header has breadcrumbs at left, search in the middle and follow-ups at right. Click search, Ctrl+K or ⌘K to open centred search. On narrow windows (up to 807 px), primary navigation opens in a centred menu with its own scrolling.

## Form grid

Fields in a row align vertically. Use `cw-formularraster` (grid with columns starting at 14 rem) or `app-formular` inside a card. Align fields at the top and keep labels to one line with ellipsis. Help and errors sit below the field without moving neighbours. Selects are as wide as inputs. Long options use `breit` on `Feld` or `Auswahl` to span two columns. Field-specific help goes under the field and longer explanations under the card title. Keep the card title out of the visible legend (`cw-nur-lesen`). Read-only values use a quiet informational row. The footer (`app-formular__fuss`) shows status at left and the main action at right.

## Components

All CSS classes live in `packages/ui/src/styles/komponenten.css`, use tokens only and have prefix `cw-`. React components live in `packages/ui/src/komponenten`.

| Component | Class | Purpose |
|---|---|---|
| Button | `cw-button` | Actions: primary, secondary, quiet and destructive. Sizes s (28), m (32), l (40). |
| Feld | `cw-feld` | Text, select and search with labels and help. `kompakt` (28 px) and `labelVersteckt` for toolbars. |
| Status | `cw-status` | Record status. |
| Kennzahl, KennzahlenReihe | `cw-kennzahl`, `cw-kennzahlen` | Shared surface with one highlighted metric and three columns on narrow windows. Individual metrics can be separate cards. If a calculation is available, a calculator icon appears and the whole card opens it. With `onZiel`, the card jumps to a location the page chooses and a separate small icon button opens the calculation. `hervorgehoben` changes weight and colour subtly without an outline, preserving the appearance of an unselected card. A teal tint indicates hover and an outline indicates keyboard focus. |
| Herkunft | `cw-herkunft` | Calculation steps and sources for a value. |
| Initiale | `cw-initiale` | Initial tile for investments and funds. |
| Tabelle | `cw-tabelle` | Sticky header, right-aligned monospace numbers, subtle divider every fifth row, loading and empty states, row menu and a totals footer (`fusszeile`, first cell as row header, line above). Single-line and horizontally scrollable, with fixed first column (`festeSpalten`) and free-text columns that wrap with `umbruch`. |
| NavLeiste | `cw-nav` | Sidebar with groups, mark and narrow mode. |
| Tabs, UnterTabs | `cw-tabs`, `cw-untertabs` | First- and second-level tabs. |
| Inhaltsverzeichnis | `cw-inhalt` | Grouped column at left with one section at right. Expands from a single row on narrow windows. |
| Seitenkopf | `cw-seitenkopf` | Title, metadata line and actions. |
| Werkzeugleiste | `cw-werkzeugleiste` | Search, filters and switches above a list. |
| Fakten | `cw-fakten` | Label and value in a grid, `liste` (label left, value right for cards) or `reihe` (one wrapping line). |
| Kennwerte | `cw-kennwerte` | Grouped facts: `gruppen[]` with `titel` and `eintraege[]` (`label`, `wert`, `primaer` for key numbers, `ruhig` for empty or default values, `hinweis`). Each group has an inset `--cw-surface-2` surface, sentence-case labels and tabular digits. Variants `kompakt` and `gedaempft` (completed item). The grid wraps and stacks at narrow widths. Use it for several groups within a card and keep `Fakten` for a short row or a label/value list. |
| Karte, KartenRaster | `cw-karte`, `cw-kartenraster` | Compact card with title and one header action. Grid of two to three columns. |
| Popover | `cw-popover` | Small surface at the trigger for one or two fields such as knowledge date. |
| Leer (`kompakt`) | `cw-leer--zeile` | Muted one-line empty state with an action at the end. |
| Menue | `cw-menue` | Trigger with a list opening downward or upward. |
| Dialog | `cw-dialog` | Centred compact or wide window, with margins on small screens. |
| Leer | `cw-leer` | Empty state with icon and action. |
| Hinweis | `cw-hinweis` | Page-level information and errors. |
| Etikett | `cw-etikett` | Section label. |

---

Source: Carraway design system (v0.1, 20 November 2026), extended in v0.2 and v0.3 for themes. `tokens.json` is the token source (`pnpm --filter @carraway/ui tokens` generates `tokens.css`). Components are in `packages/ui`.
