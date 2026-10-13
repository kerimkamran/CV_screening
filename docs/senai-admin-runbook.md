# SenAI: administrator runbook

Admin > SenAI.

1. **Model.** Choose the model and press Test connection (valid for an hour); a model is only used after a passing test. Optional: a faster model that only reads questions; if it fails the main model reads them. The data terms you confirm cover both models.
2. **Data terms and caps.** Record what the provider does with data; caps count answers, not dollars; the warning percentage shows a notice.
3. **Switches.** "Let a model read questions" (on). "Suggest candidates from other vacancies" and "Read links candidates gave" stay off until Legal confirms the privacy notice.
4. **How SenAI is doing.** Last 7, 30 or 90 days: counts only. Watch "Could not tell what was meant" (a high share means the dictionary needs words) and "Rules only (AI unavailable)" (a provider problem). A yellow notice means the model is paused after repeated failures; fix the key or credit, then press Test connection.
5. **Skills dictionary.** Approve or reject words recruiters suggest; add a word with its spellings.
6. **What was sent to the model.** The payload log shows field shapes only; a call stops if a field is outside the whitelist.
7. **After a prompt or model change.** Run `npm run gates:assistant:lock`; release is blocked until the gates pass.

Failure modes: provider down → safe mode (rules only) and a one-minute pause; cap reached → safe mode; key refused → shown on Test with the provider's reason; no model at all → the assistant still answers from rules.
