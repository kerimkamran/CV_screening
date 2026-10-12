# SenAI system card (pool assistant)

Updated 12 October 2026. Describes what SenAI over the candidate pool does today, how it reaches its answers, what it never does, and how it is checked. Source plan: `parallax-senai-plan.md`. Azerbaijani and Russian wording needs a native review.

## What it is

SenAI is the assistant in the Ask bar and the side panel. A recruiter types a question in Azerbaijani (with or without special letters), English or Russian, with typos. SenAI answers from the analysis that parallax has already made: scores, bands, the requirements found or not found, the recruiter's own marks, and the text of resumes when a skill is searched. It answers in the language of the question.

## How an answer is made

1. **Guards.** Instruction overrides, questions about protected attributes, requests to decide about a person, web or social media lookups, personality or "will he leave" guesses, salary per candidate, and career gaps as a negative are refused with fixed wording (`assistant-rules.ts`, `senai/deep-words.ts`).
2. **Reading.** The question becomes a typed query (intent, skills, bands, marks, count, references, date) by rules (`senai/understand.ts`, one shared normaliser and skills dictionary in `packages/shared`). Short follow-ups are read against the last query kept with the conversation ("excel", then "ingilis dili" replaces the skill; "həm də …" adds one; "only Strong" narrows; "the second one" points at a candidate that was listed).
3. **Model, only when the rules cannot tell.** A model reads the question into the same typed query. It receives the question text (contact details removed), the previous query in words, the vacancy titles and the number of candidates shown before. It never receives a resume, a score or a decision. The result is checked field by field (`toQuery`): skill ids must exist, written-out skills must be in the question, references must point at something shown. The administrator can switch this off; every use counts toward the caps.
4. **Tools.** The server runs the query: find, count, shortlist, skill search, compare, why so few Strong, what changed, what-if, open, interview kit, consistency check, data quality, JD check, similar vacancies, rediscovery (switch), pushback check, recall, about, help, preferences. Numbers, names and resume lines come from the data. Nothing the assistant does writes to a candidate, a decision, a requirement or a score; a person's own typed preference ("always top 10") is the only thing saved.
5. **Wording.** Sentences are fixed templates with slots in three languages. No model writes an answer in the pool assistant.
6. **Receipt.** Each answer carries "How I got this": how the question was read (rules or model), what it used, and the time.

## What it never does

Hire or reject, rank people for a decision, guess age, gender, ethnicity, health or family, judge personality or culture fit, look people up outside parallax, contact anyone, show salary per candidate, treat a career gap as negative. It states what a resume says; it does not score from it.

## Data

- Conversations are private to the person; administrators and compliance review turns (counts, wording, pseudonyms), not other people's chats.
- A stored answer keeps offsets of resume lines, not their text. The text is read again when shown, so erasing a resume removes it from every conversation.
- The audit trail records the query as words, the way it was read (rules or model, prompt version), the flags and pseudonyms only.
- Names are shown to recruiters (decision of 12 October). Models and the payload log carry pseudonyms.
- Preferences: one typed field (default number of candidates shown) per person, in `assistant_preference`.

## Switches (Admin > SenAI)

| Switch                                      | Default | Effect                                                    |
| ------------------------------------------- | ------- | --------------------------------------------------------- |
| Assistant on/off                            | on      | Stops every SenAI answer (404 `ASSISTANT_OFF`)            |
| Let a model read questions the rules cannot | on      | Off: unclear questions get one question back and examples |
| Suggest candidates from other vacancies     | off     | Keep off until Legal confirms the privacy notice          |
| Read links candidates gave                  | off     | The switch exists; the feature is not built (see below)   |

## How it is checked

- `senai/understand.eval.spec.ts`: more than 300 messy questions in three languages with expected typed queries; the rules must read at least 95% right overall and 90% for each kind of question; look-alike words must not become skills.
- `senai-gates.integration.spec.ts`: what a model is sent, validation of model output, never a dead end, behaviour without the model, refusals in three languages, privacy of conversations and the audit trail, the off switch.
- `senai-tools.integration.spec.ts`, `pool-assistant.integration.spec.ts`: each tool and the conversation scenario that failed in testing (Excel, then "ingilis dili").
- The prompt that reads questions is part of the prompt lock (`docs/eval/assistant-release-lock.json`); `npm run gates:assistant:lock` runs all of the gates above before it refreshes the lock.

## Known limits

- The rules read the shapes they were written for; a model fallback covers the rest, with a scripted model in tests. No live-model accuracy figure exists yet.
- Skill search is by words and the dictionary (about 100 skills), not by meaning. It reports mentions, not level.
- The consistency mirror speaks inline when a mark is saved (once per pair, only your own marks, never blocking). Data quality, the JD check and rediscovery run only when asked.
- The interview kit is generated from templates and the requirements, not by a model: questions are generic per requirement, with probes from what the resume shows.
- Not built: reading links candidates gave (needs a recorded consent and a Legal decision), an embedding or vector search, safe mode labels ("without AI wording": the pool assistant does not need AI wording at all), per-admin editing of the skills dictionary.
- Azerbaijani and Russian wording has not been reviewed by a native editor.
