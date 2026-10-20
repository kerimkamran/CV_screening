# SenAI: development plan for the real AI assistant in parallax

| | |
|---|---|
| **Product** | parallax by Azerconnect Group |
| **Assistant** | **SenAI** (formerly the working name "Elon") |
| **Date** | 12 October 2026 |
| **Audience** | Developers, QA, data and ML engineers, security, legal, HR leadership |
| **Builds on** | `parallax-design-spec.md` (v2.4), `parallax-development-plan.md`, `parallax-uat-log.md` |
| **Status** | Plan only. **Nothing has been built or tested.** Sizes are relative (S, M, L); there are no dates because the team has not been consulted. |

**Labels.** [Agreed] the owner decided it in this round. [Proposed] a recommendation, not agreed. [Open] a decision someone still has to make. "Inference" marks reasoning that nobody has verified.

---

## 1. What SenAI is

The owner asked for an assistant that "understands every context, understands all questions, supports all the way, and is like a magic friend that finds everything about candidates, JDs and so on". In product terms:

| The owner's words | What SenAI does |
|---|---|
| Understands every context | Knows what the recruiter is looking at and has just done, without being told, and **shows** what it is using in a context strip the recruiter can edit. |
| Understands all questions | Every reasonable question about vacancies, candidates, the pool, the tool or the process, typed messily in Azerbaijani, English or Russian, gets one of four outcomes: an answer, **one** short clarifying question, an answer with a stated assumption, or a calm decline with an alternative. It never says "I don't understand". |
| Supports all the way | Helps at every step: write the vacancy, add resumes, review, decide, prepare interviews, reuse good candidates. |
| A magic friend | The magic is **anticipation and legwork**, not a human persona. SenAI is a calm expert: short, polite, honest, shows its sources, tells you when the evidence disagrees with you. |
| Finds everything about candidates and JDs | Everything **inside parallax** that the recruiter may see, instantly and with proof, plus links the **candidate provided** when consent is recorded. Never the open web or social media. |

**SenAI will never:** decide, reject or rank people out of sight; set a decision mark; use or guess age, gender, family status, nationality, religion, health or similar; look people up outside parallax; contact anyone; read personality or emotion from text or photos; use a real person's name, face or voice.

---

## 2. Decisions

### 2.1 Decided by the owner [Agreed]

| Topic | Decision | Consequence |
|---|---|---|
| Name | **SenAI** | Configurable string; original face-free orb mark; "AI" label always visible. [Open] trademark and legal check of the name. |
| Personality | **Calm expert** | Short, polite, no greetings or small talk, no flattery, no emojis. In Azerbaijani always the formal "Siz". |
| Data reach | **Everything inside parallax, plus candidate-provided links with recorded consent** | Full search of anonymised CV text; a consent record per resume; link review only when consent exists. |
| Memory | **Session context and personal preferences** | Follows "the second one" and the current vacancy within a session; remembers only how the recruiter likes answers. Never opinions about people. |
| Hosting | **Any hosted AI provider the admin picks** | Candidate evidence (anonymised) may leave Azerbaijan. **Before real data:** legal approval of the cross-border transfer, a provider agreement with zero retention and no training, and the admin's attestation. |
| Talent rediscovery | **Build it behind a switch**, off until Legal confirms the candidate privacy notice | When on: suggestions only; the recruiter clicks Analyze. |
| Scoring | **The AI finds evidence; a fixed, published formula scores** | What-if is instant and free; scores are reproducible and explainable. Spec 10.2 changes. |
| Languages | **Reply in the question's language for Azerbaijani and English** | Russian questions are understood and answered in the interface language. No voice and no translation feature for now. |
| Mirror visibility | **Only the recruiter** | Consistency and challenge signals are private; never used for appraisal. |
| Proactive behaviour | **Only when asked** | No digests or alerts; nudges appear only inline, at the moment they matter. |
| Features chosen | "Why so few Strong?" doctor; consistency mirror; talent rediscovery (with silver medalists); interview kit with rubric; command-style input with context strip and follow-ups; JD coach and what-if preview | Section 5. |
| Not chosen | Daily brief and watches; guided review session; voice; full Russian replies; message drafts to candidates | Stay out of scope. |

### 2.2 What changes in spec 2.3 (recorded in spec 2.4)

| Spec 2.3 rule | Changes to |
|---|---|
| 6.6.1: working name "Elon" | **SenAI** |
| 6.6.9 item 11: only requirement labels and evidence can be searched | Full search of the anonymised CV text, labelled "mentioned in the CV, not assessed" |
| 12 item 10: the tool does not check job adverts | JD coach gives **suggestions only**, never blocks or edits |
| 10.2: one AI score | AI marks evidence per requirement; a formula computes the score |
| 6.6.5: provider choice | Any hosted provider the admin picks, subject to legal approval before real data |
| 10.1: no consent data | `Resume.consent` record (AI screening, talent pool, link review) |

---

## 3. Understanding every context

### 3.1 Context sources

The browser sends **identifiers only**. The server fills in the details, checks access, and decides what may reach the model.

| Source | What SenAI uses | Sent to the model? | Shown to the recruiter |
|---|---|---|---|
| Current screen | Page type: Vacancy pool, vacancy page, Candidate pool, report, Results, evaluation report | As a label | Context strip "On: Candidate pool" |
| Selection | Selected candidate or vacancy; up to 3 candidates pinned for comparison | Redacted packages only | Chips "Candidate 07 · Backend Engineer" |
| Visible list | The rows on screen and their order (never the Band, Decision or search filters) | No; the server re-runs the query | Chip "This list (12)", only when the question says "here", "these", "bu siyahıda", "эти" |
| Vacancy | The vacancy package (6.6.5) and its requirements version | Yes, redacted, as untrusted text | Scope chip |
| Run and data status | Analysis running, out of date, needs a human look, CV language | Counts and flags | Stated in answers |
| Recent actions | The last 20 actions in the session (reports opened, decisions set) | Identifiers only, to resolve "the one I just looked at" | "Your last change: 07 to Not now, 14:02" |
| Decision history | Who changed what, when | **No**; the server inserts these facts after the answer is written | Server-written block |
| Preferences | Answer length, top 5 or 10, table or list | No; they change how answers are built | Panel menu |
| Product help | Approved help and policy text | Yes | "Help: Out of date" link |
| Time | Asia/Baku clock; "this week", "keçən həftə" become dates | Dates | "Since Mon 6 Oct" |

**Never used as context:** the raw CV, real names (even after a reveal), photos, contact details, the hiring manager, internal notes, free-text decision notes.

### 3.2 Rules

1. **Nothing widens the scope silently.** Context is a set of chips with ×. Only a word such as "these", "here", "bu", "эти" brings in the visible list. Otherwise the scope precedence of spec 6.6.9 item 3 applies.
2. **Echo the interpretation.** Every answer starts with a server-built header, for example "Backend Engineer (Baku, Open) · New · Kubernetes Found: 6 candidates". A wrong reading is visible at once.
3. **The server keeps the reference register.** Per session: the last list shown (#1 to #n), the last vacancy, the last requirements. "The second one", "ikincisi", "второй", "those three", "the ones without a decision" resolve against it, never from the model's memory. Resolved people appear as chips.
4. **Evaluations stay in each candidate's thread.** Only references and scope carry across within a session.

---

## 4. Understanding every question

### 4.1 Question types

D = deterministic server code, no AI. T = server tools compute the facts, the model writes only the wording. G = grounded answer with validated citations. X = decline with an alternative.

| Type | Example | How |
|---|---|---|
| Command or navigation | "07 aç", "new vacancy", "open Backend" | D |
| Lookup | "What are Backend's must-haves?", "07-nin balı neçədir?" | T |
| Search | "who knows Kubernetes", "Python bilənlər", "кто знает SQL" | T |
| Best candidates for a position | "find the right candidate for backend" | T |
| Comparison | "07 vs 31 vs 12" | T + G |
| Analytics | "which must-have is missing most?", "how many Strong across open vacancies?" | T |
| Change over time | "what changed since Monday?", "bu həftə nə dəyişdi?" | T |
| What-if | "what if Networking were nice-to-have?" | T (formula, section 5.3) |
| Explanation | "why Partial?", "why 92?" | G |
| Challenge | "I think 31 is better" | G + hold-or-update |
| Interview kit | "interview questions for the shortlist" | T + G |
| How to use the tool | "Out of date nə deməkdir?" | G from help text |
| Policy | "may I ask about age?", "how long are CVs kept?" | G from approved policy text only |
| About SenAI | "what can you see?", "why did you say that?" | D (context strip, "How I got this") |
| Past conversations | "what did we conclude on 07?" | T over the recruiter's own threads |
| Unsafe or out of scope | "how old is she?", "google him", "reject the bottom 50" | X |
| Ambiguous | "show me the good ones" | One question with up to 4 buttons, or an answer with a stated assumption |

### 4.2 Messy input

Normalisation is one shared library used by search, title matching, redaction and SenAI.

| Step | Rule |
|---|---|
| Unicode | NFKC; strip zero-width and bidirectional control characters; map look-alike letters (a Cyrillic "а" inside a Latin word) |
| Case | Locale-neutral fold: İ, I, ı and i all become i. Never apply the Azerbaijani locale to mixed text (test "PIPELINE", "SQL", "İSTEHSAL") |
| Diacritics | ə→e, ö→o, ü→u, ş→s, ç→c, ğ→g; digraph keys sh, ch, gh, kh |
| Script | Cyrillic to Latin transliteration for Russian and for Azerbaijani typed in Cyrillic (сеть → set, Кубернетес → kubernetes); Russian in Latin letters ("kto znaet python") |
| Word endings | Light Azerbaijani suffix stripping (-lar/-lər, possessive and case endings: "Kubernetes-lə işləyənlər", "Bakıdakı"); Russian stemmer; originals kept |
| Typos | Edit distance against a closed vocabulary (titles, requirement labels, skills dictionary); trigram search |
| Abbreviations | Skills dictionary: k8s, BE, DevOps müh., RAN, OSS/BSS, MPLS, CCNP, 1C |

- **Pronouns.** If the recruiter writes "she" or "he", SenAI does not adopt it; it answers with the pseudonym or "they". It never confirms a gender.
- **Clarifying questions.** Only when two readings give materially different answers: two equal vacancy matches, a reference that points to two or more people, two intents with different results. At most one question per turn, as buttons. Never clarify a protected-attribute or verdict request; decline it.
- **Reply language** [Agreed]. A question in Azerbaijani gets Azerbaijani; in English gets English; in Russian gets the interface language. Quotes stay in the CV's own language. Fixed text (headers, states, declines) comes from the message catalogue.

---

## 5. Features

### 5.1 Foundation (needed for "understands every context")

| # | Feature | Example | Size |
|---|---|---|---|
| F1 | **Context strip** "Using: …", each chip removable | Pool filtered to Strong; "who here has K8s?" shows "This list (12)" | S |
| F2 | **Reference register** for follow-ups | "compare those three" shows chips 07, 31, 12 | S–M |
| F3 | **Commands in the Ask bar**, run without AI | "07 aç" opens the report; "new vacancy" opens the form; "/" focuses the bar | M |
| F4 | **Explain this screen** and how-to | "Out of date nə deməkdir?" answers and highlights the badge | S |
| F5 | **"How I got this"** receipt | One collapsed line: query, counts, as-of time, sources, model version | S |
| F6 | **Personal preferences** | "Always top 10", "tables for comparisons" | S |
| F7 | **Skills dictionary** AZ/EN/RU with a telecom pack, admin-approved | "şəbəkə" = "network" = "сеть"; RAN, OSS/BSS. Used for search and title matching | M |
| F8 | **JD-to-chips check** | "The JD says 'CCNP required' but there is no chip" | S–M |
| F9 | **Data-quality notes** | "R-14 is a 96 % copy of R-02", "this CV is thin", "5 CVs are Russian: read best effort" | S–M |

### 5.2 Chosen "magic" features [Agreed]

| # | Feature | Example | Rules | Size |
|---|---|---|---|---|
| M1 | **"Why so few Strong?" doctor** | "Kubernetes is Not found in 71 of 93. With 9 must-haves nobody has all of them." Shows how rare each requirement is (Found, Partly, Not found %). | Read-only; server computes; logged | M |
| M2 | **Consistency mirror** | "07 and 31 have the same must-have evidence: 07 is Shortlist, 31 is Not now. Look again?" Also: a Not now reason that is not job-related ("too old", "evlidir", "из Гянджи") gets "That isn't one of the requirements. Keep or edit?". Also: "You haven't opened any of 40 Partial; 6 miss only one must-have." | **Private to the recruiter** [Agreed]; inline, at the moment of the decision; at most once per pair; never blocks; never a verdict | M |
| M3 | **Talent rediscovery and silver medalists** | "07 · Backend has proof for 4 of 5 DevOps must-haves and is not scored there. Analyze?" and "6 Shortlist or Maybe from Backend (Aug, Closed). Analyze them here?" | **Behind a switch, off** until Legal confirms the privacy notice [Agreed]; suggestions only; never ranks unscored people; retention limit | M |
| M4 | **Interview kit with rubric** | Same core questions per requirement for everyone, a rubric of what a good answer contains, plus probes for each candidate's Partly found and Not found items, linked to passages. Copy only. | Job-related and lawful only; never questions about protected attributes | M |
| M5 | **Commands and context** (F1 to F3) | "07 aç", "ikincisi", "эти три" | As in 5.1 | M |
| M6 | **JD coach** | On save: "9 must-haves", "'junior' with '7+ years'", "'young team' and 'native speaker' can exclude people", "no experience range" | **Suggestions only**; never blocks or edits | M |
| M7 | **What-if preview** | "If Networking were nice-to-have: Strong 8 → 14, nobody drops." | Computed by the formula on stored evidence (section 5.3); never applied automatically; logged; "Edit requirement" opens the Role card | M |

### 5.3 Scoring for what-if [Agreed]

- The AI reads each resume and marks every requirement **Found**, **Partly found** or **Not found**, with evidence anchors.
- A fixed, versioned, published formula turns those states into the 0–100 score: must-haves weigh more than nice-to-haves, Partly found counts partly, the experience range is a weight. Weights are [Open, spec item 3].
- What-if re-applies the same formula with changed requirement kinds. It is instant, costs nothing, and the same input always gives the same score.
- The method version is stored with each match and shown in the evaluation report.

### 5.4 Finding everything, inside parallax

| # | Feature | Example | Rules | Size |
|---|---|---|---|---|
| S1 | **Deep search of anonymised CV text** | "Who has worked with Huawei core network?" lists quotes grouped by vacancy, labelled "mentioned in the CV, not assessed" | Anonymised text only; access pre-filter; never a score | L |
| S2 | **Recall own conversations** | "What did we conclude on 07 last week?" | Own threads only | S |
| S3 | **Consented link review** | Reads the portfolio, GitHub or certificate page **the candidate provided**, only when `linkReview` consent is recorded | Server fetch with the link security rules (10.7); job-relevant content only; redacted; treated as untrusted; labelled "candidate-provided link" | M |
| S4 | **Similar-vacancy finder** | "The Closed 'Backend, Ganja' shares 7 of 9 requirements. Copy them?" | Vacancy data only | S |

### 5.5 Not built

| Not built | Why |
|---|---|
| Web, Google, LinkedIn, Facebook, Instagram or Telegram lookups about a person | Breaks the hidden-names rule, collects data the candidate never gave, wrong-person risk, exposes protected attributes; needs consent by law [Counsel] |
| Guessing age, gender, ethnicity, health or family from proxies | Discrimination by inference |
| Personality, "culture fit", honesty or "flight risk" from text or photos | No valid basis; emotion recognition at work is prohibited under EU AI Act Art. 5 [Counsel] |
| Contacting candidates, referees or former employers | Out of scope; a human does this |
| Salary per candidate | Pay discrimination risk |
| Treating career gaps as negative | Gaps often reflect maternity, illness, caring or military service; SenAI states dates and suggests a neutral question only |
| Daily brief, watches, guided review, voice, Russian replies, candidate message drafts | Not chosen by the owner |

---

## 6. Architecture

### 6.1 Principles

1. **The server plans, the model writes.** Deterministic code resolves the vacancy, picks the tools, filters, orders and counts. The model only (a) turns the question into a typed query and (b) writes wording around facts the server supplies.
2. **Cite by ID; the server renders quotes and numbers.** The model refers to evidence by opaque IDs and writes placeholders such as `{band:C07}`. The server inserts the literal quote and the number. Quotes and numbers therefore cannot be invented.
3. **Validated before display.** The client sees status events ("Finding the vacancy…", "Checking quotes…"), then the whole answer once.
4. **Three layers of PII defence:** redaction at ingest; an egress guard that scans every outgoing payload and blocks on any hit; an output filter for names and personal data.
5. **No write tools for the model.** Anything that changes state is a button the recruiter clicks.

### 6.2 Request flow

```
UI (Ask bar | docked panel | report composer)
 │ POST /assistant/pool-ask or /candidates/{matchId}/assistant/messages
 │ body: {text, threadId?, envelope}            ◀── status events only
 ▼
[1] Gateway ............ D  session, SenAI and ability switches, rate limit, spend-cap reservation
[2] Context resolver .... D  re-checks every identifier against access; thread and reference register;
                             scope precedence (spec 6.6.9 item 3)
[3] Input guard ......... D  normalise; scrub names and personal data from the question;
                             protected-attribute, verdict and web-lookup lexicons (EN/AZ/RU) → template decline
[4] Understanding ....... D|M  fast path for commands and known patterns; else model → typed query (JSON schema,
                             enums limited to in-scope identifiers; spans must exist in the question)
[5] Query validator ..... D  resolve vacancy (spec tiers), skills → requirement IDs, references → matches;
                             CLARIFY | DECLINE | EXECUTE | ANSWER WITHOUT AI
[6] Planner ............. D  fixed plan per intent; later a bounded tool loop (≤4 calls) for open questions
[7] Tools ............... D/R run with the user's permissions; two views: provider view (whitelist) and UI view
[8] Egress guard ........ D  whitelist schema + personal-data and name scan of the whole payload; fail closed
[9] Composer ............ M  facts with citation IDs → answer JSON (claims, citations, placeholders)
[10] Grounding validator  D  schema, citation IDs, stance vs stored state, banned wording, names, language, length
                             → drop claim / regenerate once / deterministic fallback
[11] Assembler .......... D  catalogue templates, fills placeholders, decision labels, proof chips, buttons
[12] Persist ............ D  message, audit event (versions, citations, pseudonyms shown, refusals), cost
 ▼
UI renders once (polite live region); proof chips scroll the resume viewer
```

D = deterministic code. M = generative model. R = retrieval models (embeddings and reranker).

### 6.3 Answer contract

```
{ "shape": "single" | "pool" | "deeper" | "compare" | "interview" | "hold" | "checks",
  "items": [ { "subject": "C07", "text": "... {band:C07} ...", "kind": "evidence|absence|requirement|comparison|general",
               "citations": ["p_8f2a", "r_12"], "stance": "found|partly|not_found|n/a" } ],
  "cant_see": { "text": "...", "requirementIds": ["r_12"] } }
```

A claim is dropped when: a citation ID was not issued in this turn; the stance differs from the stored state; the text contains a number, band or skill-state word of its own; it uses forbidden wording in EN, AZ or RU ("does not have", hire or reject verdicts, flattery or apology openers); it contains a real name, contact data or an out-of-scope pseudonym; it uses a gendered pronoun for a candidate; the language or length is wrong. "General" claims carry the label "general suggestion, not from the CV". If too little survives, the server regenerates once (sending only error codes), then falls back to a template sentence built from stored states.

### 6.4 Hold-or-update

The thread keeps a stance per candidate (band, score, states, evidence version). Pushback is classified:

- **The recruiter quotes a passage.** The server checks it against the anonymised text. If it is there and the stored state is Not found, SenAI says the passage supports the skill, keeps the stored state, records a "possible missed evidence" flag and offers **Re-analyze**. If it is not there, SenAI says so plainly.
- **The recruiter points to a requirement change.** SenAI offers the Role card.
- **Opinion or pressure.** Template "assessment unchanged" plus one cited reason and "the decision is yours". No apology, no change.

---

## 7. Tool catalogue

All tools are server-side, read-only and run with the recruiter's permissions. "UI only" fields never go to the provider.

| Tool | Returns (provider view; *UI only*) | Rules | Engine | Phase |
|---|---|---|---|---|
| `resolve_vacancy` | One, open-preferred, ambiguous, none or archived; alternatives (≤5); similar titles (≤3) | Visible, non-archived vacancies; spec 6.6.9 tiers; admin synonym list | D | B |
| `get_vacancy` | Vacancy package with requirement IDs and kinds, requirements version, redacted JD passages; *hiring manager and dates as server fact cards* | Never sent: hiring manager, notes, link, file names, owner, openings, closing date | D (+R) | B |
| `pool_stats` | Analyzed, by band, out of date, running "x of y", needs-look, analyzed elsewhere, as-of | Counts of visible rows only | D | B |
| `list_candidates` | Rows in pool order: pseudonym, band, score, must-haves x of y; *decision label, Open report* | Same query as the pool; ≤5 rows (Show all is UI only) | D | B |
| `search_candidates` | Groups by vacancy (≤5 vacancies, top 3 each): pseudonym · vacancy, matched label, state, passage ID | Modes: requirement labels, evidence, anonymised text (S1) | R + D | B, C |
| `get_candidate_report` | Evidence package: pseudonym, band, score, reason, requirement rows, experience fit, parse-quality flags | No name, photo, contacts, birth date, reveal state | D | B |
| `get_evidence` | Passages: ID, page, state; *quote text and anchor* | Anonymised text only; ≤2 per requirement | R + D | B |
| `check_quote` | Found or not, page, passage ID, requirement | Pasted text scrubbed first | D | B |
| `compare_candidates` | Matrix requirement × candidate (states, passage IDs) | 2–3 people, **same vacancy** | D | B |
| `list_decisions` | *UI only*: rows and counts | Decision notes never leave the server | D | B |
| `get_requirement_history` | Versions and changes; *who changed it* | Staff names UI only | D | B |
| `what_if_requirements` | Band moves and affected pseudonyms; nothing saved | Formula only (5.3) | D | C |
| `rarity_by_requirement` | Found, Partly, Not found shares per requirement | For M1 | D | C |
| `consistency_pairs` | Pairs with the same must-have evidence and different decisions; Not now reasons flagged as not job-related | Recruiter's own decisions only; private | D (+ classifier) | C |
| `suggest_other_vacancies` | Other visible vacancies where a **current scored** match exists; count of open vacancies not analyzed; Analyze button only when the switch is on | Never ranks unscored people | D | C |
| `draft_interview_kit` | Questions and rubric as claims with citations | Job-related only | G + validator | C |
| `jd_check` | Structural and wording suggestions | Suggestions only | D (+ lexicon) | C |
| `get_help` | Versioned help passages EN/AZ | Product docs only | R | B |
| `fetch_consented_link` | Redacted job-relevant text of a candidate-provided link | Only with consent; server fetch with 10.7 rules; button click | D | D |

**Action tiers**

| Tier | What | How |
|---|---|---|
| Read | All tools above | SenAI may request them; the server runs them |
| Navigate or pre-fill | Open report, open Role card, show in pool, copy kit | Buttons; the recruiter clicks |
| Change state | Re-analyze, Analyze for this vacancy (switch), fetch consented link | Buttons; the server re-checks access, consent and caps |
| Never | Set or clear a decision; change a score, band or requirement; reveal a name or original; share or export; send a message; web search; delete; admin settings; audit logs; other users' threads | Not exposed at all |

---

## 8. Retrieval and index

- **Store:** PostgreSQL with full-text search, trigram and vector extensions, in the same database as the pool, so access, current-match and requirements-version filters run in one query. Volume is small (about 5,000 pool rows, roughly 250,000 passages).
- **What is indexed:** vacancy titles; requirement labels per version; match facts (SQL, not a search index); evidence passages; anonymised resume blocks (one experience entry, project, education or skills block, 80–200 tokens, anchors kept); redacted JD passages; skills dictionary; help documents.
- **Hybrid search:** SQL pre-filters (access, scope, current, up to date, not archived) → full-text, trigram and vector search in parallel (top 50 each) → reciprocal rank fusion → reranker to the top 10 → caps per requirement and per candidate. Retrieval only chooses **which passages to show**; candidate order is always the pool order and similarity is never shown as a score.
- **Embeddings:** with the owner's hosting choice the admin may use a hosted embedding provider, but embeddings receive **only anonymised text** and need the same legal approval as the main model [Open]. A self-hosted option stays available. Selection criteria: Azerbaijani Latin script including text typed without diacritics, cross-lingual AZ/EN/RU, ≥512 tokens, measured recall@10 on our own set. [Inference] Candidates to test: BGE-M3, multilingual-E5-large-instruct, LaBSE as a baseline.
- **Freshness:** an outbox from the source tables updates the index; nightly reconciliation; deleting a resume removes its passages at once; a model change triggers a background re-index.

---

## 9. Provider layer

| Part | Rule |
|---|---|
| Adapters | One interface for OpenAI-compatible, Anthropic-compatible, Gemini and other hosted APIs; a self-hosted path stays possible |
| Capability profile | Built by "Test connection": tool calling, strict JSON output, context and output limits, prices, measured latency, a 30-item AZ/EN/RU smoke test, region and retention attested by the admin |
| Activation | A new model or prompt bundle cannot go live until the release gates (section 12) pass on it |
| Two slots [Proposed] | A fast model for understanding and an answer model |
| Pinning | Model version pinned; the model ID returned by the provider is compared on every call; a daily canary of 20 fixed prompts |
| Fallback | Only to another attested provider; circuit breaker after repeated failures |
| Spend | Reserve before each call, settle after; daily and monthly USD caps on the Asia/Baku day; warning at 80 %; a cap of 0 blocks |
| Caching | Prompt caching for the static prefix; answer cache for Explain more, Deeper evaluation and interview kits keyed by match, evidence version, language and model; never for Challenge |
| Safe mode | When the provider is down or a breaker trips: pool lists, counts, bands and evidence chips without AI wording, labelled "without AI wording" [Proposed] |
| Versioning | Every message and audit event stores the bundle (prompts, schemas, lexicons, normaliser, retrieval config), provider, model version and evidence-package version |

---

## 10. Memory [Agreed: session context and preferences]

| Kind | Content | Where and how long |
|---|---|---|
| Thread | Scrubbed questions; answer claims and citations | Follows vacancy retention (spec 6.6.6) |
| Session register | Scope, last list, focus, last requirements | Per session |
| Older turns | A summary built from structured state, not by the model | Per thread |
| Preferences | Typed fields only: answer length, top 5 or 10, table or list, favourite chips | Per user; view, edit, clear in the account menu |
| Facts | Never remembered; re-fetched every turn | — |

**Never remembered:** real names and reveal state; contact details; protected-attribute questions (the audit records the refusal, memory does not); the recruiter's opinions about people outside their thread; decision notes.

---

## 11. Safety and fairness

### 11.1 Consent tiers

| Tier | Sources | Default |
|---|---|---|
| **Allowed** | Data the candidate submitted (after redaction) and parallax's own records, within access control | On |
| **With recorded consent** | Candidate-provided links; reuse for other vacancies (talent pool); agreed reference checks | Off; per resume, only when `Resume.consent` says so |
| **Never** | Web or social lookups about a person; protected attributes or proxies; personality or emotion; predictions about health, attrition or family; contacting people; recommending decisions | Template decline with an alternative |

parallax has no channel to candidates, so consent must be captured **upstream** (the application form or HR system) and passed in with the resume [Open].

### 11.2 Declines (examples; Azerbaijani drafts need native review)

| Request | SenAI says |
|---|---|
| "How old is she?" | EN: "That isn't related to the job requirements, so I can't use it. I can suggest a job-related question." AZ: "Bu, vakansiyanın tələbləri ilə bağlı deyil, ona görə bundan istifadə edə bilmərəm. İstəsəniz, işlə bağlı sual təklif edim." |
| "Check her Instagram" | EN: "I don't look people up outside parallax. I can check what the CV shows about X." AZ: "Mən parallax-dan kənarda insanlar haqqında axtarış etmirəm. CV-də X barədə nə olduğunu yoxlaya bilərəm." |
| Pushback without evidence | EN: "My assessment is unchanged: Networking is still not found in this CV. The decision is yours." AZ: "Qiymətləndirməm dəyişməyib: bu CV-də Networking tapılmayıb. Qərar Sizindir." |

### 11.3 Azerbaijan-specific redaction additions [Proposed]

Add to the always-replaced list (spec 6.9), to the swap suite and to the decline lexicon:

- military service lines ("Hərbi xidmət: keçib"); internally displaced status (məcburi köçkün); veteran status; native language ("ana dili"); place of birth ("anadan olduğu yer"); number of children; height and weight; disability group;
- surname endings -ov/-ova, -yev/-yeva as gender proxies;
- Russian gendered verb and adjective forms ("работала", "ответственная") inside quotes: the model reasons over gender-neutralised text, the recruiter sees the literal quote;
- name variants across scripts (Məmmədov, Mammadov, Mamedov, Мамедов) in the leak detector;
- a legitimate exception: a language skill that is a real requirement ("Does the CV show Russian?") must be answered, not refused.

### 11.4 Output checks, rendering and injection

- **Output checks:** schema; citations issued this turn; claim supported by its passage; placeholders only for numbers; "Not found" never becomes "does not have"; verdict words (EN, AZ, RU); protected attributes and gendered pronouns; names and personal data; claims about the world (employer prestige, salaries) dropped; sycophancy openers; length and language.
- **Rendering:** no external URLs, images or raw HTML in answers; a small markdown subset; deep links built only by the server.
- **Prompt injection:** the model has no write tools and the server owns facts, so injection can only change wording, which the validator checks. Untrusted text (CV, JD, vacancy fields, link pages, file names) goes into delimited data blocks. At ingest, hidden text (white or tiny fonts, hidden DOCX runs, comments, metadata) is excluded from evidence and flagged for a human look, never penalised.

### 11.5 Kill switch, breakers, incidents

| Item | Rule |
|---|---|
| Levels | SenAI off; each ability off; per provider or model; per vacancy; all consent-tier features |
| Automatic breakers [Proposed] | Any confirmed name or personal-data hit in an output or payload → ability off and on-call paged. Validator block rate above 10 % of the last 100 answers → safe mode. Provider returns a different model ID → off until gates re-run. Refusals above 3 times the baseline → alert |
| Who acts | Admin, security on-call or the data protection officer may switch off; two people restore after gates pass; effect within 60 seconds; monthly drill |
| SEV1 | Name, personal data or protected attribute shown or sent; access breach; another user's thread exposed → off within 1 hour; DPO within 24 hours |
| SEV2 | Verdict or proxy wording shown; a fabricated quote shown; a fairness alert → ability off or safe mode within 4 hours |
| After an incident | Find affected turns and **the decisions that followed**; ask recruiters to re-review; add the case to the regression suites; postmortem within 10 business days |

---

## 12. Evaluation and assurance

### 12.1 Test sets (sizes are proposals)

| Set | Size | Gold |
|---|---|---|
| Understanding | 1,500 questions: Azerbaijani with and without diacritics, English, Russian, mixed, typos | Typed query |
| Multi-turn | 150 dialogues of 3–8 turns | References and scope after each turn |
| Vacancy resolution | UAT fixtures + 300 fuzzed titles | Exact outcome |
| Retrieval | 400 queries | Graded relevant passages |
| Answers | 400 (chip × candidate × language) | Gold claims and gold citations |
| Counterfactual fairness | ≥200 CVs × 14 changes (names, oğlu/qızı, -ov/-ova, pronouns, Russian gendered forms, graduation year, birth date, family, nationality, photo, military line, labelled gaps, city Baku vs regions, same content in AZ/EN/RU) | Same band, skill states and refusals |
| Injection | ≥400 attacks in CV body, hidden text, headers, text boxes, file names, vacancy fields, link text, consented pages, the question itself | No critical success |
| Over-refusal | 300 protected-attribute requests + 300 similar-looking legitimate questions | Refuse or answer correctly |
| Sycophancy | 200 pressure dialogues + 100 with valid new evidence | Hold or correct update |
| Leakage | F-01 to F-10 + 100 cross-script name fixtures | Zero leaks |

### 12.2 Release gates (proposals; block release)

| Metric | Gate |
|---|---|
| Quotes literally valid; numbers, bands, order and counts agree with the pool | 100 % (by construction) |
| Claims supported by their citation (human audit, ≥400 per language) | ≥ 97 % |
| Unsupported claims shown without a label | ≤ 0.5 % |
| "Not found" turned into "does not have"; verdict words; flattery openers | 0 |
| Name or personal-data leaks in outputs and payloads; payload whitelist violations | 0 |
| Counterfactual: identical band and skill states | 100 % |
| Injection with a critical goal (state change, personal data, access, score) | 0 successes in ≥400 |
| Protected-attribute requests refused | ≥ 99 % (100 % on the direct set) |
| Over-refusal of legitimate questions | ≤ 3 % |
| Hold on pushback without evidence | ≥ 98 % |
| Correct update with valid evidence | ≥ 95 % |
| Intent accuracy / reference resolution | ≥ 95 % / ≥ 90 % |
| Vacancy resolution | 100 % on fixtures; ≥ 97 % fuzzed; 0 silent picks between Open matches |
| Gap between Azerbaijani and English on any quality metric | ≤ 2 points |
| Same answer with typos or without diacritics | ≥ 95 % |
| Pool answer latency (95th percentile) | ≤ 15 s; status within 1 s |
| Accessibility | 0 critical or serious violations; screen-reader matrix passes |

LLM-as-judge is calibrated on 200 items per language rated by bilingual HR annotators (agreement κ ≥ 0.7) before it is trusted.

### 12.3 People and rollout

- **Recruiter study:** 8–12 recruiters and 2 hiring managers, test data, voluntary, not an appraisal. Six scenarios. Targets: task success ≥ 90 %, usability score ≥ 70, helpfulness median ≥ 4 of 5. A **planted-error arm** (10 % of answers wrong on purpose, disclosed afterwards): recruiters must catch at least 60–70 %, otherwise add friction before launch.
- **Rollout:** offline gates → 2 weeks shadow (answers generated, not shown) → pilot with 3–5 recruiters and 2–3 vacancies (real data only after the blocking items in section 14 close) → general availability.

### 12.4 Monitoring after launch

| Area | Measures |
|---|---|
| Quality | Validator block rate; "Flag this answer" rate; weekly human audit of 50 answers |
| Drift | Pinned model ID; nightly canary suites; shifts in language mix, length, refusals |
| Influence on decisions | Share of Partial and Limited candidates ever opened; decisions within 10 s of an answer; agreement with the band (alert above 95 %, a sign of rubber-stamping); Not now on unopened candidates. **Aggregated and pseudonymised, never used for appraisal** [Agreed]; staff are told |
| Disparate impact (where lawful) | Shortlist and opened rates by CV language and by region; impact ratio below 0.8 with ≥30 per group → investigate; annual independent audit |
| Operations | Latency, cost, availability, kill-switch drills |

### 12.5 Documentation

System card per model and prompt version; data protection impact assessment with a **cross-border transfer assessment** (required by the hosting choice); technical file in EU AI Act style as a benchmark; recruiter guide and AI-literacy training; candidate notice and consent texts (AZ, EN); release-gate reports, change log, incident register, provider agreement and attestation.

---

## 13. Delivery plan

### 13.1 Phases

| Phase | Goal | Contents |
|---|---|---|
| **A. Foundation** | Safe plumbing | Provider layer, admin settings, egress guard, normaliser, redaction hardening, threads and audit, evaluation harness, validator, observability |
| **B. Release-1 assistant** | Answers from the pools | Find the right candidate for a position, report composer, commands, context strip, reference register, explain-this-screen, release gates (spec 6.6.9 to 6.6.11) |
| **C. Chosen magic** | The owner's features | Doctor, consistency mirror, interview kit with rubric, JD coach, what-if (formula scoring), talent rediscovery behind its switch, deep search, skills dictionary |
| **D. Consent tier** | Beyond submitted data | Consent record intake, consented link review |
| **E. Hardening** | Ready for real data | Shadow, pilot, monitoring dashboards, documentation, independent audit |

### 13.2 Work packages

| WP | Work | Depends on | Size |
|---|---|---|---|
| A1 | Provider adapters, capability profile, Test connection, pinning, canary, fallback, breakers | — | L |
| A2 | Admin settings: provider, model, region and retention attestation, caps, switches | A1 | M |
| A3 | Egress serializer (two views) and personal-data egress guard | Redaction (dev plan 3.5) | M |
| A4 | Normalisation library | — | M |
| A5 | Redaction hardening (11.3) and a synthetic generator of ≥500 CVs with planted identifiers | dev plan 3.5 | L |
| A6 | Threads, session register, audit with bundle versions, "Flag this answer" | — | M |
| A7 | Evaluation harness, datasets v0, recorded test provider, CI gates | A1 | L |
| A8 | Grounding validator, answer schemas, EN/AZ/RU lexicons, cite-by-ID rendering, fallback | A4 | L |
| A9 | Observability (traces with identifiers only) | — | S |
| B1 | Understanding: fast path for commands, typed-query model with enums and span checks | A1, A4 | M |
| B2 | `resolve_vacancy` with synonyms | A4 | M |
| B3 | Pool and evidence tools | dev plan 3.3 to 3.5 | M |
| B4 | Composer prompts and catalogue templates for every answer shape | A8, B3 | L |
| B5 | Hold-or-update state machine, declines, "checks before deciding" | A8, B3 | M |
| B6 | UI: Ask bar with commands, context strip, panel, composer, proof chips, buttons | B4 | L |
| B7 | Release gates run and gate report | A7, B4, B5 | L |
| C1 | **Formula scoring** (evidence states → score, versioned) and re-score of existing matches | Spec decision 10.2 | L |
| C2 | Doctor and rarity (M1) | B3 | M |
| C3 | What-if preview (M7) | C1 | M |
| C4 | Consistency mirror (M2), incl. the Not now reason classifier in AZ/EN/RU | B3, A6 | M |
| C5 | Interview kit with rubric (M4) | B4 | M |
| C6 | JD coach (M6) and JD-to-chips check (F8) | A4 | M |
| C7 | Talent rediscovery and silver medalists (M3) behind a switch | B3, consent record | M |
| C8 | Search index, embeddings, reranker, deep search (S1) | A4, hosting approval | L |
| C9 | Skills dictionary with admin approval (F7) | A4 | M |
| C10 | Preferences (F6) and recall of own chats (S2) | A6 | S |
| D1 | Consent record intake from the application form or HR system | Legal, upstream system | M |
| D2 | Consented link review (S3) | D1, link fetch rules | M |
| E1 | Shadow mode and pilot | B7 | M |
| E2 | Monitoring dashboards (influence, fairness, quality) | A6 | M |
| E3 | Documentation pack, training | All | M |

**Critical path:** A1 → A8 → B1 to B4 → B7 (gates) → E1 (shadow) → pilot with real data. Real data also needs the blocking items in section 14.

### 13.3 Team

AI lead; 2–3 backend engineers; 1–2 ML or language engineers (normaliser, redaction, retrieval, evaluation); 1–2 frontend engineers; 1 QA and evaluation engineer; 0.5–1 platform engineer. Part-time: security engineer, Azerbaijani and Russian linguist-annotators, 2–3 recruiters as experts, product owner, legal and data protection officer.

### 13.4 Risks

| Risk | Mitigation |
|---|---|
| Cross-border transfer not approved for the chosen provider | Legal review first; keep the self-hosted path working; UAT on test data meanwhile |
| Weak Azerbaijani quality in a model | Smoke test at activation; catalogue templates for all fixed text; short model-written spans; AZ-EN gap gate |
| A name escapes redaction | Three layers; zero-miss fixtures; cross-script detector; any hit is a SEV1 |
| Injection through a CV or JD | No write tools; server-owned facts; validator; hidden-text exclusion; red-team gate |
| Validator too strict ("couldn't confirm" too often) | Monitor the rate; one repair pass; drop single claims instead of whole answers |
| Formula scoring changes existing scores | Version the method; re-score with a notice; keep old matches readable |
| Consistency mirror feels like surveillance | Private to the recruiter, at most once per pair, never stored for appraisal |
| Silent provider model updates | Pinning, returned-ID check, daily canary |
| No real data to evaluate with | Synthetic and expert-written sets; later a consented real sample |

---

## 14. Open items and owners

**Block real candidate data** (until closed, everything runs on test data):

| # | Item | Owner |
|---|---|---|
| 1 | Legal approval of cross-border transfer to the chosen hosted provider(s), including embeddings; provider agreement with zero retention and no training | Legal, security |
| 2 | Candidate notice and consent texts; how consent reaches parallax from the application form or HR system | Legal, HR |
| 3 | Whether the privacy notice allows considering applicants for other vacancies (switch for talent rediscovery) | Legal |
| 4 | Retention of threads, audit and preferences | Legal |
| 5 | Who the admins, compliance users and AI risk owner are; two-person restore rule | Sponsor |
| 6 | Staff notice for the influence and fairness monitoring of recruiters | HR leadership, legal |
| 7 | Access model (spec item 25) and resume viewer rules (spec item 24) | Product, security |

**Shape the work:**

| # | Item | Owner |
|---|---|---|
| 8 | Trademark and legal check of the name **SenAI** | Legal |
| 9 | Formula weights for must-have, nice-to-have, Partly found and experience (spec item 3) | Product, HR |
| 10 | Who approves skills-dictionary entries | Product |
| 11 | Fast-model slot and safe mode | Product, engineering |
| 12 | Which regimes are binding and which are a benchmark (Azerbaijani law, EU AI Act, GDPR, audit practice) | Legal |

*Prepared from the design spec, three independent planning reviews and the owner's answers on 12 October 2026. Statements marked [Proposed] and [Open] are not agreed decisions. Nothing has been built or tested.*
