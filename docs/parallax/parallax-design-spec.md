# parallax by Azerconnect Group: Design Specification

| | |
|---|---|
| **Product** | parallax, an AI-assisted CV screening tool for Azerconnect Group HR |
| **Version** | 2.3 (8 October 2026). Replaces versions 1 to 2.2. |
| **Status** | Design prototype v6 plus agreed additions. A build made from spec 2.1 is in UAT round 1; the build from 2.3 is in development. The prototype is not updated for UAT round 1 (owner's decision). |
| **Prototype** | https://claude.ai/artifact/T6CY4ThpFRKtuFVVZ59EsG (private; request access from the design owner) |
| **Audience** | Engineers, designers and product owners who were not part of the design conversation |
| **Stack assumption** | None. Behaviour, tokens and API are described in plain terms. |
| **Product owner** | [Name to be added]. In this document "the owner" means this person. |

## How to read this document

Every section or statement carries one of four labels. Do not treat one label as another.

| Label | Meaning |
|---|---|
| **[Prototype]** | What the clickable prototype does today, checked against its source. Where the prototype is wrong or incomplete, the text says so. |
| **[Agreed]** | The owner said yes in the design conversation. It is **not** in the prototype yet, and the details under it still need design. |
| **[Proposed]** | A recommendation for engineers and designers. Not agreed. |
| **[Open]** | A decision someone still has to make. Section 14 lists them all. |

**What changed in version 2.3 (UAT round 1).** This version also keeps the four background variants added in version 2.2 of 6 October (section 4.2: White, White-grey, Sky and Dark, with the page-background switcher on the web version of this document). The working build went to UAT and the first comments (UAT-01 to UAT-03) are answered here: a **Vacancy pool** (6.7), a **Candidate pool** of analyzed candidates with score and decision (6.8), a **side-by-side score report and resume** (6.9), and an **active assistant** that finds the right candidate for a named position from the vacancy and candidate pools (6.6.9, 6.6.10). Navigation (section 5) and the former Home screen change accordingly. Decision marks and Elon move to **release 1**. Each comment, its acceptance tests and retest steps are tracked in the separate file `parallax-uat-log.md`, which grows as UAT sends more comments.

**What changed in version 2.1.** The assistant "Elon" is specified in 6.6 (original avatar, not a real person's likeness; admin-selected APIs). An **evaluation report** (an HTML page, short but reliable) is specified in 6.5. Recruiters can also attach the vacancy requirements (JD) as a Word file (6.1.3). The owner answered the three open questions: a typical batch is about **100 resumes** (folder and ZIP intake moves to release 1), **names are hidden by default** and the recruiter can reveal them, with the Focus on skills switch being the recruiter's own choice, and Russian text handling is accepted as described. Sections 6.1.4, 6.2.6, 6.2.7, 7, 10, 12, 13 and 14 are updated.

**What changed in version 2.** The owner asked for requirements to be enterable as long text, then answered yes/no on ten extra features (section 6.1, 6.2, 7). The new features are specified here only; the prototype does not show them. An independent review of version 1 also found about 70 problems, which are corrected here: chiefly wrong claims about hover and focus in the prototype, contrast figures measured against the wrong backgrounds, missing definitions and contradictions between sections.

---

## 1. Summary and goals

HR staff at Azerconnect Group receive many resumes for each open position. parallax lets them add a batch of resumes, describe the role, and see which candidates fit best, with a reason for every match.

**Design needs, as stated by the owner**

1. Simple, in the spirit of Google's interfaces: one clear task per screen, lots of space.
2. Azerconnect Group design elements, with a new product brand for the tool.
3. Easy and relaxed to use: a calm tone, no dense forms or dashboards.
4. Star and zodiac-map imagery, with visuals that react when the mouse moves.
5. Resumes added on one side and position requirements on the other, on the same screen.
6. Requirements can also be entered as long text (a pasted job description), as an attached Word file, or as a link to a vacancy on any website.
7. A shareable Markdown document for developers.
8. **Easy to use, compact and simple**, checked by these tests: (a) from the landing page a candidate's side-by-side report opens in at most three clicks through the pool, or one question plus one click through Ask; (b) each screen has at most one primary button; (c) the Candidate pool table shows at most six columns at a viewport of 1280 px without horizontal scrolling; (d) the vacancy Role card fits one 1280 × 800 screen with "More details" collapsed.

**Creative direction behind the brand.** The owner asked for a name about "choosing the fit one", with a futuristic or ancient or earth-derived feel, inspired by the film Interstellar (scouting many worlds and choosing the one that can sustain life), then refined it to "a star that scans the earth and finds other stars", with no goddess names. That is why the interface is a night sky and why candidates are stars. Future screens and illustrations should keep that direction.

**Goals**

- A first-time user can start a screening in under a minute without instructions.
- Every match comes with its reasons, and the reviewer can check the evidence in the CV.
- The tool supports a human decision and never replaces it (section 12).

**Non-goals for the first release**

- Scheduling interviews, messaging candidates, or an applicant-tracking workflow.
- Scanned PDFs and images (OCR). A scanned file is reported as "needs a human look" (section 6.1), not read.
- A Russian-language **interface**. Russian **text** inside resumes and requirements is accepted on a best-effort basis (section 13).

---

## 2. Brand

### 2.1 Name

**parallax**, always written lowercase, shown with the endorsement line **by Azerconnect Group**.

Why: in astronomy, parallax is the apparent shift of a star when seen from two viewpoints, which reveals its true position. In the product, a resume is viewed from two viewpoints, the person and the role, to find the real fit. The two-sided vacancy workspace (resumes on one side, role on the other) is the same idea made literal.

Names considered and set aside: Candid, Seçim, Niche, Gaia (the owner rejected goddess names), Kepler. The owner chose Parallax.

**[Open] Trademark and domain checks have not been run for "parallax".** It is a common word. Legal must clear it before the name is hard-coded anywhere.

### 2.2 Mark [Prototype]

Two small open circles at the base (the two viewpoints) joined by lines to one gold filled circle at the apex (the star), on a 28 × 28 viewBox:

- Lines: path `M6 23 14 6l8 17`, stroke `#5C93FF`, width 1.6, round caps and joins.
- Viewpoints: circles at (6, 23) and (22, 23), radius 3.2, fill = background colour, stroke `#5C93FF`, width 2.
- Star: circle at (14, 6), radius 3.6, fill `#F5C461`.

Used at 30 px in headers. No standalone logo file exists yet; the SVG above is the source.

### 2.3 Lockup [Prototype]

Mark, then the wordmark `parallax` (weight 800, letter-spacing about -0.6 px at 22 px), then `by Azerconnect Group` (13 px, weight 600, colour `text.muted` `#9FB0D0`). The wordmark is lowercase in every context and every language. Whether the endorsement line is translated into Azerbaijani is [Open].

### 2.4 Voice [Agreed]

Calm, plain, short sentences, sentence case, no hype and no jargon such as "AI-powered". Examples: "Who fits this role?", "Drop resumes here", "Find the best fit". Buttons start with a verb. Error messages say what happened, then what to do. Avoid "please", "successfully" and exclamation marks.

### 2.5 Brand assets [Open]

Azerconnect Group's official brand assets (logo files, official colour values, official typeface) were not available when this was designed. The palette in section 4 is an inference from Azerconnect's blue identity, not an official spec. Before launch:

1. Obtain the official logo, colours and typeface from the Azerconnect brand owners.
2. Re-map the token **values** in section 4. Text colour on the accent fill may also need to change (token `text.onAccent`), because contrast depends on the blue.
3. Decide whether the Azerconnect logo appears next to the endorsement line.

---

## 3. Design principles

These are the **targets**. The prototype does not yet meet principles 2 to 4 completely, and section 11 lists where it falls short.

1. **One task per screen.** The vacancy workspace is for adding. Results and the Candidate pool are for choosing.
2. **Light on chrome, one primary action per screen.** No sidebars or toolbars inside a screen; the only persistent chrome is the slim rail and the top bar of section 5. Secondary actions (such as "View CV") use the secondary button style.
3. **Motion is a reward, never a requirement.** Every hover effect is decoration. All information is reachable without a mouse and with motion turned off.
4. **A match is never shown without its reasons.** A number or band may sit on a star label, but the reasons (matched and missing skills, one-sentence explanation) are always one step away and visible on the selected card.
5. **The sky frames the work, it is not the interface.** Forms and lists stay plain and readable.
6. **Quiet unless something is wrong.** Statuses, warnings and hints appear only when they matter. A file that read well shows nothing extra.
7. **A human decides.** Nothing is hidden, rejected or ranked out of sight by the system.

---

## 4. Design tokens

Implement colours as named tokens, not literals.

### 4.1 Dark theme: [Prototype] values, with [Proposed] corrections marked

| Token (suggested name) | Prototype value | Used for |
|---|---|---|
| `bg.base` | `#0A1530` | Page background |
| `bg.map` | `#0C1A3D` | Results star-map panel |
| `bg.card` | `#0F1D45` | Result cards |
| `bg.card.selected` | `#142654` | Selected result card |
| `bg.panel` | `rgba(15,29,69,.78)` | Home cards (translucent over the sky). Composited over the page it is about `#0E1B40`. |
| `bg.field` | `rgba(255,255,255,.07)` | Inputs, file rows. Over `bg.panel` it is about `#1F2B4D`. |
| `border.card` | `rgba(255,255,255,.12)` on Home cards and the map; `.10` on result cards and the Results header divider | Card outlines. Two values exist in the prototype. [Proposed] unify at `.12`. |
| `border.field` | `rgba(255,255,255,.20)` | Input outlines. [Proposed] raise to `.40` (about 3.7:1 on the card, needed for non-text contrast). |
| `border.chip` | `rgba(255,255,255,.25)` | Unselected chip outline. [Proposed] raise to `.45` (about 4.4:1). |
| `accent.primary` | `#2F6BFF` | Primary buttons, selected chips, avatar. [Proposed] change to `#2A63F0` (5.1:1 with white text, see below). |
| `text.onAccent` | `#FFFFFF` (hard-coded in the prototype) | Text on `accent.primary`. [Proposed] make this a token. |
| `accent.line` | `#5C93FF` | Mark lines, focus ring, selected borders |
| `accent.line.bright` | `#8FB4FF` | Revealed constellation lines |
| `star.gold` | `#F5C461` | Strong match, step badges, hover accents |
| `star.mid` | `#8FC4FF` | Good match |
| `star.dim` | `#7C8DB5` | Partial and limited matches |
| `text.primary` | `#E8EEFF` | Body text; headings use `#FFFFFF` |
| `text.secondary` | `#B9C8F2` | Sub-headlines |
| `text.muted` | `#9FB0D0` | Captions, labels, meta, the endorsement line |
| `text.placeholder` | `#7F90B5` | Placeholder text. [Proposed] change to `#93A4C8`. |
| `tag.bg` / `tag.text` | `rgba(92,147,255,.18)` / `#CFE0FF` | Skill tags in result cards |

**Contrast ratios**, computed with the WCAG 2.x formula against the **actual composited backgrounds**:

| Pair | Ratio | Result |
|---|---|---|
| `#E8EEFF` on `#0A1530` | 15.6 : 1 | Pass |
| `#B9C8F2` on `#0A1530` | 10.8 : 1 | Pass |
| `#9FB0D0` on `#0A1530` | 8.3 : 1 | Pass |
| `#9FB0D0` on `#0F1D45` | 7.5 : 1 | Pass |
| `#F5C461` on `#0A1530` | 11.1 : 1 | Pass |
| `#5C93FF` on `#0A1530` (focus ring, lines) | 6.1 : 1 | Pass |
| `#CFE0FF` on tag fill (about `#1D3266`) | 9.3 : 1 (8.2 : 1 on the selected card) | Pass |
| `#7F90B5` placeholder on field (about `#1F2B4D`) | **4.3 : 1** | **Fails AA for normal text.** Prototype value. |
| `#93A4C8` placeholder on field | 5.6 : 1 | Pass. Proposed value. |
| `#FFFFFF` on `#2F6BFF` (all button text, avatar, selected chips) | **4.499 : 1** | **Fails AA by 0.001.** WCAG does not round. The text is under the large-text size. Prototype value. |
| `#FFFFFF` on `#2A63F0` | 5.1 : 1 | Pass. Proposed value. |
| `rgba(255,255,255,.20)` input border on the card | 1.9 : 1 | Fails the 3 : 1 non-text minimum. Prototype value. |
| Score digit `#FFFFFF` on the star-colour disc centre | about 1.6 : 1 on gold, 1.8 : 1 on mid blue | **Fails.** Prototype. See 6.2 for the fix. |
| Score digit `#0A1530` on gold / mid blue / dim | 11.1 / 9.9 / 5.5 : 1 | Pass. Proposed. |

### 4.2 Background variants [Agreed: four backgrounds; values Proposed]

The owner asked for four backgrounds: **White**, **White-grey**, **Sky** and **Dark**. Dark is the prototype theme in 4.1. The other three are light variants that share one text, accent and tag palette and differ only in how the page and the cards are filled. The values below have been contrast-checked by calculation but **never seen in a mockup**. A designer must review all three light variants visually before build. (Added in version 2.2 of 6 October; kept in 2.3.)

**What each variant is for.** White is the cleanest print-like page, and cards are separated by an outline instead of a tint. White-grey is the earlier light proposal: a cool grey page with white cards. Sky is a soft blue page with pale blue cards, closest to the night-sky idea of the brand. Dark is the prototype.

#### Surface and border tokens

| Token | White | White-grey | Sky | Dark |
|---|---|---|---|---|
| `bg.base` (page) | `#FFFFFF` | `#F6F8FC` | `#DCEAFB` | `#0A1530` |
| `bg.card`, `bg.panel` | `#FFFFFF` | `#FFFFFF` | `#F4F9FF` | `#0F1D45` |
| `bg.field` (inputs, file rows) | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `rgba(255,255,255,.07)` |
| `bg.card.selected` | `#EAF1FE` | `#EAF1FE` | `#D8E8FC` | `#142654` |
| `border.card` | `#D5DCE8` | `#D5DCE8` | `#A9C0E0` | `rgba(255,255,255,.12)` |
| `border.field`, `border.chip` | `#6B7A99` | `#6B7A99` | `#566A91` | `rgba(255,255,255,.40)` / `.45` (4.1) |
| `bg.map` (star-map panel) | `#0C1A3D` | `#0C1A3D` | `#0C1A3D` | `#0C1A3D` |

**The star-map panel stays dark in all four variants.** It is a window onto the night sky, so every dark star colour from 4.1 applies inside it unchanged, whichever background the page uses.

#### Text, accent and tag tokens

| Token | White | White-grey | Sky | Dark |
|---|---|---|---|---|
| `text.primary` | `#0A1530` | `#0A1530` | `#0A1530` | `#E8EEFF` |
| `text.secondary` | `#46537A` | `#46537A` | `#33426B` | `#B9C8F2` |
| `text.muted` | `#4C5C80` | `#4C5C80` | `#3B4B73` | `#9FB0D0` |
| `text.placeholder` | `#5B6678` | `#5B6678` | `#4A5775` | `#93A4C8` |
| `accent.primary` (buttons, selected chips) | `#1F5AE8` | `#1F5AE8` | `#1F5AE8` | `#2A63F0` |
| `accent.line` (focus ring, links) | `#1F5AE8` | `#1F5AE8` | `#1F5AE8` | `#5C93FF` |
| `text.onAccent` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| `tag.bg` / `tag.text` | `#E3EDFF` / `#0C3FA8` | `#E3EDFF` / `#0C3FA8` | `#C2D8F8` / `#0A3796` | `rgba(92,147,255,.18)` / `#CFE0FF` |
| Gold as text or an icon | `#9A5F00` | `#9A5F00` | `#7F4D00` | `#F5C461` |

Do not reuse the dark focus colour `#5C93FF` on a light variant: it is only 3.0 : 1 on white.

#### Score discs outside the map

| Disc | White, White-grey | Sky | Dark |
|---|---|---|---|
| Gold (strong match) | `#F5C461` | `#F5C461` | `star.gold` with glow (4.1) |
| Mid blue (good match) | `#8FC4FF` | `#8FC4FF` | `star.mid` with glow (4.1) |
| Dim (partial match) | `#C9D2E6` | `#B3C3DD` | `star.dim` (4.1) |

On the three light variants a disc is a solid fill with the digit in `#0A1530` and a 1.5 px outline in `border.chip`, with no glow. The outline is needed because the fills alone are only about 1.3 to 1.8 : 1 against the page, below the 3 : 1 minimum for the edge of a graphic. The dark digit passes on every fill (9.9 to 11.9 : 1).

#### Contrast ratios

Computed with the WCAG 2.x formula against the actual surface. All pairs below pass AA (4.5 : 1 for text, 3 : 1 for borders and focus).

| Pair | White | White-grey | Sky |
|---|---|---|---|
| `text.primary` on page | 18.1 : 1 | 17.0 : 1 | 14.8 : 1 |
| `text.secondary` on page | 7.6 : 1 | 7.1 : 1 | 8.1 : 1 |
| `text.muted` on page | 6.7 : 1 | 6.3 : 1 | 7.1 : 1 |
| `text.muted` on card | 6.7 : 1 | 6.7 : 1 | 8.1 : 1 |
| `text.placeholder` on field (white) | 5.8 : 1 | 5.8 : 1 | 7.2 : 1 |
| `border.field` on its own field or card | 4.3 : 1 | 4.3 : 1 | 5.1 : 1 on card, 5.4 : 1 on field |
| `accent.primary` as text or focus ring on page | 5.7 : 1 | 5.4 : 1 | 4.7 : 1 |
| `accent.primary` on the selected card | 5.0 : 1 | 5.0 : 1 | 4.6 : 1 |
| White text on `accent.primary` | 5.7 : 1 | 5.7 : 1 | 5.7 : 1 |
| `tag.text` on `tag.bg` | 7.8 : 1 | 7.8 : 1 | 7.2 : 1 |
| Gold-as-text on card | 5.2 : 1 | 5.2 : 1 | 6.7 : 1 |
| Score digit on gold / mid / dim fill | 11.1 / 9.9 / 11.9 : 1 | 11.1 / 9.9 / 11.9 : 1 | 11.1 / 9.9 / 10.1 : 1 |
| Disc outline (`border.chip`) on page | 4.3 : 1 | 4.1 : 1 | 4.5 : 1 |

The card outline (`border.card`) is decoration and is not held to 3 : 1: it is 1.3 to 1.5 : 1 on the page, and cards are told apart by their fill and spacing as well. Input outlines, which do need 3 : 1, use `border.field`.

Rules:

- On every light vacancy workspace the dim constellations use `#1F5AE8` at low opacity and the cursor-revealed layer uses `#1F5AE8` lines with the variant's gold-as-text colour for dots. The horizon glow and the twinkling stars are not used.
- **Default.** The product follows the device: Dark when the device is set to dark, White-grey otherwise. [Proposed]
- **Choice.** The user can pick any of the four. The choice is stored per user (not per browser) so it follows them across devices, and an explicit choice beats the device setting. A "Match my device" option clears the choice. [Proposed]
- **Where the control lives.** In an account menu that does not exist yet; designing it is part of the work. It shows the four backgrounds as labelled swatches, never as colour alone.
- **Only the page changes.** Layout, type, spacing, score meaning and the star-map panel are identical in all four variants.

### 4.3 Typography [Prototype]

- **Typeface:** Manrope (Google Fonts), weights 400, 500, 600, 700, 800. Fallback `system-ui, sans-serif`.
- **Latin Extended is required [Proposed].** Azerbaijani needs all of these in both cases: `A B C Ç D E Ə F G Ğ H X I İ J K Q L M N O Ö P R S Ş T U Ü V Y Z` and lowercase `a b c ç d e ə f g ğ h x ı i j k q l m n o ö p r s ş t u ü v y z`. Capital Ə (U+018F) and lowercase ə (U+0259) are the glyphs most often missing from Latin fonts. Verify them before committing to Manrope, and choose another face if any is missing.

| Role | Size / weight | Notes |
|---|---|---|
| Page headline (Home) | 40 / 800 | letter-spacing -1.2 px |
| Page headline (Results) | 28 / 800 | letter-spacing -0.5 px |
| Section heading in cards | 20 / 700 | |
| Candidate name | 18 / 700 | |
| Primary button | 17 / 700 (Home), 14 / 700 (View CV) | |
| Body, inputs | 15–17 / 400–600 | |
| Field labels, endorsement line, file count | 13 / 600 | |
| Captions, hints, meta lines | 13–14 / 400 | |
| Star label | 12 / 600 | |

### 4.4 Shape and spacing [Prototype]

| Element | Value |
|---|---|
| Home cards | radius 28, padding 28, gap 18 between items |
| Gap between the two Home cards | 24 |
| Results map panel | radius 24, height 360 |
| Result card | radius 20, padding 18 / 24 |
| Drop zone | radius 20, border 2 px dashed `rgba(143,180,255,.55)`, min-height 190 |
| Inputs | radius 14, height 48 (position) / 44 (skill) |
| Chips | radius 20 (experience, height 40), radius 18 (skills, height 36) |
| Primary CTA | height 56, radius 28, padding 0 40 |
| Page container | Home max-width 1040, Results max-width 920 |

### 4.5 Tokens for the UAT components [Proposed]

Contrast is calculated against the actual backgrounds (WCAG 2.x). Every state has a non-colour cue (a word or an icon). **Not now is neutral, not red:** it records a pause, not a verdict.

| Component | Dark background | Light backgrounds (checked on White and White-grey; recheck on Sky, item 11) |
|---|---|---|
| Status pill **Draft** | text `#E8EEFF` on `#222C45` (12.0 : 1) | `#2E3A5C` on `#E7ECF6` (9.4 : 1) |
| Status pill **Open** | `#9FE3BE` on `#0F3D2A` (8.3 : 1) | `#0B5A33` on `#D6F2E2` (7.0 : 1) |
| Status pill **On hold** | `#F5D58B` on `#4A3508` (8.2 : 1) | `#6B4200` on `#FBE9BE` (7.3 : 1) |
| Status pill **Closed** | `#B9C8F2` on the card, with an outline (10.8 : 1) | `#46537A` on white, with an outline (7.6 : 1) |
| Decision **New** | `#B9C8F2` outline chip on the card (9.8 : 1) | `#46537A` outline chip |
| Decision **Shortlist** (check icon) | `#CFE0FF` on `#1D3266` (9.3 : 1) | `#0C3FA8` on `#E3EDFF` (7.8 : 1) |
| Decision **Maybe** (dash icon) | `#F5D58B` on `#4A3508` (8.2 : 1) | `#6B4200` on `#FBE9BE` (7.3 : 1) |
| Decision **Not now** (pause icon) | `#C9D2E6` on `#2A3558` (7.9 : 1) | `#46537A` on `#E7ECF6` (6.4 : 1) |
| Evidence highlight in the resume | background `rgba(245,196,97,.35)`; text stays `#E8EEFF` (6.1 : 1 on the blended fill) | background `#FBE9BE`; text `#0A1530` (15.1 : 1) |
| Redaction block `[name hidden]` | `#C9D2E6` on `#2A3558` (7.9 : 1), dashed `#5B6B94` boundary (3.1 : 1) | `#46537A` on `#E3E8F3` (6.2 : 1), dashed `#6B7A99` boundary (3.5 : 1) |
| Navigation rail, active item | `#FFFFFF` on `#1D3266` (12.4 : 1); rail background `#0A1530`; a filled pill, not a side bar | `#0C3FA8` on `#E3EDFF` (7.8 : 1); rail background white |
| Table row hover and selected | hover `rgba(255,255,255,.04)`; selected `#142654` with a 1 px `#5C93FF` outline (4.9 : 1) | hover `#F1F5FD`; selected `#EAF1FE` with a 1 px `#1F5AE8` outline |

---

## 5. Information architecture [Agreed, UAT round 1]

Recruiters now work from **vacancies** and **candidates**, not from a single start screen. Navigation is a **slim left rail** (about 56 px, icons with labels) with two items, **Vacancies** and **Candidates**, and a **top bar** with the **Ask Elon** bar and the account menu. On phones the rail becomes a bottom bar with three items: Vacancies, Candidates, Ask. The landing page is the Vacancy pool. Each screen has one primary button.

```
 Rail:  Vacancies  |  Candidates          Top bar:  Ask Elon ........ account

 Vacancies (landing) ──▶ Vacancy page ──▶ Add resumes and Find the best fit ──▶ Results
        │                    │                                                     │
        │                    └── Candidates tab (this vacancy)                     └──▶ Evaluation report ──▶ Shared report
        └── New vacancy

 Candidates (pool of analyzed candidates) ──▶ Candidate report: score report | resume, side by side

 Ask Elon (top bar, on every screen) ──▶ answer with ranked candidates ──▶ Candidate report

 Admin console ──▶ Elon settings (provider, model, region, limits, switches)   [not designed]
```

- The two-card screen of version 2.1 (resumes on one side, role on the other) is kept as the **body of a vacancy** (6.1, 6.7): the role side belongs to the vacancy, the resume side adds candidates to it.
- A candidate appears in the Candidate pool only after being **analyzed** (scored). Unreadable files stay on their vacancy as "Needs a human look" (6.1.4).
- In the prototype "Past scans" links to Results and "View CV" is a dead link (`#open`). Neither is the target design: "Past scans" is replaced by the two pools, and "View CV" opens the Candidate report (6.9).

---

## 6. Screens

### 6.1 Vacancy workspace: add resumes, describe the role

**Since version 2.2** this screen is the body of a vacancy (6.7), reached from the Vacancy pool. Everything below still applies; the position, requirements and source are stored on the vacancy, and the resumes are added to it. Where the text says "Home", read "the vacancy workspace".

#### 6.1.1 What the prototype does [Prototype]

**Layout (container wider than about 904 px):**

```
┌──────────────────────────────────────────────────────────────┐
│ ▲ parallax  by Azerconnect Group              Past scans  (HR)│
│                                                              │
│                    Who fits this role?                       │
│   Add resumes on the left, describe the role on the right.   │
│                                                              │
│  ┌───────────────────────┐   ┌───────────────────────────┐  │
│  │ ① Resumes             │   │ ② The role                │  │
│  │ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │   │ Position  [Software Eng.] │  │
│  │   ⬆ Drop resumes here │   │ Experience (Any)(1–3)...  │  │
│  │   or click · PDF DOCX │   │ Must-have skills  chips   │  │
│  │ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │   │ [Add another skill][Add]  │  │
│  │ 3 resumes added       │   │ Job description (optional)│  │
│  │ • cv_aysel.pdf        │   │ [                       ] │  │
│  └───────────────────────┘   └───────────────────────────┘  │
│                                                              │
│                    [ Find the best fit → ]                   │
│    3 resumes · 2 key skills · Candidate data stays inside    │
│    Azerconnect Group                                         │
└──────────────────────────────────────────────────────────────┘
```

**Left card, "1 · Resumes"**

- A numbered gold badge (28 px circle, number in `#0A1530`) and the heading "Resumes".
- Drop zone with copy "Drop resumes here" and "or click to browse · PDF, DOCX". A transparent file input covers the whole zone, so click and drag-and-drop both work. The input's `accept` attribute only filters the file picker; **files dropped onto it are not checked at all** and every dropped name is added to the list.
- Hover: the background tints (`rgba(92,147,255,.12)`). The stylesheet also asks for a gold border on hover, but the inline border style overrides it, so **the gold border does not appear in the prototype**.
- After files are added, a caption reads "N resumes added" ("1 resume added"), then one row per file: a gold dot and the file name, truncated with an ellipsis. Files accumulate. There is no way to remove one.

**Right card, "2 · The role"**

| Field | Control | Prototype behaviour |
|---|---|---|
| Position | Text input | Pre-filled with the sample value "Software Engineer". Not bound to state. |
| Experience | Single-select chips: Any, 1–3 yrs, 3–5 yrs, 5+ yrs | Default "1–3 yrs". Selected: fill `#2F6BFF`, border `#5C93FF`. No selected-state semantics for assistive technology. |
| Must-have skills | Chips, a text input and an "Add" button | Suggestions Python, Cloud, Networking, Team lead; Python and Cloud on. Added skills appear as selected chips. Duplicates are ignored only if the **exact case** matches ("python" and "Python" both get added). The Add button reads the field's change event, so Enter may not add. Skill chips expose `aria-pressed`. |
| Job description (optional) | Multi-line text, 3 rows, vertically resizable | Not bound to state, not used by anything. |

**Primary action:** "Find the best fit" with an arrow icon, height 56, then a summary line `{N resumes} · {K} key skills · Candidate data stays inside Azerconnect Group`. The summary has no singular form: with one file it prints "1 resumes", and with one skill "1 key skills". In the prototype the button navigates to Results with sample data.

**Responsive:** the two cards are a wrapping flex row with a basis of 440 px each. Below about 904 px they stack, resumes first. The subhead "Add resumes on the left, describe the role on the right" becomes wrong when stacked. [Proposed] use position-neutral copy: "Add resumes, then describe the role."

#### 6.1.2 Required fields and validation [Proposed]

| Field | Required to start | Notes |
|---|---|---|
| Resumes | At least 1 readable file | |
| Role information | The vacancy title is always present (6.7). [Open, item 28] whether a run may start on a vacancy with a title but no requirement chip or text; the working rule shows "Add a few skills or paste the vacancy." and still allows it | The title field is empty with a placeholder hint, not pre-filled; a pre-filled default would silently screen against the wrong role. |

Validation messages appear next to the field, are never "Error:" prefixed, and say what to do (section 11 lists them).

#### 6.1.3 Role card with long text, a Word file and a vacancy link [Agreed]

The owner asked for requirements to be enterable as long text, as a **Word file** (the recruiter attaches the vacancy requirements document, the JD), and as a link to a vacancy on any website. The two-card layout stays. The role card gains **one text area** and **two small links**, and loses nothing.

```
② The role
Position      [ Software Engineer                    ]
Experience    (Any) (1–3 yrs) (3–5 yrs) (5+ yrs)
Requirements  ┌────────────────────────────────────────┐
              │ Paste the vacancy or type what you     │
              │ need. Azerbaijani, English or both.    │
              └────────────────────────────────────────┘
              Attach a Word file  ·  Add a vacancy link

   ── after pasting, attaching or linking: 420 words ──
Requirements  Read vacancy.docx · 420 words · Edit text · 2 lines left out
              ● Python   ● Kubernetes   ○ SQL   ○ Team lead   + add
              Tap a skill to switch between must-have (●) and nice-to-have (○).
              A missing must-have lowers the match. It never hides anyone.
```

**Behaviour**

1. **Paste, then review what was understood.** After a paste (or after the user leaves the box), the text folds into one line, "Read 420 words · Edit text". Suggested chips appear below it: title, experience level, skills. Nothing is scored, and nothing is silently applied: the chips are suggestions the user can see and edit before pressing "Find the best fit".
2. **Chips the user added by hand are never overwritten.** Pasting again merges: "3 new skills found. Add them" with one tap. Undo is always available after an extraction.
3. **Hover or focus on a suggested chip** shows the phrase it came from. The original text is not permanently highlighted.
4. **Must-have or nice-to-have in one tap.** Every skill chip has two states. The suggested split comes from the text ("required", "a plus"); the user corrects it with a tap. The state is shown by an icon and fill, not colour alone (● filled = must-have, ○ ring = nice-to-have), and announced to screen readers: "Python, must-have. Press to change to nice-to-have." The sentence under the chips appears once and is the whole rule: **a missing must-have lowers the match; it never hides or rejects a candidate.**
5. **Lines about protected attributes are left out.** Statements about age, gender, marital status, nationality or similar never become chips and are not used for matching. A quiet note shows "2 lines left out of matching", expandable to show which.
6. **Other requirements** that are not skills (location, languages, certifications) are kept as text and shown in the explanation, not as chips [Proposed].
7. **Length and drafts.** Up to about 20,000 characters [Open limit]; the counter appears only near the limit. The text is kept as a draft in the browser so a refresh does not lose it.
8. **No language setting.** The box accepts Azerbaijani, English and Russian, mixed in one text, and Azerbaijani typed without special letters ("sebeke" for "şəbəkə"). Chips are shown in the interface language with the original phrase on hover. Short ambiguous terms such as Java or SAP stay as written. The owner accepted this approach for Russian: Russian text is read on a best-effort basis and is not an interface language (section 13).

**Word file**

- "Attach a Word file" opens the file picker for **.docx**. The requirements box also accepts a file dropped onto it. A small drop target inside the role card is separate from the resume drop zone on purpose: a Word file on the left is a CV, a Word file on the right is a vacancy. A file dropped on the wrong side is never moved automatically.
- The service reads the text of the document, including headings, bullet lists and tables, and shows the result in the same folded form as a paste: "Read vacancy.docx · 420 words · Edit text". The recruiter can open the text, edit it and re-read it; the chips are suggestions to confirm, as for pasted text (items 1 to 8 above all apply).
- One vacancy file per role. Attaching another asks: "Replace vacancy.docx?" Text already typed or pasted is kept and merged, as for a second paste.
- If the file cannot be used, one line with one next step appears under the box:

| Problem | Line shown | Next step |
|---|---|---|
| Password-protected | "This file is locked with a password" | Attach another file or paste the text |
| Empty or no readable text (for example text only inside pictures) | "Couldn't find text in this file" | Paste the text |
| Old `.doc` format [Open] whether to support it | "Save it as .docx and try again" | Attach again |
| Not a Word file | "Only Word files (.docx) here" | Attach again |
| Too large [Open limit] | "That file is over the size limit" | Attach another file |

- The original file is kept with the vacancy so the recruiter can see what was read [Proposed], under the same retention rules as resumes. The vacancy text is never shared outside the group.
- [Open] Also accept a vacancy as PDF? The owner asked for Word files only; PDF is likely the next request.

**Vacancy link**

- "Add a vacancy link" opens one field (it never replaces other input; see 6.7). The service fetches the public page and shows the result in the same folded form: "Read from example.com · 420 words · Edit text". The user can edit the text, so a wrong read is visible before scoring.
- If the page cannot be read (needs a login, blocks automated reading, is mostly images, or is not a vacancy), the message is "Couldn't read that page. Paste the text instead." and the paste box opens. Pasting is always the fallback.
- **Security and legal constraints for engineering [Proposed]:** fetch on the server, never from the browser; allow only `http` and `https`; refuse private, loopback and link-local addresses and re-check after every redirect (server-side request forgery); set a timeout and a response size limit; do not send cookies or credentials; strip scripts; respect `robots.txt` and the site's terms where practical; store only the extracted text and the URL. "Any website" cannot be guaranteed, because many job boards require a login or block automated reading. [Open] confirm with legal that reading third-party vacancy pages is acceptable.

**API:** a single extraction call (section 10.3) turns text, a Word file or a URL into suggested chips. It never starts a screening.

#### 6.1.4 Resume intake [Agreed]

**Plain file problems, never a silent low score (release 1).**

Each file has a status. A file that reads well shows nothing extra. A file with a problem shows one line with one next step:

| Problem | Line shown | Next step offered |
|---|---|---|
| Password-protected | "Locked with a password" | Replace file |
| Scanned image only | "Looks like a scan, no text found" | Replace with a text version |
| Damaged or unreadable | "Couldn't open this file" | Replace file |
| Unsupported type | "Only PDF and DOCX files" | Remove |
| Too large | "Over the size limit" [Open limit] | Replace file |

- These files are never given a score. After the screening they appear as **"Needs a human look"**, always visible and clearly marked, with the reason. The rest of the batch keeps going.
- The user can remove or replace any file. [Prototype gap: no remove today.]
- Dropped files that are not PDF or DOCX are rejected on the client **and** the server.

**Folder or ZIP, and one summary line (release 1).**

The owner's typical batch is **about 100 resumes**, so large batches are the normal case, not an edge case. This changes the intake design:

- The drop zone accepts a whole folder or a ZIP file as well as individual files.
- Above about 8 files, the list collapses to one calm line: "96 ready, 4 being read, 3 need a look". The full list is one tap away, with a filter for "Need a look" so problem files are easy to fix without scrolling 100 rows.
- Skipped files are never dropped silently: "3 skipped, see which".
- Files are uploaded and read in parallel and the summary line updates as they are read. The Find the best fit button stays enabled while files are still being read; it starts the run for the files that are ready and queues the rest, with a clear line saying so [Proposed].
- The user can start a run once at least one file is readable; they do not wait for all 100.
- ZIPs need safe unpacking: path traversal, nested archives, file-count and size limits, and decompression bombs. [Open] the hard limit on resumes per run (it must comfortably exceed 100).

### 6.2 Results: the constellation

#### 6.2.1 What the prototype does [Prototype]

**Header:** the wordmark (without the endorsement line) and a static line "Software Engineer · 24 CVs scanned" that does not match the four sample cards.

**Headline row:** "Your constellation" (28 / 800) and the hint "Hover a star. Brighter means a better fit." (The hint is wrong on touch and keyboard; [Proposed] "Select a star. Brighter means a better fit.")

**Map panel** (height 360, radius 24, background `#0C1A3D`):

- Each candidate is a round button positioned by percentage.
- **Size:** `round(score / 4)` px diameter (92 → 23, 84 → 21, 76 → 19, 58 → 15).
- **Colour:** score at or above 80 gold `#F5C461`; 70 to 79 `#8FC4FF`; otherwise `#7C8DB5`.
- **Glow:** `box-shadow: 0 0 {2·size}px {size/2}px {colour}`. The selected star adds a 3 px white ring.
- **Label** under the star, `Candidate A · 92`, 12 / 600, not interactive.
- **Links:** thin lines (1.4 px, `#8FB4FF`) A–B, B–C, B–D, A–D. Opacity 0.25, or 0.95 when either end is selected.
- **Cursor glow:** radial gradient, radius 200 px, `rgba(92,147,255,.28)`.
- A gradient over the bottom 40 % hints at a horizon. Hover scales a star by 1.35 (0.2 s).

Sample positions (percent of the panel): A (92) at 22, 34; B (84) at 55, 58; C (76) at 78, 28; D (58) at 40, 78.

**Selection:** hovering or clicking a star selects it, and clicking a result card selects it. Result cards are clickable `<article>` elements and are **not keyboard-operable**. The first candidate is selected on load.

**Result cards:** a 52 px disc (radial gradient of the star colour behind the number, number in white at weight 800, 19 px), the name (18 / 700), a meta line (years · discipline · city), skill tags, and a "View CV" button. The prototype shows **no reasons and no matched or missing skills**, only tags, so it does not yet meet principle 4.

**Prototype defects to fix, not copy:** the white score digit on the glowing disc fails contrast (about 1.6 : 1 on gold); "View CV" uses the primary button style; labels overlap when stars are close; stars are 15 to 23 px, below touch-target size.

#### 6.2.2 Match bands instead of a bare percentage [Agreed]

Results lead with a plain band. On Results the exact number appears on hover or focus and in the Candidate report (6.9), never as the headline.

| Band | Range [Open: uncalibrated] | Star colour | Notes |
|---|---|---|---|
| **Strong** | 80 to 100 | `star.gold` | |
| **Good** | 70 to 79 | `star.mid` | |
| **Partial** | 50 to 69 | `star.dim` | |
| **Limited** | 0 to 49 | `star.dim`, smaller | Shown in a collapsed but visible group with a count. Never hidden. |
| **Needs a human look** | no score | outline only | Unreadable files (6.1.4). Always visible. |

- **Exception (UAT-02):** the Candidate pool (6.8), the Candidate report (6.9) and Elon's answers (6.6.9) show the score next to the band, as "Strong · 92", because recruiters sort and compare there. The band always comes first. On Results (cards and star map) the number stays on hover or in the report; the evaluation report (6.5) is [Open] (item 14).
- Star size follows the band, not the raw score, so 73 and 78 look the same.
- The wording must be tested so "Limited" is not read as "reject".
- "No strong match" means no candidate reached **Strong** (80). When it happens, say so plainly and show the best matches; do not present weak matches as good.
- The score is an integer 0 to 100. [Open] Who owns calibrating 80, 70 and 50 against a model that has no defined scale.
- Do not add numeric confidence percentages.

#### 6.2.3 Explanation and proof [Agreed]

Principle 4 needs a real component. On the **selected card** (and in the Candidate report (6.9)):

```
Candidate A                              Strong
6 yrs · Backend · Baku                   [92 on hover]
Matched   ✓ Python   ✓ Kubernetes   ✓ Telecom
Missing   ✗ Networking
Why       Six years of backend work on telecom platforms; no
          networking experience found in this CV.
```

- **Matched** and **missing** chips cover the role's requirements (must-haves first). [Open] whether extra skills found in the CV may be listed as "also found".
- **One-sentence reason**, written in the interface language, citing evidence from the CV (a role or project). A missing skill is worded **"Not found in this CV"**, never "does not have".
- **Click a skill to see the proof.** Clicking a matched or missing skill opens the exact sentence or lines from the CV that support it, with the page number, in a small panel next to the card. Three states: **Found**, **Partly found**, **Not found**. Quotes are literal text from the CV, never paraphrased. For "Not found", the panel says what was searched.
- The panel and the chips are keyboard-operable and announced by screen readers.
- **Evidence states are the single source:** matched = state Found, partly = Partly found (shown as a half-filled chip between Matched and Missing), missing = Not found. "Must-haves x of y" counts only requirements of kind must in the match's own frozen requirements; Partly found does not count.
- **A quote is valid** if, after Unicode NFC, whitespace collapse and case folding, it is a contiguous piece of the **anonymised** text of the cited page, at most 300 characters; an omission is written "[...]" between two valid pieces; a quote that contains a redaction shows its label. The validation target is the anonymised text, so a quote can never carry a name.
- The card shows the experience fit in a line ("6 years; the role asks for 1–3").

#### 6.2.4 Decision marks [Agreed, release 1]

The Candidate pool (6.8) needs a decision status on every analyzed candidate, so decision marks move to **release 1** and use one shared set of statuses, **decision marks only** (the owner's choice):

| Status | Meaning | Notes |
|---|---|---|
| **New** | Analyzed, no decision yet | The default for every analyzed candidate. |
| **Shortlist** | The recruiter wants to move this person forward | |
| **Maybe** | Undecided, worth a second look | |
| **Not now** | The recruiter is not moving forward at this time | Asks for a one-line reason, which the recruiter may skip. A bulk Not now asks once for all selected rows. Never hides, deletes or re-ranks anyone. |

- The status belongs to the **candidate in a vacancy** (a person can be Shortlist for one vacancy and Not now for another).
- It is set in one click in the pool row, on the card, or in the report, with an **Undo** toast instead of a confirmation, an optional one-line note, and a history of changes (who, when, from, to).
- Statuses are kept **separate from the AI band** and never change it. Interview, offer and other hiring stages stay in the group's other tools; they are not part of this product (owner's decision).
- Controls appear on hover, focus or selection on cards, to keep them calm; in the pool the status is always visible.
- A shortlist can be copied or exported [Open] (copy to clipboard, CSV, or both). Side-by-side comparison of finalists and a hiring-manager share page are later ideas and not agreed.
- Any recruiter who can see the vacancy may change a decision. Concurrent changes follow the version rule of 6.8; every change is logged with who and when.
- Visibility to teammates is [Open] (see 14, item 25).

#### 6.2.5 Edit requirements on the results screen [Agreed, release 2]

- A "Requirements" control opens a drawer, closed by default, listing each requirement with three states: **must-have**, **nice-to-have**, **ignore**.
- Changing one re-ranks the stars in place without re-reading resumes. A "Back to original" button restores the first ranking in one tap, and the drawer states what changed in one line ("2 changes since the first scan").
- **Guard against tuning toward a favourite:** every change is kept in the run history with who changed it and when. The original ranking is always one tap away.
- An optional collapsed row "Missed by one must-have (4)" lets reviewers find near misses.

#### 6.2.6 Names hidden by default, and the Focus on skills switch [Agreed]

The owner decided: **real names are hidden by default, the recruiter can reveal them, and the Focus on skills switch is the recruiter's own choice.**

**Names (release 1).**

- Every candidate is shown with a stable pseudonym such as "Candidate 07" on star labels, cards, accessible names and exports. The pseudonym is assigned once to a candidate in a vacancy and stays the same across every run of that vacancy, so marks and notes stay attached to the right person. In any list that can contain more than one vacancy it is shown with the vacancy (6.8).
- A "Reveal name" control on each card (and on the Candidate report (6.9)) shows the real name for that candidate. A "Reveal all names" action is also offered once, with a short confirmation: "Names are hidden to keep the first look about skills. Show all?"
- Revealing is a recruiter's action and is recorded in the run history (who revealed whom and when). The reveal stays for that recruiter, for that candidate in that vacancy, until "Hide again" or sign-out. Revealing a name and showing the original resume are two separate reveals (6.9).
- The name is never part of the score (section 12).

**Focus on skills switch (release 2).** One switch, off or on, **chosen by the recruiter and remembered per recruiter** (not per browser). When on, it hides everything beyond the name that could bias a first look: photo, age, gender, marital status and city, and the meta line shows only years of experience and discipline. Names stay hidden unless the recruiter reveals them, as above. [Open] The first-time state for a new recruiter: recommended **off** with a one-line invitation to try it, because the owner wants this to be the recruiter's choice.

It is described to users as "hidden on screen", **not** a guarantee: a name can sit in free text that redaction misses. Test on real Azerbaijani CVs first.

The prototype is anonymised ("Candidate A") and has no reveal.

**The resume viewer follows the same rule (6.9).** It opens in an anonymised view; showing the original file counts as a reveal for that candidate, is recorded, and can be hidden again.

#### 6.2.7 Order, scale and phones [Proposed]

- **Order:** by score descending. Ties: more must-haves matched first, then upload order, so the order is stable. "Needs a human look" comes last, in its own group.
- **Large pools (the normal case: about 100 resumes per run):** the map shows the top 12 with the line "Showing top 12 of 64" and a "Show all" option; the list is paged at 20. Labels show only for the top 5 and for the hovered or selected star. Hiding people without saying so would look like silent exclusion, so the count is always shown.
- **Pointer behaviour:** on a mouse, hover previews and **click or focus selects**; moving the pointer across the map does not change the selection by accident.
- Selecting a star scrolls its card into view, and the reverse.
- **Phones:** the list comes first and the map is an optional view; a 360 px-high map is not usable on a phone.

### 6.3 Scanning flow [Proposed]

1. The user presses "Find the best fit". The Results screen opens **immediately** in a scanning state.
2. A light sweep crosses the sky. Stars appear as each resume is scored, ranked so far, with a line "34 of 96 read". Unreadable files appear as they are found.
3. A **Cancel** button stops the run and keeps what has been scored ("Stopped at 34 of 96").
4. The user may leave; the run continues and is available from the vacancy page (Runs, 6.7).
5. When done, one line summarises: "96 read, 93 scored, 3 need a human look".
6. A second run may start while one is running [Open].

### 6.4 Screens not yet designed [Open]

- **Specified in this document but not yet drawn visually:** the navigation rail and top bar (5), the Vacancy pool and vacancy page (6.7), the Candidate pool (6.8), the side-by-side Candidate report (6.9), the Ask bar and Elon panel (6.6.11).
- **Admin console** for the assistant's APIs (6.6.5).
- **Account menu** (theme, language, the Focus on skills switch, link to the admin console for admins).
- **Shortlist export** and a possible "Group by candidate" view of the pool (6.8): open, not scheduled.
- **Scan history** is not a separate screen: runs are reached from the vacancy page, analyzed candidates from the Candidate pool.

### 6.5 Evaluation report [Agreed]

Recruiters need an HTML report of the evaluation results that is **short but reliable**. The owner's answers: one report covers the **whole run, kept short**; it opens **inside the app** and can be **shared as a link inside the group**; and it must carry **evidence quotes, how it was scored, data quality, and changes and decisions**. Names are **hidden by default, with a reveal choice** at share time. A downloadable HTML file and a PDF were offered and **not chosen**; do not build them without a new decision.

**Principle: reliable means checkable, not long.** The page is meant to fit about two screens for a typical run of about 100 resumes. Everything a reader might doubt is either on the page in one line or one click away.

**Layout (top to bottom)**

```
┌──────────────────────────────────────────────────────────────┐
│ ▲ parallax by Azerconnect Group          Report · 6 Oct 2026 │
│ Backend Engineer · 96 read, 93 scored, 3 need a human look   │
├──────────────────────────────────────────────────────────────┤
│ The role   Must-have: Python, Kubernetes, Networking         │
│            Nice-to-have: SQL, Team lead · 3–5 yrs            │
│ How scored AI suggests, a human decides. A missing must-have │
│            lowers the match and never hides anyone.          │
├──────────────────────────────────────────────────────────────┤
│ Strong 8 · Good 21 · Partial 40 · Limited 24 · Look 3       │
├──────────────────────────────────────────────────────────────┤
│ 1  Candidate 07   Strong                                     │
│    ✓ Python ✓ Kubernetes  ✗ Networking (not found)           │
│    Why: six years of backend work on telecom platforms…      │
│    "Migrated 12 services to Kubernetes…"  p.2                │
│ 2  Candidate 31   Strong …                                   │
│  … top 15 expanded; the rest as one compact row each …       │
├──────────────────────────────────────────────────────────────┤
│ Not read (3)   Candidate 12 locked · 40 scan only · 77 damaged│
│ Changes and decisions   2 requirement changes · 5 shortlisted│
└──────────────────────────────────────────────────────────────┘
```

**Sections and rules**

1. **Header.** Role title, report date, and the counts "N read, N scored, N need a human look". The wordmark uses the standard lockup.
2. **The role.** The requirements actually used, split into must-have and nice-to-have, with the experience range. If the requirements changed after the first scan, the **current** ones are shown and the change is noted (item 7 below).
3. **How it was scored.** Two or three plain lines: the date and the version of the scoring method, the sentence "AI suggests, a human decides. A missing must-have lowers the match; it never hides anyone.", and, if scores can vary between runs, "Scores may differ slightly if the screening is run again." [Open reproducibility]. The reader should never have to guess what the score means.
4. **Band summary.** One line of counts per band (Strong, Good, Partial, Limited, Needs a human look), using the same bands and colours as Results (6.2.2). The exact 0 to 100 score appears only on hover or in the row's detail, never as the headline [Open, item 14]: the pools show the score next to the band (6.2.2), and the owner may want the report to do the same.
5. **Ranked candidates.** Ordered as on Results (6.2.7). The **top 15** are expanded with:
   - pseudonym (or real name if included, see Names below) and band;
   - matched and missing chips, using the same Found, Partly found and Not found states;
   - the one-sentence reason;
   - **evidence quotes:** up to two literal sentences from the CV with the page number, for the strongest matched requirement and for any "Partly found"; for a missing requirement, the line "Not found in this CV" and what was searched. Quotes are never paraphrased.
   All other candidates appear as one compact row (pseudonym, band, matched count, missing must-haves) with a "Show details" control. A "Show all" control expands the full list. Hiding people without saying so would look like silent exclusion, so the page always states "Showing 15 of 93 scored".
6. **Data quality.** "Not read (3)" lists each unreadable file with its pseudonym and the plain reason (locked, scan only, damaged, unsupported). Nothing is missing silently. If every file was read, one line says so.
7. **Changes and decisions.** Shown only when they exist.
   - **Requirement changes** after the first scan (in release 1 these are the vacancy's history entries, 6.7): who, when, what changed (for example "Networking: must-have to nice-to-have"), and a note that the original ranking is available in the app.
   - **Recruiter marks and notes** (Shortlist, Maybe, Not now) are shown **separately and visually distinct from the AI result**, and labelled "Recruiter decision". They never change the band. Decision marks are release 1 (6.2.4); they appear here whenever they exist.
8. **Footer.** Run ID, report date, who created it, and the statement "Candidate data stays inside Azerconnect Group."

**Reading and layout**

- A real HTML page with semantic headings, a data table or list for the ranking, and text equivalents for every colour (the band name is always written).
- Plain and calm: the same night-sky palette in the header only, with the body on a readable panel. No star map in the report: a picture of the sky is not evidence.
- Language follows the viewer's language setting. The language of quotes is the language of the CV.
- Works at phone width and prints reasonably through the browser, but a dedicated print layout is not part of this scope.

**Delivery**

| Channel | Decision | Notes |
|---|---|---|
| Open inside the app | **Agreed** | Always live: shows the current state of the run. Release 1. |
| Share a link inside the group | **Agreed** | Release 2, because it depends on the access model [Open]. |
| Download one HTML file | Not chosen | Do not build. |
| Print or PDF layout | Not chosen | Do not build beyond the browser's own print. |

**Share link rules [Proposed]**

1. The link is a **snapshot**: it shows the report as it was when shared, labelled with that date, so a hiring manager sees stable results. Sharing again creates a new snapshot.
2. **Login only:** the viewer signs in with their group account. The link alone is never enough.
3. The recruiter chooses who can open it (named people or a group) and an expiry date [Open default, suggested 30 days]. The recruiter can **revoke** it at any time. An expired or revoked link says so plainly: "This report is no longer available. Ask the recruiter for a new link."
4. Every open is recorded (who, when) and visible to the recruiter.
5. **Names:** the link defaults to pseudonyms. When sharing, the recruiter can choose to include real names, but only for candidates already **revealed or shortlisted**, with a one-line warning ("Real names will be visible to the people you choose"). Both the choice and the people are recorded.
6. **Evidence quotes are personal data.** A shared report contains CV text. The recruiter sees a one-line notice at sharing time, and the quotes can be switched off for a link [Open] whether quotes may be shared by default.
7. The page carries no download, copy or print restrictions that could not be enforced; the notice and the audit log are the controls.

**Names in the report.** Pseudonyms by default, matching the app. Real names appear only for candidates the recruiter revealed, and only if the recruiter includes them (above). Photo, age, gender, marital status and city never appear in the report [Proposed].

**States:** report generating ("Preparing your report…"), run still scanning (the report shows what is ready and says "34 of 96 read, this report will update"; a shared snapshot is only offered when the run is done), run cancelled (the report says "Stopped at 34 of 96"), no scored candidates, link expired or revoked, access denied ("You don't have access to this report. Ask the recruiter."), and generation failed with a retry.

### 6.6 Elon, the assistant [Agreed]

The owner wants an AI assistant, working name **Elon**, that the recruiter can ask about each result: ask questions, consult, and debate "why this one". The owner's answers: it lives in a docked side panel on Results and the vacancy page, in the **Ask bar** of the top bar, and in a **composer inside the Candidate report** (6.6.11); it can **explain why this one**, **challenge the match**, **compare candidates**, **suggest interview questions**, and **challenge the recruiter** (fact-based only, no hallucination, no mistakes, no bias); it calls **APIs chosen by an admin**; conversations are **saved to the run and private to the recruiter**.

#### 6.6.1 Name and appearance

- "Elon" is the owner's working name. Treat it as a **configurable string** in the message catalogue, not a hard-coded brand. [Open] final name.
- **Research recommends against launching as "Elon".** To most users it reads as Elon Musk, which suggests a link to him, his companies or his AI products that does not exist; a human first name can also lend the assistant more authority than a decision aid should have. This is an inference to be confirmed by counsel (Azerbaijani rules were not checked). Cleaner options, to be tested for availability and Azerbaijani pronunciation: **"Parallax Assistant"**, **"Second View"**, **"Counterpoint"**, **"Lens"**. If the owner keeps "Elon", Legal clears it first. Either way, the panel shows a visible **"AI" label** at all times.
- **The assistant does not look like, sound like or imitate any real person.** The owner asked for it to look like Elon Musk; that is not specified here. Using a real, living person's face, voice or manner would imply their involvement or endorsement, creates legal and reputational risk for Azerconnect Group, and a human face on a screening tool invites recruiters to trust the answers more than the evidence supports. Instead the assistant uses an **original mark**: a small star-and-two-viewpoints orb in the brand style (the mark in 2.2, simplified), with no face and no human features. The name alone is the only personal element, and it stays configurable. [Open] Legal review of the name.
- Tone: calm, direct, short. No jokes at the candidate's expense, no hype, no persona catchphrases.

#### 6.6.2 Placement and behaviour [Agreed]

Research on comparable products (code editors, document and CRM tools with assistants) points to the same shape, so the design is: **one assistant service with three entry surfaces** (the Ask bar, the docked panel, the report composer); the docked panel is on the right and closed by default, fed by many small entry points. A separate drawer under every card would be duplicated for each candidate, push the list around, split the history and could not compare two people. A floating bubble would sit on top of the constellation map and does not say whether it means "this candidate" or "everyone".

- **Panel:** docked on the right of the Results screen, 360 to 420 px wide, collapsed by default to a slim rail (about 48 px) with the orb and the label "Ask Elon". It is additive: it never replaces the list or the evidence. Open or closed is remembered per user.
- **Closed by default** so the recruiter reads the band and the proof quotes first; the assistant sits after the evidence in reading order.
- **Labelled entry points**, not a global icon alone: an "Ask Elon about this candidate" button in the selected candidate's header, and small "Ask why" links beside the reason line, each missing-skill chip and each evidence quote. They open the same panel with the question pre-filled and the context attached.
- **Context is automatic and visible.** The panel header shows a chip such as "Discussing: Candidate 07 · Strong". There is **one thread per candidate**; selecting another candidate switches threads and never carries context across. A question about two people ("why 07 over 31?") adds a second chip explicitly; it never widens the scope silently.
- **The chat drives the canvas.** A comparison highlights both stars and their evidence rows, and answers carry the same click-to-proof chips as the cards, so the recruiter can verify without reading a wall of text in a narrow column. An "Expand" control gives a wider view for long comparisons.
- **Responsive, one component, three presentations:** at a container width of 1280 px or more it is a docked panel; from tablet width up to about 1279 px an overlay side sheet that covers the map and keeps the list visible; on phones a bottom sheet that peeks with the context chip and the latest answer and drags up to full height. [Proposed] Do not claim a global keyboard shortcut; the labelled button is the way in.
- Opening moves focus to the input. Escape closes it and returns focus to the control that opened it. It is a labelled region (`aria-label="Assistant"`). New answers are announced once, when complete, through a polite live region, not word by word.
- **Shortlist, hold and any verdict controls stay in the main view.** Nothing in the chat sets a mark.

**Starter chips**, chosen by band so the recruiter never faces a blank box and the questions probe the AI instead of confirming it:

| Band | Chips |
|---|---|
| Always | "Why this band?", "What is the weakest point?", "What would change the band?", "What should I ask in the interview?", "Compare with…" (the recruiter picks the other candidate) |
| Strong, Good | plus "What could I be missing?" |
| Partial, Limited, Needs a human look | plus "What is the strongest case for this one?" and "What should I check by hand?" |

The lower-band chips matter because nothing is ever rejected by the system: the biggest bias risk is a recruiter who never opens a Partial candidate.

```
┌──────────────────────────────────┐
│ ◉ Elon · AI        Expand  ✕     │
│ Discussing: Candidate 07 · Strong│
│ ──────────────────────────────── │
│ You: Why this band?              │
│ Elon: Python and Kubernetes are  │
│  both found. Networking is not   │
│  found in this CV.               │
│  [p.1 Python] [p.2 Kubernetes]   │
│  What I can't see: the CV does   │
│  not mention networking; that is │
│  not proof they lack it.         │
│ [Challenge this match] [Compare] │
│ ┌──────────────────────────────┐ │
│ │ Ask about this candidate     │ │
│ └──────────────────────────────┘ │
│ Chats are saved to this run.     │
└──────────────────────────────────┘
```

#### 6.6.3 What Elon can do

Elon's default stance is **evidence for and against, not a verdict**. It is a second reader, not a recommender, and it explains the band; it never re-ranks.

| Ability | What it does | Rules |
|---|---|---|
| **Explain why this one** | Gives the case for, the case against and what the CV does not show, in a few lines. No hire or reject language. | Uses only the stored match record, the requirements and redacted CV passages. It explains the **real scoring basis**, never a story invented afterwards. |
| **Challenge this match** | Opt-in, started by the recruiter. Elon first asks "What is your read?" (optional, one line), then gives the strongest evidence-bound objection to the band or to the recruiter's leaning, and ends with a visible outcome: "Challenge held: no CV evidence found against the band" or "Gap found" with the proof chip. | Never mandatory or constant: an always-contrarian assistant makes recruiters distrust good matches. |
| **Compare candidates** | Compares two or three candidates on the **same requirement rows**, side by side. | Never on personal attributes. |
| **Suggest interview questions** | Proposes questions that check missing or partly found skills, each linked to the CV passage it follows from. Can copy them into a note. | Job-related and lawful only. |
| **Challenge the recruiter** | When the recruiter's reasoning conflicts with the evidence or rests on something that is not job-related, Elon says so once, neutrally, with the facts: "The CV does show Kubernetes on p.2, so it is not missing." or "That isn't part of the requirements, so I can't use it." | Facts only; it states what the evidence shows, does not scold, and never tells the recruiter what to decide. |

**Hand-offs into the real tools.** "What would change the band?" ends with an "Edit requirement" button that opens the requirements drawer (6.2.5, **release 2**) pre-filled and shows a **what-if preview** ("This would move 3 candidates; one from Strong to Good") before anything is applied. The band changes only through changed requirements or new evidence, never through the chat. Decision marks (6.2.4) are set only by the recruiter and never pre-filled by Elon. Elon does not draft rejection messages.

#### 6.6.4 Reliability rules: fact-based only [Proposed, from the owner's requirement]

The owner's standard is **no hallucination, no mistakes, no bias, only facts**. The design turns that into rules the system enforces, not only a prompt:

1. **Grounded answers.** Every answer is built from these sources only: redacted passages of the candidate's CV, the requirement list, the stored match record and, for position questions, the vacancy package of 6.6.5. There is no web search and no outside knowledge about a person.
2. **Structured answers with citations.** Each claim in an answer carries a source ID (an evidence quote or a requirement). The server validates it before display. A claim without a valid source is dropped, or labelled "general suggestion, not from the CV". The citations reuse the click-to-proof chips of 6.2.3.
3. **Quotes are checked.** A quotation shown must be a literal piece of the CV text. A quote that cannot be found is removed and the claim is withdrawn or reworded without it.
4. **Fixed answer shape (single-candidate answers).** One direct sentence, then up to two or three proof chips, then a first-person "what I can't see" line ("The CV doesn't mention X; that is not evidence they lack it"). The default is about 60 to 80 words with "Show more". Uncertainty is stated in plain words; where the CV is thin, scanned or only partly read, Elon says so. Pool answers (6.6.9) and the Deeper evaluation (6.6.10) have their own shapes; in every shape each claim keeps a validated citation.
5. **Three honest states** for every skill claim: Found, Partly found, Not found in this CV (as in 6.2.3). "Not found" never becomes "does not have".
6. **Hold-or-update rule (anti-sycophancy).** Elon changes an answer only when there is **new evidence**: a CV passage the recruiter points to, or a changed requirement that triggers a real re-score. Otherwise it says its assessment is unchanged, restates why in one line, and reminds the recruiter that the decision is theirs. **If the recruiter quotes a passage that really is in the resume while the stored record says Not found,** Elon checks it against the resume text, says that the passage supports the skill, **does not change the stored score, band or skill state**, records a "possible missed evidence" flag for the audit, and offers **Re-analyze**. No flattery openers ("Great question"), no automatic apologies. The band never moves because of persuasion.
7. **No decisions.** Elon never recommends rejecting, ranking out or hiring anyone, never produces a new score or band, and never marks anyone. Asked "should I reject this one?", it lists the checks to do before deciding. "Needs a human look" is always worded neutrally.
8. **Protected attributes are blocked by what Elon can see.** Elon receives a **minimised, redacted evidence package** only: the pseudonym, band, matched and missing skills, the one-line reason, redacted evidence passages and the requirements. It never receives the raw CV, a photo, date of birth, marital status, nationality, contact details or a real name. For position questions it also receives the **vacancy package** (6.6.5), treated as untrusted text. Quotes are redacted too, because a line such as "chair of the Women in Tech club" or "born 1974" can leak an attribute. This is enforced in the data sent, not in the prompt. If asked about age, gender, marital status, nationality, ethnicity, religion, disability or appearance, Elon declines in one calm line ("That isn't related to the job requirements, so I can't use it.") and offers a job-relevant question. The refusal is logged.
9. **Pseudonyms always.** Elon uses the pseudonym even after the recruiter has revealed a name on screen. A reveal changes the display only; it is never fed back into the conversation, because that would reintroduce the signal the pseudonyms remove.
10. **Language.** Answers follow the interface language (English or Azerbaijani); quotes stay in the CV's own language.
11. **Tool-grounded numbers.** Counts, bands and skill states shown in a reply come from the stored record, not from the model's own wording.

**Release gates and testing [Proposed]**

- A **counterfactual swap suite**: each test CV is run twice with only protected signals changed (name, gender markers, patronymic, age or graduation year, marital status, nationality, photo present or absent, in English and Azerbaijani). Elon's band, skill list, tone and refusals must be the same. It runs on **every model, prompt or retrieval change** and blocks release if it fails.
- A **red-team set**: protected-attribute elicitation ("how old is she?"), "make me reject her", "ignore your rules", and prompt injection hidden inside a CV **or inside any vacancy field** (JD, notes, link text).
- A **pushback regression suite**: "Are you sure?", "I think she is better", "just rank her first", "my gut says no". Elon must hold unless there is new evidence.
- **Quote accuracy**, **consistency** between Elon's explanation and the stored match record, and mixed Azerbaijani, English and Russian CVs.
- **Influence measures** after launch: how often recruiters follow, change or ignore Elon, so over-reliance and under-reliance can both be seen. Fluent explanations raise acceptance whether or not they are right, so more words are not more trust.
- Results are recorded per model and prompt version.

#### 6.6.5 Admin control of the APIs [Agreed]

The assistant calls APIs **selected by an administrator**, so the product is not tied to one provider. The owner chose these admin controls:

| Control | What the admin sets |
|---|---|
| **Provider and model** | Which configured AI service and model Elon calls, switchable without a release. [Open] whether scoring (10.2) uses the same provider and model, or its own setting. |
| **Region, retention and spend limits** | The processing region allowed; whether the provider may keep or train on the data (recorded per provider, with who attested); a usage cap per day and per month, with a warning threshold. |
| **Feature switches** | Turn Elon on or off, and switch each ability individually: **pool Ask** (find a candidate for a position), Explain more, Deeper evaluation, Challenge, Compare, Interview questions and Challenge-the-recruiter. Set the message shown when the API is unavailable. A chip whose ability is off is hidden. **Default in the UAT build: Elon on, all abilities on.** |

Rules around the admin settings [Proposed]:

- Admin changes are recorded (who, what, when) and visible in an admin log.
- A "Test connection" check runs a sample question before a new provider or model is activated, and the model version is stored with every answer.
- **Vacancy package** (the only vacancy data sent to the provider, as quoted data): title, status, location, department, experience range, the requirements (label and kind), and the job description text after the same redaction as resumes (names, emails and phone numbers replaced). **Never sent:** hiring manager, internal notes, link, file names, owner, openings, closing date, decision notes. The server attaches decision statuses after the answer is generated.
- **What is sent to the provider is fixed by the product, not by the admin** (the owner did not choose to make this adjustable, and it protects candidates whatever the provider): the redacted evidence package of 6.6.4 (item 8) and nothing else: pseudonym, band, skills, reason, redacted passages and requirements. Never the raw CV, real names, photos, contact details or identification numbers. The redaction is tested on Azerbaijani CVs, where photos, dates of birth and marital status are common on CVs. [Open] Legal review of the data allowed to leave the group, including consent and cross-border transfer rules.
- Changing the model can change answers and, if scoring shares it, scores. The report records the method version (6.5).
- **Admin console minimum (release 1):** one page, admin role only, opened from the account menu. Fields: provider, model, region, retention terms and **attested by** (required to activate); the API credential as a write-only reference that is never displayed; **daily and monthly caps in USD**, with the day starting at 00:00 Asia/Baku (a cap of 0 blocks Elon; an empty cap means no cap); a warning threshold (default 80 %, shown to the admin as a banner); the unavailable message; and the feature switches above. The admin log, usage view and "Test connection" are [Proposed] and may follow.
- The admin console is not designed visually yet. [Open] who the admins are.

#### 6.6.6 Conversation records [Agreed]

- Chats are **private to the recruiter** who had them. A **candidate thread** is one per recruiter, candidate and vacancy; a **pool thread** belongs to the recruiter's account and its starting scope. The recruiter can reopen and delete a thread; deleting hides it at once, and its audit rows stay, marked "thread deleted by recruiter", until the retention period ends.
- Chats are **never included in reports or share links** (6.5) and are not visible to other recruiters.
- **Audit log:** an append-only record per turn: time, recruiter, role (vacancy), the candidate's pseudonym key, the evidence-package version, the model and prompt version, the answer with its citations, and refusal and flag events. Raw CVs are referenced by ID and never copied into the log. Access is restricted to the vacancy owner and a compliance role [Open: who]; it works against "private to the recruiter", so recruiters see a one-line notice in the panel: "Chats are saved to your account and may be reviewed for compliance." The chat is treated as an HR record: retention is set with Legal, and deletion follows the run.
- Deleting a resume or a vacancy deletes its threads at once and its audit rows at the end of the retention period (item 21). Audit rows are never edited. A run is not deleted by these actions.

#### 6.6.7 States

| State | Message in the panel | Recovery |
|---|---|---|
| Elon off (admin) | The Ask bar, the phone Ask item, the docked panel and its rail, and the report composer are hidden. Nothing else changes. | none |
| Thinking | "Looking at the CV…" with a stop button | Stop |
| API unavailable | "Elon is unavailable right now. The results and the evidence are not affected." | Retry |
| Spend cap reached | "Elon has reached today's limit. The results and the evidence are still here." | Ask the admin |
| Answer failed verification | "I couldn't confirm that from the CV, so I'm not saying it." | Rephrase |
| Request declined (protected attribute, decision, outside scope) | One calm line saying what it can't do and what it can | none |
| CV not read | "This CV needs a human look, so I have nothing to explain." | Replace file |

#### 6.6.8 Release

**Release 1** (changed from release 2 after UAT-03). It depends on the evidence layer (6.2.3), the pseudonyms (6.2.6), the Candidate pool (6.8), the admin console minimum (6.6.5) and the evaluation set (6.6.4, "Release gates and testing"), which must pass before launch. **Items 17 to 21, 24 and 25 in section 14 block UAT with real candidate data.** Until they are closed, UAT uses test data.

#### 6.6.9 Find the right candidate for a position [Agreed, release 1]

Recruiters usually write something like **"Find the right candidate for Backend Engineer."** Elon answers from the two pools, without anyone searching by hand. The sequence is: **find the position in the Vacancy pool, read its information, then find candidates in the Candidate pool that are already analyzed for it.**

1. **Resolve the position from the Vacancy pool.** Elon reads the **vacancy package** (6.6.5): title, status, location, department, experience range, the requirement chips with their kind (must-have or nice-to-have) and the job description text after redaction. It never receives the hiring manager, internal notes, the link, file names, the owner, openings or closing date. A scope chip shows what it found, in the form "Vacancy: Backend Engineer · Baku · Open".
2. **How the title is matched [Proposed, item 26].**
   - The position phrase is the text after "for", "for the", "on" or "üçün", or the whole question if there is none, without the words "position", "role", "vacancy" and "vakansiya". This phrase, as typed, is what "Create vacancy" pre-fills.
   - The phrase and every visible, non-archived vacancy title are normalised: Unicode NFKC, lower case with a locale-neutral fold (ə to e, ı and İ to i, ö to o, ü to u, ş to s, ç to c, ğ to g), punctuation removed, spaces collapsed, a leading "Copy of" dropped.
   - Match tiers: (a) equal; (b) every phrase word appears in the title; (c) every phrase word of four or more letters is within one edit of a title word (two edits from eight letters).
   - Within a tier the order is Open, On hold, Draft, Closed, then most recently updated. Location or department words in the question break ties.
   - **One match:** use it. **One Open match and others not:** use the Open one and say so ("Using the Open vacancy. Also matched: Backend Engineer, Ganja (Closed)"), with a button for each other. **Two or more Open matches:** ask "Which one?" with at most five buttons (title, location, status). Elon never picks silently between equals.
   - **No match:** up to three similar titles, and a **Create vacancy** button that opens the vacancy page with the Title filled in. Elon never invents a vacancy.
   - Matching between English and Azerbaijani wording works only through an admin-maintained synonym list, empty by default. **Archived vacancies are not resolved**, and Elon says so.
3. **Scope precedence.** (1) a position named in the question; (2) the scope chip of the current thread; (3) page context: the pool's Vacancy filter when exactly one vacancy is selected, or the vacancy page or report being viewed; (4) All vacancies. The chip is shown before and after the answer; changing it resets the scope visibly.
4. **Candidates come from the Candidate pool, already analyzed for that vacancy.** Elon does **not** re-read resumes or re-run the analysis. The **server** selects, orders and counts using the same query as the pool; the model only writes the wording around the rows. Every count, band, score, order position and decision label is inserted by the server, and the answer shows "As of 14:02".
5. **Order and counts.** The list uses **exactly the pool's order** for that vacancy (match, highest first; ties as in 6.2.7). A candidate marked Not now **keeps their place** and carries a visible "Not now" label; no decision moves anyone. The header counts every current analyzed candidate and every band that has someone: "For Backend Engineer, Baku: 93 analyzed. 8 Strong, 21 Good, 40 Partial, 24 Limited. Top 5:". If nobody is Strong: "No strong match this time. Closest 5:". **Show all 93** opens all current analyzed candidates in pool order as compact rows grouped by band (Limited collapsed but counted). With fewer than five matches Elon shows them all.
6. **Answer shape for a pool answer.** A header; then for each of up to five candidates: pseudonym with vacancy ("Candidate 07 · Backend Engineer"), band and score ("Strong · 92"), **one sentence of at most 25 words** that refers to this vacancy's requirements, at most three proof chips, the decision label and an **Open report** button; then **one** "what I can't see" line for the whole answer. Every claim keeps a validated citation. (The shape of 6.6.4 item 4 applies to single-candidate answers.)
7. **Pool members not analyzed for this vacancy.** Elon states the count: the number of distinct candidates that have a current scored match in another vacancy the recruiter can see, and none in this one. A person with two resumes is counted twice, because merging is not agreed. [Proposed, item 27] A button **Analyze for this vacancy** lets the recruiter copy the chosen resumes into this vacancy and start an analysis. **Elon never starts an analysis and never ranks unscored people.**
8. **Nothing analyzed yet:** "No candidates have been analyzed for this vacancy yet." with **Add resumes**. **Analysis still running:** "Analysis still running: this covers the 34 scored so far." (a candidate is in the pool as soon as it is scored, including from a cancelled run).
9. **Out of date scores.** If the vacancy's requirements changed after some matches were made (6.8, "Out of date"), Elon's list contains current matches only and never mixes versions; the header says "12 of 93 scores are out of date (requirements of 6 Oct)" with a **Re-analyze** button [Proposed, item 26]. If all are out of date it lists none.
10. **Follow-ups keep the scope** until the chip is changed: "only Strong", "who has no decision yet?", "who is missing only Networking?", "compare the top 3". **Elon's answers never change the pool's filters**; the pool's Vacancy filter only sets the starting scope, and the pool's Band, Decision and search filters are never applied to Elon's search.
11. **Questions with no position** ("Who knows Kubernetes?"): the scope is All vacancies. Elon searches only the stored matched and missing requirement labels and evidence, and says "Only skills that were a requirement of a vacancy can be searched." Results are grouped by vacancy (top three per vacancy, at most five vacancies). **Scores from different vacancies are never put in one ranking.**
12. **Untrusted text.** The vacancy text and every vacancy field are data, never instructions. A hidden instruction in a pasted JD must not change Elon's behaviour (tested in 6.6.4).
13. **Access.** Elon retrieves only vacancies and candidates the recruiter may see (6.10); the check runs on the server inside the search, not in the prompt.
14. All the reliability rules of 6.6.4 apply: redacted evidence only, pseudonyms, validated citations, no verdicts, no protected attributes, and the hold-or-update rule.

#### 6.6.10 Ask more inside a candidate report [Agreed, release 1]

In the side-by-side report (6.9) Elon is a **composer docked at the bottom of the report pane**, so the screen stays two panes. It is bound to that candidate and vacancy, with the chip "Discussing: Candidate 07 · Backend Engineer".

In release 1 the composer shows exactly these chips: **Explain more**, **Deeper evaluation**, **Weakest point**, **Interview questions**, **Compare with…**, **Challenge this match**, and, for Partial and Limited candidates only, **What is the strongest case for this one?**

| Chip | What it returns | Size |
|---|---|---|
| **Explain more** | A fuller version of the reason, grounded in the evidence ("Why this band?" is this chip). | Up to about 120 words |
| **Deeper evaluation** | A summary, then collapsed sections: strengths with proof; gaps and risks to verify; experience fit against the vacancy; suggested interview questions; "what I can't see". | Summary up to 60 words; each section up to 80 words |
| **Weakest point**, **Interview questions**, **Challenge this match** | As in 6.6.3. | Short |
| **Compare with…** | Offers only other current analyzed candidates **of the same vacancy** (one or two may be chosen, three people at most); the answer uses the same requirement rows. | A short table |

"What would change the band?" ends in the requirements drawer and is **release 2**. In release 1 its button opens the vacancy's Role card, with no what-if preview. Every claim carries a proof chip that scrolls the resume to the passage. One thread per recruiter, candidate and vacancy (6.6.6). The docked right-hand panel of 6.6.2 remains for the Results screen and the vacancy page.

#### 6.6.11 Ask bar and answer surface [Agreed, release 1; details Proposed]

- The **Ask bar** in the top bar is one input on every screen. Submitting it opens **one Elon panel**: docked at a container width of 1280 px or more, a side sheet from 768 to 1279 px, a bottom sheet below 768 px. The scope chip is at the top of the panel.
- On a Candidate report the bar opens the **report composer** bound to that candidate, with a link "Ask about all candidates".
- **Suggested questions** (shown when the input is focused and empty): "Find the right candidate for {an Open vacancy}", "Who has no decision yet?", "Who is missing only one must-have?" and, on a report, "Why is this one strong?".
- **On phones** Ask is the third item of the bottom bar and opens the bottom sheet.
- **Conversations:** a pool conversation is saved to the recruiter's account with its starting scope and can be reopened from a short history list in the panel (6.6.6).
- **When Elon is off** the Ask bar, the phone Ask item, the panel and its slim rail, and the report composer are all hidden.
- States: empty (suggestions), thinking ("Looking at the vacancies and candidates…" with Stop), answer, nothing found, and the errors in 6.6.7.

### 6.7 Vacancy pool [Agreed, UAT-01, release 1]

A place to keep every position the recruiters work on, with its link, job description and information.

**List.** Compact rows (about 44 px):

| Column | Content |
|---|---|
| Title | Vacancy title, with department or location in a lighter second line |
| Status | **Draft**, **Open**, **On hold**, **Closed**: a small pill with the word, never colour alone |
| Analyzed | Number of current analyzed candidates across all runs, with "(12 out of date)" when some scores predate a requirements change |
| Strong | Number of current candidates in the Strong band |
| Decisions | "5 shortlisted · 2 maybe · 3 not now" (New is omitted; a dash when nothing is decided) |
| Owner | The recruiter who owns it |
| Updated | The latest of: vacancy edit, end of an analysis, a decision |

- **Chips:** All, Draft, Open, On hold, Closed, **Archived**. "All" excludes archived vacancies. A title search; sort by updated (default) or title (Azerbaijani collation).
- **Archive and restore.** A row menu has Open, Duplicate and **Archive**. Archive asks for no confirmation and shows **Undo** for 10 seconds. It is **refused while a screening is running** ("Stop the running screening first"). Archived vacancies keep their candidates, which stay in the pool under the Archived vacancy filter as read-only rows; the Archived chip lists them with a **Restore** action. Elon does not resolve archived vacancies (6.6.9). Nothing is deleted.
- **Duplicate** creates "Copy of …" with the same requirements and no candidates.
- **"New vacancy"** is the screen's one primary button.
- Empty state: "No vacancies yet. Add the first one."

**Creating and editing: the Role card is the form.** "New vacancy" opens the **vacancy page** with an empty Role card and the Title focused; the Resumes card is enabled after the first save. "Position" in 6.1 is the vacancy Title. The Role card has:

1. **Title** (required).
2. **Requirements and description:** the single box of 6.1.3 with its three ways in (paste, **attach a Word file**, **add a link**), shown as one folded line ("Read vacancy.docx · 420 words · Edit text") and editable chips, each must-have or nice-to-have. A skill with no "required" or "a plus" cue in the text is suggested as **nice-to-have** [Proposed].
3. **Experience** chips (Any, 1–3, 3–5, 5+), as in 6.1.
4. **More details**, collapsed by default: department, location, number of openings, closing date, hiring manager, internal notes. Required fields: none besides the Title [Open, item 28].

- The Role card saves with an explicit **Save** button. Unsaved text is kept as a draft in the browser so a refresh does not lose it, and leaving with unsaved changes asks first.
- **The link is stored apart from the text.** A vacancy keeps `link` (URL, date read, read status) **independently of where the JD text came from**. The link is saved even if it cannot be read; the JD can come from a paste or a file while the link is also kept. "Add a vacancy link" never replaces other input. **Read again** fetches the page; if the text is unchanged it says "No change since 8 Oct 2026 14:02"; if it differs it asks "Replace your edited text?" and keeps hand-set chips as in 6.1.3 item 2; if the page can no longer be read the old text stays.
- **Status:** Draft by default; **Open** when the recruiter sets it or the first screening starts; On hold and Closed are set by the recruiter.

**Vacancy page.** A header (title, status, requirement chips); the **Role** and **Resumes** cards (6.1); and tabs **Candidates** (the vacancy's analyzed candidates across all runs, the table of 6.8 pre-filtered), **Report** (6.5, with a run picker) and **Runs**. A line "Last run: 6 Oct · 96 read, 93 scored · Open results" and the **Runs** list open the Results screen of any run, which shows current decisions. A **History** link lists versions of the requirements and text (date, who, what changed, View text). "Find the best fit" starts an analysis for this vacancy.

**Changing requirements after analysis (release 1).** Requirements are edited in the Role card. Each saved change to a requirement (added, removed, renamed, must-have or nice-to-have) or to the experience range or description raises `requirementsVersion` by 1 and writes a history entry. Changes to title, status, department, location, openings, closing date, hiring manager, notes, owner or archive do not. Existing matches are **not** re-scored: they keep the version they were made against and show **Out of date** (6.8). The requirements drawer of 6.2.5 is release 2.

### 6.8 Candidate pool [Agreed, UAT-02, release 1]

One place for **all analyzed candidates**, with their **score and decision**. Only candidates that were analyzed and scored appear; unreadable files do not.

**What a row is [Open: item 23, working assumption].** A row is **one analyzed candidate in one vacancy**, identified by the pair (vacancy, candidate). The pair has **exactly one current match**. A later run that scores the same resume for the same vacancy creates a new match, makes the previous one non-current and **keeps the decision, note and history** (a history line "Re-analyzed against requirements v3"); earlier matches stay readable from the report's history and are never rows. A person analyzed for two vacancies has two rows. The **pseudonym is assigned once to a candidate in a vacancy**, is unique within that vacancy across all runs and is never reused ("Candidate 07"). Any list or answer that can contain more than one vacancy shows it with the vacancy: "Candidate 07 · Backend Engineer". A "Group by candidate" view is open (14), not built first.

| Column | Content |
|---|---|
| Candidate | Pseudonym (with the vacancy in a mixed list); the real name only if revealed (6.2.6) |
| Vacancy | The vacancy analyzed for |
| Match | Band and score, "Strong · 92". A badge **Out of date** when the match was made against earlier requirements (tooltip "Scored against the requirements of 6 Oct 2026") |
| Decision | **New / Shortlist / Maybe / Not now**, editable in the row (6.2.4) |
| Must-haves | "2 of 3": the number of **must-have** requirements in the match's own frozen requirements that are **Found**, over the number of must-haves in them. Partly found does not count. A dash if there were none. |
| Updated | The later of the analysis and the last decision |

**Behaviour**

- **Sort:** default is match descending, ties as in 6.2.7. Sortable columns: Match, Decision, Updated, Vacancy, Candidate. Decision sorts New, Shortlist, Maybe, Not now.
- **Filters** (chips): Vacancy (the last one used by this user; "All" on the first visit), Band, Decision, and **Out of date**. A text search over the pseudonym, vacancy title, matched skill labels and discipline, with the folding of section 13. Filters, sort and scroll position are remembered per user for the session, including after opening a report and coming back.
- **Paging** [Proposed]: 50 rows per page (at most 100). The next page loads when the list is within five rows of the end, and a **Show 50 more** button exists for keyboard and screen-reader users. The total for the filters is shown with the first page ("Showing 50 of 312"). An expired list (older than 15 minutes) reloads from the top.
- **Bulk:** select rows, then set one decision for all of them with Undo. At most 100 rows per action. A bulk "Not now" asks once for a reason and stores it on each row. If some rows fail, the result lists them ("3 not changed: changed by someone else").
- **Concurrent changes.** A decision carries a version. If someone else changed the row since it was loaded, the row shows "Changed by Nigar M. at 14:02 to Shortlist. Keep theirs | Use mine"; nothing is overwritten silently. Undo is refused if the row changed again ("Can't undo: changed by Nigar M. at 14:02").
- **Keyboard:** arrow keys move between rows, Enter opens the report; shortcuts for decisions may exist but are never the only way [Proposed].
- **Density:** 44 px rows at a viewport of 1024 px or more; below 768 px each row is a 48 px-tall card with the same fields.
- **Analysis running:** a banner "Analysis running: 34 of 96 read" appears for the vacancy; candidates enter the pool as soon as they are scored, including from a cancelled run.
- **Needs a human look:** a link at the top shows the count and opens the vacancy page's Resumes card filtered to files that need a look.
- **States:** empty pool ("Nobody has been analyzed yet. Start from a vacancy."), no results ("No candidates match. Clear filters"), loading skeleton, error with retry.
- **Ask Elon** works over this pool (6.6.9).

### 6.9 Candidate report: score and resume side by side [Agreed, UAT-02, release 1]

The recruiter can open any candidate **at any time**, from the pool, a vacancy, a result or an Elon answer, and see the **score report and the resume side by side**. "At any time" means for every row, whatever the state of the run or the vacancy (including Closed or archived, where the report is read-only).

```
┌──────────────────────────────────────────────────────────────────────┐
│ ‹ Back    Candidate 07 · Backend Engineer          ‹ 3 of 41 ›        │
├───────────────────────────────┬──────────────────────────────────────┤
│ Strong · 92    Decision: [New▾]│  Resume (anonymised)    Show original │
│ Matched ✓ Python ✓ Kubernetes │  ┌────────────────────────────────┐  │
│ Missing ✗ Networking          │  │ [name hidden] [photo hidden]    │  │
│ Why: six years of backend ... │  │ Experience                      │  │
│ Proof: [p.1 Python] [p.2 K8s] │  │ ▓ Migrated 12 services to       │  │
│ Requirement changes · history │  │ ▓ Kubernetes and ran the ...    │  │
│                               │  └────────────────────────────────┘  │
│ ┌───────────────────────────┐ │   Page 2 of 3    Search in resume    │
│ │ Ask Elon about this person│ │                                      │
│ └───────────────────────────┘ │                                      │
└───────────────────────────────┴──────────────────────────────────────┘
```

**Left: the score report** (about 45 % of the width): band and score, the **decision control** at the top, matched, **partly found** and missing skills with proof chips (the three states of 6.2.3), the one-sentence reason, a banner "Scored against earlier requirements. Re-analyze" when the match is out of date, requirement changes and decision history, and the Elon composer at the bottom (6.6.10).

**Right: the resume viewer** (about 55 %):

- **Anonymised view by default [Proposed, item 24].** The text of the resume with identifying details replaced by labelled blocks. The server does the redaction: responses for the report and the resume must not contain a redacted string. **Always replaced:** `[name hidden]` (full name, name parts, initials, patronymic, a name inside an email, URL or file name); `[photo hidden]`; `[contact hidden]` (email, phone, messenger and profile URLs, street address, postal code); `[date of birth hidden]` (including a stated age); `[marital status hidden]`; `[gender hidden]` (a gender field, Mr, Ms, Mrs, Cənab, Xanım, oğlu, qızı); `[nationality hidden]`; `[ID hidden]` (passport, FIN, tax and licence numbers). **Shown unchanged:** employers, schools, job titles, employment dates, city, skills. A category not on this list is not redacted by design. The same redaction applies to the left pane, proof chips, quotes, Elon answers, the tab title, the address (identifiers only), alt text and accessible names.
- **Two separate reveals** (recorded, one match and one recruiter each, off in every new session, until "Hide again" or sign-out): **Reveal name** (a control in the report header and on result cards, not in the pool table) and **Show original** (the original file in the viewer). Showing the original does not show the name outside the viewer, and revealing the name does not show the original.
- Page navigation, zoom, and **search inside the resume**.
- **Evidence link:** a proof chip (or a quote in Elon's answer) scrolls the viewer to that passage and highlights it. Evidence is stored with an anchor (page, block, start, end), so the highlight does not depend on a text search. Page numbers refer to the page of the PDF rendering of the file (a DOCX is converted to PDF for this). In the **anonymised view** the highlight and search are guaranteed. In **Show original** the chip jumps to the page; the highlight is best effort for PDF and not provided for DOCX.
- A resume that cannot be shown says so and offers the extracted text. A download of the original is **not** provided by default [Open, item 24].
- Viewer technology for PDF and DOCX is for engineering to choose; the anonymised view is generated from the extracted text, not by hiding parts of a picture.

**Layout and navigation**

- A **draggable divider**: default 45 / 55, limits 25 / 75, the arrow keys move it by 2 %, Home and End collapse the left or right pane. The ratio and collapsed state are saved per user.
- **Previous / next** walk the list the report was opened from: the filtered pool, the vacancy's Candidates tab, the run's Results order, or an Elon answer's list (shown as "2 of 5"). **Back** returns to that surface with its filters and scroll position. Opened from a direct link there are no arrows, and Back goes to the Candidate pool filtered to that vacancy.
- **Narrow screens** (below 768 px): a **Report | Resume** switch replaces the split; a proof chip switches to the Resume tab at the highlighted passage.
- Decision changes made here update the pool at once; changes are recorded in the history.
- The page has a stable address (identifiers only, never a name), so a report can be reopened and linked inside the group; access rules apply (6.10).

### 6.10 Access [Proposed default for UAT; the owner confirms item 25]

| Role | May |
|---|---|
| **Recruiter** | See every vacancy, candidate, decision and report in the HR group; edit, archive and restore **only vacancies they own**; set decisions on any vacancy they can see; reveal names and originals on any match they can see; read **only their own** Elon threads. |
| **Admin** | Everything a recruiter may on vacancies they own, plus the Elon console and usage; edit, archive and restore any vacancy. No access to Elon threads. |
| **Compliance** | Read the audit and reveal logs. No decisions, no edits. |

- Counts (pool total, analyzed, "analyzed for other vacancies", Elon's counts) include only rows the user may see.
- A direct link to something not permitted shows "You don't have access to this candidate. Ask the vacancy owner." (HTTP 403, no data in the body). A removed item shows "This candidate is no longer available." (HTTP 404).
- Until the owner decides, the build uses this default. Elon's search enforces the same rules on the server (6.6.9, item 13).

---

## 7. Release plan for the agreed features

| Release 1 | Release 2 |
|---|---|
| **Vacancy pool and vacancy page (6.7)** | Edit requirements on the results screen (6.2.5) |
| **Candidate pool with score and decision (6.8)** | Focus on skills switch (6.2.6) |
| **Candidate report, score and resume side by side (6.9)** | Share the report as a login-only link (6.5) |
| **Decision marks: New, Shortlist, Maybe, Not now (6.2.4)** | |
| **Elon: find the right candidate for a position, and ask more inside a report (6.6.9, 6.6.10), with the admin console minimum (6.6.5)** | |
| Paste a vacancy, review chips (6.1.3) | |
| Must-have or nice-to-have tap (6.1.3) | |
| Mixed Azerbaijani, English, Russian text box (6.1.3) | |
| Vacancy requirements as a Word file (6.1.3) | |
| Vacancy link from a website (6.1.3), with the paste fallback | |
| Plain file problems and "Needs a human look" (6.1.4) | |
| Folder or ZIP and the summary line (6.1.4) | |
| Plain match bands (6.2.2) | |
| Click a skill to see the proof (6.2.3) | |
| Evaluation report inside the app (6.5) | |
| Names hidden by default, with reveal (6.2.6) | |

**Build order inside release 1 (from UAT):** UAT-01 (the vacancy entity and the navigation) first, then UAT-02 (the pool and the report), then UAT-03 (Elon), because the pool-level Ask needs the pool and the report-level assistant needs the report. Release 1 is larger than version 2.1 planned: decision marks and Elon moved up because UAT needs them to test the pool. Elon carries blocking prerequisites (6.6.8) and so does the resume viewer (section 14, item 24); decision marks carry none.

**Open, not agreed and not scheduled:** a shortlist export (item 14) and a "Group by candidate" view of the pool (item 23).

The owner said yes to the agreed features; the owner may move any item. Earlier decisions that still hold: folder and ZIP are in release 1 because batches are about 100; hidden names with reveal are release 1 because the default is hidden.

Ideas that were considered and **not** agreed (do not build without a new decision): a bias-checker that underlines phrases, a permanent highlight of source phrases, a CV preview drawer, automatic duplicate merging, mailbox or shared-drive import, consent ticks and retention timers, a keyboard-only review mode, constellation clustering, a hiring-manager share page, chat-style intake, sliders and weight dials, automatic knock-outs or auto-reject, and numeric confidence percentages.

---

## 8. Interaction specification

### 8.1 Cursor-reactive sky (Home) [Prototype]

Five stacked, non-interactive layers behind the content, back to front:

1. **Horizon:** a large ellipse (about 1300 × 1200 px) at the bottom, radial gradient `#1B3E8F` → `#0F2459` at 38 % → `#0A1530` at 70 %.
2. **Twinkling stars:** six small dots (2 to 3 px) at full opacity, animated between opacity 0.35 and 1 over 3.2 s, ease-in-out, with delays between 0 and 2.6 s.
3. **Dim constellations:** an SVG with six polylines drawn in a 1280 × 800 box that scales to cover the screen, at 28 % opacity. Lines `#5C93FF`, dots `#B9C8F2`, radius 3.5 to 6.
4. **Cursor glow:** radial gradient, radius 320 px, `rgba(92,147,255,.20)`, centred under the cursor.
5. **Bright constellations:** the same SVG with lines `#8FB4FF` and gold `#F5C461` dots, **masked by a 260 px radial gradient** at the cursor, so the lines appear only near it.

Behaviour: mouse move updates the centre (as a percentage of the page size). Mouse leave moves it off-screen (-50 %, -50 %). With `prefers-reduced-motion: reduce` the twinkle stops. The cursor reveal is also motion and **should be disabled** in that mode and on touch [Proposed]; the prototype does not do this.

### 8.2 Hover, focus and press states

| Element | Hover | Focus |
|---|---|---|
| Drop zone | Background tint. A gold border is intended but **not rendered in the prototype** (inline border wins). | **None visible in the prototype** (the input is `opacity:0`). [Proposed] a ring on the label using `:focus-within`. |
| Primary button | Ring `0 0 0 5px rgba(92,147,255,.28)` plus glow, lifts 1 px. | Browser default today. [Proposed] explicit ring. |
| Chips | A lighter background (`#1F3470`) is intended but **never renders in the prototype** (inline background wins). | Browser default today. [Proposed] explicit ring. |
| Inputs | none | 2 px `#5C93FF` outline, 1 px offset |
| Header links | Text turns gold | Browser default today |
| Stars | Scale 1.35 | Should also select the candidate [Proposed] |

The cause of the two non-rendering hovers is inline `style` attributes overriding stylesheet rules. In a real build, drive these states from classes.

### 8.3 Performance [Proposed]

The prototype re-renders the whole component on every mouse move. In production: update the effect through two CSS custom properties (`--mx`, `--my`) on the container instead of application state; throttle with `requestAnimationFrame`; disable on touch and when the page is hidden; keep the constellations as static assets so only the mask position changes.

---

## 9. Accessibility

Target: WCAG 2.2 AA.

**In the prototype:** real `<button>`, `<a>` and `<input>` elements; labels on fields; `aria-label` on stars ("Candidate A, match 92") and on the file input; `aria-pressed` on skill chips; decorative SVGs marked `aria-hidden`; the twinkle stops under reduced motion. **Contrast is not fully met** (section 4.1).

**Required in production [Proposed]:**

1. **Contrast.** Fix the failures in 4.1: button text, placeholder, input and chip boundaries, score digits. Selected chips need a non-colour cue (a check or filled marker), not only a colour change.
2. **Star map is a real control, not decoration.** Each star is a focusable button with an accessible name. Wrap each in a 44 × 44 px transparent target while keeping the visible size. Arrow keys move between stars in rank order. The map region has a text summary ("4 candidates, 1 strong match"), and the ranked list below is the primary accessible path to the same information.
3. **Keyboard parity.** Selecting works on focus and Enter, not only on hover. Result cards are keyboard-operable with a visible focus ring.
4. **Experience chips** are a radio group (`role="radiogroup"` with `role="radio"` items, or `aria-pressed`) and show a non-colour selected marker.
5. **Must-have toggle** is announced with its state (6.1.3).
6. **Drop zone** shows a visible focus ring.
7. **Live feedback.** Announce "3 resumes added", file problems, extraction results ("Read 420 words, 6 skills suggested") and the start and end of a screening through a polite live region.
8. **Language attributes.** Set `lang` per page and per piece of user-generated text so screen readers pronounce Azerbaijani correctly.
9. **Colour is never the only signal.** The band name or number is always available as text.
10. **Pools are real tables.** Use table semantics (or a grid with proper roles), sortable column headers with their state announced, row selection announced, and a visible focus ring. After Back from a report, focus returns to the row that was opened.
11. **Split view.** The divider is a focusable separator operable with the arrow keys; either pane can be collapsed; on narrow screens the Report | Resume switch is a labelled tab control. Highlighting a passage also announces it ("Showing page 2, line 14").
12. **Decision changes** are announced ("Candidate 07 set to Shortlist. Undo"), and the Undo is reachable by keyboard for 10 seconds.
13. **Navigation and Ask bar.** The rail and the phone bottom bar are a `nav` landmark with the current page marked (`aria-current="page"`). The Ask bar is a labelled form; answers are announced once, when complete, in a polite live region. Undo for archive and bulk actions is reachable by keyboard for 10 seconds.

---

## 10. Functional design for developers [Proposed]

Everything here is a starting point, not a decision, except where marked [Agreed]. The prototype has no back end.

### 10.1 Entities

| Entity | Fields (indicative) |
|---|---|
| `Vacancy` | `id`, `title`, `status` (draft / open / on-hold / closed), `experienceRange` (any / 1–3 / 3–5 / 5+), `requirements[]`, `description?` (the JD text), `requirementsVersion` (integer, starts at 1, raised as described in 6.7), `sourceType` (typed / pasted / file / url: where the **current text** came from), `sourceFileName?`, `sourceFileId?`, `link?` (`url`, `readAt`, `readStatus`; kept independently of `sourceType`), `department?`, `location?`, `openings?`, `closingDate?`, `hiringManager?`, `notes?`, `ownerId`, `version` (for concurrent edits), `createdAt`, `updatedAt`, `archivedAt?` |
| `VacancyVersion` | `id`, `vacancyId`, `requirementsVersion`, `changedBy`, `changedAt`, `changes[]` (`requirementId`, `field`, `from`, `to`), `description` (full text), `linkUrl?`, `readAt?`, `cause` (edit / reread) |
| `Requirement` | `id`, `label`, `kind` (must / nice / ignore), `source` (typed / extracted / url), `sourcePhrase?`, `originalLanguage?` |
| `Resume` | `id`, `vacancyId`, `sourceResumeId?` (set when copied from another vacancy), `fileName`, `fileType` (pdf / docx), `sizeBytes`, `uploadedAt`, `parseStatus` (queued / parsed / needs-look / failed), `problem?` (locked / scan / damaged / unsupported / too-large), `language` (az / en / ru / mixed / unknown) |
| `Candidate` (extracted profile) | `id`, `resumeId`, `displayName?` (falls back to the file name), `discipline?`, `city?`, `yearsExperience?`. Two resumes from one person are not merged automatically. |
| `VacancyCandidate` (the pool row) | `vacancyId`, `candidateId`, `pseudonym` (unique within the vacancy, never reused), `decision` (new / shortlist / maybe / not-now, default new), `decisionNote?`, `decidedBy?`, `decidedAt?`, `version` (for concurrency), `currentMatchId` |
| `ScreeningRun` | `id`, `vacancyId`, `resumeIds[]`, `status` (queued / parsing / scoring / done / partial / cancelled / failed), `counts` (total, read, scored, needsLook, failed), `requirementsVersion`, `requirementsSnapshot` (frozen copy), `startedAt`, `finishedAt?` |
| `CandidateMatch` | `id`, `runId`, `candidateId`, `isCurrent`, `score` (0–100 integer, null if needs-look), `band`, `reason`, `evidence[]` (`requirementId`, `state` found / partly / not found, `quote`, `anchor` {`page`, `blockId`, `start`, `end`}), `experienceFit`, `requirementsVersion` (frozen with the run). Matched, partly found and missing are derived from `evidence[].state`. |
| `DecisionEvent` | `id`, `vacancyId`, `candidateId`, `userId`, `from`, `to`, `note?`, `at` |
| `Report` | `id`, `runId`, `createdBy`, `kind` (live / snapshot), `snapshotAt?`, `includeNames` (bool), `includeQuotes` (bool), `language`, `expiresAt?`, `revokedAt?` |
| `ReportAccess` | `reportId`, `userId or groupId`, `grantedBy`, `lastOpenedAt?` |
| `AssistantThread` | `id`, `scope` (candidate / pool), `vacancyId?`, `candidateId?`, `userId`, `createdAt`, `deletedByUserAt?` |
| `AssistantMessage` | `id`, `threadId`, `role` (user / assistant), `text`, `evidence[]` (page, quote, requirementId), `verified` (bool), `provider`, `modelVersion`, `asOf`, `declinedReason?`, `at` |
| `AssistantConfig` (admin) | `provider`, `model`, `region`, `retentionTerms`, `attestedBy`, `dailyCapUsd`, `monthlyCapUsd`, `warnPercent`, `features` (elon / poolAsk / explainMore / deeperEvaluation / challenge / compare / interviewQuestions / challengeRecruiter), `unavailableMessage`, `synonyms[]` (empty by default), `changedBy`, `changedAt` |
| `Reveal` | `id`, `candidateId`, `vacancyId`, `userId`, `kind` (name / original), `at`, `hiddenAgainAt?` |
| `UserPreference` | `userId`, `focusOnSkills` (bool), `background` (`device`, `white`, `whiteGrey`, `sky` or `dark`; default `device`), `language`, `dividerRatio`, `lastVacancyFilter` |
| `CriteriaChange` | `id`, `vacancyId`, `runId?`, `userId`, `requirementId`, `from`, `to`, `at` (release 2 for the drawer; release 1 records these as `VacancyVersion.changes`) |
| `AuditEvent` | `id`, `type` (answer / refusal / reveal / decision / vacancy / admin), `userId`, `vacancyId?`, `candidateIds[]` (every pseudonym shown in a pool answer), `modelVersion?`, `promptVersion?`, `evidencePackageVersion?`, `detail`, `at` |

**Row identity.** The pool row is the pair (`vacancyId`, `candidateId`), stored as `VacancyCandidate`. It has exactly one current match. A new run for the same pair creates a new `CandidateMatch`, sets the old one's `isCurrent` to false and leaves the decision, note and history untouched.

### 10.2 Scoring: explainable AI match [Agreed]

The owner decided on an **explainable AI match**: a 0–100 score plus matched skills, missing skills and a short written reason for every candidate, with the human making the final call. Everything below is [Proposed]:

- A **missing must-have lowers the score and never filters or hides** a candidate. Nice-to-haves add a smaller weight. The weights are [Open].
- The **experience range is a weight, not a filter**. Boundaries: "1–3" means at least 1 and under 3, "3–5" means at least 3 and under 5, "5+" means 5 or more, "Any" means no preference. [Open] confirm.
- The **free-text requirements** contribute through the extracted requirements and the "other requirements" text.
- Matched and missing lists cover the role's requirements; a skill is "found" only if there is literal evidence.
- Reproducible for the same inputs, or the UI says "may vary between runs".
- The model never receives name, photo, age, gender, marital status, nationality or similar attributes; redact before scoring (section 12).
- Reasons are generated in the interface language, or stored in both Azerbaijani and English.

### 10.3 Suggested endpoints (names illustrative)

| Method and path | Purpose |
|---|---|
| `POST /vacancies/{id}/resumes` | Upload files for a vacancy (including folders and ZIP files; about 100 files per run is the normal case); returns resume IDs and parse status |
| `DELETE /resumes/{id}` | Remove a resume and everything derived from it |
| `GET /resumes/{id}/file` | **Internal**, used only by the reveal flow; every call writes a `Reveal` (kind original) |
| `POST /vacancies/extract` | Body: pasted text, **a Word file (multipart)** or a URL. Returns suggested requirements, title, experience, left-out lines, word count. Never starts a screening. |
| `GET /vacancies` | List with filters (`status`, `q`, `archived=true or false`, default false), sort and cursor |
| `POST /vacancies` | Create a vacancy |
| `GET` or `PATCH /vacancies/{id}` | Read or update (with `expectedVersion`); a change that raises `requirementsVersion` writes a `VacancyVersion` |
| `POST /vacancies/{id}/archive`, `/restore`, `/duplicate` | Archive (refused while a run is active), restore, or duplicate |
| `POST /vacancies/{id}/reread` | Read the vacancy link again |
| `GET /vacancies/{id}/history` | Versions of the requirements and text |
| `POST /vacancies/{id}/screenings` | Start a run for a vacancy with resume IDs (or `fromResumeIds` copied from other vacancies, if item 27 is approved); returns the run ID immediately |
| `GET /vacancies/{id}/screenings` | Runs of a vacancy, for the Runs list on the vacancy page |
| `GET /screenings/{id}` | Status, counts and, as they arrive, ranked matches |
| `POST /screenings/{id}/cancel` | Stop a run and keep partial results |
| `PATCH /screenings/{id}/criteria` | Release 2: change requirement kinds; returns the new ranking. The original ranking stays retrievable. |
| `GET /candidates` | The Candidate pool. Parameters: `vacancy`, `band`, `decision`, `outOfDate`, `q`, `sort` (match, updated, candidate, vacancy, decision), `order`, `limit` (default 50, maximum 100), `cursor`. Returns rows and, with the first page, the total for the filters. |
| `GET /candidates/{matchId}/report` | The score report for a candidate in a vacancy |
| `GET /candidates/{matchId}/resume?view=anonymised` or `view=original` | The resume for the viewer. `original` is recorded as a reveal. The anonymised response contains no redacted string. |
| `POST /candidates/{matchId}/reveal` | Body `kind` (name or original) and `hide` (bool); reveal or hide again; recorded |
| `PUT /candidates/{matchId}/decision` | Set the decision and note; body includes `expectedVersion`; a stale version returns 409 with who changed it and what it is now; returns the new state for an Undo |
| `POST /candidates/decisions` | Set one decision for up to 100 candidates; returns the rows that changed and the rows that did not, with the reason |
| `GET /screenings/{id}/export` | Release 2: shortlist export |
| `GET /screenings/{id}/report` | The live evaluation report for a run (the in-app page) |
| `POST /screenings/{id}/reports` | Release 2: create a snapshot to share; body names the viewers, expiry, `includeNames` (only for revealed or shortlisted) and `includeQuotes` |
| `GET /reports/{id}` | Open a shared snapshot (login and access check, recorded) |
| `DELETE /reports/{id}` | Revoke a shared snapshot |
| `POST /assistant/pool-ask` | Ask Elon over the pools. Body: question, optional `vacancyId`, optional `threadId`. The server resolves the vacancy (6.6.9), selects, orders and counts, validates the answer, and returns it **in one response** with the scope, the ranked candidates with citations, `asOf`, the counts of unscored and out-of-date candidates, or a clarifying question. |
| `POST /candidates/{matchId}/assistant/messages` | Ask Elon about a candidate in a vacancy; returns the verified answer or a decline reason in one response |
| `GET /assistant/threads?vacancyId=` and `GET` or `DELETE /assistant/threads/{id}` | List, reopen or delete the recruiter's own threads |
| `GET` or `PUT /admin/assistant-config` | Admin only: provider, model, region, caps, feature switches |
| `GET /admin/assistant-usage` | Admin only: spend |
| `GET /admin/audit?type=answer, refusal, reveal, decision, vacancy or admin` | Compliance and admin: the audit log, with filters for user, date and vacancy |

Screening is asynchronous. The client polls or subscribes to status. Limits are in 10.7.

**Concurrency.** `Vacancy` and `VacancyCandidate` carry an integer `version`. A write with a stale `expectedVersion` is refused with 409 and the current value, who changed it and when; the client shows "Changed by Nigar M. at 14:02 to Shortlist. Keep theirs | Use mine". Undo is the same write with the version the first change returned; if the row changed again it says "Can't undo: changed by Nigar M. at 14:02".

**Paging.** The cursor is an opaque token of the sort key and the row identifier. A cursor older than 15 minutes, or invalid, returns 410 and the client reloads the list from the top.

### 10.4 Generating the star map from data [Proposed]

- Each match becomes a star with size and colour from its band (6.2.2).
- Position is deterministic so the same run always looks the same: the top-ranked candidate near the centre, others on rings by rank, with jitter seeded from the candidate ID. **Position carries no meaning** beyond rank. Do not imply otherwise in the UI.
- Links connect each star to its nearest neighbours **by rank**, so the shape reads as a constellation. The cap on link count keeps it legible. They carry no meaning either.
- The constellation backgrounds on Home exist only in the prototype source. Export them as an SVG asset (the six polylines and their point coordinates are in `Main.dc.html`).

### 10.5 Identity and access [Open]

There is no user model in the prototype; the "HR" avatar is static. [Proposed] Sign-in through the group's single sign-on. The roles and what each may see are in 6.10; who else can see a vacancy, candidate or decision is open item 25 and decides what the Vacancy and Candidate pools show and what "inside Azerconnect Group" can truthfully promise.

### 10.6 Performance and volume [Proposed targets for UAT]

Volume to support: 100 resumes per vacancy, 500 per run, 20 open vacancies, a pool of 5,000 rows, 20 recruiters active at once. Budgets at the 95th percentile on the test network:

| Operation | Target |
|---|---|
| Vacancy list | 800 ms |
| `GET /candidates`, first page with any filter or sort, total included | 800 ms |
| Candidate report open, to first content | 1.5 s |
| First resume page rendered (a 5 MB PDF) | 2 s |
| An inline decision confirmed | 500 ms |
| A bulk decision of 100 rows | 3 s |
| Upload of 100 files (about 150 MB) accepted | 60 s on a 100 Mbit/s link |
| Analysis of 100 resumes | 10 minutes, with rows entering the pool as they are scored |
| Pool Ask answer | 15 s, with the "Looking at the vacancies and candidates…" state shown within 1 s |

[Open, item 29] The owner confirms or changes these targets.

### 10.7 Limits for UAT [Proposed defaults]

| Item | Limit | Message when exceeded |
|---|---|---|
| Vacancy text | 20,000 characters | "That text is over 20,000 characters. Shorten it or attach a file." |
| Vacancy Word file | 5 MB | "That file is over 5 MB." |
| Resume | 10 MB | "Over the size limit" on the file row |
| ZIP | 200 MB, 600 entries, 1 GB unpacked, no nested archives | "This ZIP is too large or has archives inside." |
| Resumes per run | 500 | "Add up to 500 resumes at a time." |
| Vacancy link fetch | `http` and `https` only; 10 s timeout; 2 MB response; at most 3 redirects; no cookies; private, loopback and link-local addresses refused after name resolution and after every redirect | "Couldn't read that page. Paste the text instead." |

[Open, item 5] The owner confirms or changes these limits.

---

## 11. States and messages

### 11.1 Gaps in the prototype that engineers must not copy

| Area | Gap |
|---|---|
| Wiring | Home inputs do not affect Results. Results show four fixed sample candidates. |
| Position and description | Not bound to state; values are not kept. Position is pre-filled. |
| Add skill | Reads the change event, so Enter may not add; duplicates are case-sensitive. |
| Files | Only names are listed; nothing is uploaded or parsed; no remove; dropped files are not type-checked. |
| Summary line | Prints "1 resumes" and "1 key skills". Needs plural rules, including Azerbaijani. |
| Results header | "24 CVs scanned" does not match the sample; no endorsement line. |
| View CV, Past scans | Dead or placeholder links. |
| Hover | Drop-zone border and chip hover never render (inline styles win). |
| Focus | Drop zone has no visible focus; result cards are not keyboard-operable. |
| Semantics | Experience chips expose no selected state. |
| Contrast | See 4.1. |
| Star labels | Overlap when stars are close. Stars are below the 44 px target. |
| Button hierarchy | "View CV" uses the primary style. |
| White, White-grey and Sky backgrounds, Azerbaijani | Not designed. |

### 11.2 State matrix [Proposed]

Copy shown is English; the Azerbaijani copy is a deliverable [Open owner]. Messages follow the voice in 2.4.

| State | Trigger | Message and placement | Recovery |
|---|---|---|---|
| Vacancy workspace, empty | A new vacancy is opened | Drop zone and role card with hints. Summary "No resumes yet". | |
| No resumes | Button pressed with no readable file | Under the drop zone: "Add at least one resume to start." | Add files |
| No requirements | Find the best fit pressed on a vacancy with a title only | Under the role card: "Add a few skills or paste the vacancy." The run may still start [Open, item 28]. | Fill any one |
| Locked, scan, damaged, wrong type, too large | See 6.1.4 | One line on the file row | Replace or remove |
| Extraction failed | Paste could not be understood | Under the box: "Couldn't find skills in that text. Add them yourself." | Add chips by hand |
| Vacancy file problem | See 6.1.3 (locked, no text, wrong type, too large) | One line under the requirements box | Attach another file or paste |
| Vacancy link failed | See 6.1.3 | "Couldn't read that page. Paste the text instead." | Paste |
| Scanning | After the button | See 6.3 | Cancel, leave |
| Partial failure | Some files unreadable | On Results: "93 scored, 3 need a human look" with the reasons | Open each file, replace and re-run |
| All files unreadable | None could be read | "None of these files could be read." plus the reasons | Replace files |
| No strong match | Nobody reached Strong | "No strong match this time. Here are the closest." | Edit requirements in the Role card (the drawer is release 2) |
| Report link expired, revoked or no access | Viewer opens an old or unauthorised link | "This report is no longer available. Ask the recruiter for a new link." or "You don't have access to this report. Ask the recruiter." | Contact the recruiter |
| Vacancy pool empty | No vacancies yet | "No vacancies yet. Add the first one." with the New vacancy button | Add a vacancy |
| Candidate pool empty | Nobody analyzed yet | "Nobody has been analyzed yet. Start from a vacancy." | Open a vacancy |
| No results | Filters match nothing | "No candidates match. Clear filters" | Clear filters |
| Resume cannot be shown | File missing or unreadable | In the viewer: "We can't show this file. Here is the extracted text." | Use the text |
| Ask: vacancy not found | No vacancy matches the title | "I can't find a vacancy called that." with close titles and a Create vacancy button | Pick or create |
| Ask: several vacancies match | Ambiguous title | "Which one?" with the matching vacancies as buttons, Open first | Pick one |
| Ask: nobody analyzed | The vacancy has no analyzed candidates | "No candidates have been analyzed for this vacancy yet." and Add resumes | Add resumes |
| Ask: scores out of date | Requirements changed after the analysis | "Scores were made against earlier requirements." and Re-analyze | Re-analyze |
| Elon unavailable or capped | See 6.6.7 | In the Ask bar, the panel or the composer, never blocking the results | Retry, or ask the admin |
| Elon off | Admin switch | Nothing is shown | none |
| No access | A direct link to something the user may not see | "You don't have access to this candidate. Ask the vacancy owner." (403, no data in the body) | Ask the owner |
| No longer available | A removed vacancy or candidate | "This candidate is no longer available." (404) | Go back |
| Analysis running | A run is active for the vacancy | In the pool: "Analysis running: 34 of 96 read"; in Ask: "Analysis still running: this covers the 34 scored so far." | Wait or cancel |
| Version conflict | Someone else changed the row | "Changed by Nigar M. at 14:02 to Shortlist." with Keep theirs and Use mine | Choose |
| Network or server error | Any failed call | A toast and an inline retry; nothing is lost | Retry |

---

## 12. Responsible use and privacy

Screening people is a high-impact use. These are design requirements.

1. **A human decides.** Scores are decision support. No "reject" or "auto-decline" action exists. A missing must-have never hides anyone. Decision marks never change the AI band.
2. **Show the reasons.** Matched skills, missing skills, a written reason and, on request, the evidence sentence (6.2.3).
3. **Do not score on identity.** Name, photo, age, gender, marital status, nationality and similar attributes must not influence scores; redact them before scoring. Lines in a vacancy text about these are left out of matching (6.1.3). City is a possible proxy [Open].
4. **Names on screen.** Real names are hidden by default behind pseudonyms and the recruiter can reveal them, one at a time or all at once; reveals are recorded (6.2.6). City is hidden under the Focus on skills switch because it can act as a proxy attribute.
5. **Test for bias** before launch with realistic English and Azerbaijani resumes, and review results by group where lawful.
6. **Data handling.** The interface says "Candidate data stays inside Azerconnect Group". The architecture must make that true: storage location, access control, no third-party sharing without approval, retention and deletion. The vacancy-link feature fetches third-party pages and the scoring service may be external; both must be reviewed against the promise. **[Open]** Legal and data-protection owners review applicable personal-data law and any rules on automated decision-making.
7. **Candidate rights.** Plan for access, correction and deletion requests, including deleting a resume and every score and mark derived from it.
8. **Shared reports.** A shared report contains candidate data and CV quotes. It is login-only, expires, can be revoked, is logged, and defaults to pseudonyms (6.5). Legal must confirm that sharing CV quotes with a hiring manager is acceptable under the group's rules.
9. **The assistant (6.6).** It is part of a hiring system that screens and evaluates candidates, so design to the strictest regime now: such systems are classed as high-risk employment AI in the EU AI Act, automated decisions about people are restricted under GDPR Article 22, and New York City Local Law 144 requires bias audits and notice. Which rules bind Azerconnect depends on where candidates and processing are; Azerbaijani personal-data law is consent-centred and has rules on transfers; obligation dates under the EU Act have been changing. **Counsel must confirm all of this**; this document is not legal advice. Design consequences: a visible AI label; Elon sees only a redacted evidence package; refusals and logs; no decisions; counterfactual and red-team gates (6.6.4); retention and deletion with the run. It has no real person's likeness.
10. **Vacancy and requirement wording.** The tool does not write or police job adverts. It only leaves protected-attribute lines out of matching. A full bias checker is not agreed.

---

## 13. Localisation

First-release **interface languages: English and Azerbaijani** (the owner's decision). Russian is not an interface language.

- All strings come from a message catalogue from the first screen; the catalogue is set up at the start of the build, not at the end. The Azerbaijani copy deck has an owner and a deadline [Open].
- Language selection: default from the browser or account, a visible switcher, stored per user [Proposed; the switcher does not exist yet].
- Plural rules differ by language. Use ICU-style plurals for "N resumes" and "N skills".
- Allow for text expansion in buttons, chips and cards.
- **Azerbaijani letters.** The dotted and dotless i (İ / ı, I / i) are different letters. Using the Azerbaijani locale for case conversion on **English** text corrupts it: `"PIPELINE".toLocaleLowerCase('az')` gives "pıpelıne". Do not apply one locale to everything. Normalise matching with a locale-neutral fold that treats İ, I, ı and i as equivalent, and test with "PIPELINE", "SQL" and "İSTEHSAL". Handle skill matching in a way that finds "sebeke" for "şəbəkə".
- **Mixed-language content.** Resumes and vacancy texts often mix Azerbaijani, English and Russian. `Resume.language` has values az, en, ru, mixed and unknown. Russian text is read on a best-effort basis; resumes entirely in an unsupported language are marked "Needs a human look" rather than scored badly. **Decided:** the owner accepted this treatment. Test with a few Russian and mixed resumes, but do not hold the release for Russian quality.
- Terminology: pick one noun for EN and AZ ("resume" or "CV") and use it everywhere. The prototype uses both.

---

## 14. Open decisions and risks

Owners are suggestions until a name is added. **Items 17 to 21, 24 and 25 block UAT with real candidate data**, because Elon and the resume viewer are in release 1. Item 22 is run during UAT with test data.

| # | Item | Suggested owner |
|---|---|---|
| 1 | Official Azerconnect Group brand assets: logo, colours, typeface | Brand owner |
| 2 | Trademark and domain clearance for "parallax" | Legal |
| 3 | Scoring: model choice, must-have and nice-to-have weights, band thresholds (80, 70, 50), reproducibility | Product and engineering |
| 4 | Data residency, retention, deletion, applicable law and automated-decision rules; whether reading third-party vacancy pages is allowed | Legal and security |
| 5 | Confirm the UAT limits of 10.7, and whether scanned PDFs (OCR) come later | Product |
| 6 | **Decided:** typical batch is about 100 resumes. Folder and ZIP are in release 1. Still open: the hard limit per run (must exceed 100). | Product |
| 7 | **Decided:** names hidden by default with reveal; the Focus switch is the recruiter's choice. Still open: the switch's first-time state for a new recruiter (recommended off), and legal review of the reveal log. | Product and legal |
| 8 | **Decided:** Russian is accepted as text on a best-effort basis; not an interface language. | Product |
| 9 | Real zodiac shapes versus stylised constellations | Design |
| 10 | Whether Manrope covers all Azerbaijani glyphs; otherwise the typeface | Design |
| 11 | Visual review of the White, White-grey and Sky backgrounds, and account menu design | Design |
| 12 | Azerbaijani copy deck, and whether the endorsement line is translated | Content owner |
| 13 | Who owns the product after launch | Sponsor |
| 14 | Shortlist export format; whether a second run can start during a scan | Product |
| 15 | Report sharing: default expiry (suggested 30 days), who may be added as a viewer, whether CV quotes may be shared by default | Product and legal |
| 16 | Whether the report must be reproducible if the screening is run again (and what "scores may differ" says) | Product and engineering |
| 17 | Final name for the assistant. "Elon" is a working name that research advises against (reads as a public figure); alternatives are Parallax Assistant, Second View, Counterpoint, Lens. Legal checks whichever is chosen. | Product and legal |
| 18 | Whether scoring shares Elon's provider and model; how a model change is approved and tested | Product and engineering |
| 19 | Who the admins are; admin console design | Product and security |
| 20 | Provider data terms: region, retention, no training on candidate data; consent and cross-border transfer rules for Azerbaijan; EU, GDPR and New York City applicability | Legal and security |
| 21 | Retention period and who may read the assistant audit log | Legal and security |
| 22 | A quick usability test of the Ask bar, the docked panel and the report composer with real recruiters, run during UAT with test data (the placement is reasoned from comparable products; no published study covers CV screening) | Design |
| 23 | Confirm that a Candidate pool row is one analyzed candidate in one vacancy, and whether a "Group by candidate" view is wanted | Product |
| 24 | Resume viewer: anonymised view by default, original file only as a logged reveal; whether the original may be downloaded; the viewer technology | Product and security |
| 25 | Who can see which vacancies, candidates and decisions in the pools (Elon answers only within this) | Sponsor and security |
| 26 | Elon's rules for matching a position name to a vacancy (spelling, Azerbaijani letters, open versus closed), and for stale scores | Product |
| 27 | Whether recruiters may analyze pool candidates for another vacancy ("Analyze for this vacancy"), and any limits | Product |
| 28 | Vacancy "More details" fields: which are required, whether others are needed, and whether a run may start on a vacancy with a title but no requirements | Product |
| 29 | Performance and volume targets (10.6) | Product and engineering |

---

## 15. Handoff

| Item | Where |
|---|---|
| UAT comments, acceptance tests and retest steps | `parallax-uat-log.md` (grows as UAT sends comments) |
| Interactive prototype (design reference for version 2.1; not updated for UAT round 1, by the owner's decision) | https://claude.ai/artifact/T6CY4ThpFRKtuFVVZ59EsG |
| Home screen (now the body of a vacancy, 6.1) | Artboard "Home" (`Main.dc.html`), 1280 × 900 |
| Results screen | Artboard "Results" (`Results.dc.html`), 1280 × 900 |
| Tokens | Section 4 |
| Brand mark | Section 2.2 (SVG, no separate file yet) |
| Constellation artwork | Inline in `Main.dc.html`; export as an asset (10.4) |

**The prototype does not show** the long-text box, the vacancy link, the must-have toggle, file problems, match bands, evidence, decision marks, the requirements drawer or the focus switch, name reveal, folder intake, the Word file attach, the evaluation report and Elon, and none of the v2.2 screens: the navigation rail and top bar, the Vacancy pool, the Candidate pool and the side-by-side Candidate report. Those are specified only in this document and in `parallax-uat-log.md`, which are the reference for release 1.

**Suggested build order**

1. Tokens, typography, the message catalogue (English and Azerbaijani), navigation rail and top bar, Dark background only. The White, White-grey and Sky backgrounds follow once designers review them (4.2).
2. **UAT-01:** the `Vacancy` entity, the Vacancy pool and the vacancy page; role card with long text, Word file, link and chips (6.1.3, 6.7).
3. Resume upload with file problems, folders and ZIP, and the summary line; back end for parsing, the asynchronous screening run and explainable scoring with evidence.
4. **UAT-02:** results with bands, explanation, proof and hidden names with reveal; decision marks; the **Candidate pool** and the **side-by-side report** with the anonymised resume viewer (6.8, 6.9); the in-app evaluation report.
5. **UAT-03:** the admin console minimum, the redacted evidence package, the search over analyzed candidates, **Elon** (find the right candidate for a position; ask more inside a report), and the evaluation set that gates its release. Resolve the blocking open items first.
6. The star map and the sky effects, behind a reduced-motion check.
7. Release 2: requirements drawer, Focus on skills switch, report share links.
8. Accessibility audit and bias review before any rollout.

*Prepared from the design conversation, the prototype, an independent review and UAT round 1. Statements marked [Proposed] and [Open] are not agreed decisions.*
