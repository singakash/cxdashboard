/* ============================================================================================
 * app.js — application shell: setup → data collection → persona dashboards, routing, settings,
 * event delegation, snapshot import/export. All UI is built with h() (DOM APIs only).
 * ========================================================================================== */
const App = { env: null, conn: null, ds: null, M: null, persona: 'ciso', filter: { app: '' }, settingsTab: 'general', screen: 'boot', poll: null, warnShown: null };
const PAGE_FN = { ciso: pageCiso, cio: pageCio, architect: pageArchitect, lead: pageLead, dev: pageDev, roi: pageRoi };
const PERIODS = [3, 6, 12, 24];
const root = () => $('#app');

function applyTheme() {
  document.documentElement.setAttribute('data-bs-theme', Store.s.theme === 'dark' ? 'dark' : 'light');
  document.documentElement.lang = Store.s.lang;
  applyDirection();
}
/** Right-to-left languages: set dir and switch to Tabler's RTL build. The previous stylesheet
 *  stays active until the new one has loaded, so the page never renders unstyled. */
function applyDirection() {
  const want = isRtl() ? 'tabler.rtl.min.css' : 'tabler.min.css';
  document.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
  return loadAsset(want).then(() => {
    for (const l of $$('link[data-asset^="tabler"]')) l.disabled = l.dataset.asset !== want;
  });
}
const isDark = () => Store.s.theme === 'dark';
const logo = () => (isDark() ? ASSETS.logoWhite : ASSETS.logoViolet);
function setBusy(btn, on, label) {
  if (!btn) return;
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.replaceChildren(h('span.spinner-border.spinner-border-sm.me-2', { role: 'status', 'aria-hidden': 'true' }), label || t('Working…'));
  } else {
    btn.disabled = false;
  }
}
function errorAlert(err) {
  if (!err) return null;
  const detail = typeof err.detail === 'string' ? err.detail : err.detail ? JSON.stringify(err.detail) : '';
  return D('alert alert-danger d-flex gap-2', icon('alert'), h('div', D('fw-bold', err.message || String(err)), detail ? D('small text-secondary mt-1 text-break', truncate(detail, 400)) : null));
}
const langPicker = () => h('select.form-select.form-select-sm.lang-picker', { 'data-setting': 'lang', 'data-type': 'str', 'aria-label': t('Language') }, Object.entries(LANGS).map(([v, l]) => option(v, l, Store.s.lang === v)));
const themeButton = () => h('button.btn.btn-icon.btn-ghost-secondary.rounded-pill', { type: 'button', 'data-action': 'theme', title: isDark() ? t('Light mode') : t('Dark mode'), 'aria-label': isDark() ? t('Light mode') : t('Dark mode') }, icon(isDark() ? 'sun' : 'moon'));
const iconBtn = (ic, label, action) => h('button.btn.btn-icon.btn-ghost-secondary.rounded-pill', { type: 'button', 'data-action': action, title: label, 'aria-label': label }, icon(ic));

/* ---------- Setup ------------------------------------------------------------------------- */
function renderSetup(error) {
  App.screen = 'setup';
  clearTimeout(App.poll);
  Charts.destroyAll();
  closeSettings();
  const env = App.env;
  const S = Store.s;
  const regions = env?.regions || ['US', 'US2', 'EU', 'EU2', 'DEU', 'ANZ', 'IND', 'SNG', 'UAE'];
  const feature = (ic, title, text) => D('setup-feature', Sp('setup-feature-icon', icon(ic)), h('div', D('setup-feature-title', title), D('setup-feature-text', text)));
  const field = (id, label, input, hint) => D('mb-3', h('label.form-label', { for: id }, label), input, hint ? h('div.form-hint', { id: `${id}-hint` }, hint) : null);
  const text = (id, placeholder, type = 'text') => h('input.form-control', { id, type, placeholder, autocomplete: 'off', spellcheck: 'false' });
  const select = (id, opts, selected) => h('select.form-select', { id }, opts.map(([v, l]) => option(v, l, String(v) === String(selected))));

  const brand = D(
    'setup-brand',
    h('img.setup-element', { src: ASSETS.elementDark, alt: '', 'aria-hidden': 'true' }),
    h('img.setup-logo', { src: ASSETS.logoWhite, alt: 'Checkmarx' }),
    D(
      'setup-brand-body',
      D('setup-eyebrow', t('Checkmarx One · Value Dashboard')),
      h('h1.setup-title', t('Prove the value of your application security program')),
      h('p.setup-lead', t('Turn your Checkmarx One scan data into risk, ROI and remediation insights for every stakeholder, then export board-ready reports in one click.')),
      D(
        'setup-features',
        feature('shield-check', t('Risk avoided, quantified'), t('Financial and reputational exposure removed by every remediated vulnerability.')),
        feature('users', t('Built for every persona'), t('CISO, CIO, security architects, team leads and developers.')),
        feature('presentation', t('Board-ready exports'), t('Native PowerPoint and PDF reports, branded and editable.')),
        feature('lock', t('Private by design'), t('Runs on your machine. Read-only API calls; the key is held in memory only.')),
      ),
    ),
  );
  const form = h(
    'form.setup-form#connect-form',
    { autocomplete: 'off', novalidate: true },
    D('d-flex align-items-center gap-2 mb-1', h('h2.setup-form-title.m-0', t('Connect to Checkmarx One')), D('ms-auto d-flex gap-2 align-items-center', langPicker(), themeButton())),
    h('p.text-secondary.mb-4', t('Paste an API key to analyse your tenant. Data is read live; nothing is stored outside this machine.')),
    h('div#setup-error', errorAlert(error)),
    env ? null : D('alert alert-warning', t('The local server is not reachable. Start the tool with “node cxone-dashboard.mjs” to connect a tenant. Demo data and snapshots still work.')),
    env?.envKey
      ? D('env-key-card', Sp('env-key-icon', icon('key')), h('div.flex-fill', D('fw-bold', t('API key found in environment')), D('text-secondary small', 'CX_APIKEY')), h('button.btn.btn-primary.rounded-pill', { type: 'button', 'data-action': 'connect-env' }, t('Use it')))
      : null,
    field('f-key', t('API key'), D('input-group input-group-flat', h('input.form-control.font-monospace.key-input#f-key', { type: 'password', placeholder: 'eyJhbGciOiJIUzUxMiIsInR5cCIgOiAiSldUIiwia2lkIi…', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-describedby': 'f-key-hint' }), Sp('input-group-text', h('button.btn.btn-link.p-0.link-secondary', { type: 'button', 'data-action': 'toggle-key', 'aria-label': t('Show or hide the API key'), title: t('Show or hide the API key') }, icon('eye')))), t('Create one in Checkmarx One under Identity and Access Management → API Keys. Tenant and region are detected from the key.')),
    D(
      'row g-3',
      D('col-sm-6', field('f-months', t('Analysis period'), select('f-months', PERIODS.map((n) => [n, t('Last {n} months', { n })]), S.months))),
      D('col-sm-6', field('f-region', t('Region'), select('f-region', [['', t('Detect from key')], ...regions.map((r) => [r, r])], ''))),
    ),
    h(
      'details.setup-advanced#f-adv',
      h('summary', icon('settings', 'icon-sm'), t('Advanced options')),
      D(
        'row g-3 mt-1',
        D('col-sm-6', field('f-tenant', t('Tenant name'), text('f-tenant', t('Detected from key')))),
        D('col-sm-6', field('f-base', t('Checkmarx One URL'), text('f-base', 'https://eu.ast.checkmarx.net', 'url'))),
        D('col-sm-6', field('f-iam', t('IAM URL'), text('f-iam', 'https://eu.iam.checkmarx.net', 'url'))),
        D('col-sm-6', field('f-deep', t('Projects analysed in depth'), select('f-deep', [10, 25, 50, 100, 200].map((n) => [n, String(n)]), S.deepProjects), t('Critical/high results for time-to-fix and stories.'))),
        D('col-12 small text-secondary', t('Alternatively, use an OAuth client (Identity and Access Management → OAuth Clients):')),
        D('col-sm-6', field('f-cid', t('Client ID'), text('f-cid', ''))),
        D('col-sm-6', field('f-csec', t('Client secret'), text('f-csec', '', 'password'))),
      ),
    ),
    h('button.btn.btn-primary.btn-lg.w-100.rounded-pill.mt-2#f-submit', { type: 'submit', disabled: !env || null }, icon('bolt'), t('Connect & build dashboard')),
    D('setup-or', h('span', t('or'))),
    D(
      'row g-2',
      D('col-sm-6', h('button.btn.btn-outline-primary.w-100.rounded-pill', { type: 'button', 'data-action': 'demo' }, icon('sparkles'), t('Explore with demo data'))),
      D('col-sm-6', h('button.btn.btn-outline-secondary.w-100.rounded-pill', { type: 'button', 'data-action': 'open-snapshot' }, icon('upload'), t('Open snapshot (JSON)'))),
    ),
    D('setup-privacy', icon('lock', 'icon-sm'), h('span', t('Read-only access. Requests go only to your Checkmarx One tenant.'))),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onConnect(false);
  });
  mount(root(), D('setup', brand, D('setup-main', D('setup-card', form), D('setup-foot', `Checkmarx One Value Dashboard · v${BOOT.version}`))));
  document.title = 'Checkmarx One Value Dashboard';
}
function setupValues() {
  const out = {};
  for (const el of $$('#connect-form [id]')) if ('value' in el && el.tagName !== 'BUTTON') out[el.id] = el.value;
  out.__adv = $('#f-adv')?.open;
  return out;
}
function restoreSetupValues(v) {
  for (const [id, val] of Object.entries(v || {})) {
    const el = document.getElementById(id);
    if (el && 'value' in el) el.value = val;
  }
  if (v?.__adv && $('#f-adv')) $('#f-adv').open = true;
}
async function onConnect(useEnv) {
  const val = (id) => ($(`#${id}`)?.value || '').trim();
  const body = { apiKey: val('f-key').replace(/\s+/g, ''), region: val('f-region'), tenant: val('f-tenant'), baseUrl: val('f-base'), iamUrl: val('f-iam'), clientId: val('f-cid'), clientSecret: val('f-csec') };
  if (useEnv) body.useEnvKey = true;
  if (!useEnv && !body.apiKey && !(body.clientId && body.clientSecret)) {
    mount($('#setup-error'), errorAlert(new Error(t('Enter an API key, or an OAuth client ID and secret under Advanced options.'))));
    $('#f-key')?.focus();
    return;
  }
  Store.set('months', Number(val('f-months')) || Store.s.months);
  Store.set('deepProjects', Number(val('f-deep')) || Store.s.deepProjects);
  const btn = $('#f-submit');
  setBusy(btn, true, t('Connecting…'));
  mount($('#setup-error'));
  try {
    App.conn = await api('/local/connect', body);
    const key = $('#f-key');
    if (key) key.value = '';
    toast(t('Connected to tenant {t}', { t: App.conn.tenant }), 'success');
    if (App.conn.keyExpires) {
      const raw = App.conn.keyExpires;
      const exp = new Date(typeof raw === 'number' && raw < 1e12 ? raw * 1000 : raw);
      const days = Math.round((exp - Date.now()) / DAY);
      if (isFinite(days) && days < 30) toast(t('This API key expires in {n} days.', { n: Math.max(0, days) }), 'warning', 8000);
    }
    await startCollect();
  } catch (e) {
    setBusy(btn, false);
    mount(btn, icon('bolt'), t('Connect & build dashboard'));
    mount($('#setup-error'), errorAlert(e));
  }
}

/* ---------- Loading ----------------------------------------------------------------------- */
const PHASES = () => [
  ['projects', t('Projects')],
  ['applications', t('Applications')],
  ['scans', t('Scans')],
  ['summaries', t('Scan summaries')],
  ['findings', t('Critical & high findings')],
];
async function startCollect() {
  const S = Store.s;
  const job = await api('/local/collect', { months: S.months, deepProjects: S.deepProjects, deepScans: S.deepScans });
  renderLoading(job);
  pollStatus();
}
function renderLoading(job) {
  App.screen = 'loading';
  Charts.destroyAll();
  closeSettings();
  mount(
    root(),
    D(
      'loading-screen',
      h(
        'div.card.loading-card',
        D(
          'card-body',
          h('img.loading-logo', { src: logo(), alt: 'Checkmarx' }),
          h('h2.loading-title', t('Building your dashboard')),
          D('text-secondary mb-4', App.conn?.tenant || App.env?.tenant ? t('Reading data from tenant {t}', { t: App.conn?.tenant || App.env?.tenant }) : t('Reading data from Checkmarx One')),
          D('progress progress-lg mb-2', h('div.progress-bar#ld-bar', { style: { width: '0%' }, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': t('Progress') })),
          D('d-flex small text-secondary mb-4 gap-2', h('span#ld-msg.text-truncate'), h('span#ld-pct.ms-auto.tabular', '0%')),
          h('ul.loading-phases#ld-phases'),
          D('d-flex gap-2 mt-4 align-items-center', h('button.btn.btn-outline-secondary.rounded-pill', { type: 'button', 'data-action': 'cancel-collect' }, icon('x'), t('Cancel')), h('div#ld-req.ms-auto.small.text-secondary.tabular')),
          D('loading-note', icon('info', 'icon-sm'), h('span', t('Large tenants can take a few minutes. Scan summaries are cached locally, so the next refresh is much faster.'))),
        ),
      ),
    ),
  );
  updateLoading(job);
}
function updateLoading(j) {
  if (!j) return;
  const pct = clamp(Number(j.pct) || 0, 0, 100);
  const bar = $('#ld-bar');
  if (bar) {
    bar.style.width = `${pct}%`;
    bar.setAttribute('aria-valuenow', String(pct));
  }
  if ($('#ld-pct')) $('#ld-pct').textContent = `${pct}%`;
  if ($('#ld-msg')) $('#ld-msg').textContent = j.msg || '';
  if ($('#ld-req')) $('#ld-req').textContent = j.requests ? t('{n} API calls', { n: fmt.num(j.requests) }) : '';
  const order = PHASES().map((p) => p[0]);
  const cur = order.indexOf(j.phase);
  mount(
    $('#ld-phases'),
    PHASES().map(([id, label], i) => {
      const state = j.state === 'done' || i < cur ? 'done' : i === cur ? 'active' : 'pending';
      const count = j.counts?.[id];
      return h('li', { class: `lp lp-${state}` }, Sp('lp-icon', state === 'done' ? icon('check') : state === 'active' ? h('span.spinner-border.spinner-border-sm') : Sp('lp-dot')), Sp('lp-label', label), count != null ? Sp('lp-count tabular', fmt.num(count)) : null);
    }),
  );
}
function pollStatus() {
  clearTimeout(App.poll);
  const tick = async () => {
    if (App.screen !== 'loading') return;
    let j;
    try {
      j = await api('/local/status');
    } catch (e) {
      renderSetup(e);
      return;
    }
    if (App.screen !== 'loading') return;
    updateLoading(j);
    if (j.state === 'running') App.poll = setTimeout(tick, 700);
    else if (j.state === 'done') {
      try {
        setDataset(await api('/local/dataset'));
      } catch (e) {
        renderSetup(e);
      }
    } else if (j.state === 'cancelled') {
      toast(t('Data collection cancelled'), 'info');
      if (App.ds) renderShell();
      else renderSetup();
    } else if (j.state === 'error') renderSetup(Object.assign(new Error(j.error || t('Data collection failed')), { detail: j.detail }));
    else renderSetup();
  };
  tick();
}

/* ---------- Dataset ----------------------------------------------------------------------- */
function setDataset(ds) {
  App.ds = ds;
  if (App.filter.app && !(ds.applications || []).some((a) => a.id === App.filter.app)) App.filter.app = '';
  Object.assign(TableState, { q: '', page: 0 });
  Object.assign(FindState, { sev: '', engine: '', project: '', q: '', overdue: false, page: 0 });
  recompute();
  renderShell();
}
function recompute() {
  App.M = computeMetrics(App.ds, Store.s, App.filter);
}
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
function cleanValue(v, depth = 0) {
  if (depth > 14 || v === undefined) return null;
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > 5000 ? v.slice(0, 5000) : v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (Array.isArray(v)) return v.slice(0, 1_000_000).map((x) => cleanValue(x, depth + 1));
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) if (!BAD_KEYS.has(k)) out[k] = cleanValue(v[k], depth + 1);
    return out;
  }
  return null;
}
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const obj = (o) => (isObj(o) ? o : {});
const arr = (a) => (Array.isArray(a) ? a : []);
const numMap = (o) => Object.fromEntries(Object.entries(obj(o)).map(([k, v]) => [k, Number(v) || 0]));
const optNum = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
/** Snapshot files are untrusted: rebuild the structure with coerced types so metrics never see surprises. */
function sanitizeDataset(raw) {
  const bad = () => new Error(t('This file is not a Checkmarx One Value Dashboard snapshot.'));
  if (!isObj(raw)) throw bad();
  const ds = cleanValue(raw);
  const validDate = (d) => d && !isNaN(new Date(d));
  if (!Array.isArray(ds.projects) || !Array.isArray(ds.scans) || !isObj(ds.period) || !validDate(ds.period.from) || !validDate(ds.period.to)) throw bad();
  const astUrl = typeof ds.tenant?.astUrl === 'string' && /^https:\/\/[\w.-]+(:\d+)?\/?$/i.test(ds.tenant.astUrl) ? ds.tenant.astUrl.replace(/\/$/, '') : '';
  const summaries = {};
  for (const [id, s] of Object.entries(obj(ds.summaries))) {
    if (!isObj(s)) continue;
    const e = {};
    for (const [eng, c] of Object.entries(obj(s.e))) {
      if (!isObj(c)) continue;
      e[eng] = { sev: numMap(c.sev), total: Number(c.total) || 0 };
      if (isObj(c.st)) e[eng].st = numMap(c.st);
      if (isObj(c.ss)) e[eng].ss = Object.fromEntries(Object.entries(c.ss).map(([k, v]) => [k, numMap(v)]));
      if (isObj(c.state)) e[eng].state = numMap(c.state);
      if (c.files != null) e[eng].files = Number(c.files) || 0;
    }
    const out = { e, d: Number(s.d) || 0 };
    if (Array.isArray(s.q)) out.q = s.q.filter(Array.isArray).map((x) => [String(x[0] ?? ''), SEVS.includes(x[1]) ? x[1] : 'M', Number(x[2]) || 0]);
    for (const k of ['lang', 'comp', 'plat', 'cat']) if (isObj(s[k])) out[k] = numMap(s[k]);
    if (isObj(s.pkg)) out.pkg = { total: Number(s.pkg.total) || 0, outdated: Number(s.pkg.outdated) || 0, lic: numMap(s.pkg.lic) };
    summaries[String(id)] = out;
  }
  const finding = (f) => ({
    ...f,
    s: SEVS.includes(f.s) ? f.s : 'H',
    t: String(f.t ?? ''),
    title: String(f.title ?? ''),
    p: String(f.p ?? ''),
    project: String(f.project ?? ''),
    file: f.file == null ? '' : String(f.file),
    line: optNum(f.line),
    pkg: f.pkg == null ? '' : String(f.pkg),
    rec: f.rec == null ? '' : String(f.rec),
    cve: f.cve == null ? '' : String(f.cve),
    cwe: f.cwe == null ? '' : String(f.cwe),
    cvss: optNum(f.cvss),
    ttr: optNum(f.ttr),
  });
  const deep = obj(ds.deep);
  return {
    ...ds,
    source: 'snapshot',
    tenant: { name: String(ds.tenant?.name ?? ''), astUrl },
    period: { from: new Date(ds.period.from).toISOString(), to: new Date(ds.period.to).toISOString(), months: Number(ds.period.months) || 12 },
    projects: ds.projects.filter(isObj).map((p) => ({ ...p, id: String(p.id ?? ''), name: String(p.name ?? p.id ?? ''), groups: arr(p.groups).map(String), tags: obj(p.tags), apps: arr(p.apps).map(String), crit: Number(p.crit) || 3 })),
    applications: arr(ds.applications).filter(isObj).map((a) => ({ ...a, id: String(a.id ?? ''), name: String(a.name ?? a.id ?? ''), projectIds: arr(a.projectIds).map(String), crit: Number(a.crit) || 3 })),
    scans: ds.scans.filter((s) => isObj(s) && s.id && validDate(s.c)).map((s) => ({ ...s, id: String(s.id), p: String(s.p ?? ''), loc: Number(s.loc) || 0 })),
    summaries,
    chains: Object.fromEntries(Object.entries(obj(ds.chains)).map(([k, v]) => [k, arr(v).map(String)])),
    latest: Object.fromEntries(Object.entries(obj(ds.latest)).map(([k, v]) => [k, String(v ?? '')])),
    primary: Object.fromEntries(Object.entries(obj(ds.primary)).map(([k, v]) => [k, String(v ?? '')])),
    deep: { ...deep, projects: arr(deep.projects).map(String), open: arr(deep.open).filter(isObj).map(finding), fixed: arr(deep.fixed).filter(isObj).map(finding), triaged: Number(deep.triaged) || 0, resultsFailed: Number(deep.resultsFailed) || 0, sampled: obj(deep.sampled) },
    warnings: arr(ds.warnings).map((w) => String(w)),
  };
}
function openSnapshot() {
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 300 * 1024 * 1024) return toast(t('File is too large'), 'error');
    try {
      const ds = sanitizeDataset(JSON.parse(await file.text()));
      setDataset(ds);
      toast(t('Snapshot loaded: {n} projects', { n: fmt.num(ds.projects.length) }), 'success');
    } catch (e) {
      toast(t('Could not open snapshot: {e}', { e: e.message }), 'error', 7000);
    }
  });
  input.click();
}
async function refresh() {
  const ds = App.ds;
  if (!ds) return;
  if (ds.source === 'demo') {
    setDataset(makeDemoDataset(Store.s.months));
    toast(t('Demo data regenerated for the last {n} months', { n: Store.s.months }), 'success');
    return;
  }
  if (ds.source === 'snapshot') {
    toast(t('Snapshots are static. Connect a tenant to refresh data.'), 'info');
    return;
  }
  try {
    await startCollect();
  } catch (e) {
    if (e.status === 401) {
      toast(t('The session has ended. Please connect again.'), 'error');
      renderSetup();
    } else toast(e.message, 'error');
  }
}

/* ---------- Shell ------------------------------------------------------------------------- */
function exportMenu() {
  const item = (ic, label, format, scope) => h('button.dropdown-item', { type: 'button', 'data-action': 'export', 'data-format': format, 'data-scope': scope }, icon(ic, 'dropdown-item-icon'), label);
  return D(
    'dropdown cx-export',
    h('button.btn.btn-primary.rounded-pill', { type: 'button', 'data-action': 'dd-toggle', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, icon('download'), Sp('d-none d-sm-inline', t('Export')), icon('chevron-down', 'icon-sm ms-1 me-0')),
    h(
      'div.dropdown-menu.dropdown-menu-end.dropdown-menu-arrow',
      { 'data-bs-popper': 'static' },
      h('h6.dropdown-header', t('Current view')),
      item('presentation', t('PowerPoint (.pptx)'), 'pptx', 'current'),
      item('file-pdf', t('PDF'), 'pdf', 'current'),
      item('printer', t('Print / save as vector PDF'), 'print', 'current'),
      h('div.dropdown-divider'),
      h('h6.dropdown-header', t('Executive pack · all personas')),
      item('presentation', t('PowerPoint (.pptx)'), 'pptx', 'all'),
      item('file-pdf', t('PDF'), 'pdf', 'all'),
      item('printer', t('Print / save as vector PDF'), 'print', 'all'),
      h('div.dropdown-divider'),
      h('h6.dropdown-header', t('Data')),
      h('button.dropdown-item', { type: 'button', 'data-action': 'export-csv' }, icon('table', 'dropdown-item-icon'), t('Findings (CSV)')),
      h('button.dropdown-item', { type: 'button', 'data-action': 'export-json' }, icon('database', 'dropdown-item-icon'), t('Data snapshot (JSON)')),
    ),
  );
}
function sourceBadge(ds) {
  if (ds.source === 'live') return Sp('badge src-badge src-live', Sp('src-dot'), ds.tenant?.name || t('Live tenant'));
  if (ds.source === 'demo') return Sp('badge src-badge src-demo', icon('sparkles', 'icon-sm'), t('Demo data'));
  return Sp('badge src-badge src-snap', icon('database', 'icon-sm'), `${t('Snapshot')} · ${ds.tenant?.name || ''}`);
}
function renderShell() {
  App.screen = 'shell';
  const ds = App.ds;
  const apps = [...(ds.applications || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const months = Number(ds.period?.months) || Store.s.months;
  const header = h(
    'header.navbar.navbar-expand.cx-navbar.d-print-none',
    D(
      'container-xl gap-2',
      h('a.navbar-brand.cx-brand', { href: `#/${App.persona}`, 'aria-label': 'Checkmarx One Value Dashboard' }, h('img.cx-logo', { src: logo(), alt: 'Checkmarx' }), Sp('cx-brand-sep'), Sp('cx-brand-name', t('Value Dashboard'))),
      sourceBadge(ds),
      D(
        'ms-auto d-flex align-items-center gap-2 cx-actions',
        apps.length ? h('select.form-select.form-select-sm.cx-select#hdr-app', { 'aria-label': t('Application') }, option('', t('All applications'), !App.filter.app), apps.map((a) => option(a.id, a.name, App.filter.app === a.id))) : null,
        h('select.form-select.form-select-sm.cx-select#hdr-months', { 'aria-label': t('Analysis period'), disabled: ds.source === 'snapshot' || null }, [...new Set([...PERIODS, months])].sort((a, b) => a - b).map((n) => option(n, t('Last {n} months', { n }), n === months))),
        exportMenu(),
        iconBtn('refresh', t('Refresh data'), 'refresh'),
        themeButton(),
        iconBtn('settings', t('Settings'), 'open-settings'),
      ),
    ),
  );
  const nav = h(
    'nav.cx-subnav.d-print-none',
    { 'aria-label': t('Dashboards') },
    D('container-xl', h('ul.nav.cx-tabs#persona-nav', PERSONAS.map((p) => h('li.nav-item', h('a', { class: `nav-link ${App.persona === p.id ? 'active' : ''}`, href: `#/${p.id}`, 'data-persona': p.id }, icon(p.icon), h('span', p.label())))))),
  );
  const footer = h(
    'footer.cx-footer.d-print-none',
    D('container-xl d-flex flex-wrap gap-2', h('span', `Checkmarx One Value Dashboard v${BOOT.version}`), Sp('ms-md-auto', t('Data as of {d}', { d: fmt.date(ds.generatedAt) })), h('span', '·'), h('span', t('Value figures are risk-adjusted estimates.'))),
  );
  const settings = h(
    'aside.offcanvas.offcanvas-end.cx-settings#settings',
    { tabindex: '-1', role: 'dialog', 'aria-labelledby': 'settings-title' },
    D('offcanvas-header', h('h2.offcanvas-title#settings-title', icon('settings'), t('Settings')), h('button.btn-close', { type: 'button', 'data-action': 'close-settings', 'aria-label': t('Close') })),
    h('div.offcanvas-body#settings-body'),
  );
  const wasOpen = Boolean($('#settings.show'));
  mount(root(), D('page', header, nav, D('page-wrapper', h('main.page-body#main-wrap', D('container-xl', h('div#main'))), footer)), settings);
  renderPage();
  if (wasOpen) openSettings();
}
function dataNotices() {
  const ds = App.ds;
  const out = [];
  if (ds.source === 'demo') out.push(D('alert alert-cx-soft d-flex align-items-center gap-2 mb-3', icon('sparkles'), h('span', t('You are viewing synthetic demo data for a fictitious company. Connect a tenant to see your own results.')), h('button.btn.btn-sm.btn-primary.rounded-pill.ms-auto', { type: 'button', 'data-action': 'back-setup' }, t('Connect tenant'))));
  if (ds.warnings?.length && App.warnShown !== ds.generatedAt) {
    out.push(
      D(
        'alert alert-warning d-flex align-items-center gap-2 mb-3',
        icon('alert'),
        h('span', ds.warnings[0], ds.warnings.length > 1 ? ` ${t('(+{n} more)', { n: ds.warnings.length - 1 })}` : ''),
        h('button.btn.btn-sm.btn-ghost-warning.ms-auto', { type: 'button', 'data-action': 'open-settings', 'data-tab': 'data' }, t('Details')),
        h('button.btn-close', { type: 'button', 'data-action': 'dismiss-warn', 'aria-label': t('Dismiss') }),
      ),
    );
  }
  return out;
}
function renderPage() {
  if (App.screen !== 'shell' || !App.M) return;
  Charts.destroyAll();
  const M = App.M;
  const p = personaById(App.persona);
  const right = [
    Sp('period-chip', icon('clock', 'icon-sm'), `${fmt.date(M.from)} – ${fmt.date(M.to)}`),
    h('button.btn.btn-outline-primary.btn-sm.rounded-pill', { type: 'button', 'data-action': 'export', 'data-format': 'pptx', 'data-scope': 'current' }, icon('presentation', 'icon-sm'), t('PowerPoint')),
    h('button.btn.btn-outline-primary.btn-sm.rounded-pill', { type: 'button', 'data-action': 'export', 'data-format': 'pdf', 'data-scope': 'current' }, icon('file-pdf', 'icon-sm'), 'PDF'),
  ];
  const body = M.projectsTotal
    ? (PAGE_FN[App.persona] || pageCiso)(M)
    : D('empty cx-empty', D('empty-icon', icon('search')), h('p.empty-title', t('No projects found')), h('p.empty-subtitle.text-secondary', App.filter.app ? t('The selected application has no projects with scans in this period.') : t('This tenant has no projects with scans in the selected period.')));
  mount($('#main'), dataNotices(), pageHeader(App.persona, right), body);
  Charts.mountAll();
  fitKpis();
  for (const a of $$('#persona-nav .nav-link')) {
    const on = a.dataset.persona === App.persona;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = `${p.label()} · Checkmarx One Value Dashboard`;
}
function fullRerender() {
  if (App.screen === 'shell') {
    recompute();
    renderShell();
  } else if (App.screen === 'setup') {
    const v = setupValues();
    renderSetup();
    restoreSetupValues(v);
  } else if (App.screen === 'loading') {
    applyTheme();
  }
}

/* ---------- Settings drawer & dropdowns -------------------------------------------------- */
function openSettings(tab) {
  const el = $('#settings');
  if (!el) return;
  if (tab) App.settingsTab = tab;
  mount($('#settings-body'), settingsBody());
  if (!el.classList.contains('show')) {
    el.classList.add('show');
    el.setAttribute('aria-modal', 'true');
    // The backdrop lives on <body> and survives a shell re-render (e.g. after a language change).
    if (!$('#settings-backdrop')) document.body.appendChild(h('div.offcanvas-backdrop.fade.show#settings-backdrop', { 'data-action': 'close-settings' }));
    setTimeout(() => el.querySelector('.nav-link.active, button, select, input')?.focus(), 50);
  }
}
function closeSettings() {
  const el = $('#settings');
  if (el) {
    el.classList.remove('show');
    el.removeAttribute('aria-modal');
  }
  $('#settings-backdrop')?.remove();
}
function closeDropdowns() {
  for (const m of $$('.dropdown-menu.show')) {
    m.classList.remove('show');
    m.previousElementSibling?.setAttribute('aria-expanded', 'false');
  }
}
function toggleDropdown(btn) {
  const menu = btn.nextElementSibling;
  const open = !menu.classList.contains('show');
  closeDropdowns();
  if (open) {
    menu.classList.add('show');
    btn.setAttribute('aria-expanded', 'true');
    menu.querySelector('.dropdown-item')?.focus();
  }
}

/* ---------- Settings changes ------------------------------------------------------------ */
const scheduleRecompute = debounce((scope) => {
  if (App.screen !== 'shell') return;
  recompute();
  if (scope === 'roi' && $('#roi-results')) {
    mount($('#roi-results'), roiResults(App.M));
    Charts.mountAll();
    fitKpis();
    for (const b of $$('#main [data-action="preset"]')) {
      const on = presetActive(b.dataset.preset);
      b.classList.toggle('btn-primary', on);
      b.classList.toggle('btn-outline-primary', !on);
    }
  } else renderPage();
}, 220);
function onSetting(el) {
  const path = el.dataset.setting;
  const type = el.dataset.type;
  let v;
  if (type === 'bool') v = el.checked;
  else if (type === 'num' || type === 'cur') {
    if (el.value === '') return;
    v = Number(el.value);
    if (!Number.isFinite(v) || v < 0) return;
    if (type === 'cur') v /= fxRate();
    if (path.startsWith('fx.') && v <= 0) return;
  } else {
    v = el.value;
    if (typeof Store.get(path) === 'number') v = Number(v);
  }
  Store.set(path, v);
  const top = path.split('.')[0];
  if (['lang', 'locale', 'currency', 'theme'].includes(top)) {
    applyTheme();
    fullRerender();
    return;
  }
  if (['report', 'deepProjects', 'deepScans', 'months'].includes(top)) return;
  scheduleRecompute(el.closest('#main') ? 'roi' : 'page');
}
function applyPreset(name) {
  const P = PRESETS[name];
  if (!P) return;
  deepMerge(Store.s, JSON.parse(JSON.stringify(P)));
  Store.save();
  recompute();
  renderPage();
  if ($('#settings.show')) mount($('#settings-body'), settingsBody());
  toast(t('{p} assumptions applied', { p: t(name[0].toUpperCase() + name.slice(1)) }), 'success');
}
const refreshFindings = debounce(() => mount($('#find-table'), findingsTable(App.M)), 150);
const refreshProjects = debounce(() => mount($('#proj-table'), projectTable(App.M)), 150);

/* ---------- Event delegation ------------------------------------------------------------- */
function onClick(e) {
  const a = e.target.closest('[data-action]');
  if (!e.target.closest('.dropdown')) closeDropdowns();
  if (!a || a.disabled) return;
  const act = a.dataset.action;
  switch (act) {
    case 'dd-toggle':
      toggleDropdown(a);
      break;
    case 'export':
      closeDropdowns();
      Exporter.run(a.dataset.format, a.dataset.scope === 'current' ? App.persona : a.dataset.scope);
      break;
    case 'export-csv':
      closeDropdowns();
      if (App.M) exportFindingsCsv(App.M);
      break;
    case 'export-json':
      closeDropdowns();
      if (App.ds) exportSnapshot(App.ds);
      break;
    case 'toggle-table': {
      Charts.toggleTable(a.dataset.chart);
      a.setAttribute('aria-pressed', String(a.getAttribute('aria-pressed') !== 'true'));
      break;
    }
    case 'dismiss-roi':
      Store.set('roiBannerDismissed', true);
      a.closest('.col-12')?.remove();
      break;
    case 'dismiss-warn':
      App.warnShown = App.ds?.generatedAt;
      a.closest('.alert')?.remove();
      break;
    case 'sort': {
      const k = a.dataset.key;
      if (TableState.sort === k) TableState.dir *= -1;
      else Object.assign(TableState, { sort: k, dir: k === 'name' ? 1 : -1 });
      TableState.page = 0;
      mount($('#proj-table'), projectTable(App.M));
      break;
    }
    case 'page':
      TableState.page = Number(a.dataset.page) || 0;
      mount($('#proj-table'), projectTable(App.M));
      break;
    case 'fpage':
      FindState.page = Number(a.dataset.page) || 0;
      mount($('#find-table'), findingsTable(App.M));
      break;
    case 'preset':
      applyPreset(a.dataset.preset);
      break;
    case 'settings-tab':
      App.settingsTab = a.dataset.tab;
      mount($('#settings-body'), settingsBody());
      break;
    case 'open-settings':
      closeDropdowns();
      openSettings(a.dataset.tab);
      break;
    case 'close-settings':
      closeSettings();
      break;
    case 'theme':
      Store.set('theme', isDark() ? 'light' : 'dark');
      applyTheme();
      fullRerender();
      break;
    case 'refresh':
      refresh();
      break;
    case 'clear-cache':
      api('/local/clear-cache', {})
        .then(() => toast(t('Local cache cleared'), 'success'))
        .catch((err) => toast(err.message, 'error'));
      break;
    case 'disconnect':
      closeSettings();
      api('/local/disconnect', {}).catch(() => {});
      App.ds = null;
      App.M = null;
      App.conn = null;
      if (App.env) App.env.hasDataset = false;
      renderSetup();
      toast(t('Disconnected. Credentials were removed from memory.'), 'info');
      break;
    case 'toggle-key': {
      const k = $('#f-key');
      if (k) k.type = k.type === 'password' ? 'text' : 'password';
      break;
    }
    case 'back-setup':
      renderSetup();
      break;
    case 'demo':
      setDataset(makeDemoDataset(Number($('#f-months')?.value) || Store.s.months));
      break;
    case 'open-snapshot':
      openSnapshot();
      break;
    case 'connect-env':
      onConnect(true);
      break;
    case 'cancel-collect':
      api('/local/cancel', {}).catch(() => {});
      setBusy(a, true, t('Cancelling…'));
      break;
    default:
      break;
  }
}
function onInput(e) {
  const el = e.target;
  if (el.dataset?.setting && el.type !== 'checkbox' && el.tagName !== 'SELECT') onSetting(el);
  else if (el.dataset?.find && el.tagName === 'INPUT' && el.type !== 'checkbox') {
    FindState[el.dataset.find] = el.value;
    FindState.page = 0;
    refreshFindings();
  } else if (el.id === 'proj-search') {
    TableState.q = el.value;
    TableState.page = 0;
    refreshProjects();
  }
}
function onChange(e) {
  const el = e.target;
  if (el.dataset?.setting && (el.type === 'checkbox' || el.tagName === 'SELECT')) onSetting(el);
  else if (el.dataset?.find && (el.type === 'checkbox' || el.tagName === 'SELECT')) {
    FindState[el.dataset.find] = el.type === 'checkbox' ? el.checked : el.value;
    FindState.page = 0;
    mount($('#find-table'), findingsTable(App.M));
  } else if (el.id === 'hdr-app') {
    App.filter.app = el.value;
    recompute();
    renderPage();
  } else if (el.id === 'hdr-months') {
    Store.set('months', Number(el.value) || 12);
    refresh();
  }
}
function onKey(e) {
  if (e.key !== 'Escape') return;
  if ($('.dropdown-menu.show')) closeDropdowns();
  else if ($('#settings.show')) closeSettings();
}
function route() {
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1];
  const next = PERSONAS.some((p) => p.id === id) ? id : App.persona;
  const changed = next !== App.persona;
  App.persona = next;
  Store.set('persona', next);
  if (App.screen === 'shell' && changed) {
    renderPage();
    window.scrollTo({ top: 0 });
  }
}

/* ---------- Boot -------------------------------------------------------------------------- */
async function boot() {
  Store.load();
  applyTheme();
  const hashId = (location.hash.match(/^#\/(\w+)/) || [])[1];
  App.persona = PERSONAS.some((p) => p.id === hashId) ? hashId : PERSONAS.some((p) => p.id === Store.s.persona) ? Store.s.persona : 'ciso';
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', Charts.onResize);
  window.addEventListener('resize', debounce(() => fitKpis(), 150));
  document.fonts?.ready.then(() => fitKpis());
  const css = applyDirection().catch((e) => {
    console.error(e);
    return 'failed';
  });
  const charts = loadAsset('apexcharts.min.js').catch((e) => console.warn('ApexCharts unavailable — falling back to SVG charts.', e));
  try {
    App.env = await api('/local/env');
  } catch {
    App.env = null;
  }
  const cssState = await css;
  await charts;
  $('#splash')?.remove();
  if (cssState === 'failed') toast(t('The UI library could not be loaded. Check your network, or use the offline build.'), 'error', 10000);
  const params = new URLSearchParams(location.search);
  if (params.has('demo')) return setDataset(makeDemoDataset(Number(params.get('months')) || Store.s.months));
  if (App.env?.hasDataset) {
    try {
      return setDataset(await api('/local/dataset'));
    } catch {
      /* fall through */
    }
  }
  if (App.env?.job?.state === 'running') {
    renderLoading(App.env.job);
    return pollStatus();
  }
  renderSetup();
}
boot().catch((e) => {
  console.error(e);
  const host = root();
  if (host) mount(host, D('container py-5', errorAlert(e)));
});
