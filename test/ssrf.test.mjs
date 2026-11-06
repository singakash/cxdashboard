/**
 * SSRF regression tests for POST /local/connect (run with: node --test test/ssrf.test.mjs).
 *
 * The dashboard sends API keys / OAuth secrets and bearer tokens to the IAM and API base URLs.
 * Those URLs can come from the request body or from the (unverified) `iss` claim of the API key,
 * so they must be restricted to known Checkmarx One endpoints (or a loopback mock).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `${b64u({ alg: 'none', typ: 'JWT' })}.${b64u(claims)}.sig`;

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const waitFor = (child, re) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${re}`)), 15000);
    child.stdout.on('data', function onData(d) {
      if (re.test(String(d))) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve();
      }
    });
    child.once('exit', () => reject(new Error('process exited early')));
  });

// A listener standing in for an attacker-controlled / internal host: it must never be contacted.
let canaryHits = 0;
let canary;
let canaryPort;
let dash;
let dashPort;
let mock;
let mockPort;
let sessionToken;

before(async () => {
  canary = http.createServer((req, res) => {
    canaryHits++;
    res.writeHead(500).end();
  });
  await new Promise((r) => canary.listen(0, '0.0.0.0', r));
  canaryPort = canary.address().port;

  mockPort = await freePort();
  mock = spawn(process.execPath, [path.join(here, 'mock-cxone.mjs'), '--port', String(mockPort)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await waitFor(mock, /listening/);

  dashPort = await freePort();
  dash = spawn(process.execPath, [path.join(here, '..', 'src', 'server.mjs'), '--no-open', '--no-cache', '--port', String(dashPort)], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, CX_APIKEY: '', CX_API_KEY: '', CX_BASE_URI: '', CX_BASE_AUTH_URI: '', CX_BASE_IAM_URI: '', CX_TENANT: '' },
  });
  await waitFor(dash, /127\.0\.0\.1/);

  const html = await (await fetch(`http://127.0.0.1:${dashPort}/`)).text();
  sessionToken = /"token":"([0-9a-f]+)"/.exec(html)?.[1];
  assert.ok(sessionToken, 'session token should be embedded in the page');
});

after(() => {
  dash?.kill();
  mock?.kill();
  canary?.close();
});

const connect = async (body) => {
  const r = await fetch(`http://127.0.0.1:${dashPort}/local/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cxd-token': sessionToken },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

const key = (iss) => jwt({ iss, exp: Math.floor(Date.now() / 1000) + 3600 });

test('rejects a request-supplied baseUrl that is not a Checkmarx One endpoint', async () => {
  for (const baseUrl of [
    'https://evil.example.com',
    'https://ast.checkmarx.net.evil.example.com',
    'https://evil.example.com/ast.checkmarx.net',
    'https://user:pw@ast.checkmarx.net@evil.example.com',
    'http://169.254.169.254',
    'http://10.0.0.5:8080',
    `http://127.0.0.1.evil.example.com:${canaryPort}`,
  ]) {
    const r = await connect({ apiKey: key('https://iam.checkmarx.net/auth/realms/t'), baseUrl });
    assert.equal(r.status, 400, `expected 400 for ${baseUrl}`);
  }
  assert.equal(canaryHits, 0);
});

test('rejects a request-supplied iamUrl that is not a Checkmarx One endpoint', async () => {
  const r = await connect({ apiKey: key('https://iam.checkmarx.net/auth/realms/t'), iamUrl: 'https://evil.example.com', baseUrl: 'https://ast.checkmarx.net' });
  assert.equal(r.status, 400);
});

test('rejects URLs derived from the iss claim of an attacker-crafted API key', async () => {
  const r = await connect({ apiKey: key('https://iam.evil.example.com/auth/realms/t') });
  assert.equal(r.status, 400);
  const r2 = await connect({ apiKey: key(`http://iam.internal:${canaryPort}/auth/realms/t`) });
  assert.equal(r2.status, 400);
  assert.equal(canaryHits, 0);
});

test('rejects known hosts with credentials, query or non-https scheme', async () => {
  for (const baseUrl of ['http://ast.checkmarx.net', 'https://ast.checkmarx.net?x=1', 'ftp://ast.checkmarx.net', 'not a url']) {
    const r = await connect({ apiKey: key('https://iam.checkmarx.net/auth/realms/t'), baseUrl });
    assert.equal(r.status, 400, `expected 400 for ${baseUrl}`);
  }
});

test('still connects to a loopback mock endpoint', async () => {
  const origin = `http://127.0.0.1:${mockPort}`;
  const r = await connect({ apiKey: key(`${origin}/auth/realms/mock-tenant`) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.astUrl, origin);
  assert.equal(r.json.iamUrl, origin);
});

test('accepts a known region without a URL validation error', async () => {
  // The region host is allowlisted; the request then fails at the network/auth stage (not with the URL guard).
  const r = await connect({ clientId: 'a', clientSecret: 'b', tenant: 't', region: 'EU' });
  assert.ok(!/not an allowed Checkmarx One endpoint/.test(r.json.error || ''), JSON.stringify(r.json));
});
