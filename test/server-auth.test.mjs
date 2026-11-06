/**
 * Session-token enforcement on /local/* endpoints.
 *   node --test test/server-auth.test.mjs
 *
 * Starts the real server (src/server.mjs) on a free port, reads the token the way the browser does
 * (from the bootstrapped index page) and checks that /local/* only answers to that exact token.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.mjs');
let child;
let port;
let token;

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port: p } = s.address();
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });

const request = (pathname, headers = {}) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: pathname, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      })
      .on('error', reject);
  });

before(async () => {
  port = await freePort();
  child = spawn(process.execPath, [SERVER, '--port', String(port), '--no-open', '--no-cache', '--cache-dir', path.join(os.tmpdir(), 'cxd-auth-test')], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, CX_APIKEY: '' },
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.on('data', (d) => String(d).includes('Open http') && resolve());
  });
  const page = await request('/', { 'Accept-Encoding': 'identity' });
  token = /"token":"([0-9a-f]+)"/.exec(page.body)?.[1];
  assert.ok(token, 'bootstrap page exposes the session token');
});

after(() => child?.kill());

test('/local/* rejects a missing token', async () => {
  assert.equal((await request('/local/env')).status, 403);
});

test('/local/* rejects a wrong token of the same length', async () => {
  const wrong = token.replace(/./, (c) => (c === 'a' ? 'b' : 'a'));
  assert.equal((await request('/local/env', { 'X-CXD-Token': wrong })).status, 403);
});

test('/local/* rejects a wrong token of a different length and a prefix of the real one', async () => {
  assert.equal((await request('/local/env', { 'X-CXD-Token': 'x' })).status, 403);
  assert.equal((await request('/local/env', { 'X-CXD-Token': token.slice(0, -1) })).status, 403);
  assert.equal((await request('/local/env', { 'X-CXD-Token': token + '0' })).status, 403);
});

test('/local/* accepts the real session token', async () => {
  const r = await request('/local/env', { 'X-CXD-Token': token });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).connected, false);
});
