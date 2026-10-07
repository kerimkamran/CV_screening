# DPIA and FRIA: working draft

**Status: draft by the build team, 7 October 2026. Not reviewed, not signed, not legal advice.** The DPO owns the DPIA; Legal and the programme owner own the FRIA. Everything in square brackets is for the owners to complete. Facts about the product come from the code and `docs/`; facts about the organisation are not known to the build team and are left open.

## 1. The processing

| Item                                | Draft entry                                                                                                                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Controller                          | Azerconnect, HR (Talent Acquisition) [confirm legal entity]                                                                                                                                                                  |
| Purpose                             | Help recruiters read and sort CVs against the requirements of a vacancy. The tool recommends an order and shows evidence; a named person decides.                                                                            |
| Data subjects                       | Job applicants who send a CV. Recruiters and administrators (account data, audit trail).                                                                                                                                     |
| Personal data                       | CV file and extracted text; name and e-mail read from the CV; whatever else the CV contains (employment, education, skills; possibly date of birth, address, photo, family status). Recruiter decisions and written reasons. |
| Special categories                  | Not requested or inferred. A CV may contain them (health, religion, nationality). They are masked before the model sees the CV when labelled as such (see `bias-review.md`), but the file itself is stored.                  |
| Recipients                          | Render (hosting, database) [region: Frankfurt]; the AI company the administrator activated (receives the masked CV text and requirement text). Named recipients of a shared report.                                          |
| Transfers outside the country / EEA | Depends on the activated AI company (see `dpa-checklist.md`).                                                                                                                                                                |
| Retention                           | Configurable purge in Admin > Data retention; off until set [decide period]. Audit trail kept longer by design (decisions about a person, not the CV).                                                                       |
| Legal basis                         | [Legitimate interest in recruitment / steps at the request of the data subject before a contract; confirm under Azerbaijani law and, where applicable, GDPR Art. 6].                                                         |
| Automated decision-making           | None by design: no automatic rejection, no reject band, every decision is a named person with a reason (GDPR Art. 22 not engaged if this holds in practice).                                                                 |

## 2. Necessity and proportionality

- Data minimisation: identity and personal fields masked from the model; only the CV text and requirement text leave the system; no demographic data collected.
- Accuracy: no measured accuracy yet (golden set not done). Mitigation: evidence quotes are verified against the CV text; "not found" never becomes "not met"; recruiters read the evidence.
- Transparency: per-vacancy candidate notice must be attested before uploads; wording is suggested in the app. [HR to confirm the notice reaches applicants before they apply.]
- Rights: erase action per candidate; review, access and objection requests handled by HR [process to be written]; the product can produce the data it holds about a person.
- Storage limitation: purge routine, legal hold, deletion certificates.

## 3. Risks and measures

| Risk                                                                            | Likelihood / severity [owners to rate] | Measures in the product                                                                                                            | Residual / open                                                               |
| ------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Biased ranking (names, gender, age, nationality, family signals)                | [ ]                                    | Masking before scoring; score is a formula with no personal fields; paired-CV test; outcome monitoring; humans decide              | Free-text signals and names in sentences not masked; no real-model result yet |
| Wrong or invented evidence                                                      | [ ]                                    | Quotes must match the CV text literally and are highlighted; prompt-injection screen; "needs review" for suspicious CVs            | No accuracy measurement                                                       |
| Over-reliance on the score                                                      | [ ]                                    | Bands labelled as sorting aid; attestation to reject; no reject band                                                               | Depends on recruiter behaviour; training [HR]                                 |
| Candidate data sent to a provider without a DPA or outside the permitted region | [ ]                                    | Admin must enter data terms and attest before activating a company; may-train terms block activation (assistant)                   | DPAs and transfer assessments not done                                        |
| Excess retention                                                                | [ ]                                    | Purge, legal hold, certificates                                                                                                    | Period not decided; purge off by default                                      |
| Unauthorised access                                                             | [ ]                                    | Role-based access, per-vacancy scoping, audit trail, hashed passwords, lockout, optional two-step sign-in, encrypted provider keys | MFA optional; no SSO; no independent security test                            |
| Shared report leaks identity                                                    | [ ]                                    | Named recipients only, names hidden unless shortlisted, links expire, erased data scrubbed from shared copies                      | Access by group not supported                                                 |
| Hostile CV text steering the model                                              | [ ]                                    | Injection detection, model output verified in code, no tools given to the model                                                    | Residual                                                                      |

## 4. FRIA (fundamental rights)

Rights engaged: non-discrimination, privacy and data protection, access to work, effective remedy / human review.
Affected groups: all applicants; groups at higher risk of proxy effects (career breaks, non-Azerbaijani-language CVs, non-standard CV formats, older and younger applicants, parents).
Draft assessment: [ ] The design keeps a human decision-maker and gives evidence for every ranking, which supports remedy. The main exposure is indirect discrimination through language, format and career-gap proxies and the absence of measured accuracy. Measures: paired-CV test per model, by-language monitoring, instruction to read evidence before any rejection, complaint route [HR to define].
EU AI Act: recruitment tools are listed as high-risk (Annex III). [Legal to confirm whether the Act applies to this deployment and, if so, complete conformity, logging, human-oversight and transparency obligations. The product already keeps a hash-chained audit log and an explicit human-decision step.]

## 5. Consultation and sign-off

DPO opinion: [ ] Works council / employee representatives (if applicable): [ ] Authority prior consultation needed? [ ] Date and approver: [ ] Review date (suggest: after the trial and on every model change): [ ]
