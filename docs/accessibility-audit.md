# Accessibility audit (design spec section 7.1)

Target: WCAG 2.1 level AA. Audited 6 October 2026 against the screens built so far. This is an automated
and code-level audit; it has **not** been checked with a screen reader on real devices or by disabled users
(see "Still to do").

## What is checked automatically (tests in `apps/web/src/contrast.test.ts` and `a11y.test.tsx`)

| Area | Check | Result |
| --- | --- | --- |
| Colour contrast | Body, secondary and tertiary text, links, status texts on page, card, selected and hover surfaces, on **all four backgrounds** (white, white-grey, sky, dark), measured from the real stylesheet: 4.5:1 | Pass (128 pairs) |
| Colour contrast | Text on buttons, tags, info, success, warning and error panels: 4.5:1 | Pass |
| Non-text contrast | Keyboard focus ring and control edges against page and card, all four backgrounds: 3:1 | Pass |
| Star map | Every star is a real button with a 44 by 44 px target, a name and band in its label | Pass |
| Star map | Arrow keys, Home and End move focus along the ranking; Enter selects | Added and tested |
| Star map | A spoken text summary (top five, count, how to use the keys) is attached to the region; the map itself is a picture of the list that follows it | Added and tested |
| Assistant panel | Landmark named "Assistant", labelled input, every button named, opens from the rail by keyboard, Escape closes, answer completion announced once in a polite live region | Tested |
| Page | `lang="en"`, viewport allows zoom | Tested |

## Code-level findings

- Band and skill state are never colour alone: every chip carries a word (Strong, Good, Found, Partly found, Not found) and a mark.
- Dialogs (requirements drawer, assistant panel) move focus in, close on Escape, and have accessible names.
- Live regions: scan progress and "copied" use `role="status"`; the assistant announces once, not per word.
- Text resizes to 200% without loss: layouts use rem and wrap; the assistant becomes a bottom sheet on phones.
- Reduced motion: the sky twinkle and scan sweep animations are switched off under `prefers-reduced-motion`; the app works the same without them.

## Known gaps and decisions

1. **Azerbaijani pages.** The interface is English. Answers from the assistant can be in Azerbaijani, but the answer text does not yet set `lang="az"` on its own element, so a screen reader may read it with an English voice. To do together with the Azerbaijani interface.
2. **Shared report** has no page numbers when printed (noted in the design status).
3. **Windows high contrast / forced colours** has not been tried; the star map uses fixed colours by design and relies on the labels.

## Still to do (cannot be done by tests)

- Walk through with NVDA and VoiceOver on the main journey: upload, results, open a candidate, mark, share.
- One round with a keyboard-only user and one with a low-vision user before wider rollout.
- Repeat this audit after every new screen; the contrast test reads the stylesheet, so it catches new colour pairs only if they are added to the token lists in the test.
