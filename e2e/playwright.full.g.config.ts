import base from './playwright.full.config';

/**
 * Package G2's own L2 run (port UAT_PORT, its own database). Same as playwright.full.config.ts but
 * without the global seed, so the shared test-results/uat/accounts.json is not rewritten while
 * other sessions use it (the accounts were seeded into the G database once; passwords are the same).
 */
export default { ...base, globalSetup: undefined };
