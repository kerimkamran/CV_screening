# Design tokens (Development Plan WP 0.3)

All colour in the app comes from CSS variables in `apps/web/src/index.css`. A page never writes a colour of its own: it uses a Tailwind name (`bg-card`, `text-ink-2`, `border-line`), which points at a variable, so the four page backgrounds (White, White-grey, Cream-white, Dark) are four sets of values for the same names.

| Group    | Names (Tailwind)                                                    | Used for                                                           |
| -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Surfaces | `page`, `card`, `sel`, `hover`, `field`                             | Page, panels, selected row, hover, input fields                    |
| Edges    | `line`, `edge`                                                      | Dividers; control borders (3:1 against surfaces)                   |
| Text     | `ink`, `ink-2`, `ink-3`                                             | Body, secondary, tertiary (all 4.5:1 on all four backgrounds)      |
| Brand    | `brand`, `on-brand`                                                 | The navy header band (Azerconnect navy #133e72) and its white text |
| Action   | `accent`, `accent-hover`, `on-accent`, `link`, `focus`              | Buttons, links, keyboard focus ring                                |
| Danger   | `danger`, `danger-hover`                                            | Destructive buttons                                                |
| Status   | `ok`, `warn`, `err`, `info`, `neutral` (+ `-ink`, `-line`, `-text`) | Bands, decisions, notices, status pills                            |
| Tags     | `tag`, `tag-ink`                                                    | Skill chips                                                        |

Rules that the pool screens follow:

1. **Band and decision colours are never the only signal.** Each pill also carries a word (Strong, Good, Partial, Limited; New, Shortlist, Maybe, Not now).
2. **Decision pill colours** come from `MARK_STYLE` in `apps/web/src/pool.ts`; band colours from `BAND_STYLE`; vacancy status from `STATUS_STYLE`. Change them there, not in a page.
3. **Highlight in the resume** is `bg-warn` on a real `<mark>` element.
4. **Focus** is `ring-2 ring-focus` on every control; do not remove it.
5. **Type** is Manrope Variable; sizes are Tailwind's (`text-xs` to `text-xl`); the page heading is `text-2xl font-bold tracking-tight`.
6. **Touch targets** are at least 44 by 44 px on the star map and in the phone bottom bar; elsewhere controls are at least 32 px high.

`apps/web/src/contrast.test.ts` reads the real stylesheet and checks every text, status and edge pair on all four backgrounds. A new colour pair is added to the lists in that test when it is added to the stylesheet.

## October 2026 redesign

- **Palette** is anchored on Azerconnect navy `#133e72`, the only brand colour Azerconnect publishes (its `theme-color` on azerconnect.az). No full brand guide was found, so the other values (soft blue-grey surfaces, the link blue `#1558b0`, the focus blue, the gold star) are chosen to sit with that navy and to pass `contrast.test.ts`. Replace them if the brand team sends an official palette: change the variables in `index.css`, nothing else.
- **Shape**: pills and buttons are fully rounded, cards and fields `rounded-2xl`/`rounded-xl`, soft shadows, a faint navy wash at the top of each page (`--c-glow`).
- **Header** is a navy band on every page, signed in or not, with the SenAI Ask bar as the one prominent control; focus rings on it are white. Left rail and phone bottom bar mark the current section with a rounded tint and an accent edge.

## Backgrounds, October 2026 (second change)

The picker offers White, White-grey, Cream-white and Dark. Cream-white (`data-bg='cream'`) replaces Sky: warm page `#f7f1e3`, near-white card `#fffdf8`, warm line and edge, navy ink and navy tags, so the Azerconnect navy stays the brand on every background. A person who had chosen Sky is moved to White-grey by migration 0034. The default (nothing chosen) still follows the device: White-grey in light mode, Dark in dark mode. The browser theme colour and the favicon use the navy `#133e72`.
