import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INTENTS,
  PACKAGE_VERSION,
  PROMPT_VERSION,
  systemPrompt,
  type ModelIntent,
} from './assistant-rules';

/**
 * The prompt lock (Development Plan WP 4.8). The lock file holds the hash of every system prompt the
 * assistant can send, taken the last time release-gates.spec.ts passed. Change a prompt and this
 * fails until the gates have run clean: `npm run gates:assistant:lock` runs the gates first and
 * refreshes the file only when they pass. A model change goes through the same command, because
 * the lock records the version of the gates it passed with, and the admin "Test connection" check.
 */

const LOCK = join(__dirname, '../../../../docs/eval/assistant-release-lock.json');

function current() {
  const h = createHash('sha256');
  const modelIntents = INTENTS.filter((i) => i !== 'change' && i !== 'check') as ModelIntent[];
  for (const intent of modelIntents)
    for (const lang of ['en', 'az', 'ru'])
      for (const flag of [false, true])
        h.update(systemPrompt('SenAI', intent, lang, flag) + '\n--\n');
  return {
    promptVersion: PROMPT_VERSION,
    packageVersion: PACKAGE_VERSION,
    sha256: h.digest('hex'),
  };
}

describe('release gate: prompt lock', () => {
  it('the prompts match the last set that passed the gates', () => {
    const now = current();
    if (process.env.UPDATE_GATE_LOCK === '1') {
      writeFileSync(LOCK, JSON.stringify(now, null, 2) + '\n');
    }
    expect(existsSync(LOCK)).toBe(true);
    const locked = JSON.parse(readFileSync(LOCK, 'utf8')) as typeof now;
    // If this fails: a prompt changed. Bump PROMPT_VERSION, then run `npm run gates:assistant:lock`.
    expect(now).toEqual(locked);
  });
});
