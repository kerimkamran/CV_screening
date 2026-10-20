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

## UI/UX changes of 13 October 2026

From a review of the real screens (sign-in, vacancies, a vacancy, candidates, phone width):

- **Vacancy page leads with results.** Once a vacancy has analyzed or running resumes, a summary strip (resumes, analyzed, strong, need a look, could not be read, reading now) and the ranked Candidates tab come first. The Role card and the Resumes card fold into one panel behind "Role and resumes" (kept mounted, so typing is never lost; it opens by itself while there is unsaved typing or nothing is analyzed yet). A warning with "Review and re-analyze" appears when results were scored against earlier requirements.
- **Candidate preview.** On wide screens a click on a row opens a side panel: score and word, must-haves with their state in words, the decision as three buttons (Shortlist, Maybe, Not now; pressing the same one again clears it) and "Open the full report". Keys: J and K move, S, M and N decide, Enter opens the report, Esc closes the panel; keys do nothing while a field, button or link has the focus. On phones a click still opens the report, and the decision stays a drop-down. Every decision keeps the 10-second Undo, the version check and the consistency mirror.
- **Vacancy list.** "38 of 40" with a thin progress bar (the words carry the meaning), decisions as three small coloured pills with words, "12 out of date · Re-analyze" is a link, the list refreshes itself every 5 seconds while a scan runs and when the tab returns (no Refresh button).
- **Sign-in and chrome.** The brand is shown once (header), a Show/Hide button for the password, the footer is centred under the card, "Service unavailable" is the only service status shown (nothing while healthy), the Vacancies icon is a briefcase, not a menu. Search boxes in lists keep their intended width.
- Not changed after checking: the score vocabulary was already one set (Strong, Good, Partial, Limited) in filters, pills and the report.

## Default background (13 October 2026, later)

Recruiters on dark-mode computers saw the dark theme because nothing chosen meant "follow the device". Now nothing chosen is the light default, White-grey, on every device (signed in or out). "Match my device" is an explicit choice (`data-bg='auto'`, saved as `auto`, migration 0035); Dark is chosen from the picker. Existing saved choices are kept.

## Role card: "Save the role first" that never clears (UAT, 13 October 2026)

A recruiter saved a vacancy but the page kept saying "Unsaved changes" and "Save the role first.", and Save answered "Nothing to save", so the scan could not start. Cause: the page decided "unsaved" by comparing every field exactly, while Save compares trimmed text; a trailing space or blank line in the requirements (or title, department, notes) is trimmed by the server, so the two tests disagreed for ever. Now "unsaved" means "Save would send something" (the same test), the saved text replaces what was typed after a save, and the page opens with the vacancy as saved.

Second dead end found in the same screen: when no skills were read (a very short text such as "English, Russian"), the "Add another skill" field was hidden although the page said "or add your own". The field is now always there, and a reading that finds nothing says so.

## Stage 2: the review screen (20 October 2026)

- **CV on the left, Analysis on the right**, as in the brief. The split is a container query (`@min-[60rem]`), not a viewport width, so the panel next to it never squeezes the CV. Below that width the two are tabs, "CV | Analysis".
- **The CV looks like the document.** PDF pages are drawn by pdf.js on white sheets (`bg-white`, a soft shadow) on every background, Dark included, because a CV is paper. Word CVs show the PDF the server made from them, with one quiet line saying so. A text-only CV, and the Text tab, are set on the same white sheet (`CvText.tsx`), with page breaks as a band in the desk colour (`border-neutral`).
- **Marks on the original.** "Show in CV" finds the quote on its page and draws a highlighter stroke over it: `rgb(245 196 97 / 0.5)` with `mix-blend-mode: multiply`, so the text under it stays black, and a thin darker edge so it is visible to people who see yellow poorly. In forced-colours mode it becomes a `Highlight` outline. In the Text tab the mark is the usual `bg-warn` `<mark>`.
- **Scrolling stays in the CV pane.** Jumping to a page or a mark scrolls only the pane that holds the CV, never the page around it, so the decision panel and the requirement list stay where the person left them (`scrollInside` in `motion.ts`).
- **The score** is a ring (`ScoreDial.tsx`): the number is always written in the middle and the label ("Match 88%") is what a screen reader hears; the ring is decoration.

## Motion (Stage 2 design, 20 October 2026)

One vocabulary, in `apps/web/src/motion.css` (styles) and `motion.ts` (scripts).

| Token             | Value                              | Used for                                  |
| ----------------- | ---------------------------------- | ----------------------------------------- |
| `--m-instant`     | 90 ms                              | A button giving under the finger          |
| `--m-fast`        | 160 ms                             | Colour changes, small state changes       |
| `--m-med`         | 280 ms                             | Toasts, a new screen arriving             |
| `--m-slow`        | 520 ms                             | Rows and ticks arriving, the highlighter  |
| `--m-stagger`     | 40 ms                              | Delay between list rows (at most 12 rows) |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)`       | Most changes                              |
| `--ease-emph`     | `cubic-bezier(0.05, 0.7, 0.1, 1)`  | Things arriving                           |
| `--ease-exit`     | `cubic-bezier(0.3, 0, 0.8, 0.15)`  | Things leaving                            |
| `--ease-spring`   | `linear(...)`, one small overshoot | A badge or a count that changed           |

| Class or helper              | What moves                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `m-press`                    | Buttons scale to 96 % while pressed (every `btn`)                                                                                       |
| `m-rise`                     | Content rises 10 px and fades in; `--i` staggers a list                                                                                 |
| `m-fade`, `m-pop`, `m-toast` | Fade in; pop in with the spring; slide up from the bottom edge                                                                          |
| `m-lift`                     | Cards lift 2 px towards the pointer (hover devices only)                                                                                |
| `m-ring`                     | The score ring fills to its value while the number counts up (`useCountUp`)                                                             |
| `m-draw`                     | A tick draws itself (SVG path with `pathLength="1"`)                                                                                    |
| `m-spot`                     | "Show in CV" in the Text tab: the line flashes in the accent colour, then settles to the highlight                                      |
| `m-highlight`                | "Show in CV" on a PDF page: the highlighter stroke sweeps in from the left                                                              |
| `m-orbit`                    | The drop area: a light runs round its edge while files are dragged over it                                                              |
| `transition()`               | Screen changes use View Transitions where the browser has them; the header and rail stay still; Previous and Next slide the CV sideways |
| Sign-in sky                  | Layers drift at different depths with the pointer (the parallax in the name), a shooting star now and then                              |

Rules:

1. **Motion never carries meaning.** Every state is also text, colour or shape, so nothing is lost when motion is off, in forced-colours mode, or to a screen reader.
2. **Reduce motion turns all of it off.** Every animation in `motion.css` sits inside `prefers-reduced-motion: no-preference` (a unit test parses the file and fails otherwise), the scripts ask `mayMove()`, and an e2e test counts the running animations with reduced motion: there must be none.
3. **Cheap to run.** Only `transform`, `opacity`, `scale`, `translate` and colours are animated; no filters or shadows in keyframes; only the decorative sky loops.
4. **Short.** 90 to 520 ms for anything a person waits on.
