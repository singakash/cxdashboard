#!/usr/bin/env node
/**
 * Checkmarx One Value Dashboard — standalone local tool.
 *
 *   node cxone-dashboard.mjs [--port 8787] [--no-open] [--base-url URL] [--iam-url URL] [--tenant NAME]
 *
 * Zero dependencies (Node.js >= 18). Starts a local web server bound to 127.0.0.1 that
 *   1. serves the dashboard UI,
 *   2. exchanges your Checkmarx One API key for short-lived access tokens (kept in memory only),
 *   3. performs READ-ONLY GET calls against the Checkmarx One REST API and aggregates the results.
 * The browser never talks to Checkmarx One directly (CORS), and never sees the access token.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION = '1.0.0';
const EMBEDDED_HTML = /*__EMBED_HTML__*/ null;
const EMBEDDED_VENDOR = /*__EMBED_VENDOR__*/ null;

// ----------------------------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : def;
};

if (flag('help') || flag('h')) {
  console.log(`
Checkmarx One Value Dashboard v${VERSION}

Usage: node cxone-dashboard.mjs [options]

Options
  --port <n>          Local port (default 8787, falls forward if busy)
  --host <ip>         Bind address (default 127.0.0.1)
  --no-open           Do not open the browser automatically
  --base-url <url>    Checkmarx One API base URL (e.g. https://eu.ast.checkmarx.net) — auto-detected from the key
  --iam-url <url>     Checkmarx One IAM URL (e.g. https://eu.iam.checkmarx.net) — auto-detected from the key
  --tenant <name>     Tenant name — auto-detected from the key
  --concurrency <n>   Parallel API requests (default 6)
  --cache-dir <dir>   Where scan summaries and UI libraries are cached (default ~/.cxone-dashboard)
  --no-cache          Do not persist scan-summary counters to disk
  --help              Show this help

Environment
  CX_APIKEY           API key to connect automatically on start (preferred over passing it on the command line)
  CX_BASE_URI, CX_BASE_AUTH_URI, CX_TENANT   Same as --base-url / --iam-url / --tenant
  NODE_EXTRA_CA_CERTS Path to a corporate root CA bundle (TLS inspection proxies)
`);
  process.exit(0);
}

const CONFIG = {
  port: Number(opt('port', process.env.PORT || 8787)),
  host: opt('host', '127.0.0.1'),
  open: !flag('no-open'),
  baseUrl: opt('base-url', process.env.CX_BASE_URI || ''),
  iamUrl: opt('iam-url', process.env.CX_BASE_AUTH_URI || process.env.CX_BASE_IAM_URI || ''),
  tenant: opt('tenant', process.env.CX_TENANT || ''),
  apiKey: opt('api-key', process.env.CX_APIKEY || process.env.CX_API_KEY || ''),
  concurrency: Math.max(1, Math.min(16, Number(opt('concurrency', 6)))),
  cacheDir: opt('cache-dir', path.join(os.homedir(), '.cxone-dashboard')),
  diskCache: !flag('no-cache'),
};

const REGIONS = {
  US: { ast: 'https://ast.checkmarx.net', iam: 'https://iam.checkmarx.net' },
  US2: { ast: 'https://us.ast.checkmarx.net', iam: 'https://us.iam.checkmarx.net' },
  EU: { ast: 'https://eu.ast.checkmarx.net', iam: 'https://eu.iam.checkmarx.net' },
  EU2: { ast: 'https://eu-2.ast.checkmarx.net', iam: 'https://eu-2.iam.checkmarx.net' },
  DEU: { ast: 'https://deu.ast.checkmarx.net', iam: 'https://deu.iam.checkmarx.net' },
  ANZ: { ast: 'https://anz.ast.checkmarx.net', iam: 'https://anz.iam.checkmarx.net' },
  IND: { ast: 'https://ind.ast.checkmarx.net', iam: 'https://ind.iam.checkmarx.net' },
  SNG: { ast: 'https://sng.ast.checkmarx.net', iam: 'https://sng.iam.checkmarx.net' },
  UAE: { ast: 'https://mea.ast.checkmarx.net', iam: 'https://mea.iam.checkmarx.net' },
};

// Origins an operator explicitly configured on the command line / environment (trusted, not request input).
const TRUSTED_ORIGINS = new Set(
  [...Object.values(REGIONS).flatMap((r) => [r.ast, r.iam]), CONFIG.iamUrl, CONFIG.baseUrl]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .map((x) => {
      try {
        return new URL(x).origin;
      } catch {
        return '';
      }
    })
    .filter(Boolean),
);

// UI libraries (loaded lazily by the browser through this server, cached on disk).
const VENDOR = {
  'tabler.min.css': 'npm/@tabler/core@1.0.0/dist/css/tabler.min.css',
  'tabler.rtl.min.css': 'npm/@tabler/core@1.0.0/dist/css/tabler.rtl.min.css',
  'tabler.min.js': 'npm/@tabler/core@1.0.0/dist/js/tabler.min.js',
  'apexcharts.min.js': 'npm/apexcharts@3.54.1/dist/apexcharts.min.js',
  'pptxgen.bundle.js': 'npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
  'jspdf.umd.min.js': 'npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
  'html2canvas.min.js': 'npm/html2canvas@1.4.1/dist/html2canvas.min.js',
};
const VENDOR_MIRRORS = ['https://cdn.jsdelivr.net/', 'https://unpkg.com/'];

// ----------------------------------------------------------------------------------------------
// State (in memory only — credentials and tokens are never written to disk)
// ----------------------------------------------------------------------------------------------
const SESSION_TOKEN = randomBytes(24).toString('hex');
// Digest of the token, compared in constant time (equal-length buffers) against the digest of the presented header.
const SESSION_TOKEN_DIGEST = createHash('sha256').update(SESSION_TOKEN).digest();
const S = {
  auth: null, // { type:'apikey', apiKey } | { type:'client', clientId, clientSecret }
  tenant: '',
  iamUrl: '',
  astUrl: '',
  astUrlPinned: false,
  token: null,
  tokenExp: 0,
  tokenPromise: null,
  job: null,
  dataset: null,
  stats: { requests: 0, errors: 0 },
  resultsMode: 'repeat', // how array query params are accepted by /api/results
  summaryCache: new Map(),
  summaryCacheDirty: false,
};

class HttpError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (n) => Math.min(15000, 500 * 2 ** n + Math.random() * 300);
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

function decodeJwt(t) {
  try {
    const p = String(t).split('.')[1];
    return JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function deriveFromApiKey(apiKey) {
  const c = decodeJwt(apiKey);
  if (!c?.iss) return {};
  try {
    const u = new URL(c.iss);
    const tenant = (u.pathname.match(/\/auth\/realms\/([^/]+)/) || [])[1] || '';
    const iamUrl = u.origin;
    const astUrl = u.origin.replace('://iam.', '://ast.').replace('.iam.', '.ast.');
    return { tenant: decodeURIComponent(tenant), iamUrl, astUrl, expires: c.exp ? c.exp * 1000 : null };
  } catch {
    return {};
  }
}

const trimUrl = (u) => String(u || '').trim().replace(/\/+$/, '');

// ----------------------------------------------------------------------------------------------
// Checkmarx One API client
// ----------------------------------------------------------------------------------------------
async function getToken(force = false) {
  if (!S.auth) throw new HttpError(401, 'Not connected');
  if (!force && S.token && Date.now() < S.tokenExp - 60_000) return S.token;
  if (S.tokenPromise) return S.tokenPromise;
  S.tokenPromise = (async () => {
    const body =
      S.auth.type === 'client'
        ? new URLSearchParams({ grant_type: 'client_credentials', client_id: S.auth.clientId, client_secret: S.auth.clientSecret })
        : new URLSearchParams({ grant_type: 'refresh_token', client_id: 'ast-app', refresh_token: S.auth.apiKey });
    // SSRF guard at the sink (defence in depth, mirrors the check in connect()): re-parse the stored IAM
    // endpoint with the WHATWG parser and only send credentials to https on a Checkmarx host, an
    // operator-configured origin, or plain http on loopback. The token URL is then resolved against the
    // parsed origin, so the tenant segment can never change the host.
    let iam;
    try {
      iam = new URL(S.iamUrl);
    } catch {
      throw new HttpError(400, 'Invalid IAM/API URL.');
    }
    const iamLoopback = iam.protocol === 'http:' && (iam.hostname === '127.0.0.1' || iam.hostname === 'localhost');
    const iamCheckmarx = iam.protocol === 'https:' && (iam.hostname === 'checkmarx.net' || iam.hostname.endsWith('.checkmarx.net'));
    if (iam.username || iam.password || !(iamLoopback || iamCheckmarx || TRUSTED_ORIGINS.has(iam.origin)))
      throw new HttpError(400, `The host "${iam.hostname}" is not an allowed Checkmarx One endpoint.`);
    const url = new URL(`/auth/realms/${encodeURIComponent(S.tenant)}/protocol/openid-connect/token`, iam.origin).href;
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
        redirect: 'error', // never forward credentials to a redirect target
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new HttpError(502, `Cannot reach ${new URL(url).host} (${e.cause?.code || e.message}). Check the region, network or proxy settings.`);
    }
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      let msg = `Authentication failed (HTTP ${r.status}).`;
      if (r.status === 400 || r.status === 401) msg = 'Authentication failed — the API key / client credentials are invalid, expired or belong to another tenant.';
      if (r.status === 404) msg = `Tenant "${S.tenant}" was not found on ${new URL(url).host}. Check the tenant name and region.`;
      throw new HttpError(401, msg, txt.slice(0, 300));
    }
    const j = await r.json();
    S.token = j.access_token;
    S.tokenExp = Date.now() + (Number(j.expires_in) || 1800) * 1000;
    const claims = decodeJwt(S.token) || {};
    if (!S.astUrlPinned && claims['ast-base-url']) S.astUrl = trimUrl(claims['ast-base-url']);
    return S.token;
  })();
  try {
    return await S.tokenPromise;
  } finally {
    S.tokenPromise = null;
  }
}

function buildUrl(pathname, params = {}) {
  const url = new URL(S.astUrl + pathname);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (S.resultsMode === 'comma' && k !== 'scan-ids') url.searchParams.set(k, v.join(','));
      else v.forEach((x) => url.searchParams.append(k, x));
    } else url.searchParams.set(k, String(v));
  }
  return url;
}

/** Read-only GET against the Checkmarx One API with token refresh, retry and back-off. */
async function cx(pathname, params = {}, { retries = 4 } = {}) {
  const url = buildUrl(pathname, params);
  let attempt = 0;
  let refreshed = false;
  for (;;) {
    const token = await getToken(false);
    let r;
    try {
      r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json; version=1.0', 'User-Agent': `cxone-value-dashboard/${VERSION}` },
        signal: AbortSignal.timeout(90_000),
      });
    } catch (e) {
      if (attempt++ < retries) {
        await sleep(backoff(attempt));
        continue;
      }
      S.stats.errors++;
      throw new HttpError(502, `Network error calling ${pathname}: ${e.cause?.code || e.message}`);
    }
    S.stats.requests++;
    if (r.status === 401 && !refreshed) {
      refreshed = true;
      await getToken(true);
      continue;
    }
    if ((r.status === 429 || r.status >= 500) && attempt++ < retries) {
      const ra = Number(r.headers.get('retry-after'));
      await sleep(ra > 0 ? ra * 1000 : backoff(attempt));
      continue;
    }
    if (!r.ok) {
      S.stats.errors++;
      const txt = await r.text().catch(() => '');
      throw new HttpError(r.status, `${pathname} → HTTP ${r.status}`, txt.slice(0, 300));
    }
    const text = await r.text();
    return text ? JSON.parse(text) : {};
  }
}

/** Offset/limit paginator that is robust to server-side limit caps. */
async function paginate(pathname, key, params = {}, { limit = 100, max = Infinity, onPage, stopWhen } = {}) {
  const out = [];
  let offset = 0;
  let firstId = null;
  for (;;) {
    const j = await cx(pathname, { ...params, offset, limit });
    const items = Array.isArray(j) ? j : j[key] || [];
    const total = j.filteredTotalCount ?? j.totalCount ?? null;
    if (!items.length) break;
    if (offset > 0 && items[0]?.id && items[0].id === firstId) break; // offset ignored by server
    if (offset === 0) firstId = items[0]?.id;
    out.push(...items);
    offset += items.length;
    onPage?.(out.length, total);
    if (total !== null && offset >= total) break;
    if (out.length >= max) break;
    if (stopWhen && stopWhen(items)) break;
    if (S.job?.cancel) throw new HttpError(499, 'Cancelled');
  }
  return out;
}

/** Simple promise pool. */
async function pool(items, worker, concurrency = CONFIG.concurrency, onDone) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  const run = async () => {
    while (next < items.length) {
      if (S.job?.cancel) throw new HttpError(499, 'Cancelled');
      const i = next++;
      results[i] = await worker(items[i], i);
      onDone?.(++done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

// ----------------------------------------------------------------------------------------------
// Normalisation helpers (defensive: tolerate API shape variations between tenant versions)
// ----------------------------------------------------------------------------------------------
const SEV = (s) => {
  s = String(s || '').toUpperCase();
  if (s.startsWith('CRIT')) return 'C';
  if (s === 'HIGH') return 'H';
  if (s === 'MEDIUM') return 'M';
  if (s === 'LOW') return 'L';
  if (s.startsWith('INFO')) return 'I';
  return null;
};
const n = (x) => Number(x?.counter ?? x?.count ?? x?.value ?? 0) || 0;
const ENGINE_KEY = {
  sastCounters: 'sast',
  scaCounters: 'sca',
  kicsCounters: 'kics',
  apiSecCounters: 'apisec',
  scaContainersCounters: 'containers',
  containersCounters: 'containers',
  microEnginesCounters: 'micro',
  secretDetectionCounters: 'secrets',
  sscsCounters: 'secrets',
};

function compactEngine(o) {
  const sev = {};
  for (const x of o.severityCounters || o.severityVulnerabilitiesCounters || []) {
    const k = SEV(x.severity);
    if (k) sev[k] = (sev[k] || 0) + n(x);
  }
  const st = {};
  for (const x of o.statusCounters || o.statusVulnerabilitiesCounters || []) st[String(x.status).toUpperCase()] = n(x);
  const ss = {};
  for (const x of o.severityStatusCounters || []) {
    const k = SEV(x.severity);
    if (!k) continue;
    const s = String(x.status).toUpperCase();
    (ss[k] ||= {})[s] = (ss[k][s] || 0) + n(x);
  }
  const state = {};
  for (const x of o.stateCounters || o.stateVulnerabilitiesCounters || []) state[String(x.state).toUpperCase()] = n(x);
  const sumSev = Object.values(sev).reduce((a, b) => a + b, 0);
  const total = Number(o.totalCounter ?? o.totalVulnerabilitiesCounter ?? sumSev) || sumSev;
  const out = { sev, total };
  if (Object.keys(st).length) out.st = st;
  if (Object.keys(ss).length) out.ss = ss;
  if (Object.keys(state).length) out.state = state;
  if (o.filesScannedCounter) out.files = o.filesScannedCounter;
  return out;
}

function compactSummary(s, withDetail) {
  const e = {};
  for (const [key, val] of Object.entries(s || {})) {
    if (!val || typeof val !== 'object' || !key.endsWith('Counters') || key === 'scaPackagesCounters') continue;
    const name = ENGINE_KEY[key] || key.replace(/Counters$/, '');
    const c = compactEngine(val);
    if (c.total > 0 || Object.keys(c.sev).length || c.st) e[name] = c;
  }
  const out = { e };
  if (withDetail) {
    const sast = s?.sastCounters || {};
    const q = (sast.queriesCounters || [])
      .map((x) => [String(x.queryName || x.name || x.queryId || '').replace(/_/g, ' '), SEV(x.severity) || 'M', n(x)])
      .filter((x) => x[0] && x[2] > 0)
      .sort((a, b) => b[2] - a[2])
      .slice(0, 40);
    if (q.length) out.q = q;
    const lang = {};
    for (const x of sast.languageCounters || []) if (x.language) lang[x.language] = n(x);
    if (Object.keys(lang).length) out.lang = lang;
    const comp = {};
    for (const x of sast.complianceCounters || []) if (x.compliance) comp[x.compliance] = n(x);
    if (Object.keys(comp).length) out.comp = comp;
    const k = s?.kicsCounters || {};
    const plat = {};
    for (const x of k.platformSummary || []) if (x.platform) plat[x.platform] = n(x);
    if (Object.keys(plat).length) out.plat = plat;
    const cat = {};
    for (const x of k.categorySummary || []) if (x.category) cat[x.category] = n(x);
    if (Object.keys(cat).length) out.cat = cat;
    const p = s?.scaPackagesCounters;
    if (p) {
      out.pkg = { total: Number(p.totalCounter) || 0, outdated: Number(p.outdatedCounter) || 0 };
      const lic = {};
      for (const x of p.licenseCounters || []) if (x.license) lic[x.license] = n(x);
      if (Object.keys(lic).length) out.pkg.lic = lic;
    }
  }
  return out;
}

function compactScan(s) {
  const eng = {};
  for (const d of s.statusDetails || []) if (d?.name) eng[String(d.name).toLowerCase()] = d.status;
  const engines = (s.engines && s.engines.length ? s.engines : Object.keys(eng)).map((x) => String(x).toLowerCase());
  const loc = (s.statusDetails || []).reduce((a, d) => a + (Number(d.loc) || 0), 0);
  const cfg = (s.metadata?.configs || []).find((c) => c?.type === 'sast');
  return {
    id: s.id,
    p: s.projectId,
    b: s.branch || '',
    c: s.createdAt,
    u: s.updatedAt,
    s: s.status,
    e: engines,
    es: eng,
    o: s.sourceOrigin || '',
    t: s.sourceType || s.metadata?.type || '',
    i: s.initiator ? sha(s.initiator).slice(0, 12) : '',
    loc: loc || undefined,
    inc: cfg?.value?.incremental === 'true' || cfg?.value?.incremental === true ? 1 : undefined,
  };
}

function compactProject(p) {
  return {
    id: p.id,
    name: p.name,
    groups: p.groups || [],
    tags: p.tags || {},
    crit: Number(p.criticality) || 3,
    apps: p.applicationIds || [],
    created: p.createdAt,
    mainBranch: p.mainBranch || '',
    origin: p.origin || '',
  };
}

function compactResult(r) {
  const d = r.data || {};
  const v = r.vulnerabilityDetails || {};
  const node = (Array.isArray(d.nodes) && d.nodes[0]) || {};
  const type = String(r.type || 'unknown').toLowerCase();
  const pkg = d.packageIdentifier || (d.packageName ? `${d.packageName}${d.packageVersion ? '@' + d.packageVersion : ''}` : '');
  const cve = v.cveName || (/^CVE-/i.test(String(r.id || '')) ? r.id : '');
  const cwe = v.cweId ? String(v.cweId).replace(/^CWE-/i, '') : '';
  const title =
    (d.queryName && String(d.queryName).replace(/_/g, ' ')) ||
    d.ruleName ||
    d.title ||
    cve ||
    String(r.description || '').slice(0, 90) ||
    type;
  return {
    k: `${type}|${r.similarityId ?? r.id ?? title}|${pkg}`,
    t: type,
    s: SEV(r.severity) || 'M',
    st: String(r.state || 'TO_VERIFY').toUpperCase(),
    title,
    cwe,
    cve,
    cvss: Number(v.cvssScore ?? v.cvss?.score ?? v.cvss?.baseScore) || undefined,
    file: node.fileName || d.filename || d.fileName || d.file || '',
    line: Number(node.line || d.line) || undefined,
    pkg,
    rec: d.recommendedVersion || undefined,
    lang: d.languageName || undefined,
    img: d.imageName ? `${d.imageName}${d.imageTag ? ':' + d.imageTag : ''}` : undefined,
    ff: r.firstFoundAt || r.created || undefined,
    exp: d.exploitableMethods?.length ? 1 : undefined,
  };
}

// ----------------------------------------------------------------------------------------------
// Disk cache for scan summaries (counts only — no source code, no finding details)
// ----------------------------------------------------------------------------------------------
const cacheFile = () => path.join(CONFIG.cacheDir, 'cache', `${sha(S.tenant + '|' + S.astUrl).slice(0, 16)}-summaries.json.gz`);
async function loadSummaryCache() {
  S.summaryCache = new Map();
  if (!CONFIG.diskCache) return;
  try {
    const raw = zlib.gunzipSync(await fsp.readFile(cacheFile())).toString('utf8');
    for (const [k, v] of Object.entries(JSON.parse(raw))) S.summaryCache.set(k, v);
  } catch {
    /* no cache yet */
  }
}
async function saveSummaryCache() {
  if (!CONFIG.diskCache || !S.summaryCacheDirty) return;
  try {
    await fsp.mkdir(path.dirname(cacheFile()), { recursive: true });
    const obj = Object.fromEntries(S.summaryCache);
    await fsp.writeFile(cacheFile(), zlib.gzipSync(JSON.stringify(obj)));
    S.summaryCacheDirty = false;
  } catch (e) {
    console.warn('  ! Could not write cache:', e.message);
  }
}

// ----------------------------------------------------------------------------------------------
// Collector
// ----------------------------------------------------------------------------------------------
const PHASES = [
  ['projects', 4],
  ['applications', 2],
  ['scans', 20],
  ['summaries', 50],
  ['findings', 24],
];

function progress(phase, frac, msg) {
  const j = S.job;
  if (!j) return;
  let base = 0;
  for (const [p, w] of PHASES) {
    if (p === phase) {
      j.pct = Math.min(99, Math.round(base + w * Math.max(0, Math.min(1, frac))));
      break;
    }
    base += w;
  }
  j.phase = phase;
  if (msg !== undefined) j.msg = msg;
}

async function collect(o) {
  const months = Math.max(1, Math.min(36, Number(o.months) || 12));
  const deepProjects = Math.max(0, Math.min(500, Number(o.deepProjects ?? 25)));
  const deepScans = Math.max(2, Math.min(24, Number(o.deepScans ?? 6)));
  const maxScansPerProject = Math.max(5, Math.min(500, Number(o.maxScansPerProject ?? 60)));
  const maxScans = Math.max(1000, Math.min(500000, Number(o.maxScans ?? 100000)));
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - months);
  const t0 = Date.now();
  const warnings = [];
  const job = S.job;
  job.counts = {};
  await loadSummaryCache();

  // 1) Projects --------------------------------------------------------------------------------
  progress('projects', 0, 'Loading projects…');
  const projects = (
    await paginate('/api/projects/', 'projects', {}, { limit: 100, onPage: (c, t) => progress('projects', t ? c / t : 0.5, `Projects: ${c}${t ? ' / ' + t : ''}`) })
  ).map(compactProject);
  job.counts.projects = projects.length;

  // 2) Applications (optional — needs the applications permission) -----------------------------
  progress('applications', 0, 'Loading applications…');
  let applications = [];
  try {
    applications = (await paginate('/api/applications', 'applications', {}, { limit: 100 })).map((a) => ({
      id: a.id,
      name: a.name,
      crit: Number(a.criticality) || 3,
      projectIds: a.projectIds || [],
      tags: a.tags || {},
    }));
  } catch (e) {
    warnings.push(`Applications could not be loaded (${e.status || ''} ${e.message}). Application filters are disabled.`);
  }
  job.counts.applications = applications.length;
  const appsByProject = new Map();
  for (const a of applications) for (const pid of a.projectIds) appsByProject.set(pid, [...(appsByProject.get(pid) || []), a.id]);
  for (const p of projects) if (!p.apps.length && appsByProject.has(p.id)) p.apps = appsByProject.get(p.id);

  // 3) Scans in the analysis window ------------------------------------------------------------
  progress('scans', 0, 'Loading scan history…');
  const fromIso = from.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const scanOpts = {
    limit: 100,
    max: maxScans,
    onPage: (c, t) => progress('scans', t ? c / t : Math.min(0.9, c / 5000), `Scans: ${c.toLocaleString('en-US')}${t ? ' / ' + t.toLocaleString('en-US') : ''}`),
    stopWhen: (items) => new Date(items[items.length - 1]?.createdAt) < from,
  };
  let rawScans;
  try {
    rawScans = await paginate('/api/scans/', 'scans', { sort: '-created_at', 'from-date': fromIso }, scanOpts);
  } catch (e) {
    if (e.status !== 400) throw e;
    rawScans = await paginate('/api/scans/', 'scans', { sort: '-created_at' }, scanOpts);
  }
  const scans = rawScans.filter((s) => new Date(s.createdAt) >= from).map(compactScan);
  if (rawScans.length >= maxScans) warnings.push(`Scan history truncated at ${maxScans.toLocaleString('en-US')} scans.`);
  job.counts.scans = scans.length;

  // 4) Primary branch + scan chain per project -------------------------------------------------
  const OK = new Set(['Completed', 'Partial']);
  const byProject = new Map();
  for (const s of scans) if (OK.has(s.s)) (byProject.get(s.p) || byProject.set(s.p, []).get(s.p)).push(s);
  const primary = {};
  const chains = {};
  const latest = {};
  for (const p of projects) {
    const list = byProject.get(p.id);
    if (!list?.length) continue;
    const counts = {};
    for (const s of list) counts[s.b] = (counts[s.b] || 0) + 1;
    let branch = p.mainBranch && counts[p.mainBranch] ? p.mainBranch : null;
    if (!branch) branch = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    primary[p.id] = branch;
    const chain = list
      .filter((s) => s.b === branch)
      .sort((a, b) => new Date(a.c) - new Date(b.c))
      .slice(-maxScansPerProject);
    chains[p.id] = chain.map((s) => s.id);
    latest[p.id] = chain[chain.length - 1].id;
  }

  // Projects with no completed scan in the window: fetch their last completed scan (capped).
  const stale = projects.filter((p) => !latest[p.id]).slice(0, Number(o.maxStale ?? 300));
  const staleScans = [];
  if (stale.length) {
    progress('scans', 0.95, `Checking ${stale.length} projects without recent scans…`);
    await pool(stale, async (p) => {
      try {
        const j = await cx('/api/scans/', { 'project-id': p.id, statuses: 'Completed', sort: '-created_at', limit: 1, offset: 0 });
        const s = (j.scans || [])[0];
        if (s && s.projectId === p.id) {
          const c = compactScan(s);
          staleScans.push(c);
          latest[p.id] = c.id;
          primary[p.id] = c.b;
        }
      } catch {
        /* ignore — treated as never scanned */
      }
    });
  }

  // 5) Scan summaries (counters per engine/severity/status) -------------------------------------
  const latestSet = new Set(Object.values(latest));
  const wanted = new Set([...Object.values(chains).flat(), ...latestSet]);
  const need = [...wanted].filter((id) => {
    const c = S.summaryCache.get(id);
    return !c || (latestSet.has(id) && !c.d);
  });
  job.counts.summaries = wanted.size;
  progress('summaries', 0, `Scan summaries: ${wanted.size - need.length} cached, ${need.length} to fetch…`);
  const summaryParams = (ids, detail) => ({
    'scan-ids': ids,
    'include-severity-status': 'true',
    'include-status-counters': 'true',
    'include-queries': detail ? 'true' : 'false',
    'include-files': 'false',
    'apply-predicates': 'true',
  });
  const fetchSummaries = async (ids, detail) => {
    const j = await cx('/api/scan-summary/', summaryParams(ids, detail));
    const got = new Set();
    for (const s of j.scansSummaries || []) {
      if (!s?.scanId) continue;
      got.add(s.scanId);
      S.summaryCache.set(s.scanId, { ...compactSummary(s, detail), d: detail ? 1 : 0 });
      S.summaryCacheDirty = true;
    }
    return ids.filter((id) => !got.has(id));
  };
  const batches = [];
  const needLatest = need.filter((id) => latestSet.has(id));
  const needOther = need.filter((id) => !latestSet.has(id));
  for (let i = 0; i < needLatest.length; i += 10) batches.push([needLatest.slice(i, i + 10), true]);
  for (let i = 0; i < needOther.length; i += 20) batches.push([needOther.slice(i, i + 20), false]);
  let missing = [];
  await pool(
    batches,
    async ([ids, detail]) => {
      try {
        const left = await fetchSummaries(ids, detail);
        // Some tenants only honour a single scan-ids value: fetch the remainder one by one.
        for (const id of left) {
          const still = await fetchSummaries([id], detail).catch(() => [id]);
          missing.push(...still);
        }
      } catch (e) {
        if (e.status === 499) throw e;
        missing.push(...ids);
      }
    },
    CONFIG.concurrency,
    (d, t) => {
      progress('summaries', d / t, `Scan summaries: ${Math.min(need.length, d * 15).toLocaleString('en-US')} / ${need.length.toLocaleString('en-US')}`);
      if (d % 25 === 0) saveSummaryCache();
    },
  );
  await saveSummaryCache();
  if (missing.length) warnings.push(`${missing.length} scan summaries were unavailable and were skipped.`);
  const summaries = {};
  for (const id of wanted) {
    const c = S.summaryCache.get(id);
    if (c) summaries[id] = c;
  }

  // 6) Deep findings: critical/high results for the riskiest projects, sampled across the window --
  const allScans = [...scans, ...staleScans];
  const scanById = new Map(allScans.map((s) => [s.id, s]));
  const riskOf = (pid) => {
    const sm = summaries[latest[pid]];
    if (!sm) return 0;
    let r = 0;
    for (const e of Object.values(sm.e)) r += (e.sev.C || 0) * 10 + (e.sev.H || 0) * 3;
    return r;
  };
  const histOf = (pid) => {
    let r = 0;
    for (const id of chains[pid] || []) {
      const sm = summaries[id];
      if (sm) for (const e of Object.values(sm.e)) r = Math.max(r, (e.sev.C || 0) * 10 + (e.sev.H || 0) * 3);
    }
    return r;
  };
  const deepIds = projects
    .filter((p) => latest[p.id])
    .map((p) => ({ id: p.id, score: Math.max(riskOf(p.id), histOf(p.id)) * (0.6 + 0.2 * (p.crit || 3)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, deepProjects)
    .map((x) => x.id);

  const deep = { projects: deepIds, open: [], fixed: [], triaged: 0, sampled: {}, severities: ['C', 'H'] };
  const tasks = [];
  for (const pid of deepIds) {
    const chain = (chains[pid] || [latest[pid]]).filter(Boolean);
    const idx = new Set([0, chain.length - 1]);
    for (let k = 1; k < deepScans - 1; k++) idx.add(Math.round((k * (chain.length - 1)) / (deepScans - 1)));
    const sampled = [...idx].filter((i) => i >= 0 && i < chain.length).sort((a, b) => a - b).map((i) => chain[i]);
    deep.sampled[pid] = sampled.map((id) => ({ id, date: scanById.get(id)?.c }));
    for (const id of sampled) tasks.push({ pid, id });
  }
  const resultsByScan = new Map();
  const fetchResults = async (scanId) => {
    const out = [];
    const cap = Number(o.maxResultsPerScan ?? 2500);
    let offset = 0;
    for (;;) {
      let j;
      const base = { 'scan-id': scanId, limit: 500, offset };
      try {
        j = await cx('/api/results/', S.resultsMode === 'none' ? base : { ...base, severity: ['CRITICAL', 'HIGH'] });
      } catch (e) {
        if (e.status === 400 && S.resultsMode === 'repeat') {
          S.resultsMode = 'comma';
          continue;
        }
        if (e.status === 400 && S.resultsMode === 'comma') {
          S.resultsMode = 'none';
          continue;
        }
        throw e;
      }
      const items = j.results || [];
      for (const r of items) {
        const c = compactResult(r);
        if (c.s === 'C' || c.s === 'H') out.push(c);
      }
      offset += items.length;
      if (!items.length || offset >= (j.totalCount ?? 0) || offset >= cap) break;
    }
    return out;
  };
  progress('findings', 0, `Analysing critical & high findings in ${deepIds.length} projects…`);
  let resultsFailed = 0;
  let resultsError = '';
  await pool(
    tasks,
    async (t) => {
      try {
        resultsByScan.set(t.id, await fetchResults(t.id));
      } catch (e) {
        if (e.status === 499) throw e;
        resultsFailed++;
        resultsError ||= `${e.status || ''} ${e.message}`.trim();
        resultsByScan.set(t.id, null);
      }
    },
    CONFIG.concurrency,
    (d, tot) => progress('findings', d / tot, `Findings: ${d} / ${tot} scans analysed`),
  );
  deep.resultsFailed = resultsFailed;
  if (resultsFailed)
    warnings.push(
      `Findings could not be loaded for ${resultsFailed} of ${tasks.length} scans (${resultsError}). MTTR, SLA and remediation stories may be incomplete — the key needs permission to view scan results.`,
    );
  const NE = new Set(['NOT_EXPLOITABLE', 'PROPOSED_NOT_EXPLOITABLE']);
  const DAY = 86_400_000;
  for (const pid of deepIds) {
    const sampled = deep.sampled[pid].filter((x) => resultsByScan.get(x.id));
    if (!sampled.length) continue;
    const sets = sampled.map((x) => new Map(resultsByScan.get(x.id).map((f) => [f.k, f])));
    const last = sets[sets.length - 1];
    const lastScan = sampled[sampled.length - 1];
    for (const f of last.values()) {
      if (NE.has(f.st)) continue;
      deep.open.push({ ...f, p: pid, scan: lastScan.id });
    }
    const seen = new Map();
    sets.forEach((m, i) => {
      for (const [k, f] of m) {
        const e = seen.get(k);
        if (!e) seen.set(k, { f, first: i, last: i });
        else {
          e.last = i;
          e.f = f;
        }
      }
    });
    for (const [k, e] of seen) {
      if (last.has(k)) {
        if (NE.has(last.get(k).st) && !NE.has(sets[e.first].get(k)?.st)) deep.triaged++;
        continue;
      }
      if (NE.has(e.f.st)) continue;
      const fixedAt = sampled[e.last + 1]?.date;
      const firstScanDate = sampled[e.first]?.date;
      const detected = e.f.ff && new Date(e.f.ff) < new Date(firstScanDate) ? e.f.ff : firstScanDate;
      deep.fixed.push({
        ...e.f,
        p: pid,
        detected,
        fixedAt,
        ttr: fixedAt && detected ? Math.max(0, Math.round((new Date(fixedAt) - new Date(detected)) / DAY)) : undefined,
      });
    }
  }
  const capOpen = Number(o.maxOpenFindings ?? 6000);
  if (deep.open.length > capOpen) {
    deep.open.sort((a, b) => (a.s === b.s ? 0 : a.s === 'C' ? -1 : 1));
    deep.open.length = capOpen;
  }

  const ds = {
    version: 1,
    source: 'live',
    generatedAt: new Date().toISOString(),
    tool: VERSION,
    tenant: { name: S.tenant, astUrl: S.astUrl },
    period: { from: from.toISOString(), to: to.toISOString(), months },
    projects,
    applications,
    scans: allScans,
    primary,
    chains,
    latest,
    summaries,
    deep,
    warnings,
    stats: { requests: S.stats.requests, ms: Date.now() - t0, resultsMode: S.resultsMode },
  };
  return ds;
}

// ----------------------------------------------------------------------------------------------
// Vendor asset proxy (allow-listed, disk cached)
// ----------------------------------------------------------------------------------------------
const vendorMem = new Map();
async function getVendor(name) {
  if (vendorMem.has(name)) return vendorMem.get(name);
  if (EMBEDDED_VENDOR?.[name]) {
    const buf = zlib.gunzipSync(Buffer.from(EMBEDDED_VENDOR[name], 'base64'));
    vendorMem.set(name, buf);
    return buf;
  }
  const rel = VENDOR[name];
  if (!rel) return null;
  const file = path.join(CONFIG.cacheDir, 'vendor', rel.replace(/[@/]/g, '_'));
  try {
    const buf = await fsp.readFile(file);
    vendorMem.set(name, buf);
    return buf;
  } catch {
    /* not cached */
  }
  for (const mirror of VENDOR_MIRRORS) {
    try {
      const r = await fetch(mirror + rel, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      vendorMem.set(name, buf);
      fsp.mkdir(path.dirname(file), { recursive: true }).then(() => fsp.writeFile(file, buf)).catch(() => {});
      return buf;
    } catch {
      /* try next mirror */
    }
  }
  return null;
}

// ----------------------------------------------------------------------------------------------
// HTTP server
// ----------------------------------------------------------------------------------------------
let APP_HTML = EMBEDDED_HTML;
async function appHtml() {
  if (APP_HTML) return APP_HTML;
  // Development mode: assemble from ./web using the build script.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const { assemble } = await import(pathToFileURL(path.join(here, '..', 'build.mjs')).href);
  return assemble();
}

const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(data);
}

function sendCompressed(req, res, status, buf, headers) {
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && buf.length > 2048;
  const data = gz ? zlib.gzipSync(buf) : buf;
  res.writeHead(status, { ...headers, ...(gz ? { 'Content-Encoding': 'gzip' } : {}), 'Content-Length': data.length, 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
}

async function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Payload too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

let ACTUAL_PORT = CONFIG.port;
function hostAllowed(req) {
  const h = String(req.headers.host || '').toLowerCase();
  // Always allow the loopback names. Never accept an arbitrary Host header: that would enable DNS rebinding
  // even when the server is deliberately bound to a non-loopback address.
  const allowed = new Set(['127.0.0.1', 'localhost', '[::1]']);
  const bound = String(CONFIG.host || '').toLowerCase();
  if (bound === '0.0.0.0' || bound === '::' || bound === '[::]') {
    // Wildcard bind: accept only this machine's own interface addresses and hostname.
    for (const addrs of Object.values(os.networkInterfaces()))
      for (const a of addrs || []) allowed.add(a.family === 'IPv6' || a.family === 6 ? `[${a.address.toLowerCase()}]` : a.address);
    allowed.add(os.hostname().toLowerCase());
  } else if (bound.includes(':')) {
    allowed.add(`[${bound.replace(/^\[|\]$/g, '')}]`);
  } else if (bound) {
    allowed.add(bound);
  }
  return [...allowed].some((name) => h === `${name}:${ACTUAL_PORT}`);
}

async function connect(body) {
  const apiKey = String(body.apiKey || '').trim();
  const clientId = String(body.clientId || '').trim();
  const clientSecret = String(body.clientSecret || '').trim();
  if (!apiKey && !(clientId && clientSecret)) throw new HttpError(400, 'Provide an API key, or an OAuth client ID and secret.');
  const derived = apiKey ? deriveFromApiKey(apiKey) : {};
  const region = REGIONS[String(body.region || '').toUpperCase()];
  const tenant = String(body.tenant || '').trim() || CONFIG.tenant || derived.tenant;
  const iamUrl = trimUrl(body.iamUrl) || (region && region.iam) || trimUrl(CONFIG.iamUrl) || derived.iamUrl;
  const astUrl = trimUrl(body.baseUrl) || (region && region.ast) || trimUrl(CONFIG.baseUrl) || derived.astUrl;
  if (apiKey && !decodeJwt(apiKey) && !String(body.tenant || '').trim() && !CONFIG.tenant)
    throw new HttpError(400, 'This does not look like a Checkmarx One API key. Copy the complete key from Identity and Access Management → API Keys, or use an OAuth client under Advanced.');
  if (!tenant) throw new HttpError(400, 'Tenant name could not be detected — please enter it under Advanced.');
  if (!iamUrl || !astUrl) throw new HttpError(400, 'Region could not be detected — please choose it under Advanced.');
  // SSRF guard: the IAM/AST endpoints may come from the request body or from the (attacker-controllable)
  // `iss` claim of the pasted API key, and the server later sends credentials to them. Parse each URL with
  // the WHATWG parser and only accept: https on a Checkmarx host, an operator-configured origin, or plain
  // http on loopback (local mock). The validated origin is what gets stored and fetched.
  const [safeIamUrl, safeAstUrl] = [iamUrl, astUrl].map((raw) => {
    let u;
    try {
      u = new URL(raw);
    } catch {
      throw new HttpError(400, 'Invalid IAM/API URL.');
    }
    const loopback = u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
    const httpsOk = u.protocol === 'https:';
    const checkmarxHost = u.hostname === 'checkmarx.net' || u.hostname.endsWith('.checkmarx.net');
    if (u.username || u.password || !(loopback || httpsOk)) throw new HttpError(400, 'Only https URLs are allowed.');
    if (!(loopback || checkmarxHost || TRUSTED_ORIGINS.has(u.origin)))
      throw new HttpError(400, `The host "${u.hostname}" is not an allowed Checkmarx One endpoint. Choose a region, or configure the URL with --base-url / --iam-url.`);
    return u.origin;
  });
  Object.assign(S, {
    auth: apiKey ? { type: 'apikey', apiKey } : { type: 'client', clientId, clientSecret },
    tenant,
    iamUrl: safeIamUrl,
    astUrl: safeAstUrl,
    astUrlPinned: Boolean(trimUrl(body.baseUrl) || region || CONFIG.baseUrl),
    token: null,
    tokenExp: 0,
    dataset: null,
    resultsMode: 'repeat',
  });
  try {
    await getToken(true);
    const probe = await cx('/api/projects/', { limit: 1, offset: 0 });
    return {
      tenant: S.tenant,
      astUrl: S.astUrl,
      iamUrl: S.iamUrl,
      projects: probe.totalCount ?? probe.filteredTotalCount ?? null,
      keyExpires: derived.expires || null,
    };
  } catch (e) {
    S.auth = null;
    S.token = null;
    if (e.status === 403) throw new HttpError(403, 'Connected, but the key is not allowed to list projects. The dashboard needs view permissions for projects, applications, scans and results.');
    throw e;
  }
}

function startJob(body) {
  if (!S.auth) throw new HttpError(401, 'Not connected');
  if (S.job?.state === 'running') return S.job;
  S.stats = { requests: 0, errors: 0 };
  S.job = { id: randomBytes(6).toString('hex'), state: 'running', phase: 'projects', pct: 0, msg: 'Starting…', counts: {}, startedAt: Date.now(), cancel: false };
  const job = S.job;
  collect(body)
    .then((ds) => {
      S.dataset = ds;
      job.state = 'done';
      job.pct = 100;
      job.msg = `Done in ${Math.round(ds.stats.ms / 1000)}s (${ds.stats.requests} API calls)`;
      console.log(`  ✓ Data collected: ${ds.projects.length} projects, ${ds.scans.length} scans, ${ds.stats.requests} API calls, ${Math.round(ds.stats.ms / 1000)}s`);
    })
    .catch((e) => {
      job.state = e.status === 499 ? 'cancelled' : 'error';
      job.error = e.message;
      job.detail = e.detail;
      console.error('  ✗ Collection failed:', e.message, e.detail || '');
    });
  return job;
}

const publicJob = (j) => j && { id: j.id, state: j.state, phase: j.phase, pct: j.pct, msg: j.msg, counts: j.counts, error: j.error, detail: j.detail, requests: S.stats.requests };

const server = http.createServer(async (req, res) => {
  try {
    if (!hostAllowed(req)) return send(res, 421, 'Misdirected request');
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      const html = (await appHtml()).replace('__CXD_BOOT__', JSON.stringify({ token: SESSION_TOKEN, version: VERSION }));
      return sendCompressed(req, res, 200, Buffer.from(html), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer' });
    }
    if (req.method === 'GET' && p.startsWith('/vendor/')) {
      const name = p.slice(8);
      const buf = await getVendor(name);
      if (!buf) return send(res, 502, `Could not load ${name}`);
      return sendCompressed(req, res, 200, buf, { 'Content-Type': MIME[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
    }
    if (req.method === 'GET' && p === '/favicon.ico') return send(res, 204, '');

    if (p.startsWith('/local/')) {
      if (!timingSafeEqual(createHash('sha256').update(String(req.headers['x-cxd-token'] || '')).digest(), SESSION_TOKEN_DIGEST)) return send(res, 403, { error: 'Invalid session token' });
      if (req.method === 'GET' && p === '/local/env')
        return send(res, 200, {
          version: VERSION,
          envKey: Boolean(CONFIG.apiKey),
          connected: Boolean(S.auth),
          tenant: S.auth ? S.tenant : null,
          astUrl: S.auth ? S.astUrl : null,
          hasDataset: Boolean(S.dataset),
          job: publicJob(S.job),
          regions: Object.keys(REGIONS),
          diskCache: CONFIG.diskCache,
        });
      if (req.method === 'POST' && p === '/local/connect') {
        const body = await readJson(req);
        if (body.useEnvKey && CONFIG.apiKey) body.apiKey = CONFIG.apiKey;
        return send(res, 200, await connect(body));
      }
      if (req.method === 'POST' && p === '/local/collect') return send(res, 200, publicJob(startJob(await readJson(req))));
      if (req.method === 'GET' && p === '/local/status') return send(res, 200, publicJob(S.job) || { state: 'idle' });
      if (req.method === 'POST' && p === '/local/cancel') {
        if (S.job) S.job.cancel = true;
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && p === '/local/dataset') {
        if (!S.dataset) return send(res, 404, { error: 'No dataset yet' });
        return sendCompressed(req, res, 200, Buffer.from(JSON.stringify(S.dataset)), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      }
      if (req.method === 'POST' && p === '/local/disconnect') {
        Object.assign(S, { auth: null, token: null, tokenExp: 0, dataset: null, job: null });
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/local/clear-cache') {
        S.summaryCache = new Map();
        await fsp.rm(path.join(CONFIG.cacheDir, 'cache'), { recursive: true, force: true }).catch(() => {});
        return send(res, 200, { ok: true });
      }
    }
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    if (status === 500) console.error(e);
    return send(res, status, { error: e.message || 'Unexpected error', detail: e.detail });
  }
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' }).unref();
  } catch {
    /* ignore */
  }
}

async function listen(port, tries = 10) {
  return new Promise((resolve, reject) => {
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE' && tries > 0) resolve(listen(port + 1, tries - 1));
      else reject(e);
    });
    server.listen(port, CONFIG.host, () => resolve(port));
  });
}

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`Node.js 18 or newer is required (found ${process.versions.node}).`);
  process.exit(1);
}

ACTUAL_PORT = await listen(CONFIG.port);
const url = `http://${CONFIG.host === '0.0.0.0' ? '127.0.0.1' : CONFIG.host}:${ACTUAL_PORT}/`;
console.log(`\n  Checkmarx One Value Dashboard v${VERSION}`);
console.log(`  ➜ Open ${url}\n  (Ctrl+C to stop — credentials are kept in memory only)\n`);
if (CONFIG.apiKey) {
  connect({ apiKey: CONFIG.apiKey })
    .then((r) => console.log(`  ✓ Connected to tenant "${r.tenant}" (${r.astUrl}) using the key from the environment.`))
    .catch((e) => console.error(`  ✗ Could not connect with the key from the environment: ${e.message}`));
}
if (CONFIG.open) openBrowser(url);
