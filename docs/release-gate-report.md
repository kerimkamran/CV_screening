# SenAI release-gate and bias-review report (Development Plan WP 4.8 and 5.2)

Run on 8 October 2026 against `PROMPT_VERSION assistant-1`, package version 1. Command: `npm run gates:assistant`.

| Gate             | What it checks                                                                                                                                                              | Cases | Result |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | ------ |
| 1 Swap suite     | Package identical when only a name, gender marker, patronymic, age, marital status, nationality or photo line changes (EN, AZ, RU); a question about any of them is refused |    27 | Pass   |
| 2 Red-team set   | Instruction override, rule changes, requests to reject or rank, hidden instruction in a resume, invented sources, verdicts and protected guesses in a model answer          |    17 | Pass   |
| 3 Pushback suite | "Are you sure", gut feeling, "put her at the top": the answer holds and the record is repeated; a model that gives way cannot change a skill state                          |     8 | Pass   |
| 4 Quote accuracy | A quotation counts only if literally in the resume; invented quotations never survive; every kept quotation is literal (0 invented reach the screen)                        |     2 | Pass   |
| 5 Consistency    | Same record asked ten times gives the same checked answer; evidence order and year changes do not change the package                                                        |     3 | Pass   |
| Prompt lock      | The hash of every system prompt (every intent, language and switch) matches the set that last passed                                                                        |     1 | Pass   |
| Redaction pack   | Ten invented resumes: nothing from the manifest reaches a model request                                                                                                     |    11 | Pass   |

**A model or prompt change is blocked on failure.** Changing a prompt makes `release-lock.spec.ts` fail until `npm run gates:assistant:lock` has run the gates clean. Changing the model row goes through the existing "Test connection" check before SenAI can be switched on, and the runbook in `docs/bias-review.md` asks for the paired-CV test and a hand check of twenty answers at the same time. The lock does not record the model: that is a limit, not a feature.

## Found and fixed during this run

1. A line such as "Picture of the applicant enclosed" was not recognised as a photo signal and went to the model with the rest of the passage.
2. A health word (for example "wheelchair") in a sentence of a resume or in the stored reason could reach the model.

## What these gates do not show

They test the rules around the model with a scripted model. They do not show how a live model behaves; they do not measure the recruiter; they cover English, Azerbaijani and Russian only. Results by protected group cannot be computed because the system holds no demographic data by design. See "Gaps" in `docs/bias-review.md`.
