# 0008 — Deviations from Plan §13.5 in the initial schema

Status: Accepted — revisit at GOV-09

(1) audit_event is not partitioned yet; partitioning by occurred_at can be introduced by migration without changing the contract. (2) The hash chain is serialised by an advisory lock, which caps audit write throughput; acceptable at Azerconnect volumes, to be measured in ASYNC-10. (3) seq is assigned inside the trigger after the lock so chain order equals seq order under concurrency. (4) Database triggers make audit_event and frozen requirement sets immutable even for the owner; a superuser can disable triggers, so the periodic export to immutable storage (GOV-09) remains the control for that residual risk. (5) requirement.source_span_id has no FK until evidence_span exists (S8).
