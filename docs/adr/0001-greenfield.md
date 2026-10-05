# 0001 — Greenfield rebuild (D1)

Status: Accepted (Plan §3)

The browser-only MVP (React + Gemini called from the client) is not the go-forward architecture. The key ships in the bundle, which violates AC-13/NFR-04 by construction; it cannot gain audit, identity or persistence. New backend-first system. The MVP remains a UX reference (bulk upload, progressive results, Excel export).
