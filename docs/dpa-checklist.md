# Data-processing and transfer checklist (per company and per service)

**Draft by the build team, 7 October 2026. Not legal advice.** One copy per row. A company must not be activated in Admin > AI models for real candidates until its row is complete. The Assistant additionally requires the data terms and an attestation to be entered before it can be turned on.

## What each processor receives

- **AI company**: the masked CV text (no name, e-mail, phone, links, labelled personal fields) and the requirement text of the vacancy; for the Assistant, a redacted package for the question asked. Not the file itself, not the candidate's name.
- **Render**: everything the application stores (files, text, database), because it hosts them.
- **E-mail sender** (Resend or SMTP, if configured): recipient e-mail addresses and the link text of invitations and report shares. No CV content.

## Checklist

| Item                                                                                            | Anthropic | Google | OpenAI | Z.ai | Sakana Fugu                       | NVIDIA catalog | Render              | E-mail sender |
| ----------------------------------------------------------------------------------------------- | --------- | ------ | ------ | ---- | --------------------------------- | -------------- | ------------------- | ------------- |
| Signed DPA (Art. 28 or equivalent)                                                              | [ ]       | [ ]    | [ ]    | [ ]  | [ ]                               | [ ]            | [ ]                 | [ ]           |
| Purpose limited to our instructions                                                             | [ ]       | [ ]    | [ ]    | [ ]  | [ ]                               | [ ]            | [ ]                 | [ ]           |
| No training on our data (contract or API terms confirmed in writing)                            | [ ]       | [ ]    | [ ]    | [ ]  | [ ]                               | [ ]            | n/a                 | n/a           |
| Processing and storage location(s) known                                                        | [ ]       | [ ]    | [ ]    | [ ]  | [ ]                               | [ ]            | Frankfurt [confirm] | [ ]           |
| Transfer mechanism and transfer impact assessment (if outside the permitted area)               | [ ]       | [ ]    | [ ]    | [ ]  | [ ]                               | [ ]            | [ ]                 | [ ]           |
| Sub-processors listed and acceptable                                                            | [ ]       | [ ]    | [ ]    | [ ]  | [ ] (orchestrates several models) | [ ]            | [ ]                 | [ ]           |
| Retention of prompts/outputs at the provider; abuse-monitoring retention; zero-retention option | [ ]       | [ ]    | [ ]    | [ ]  | [ ]                               | [ ]            | n/a                 | [ ]           |
| Security certifications reviewed (ISO 27001 / SOC 2)                                            | [ ]       | [ ]    | [ ]    | [ ]  | [ ]                               | [ ]            | [ ]                 | [ ]           |
| Breach notification time                                                                        | [ ]       | [ ]    | [ ]    | [ ]  | [ ]                               | [ ]            | [ ]                 | [ ]           |
| Assistance with data-subject requests and deletion                                              | [ ]       | [ ]    | [ ]    | [ ]  | [ ]                               | [ ]            | [ ]                 | [ ]           |
| Azerbaijani law: localisation, registration or consent duties checked                           | [ ]       | [ ]    | [ ]    | [ ]  | [ ]                               | [ ]            | [ ]                 | [ ]           |
| Approved by (DPO / Legal) and date                                                              | [ ]       | [ ]    | [ ]    | [ ]  | [ ]                               | [ ]            | [ ]                 | [ ]           |

Notes from the build team, to be verified by the owners and not relied on: Anthropic, Google and OpenAI process in the US by default; OpenAI offers an EU data-residency option. Z.ai is China-based. NVIDIA's free catalog is for development, not for candidate data. Fugu may pass text to several underlying models. API keys are stored encrypted and never shown again.

## After approval

1. Enter the data terms and attestation in the Admin screen for that company.
2. Press Test connection, then Use this.
3. Run the paired-CV test (Admin > Monitoring) and record the result with the date and model name.
4. File the signed DPA and the assessment where the DPO keeps them; note the reference here: [ ]
