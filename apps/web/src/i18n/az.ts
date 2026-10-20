import { AZ_ASSISTANT } from './az.assistant';
import { AZ_HOME } from './az.home';
import { AZ_MONITORING } from './az.monitoring';
import { AZ_POOL } from './az.pool';
import { AZ_REPORT } from './az.report';
import { AZ_RESULTS } from './az.results';
import { AZ_SHELL } from './az.shell';
import { AZ_STAGE2 } from './az.stage2';

/** English sentence → Azerbaijani. Each screen keeps its own list; they are merged here. */
export const AZ: Record<string, string> = {
  // Later spreads win. A sentence that appears in two files must have the same Azerbaijani text in
  // both (the i18n test checks it); the Stage 2 file is spread last so its wording is the final one.
  ...AZ_POOL,
  ...AZ_SHELL,
  ...AZ_HOME,
  ...AZ_RESULTS,
  ...AZ_REPORT,
  ...AZ_ASSISTANT,
  ...AZ_MONITORING,
  ...AZ_STAGE2,
};
