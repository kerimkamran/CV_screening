import { AZ_ASSISTANT } from './az.assistant';
import { AZ_HOME } from './az.home';
import { AZ_MONITORING } from './az.monitoring';
import { AZ_REPORT } from './az.report';
import { AZ_RESULTS } from './az.results';
import { AZ_SHELL } from './az.shell';

/** English sentence → Azerbaijani. Each screen keeps its own list; they are merged here. */
export const AZ: Record<string, string> = {
  ...AZ_SHELL,
  ...AZ_HOME,
  ...AZ_RESULTS,
  ...AZ_REPORT,
  ...AZ_ASSISTANT,
  ...AZ_MONITORING,
};
