# Performance run (Development Plan WP 5.3)

Command: `npm run load:pool` (set `VOLUME_ROWS=300` for the small set only). Seeds one vacancy with N analyzed resumes by cloning three real ones in SQL, then measures each step at the 95th percentile. Measured in process against a local Postgres on a shared build machine, so it shows the work the application does, not network time on Render. The limits are working targets for this release, set in `apps/api/src/pipeline/volume.integration.spec.ts`; **confirm them against design spec 10.6**, which the build team did not have.

| Step (p95)                 |     Limit | 300 resumes | 5,000 resumes |
| -------------------------- | --------: | ----------: | ------------: |
| Pool first page (50 rows)  |  1,000 ms |       25 ms |        454 ms |
| Search by name             |  1,000 ms |       27 ms |        549 ms |
| Sort                       |  1,000 ms |       20 ms |        447 ms |
| Next page ("Show 50 more") |  1,000 ms |       19 ms |        438 ms |
| One decision mark          |    400 ms |       19 ms |         22 ms |
| 100 decisions at once      |  1,500 ms |      448 ms |        431 ms |
| Report for one candidate   |    800 ms |       87 ms |        228 ms |
| Shortlist summary          |  1,500 ms |       33 ms |        185 ms |
| Excel export               | 10,000 ms |      176 ms |        671 ms |

All inside the limits. At 5,000 resumes the list, search, sort and paging each take about 450 to 550 ms because the server ranks the whole vacancy before cutting a page. That grows linearly; at around 20,000 resumes in one vacancy it would need a database-side sort and cursor. The all-vacancies list was not part of this run.

Web bundle: 511 kB before gzip (`npm run build`); the build warns above 500 kB. Splitting the Admin and report pages into their own files would remove the warning; it was left because the pages are used on every visit by their audience and no target depends on it.

Not measured: Render's cold start on the free tier, browser rendering time of a 50-row page on a slow phone, and the model's own time for a SenAI answer (depends on the provider).
