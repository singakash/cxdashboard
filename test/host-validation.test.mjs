/**
 * Host-header validation (DNS-rebinding protection) tests, run with: node --test test/
 * Starts src/server.mjs bound to a wildcard address and verifies that foreign Host headers are rejected
 * while loopback and local-interface Host headers are still served.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.mjs');
let child;
let port;
let cacheDir;

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port: p } = s.address();
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });

// Send a request to 127.0.0.1 with an arbitrary Host header and return the status code.
const status = (hostHeader) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/favicon.ico', method: 'GET', headers: { Host: hostHeader } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });

before(async () => {
  port = await freePort();
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cxd-test-'));
  child = spawn(process.execPath, [SERVER, '--host', '0.0.0.0', '--port', String(port), '--no-open', '--no-cache', '--cache-dir', cacheDir], {
    env: { ...process.env, CX_APIKEY: '', CX_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (c) => reject(new Error(`server exited early (${c})`)));
    child.stdout.on('data', (d) => String(d).includes(String(port)) && resolve());
  });
});

after(() => {
  child?.removeAllListeners('exit');
  child?.kill();
  if (cacheDir) fs.rmSync(cacheDir, { recursive: true, force: true });
});

test('rejects an attacker-controlled Host on a wildcard bind (DNS rebinding)', async () => {
  assert.equal(await status(`evil.example.com:${port}`), 421);
  assert.equal(await status(`127.0.0.1.evil.example.com:${port}`), 421);
  assert.equal(await status('evil.example.com'), 421);
  assert.equal(await status(''), 421);
});

test('rejects a loopback Host with the wrong port', async () => {
  assert.equal(await status(`127.0.0.1:${port + 1}`), 421);
});

test('accepts loopback Host headers', async () => {
  assert.equal(await status(`127.0.0.1:${port}`), 204);
  assert.equal(await status(`localhost:${port}`), 204);
});

test('accepts a local interface address on a wildcard bind', async () => {
  const v4 = Object.values(os.networkInterfaces())
    .flat()
    .find((a) => a && a.family !== 'IPv6' && a.family !== 6);
  if (!v4) return;
  assert.equal(await status(`${v4.address}:${port}`), 204);
});

// Fetch the bootstrap page by connecting to `connectHost` (the peer address the server sees is the
// connection's source address, which is not loopback when we connect to a non-loopback interface).
const page = (connectHost, hostHeader) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: connectHost, port, path: '/', headers: { Host: hostHeader, 'Accept-Encoding': 'identity' } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      })
      .on('error', reject);
  });

test('serves the session token to a loopback client', async () => {
  const r = await page('127.0.0.1', `127.0.0.1:${port}`);
  assert.equal(r.status, 200);
  assert.match(r.body, /"token":"[0-9a-f]+"/);
});

test('does not hand the session token to a non-loopback client on a wildcard bind', async () => {
  const v4 = Object.values(os.networkInterfaces())
    .flat()
    .find((a) => a && a.family !== 'IPv6' && a.family !== 6 && !a.internal);
  if (!v4) return;
  const r = await page(v4.address, `${v4.address}:${port}`);
  assert.equal(r.status, 403);
  assert.ok(!/"token":"[0-9a-f]+"/.test(r.body));
});
