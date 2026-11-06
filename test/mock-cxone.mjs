#!/usr/bin/env node
/**
 * Mock Checkmarx One (IAM + AST API) for end-to-end testing of the dashboard without a tenant.
 *
 *   node test/mock-cxone.mjs [--port 9911] [--deny results,applications]
 *   then start the dashboard and paste the printed key (IAM/AST URLs are derived from the key),
 *   or: CX_APIKEY=<printed key> node src/server.mjs
 *
 * --deny answers 403 for the listed endpoints, to test a key with missing permissions.
 *
 * Findings evolve per project from scan to scan (some fixed, some new), and every endpoint is
 * derived from that one model — so scan summaries, NEW/RECURRENT counters and /api/results agree.
 */
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf('--port') + 1]) || 9911;
const DENY = new Set(args.includes('--deny') ? String(args[args.indexOf('--deny') + 1] || '').split(',').map((s) => s.trim()) : []);
const TENANT = 'mock-tenant';
const ORIGIN = `http://127.0.0.1:${PORT}`;
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `${b64u({ alg: 'none', typ: 'JWT' })}.${b64u(claims)}.mock`;
const API_KEY = jwt({ iss: `${ORIGIN}/auth/realms/${TENANT}`, typ: 'Offline', exp: Math.floor(Date.now() / 1000) + 90 * 86400, sub: 'mock-user' });
const TOKENS = new Set();

// ---------- deterministic data model ---------------------------------------------------------
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => ((c === 'x' ? rnd() * 16 : (rnd() * 4) | 8) | 0).toString(16));
const SEVS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const CATALOG = {
  sast: [
    ['SQL_Injection', 'CRITICAL', 89],
    ['Command_Injection', 'CRITICAL', 78],
    ['Stored_XSS', 'HIGH', 79],
    ['Path_Traversal', 'HIGH', 22],
    ['SSRF', 'HIGH', 918],
    ['Open_Redirect', 'MEDIUM', 601],
    ['Log_Forging', 'LOW', 117],
  ],
  sca: [
    ['CVE-2021-44228', 'CRITICAL', 'Maven-org.apache.logging.log4j:log4j-core-2.14.1', '2.17.1', 10],
    ['CVE-2022-22965', 'CRITICAL', 'Maven-org.springframework:spring-beans-5.3.17', '5.3.18', 9.8],
    ['CVE-2020-8203', 'HIGH', 'Npm-lodash-4.17.15', '4.17.21', 7.4],
    ['CVE-2021-3749', 'HIGH', 'Npm-axios-0.21.1', '0.21.2', 7.5],
    ['CVE-2024-29041', 'MEDIUM', 'Npm-express-4.17.1', '4.19.2', 6.1],
  ],
  kics: [
    ['S3 Bucket Allows Public Read', 'CRITICAL'],
    ['Container Running in Privileged Mode', 'HIGH'],
    ['Container Running As Root', 'MEDIUM'],
    ['Image Version Not Pinned', 'LOW'],
  ],
};
const now = Date.now();
const DAY = 86400000;
const apps = [
  { id: uuid(), name: 'Payments', criticality: 5, projectIds: [], tags: {} },
  { id: uuid(), name: 'Customer Web', criticality: 3, projectIds: [], tags: {} },
];
const projects = [];
const scans = [];
const findingsByScan = new Map(); // scanId -> [finding]
const prevByScan = new Map(); // scanId -> Set(keys of previous scan)
let fid = 0;
const newFinding = (engine) => {
  const c = pick(CATALOG[engine]);
  const f = { key: `${engine}-${++fid}`, engine, severity: c[1], firstFoundAt: null };
  if (engine === 'sast') Object.assign(f, { queryName: c[0], cwe: c[2], file: `src/main/java/com/mock/${pick(['Users', 'Orders', 'Auth'])}Controller.java`, line: 10 + Math.floor(rnd() * 400) });
  if (engine === 'sca') Object.assign(f, { cve: c[0], pkg: c[2], rec: c[3], cvss: c[4] });
  if (engine === 'kics') Object.assign(f, { title: c[0], file: 'infra/main.tf', line: 1 + Math.floor(rnd() * 90) });
  return f;
};
for (let i = 0; i < 8; i++) {
  const app = apps[i % 2];
  const p = { id: uuid(), name: `${app.name.toLowerCase().replace(/\s/g, '-')}-svc-${i + 1}`, groups: [app.name], tags: {}, criticality: app.criticality, applicationIds: [app.id], createdAt: new Date(now - 500 * DAY).toISOString(), mainBranch: 'main', origin: 'GitHub' };
  app.projectIds.push(p.id);
  projects.push(p);
  const engines = i === 7 ? ['kics'] : ['sast', 'sca', 'kics'];
  let open = Array.from({ length: 25 + Math.floor(rnd() * 30) }, () => newFinding(pick(engines)));
  open.forEach((f) => (f.firstFoundAt = new Date(now - 420 * DAY).toISOString()));
  let prev = new Set();
  const stale = i === 6; // one project with no scans in the last 6 months
  for (let t = now - 400 * DAY; t < (stale ? now - 200 * DAY : now - DAY); t += (6 + rnd() * 10) * DAY) {
    const id = uuid();
    open = open.filter((f) => rnd() > (f.severity === 'CRITICAL' ? 0.18 : f.severity === 'HIGH' ? 0.1 : 0.04));
    const added = Array.from({ length: Math.floor(rnd() * 4) }, () => newFinding(pick(engines)));
    added.forEach((f) => (f.firstFoundAt = new Date(t).toISOString()));
    open = [...open, ...added];
    findingsByScan.set(id, open.map((f) => ({ ...f, state: rnd() < 0.06 ? 'NOT_EXPLOITABLE' : 'TO_VERIFY' })));
    prevByScan.set(id, prev);
    prev = new Set(open.map((f) => f.key));
    const status = rnd() < 0.04 ? 'Failed' : 'Completed';
    scans.push({ id, projectId: p.id, projectName: p.name, branch: 'main', status, createdAt: new Date(t).toISOString(), updatedAt: new Date(t + 9 * 60000).toISOString(), engines, sourceOrigin: pick(['GitHub Actions', 'Jenkins', 'CLI']), sourceType: 'git', initiator: pick(['alice', 'bob', 'ci-bot']), statusDetails: engines.map((e) => ({ name: e, status, loc: e === 'sast' ? 42000 : 0 })), metadata: { configs: [] } });
    if (rnd() < 0.6) scans.push({ id: uuid(), projectId: p.id, projectName: p.name, branch: `feature/x-${Math.floor(rnd() * 99)}`, status: 'Completed', createdAt: new Date(t + DAY).toISOString(), updatedAt: new Date(t + DAY + 300000).toISOString(), engines, sourceOrigin: 'GitHub Actions', sourceType: 'git', initiator: 'carol', statusDetails: [], metadata: { configs: [] } });
  }
}
scans.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

// ---------- endpoint helpers ------------------------------------------------------------------
const counters = (list) => SEVS.map((s) => ({ severity: s, counter: list.filter((f) => f.severity === s).length })).filter((x) => x.counter);
function summary(scanId) {
  const all = findingsByScan.get(scanId);
  if (!all) return null;
  const prev = prevByScan.get(scanId) || new Set();
  const out = { scanId };
  for (const e of ['sast', 'sca', 'kics']) {
    const list = all.filter((f) => f.engine === e);
    const isNew = (f) => !prev.has(f.key);
    const engine = {
      severityCounters: counters(list),
      statusCounters: [
        { status: 'NEW', counter: list.filter(isNew).length },
        { status: 'RECURRENT', counter: list.filter((f) => !isNew(f)).length },
      ],
      severityStatusCounters: SEVS.flatMap((s) => [
        { severity: s, status: 'NEW', counter: list.filter((f) => f.severity === s && isNew(f)).length },
        { severity: s, status: 'RECURRENT', counter: list.filter((f) => f.severity === s && !isNew(f)).length },
      ]),
      stateCounters: [
        { state: 'TO_VERIFY', counter: list.filter((f) => f.state === 'TO_VERIFY').length },
        { state: 'NOT_EXPLOITABLE', counter: list.filter((f) => f.state === 'NOT_EXPLOITABLE').length },
      ],
      totalCounter: list.length,
    };
    if (e === 'sast') {
      const q = new Map();
      for (const f of list) q.set(f.queryName, { queryName: f.queryName, severity: f.severity, counter: (q.get(f.queryName)?.counter || 0) + 1 });
      engine.queriesCounters = [...q.values()];
      engine.languageCounters = [{ language: 'Java', counter: list.length }];
      engine.complianceCounters = [{ compliance: 'OWASP Top 10 2021', counter: list.length }, { compliance: 'PCI DSS v4.0', counter: Math.round(list.length * 0.7) }];
    }
    if (e === 'kics') engine.platformSummary = [{ platform: 'Terraform', counter: list.length }];
    out[`${e}Counters`] = engine;
  }
  out.scaPackagesCounters = { totalCounter: 140, outdatedCounter: 22 };
  return out;
}
function result(f) {
  const base = { type: f.engine, id: f.cve || f.key, similarityId: f.key, severity: f.severity, state: f.state, status: 'RECURRENT', firstFoundAt: f.firstFoundAt, data: {}, vulnerabilityDetails: {} };
  if (f.engine === 'sast') Object.assign(base, { data: { queryName: f.queryName, languageName: 'Java', nodes: [{ fileName: f.file, line: f.line }] }, vulnerabilityDetails: { cweId: f.cwe } });
  if (f.engine === 'sca') Object.assign(base, { data: { packageIdentifier: f.pkg, recommendedVersion: f.rec }, vulnerabilityDetails: { cveName: f.cve, cvssScore: f.cvss, cweId: 'CWE-502' } });
  if (f.engine === 'kics') Object.assign(base, { type: 'kics', data: { queryName: f.title, filename: f.file, line: f.line } });
  return base;
}
const page = (list, q, key) => {
  const offset = Number(q.get('offset')) || 0;
  const limit = Number(q.get('limit')) || 20;
  return { totalCount: list.length, filteredTotalCount: list.length, [key]: list.slice(offset, offset + limit) };
};

// ---------- server ------------------------------------------------------------------------------
let requests = 0;
const server = http.createServer(async (req, res) => {
  requests++;
  const url = new URL(req.url, ORIGIN);
  const q = url.searchParams;
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'POST' && url.pathname === `/auth/realms/${TENANT}/protocol/openid-connect/token`) {
    let raw = '';
    for await (const c of req) raw += c;
    const form = new URLSearchParams(raw);
    if (form.get('grant_type') !== 'refresh_token' || form.get('client_id') !== 'ast-app' || form.get('refresh_token') !== API_KEY) return send(400, { error: 'invalid_grant', error_description: 'Invalid refresh token' });
    const token = randomBytes(16).toString('hex');
    TOKENS.add(token);
    return send(200, { access_token: jwt({ 'ast-base-url': ORIGIN, tenant_name: TENANT, t: token }), expires_in: 1800, token_type: 'Bearer' });
  }
  const auth = String(req.headers.authorization || '').replace(/^Bearer /, '');
  const claims = (() => {
    try {
      return JSON.parse(Buffer.from(auth.split('.')[1], 'base64url').toString());
    } catch {
      return null;
    }
  })();
  if (!claims || !TOKENS.has(claims.t)) return send(401, { message: 'Unauthorized' });
  if (req.method !== 'GET') return send(405, { message: 'read-only mock' });
  const p = url.pathname.replace(/\/+$/, '');
  if (DENY.has(p.replace(/^\/api\//, ''))) return send(403, { message: 'Forbidden (mock --deny)' });
  if (p === '/api/projects') return send(200, page(projects, q, 'projects'));
  if (p === '/api/applications') return send(200, page(apps, q, 'applications'));
  if (p === '/api/scans') {
    let list = scans;
    if (q.get('project-id')) list = list.filter((s) => s.projectId === q.get('project-id'));
    if (q.get('statuses')) list = list.filter((s) => q.getAll('statuses').flatMap((x) => x.split(',')).includes(s.status));
    if (q.get('from-date')) list = list.filter((s) => new Date(s.createdAt) >= new Date(q.get('from-date')));
    return send(200, page(list, q, 'scans'));
  }
  if (p === '/api/scan-summary') {
    const ids = q.getAll('scan-ids').flatMap((x) => x.split(','));
    const out = ids.map(summary).filter(Boolean);
    return send(200, { scansSummaries: out, totalCount: out.length });
  }
  if (p === '/api/results') {
    const all = findingsByScan.get(q.get('scan-id'));
    if (!all) return send(404, { message: 'scan not found' });
    const sev = q.getAll('severity').flatMap((x) => x.split(','));
    const list = (sev.length ? all.filter((f) => sev.includes(f.severity)) : all).map(result);
    return send(200, page(list, q, 'results'));
  }
  return send(404, { message: `No mock for ${p}` });
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock Checkmarx One listening on ${ORIGIN}  (${projects.length} projects, ${scans.length} scans)`);
  console.log(`API key:\n${API_KEY}`);
});
process.on('SIGINT', () => {
  console.log(`\n${requests} requests served`);
  process.exit(0);
});
