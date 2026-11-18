import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

/**
 * A second API process of the same build (fullstack/server.mjs) with its own port, database and
 * environment, for cases that need to restart the API, change its settings or start from an empty
 * database. The shared L2 stack and the isolated stack are never touched.
 */
export interface Proc {
  base: string;
  control: string;
  port: number;
  db: string;
  ownerUrl: string;
  appUrl: string;
  child: ChildProcess;
  stop(): Promise<void>;
}

const ROOT = new URL('../..', import.meta.url).pathname;

export async function startApi(opts: {
  port: number;
  db: string;
  reset?: boolean;
  env?: Record<string, string>;
  log?: string;
}): Promise<Proc> {
  const ownerUrl = `postgresql://cv:cv@127.0.0.1:5432/${opts.db}`;
  const appUrl = `postgresql://cv_api:cv_api@127.0.0.1:5432/${opts.db}`;
  const base = `http://127.0.0.1:${opts.port}`;
  const out = openSync(opts.log ?? `/tmp/uat-proc-${opts.port}.log`, 'a');
  const child = spawn(process.execPath, [`${ROOT}e2e/fullstack/server.mjs`], {
    cwd: `${ROOT}e2e`,
    env: {
      ...process.env,
      UAT_PORT: String(opts.port),
      UAT_OWNER_URL: ownerUrl,
      UAT_APP_URL: appUrl,
      ...(opts.reset ? { UAT_RESET: '1' } : { UAT_RESET: '' }),
      ...opts.env,
    },
    stdio: ['ignore', out, out],
  });
  closeSync(out);
  let exited = false;
  child.on('exit', () => (exited = true));
  const stop = async () => {
    if (exited) return;
    child.kill('SIGTERM');
    for (let i = 0; i < 50 && !exited; i++) await new Promise((r) => setTimeout(r, 200));
    if (!exited) child.kill('SIGKILL');
  };
  for (let i = 0; i < 120; i++) {
    if (exited) throw new Error(`API on ${opts.port} exited at start (see its log)`);
    try {
      if ((await fetch(`${base}/readyz`)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
    if (i === 119) {
      await stop();
      throw new Error(`API on ${opts.port} did not become ready`);
    }
  }
  return {
    base,
    control: `http://127.0.0.1:${opts.port + 1}`,
    port: opts.port,
    db: opts.db,
    ownerUrl,
    appUrl,
    child,
    stop,
  };
}

/** A small JSON client for a given base (any number of stacks side by side). */
export function client(base: string, token?: string) {
  const call = async <T = any>(method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: parsed as T };
  };
  return {
    get: <T = any>(p: string) => call<T>('GET', p),
    post: <T = any>(p: string, b: unknown = {}) => call<T>('POST', p, b),
    put: <T = any>(p: string, b: unknown) => call<T>('PUT', p, b),
    del: <T = any>(p: string) => call<T>('DELETE', p),
  };
}
