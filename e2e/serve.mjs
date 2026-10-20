#!/usr/bin/env node
// Serves the production build of the web app for the end-to-end tests, with the same security
// headers the API sends in production (the CSP is read from app.factory.ts, so the two cannot drift).
// API calls are answered by each test (page.route); anything not answered gets a JSON 404.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'apps/web/dist');
const factory = readFileSync(join(root, 'apps/api/src/app.factory.ts'), 'utf8');
export const CSP = /'content-security-policy',\s*"([^"]+)"/.exec(factory)?.[1];
if (!CSP) throw new Error('could not read the CSP from app.factory.ts');
if (!existsSync(join(dist, 'index.html')))
  throw new Error('build the web app first: npm run build -w apps/web');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};
const port = Number(process.env.E2E_PORT ?? 4310);
createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('content-security-policy', CSP);
  if (url.pathname === '/healthz') return void res.end('ok');
  const file = normalize(join(dist, url.pathname === '/' ? 'index.html' : url.pathname));
  if (file.startsWith(dist) && existsSync(file) && statSync(file).isFile()) {
    res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
    return void res.end(readFileSync(file));
  }
  res.statusCode = 404;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ message: 'Not answered by the test', path: url.pathname }));
}).listen(port, '127.0.0.1', () => console.log(`e2e: serving ${dist} on ${port}`));
