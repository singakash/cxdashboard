/* ============================================================================================
 * views.js — persona pages, shared components and chart specs (specs are reused by exports).
 * Every element is created with h() (DOM APIs) — no HTML strings.
 * ========================================================================================== */
const PERSONAS = [
  { id: 'ciso', icon: 'shield', label: () => t('CISO'), title: () => t('Risk posture & value'), sub: () => t('Exposure reduction, risk avoided and return on the security investment') },
  { id: 'cio', icon: 'briefcase', label: () => t('CIO'), title: () => t('Business value & efficiency'), sub: () => t('Return on investment, developer productivity and adoption') },
  { id: 'architect', icon: 'sitemap', label: () => t('Security Architect'), title: () => t('Coverage & program health'), sub: () => t('Scanner coverage, integrations, scan health and vulnerability landscape') },
  { id: 'lead', icon: 'users', label: () => t('Team Lead'), title: () => t('Teams & applications'), sub: () => t('Backlog, SLAs and remediation performance per project') },
  { id: 'dev', icon: 'code', label: () => t('Developer'), title: () => t('Fix next'), sub: () => t('Prioritised critical and high findings with location and fix guidance') },
  { id: 'roi', icon: 'calculator', label: () => t('ROI Model'), title: () => t('Value model & assumptions'), sub: () => t('Transparent, adjustable assumptions behind every value figure') },
];
const personaById = (id) => PERSONAS.find((p) => p.id === id) || PERSONAS[0];
const D = (cls, ...kids) => h('div', { class: cls }, ...kids);
const Sp = (cls, ...kids) => h('span', { class: cls }, ...kids);

/* ---------- Shared chart specs ----------------------------------------------------------- */
const Specs = {
  // The current month is partial: mark it so a lower bar is not misread as a decline.
  labels: (M) => M.months.map((m, i) => (i === M.months.length - 1 && M.to.getDate() < 28 ? `${fmt.month(m)} (${t('MTD')})` : fmt.month(m))),
  openTrend: (M) => ({
    kind: 'line',
    labels: Specs.labels(M),
    series: [
      { name: SEV_LABEL().C, data: M.mOpen.map((o) => o.C), color: 'sev:C' },
      { name: SEV_LABEL().H, data: M.mOpen.map((o) => o.H), color: 'sev:H' },
    ],
  }),
  newVsFixed: (M, sevs = ['C', 'H']) => ({
    kind: 'bar',
    labels: Specs.labels(M),
    series: [
      { name: t('Fixed'), data: M.mFixed.map((o) => sum(sevs, (s) => o[s])), color: 'cat:0' },
      { name: t('Newly detected'), data: M.mNew.map((o) => sum(sevs, (s) => o[s])), color: 'cat:2' },
    ],
  }),
  cumValue: (M) => ({
    kind: 'line',
    fmt: 'cur',
    labels: Specs.labels(M),
    series: [
      { name: t('Cumulative value'), data: M.roi.cumulative, color: 'cat:0' },
      ...(M.roi.invest > 0 ? [{ name: t('Cumulative investment'), data: M.roi.cumInvest, color: 'other' }] : []),
    ],
  }),
  monthlyValue: (M) => ({ kind: 'bar', fmt: 'cur', labels: Specs.labels(M), series: [{ name: t('Value delivered'), data: M.roi.monthly, color: 'cat:0' }] }),
  valueByEngine: (M) => {
    const rows = M.roi.byEngine.filter((r) => r.value > 0).slice(0, 8);
    return { kind: 'hbar', fmt: 'cur', labels: rows.map((r) => ENGINE_LABEL(r.engine)), series: [{ name: t('Value delivered'), data: rows.map((r) => r.value), color: 'cat:0' }] };
  },
  valueComposition: (M) => ({
    kind: 'hbar',
    fmt: 'cur',
    labels: [t('Remediation cost avoided'), t('Direct incident cost avoided'), t('Reputational cost avoided'), ...(M.roi.invest ? [t('Investment (period)')] : [])],
    series: [{ name: t('Value'), data: [M.roi.remediation, M.roi.direct, M.roi.reputational, ...(M.roi.invest ? [M.roi.invest] : [])] }],
    distributed: true,
    colors: ['cat:0', 'cat:1', 'cat:3', 'other'],
  }),
  scansPerMonth: (M) => ({ kind: 'bar', labels: Specs.labels(M), series: [{ name: t('Scans'), data: M.mScans.map((b) => b.total), color: 'cat:0' }] }),
  contributors: (M) => ({ kind: 'line', labels: Specs.labels(M), series: [{ name: t('Active scan initiators'), data: M.mContrib, color: 'cat:3' }] }),
  onboarded: (M) => ({ kind: 'area', labels: Specs.labels(M), series: [{ name: t('Projects onboarded'), data: M.onboarded, color: 'cat:0' }] }),
  engineCoverage: (M) => {
    const scanned = Math.max(1, M.projects.filter((p) => p.lastScan).length);
    const rows = Object.entries(M.engUse).sort((a, b) => b[1] - a[1]);
    return { kind: 'hbar', fmt: 'pct', labels: rows.map(([e]) => ENGINE_LABEL(e)), series: [{ name: t('Projects covered'), data: rows.map(([, v]) => v / scanned), color: 'cat:0' }] };
  },
  origins: (M) => {
    const rows = Object.entries(M.origins).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { kind: 'hbar', labels: rows.map(([k]) => k), series: [{ name: t('Scans'), data: rows.map(([, v]) => v), color: 'cat:3' }] };
  },
  languages: (M) => {
    const rows = Object.entries(M.langs).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { kind: 'hbar', labels: rows.map(([k]) => k), series: [{ name: t('SAST findings'), data: rows.map(([, v]) => v), color: 'cat:1' }] };
  },
  topQueries: (M, n = 10) => {
    const rows = M.topQueries.slice(0, n);
    return { kind: 'hbar', labels: rows.map((q) => q.name), series: [{ name: t('Open findings'), data: rows.map((q) => q.count) }], distributed: true, colors: rows.map((q) => `sev:${q.sev}`) };
  },
  platforms: (M) => {
    const rows = Object.entries(M.plat).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return { kind: 'hbar', labels: rows.map(([k]) => k), series: [{ name: t('IaC findings'), data: rows.map(([, v]) => v), color: 'cat:3' }] };
  },
  scanHealth: (M) => ({
    kind: 'stacked',
    labels: Specs.labels(M),
    series: [
      { name: t('Completed'), data: M.mScans.map((b) => b.Completed), color: 'status:good' },
      { name: t('Partial'), data: M.mScans.map((b) => b.Partial), color: 'status:warning' },
      { name: t('Failed'), data: M.mScans.map((b) => b.Failed), color: 'status:critical' },
    ],
  }),
  aging: (M) => ({
    kind: 'stacked',
    labels: M.aging.map((a) => `${a.label} ${t('days')}`),
    series: [
      { name: SEV_LABEL().C, data: M.aging.map((a) => a.C), color: 'sev:C' },
      { name: SEV_LABEL().H, data: M.aging.map((a) => a.H), color: 'sev:H' },
    ],
  }),
  compliance: (M) => {
    const rows = Object.entries(M.comp).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { kind: 'hbar', labels: rows.map(([k]) => k), series: [{ name: t('Findings mapped'), data: rows.map(([, v]) => v), color: 'cat:0' }] };
  },
};

/* ---------- Components ------------------------------------------------------------------- */
const sevChip = (s) => h('span', { class: `sev-chip sev-${s}` }, SEV_LABEL()[s] || s);
const engineBadge = (e) => h('span.badge.badge-outline.text-secondary.engine-badge', ENGINE_LABEL(e === 'sscs-secret-detection' ? 'secrets' : e));
const gradeBadge = (g) => h('span', { class: `grade grade-${g === 'N/A' ? 'na' : g}`, title: t('Security grade') }, g);
const col = (cls, ...kids) => D(cls, ...kids);

function kpi({ ic, label, value, sub, tone = 'violet', hint, cls = 'col-sm-6 col-xl-2' }) {
  // Two KPI tiles per row on phones unless the caller sets an explicit xs width.
  return col(
    /(^|\s)col-(\d+|auto)(\s|$)/.test(cls) ? cls : `col-6 ${cls}`,
    h(
      'div.card.kpi-card',
      h(
        'div.card-body',
        D('kpi-head', Sp(`kpi-icon kpi-${tone}`, icon(ic)), Sp('kpi-label', label), hint ? h('span.kpi-hint', { title: hint, tabindex: 0, 'aria-label': hint }, icon('info')) : null),
        D('kpi-value', value),
        sub ? D('kpi-sub', sub) : null,
      ),
    ),
  );
}
function chartCard({ id, title, subtitle, spec, height = 280, cls = 'col-lg-6' }) {
  Charts.register(id, { ...spec, height });
  return col(
    cls,
    h(
      'div.card',
      h(
        'div.card-header',
        h('div', h('h3.card-title', title), subtitle ? D('card-subtitle', subtitle) : null),
        D('card-actions', h('button.btn.btn-icon.btn-ghost-secondary.btn-sm', { type: 'button', 'data-action': 'toggle-table', 'data-chart': id, title: t('Show as table'), 'aria-label': t('Show as table') }, icon('table'))),
      ),
      h('div.card-body.pt-2', h('div.chart', { id, style: { 'min-height': `${num(height)}px` } }), h('div.d-none', { id: `${id}-table` })),
    ),
  );
}
function card(title, body, { cls = 'col-lg-6', subtitle, actions, bodyCls = '' } = {}) {
  return col(
    cls,
    h(
      'div.card',
      title ? h('div.card-header', h('div', h('h3.card-title', title), subtitle ? D('card-subtitle', subtitle) : null), actions ? D('card-actions', actions) : null) : null,
      D(`card-body ${bodyCls}`, body),
    ),
  );
}
function insightList(M, persona) {
  const items = insights(M, persona);
  if (!items.length) return null;
  return col('col-12', h('div.card.insight-card', h('div.card-body', D('insight-head', icon('sparkles'), h('span', t('Key insights'))), D('insight-grid', items.map((i) => D(`insight insight-${i.tone}`, icon(i.icon), h('span', i.text)))))));
}
function assumptionsNotice() {
  if (Store.s.roiBannerDismissed) return null;
  const inv = Store.s.investment > 0;
  return col(
    'col-12',
    h(
      'div.alert.alert-cx.mb-0',
      { role: 'status' },
      D(
        'd-flex align-items-start gap-3 notice-row',
        Sp('alert-icon', icon('calculator')),
        D('flex-fill notice-body', D('fw-bold', inv ? t('Value figures use your cost & risk assumptions') : t('Add your annual Checkmarx One investment to calculate ROI')), D('text-secondary small', t('All monetary values are risk-adjusted estimates derived from remediated vulnerabilities. Review the assumptions to match your organisation.'))),
        h('a.btn.btn-sm.btn-primary.rounded-pill.notice-cta', { href: '#/roi' }, t('Review assumptions')),
        h('button.btn-close.ms-1.notice-close', { type: 'button', 'data-action': 'dismiss-roi', 'aria-label': t('Dismiss') }),
      ),
    ),
  );
}
function heroBanner(M, { variant = 'ciso' } = {}) {
  const r = M.roi;
  const fixedAll = sevTotal(M.tot.fixed);
  const stat = (label, value) => D('hero-stat', D('hero-stat-label', label), D('hero-stat-value', value));
  return col(
    'col-12',
    D(
      'hero',
      h('img.hero-element', { src: ASSETS.elementDark, alt: '', 'aria-hidden': 'true' }),
      D(
        'hero-body',
        D('hero-eyebrow', `${t('Value delivered')} · ${t('last {n} months', { n: M.nMonths })}`),
        D('hero-value', fmt.cur(r.total)),
        D('hero-text', variant === 'cio' ? t('in avoided remediation and incident costs, from {n} vulnerabilities fixed early', { n: fmt.num(fixedAll) }) : t('in risk-adjusted value from {n} vulnerabilities remediated before exploitation', { n: fmt.num(fixedAll) })),
        D(
          'hero-stats',
          r.multiple != null ? stat(t('Return on investment'), fmt.mult(r.multiple)) : D('hero-stat', D('hero-stat-label', t('Return on investment')), h('a.hero-cta', { href: '#/roi' }, t('Set investment'), icon('arrow-right'))),
          stat(t('Incident risk avoided'), fmt.cur(r.risk)),
          stat(t('Remediation cost avoided'), fmt.cur(r.remediation)),
          stat(t('Developer hours saved'), fmt.hours(r.hoursSaved)),
        ),
      ),
    ),
  );
}
/** Empty state for the remediation stories: distinguishes "nothing fixed" from "no permission to read results". */
function noStoriesText() {
  const deep = App.ds?.deep;
  return deep?.resultsFailed && !deep.fixed?.length
    ? t('Finding details could not be loaded — the API key needs permission to view scan results.')
    : t('No remediated critical or high findings were found in the analysed projects for this period yet.');
}
function storyCards(M, n = 4, cls = 'col-md-6 col-xl-3') {
  const items = M.stories.slice(0, n);
  if (!items.length) return col('col-12', h('div.card', D('card-body text-secondary', noStoriesText())));
  return items.map((f) => {
    const loc = f.pkg || f.img || (f.file ? `${f.file}${f.line ? ':' + f.line : ''}` : '');
    return col(
      cls,
      h(
        'div.card.story-card',
        h(
          'div.card-body',
          D('story-top', sevChip(f.s), engineBadge(f.t), Sp('story-fixed', icon('check'), f.ttr != null ? t('Fixed in {d}', { d: fmt.days(f.ttr) }) : t('Fixed'))),
          h('div.story-title', { title: f.title }, f.title),
          D('story-meta', joinParts([f.project, f.cwe ? `CWE-${f.cwe}` : '', f.cvss ? `CVSS ${fmt.num(f.cvss, 1)}` : ''])),
          loc ? h('div.story-loc', { title: loc }, f.pkg ? icon('package') : icon('code'), h('span', loc)) : null,
          D('story-foot', h('div', D('story-label', t('Exposure removed')), D('story-value', fmt.cur(f.exposure))), D('text-end', D('story-label', t('Detected')), D('story-date', fmt.date(f.detected)))),
        ),
      ),
    );
  });
}
const sevCells = (o) => SEVS.map((s) => h('td', { class: `text-end tabular ${o[s] ? '' : 'text-secondary'}` }, o[s] ? Sp(`sev-dot sev-${s}`) : null, fmt.num(o[s])));
function appRollup(M) {
  const apps = new Map();
  for (const p of M.projects) {
    for (const a of p.apps.length ? p.apps : ['__none']) {
      const r = apps.get(a) || { id: a, name: a === '__none' ? t('Unassigned projects') : M.ds.applications.find((x) => x.id === a)?.name || a, open: sevZero(), fixed: sevZero(), risk: 0, trend: M.months.map(() => 0), projects: 0 };
      addSev(r.open, p.open);
      addSev(r.fixed, p.fixed);
      r.risk += p.risk;
      r.projects++;
      p.trend.forEach((v, i) => (r.trend[i] += v));
      apps.set(a, r);
    }
  }
  return [...apps.values()].map((r) => ({ ...r, grade: gradeOf(r.open) })).sort((a, b) => b.risk - a.risk);
}
function riskRows(M, limit = 8) {
  return (M.ds.applications.length ? appRollup(M) : M.ranked).slice(0, limit);
}
function riskTable(M, limit = 8) {
  const P = pal();
  const isApp = M.ds.applications.length > 0;
  return D(
    'table-responsive',
    h(
      'table.table.table-vcenter.card-table.table-hover',
      h('thead', h('tr', h('th', isApp ? t('Application') : t('Project')), h('th.text-center', t('Grade')), SEVS.map((s) => h('th.text-end', SEV_LABEL()[s])), h('th.text-end', t('Fixed C/H')), h('th', t('Critical & high trend')))),
      h(
        'tbody',
        riskRows(M, limit).map((r) =>
          h(
            'tr',
            h('td', D('fw-medium', r.name), D('text-secondary small', r.projects ? t('{n} projects', { n: r.projects }) : (r.appNames || []).join(', '))),
            h('td.text-center', gradeBadge(r.grade)),
            sevCells(r.open),
            h('td.text-end.tabular', fmt.num(r.fixed.C + r.fixed.H)),
            h('td', sparkline(r.trend, P.sev.H)),
          ),
        ),
      ),
    ),
  );
}
const gradeBar = (M) => segBar(['A', 'B', 'C', 'D', 'F'].map((g) => ({ label: `${t('Grade')} ${g}`, value: M.grades[g], color: `grade:${g}` })), { height: 16 });
function pageHeader(persona, right) {
  const p = personaById(persona);
  return D('page-header', D('row g-3 align-items-center', D('col', D('page-pretitle', p.label()), h('h2.page-title', p.title()), D('text-secondary mt-1', p.sub())), D('col-auto ms-auto d-flex gap-2 flex-wrap align-items-center', right)));
}
const sectionTitle = (ic, title, sub) => col('col-12', D('section-title', icon(ic), h('span', title), sub ? Sp('text-secondary small ms-2', sub) : null));
const cards = (...kids) => D('row row-deck row-cards', ...kids);

/* ---------- Pages ----------------------------------------------------------------------- */
function pageCiso(M) {
  const r = M.roi;
  const fixedCH = M.tot.fixed.C + M.tot.fixed.H;
  return cards(
    assumptionsNotice(),
    heroBanner(M),
    kpi({ ic: 'shield-check', label: t('Risk exposure avoided'), value: fmt.cur(r.risk), sub: t('{d} direct · {r} reputational', { d: fmt.cur(r.direct), r: fmt.cur(r.reputational) }), hint: t('Expected breach cost avoided by remediating vulnerabilities (probability × average breach cost, capped per year).') }),
    kpi({ ic: 'target', label: t('Critical & high fixed'), value: fmt.num(fixedCH), sub: t('{c} critical · {h} high', { c: fmt.num(M.tot.fixed.C), h: fmt.num(M.tot.fixed.H) }), tone: 'magenta' }),
    kpi({ ic: 'trending-down', label: t('Risk reduction'), value: M.riskReduction == null ? '—' : fmt.pct(M.riskReduction), sub: t('Severity-weighted, since {d}', { d: fmt.monthLong(M.months[0]) }), tone: 'blue', hint: t('Change in severity-weighted open findings between the first and the latest scan of each project in the period.') }),
    kpi({ ic: 'clock', label: t('MTTR critical'), value: fmt.days(M.mttr.C), sub: t('High: {d}', { d: fmt.days(M.mttr.H) }), tone: 'orange', hint: t('Median days from first detection to remediation (sampled scans of the riskiest projects).') }),
    kpi({ ic: 'check', label: t('SLA compliance'), value: fmt.pct(M.slaCompliance), sub: t('{n} open past SLA', { n: fmt.num(M.openOverdue.length) }) }),
    kpi({ ic: 'alert', label: t('Open critical'), value: fmt.num(M.tot.open.C), sub: t('{h} high open', { h: fmt.num(M.tot.open.H) }), tone: 'magenta' }),
    insightList(M, 'ciso'),
    chartCard({ id: 'c-open', title: t('Open critical & high findings'), subtitle: t('Latest scan per project, end of month'), spec: Specs.openTrend(M), cls: 'col-lg-7' }),
    card(
      t('Risk avoided breakdown'),
      D(
        'value-break',
        D('value-total', fmt.cur(r.total)),
        D('text-secondary mb-3', t('Total value delivered')),
        segBar(
          [
            { label: t('Direct incident cost avoided'), value: r.direct, color: 'cat:1' },
            { label: t('Reputational cost avoided'), value: r.reputational, color: 'cat:3' },
            { label: t('Remediation cost avoided'), value: r.remediation, color: 'cat:0' },
          ],
          { height: 18, fmtV: (v) => fmt.cur(v) },
        ),
        D('text-secondary small mt-3', t('Expected incidents avoided: {n}', { n: fmt.num(r.incidents, 2) }), r.capped ? ` · ${t('capped at {c} per year', { c: fmt.num(Store.s.maxIncidentsPerYear, 1) })}` : ''),
      ),
      { cls: 'col-lg-5' },
    ),
    sectionTitle('trophy', t('How Checkmarx One reduced financial & reputational risk'), t('Notable critical and high vulnerabilities detected and remediated')),
    storyCards(M, 4),
    chartCard({ id: 'c-nvf', title: t('Remediated vs. newly detected'), subtitle: t('Critical & high, per month'), spec: Specs.newVsFixed(M) }),
    card(t('Security grade distribution'), frag(gradeBar(M), D('text-secondary small mt-3', t('A: no critical/high · B: no critical, some high · C: 10+ high · D: critical present · F: 5+ critical'))), { subtitle: t('{n} projects with a completed scan', { n: fmt.num(M.ranked.length) }) }),
    card(t('Top risk applications'), riskTable(M), { cls: 'col-lg-8', bodyCls: 'p-0' }),
    chartCard({ id: 'c-comp', title: t('Compliance exposure'), subtitle: t('Open SAST findings mapped to frameworks'), spec: Specs.compliance(M), cls: 'col-lg-4', height: 300 }),
  );
}

function pageCio(M) {
  const r = M.roi;
  return cards(
    assumptionsNotice(),
    heroBanner(M, { variant: 'cio' }),
    kpi({ ic: 'coin', label: t('Total value delivered'), value: fmt.cur(r.total), sub: t('over {n} months', { n: M.nMonths }) }),
    kpi({ ic: 'trending-up', label: t('Return on investment'), value: r.roi == null ? '—' : fmt.pct(r.roi), sub: r.multiple == null ? t('Set investment in ROI Model') : t('{x} value multiple', { x: fmt.mult(r.multiple) }), tone: 'magenta' }),
    kpi({ ic: 'calculator', label: t('Payback period'), value: r.payback == null ? '—' : t('{m} mo', { m: fmt.num(r.payback, 1) }), sub: r.invest ? t('Investment {v}', { v: fmt.cur(r.invest) }) : t('No investment set'), tone: 'blue' }),
    kpi({ ic: 'clock', label: t('Developer hours saved'), value: fmt.hours(r.hoursSaved), sub: t('≈ {f} FTE per year', { f: fmt.num(r.fte, 1) }), tone: 'orange' }),
    kpi({ ic: 'bolt', label: t('Remediation cost avoided'), value: fmt.cur(r.remediation), sub: t('vs. fixing in production') }),
    kpi({ ic: 'sitemap', label: t('Projects protected'), value: fmt.num(M.projectsScanned), sub: t('{p} scanned in last 30 days', { p: fmt.pct(M.projectsTotal ? M.scanned30 / M.projectsTotal : 0) }), tone: 'blue' }),
    insightList(M, 'cio'),
    chartCard({ id: 'c-cum', title: t('Cumulative value vs. investment'), subtitle: t('Value accrues as vulnerabilities are remediated'), spec: Specs.cumValue(M), cls: 'col-lg-7' }),
    chartCard({ id: 'c-eng', title: t('Value by scanner'), subtitle: t('Remediation savings + incident risk avoided'), spec: Specs.valueByEngine(M), cls: 'col-lg-5' }),
    chartCard({ id: 'c-scans', title: t('Scan volume'), subtitle: t('All branches, per month'), spec: Specs.scansPerMonth(M), cls: 'col-lg-4', height: 240 }),
    chartCard({ id: 'c-contrib', title: t('Active scan initiators'), subtitle: t('Unique users & pipelines per month'), spec: Specs.contributors(M), cls: 'col-lg-4', height: 240 }),
    chartCard({ id: 'c-onb', title: t('Projects onboarded'), subtitle: t('Cumulative'), spec: Specs.onboarded(M), cls: 'col-lg-4', height: 240 }),
    card(t('Efficiency summary'), efficiencyTable(M), { cls: 'col-12', bodyCls: 'p-0' }),
  );
}
function efficiencyRows(M) {
  const r = M.roi;
  const fixedAll = sevTotal(M.tot.fixed);
  return [
    [t('Vulnerabilities remediated'), fmt.num(fixedAll), t('All severities, primary branches')],
    [t('Engineering hours spent fixing early'), fmt.hours(r.fixHoursSpent), t('Fix effort per severity × fixed findings')],
    [t('Engineering hours avoided'), fmt.hours(r.hoursSaved), t('Late-fix multiplier {x}', { x: fmt.mult(Store.s.lateMultiplier) })],
    [t('Value per remediated vulnerability'), fixedAll ? fmt.cur(r.total / fixedAll) : '—', t('Total value ÷ fixed findings')],
    [t('Cost per scan'), r.invest && M.scans.length ? fmt.cur(r.invest / M.scans.length) : '—', t('Investment ÷ scans in period')],
    [t('Scans per project per month'), M.projectsScanned ? fmt.num(M.scans.length / M.projectsScanned / M.nMonths, 1) : '—', t('Automation depth')],
    [t('Lines of code under analysis'), fmt.compact(M.loc), t('Latest SAST scan per project')],
  ];
}
function efficiencyTable(M) {
  return D(
    'table-responsive',
    h(
      'table.table.table-vcenter.card-table',
      h('thead', h('tr', h('th', t('Metric')), h('th.text-end', t('Value')), h('th', t('Basis')))),
      h('tbody', efficiencyRows(M).map((x) => h('tr', h('td.fw-medium', x[0]), h('td.text-end.tabular.fw-bold', x[1]), h('td.text-secondary', x[2])))),
    ),
  );
}

function pageArchitect(M) {
  const withScan = M.projects.filter((p) => p.lastScan);
  const avgEng = withScan.length ? sum(withScan, (p) => p.engines.size) / withScan.length : 0;
  return cards(
    kpi({ ic: 'sitemap', label: t('Projects'), value: fmt.num(M.projectsTotal), sub: t('{a} applications', { a: fmt.num(M.ds.applications.length) }) }),
    kpi({ ic: 'shield', label: t('Scanners per project'), value: fmt.num(avgEng, 1), sub: t('of {n} engines in use', { n: Object.keys(M.engUse).length }), tone: 'magenta' }),
    kpi({ ic: 'refresh', label: t('Scanned last 30 days'), value: fmt.pct(M.projectsTotal ? M.scanned30 / M.projectsTotal : 0), sub: t('{n} stale (>90 days)', { n: fmt.num(M.staleList.length) }), tone: 'blue' }),
    kpi({ ic: 'check', label: t('Scan success rate'), value: fmt.pct(M.successRate, 1), sub: t('{n} failed scans', { n: fmt.num(M.failed) }) }),
    kpi({ ic: 'clock', label: t('Median scan time'), value: M.medianDuration == null ? '—' : `${fmt.num(M.medianDuration, 0)} min`, sub: t('{n} scans in period', { n: fmt.compact(M.scans.length) }), tone: 'orange' }),
    kpi({ ic: 'code', label: t('Lines of code'), value: fmt.compact(M.loc), sub: t('{n} open-source packages', { n: fmt.compact(M.pkg.total) }), tone: 'blue' }),
    insightList(M, 'architect'),
    chartCard({ id: 'c-cov', title: t('Scanner coverage'), subtitle: t('Share of scanned projects using each engine'), spec: Specs.engineCoverage(M) }),
    chartCard({ id: 'c-orig', title: t('Integration points'), subtitle: t('Where scans are triggered from'), spec: Specs.origins(M) }),
    chartCard({ id: 'c-q', title: t('Top vulnerability types'), subtitle: t('Open SAST findings by query, coloured by severity'), spec: Specs.topQueries(M), cls: 'col-lg-7', height: 340 }),
    chartCard({ id: 'c-lang', title: t('Languages'), subtitle: t('Open SAST findings by language'), spec: Specs.languages(M), cls: 'col-lg-5', height: 340 }),
    chartCard({ id: 'c-health', title: t('Scan health'), subtitle: t('Scan outcomes per month'), spec: Specs.scanHealth(M), cls: 'col-lg-7' }),
    card(t('Triage status'), frag(segBar(triageSegments(M), { height: 16 }), D('text-secondary small mt-3', t('{n} findings re-classified as not exploitable in sampled critical/high results — noise removed from developer queues.', { n: fmt.num(M.triaged) }))), { cls: 'col-lg-5', subtitle: t('State of open findings at the latest scan') }),
    chartCard({ id: 'c-plat', title: t('Infrastructure-as-code platforms'), subtitle: t('Open IaC findings'), spec: Specs.platforms(M), cls: 'col-lg-5', height: 260 }),
    card(t('Coverage matrix'), coverageMatrix(M), { cls: 'col-lg-7', bodyCls: 'p-0', subtitle: t('Engines used per project in the period') }),
  );
}
function triageSegments(M) {
  const s = M.states;
  const label = { TO_VERIFY: t('To verify'), CONFIRMED: t('Confirmed'), URGENT: t('Urgent'), NOT_EXPLOITABLE: t('Not exploitable'), PROPOSED_NOT_EXPLOITABLE: t('Proposed not exploitable') };
  const color = { TO_VERIFY: 'other', CONFIRMED: 'cat:0', URGENT: 'cat:2', NOT_EXPLOITABLE: 'cat:3', PROPOSED_NOT_EXPLOITABLE: 'cat:1' };
  return Object.keys(label)
    .filter((k) => s[k])
    .map((k) => ({ label: label[k], value: s[k], color: color[k] }));
}
function coverageMatrix(M) {
  const engs = Object.keys(M.engUse).sort((a, b) => M.engUse[b] - M.engUse[a]);
  const rows = [...M.projects].sort((a, b) => a.engines.size - b.engines.size || a.name.localeCompare(b.name)).slice(0, 60);
  return h(
    'div.table-responsive',
    { style: { 'max-height': '420px' } },
    h(
      'table.table.table-sm.table-vcenter.card-table.coverage',
      h('thead.sticky-top', h('tr', h('th', t('Project')), engs.map((e) => h('th.text-center', ENGINE_LABEL(e))), h('th', t('Last scan')))),
      h(
        'tbody',
        rows.map((p) => h('tr', h('td.fw-medium', p.name), engs.map((e) => h('td.text-center', p.engines.has(e) ? h('span.cov-yes', { title: ENGINE_LABEL(e) }, icon('check')) : Sp('cov-no', '·'))), h('td.text-secondary.small', p.lastScan ? fmt.rel(p.lastScan.c) : t('Never')))),
      ),
    ),
  );
}

/* ---------- Team lead: sortable project table ------------------------------------------- */
const TableState = { sort: 'risk', dir: -1, q: '', page: 0, size: 15 };
function pageLead(M) {
  const net = M.tot.fixed.C + M.tot.fixed.H - (M.tot.new.C + M.tot.new.H);
  const medAge = median(M.open.map((f) => f.age).filter((x) => x != null));
  return cards(
    kpi({ ic: 'alert', label: t('Open critical & high'), value: fmt.num(M.tot.open.C + M.tot.open.H), sub: t('{c} critical', { c: fmt.num(M.tot.open.C) }), tone: 'magenta' }),
    kpi({ ic: 'bug', label: t('Newly detected'), value: fmt.num(M.tot.new.C + M.tot.new.H), sub: t('Critical & high in period'), tone: 'orange' }),
    kpi({ ic: 'check', label: t('Remediated'), value: fmt.num(M.tot.fixed.C + M.tot.fixed.H), sub: t('Critical & high in period') }),
    kpi({ ic: net >= 0 ? 'trending-down' : 'trending-up', label: t('Net backlog change'), value: `${net >= 0 ? '−' : '+'}${fmt.num(Math.abs(net))}`, sub: net >= 0 ? t('Backlog shrinking') : t('Backlog growing'), tone: net >= 0 ? 'blue' : 'orange' }),
    kpi({ ic: 'clock', label: t('Past SLA'), value: fmt.num(M.openOverdue.length), sub: t('of {n} open critical/high analysed', { n: fmt.num(M.open.length) }), tone: 'magenta' }),
    kpi({ ic: 'refresh', label: t('Median backlog age'), value: fmt.days(medAge), sub: t('MTTR high: {d}', { d: fmt.days(M.mttr.H) }), tone: 'blue' }),
    insightList(M, 'lead'),
    chartCard({ id: 'c-nvf2', title: t('Remediated vs. newly detected'), subtitle: t('Critical & high, per month'), spec: Specs.newVsFixed(M), cls: 'col-lg-7' }),
    chartCard({ id: 'c-aging', title: t('Backlog aging'), subtitle: t('Open critical & high by age'), spec: Specs.aging(M), cls: 'col-lg-5' }),
    col(
      'col-12',
      h(
        'div.card',
        h(
          'div.card-header',
          h('div', h('h3.card-title', t('Projects')), D('card-subtitle', t('Open findings at latest scan; fixed and new in period (primary branch)'))),
          D('card-actions', D('input-icon', Sp('input-icon-addon', icon('search')), h('input.form-control.form-control-sm', { type: 'search', id: 'proj-search', placeholder: t('Search projects…'), value: TableState.q, 'aria-label': t('Search projects…') }))),
        ),
        h('div#proj-table', projectTable(M)),
      ),
    ),
  );
}
function pager(state, action, total) {
  const pages = Math.max(1, Math.ceil(total / state.size));
  const btn = (page, label, disabled) => h('li', { class: `page-item ${disabled ? 'disabled' : ''}` }, h('button.page-link', { type: 'button', 'data-action': action, 'data-page': page, disabled }, label));
  return h('ul.pagination.m-0.ms-auto', btn(state.page - 1, '‹', state.page === 0), h('li.page-item.active', Sp('page-link', `${state.page + 1} / ${pages}`)), btn(state.page + 1, '›', state.page >= pages - 1));
}
const showing = (state, n) => h('p.m-0.text-secondary.small', t('Showing {a}–{b} of {n}', { a: n ? state.page * state.size + 1 : 0, b: Math.min(n, (state.page + 1) * state.size), n }));
function projectTable(M) {
  const q = TableState.q.toLowerCase();
  const key = TableState.sort;
  const val = (p) => ({ name: p.name.toLowerCase(), grade: 'ABCDF'.indexOf(p.grade), C: p.open.C, H: p.open.H, M: p.open.M, L: p.open.L, fixed: p.fixed.C + p.fixed.H, new: p.new.C + p.new.H, last: p.lastScan ? new Date(p.lastScan.c).getTime() : 0, risk: p.risk })[key];
  const rows = M.projects.filter((p) => !q || p.name.toLowerCase().includes(q) || p.appNames.some((a) => a.toLowerCase().includes(q))).sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * TableState.dir);
  const pages = Math.max(1, Math.ceil(rows.length / TableState.size));
  TableState.page = clamp(TableState.page, 0, pages - 1);
  const view = rows.slice(TableState.page * TableState.size, (TableState.page + 1) * TableState.size);
  const P = pal();
  const th = (k, label, cls = '') => h('th', { class: cls }, h('button', { type: 'button', class: `table-sort ${TableState.sort === k ? (TableState.dir > 0 ? 'asc' : 'desc') : ''}`, 'data-action': 'sort', 'data-key': k }, label));
  return frag(
    D(
      'table-responsive',
      h(
        'table.table.table-vcenter.card-table.table-hover',
        h('thead', h('tr', th('name', t('Project')), th('grade', t('Grade'), 'text-center'), SEVS.map((s) => th(s, SEV_LABEL()[s], 'text-end')), th('fixed', t('Fixed C/H'), 'text-end'), th('new', t('New C/H'), 'text-end'), h('th', t('Trend')), th('last', t('Last scan')), th('risk', t('Risk score'), 'text-end'))),
        h(
          'tbody',
          view.map((p) =>
            h(
              'tr',
              h('td', D('fw-medium', p.name), D('text-secondary small', p.appNames.join(', ') || p.groups.join(', '), p.branch ? frag(' · ', icon('git-branch', 'icon-inline'), p.branch) : null)),
              h('td.text-center', gradeBadge(p.grade)),
              sevCells(p.open),
              h('td.text-end.tabular', fmt.num(p.fixed.C + p.fixed.H)),
              h('td.text-end.tabular', fmt.num(p.new.C + p.new.H)),
              h('td', sparkline(p.trend, p.netCH >= 0 ? P.cat[0] : P.cat[2])),
              h('td.text-secondary.small', p.lastScan ? fmt.rel(p.lastScan.c) : t('Never')),
              h('td.text-end.tabular.fw-bold', fmt.num(p.risk)),
            ),
          ),
        ),
      ),
    ),
    D('card-footer d-flex align-items-center', showing(TableState, rows.length), pager(TableState, 'page', rows.length)),
  );
}

/* ---------- Developer: prioritised findings ---------------------------------------------- */
const FindState = { sev: '', engine: '', project: '', q: '', overdue: false, page: 0, size: 25 };
function findingLinks(f) {
  const links = [];
  if (f.cwe && /^\d+$/.test(f.cwe)) links.push(h('a', { href: `https://cwe.mitre.org/data/definitions/${f.cwe}.html`, target: '_blank', rel: 'noopener noreferrer' }, `CWE-${f.cwe}`));
  if (f.cve && /^CVE-\d{4}-\d+$/.test(f.cve)) links.push(h('a', { href: `https://nvd.nist.gov/vuln/detail/${f.cve}`, target: '_blank', rel: 'noopener noreferrer' }, f.cve));
  return links;
}
function cxLink(M, f) {
  if (M.ds.source !== 'live' || !M.ds.tenant?.astUrl || !f.scan) return null;
  const branch = M.ds.primary?.[f.p] || '';
  const u = `${M.ds.tenant.astUrl}/projects/${encodeURIComponent(f.p)}/scans?id=${encodeURIComponent(f.scan)}&branch=${encodeURIComponent(branch)}`;
  return h('a.btn.btn-icon.btn-ghost-primary.btn-sm', { href: u, target: '_blank', rel: 'noopener noreferrer', title: t('Open in Checkmarx One'), 'aria-label': t('Open in Checkmarx One') }, icon('external'));
}
function filteredFindings(M) {
  const q = FindState.q.toLowerCase();
  return M.open.filter(
    (f) =>
      (!FindState.sev || f.s === FindState.sev) &&
      (!FindState.engine || f.t === FindState.engine) &&
      (!FindState.project || f.p === FindState.project) &&
      (!FindState.overdue || f.overdue) &&
      (!q || `${f.title} ${f.file} ${f.pkg} ${f.cve} ${f.cwe} ${f.project}`.toLowerCase().includes(q)),
  );
}
function option(value, label, selected) {
  return h('option', { value, selected: selected || null }, label);
}
function pageDev(M) {
  const engines = [...new Set(M.open.map((f) => f.t))];
  const projects = [...new Map(M.open.map((f) => [f.p, f.project])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const oldest = Math.max(0, ...M.open.map((f) => f.age || 0));
  return cards(
    kpi({ ic: 'flame', label: t('Open critical'), value: fmt.num(M.open.filter((f) => f.s === 'C').length), sub: t('in {n} analysed projects', { n: M.deepProjects }), tone: 'magenta' }),
    kpi({ ic: 'alert', label: t('Open high'), value: fmt.num(M.open.filter((f) => f.s === 'H').length), sub: t('{n} past SLA', { n: fmt.num(M.openOverdue.length) }), tone: 'orange' }),
    kpi({ ic: 'bolt', label: t('Quick wins'), value: fmt.num(M.quickWins.length), sub: t('Package upgrades available'), tone: 'blue' }),
    kpi({ ic: 'clock', label: t('Oldest open'), value: fmt.days(oldest), sub: t('SLA critical {c} · high {h}', { c: fmt.days(Store.s.sla.C), h: fmt.days(Store.s.sla.H) }) }),
    kpi({ ic: 'trophy', label: t('Fixed by your teams'), value: fmt.num(M.fixed.length), sub: t('Critical & high, analysed projects'), tone: 'blue' }),
    kpi({ ic: 'refresh', label: t('Median time to fix'), value: fmt.days(M.mttr.all), sub: t('Critical & high'), tone: 'orange' }),
    insightList(M, 'dev'),
    col(
      'col-12',
      h(
        'div.card',
        h(
          'div.card-header.flex-wrap.gap-2',
          h('div', h('h3.card-title', t('Fix next')), D('card-subtitle', t('Open critical & high findings, most severe and oldest first'))),
          D(
            'card-actions d-flex flex-wrap gap-2 filters',
            h('select.form-select.form-select-sm', { 'data-find': 'sev', 'aria-label': t('Severity') }, option('', t('All severities')), ['C', 'H'].map((s) => option(s, SEV_LABEL()[s], FindState.sev === s))),
            h('select.form-select.form-select-sm', { 'data-find': 'engine', 'aria-label': t('Scanner') }, option('', t('All scanners')), engines.map((e) => option(e, ENGINE_LABEL(e === 'sscs-secret-detection' ? 'secrets' : e), FindState.engine === e))),
            h('select.form-select.form-select-sm', { 'data-find': 'project', 'aria-label': t('Project') }, option('', t('All projects')), projects.map(([id, n]) => option(id, n, FindState.project === id))),
            h('label.form-check.form-switch.m-0.align-self-center', h('input.form-check-input', { type: 'checkbox', 'data-find': 'overdue', checked: FindState.overdue || null }), Sp('form-check-label small', t('Past SLA only'))),
            D('input-icon', Sp('input-icon-addon', icon('search')), h('input.form-control.form-control-sm', { type: 'search', 'data-find': 'q', placeholder: t('Search title, file, package, CVE…'), value: FindState.q, 'aria-label': t('Search') })),
          ),
        ),
        h('div#find-table', findingsTable(M)),
      ),
    ),
    chartCard({ id: 'c-q2', title: t('Most common vulnerability types'), subtitle: t('Learn the patterns that recur in your code'), spec: Specs.topQueries(M, 8), height: 300 }),
    card(t('Quick wins'), quickWinsTable(M), { bodyCls: 'p-0', subtitle: t('Upgrade these packages to close critical/high findings') }),
  );
}
const findingLocation = (f) => (f.pkg ? `${f.pkg}${f.rec ? ` → ${f.rec}` : ''}` : f.img || `${f.file || ''}${f.line ? ':' + f.line : ''}`);
function findingsTable(M) {
  if (!M.open.length) return D('card-body text-secondary', t('No open critical or high findings in the analysed projects.'));
  const rows = filteredFindings(M);
  const pages = Math.max(1, Math.ceil(rows.length / FindState.size));
  FindState.page = clamp(FindState.page, 0, pages - 1);
  const view = rows.slice(FindState.page * FindState.size, (FindState.page + 1) * FindState.size);
  const slaBadge = (f) => {
    if (f.daysLeft == null) return null;
    if (f.overdue) return Sp('badge bg-red-lt', t('{d} overdue', { d: fmt.days(-f.daysLeft) }));
    return Sp(`badge ${f.daysLeft <= 7 ? 'bg-yellow-lt' : 'bg-green-lt'}`, t('{d} left', { d: fmt.days(f.daysLeft) }));
  };
  return frag(
    D(
      'table-responsive',
      h(
        'table.table.table-vcenter.card-table.table-hover.findings',
        h('thead', h('tr', h('th', t('Severity')), h('th', t('Finding')), h('th', t('Project')), h('th', t('Location')), h('th.text-end', t('Age')), h('th', t('SLA')), h('th'))),
        h(
          'tbody',
          view.map((f) => {
            const loc = findingLocation(f);
            return h(
              'tr',
              h('td', sevChip(f.s)),
              h('td', D('fw-medium', f.title), D('small text-secondary d-flex gap-2 flex-wrap', engineBadge(f.t), findingLinks(f), f.st && f.st !== 'TO_VERIFY' ? h('span', f.st.replace(/_/g, ' ').toLowerCase()) : null)),
              h('td.small', f.project),
              h('td.small.loc', { title: loc }, h('code', truncate(loc, 64))),
              h('td.text-end.tabular.small', f.age == null ? '—' : fmt.num(f.age)),
              h('td', slaBadge(f)),
              h('td', cxLink(M, f)),
            );
          }),
        ),
      ),
    ),
    D('card-footer d-flex align-items-center flex-wrap gap-2', showing(FindState, rows.length), h('button.btn.btn-sm.btn-ghost-primary.ms-3', { type: 'button', 'data-action': 'export-csv' }, icon('download'), t('Export CSV')), pager(FindState, 'fpage', rows.length)),
  );
}
function quickWinRows(M) {
  const by = new Map();
  for (const f of M.quickWins) {
    const k = `${f.pkg}→${f.rec}`;
    const r = by.get(k) || { pkg: f.pkg, rec: f.rec, n: 0, C: 0, projects: new Set() };
    r.n++;
    if (f.s === 'C') r.C++;
    r.projects.add(f.project);
    by.set(k, r);
  }
  return [...by.values()].sort((a, b) => b.C - a.C || b.n - a.n).slice(0, 10);
}
function quickWinsTable(M) {
  const rows = quickWinRows(M);
  if (!rows.length) return D('p-3 text-secondary', t('No package upgrades pending.'));
  return D(
    'table-responsive',
    h(
      'table.table.table-vcenter.card-table',
      h('thead', h('tr', h('th', t('Package')), h('th', t('Upgrade to')), h('th.text-end', t('Findings closed')), h('th.text-end', t('Projects')))),
      h('tbody', rows.map((r) => h('tr', h('td', h('code', truncate(r.pkg, 40))), h('td', Sp('badge bg-green-lt', r.rec)), h('td.text-end.tabular', fmt.num(r.n), r.C ? Sp('text-secondary small', ` (${r.C} ${SEV_LABEL().C.toLowerCase()})`) : null), h('td.text-end.tabular', r.projects.size)))),
    ),
  );
}

/* ---------- ROI model ----------------------------------------------------------------------- */
function assumptionsForm(prefix = 'f') {
  const sym = curSymbol();
  const hint = (x) => (x ? D('form-hint', x) : null);
  const curIn = (path, label, hn, step = 1) =>
    D('mb-3', h('label.form-label', { for: `${prefix}-${path}` }, label), D('input-group input-group-flat', Sp('input-group-text', sym), h('input.form-control', { type: 'number', min: 0, step, id: `${prefix}-${path}`, 'data-setting': path, 'data-type': 'cur', value: Math.round(Store.get(path) * fxRate()) })), hint(hn));
  const sevIn = (base, label, hn, unit, step = 0.5) =>
    D(
      'mb-3',
      D('form-label', label),
      D(
        'row g-2',
        SEVS.map((s) => D('col-3', D('sev-input', Sp(`sev-dot sev-${s}`), h('input.form-control.form-control-sm', { type: 'number', min: 0, step, 'aria-label': `${label} — ${SEV_LABEL()[s]}`, 'data-setting': `${base}.${s}`, 'data-type': 'num', value: Store.get(`${base}.${s}`) }), Sp('unit', unit)), D('sev-input-label', SEV_LABEL()[s]))),
      ),
      hint(hn),
    );
  const numIn = (path, label, hn, unit, step = 1, min = 0) =>
    D('mb-3', h('label.form-label', { for: `${prefix}-${path}` }, label), D('input-group input-group-flat', h('input.form-control', { type: 'number', min, step, id: `${prefix}-${path}`, 'data-setting': path, 'data-type': 'num', value: Store.get(path) }), Sp('input-group-text', unit)), hint(hn));
  const section = (ic, label) => D('form-section', icon(ic), label);
  return D(
    'assumptions',
    D('mb-3', D('form-label', t('Preset')), h('div.btn-group.w-100', { role: 'group' }, ['conservative', 'balanced', 'aggressive'].map((p) => h('button', { type: 'button', class: `btn btn-sm ${presetActive(p) ? 'btn-primary' : 'btn-outline-primary'}`, 'data-action': 'preset', 'data-preset': p }, t(p[0].toUpperCase() + p.slice(1)))))),
    section('coin', t('Investment')),
    curIn('investment', t('Annual Checkmarx One investment'), t('Licence and operating cost per year. Pro-rated to the analysis period.'), 1000),
    section('users', t('Developer cost')),
    curIn('devRate', t('Fully loaded developer cost per hour'), t('Salary, benefits and overhead.')),
    sevIn('fixHours', t('Hours to fix when found early'), t('Average engineering effort per vulnerability, per severity.'), unitLabel('hour')),
    numIn('lateMultiplier', t('Cost multiplier if found in production'), t('Industry studies cite 6×–30× for late-stage fixes (incident response, hotfix, re-test, release).'), '×', 0.5, 1),
    section('shield', t('Breach risk (cost of the leak that did not happen)')),
    curIn('breachCost', t('Average cost of a data breach'), t('Default: IBM Cost of a Data Breach Report 2025 global average (USD 4.44M).'), 10000),
    sevIn('pExploit', t('Probability a vulnerability leads to a breach'), t('Per remediated vulnerability, per year. Combined per application: 1 − Π(1 − p).'), '%', 0.01),
    numIn('repShare', t('Reputational share of breach cost'), t('Lost business, churn and brand damage — historically about 30% of total breach cost.'), '%', 1),
    numIn('maxIncidentsPerYear', t('Cap: breach-scale incidents avoided per year'), t('Keeps the estimate credible for large portfolios. 0 = no cap.'), '/yr', 0.1),
    h('label.form-check.form-switch', h('input.form-check-input', { type: 'checkbox', 'data-setting': 'critWeighting', 'data-type': 'bool', checked: Store.s.critWeighting || null }), Sp('form-check-label', t('Weight risk by application criticality (Checkmarx One project criticality 1–5)'))),
  );
}
function presetActive(p) {
  const P = PRESETS[p];
  const S = Store.s;
  return S.lateMultiplier === P.lateMultiplier && SEVS.every((k) => S.fixHours[k] === P.fixHours[k] && S.pExploit[k] === P.pExploit[k]) && S.maxIncidentsPerYear === P.maxIncidentsPerYear;
}
function pageRoi(M) {
  return D(
    'row row-cards',
    D('col-lg-5', h('div.card', h('div.card-header', h('h3.card-title', t('Assumptions')), D('card-actions text-secondary small', t('Values in {c}', { c: Store.s.currency }))), D('card-body', assumptionsForm('roi')))),
    D('col-lg-7', h('div#roi-results.row.row-cards', roiResults(M))),
  );
}
function sensitivity(M) {
  return Object.keys(PRESETS).map((k) => {
    const r2 = computeRoi(M.projects, M.tot.fixed, M.mFixed, { ...Store.s, ...PRESETS[k] }, M.years, M.nMonths, M.engines);
    return { k, label: t(k[0].toUpperCase() + k.slice(1)), total: r2.total, roi: r2.roi, risk: r2.risk, rem: r2.remediation };
  });
}
function roiResults(M) {
  const r = M.roi;
  const S = Store.s;
  const f = M.tot.fixed;
  const block = (title, eq, numLine) => D('formula-block', D('formula-title', title), D('formula-eq', eq), D('formula-num', numLine));
  return frag(
    kpi({ ic: 'coin', label: t('Total value'), value: fmt.cur(r.total), cls: 'col-sm-6 col-xl-3' }),
    kpi({ ic: 'trending-up', label: t('ROI'), value: r.roi == null ? '—' : fmt.pct(r.roi), sub: r.multiple == null ? t('Set investment') : fmt.mult(r.multiple), tone: 'magenta', cls: 'col-sm-6 col-xl-3' }),
    kpi({ ic: 'calculator', label: t('Payback'), value: r.payback == null ? '—' : t('{m} mo', { m: fmt.num(r.payback, 1) }), tone: 'blue', cls: 'col-sm-6 col-xl-3' }),
    kpi({ ic: 'shield', label: t('Expected incidents avoided'), value: fmt.num(r.incidents, 2), sub: r.capped ? t('capped') : t('uncapped'), tone: 'orange', cls: 'col-sm-6 col-xl-3' }),
    chartCard({ id: 'c-vc', title: t('Value composition'), spec: Specs.valueComposition(M), cls: 'col-12', height: 220 }),
    col(
      'col-12',
      h(
        'div.card',
        h('div.card-header', h('h3.card-title', t('How the value is calculated'))),
        D(
          'card-body formula',
          block(
            t('1 · Remediation cost avoided'),
            `Σ ${t('fixed')} × ${t('hours to fix')} × ${t('hourly cost')} × (${t('multiplier')} − 1)`,
            frag(`${SEVS.map((s) => `${fmt.num(f[s])}×${fmt.num(S.fixHours[s], 1)}h`).join(' + ')} = ${fmt.hours(r.fixHoursSpent)} × ${fmt.curFull(S.devRate)} × ${fmt.num(S.lateMultiplier - 1, 1)} = `, h('b', fmt.cur(r.remediation))),
          ),
          block(
            t('2 · Incident risk avoided (cost of the leak that did not happen)'),
            `P(${t('breach')}) = 1 − Π (1 − p)^${t('fixed')};  ${t('risk')} = min(Σ P, ${t('cap')}) × ${t('breach cost')}`,
            frag(`min(${fmt.num(r.expIncidents, 2)}, ${S.maxIncidentsPerYear > 0 ? fmt.num(S.maxIncidentsPerYear * M.years, 2) : '∞'}) × ${fmt.cur(S.breachCost)} = `, h('b', fmt.cur(r.risk)), Sp('text-secondary', ` (${t('{p} reputational', { p: fmt.pct(S.repShare / 100) })})`)),
          ),
          block(
            t('3 · Return on investment'),
            `ROI = (${t('value')} − ${t('investment')}) ÷ ${t('investment')}`,
            r.invest ? frag(`(${fmt.cur(r.total)} − ${fmt.cur(r.invest)}) ÷ ${fmt.cur(r.invest)} = `, h('b', fmt.pct(r.roi))) : t('Enter your annual investment to compute ROI and payback.'),
          ),
          D('text-secondary small mt-3', t('Remediated findings are derived from consecutive scans of each project’s primary branch (findings present in one scan and absent from the next). This is a conservative lower bound. Estimates are indicative and not a guarantee of avoided loss.')),
        ),
      ),
    ),
    card(
      t('Sensitivity'),
      D(
        'table-responsive',
        h(
          'table.table.table-vcenter.card-table',
          h('thead', h('tr', h('th', t('Preset')), h('th.text-end', t('Remediation')), h('th.text-end', t('Incident risk')), h('th.text-end', t('Total value')), h('th.text-end', t('ROI')))),
          h('tbody', sensitivity(M).map((x) => h('tr', { class: presetActive(x.k) ? 'table-active' : '' }, h('td.fw-medium', x.label), h('td.text-end.tabular', fmt.cur(x.rem)), h('td.text-end.tabular', fmt.cur(x.risk)), h('td.text-end.tabular.fw-bold', fmt.cur(x.total)), h('td.text-end.tabular', x.roi == null ? '—' : fmt.pct(x.roi))))),
        ),
      ),
      { cls: 'col-12', bodyCls: 'p-0' },
    ),
    card(
      t('Model inputs from your data'),
      h('table.table.table-sm.mb-0', h('tbody', SEVS.map((s) => h('tr', h('td', sevChip(s)), h('td.text-end.tabular', `${fmt.num(f[s])} ${t('fixed')}`))), h('tr', h('td', t('Analysis period')), h('td.text-end', t('{n} months', { n: M.nMonths }))), h('tr', h('td', t('Projects')), h('td.text-end', fmt.num(M.projectsScanned))))),
      { cls: 'col-12' },
    ),
  );
}

/* ---------- Settings drawer -------------------------------------------------------------- */
function settingsBody() {
  const S = Store.s;
  const sel = (path, opts, label, id) => D('mb-3', h('label.form-label', { for: id }, label), h('select.form-select', { id, 'data-setting': path, 'data-type': 'str' }, opts.map(([v, l]) => option(v, l, String(Store.get(path)) === String(v)))));
  const active = App.settingsTab || 'general';
  const tab = (id, label) => h('li.nav-item', h('button', { type: 'button', class: `nav-link ${active === id ? 'active' : ''}`, 'data-action': 'settings-tab', 'data-tab': id }, label));
  const pane = (id, ...body) => h('div', { class: `settings-pane ${active === id ? '' : 'd-none'}`, 'data-pane': id }, ...body);
  const ds = App.ds;
  return frag(
    h('ul.nav.nav-tabs.nav-fill.mb-3', tab('general', t('General')), tab('value', t('Cost & risk')), tab('sla', t('SLA')), tab('report', t('Report')), tab('data', t('Data'))),
    pane(
      'general',
      sel('lang', Object.entries(LANGS), t('Language'), 's-lang'),
      sel('locale', LOCALES.map((l) => [l, l === 'auto' ? t('Automatic (from language)') : l]), t('Number & date format'), 's-locale'),
      sel('currency', Object.keys(CURRENCIES).map((c) => [c, c]), t('Currency'), 's-cur'),
      D(
        'mb-3',
        h('label.form-label', { for: 's-fx' }, t('Exchange rate')),
        D('input-group input-group-flat', Sp('input-group-text', '1 USD ='), h('input.form-control', { type: 'number', step: '0.0001', min: '0.0001', id: 's-fx', 'data-setting': `fx.${S.currency}`, 'data-type': 'num', value: fxRate() }), Sp('input-group-text', S.currency)),
        D('form-hint', t('Cost inputs are stored in USD and converted with this rate. Update it to today’s rate.')),
      ),
      sel('theme', [['light', t('Light')], ['dark', t('Dark')]], t('Theme'), 's-theme'),
    ),
    pane('value', assumptionsForm('set')),
    pane(
      'sla',
      h('p.text-secondary.small', t('Remediation SLA in days, used for SLA compliance, overdue flags and countdowns.')),
      SEVS.map((s) => D('mb-3', D('form-label', sevChip(s)), D('input-group input-group-flat', h('input.form-control', { type: 'number', min: 1, 'data-setting': `sla.${s}`, 'data-type': 'num', value: S.sla[s], 'aria-label': `SLA ${SEV_LABEL()[s]}` }), Sp('input-group-text', t('days'))))),
    ),
    pane(
      'report',
      D('mb-3', h('label.form-label', { for: 's-org' }, t('Prepared for (organisation)')), h('input.form-control', { id: 's-org', 'data-setting': 'report.org', 'data-type': 'str', value: S.report.org, placeholder: t('e.g. ACME Corp') })),
      D('mb-3', h('label.form-label', { for: 's-by' }, t('Prepared by')), h('input.form-control', { id: 's-by', 'data-setting': 'report.preparedBy', 'data-type': 'str', value: S.report.preparedBy, placeholder: t('Name, role') })),
      h('label.form-check.form-switch', h('input.form-check-input', { type: 'checkbox', 'data-setting': 'report.confidential', 'data-type': 'bool', checked: S.report.confidential || null }), Sp('form-check-label', t('Mark reports as confidential'))),
    ),
    pane(
      'data',
      D('mb-3', D('form-label', t('Source')), D('text-secondary', ds ? `${ds.source === 'live' ? t('Live tenant') : ds.source === 'demo' ? t('Demo data') : t('Snapshot')} · ${ds.tenant?.name || ''} · ${fmt.date(ds.generatedAt)}` : '—')),
      sel('deepProjects', [10, 25, 50, 100, 200].map((n) => [n, String(n)]), t('Projects analysed in depth (critical/high findings)'), 's-deep'),
      sel('deepScans', [4, 6, 10, 16].map((n) => [n, String(n)]), t('Scans sampled per project for time-to-fix'), 's-deeps'),
      D('form-hint mb-3', t('Higher values improve MTTR and story accuracy but take longer to collect. Applied on the next refresh.')),
      D(
        'd-grid gap-2',
        h('button.btn.btn-outline-primary.rounded-pill', { type: 'button', 'data-action': 'export-json' }, icon('download'), t('Export data snapshot (JSON)')),
        ds?.source === 'live' ? h('button.btn.btn-outline-secondary.rounded-pill', { type: 'button', 'data-action': 'clear-cache' }, icon('database'), t('Clear local cache')) : null,
        h('button.btn.btn-outline-danger.rounded-pill', { type: 'button', 'data-action': 'disconnect' }, icon('logout'), t('Disconnect')),
      ),
      ds?.warnings?.length ? D('alert alert-warning mt-3 small', ds.warnings.map((w) => h('div', w))) : null,
    ),
  );
}
