# 0009 — Access control model

Status: Accepted (implements IAM-01/03/04/06, Plan §4.3)

- **Authentication** is OIDC bearer tokens from the corporate IdP, verified against its JWKS (RS256/ES256 only).
- **Roles come from database grants, never from token claims.** A compromised or misconfigured IdP
  group mapping therefore cannot silently confer ADMIN. The token proves identity; `role_assignment` proves authority.
- **Default-deny, twice:** every route needs a valid token unless marked `@Public()` (health probes only); every
  authenticated route needs at least one granted role unless marked `@AnyAuthenticated()` (`/me`) or names specific roles.
- **New users get no roles.** They are provisioned on first sign-in and see nothing until an ADMIN grants a role.
- **First ADMIN:** `BOOTSTRAP_ADMIN_SUBJECT` is honoured only while no active ADMIN exists, is audited as `role.bootstrap`,
  and should be unset afterwards. The last active ADMIN cannot be revoked.
- **Service principals** (`idtyp=app`) may hold only `SERVICE`; humans never hold `SERVICE`. A subject whose token kind
  changes between sign-ins is refused.
- **Vacancy scope:** TA_PARTNER sees only granted vacancies; TA_LEAD and GOVERNANCE see all. Out-of-scope reads are 404.
  Whether GOVERNANCE should see all candidate-level data (versus audit views only) needs an HR/DPO decision before R1b.
- **Session lifetime (IAM-06):** tokens with `exp − iat` above `MAX_TOKEN_LIFETIME_SECONDS` (default 90 min) are refused.
  Idle timeout is an IdP session policy and a front-end concern; the API cannot enforce it.
- **Audit:** role/vacancy-access changes and denied attempts write to the hash-chained `audit_event` in the same
  transaction as the change. Unauthenticated denials have no principal and are logged, not audited.
- **Cost:** each authenticated request does one DB round-trip to resolve the user. Add a short-TTL cache only if ASYNC-10
  shows it matters; note that a cache delays revocation.
