/**
 * SSRF regression tests for POST /local/connect (iamUrl / baseUrl validation).
 *
 *   node --test test/ssrf-connect.test.mjs
 *
 * Starts the real dashboard server as a child process (no mocks of the code under test) and checks
 * that non-Checkmarx hosts supplied by the client are rejected before any outbound request is made.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.mjs');
const PORT = 20000 + Math.floor(Math.random() * 20000);
let child;
let base;
let sessionToken;
let cacheDir;

before(async () => {
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cxd-test-'));
  child = spawn(process.execPath, [SERVER, '--no-open', '--no-cache', '--port', String(PORT), '--cache-dir', cacheDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CX_APIKEY: '', CX_API_KEY: '', CX_BASE_URI: '', CX_BASE_AUTH_URI: '', CX_BASE_IAM_URI: '', CX_TENANT: '' },
  });
  // Wait for the "Open http://127.0.0.1:<port>/" banner (the server may fall forward to another port).
  base = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/Open (http:\/\/127\.0\.0\.1:\d+)\//);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    child.on('exit', () => reject(new Error('server exited early')));
  });
  const html = await (await fetch(`${base}/`)).text();
  sessionToken = html.match(/"token":"([0-9a-f]+)"/)[1];
});

after(() => {
  child?.kill();
  if (cacheDir) fs.rmSync(cacheDir, { recursive: true, force: true });
});

const connect = (payload) =>
  fetch(`${base}/local/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cxd-token': sessionToken },
    body: JSON.stringify({ clientId: 'id', clientSecret: 'secret', tenant: 't', ...payload }),
  });

const blocked = [
  ['cloud metadata endpoint', 'https://169.254.169.254'],
  ['arbitrary external host', 'https://evil.example.com'],
  ['look-alike suffix', 'https://checkmarx.net.evil.example.com'],
  ['look-alike prefix', 'https://evilcheckmarx.net'],
  ['userinfo trick', 'https://iam.checkmarx.net@evil.example.com'],
  ['plain http to a remote host', 'http://iam.checkmarx.net'],
  ['plain http to a private IP', 'http://10.0.0.5'],
  ['non-http scheme', 'file:///etc/passwd'],
  ['unparseable URL', 'https://'],
];

for (const [name, target] of blocked) {
  test(`rejects iamUrl: ${name}`, async () => {
    const r = await connect({ iamUrl: target, baseUrl: 'https://eu.ast.checkmarx.net' });
    assert.equal(r.status, 400);
  });
  test(`rejects baseUrl: ${name}`, async () => {
    const r = await connect({ iamUrl: 'https://eu.iam.checkmarx.net', baseUrl: target });
    assert.equal(r.status, 400);
  });
}

test('rejects an API key whose iss claim points at a non-Checkmarx host', async () => {
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const key = `${b64u({ alg: 'none' })}.${b64u({ iss: 'https://169.254.169.254/auth/realms/t' })}.sig`;
  const r = await fetch(`${base}/local/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cxd-token': sessionToken },
    body: JSON.stringify({ apiKey: key }),
  });
  assert.equal(r.status, 400);
});

test('does not reject a Checkmarx regional host at the URL validation step', async () => {
  // The host is allowed, so validation passes and the (unreachable in the sandbox) token request is
  // attempted; whatever it returns, it must not be the 400 URL-validation error.
  const r = await connect({ iamUrl: 'https://eu.iam.checkmarx.net', baseUrl: 'https://eu.ast.checkmarx.net' });
  const body = await r.json();
  assert.ok(!/not an allowed Checkmarx One endpoint|Only https URLs/.test(JSON.stringify(body)), JSON.stringify(body));
});
