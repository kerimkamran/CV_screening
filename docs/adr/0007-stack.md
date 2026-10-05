# 0007 — Stack choices that refine Plan §13.1

Status: Accepted

TypeScript end to end; NestJS on Fastify; PostgreSQL 17 (+pgvector image from day one, extension created when retrieval lands); React 19 + Vite + Tailwind 4. Two refinements: NestJS is pinned to 11.x because 12.x is ESM-only and breaks the Jest toolchain; TypeScript is pinned to 5.9 (via npm overrides) because tsup's declaration build and the Nest CLI do not agree on 6/7. The same ESM-only trap applies to `jose`: it is pinned to 5.x (dual CJS/ESM); 6.x fails under Jest. Revisit all three when the tooling catches up.
