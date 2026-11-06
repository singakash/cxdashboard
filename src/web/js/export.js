/* ============================================================================================
 * export.js — one slide model → three renderers:
 *   PowerPoint (pptxgenjs, native editable charts & tables, 16×9 in brand canvas)
 *   PDF        (HTML slides rasterised with html2canvas → jsPDF, one page per slide)
 *   Print      (same HTML slides in a print frame → vector "Save as PDF")
 * ========================================================================================== */
const SLIDE_W = 16;
const SLIDE_H = 9;
const PX = 96; // px per inch for HTML slides
const X0 = 0.6;
const CW = SLIDE_W - 2 * X0;
const Y0 = 1.85;
const BRAND = { violet: '6B34FD', magenta: 'A822BF', orange: 'F25929', blue: '006BD5', midnight: '140920', cloud: 'FCF9FE', tint20: 'E1D6FF', tint60: 'A685FE', muted: '6E6680', grid: 'ECE7F3', white: 'FFFFFF' };
const TONE = { violet: BRAND.violet, magenta: BRAND.magenta, blue: BRAND.blue, orange: BRAND.orange };
const hex = (c) => safeColor(c).replace('#', '').toUpperCase();

/* ---------- Slide builders --------------------------------------------------------------- */
function reportMeta(M) {
  const S = Store.s;
  return {
    org: S.report.org,
    by: S.report.preparedBy,
    period: `${fmt.date(M.from)} – ${fmt.date(M.to)}`,
    tenant: M.ds.tenant?.name || '',
    date: fmt.date(new Date()),
    confidential: S.report.confidential,
    scope: M.filter.app ? M.ds.applications.find((a) => a.id === M.filter.app)?.name : t('All applications'),
  };
}
const kpiItems = (list) => list.filter(Boolean);
function cover(M, subtitle) {
  return { kind: 'cover', title: t('Application Security Value Report'), subtitle, meta: reportMeta(M) };
}
function execSummary(M, persona) {
  const r = M.roi;
  const fixedAll = sevTotal(M.tot.fixed);
  const items =
    persona === 'cio'
      ? [
          { label: t('Total value delivered'), value: fmt.cur(r.total), sub: t('over {n} months', { n: M.nMonths }), tone: 'violet' },
          { label: t('Return on investment'), value: r.roi == null ? '—' : fmt.pct(r.roi), sub: r.multiple == null ? t('No investment set') : t('{x} value multiple', { x: fmt.mult(r.multiple) }), tone: 'magenta' },
          { label: t('Payback period'), value: r.payback == null ? '—' : t('{m} mo', { m: fmt.num(r.payback, 1) }), sub: r.invest ? t('Investment {v}', { v: fmt.cur(r.invest) }) : '', tone: 'blue' },
          { label: t('Developer hours saved'), value: fmt.hours(r.hoursSaved), sub: t('≈ {f} FTE per year', { f: fmt.num(r.fte, 1) }), tone: 'orange' },
          { label: t('Projects protected'), value: fmt.num(M.projectsScanned), sub: t('{p} scanned in last 30 days', { p: fmt.pct(M.projectsTotal ? M.scanned30 / M.projectsTotal : 0) }), tone: 'violet' },
        ]
      : [
          { label: t('Risk exposure avoided'), value: fmt.cur(r.risk), sub: t('{d} direct · {r} reputational', { d: fmt.cur(r.direct), r: fmt.cur(r.reputational) }), tone: 'violet' },
          { label: t('Critical & high fixed'), value: fmt.num(M.tot.fixed.C + M.tot.fixed.H), sub: t('{c} critical · {h} high', { c: fmt.num(M.tot.fixed.C), h: fmt.num(M.tot.fixed.H) }), tone: 'magenta' },
          { label: t('Risk reduction'), value: M.riskReduction == null ? '—' : fmt.pct(M.riskReduction), sub: t('Severity-weighted, since {d}', { d: fmt.monthLong(M.months[0]) }), tone: 'blue' },
          { label: t('MTTR critical'), value: fmt.days(M.mttr.C), sub: t('High: {d}', { d: fmt.days(M.mttr.H) }), tone: 'orange' },
          { label: t('SLA compliance'), value: fmt.pct(M.slaCompliance), sub: t('{n} open past SLA', { n: fmt.num(M.openOverdue.length) }), tone: 'violet' },
        ];
  return {
    eyebrow: personaById(persona).label(),
    title: t('Executive summary'),
    subtitle: t('{scope} · {period}', { scope: reportMeta(M).scope, period: reportMeta(M).period }),
    blocks: [
      {
        type: 'hero',
        x: X0,
        y: Y0,
        w: CW,
        h: 2.15,
        eyebrow: `${t('Value delivered')} · ${t('last {n} months', { n: M.nMonths })}`,
        value: fmt.cur(r.total),
        text: persona === 'cio' ? t('in avoided remediation and incident costs, from {n} vulnerabilities fixed early', { n: fmt.num(fixedAll) }) : t('in risk-adjusted value from {n} vulnerabilities remediated before exploitation', { n: fmt.num(fixedAll) }),
        stats: [
          r.multiple != null
            ? { label: t('Return on investment'), value: fmt.mult(r.multiple) }
            : { label: t('Value per remediated vulnerability'), value: fixedAll ? fmt.cur(r.total / fixedAll) : '—' },
          { label: t('Incident risk avoided'), value: fmt.cur(r.risk) },
          { label: t('Remediation cost avoided'), value: fmt.cur(r.remediation) },
          { label: t('Developer hours saved'), value: fmt.hours(r.hoursSaved) },
        ],
      },
      { type: 'kpis', x: X0, y: 4.2, w: CW, h: 1.35, items },
      { type: 'bullets', x: X0, y: 5.85, w: CW, h: 2.3, title: t('Key insights'), items: insights(M, persona === 'cio' ? 'cio' : 'ciso').slice(0, 4) },
    ],
  };
}
function storyBlock(M, y, h, n = 4) {
  return { type: 'stories', x: X0, y, w: CW, h, items: M.stories.slice(0, n) };
}
function tableRowsRisk(M, n) {
  return riskRows(M, n).map((r) => [r.name, { text: r.grade, grade: r.grade }, ...SEVS.map((s) => ({ text: fmt.num(r.open[s]), align: 'right' })), { text: fmt.num(r.fixed.C + r.fixed.H), align: 'right' }]);
}
const riskCols = (M) => [
  { label: M.ds.applications.length ? t('Application') : t('Project'), w: 3.4 },
  { label: t('Grade'), w: 0.8, align: 'center' },
  ...SEVS.map((s) => ({ label: SEV_LABEL()[s], w: 0.95, align: 'right' })),
  { label: t('Fixed C/H'), w: 1.1, align: 'right' },
];
function methodology(M) {
  const S = Store.s;
  const r = M.roi;
  return {
    eyebrow: t('Appendix'),
    title: t('Methodology & assumptions'),
    subtitle: t('All value figures are risk-adjusted estimates; adjust the assumptions in the ROI Model to match your organisation.'),
    blocks: [
      {
        type: 'bullets',
        x: X0,
        y: Y0,
        w: 8.4,
        h: 6.2,
        title: t('How the value is calculated'),
        items: [
          { tone: 'info', text: t('Remediated vulnerabilities: findings present in one scan of a project’s primary branch and absent from the next (Checkmarx One scan summaries, NEW vs RECURRENT status). Conservative lower bound.') },
          { tone: 'info', text: `${t('1 · Remediation cost avoided')}: Σ ${t('fixed')} × ${t('hours to fix')} × ${t('hourly cost')} × (${t('multiplier')} − 1) = ${fmt.cur(r.remediation)}` },
          { tone: 'info', text: `${t('2 · Incident risk avoided (cost of the leak that did not happen)')}: min(Σ P(${t('breach')}), ${t('cap')}) × ${t('breach cost')} = ${fmt.cur(r.risk)}` },
          { tone: 'info', text: `${t('3 · Return on investment')}: (${t('value')} − ${t('investment')}) ÷ ${t('investment')} = ${r.roi == null ? '—' : fmt.pct(r.roi)}` },
          { tone: 'info', text: t('Time to remediate and stories: critical/high results of the {n} riskiest projects, sampled across the period.', { n: M.deepProjects }) },
        ],
      },
      {
        type: 'table',
        x: 9.3,
        y: Y0,
        w: 6.1,
        h: 6.2,
        cols: [{ label: t('Assumption'), w: 3.9 }, { label: t('Value'), w: 2.2, align: 'right' }],
        rows: [
          [t('Developer cost per hour'), { text: fmt.curFull(S.devRate), align: 'right' }],
          [t('Hours to fix (C/H/M/L)'), { text: SEVS.map((k) => fmt.num(S.fixHours[k], 1)).join(' / '), align: 'right' }],
          [t('Late-fix cost multiplier'), { text: fmt.mult(S.lateMultiplier), align: 'right' }],
          [t('Average cost of a data breach'), { text: fmt.cur(S.breachCost), align: 'right' }],
          [t('Breach probability % (C/H/M/L)'), { text: SEVS.map((k) => fmt.num(S.pExploit[k], 3)).join(' / '), align: 'right' }],
          [t('Reputational share of breach cost'), { text: fmt.pct(S.repShare / 100), align: 'right' }],
          [t('Incident cap per year'), { text: S.maxIncidentsPerYear > 0 ? fmt.num(S.maxIncidentsPerYear, 1) : t('None'), align: 'right' }],
          [t('Annual investment'), { text: S.investment ? fmt.cur(S.investment) : t('Not set'), align: 'right' }],
          [t('SLA days (C/H/M/L)'), { text: SEVS.map((k) => S.sla[k]).join(' / '), align: 'right' }],
          [t('Analysis period'), { text: t('{n} months', { n: M.nMonths }), align: 'right' }],
        ],
      },
    ],
  };
}
const SLIDES = {
  ciso: (M) => [
    execSummary(M, 'ciso'),
    {
      eyebrow: t('CISO'),
      title: t('Exposure is trending down'),
      subtitle: t('Open critical & high findings and monthly remediation'),
      blocks: [
        { type: 'chart', x: X0, y: Y0, w: 8.9, h: 6.2, title: t('Open critical & high findings'), spec: Specs.openTrend(M) },
        { type: 'chart', x: 9.7, y: Y0, w: 5.7, h: 3.6, title: t('Remediated vs. newly detected'), spec: Specs.newVsFixed(M) },
        {
          type: 'segbar',
          x: 9.7,
          y: 5.7,
          w: 5.7,
          h: 2.35,
          title: t('Risk avoided breakdown'),
          fmt: 'cur',
          segments: [
            { label: t('Direct incident cost avoided'), value: M.roi.direct, color: 'cat:1' },
            { label: t('Reputational cost avoided'), value: M.roi.reputational, color: 'cat:3' },
            { label: t('Remediation cost avoided'), value: M.roi.remediation, color: 'cat:0' },
          ],
        },
      ],
    },
    {
      eyebrow: t('CISO'),
      title: t('How Checkmarx One reduced financial & reputational risk'),
      subtitle: t('Notable critical and high vulnerabilities detected and remediated'),
      blocks: [storyBlock(M, Y0, 3.35), { type: 'table', x: X0, y: 5.45, w: CW, h: 2.7, cols: [{ label: t('Severity'), w: 1.3 }, { label: t('Finding'), w: 5.2 }, { label: t('Project'), w: 3 }, { label: t('Detected'), w: 1.8 }, { label: t('Fixed in'), w: 1.5, align: 'right' }, { label: t('Exposure removed'), w: 2, align: 'right' }], rows: M.stories.slice(4, 9).map((f) => [{ text: SEV_LABEL()[f.s], sev: f.s }, f.title, f.project, fmt.date(f.detected), { text: fmt.days(f.ttr), align: 'right' }, { text: fmt.cur(f.exposure), align: 'right' }]) }],
    },
    {
      eyebrow: t('CISO'),
      title: t('Where the remaining risk sits'),
      subtitle: t('Top risk applications, security grades and compliance exposure'),
      blocks: [
        { type: 'table', x: X0, y: Y0, w: 9.1, h: 6.2, title: t('Top risk applications'), cols: riskCols(M), rows: tableRowsRisk(M, 12) },
        { type: 'segbar', x: 10.0, y: Y0, w: 5.4, h: 2.4, title: t('Security grade distribution'), segments: ['A', 'B', 'C', 'D', 'F'].map((g) => ({ label: `${t('Grade')} ${g}`, value: M.grades[g], color: `grade:${g}` })) },
        { type: 'chart', x: 10.0, y: 4.45, w: 5.4, h: 3.6, title: t('Compliance exposure'), spec: Specs.compliance(M) },
      ],
    },
  ],
  cio: (M) => [
    execSummary(M, 'cio'),
    {
      eyebrow: t('CIO'),
      title: t('Value compounds as teams remediate'),
      subtitle: t('Cumulative value against investment, and value by scanner'),
      blocks: [
        { type: 'chart', x: X0, y: Y0, w: 8.9, h: 6.2, title: t('Cumulative value vs. investment'), spec: Specs.cumValue(M) },
        { type: 'chart', x: 9.7, y: Y0, w: 5.7, h: 6.2, title: t('Value by scanner'), spec: Specs.valueByEngine(M) },
      ],
    },
    {
      eyebrow: t('CIO'),
      title: t('Adoption & efficiency'),
      subtitle: t('Automation depth across the portfolio'),
      blocks: [
        { type: 'chart', x: X0, y: Y0, w: 7.2, h: 3.1, title: t('Scan volume'), spec: Specs.scansPerMonth(M) },
        { type: 'chart', x: 8.2, y: Y0, w: 7.2, h: 3.1, title: t('Active scan initiators'), spec: Specs.contributors(M) },
        { type: 'table', x: X0, y: 5.15, w: CW, h: 3.0, cols: [{ label: t('Metric'), w: 5.2 }, { label: t('Value'), w: 2.6, align: 'right' }, { label: t('Basis'), w: 7.0 }], rows: efficiencyRows(M).map((x) => [x[0], { text: x[1], align: 'right', bold: true }, x[2]]) },
      ],
    },
  ],
  architect: (M) => [
    {
      eyebrow: t('Security Architect'),
      title: t('Coverage & program health'),
      subtitle: t('Scanner coverage, integrations, scan health and vulnerability landscape'),
      blocks: [
        {
          type: 'kpis',
          x: X0,
          y: Y0,
          w: CW,
          h: 1.35,
          items: [
            { label: t('Projects'), value: fmt.num(M.projectsTotal), sub: t('{a} applications', { a: fmt.num(M.ds.applications.length) }), tone: 'violet' },
            { label: t('Scanned last 30 days'), value: fmt.pct(M.projectsTotal ? M.scanned30 / M.projectsTotal : 0), sub: t('{n} stale (>90 days)', { n: fmt.num(M.staleList.length) }), tone: 'blue' },
            { label: t('Scan success rate'), value: fmt.pct(M.successRate, 1), sub: t('{n} failed scans', { n: fmt.num(M.failed) }), tone: 'magenta' },
            { label: t('Median scan time'), value: M.medianDuration == null ? '—' : `${fmt.num(M.medianDuration, 0)} min`, sub: t('{n} scans in period', { n: fmt.compact(M.scans.length) }), tone: 'orange' },
            { label: t('Lines of code'), value: fmt.compact(M.loc), sub: t('{n} open-source packages', { n: fmt.compact(M.pkg.total) }), tone: 'violet' },
          ],
        },
        { type: 'chart', x: X0, y: 3.5, w: 7.2, h: 4.6, title: t('Scanner coverage'), spec: Specs.engineCoverage(M) },
        { type: 'chart', x: 8.2, y: 3.5, w: 7.2, h: 4.6, title: t('Integration points'), spec: Specs.origins(M) },
      ],
    },
    {
      eyebrow: t('Security Architect'),
      title: t('Vulnerability landscape'),
      subtitle: t('Recurring weakness patterns are the best target for secure-coding training and guardrails'),
      blocks: [
        { type: 'chart', x: X0, y: Y0, w: 8.9, h: 6.2, title: t('Top vulnerability types'), spec: Specs.topQueries(M, 12) },
        { type: 'chart', x: 9.7, y: Y0, w: 5.7, h: 6.2, title: t('Languages'), spec: Specs.languages(M) },
      ],
    },
    {
      eyebrow: t('Security Architect'),
      title: t('Scan health & triage'),
      subtitle: t('Operational reliability of the program'),
      blocks: [
        { type: 'chart', x: X0, y: Y0, w: 8.9, h: 3.6, title: t('Scan health'), spec: Specs.scanHealth(M) },
        { type: 'segbar', x: X0, y: 5.75, w: 8.9, h: 2.3, title: t('Triage status'), segments: triageSegments(M) },
        { type: 'table', x: 9.7, y: Y0, w: 5.7, h: 6.2, title: t('Projects not scanned in 90+ days'), cols: [{ label: t('Project'), w: 3.7 }, { label: t('Last scan'), w: 2.0 }], rows: M.staleList.slice(0, 14).map((p) => [p.name, p.lastScan ? fmt.date(p.lastScan.c) : t('Never')]) },
      ],
    },
  ],
  lead: (M) => [
    {
      eyebrow: t('Team Lead'),
      title: t('Backlog & remediation performance'),
      subtitle: t('Critical & high, primary branches'),
      blocks: [
        {
          type: 'kpis',
          x: X0,
          y: Y0,
          w: CW,
          h: 1.35,
          items: [
            { label: t('Open critical & high'), value: fmt.num(M.tot.open.C + M.tot.open.H), sub: t('{c} critical', { c: fmt.num(M.tot.open.C) }), tone: 'magenta' },
            { label: t('Newly detected'), value: fmt.num(M.tot.new.C + M.tot.new.H), sub: t('Critical & high in period'), tone: 'orange' },
            { label: t('Remediated'), value: fmt.num(M.tot.fixed.C + M.tot.fixed.H), sub: t('Critical & high in period'), tone: 'violet' },
            { label: t('Past SLA'), value: fmt.num(M.openOverdue.length), sub: t('of {n} open critical/high analysed', { n: fmt.num(M.open.length) }), tone: 'magenta' },
            { label: t('MTTR critical'), value: fmt.days(M.mttr.C), sub: t('High: {d}', { d: fmt.days(M.mttr.H) }), tone: 'blue' },
          ],
        },
        { type: 'chart', x: X0, y: 3.5, w: 8.9, h: 4.6, title: t('Remediated vs. newly detected'), spec: Specs.newVsFixed(M) },
        { type: 'chart', x: 9.7, y: 3.5, w: 5.7, h: 4.6, title: t('Backlog aging'), spec: Specs.aging(M) },
      ],
    },
    {
      eyebrow: t('Team Lead'),
      title: t('Projects needing attention'),
      subtitle: t('Ranked by severity-weighted risk'),
      blocks: [
        {
          type: 'table',
          x: X0,
          y: Y0,
          w: CW,
          h: 6.2,
          cols: [{ label: t('Project'), w: 3.6 }, { label: t('Application'), w: 2.9 }, { label: t('Grade'), w: 0.8, align: 'center' }, ...SEVS.map((s) => ({ label: SEV_LABEL()[s], w: 0.9, align: 'right' })), { label: t('Fixed C/H'), w: 1.15, align: 'right' }, { label: t('New C/H'), w: 1.15, align: 'right' }, { label: t('Last scan'), w: 1.6 }],
          rows: M.ranked.slice(0, 15).map((p) => [p.name, p.appNames.join(', '), { text: p.grade, grade: p.grade }, ...SEVS.map((s) => ({ text: fmt.num(p.open[s]), align: 'right' })), { text: fmt.num(p.fixed.C + p.fixed.H), align: 'right' }, { text: fmt.num(p.new.C + p.new.H), align: 'right' }, p.lastScan ? fmt.date(p.lastScan.c) : '—']),
        },
      ],
    },
    {
      eyebrow: t('Team Lead'),
      title: t('Findings past their remediation SLA'),
      subtitle: t('Oldest critical & high findings first'),
      blocks: [findingsTableBlock(M, [...M.openOverdue].sort((a, b) => (b.age || 0) - (a.age || 0)).slice(0, 15))],
    },
  ],
  dev: (M) => [
    {
      eyebrow: t('Developer'),
      title: t('Fix next'),
      subtitle: t('Open critical & high findings, most severe and oldest first'),
      blocks: [findingsTableBlock(M, M.open.slice(0, 16))],
    },
    {
      eyebrow: t('Developer'),
      title: t('Patterns & quick wins'),
      subtitle: t('Learn the patterns that recur in your code'),
      blocks: [
        { type: 'chart', x: X0, y: Y0, w: 7.6, h: 6.2, title: t('Most common vulnerability types'), spec: Specs.topQueries(M, 10) },
        { type: 'table', x: 8.6, y: Y0, w: 6.8, h: 6.2, title: t('Quick wins'), cols: [{ label: t('Package'), w: 3.6 }, { label: t('Upgrade to'), w: 1.5 }, { label: t('Findings closed'), w: 1.7, align: 'right' }], rows: quickWinRows(M).map((r) => [truncate(r.pkg, 44), r.rec, { text: fmt.num(r.n), align: 'right' }]) },
      ],
    },
  ],
  roi: (M) => [
    execSummary(M, 'cio'),
    {
      eyebrow: t('ROI Model'),
      title: t('Value composition & sensitivity'),
      subtitle: t('How the total changes under conservative, balanced and aggressive assumptions'),
      blocks: [
        { type: 'chart', x: X0, y: Y0, w: 8.4, h: 6.2, title: t('Value composition'), spec: Specs.valueComposition(M) },
        { type: 'table', x: 9.3, y: Y0, w: 6.1, h: 3.2, title: t('Sensitivity'), cols: [{ label: t('Preset'), w: 1.9 }, { label: t('Total value'), w: 2.2, align: 'right' }, { label: t('ROI'), w: 2.0, align: 'right' }], rows: sensitivity(M).map((x) => [x.label, { text: fmt.cur(x.total), align: 'right', bold: true }, { text: x.roi == null ? '—' : fmt.pct(x.roi), align: 'right' }]) },
      ],
    },
  ],
};
function findingsTableBlock(M, list) {
  return {
    type: 'table',
    x: X0,
    y: Y0,
    w: CW,
    h: 6.2,
    cols: [{ label: t('Severity'), w: 1.1 }, { label: t('Finding'), w: 4.0 }, { label: t('Project'), w: 2.4 }, { label: t('Location'), w: 4.6 }, { label: t('Age'), w: 1.0, align: 'right' }, { label: t('SLA'), w: 1.7 }],
    rows: list.map((f) => [{ text: SEV_LABEL()[f.s], sev: f.s }, truncate(f.title, 52), f.project, { text: truncate(findingLocation(f), 64), mono: true }, { text: f.age == null ? '—' : fmt.num(f.age), align: 'right' }, f.daysLeft == null ? '' : f.overdue ? t('{d} overdue', { d: fmt.days(-f.daysLeft) }) : t('{d} left', { d: fmt.days(f.daysLeft) })]),
  };
}
function buildSlides(M, scope) {
  if (scope === 'all') {
    const strip = (arr) => arr.filter((s) => s.kind !== 'cover');
    return [cover(M, t('Executive pack')), ...SLIDES.ciso(M), ...strip(SLIDES.cio(M)).slice(1), ...SLIDES.architect(M), ...SLIDES.lead(M), ...SLIDES.dev(M), methodology(M)];
  }
  const p = personaById(scope);
  const list = (SLIDES[scope] || SLIDES.ciso)(M);
  const withMethod = ['ciso', 'cio', 'roi'].includes(scope);
  return [cover(M, t('{persona} briefing', { persona: p.label() })), ...list, ...(withMethod ? [methodology(M)] : [])];
}

/* ---------- Assets ------------------------------------------------------------------------- */
const pngCache = new Map();
async function svgToPng(uri, w, ht) {
  const key = `${w}x${ht}:${uri}`;
  if (pngCache.has(key)) return pngCache.get(key);
  const img = new Image();
  img.src = uri;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w;
  c.height = ht;
  c.getContext('2d').drawImage(img, 0, 0, w, ht);
  const out = c.toDataURL('image/png');
  pngCache.set(key, out);
  return out;
}

/* ---------- PowerPoint renderer ------------------------------------------------------------ */
/** Deck fonts. Founders Grotesk and Aptos have no Arabic glyphs, so Arabic decks use Arial
 *  (the brand's fallback face, with Latin and Arabic on Windows and macOS). */
const deckFonts = () => (isRtl() ? { head: 'Arial', body: 'Arial' } : { head: 'Founders Grotesk Medium', body: 'Aptos' });
/** Right-to-left decks: mirror every placement horizontally (x → slide width − x − w), right-align
 *  text and mark paragraphs RTL. Tables reverse their column order; charts keep LTR axes. */
function rtlSlide(slide) {
  const mx = (o) => (o && typeof o.x === 'number' ? { ...o, x: SLIDE_W - o.x - (Number(o.w) || 0) } : o);
  const flip = (a) => (a === 'center' ? 'center' : a === 'right' ? 'left' : 'right');
  // Alignment mirrors for every paragraph; the reading direction follows the content, so Latin-only
  // text such as "Backdoored upstream release (supply chain)" keeps its punctuation in place.
  const plain = (t) => (Array.isArray(t) ? t.map((r) => (r && typeof r === 'object' ? (r.text ?? '') : r)).join('') : String(t ?? ''));
  const textOpts = (o = {}, text = '') => {
    const ltr = isLtrText(plain(text));
    return { ...o, align: flip(o.align), rtlMode: !ltr, lang: ltr ? 'en-US' : 'ar-AE', charSpacing: 0, fontFace: o.fontFace || deckFonts().body };
  };
  return {
    addText: (text, o) => slide.addText(text, mx(textOpts(o, text))),
    addShape: (type, o) => slide.addShape(type, mx(o)),
    addImage: (o) => slide.addImage(mx(o)),
    addChart: (type, data, o) => slide.addChart(type, data, mx(o)),
    addTable: (rows, o) =>
      slide.addTable(
        rows.map((r) => [...r].reverse().map((c) => ({ ...c, options: textOpts(c.options, c.text) }))),
        { ...mx(o), colW: Array.isArray(o.colW) ? [...o.colW].reverse() : o.colW },
      ),
  };
}
/** Office number-format code for money that mirrors Intl's compact currency style for the
 *  active locale (e.g. "$2.5M" in en, "2,5 Mio. €" in de). Returns null when the locale's
 *  compact units are not powers of 1000 (e.g. ja 万), which Office's ",," scaling cannot express. */
function pptCurFmt() {
  try {
    const bucket = (v, frac, scale, digits) => {
      const parts = new Intl.NumberFormat(locale(), { style: 'currency', currency: Store.s.currency, currencyDisplay: curDisplay(), notation: 'compact', minimumFractionDigits: frac, maximumFractionDigits: frac }).formatToParts(v);
      const compact = parts.some((p) => p.type === 'compact');
      if (compact && Number(parts.filter((p) => p.type === 'integer').map((p) => p.value).join('')) !== digits) return null;
      const numTok = (compact ? '0' : '#,##0') + (frac ? `.${'0'.repeat(frac)}` : '') + (compact ? scale : '');
      const toks = [];
      let emitted = false;
      for (const p of parts) {
        if (['integer', 'group', 'decimal', 'fraction'].includes(p.type)) {
          if (!emitted) toks.push({ num: numTok });
          emitted = true;
        } else if (p.type !== 'minusSign' && p.type !== 'plusSign') {
          const last = toks[toks.length - 1];
          if (last && 'lit' in last) last.lit += p.value;
          else toks.push({ lit: p.value });
        }
      }
      return toks.map((x) => ('num' in x ? x.num : `"${x.lit.replace(/"/g, '')}"`)).join('');
    };
    const m = bucket(2_500_000, 1, ',,', 2);
    const k = bucket(25_000, 0, ',', 25);
    const u = bucket(500, 0, '', 500);
    return m && k && u ? `[>=1000000]${m};[>=1000]${k};${u}` : null;
  } catch {
    return null;
  }
}
function pptChartOpts(spec, b, cur) {
  const isH = spec.kind === 'hbar' || spec.kind === 'hstacked';
  const fmtCode = spec.fmt === 'pct' ? '0%' : spec.fmt === 'cur' ? pptCurFmt() || `[>=1000000]"${cur}"0.0,,"M";[>=1000]"${cur}"0,"K";"${cur}"0` : '#,##0';
  const stacked = spec.kind === 'stacked' || spec.kind === 'hstacked' || Boolean(spec.distributed);
  return {
    x: b.x,
    y: b.y + (b.title ? 0.4 : 0),
    w: b.w,
    h: b.h - (b.title ? 0.4 : 0),
    barDir: isH ? 'bar' : 'col',
    barGrouping: stacked ? 'stacked' : 'clustered',
    barGapWidthPct: 55,
    catAxisOrientation: isH ? 'maxMin' : 'minMax',
    catAxisLabelColor: BRAND.muted,
    catAxisLabelFontSize: 9,
    catAxisLabelFontFace: deckFonts().body,
    catAxisLineShow: !isH,
    catAxisLineColor: 'D6CFE1',
    valAxisLabelColor: BRAND.muted,
    valAxisLabelFontSize: 9,
    valAxisLabelFontFace: deckFonts().body,
    valAxisLabelFormatCode: fmtCode,
    valAxisLineShow: false,
    valGridLine: { color: BRAND.grid, size: 0.75 },
    catGridLine: { style: 'none' },
    showLegend: spec.series.length > 1 && !spec.distributed,
    legendPos: 't',
    legendFontSize: 10,
    legendFontFace: deckFonts().body,
    legendColor: BRAND.midnight,
    lineSize: 2,
    lineDataSymbol: 'circle',
    lineDataSymbolSize: 5,
    // OOXML only allows an "outside end" label position on clustered bars — on stacked bars or
    // lines PowerPoint rejects the whole file. Labels are therefore limited to clustered single series.
    ...(isH && !stacked && spec.series.length === 1
      ? { showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: fmtCode, dataLabelFontSize: 9, dataLabelFontFace: deckFonts().body, dataLabelColor: BRAND.muted }
      : { showValue: false }),
  };
}
function pptChartData(spec, P) {
  const conv = (v) => (spec.fmt === 'cur' ? num(v, 2) * fxRate() : num(v, 4));
  if (spec.distributed) {
    // PowerPoint colours by series: split per colour into stacked series with zeros elsewhere.
    const groups = [...new Set(spec.colors)];
    return {
      data: groups.map((g) => ({ name: g.startsWith('sev:') ? SEV_LABEL()[g.slice(4)] : spec.series[0].name, labels: spec.labels.map(String), values: spec.series[0].data.map((v, i) => (spec.colors[i] === g ? conv(v) : 0)) })),
      colors: groups.map((g, i) => hex(resolveColor(g, i, P))),
    };
  }
  return { data: spec.series.map((s) => ({ name: String(s.name), labels: spec.labels.map(String), values: s.data.map(conv) })), colors: spec.series.map((s, i) => hex(resolveColor(s.color, i, P))) };
}
function pptBlock(pptx, slide, b, P, cur) {
  const txt = (text, o) => slide.addText(String(text ?? ''), { margin: 0, valign: 'top', ...o });
  const blockTitle = (title) => title && txt(title, { x: b.x, y: b.y, w: b.w, h: 0.32, fontSize: 13, bold: true, color: BRAND.midnight });
  if (b.type === 'kpis') {
    const n = b.items.length;
    const gap = 0.22;
    const w = (b.w - gap * (n - 1)) / n;
    b.items.forEach((k, i) => {
      const x = b.x + i * (w + gap);
      slide.addShape(pptx.ShapeType.roundRect, { x, y: b.y, w, h: b.h, fill: { color: BRAND.white }, line: { color: BRAND.tint20, width: 1 }, rectRadius: 0.12 });
      slide.addShape(pptx.ShapeType.rect, { x: x + 0.2, y: b.y + 0.2, w: 0.32, h: 0.05, fill: { color: TONE[k.tone] || BRAND.violet }, line: { color: TONE[k.tone] || BRAND.violet, width: 0 } });
      txt(k.label.toUpperCase(), { x: x + 0.2, y: b.y + 0.32, w: w - 0.35, h: 0.28, fontSize: 9, bold: true, color: BRAND.muted, charSpacing: 1 });
      txt(k.value, { x: x + 0.2, y: b.y + 0.58, w: w - 0.35, h: 0.45, fontSize: 22, bold: true, color: BRAND.midnight, fit: 'shrink' });
      if (k.sub) txt(k.sub, { x: x + 0.2, y: b.y + 1.0, w: w - 0.35, h: 0.28, fontSize: 9, color: BRAND.muted, fit: 'shrink' });
    });
  } else if (b.type === 'hero') {
    slide.addShape(pptx.ShapeType.roundRect, { x: b.x, y: b.y, w: b.w, h: b.h, fill: { color: BRAND.violet }, line: { color: BRAND.violet, width: 0 }, rectRadius: 0.18 });
    txt(b.eyebrow.toUpperCase(), { x: b.x + 0.4, y: b.y + 0.3, w: 7, h: 0.3, fontSize: 10, bold: true, color: BRAND.tint20, charSpacing: 2 });
    txt(b.value, { x: b.x + 0.4, y: b.y + 0.6, w: 6.5, h: 0.85, fontSize: 44, bold: true, color: BRAND.white, fontFace: deckFonts().head });
    txt(b.text, { x: b.x + 0.4, y: b.y + 1.45, w: 6.5, h: 0.55, fontSize: 13, color: BRAND.cloud });
    const sw = (b.w - 7.4) / b.stats.length;
    b.stats.forEach((s, i) => {
      const x = b.x + 7.2 + i * sw;
      slide.addShape(pptx.ShapeType.line, { x, y: b.y + 0.55, w: 0, h: 1.1, line: { color: BRAND.tint60, width: 1 } });
      txt(s.label, { x: x + 0.2, y: b.y + 0.6, w: sw - 0.3, h: 0.45, fontSize: 10, color: BRAND.tint20 });
      txt(s.value, { x: x + 0.2, y: b.y + 1.05, w: sw - 0.3, h: 0.5, fontSize: 20, bold: true, color: BRAND.white, fit: 'shrink' });
    });
  } else if (b.type === 'chart') {
    blockTitle(b.title);
    if (specEmpty(b.spec)) {
      txt(t('No data for this period'), { x: b.x, y: b.y + 0.6, w: b.w, h: 0.4, fontSize: 11, color: BRAND.muted });
      return;
    }
    const type = b.spec.kind === 'line' ? pptx.ChartType.line : b.spec.kind === 'area' ? pptx.ChartType.area : pptx.ChartType.bar;
    const { data, colors } = pptChartData(b.spec, P);
    slide.addChart(type, data, { ...pptChartOpts(b.spec, b, cur), chartColors: colors, chartColorsOpacity: b.spec.kind === 'area' ? 35 : undefined });
  } else if (b.type === 'table') {
    blockTitle(b.title);
    const y = b.y + (b.title ? 0.42 : 0);
    const scale = b.w / sum(b.cols, (c) => c.w);
    const head = b.cols.map((c) => ({ text: c.label, options: { bold: true, fill: { color: 'F1ECFF' }, color: BRAND.midnight, align: c.align || 'left', fontSize: 9.5 } }));
    const SEVHEX = { C: '8E1A9E', H: 'DC2626', M: 'F59E0B', L: '006BD5' };
    const GRADEHEX = { A: '0CA30C', B: '7DBE4A', C: 'FAB219', D: 'EC835A', F: 'D03B3B' };
    const body = b.rows.map((r, ri) =>
      r.map((c, ci) => {
        const o = typeof c === 'object' && c ? c : { text: String(c ?? '') };
        const opt = { align: o.align || b.cols[ci].align || 'left', bold: Boolean(o.bold), color: BRAND.midnight, fontSize: 9.5, fill: { color: ri % 2 ? 'FBF9FE' : BRAND.white } };
        if (o.sev) Object.assign(opt, { color: o.sev === 'M' ? BRAND.midnight : BRAND.white, fill: { color: SEVHEX[o.sev] }, bold: true, align: 'center' });
        if (o.grade && GRADEHEX[o.grade]) Object.assign(opt, { color: ['B', 'C', 'D'].includes(o.grade) ? BRAND.midnight : BRAND.white, fill: { color: GRADEHEX[o.grade] }, bold: true, align: 'center' });
        if (o.mono) opt.fontFace = 'Consolas';
        return { text: String(o.text ?? ''), options: opt };
      }),
    );
    if (!body.length) {
      txt(t('No data for this period'), { x: b.x, y: y + 0.1, w: b.w, h: 0.4, fontSize: 11, color: BRAND.muted });
      return;
    }
    slide.addTable([head, ...body], { x: b.x, y, w: b.w, colW: b.cols.map((c) => c.w * scale), rowH: Math.min(0.36, (b.h - (b.title ? 0.42 : 0)) / (body.length + 1)), border: { type: 'solid', pt: 0.5, color: BRAND.grid }, margin: [0.03, 0.08, 0.03, 0.08], valign: 'middle', autoPage: false });
  } else if (b.type === 'bullets') {
    blockTitle(b.title);
    const y0 = b.y + (b.title ? 0.45 : 0);
    const rowH = Math.min(0.62, (b.h - (b.title ? 0.45 : 0)) / Math.max(1, b.items.length));
    const toneHex = { good: BRAND.violet, bad: BRAND.orange, warn: BRAND.orange, info: BRAND.blue };
    b.items.forEach((it, i) => {
      slide.addShape(pptx.ShapeType.ellipse, { x: b.x, y: y0 + i * rowH + 0.09, w: 0.13, h: 0.13, fill: { color: toneHex[it.tone] || BRAND.violet }, line: { color: toneHex[it.tone] || BRAND.violet, width: 0 } });
      txt(it.text, { x: b.x + 0.3, y: y0 + i * rowH, w: b.w - 0.3, h: rowH, fontSize: 12, color: BRAND.midnight, fit: 'shrink' });
    });
  } else if (b.type === 'segbar') {
    blockTitle(b.title);
    const segs = b.segments.filter((s) => s.value > 0);
    const total = sum(segs, (s) => s.value);
    const f = b.fmt === 'cur' ? (v) => fmt.cur(v) : (v) => fmt.num(v);
    if (!total) {
      txt(t('No data for this period'), { x: b.x, y: b.y + 0.5, w: b.w, h: 0.4, fontSize: 11, color: BRAND.muted });
      return;
    }
    let x = b.x;
    const y = b.y + 0.5;
    segs.forEach((s, i) => {
      const w = (s.value / total) * b.w;
      if (w > 0.04) slide.addShape(pptx.ShapeType.rect, { x, y, w: Math.max(0.01, w - 0.03), h: 0.26, fill: { color: hex(resolveColor(s.color, i, P)) }, line: { color: BRAND.white, width: 0 } });
      x += w;
    });
    segs.forEach((s, i) => {
      const ly = y + 0.45 + i * 0.3;
      slide.addShape(pptx.ShapeType.roundRect, { x: b.x, y: ly + 0.06, w: 0.14, h: 0.14, fill: { color: hex(resolveColor(s.color, i, P)) }, line: { color: BRAND.white, width: 0 }, rectRadius: 0.03 });
      txt(s.label, { x: b.x + 0.25, y: ly, w: b.w * 0.6, h: 0.28, fontSize: 10.5, color: BRAND.midnight });
      txt(`${f(s.value)}  ·  ${fmt.pct(s.value / total)}`, { x: b.x + b.w * 0.6, y: ly, w: b.w * 0.4, h: 0.28, fontSize: 10.5, color: BRAND.muted, align: 'right' });
    });
  } else if (b.type === 'stories') {
    const n = Math.max(1, b.items.length);
    if (!b.items.length) {
      txt(noStoriesText(), { x: b.x, y: b.y, w: b.w, h: 0.5, fontSize: 12, color: BRAND.muted });
      return;
    }
    const gap = 0.25;
    const w = (b.w - gap * (Math.min(n, 4) - 1)) / Math.min(n, 4);
    const SEVHEX = { C: '8E1A9E', H: 'DC2626' };
    b.items.slice(0, 4).forEach((f, i) => {
      const x = b.x + i * (w + gap);
      slide.addShape(pptx.ShapeType.roundRect, { x, y: b.y, w, h: b.h, fill: { color: BRAND.white }, line: { color: BRAND.tint20, width: 1 }, rectRadius: 0.12 });
      slide.addShape(pptx.ShapeType.roundRect, { x: x + 0.2, y: b.y + 0.22, w: 0.95, h: 0.3, fill: { color: SEVHEX[f.s] || BRAND.violet }, line: { color: SEVHEX[f.s] || BRAND.violet, width: 0 }, rectRadius: 0.08 });
      txt(SEV_LABEL()[f.s], { x: x + 0.2, y: b.y + 0.22, w: 0.95, h: 0.3, fontSize: 9, bold: true, color: BRAND.white, align: 'center', valign: 'middle' });
      txt(f.ttr != null ? t('Fixed in {d}', { d: fmt.days(f.ttr) }) : t('Fixed'), { x: x + 1.25, y: b.y + 0.24, w: w - 1.45, h: 0.28, fontSize: 9.5, bold: true, color: BRAND.violet, align: 'right' });
      txt(f.title, { x: x + 0.2, y: b.y + 0.65, w: w - 0.4, h: 0.62, fontSize: 13, bold: true, color: BRAND.midnight, fit: 'shrink' });
      txt([f.project, ENGINE_LABEL(f.t === 'sscs-secret-detection' ? 'secrets' : f.t), f.cwe ? `CWE-${f.cwe}` : '', f.cvss ? `CVSS ${fmt.num(f.cvss, 1)}` : ''].filter(Boolean).join(' · '), { x: x + 0.2, y: b.y + 1.3, w: w - 0.4, h: 0.3, fontSize: 9.5, color: BRAND.muted, fit: 'shrink' });
      const loc = f.pkg || f.img || (f.file ? `${f.file}${f.line ? ':' + f.line : ''}` : '');
      if (loc) txt(truncate(loc, 60), { x: x + 0.2, y: b.y + 1.62, w: w - 0.4, h: 0.45, fontSize: 8.5, color: BRAND.midnight, fontFace: 'Consolas', fit: 'shrink' });
      slide.addShape(pptx.ShapeType.line, { x: x + 0.2, y: b.y + b.h - 1.05, w: w - 0.4, h: 0, line: { color: BRAND.grid, width: 1 } });
      txt(t('Exposure removed'), { x: x + 0.2, y: b.y + b.h - 0.95, w: (w - 0.4) / 2, h: 0.25, fontSize: 8.5, color: BRAND.muted });
      txt(fmt.cur(f.exposure), { x: x + 0.2, y: b.y + b.h - 0.68, w: (w - 0.4) / 2, h: 0.45, fontSize: 18, bold: true, color: BRAND.violet });
      txt(t('Detected'), { x: x + w / 2, y: b.y + b.h - 0.95, w: w / 2 - 0.2, h: 0.25, fontSize: 8.5, color: BRAND.muted, align: 'right' });
      txt(fmt.date(f.detected), { x: x + w / 2, y: b.y + b.h - 0.66, w: w / 2 - 0.2, h: 0.35, fontSize: 11, color: BRAND.midnight, align: 'right' });
    });
  }
}
async function toPptx(slides, filename) {
  await loadAsset('pptxgen.bundle.js');
  const PptxGenJS = window.PptxGenJS;
  if (!PptxGenJS) throw new Error('PowerPoint library unavailable');
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'CX16x9', width: SLIDE_W, height: SLIDE_H });
  pptx.layout = 'CX16x9';
  pptx.theme = { headFontFace: deckFonts().head, bodyFontFace: deckFonts().body };
  pptx.rtlMode = isRtl();
  pptx.author = Store.s.report.preparedBy || 'Checkmarx One Value Dashboard';
  pptx.company = 'Checkmarx';
  pptx.title = t('Application Security Value Report');
  const P = LIGHT;
  const cur = curSymbol().replace(/"/g, '');
  const [logo, logoWhite, element] = await Promise.all([svgToPng(ASSETS.logoViolet, 1112, 144), svgToPng(ASSETS.logoWhite, 1112, 144), svgToPng(ASSETS.elementDark, 1600, 1270)]);
  const meta = slides[0]?.meta || {};
  const footer = [meta.confidential ? t('Confidential') : '', meta.org, `${t('Generated')} ${meta.date}`].filter(Boolean).join('  ·  ');
  const rtl = isRtl();
  const fontOpt = rtl ? { fontFace: deckFonts().body, rtlMode: true, lang: 'ar-AE' } : {};
  pptx.defineSlideMaster({
    title: 'CX_CONTENT',
    background: { color: BRAND.cloud },
    objects: [
      { image: { x: rtl ? SLIDE_W - X0 - 1.39 : X0, y: 8.42, w: 1.39, h: 0.18, data: logo } },
      { text: { text: footer, options: { x: 3.5, y: 8.36, w: 9, h: 0.3, fontSize: 8.5, color: BRAND.muted, align: 'center', ...fontOpt } } },
    ],
    slideNumber: { x: rtl ? SLIDE_W - 14.9 - 0.5 : 14.9, y: 8.36, w: 0.5, h: 0.3, fontSize: 9, color: BRAND.violet, align: rtl ? 'left' : 'right' },
  });
  const wrap = (raw) => (rtl ? rtlSlide(raw) : raw);
  for (const s of slides) {
    if (s.kind === 'cover') {
      const raw = pptx.addSlide();
      raw.background = { color: BRAND.midnight };
      const slide = wrap(raw);
      slide.addImage({ data: element, x: 6.9, y: 0.9, w: 9.1, h: 7.22 });
      slide.addImage({ data: logoWhite, x: 0.8, y: 0.75, w: 2.47, h: 0.32 });
      slide.addText(`CHECKMARX ONE  ·  ${t('Value report').toUpperCase()}`, { x: 0.8, y: 2.7, w: 8, h: 0.35, fontSize: 12, bold: true, color: BRAND.tint60, charSpacing: 3, margin: 0 });
      slide.addText(s.title, { x: 0.8, y: 3.1, w: 8.4, h: 1.7, fontSize: 40, color: BRAND.cloud, fontFace: deckFonts().head, margin: 0, valign: 'top' });
      slide.addText(s.subtitle, { x: 0.8, y: 4.85, w: 8, h: 0.5, fontSize: 20, color: BRAND.tint60, margin: 0 });
      const lines = [meta.org && `${t('Prepared for')}: ${meta.org}`, `${t('Period')}: ${meta.period}`, `${t('Scope')}: ${meta.scope}`, meta.tenant && `${t('Tenant')}: ${meta.tenant}`, meta.by && `${t('Prepared by')}: ${meta.by}`, `${t('Generated')}: ${meta.date}`].filter(Boolean);
      slide.addText(lines.join('\n'), { x: 0.8, y: 6.0, w: 8, h: 1.9, fontSize: 12, color: BRAND.tint20, margin: 0, valign: 'top', lineSpacingMultiple: 1.25 });
      if (meta.confidential) slide.addText(t('Confidential').toUpperCase(), { x: 0.8, y: 8.25, w: 4, h: 0.3, fontSize: 9, bold: true, color: BRAND.orange, charSpacing: 2, margin: 0 });
      continue;
    }
    const slide = wrap(pptx.addSlide({ masterName: 'CX_CONTENT' }));
    if (s.eyebrow) slide.addText(s.eyebrow.toUpperCase(), { x: X0, y: 0.42, w: CW, h: 0.3, fontSize: 10.5, bold: true, color: BRAND.violet, charSpacing: 2, margin: 0 });
    slide.addText(s.title, { x: X0, y: 0.72, w: CW, h: 0.62, fontSize: 28, color: BRAND.midnight, fontFace: deckFonts().head, margin: 0, valign: 'top' });
    if (s.subtitle) slide.addText(s.subtitle, { x: X0, y: 1.33, w: CW, h: 0.34, fontSize: 13, color: BRAND.muted, margin: 0 });
    for (const b of s.blocks) pptBlock(pptx, slide, b, P, cur);
  }
  await pptx.writeFile({ fileName: filename });
}

/* ---------- HTML slide renderer (PDF + print) -------------------------------------------- */
// html2canvas cannot reliably paint SVG <img> without intrinsic size, so the PDF path swaps the
// brand SVGs for PNG rasters; the print path keeps the vector originals.
let SLIDE_IMG = null;
const slideImg = (k) => (SLIDE_IMG || ASSETS)[k];
async function rasterBrand() {
  const [logoViolet, logoWhite, elementDark] = await Promise.all([svgToPng(ASSETS.logoViolet, 1112, 144), svgToPng(ASSETS.logoWhite, 1112, 144), svgToPng(ASSETS.elementDark, 1600, 1270)]);
  return { logoViolet, logoWhite, elementDark };
}
/** left/right → start/end, so HTML slides mirror under dir=rtl. */
const logicalAlign = (a) => (a === 'right' ? 'end' : a === 'center' ? 'center' : 'start');
function htmlBlock(b) {
  const P = LIGHT;
  const box = h('div', { class: `sb sb-${b.type}`, style: { 'inset-inline-start': `${b.x * PX}px`, top: `${b.y * PX}px`, width: `${b.w * PX}px`, height: `${b.h * PX}px` } });
  const title = b.title ? D('sb-title', b.title) : null;
  if (b.type === 'kpis') {
    box.append(...b.items.map((k) => D('sk', h('span', { class: 'sk-bar', style: { background: `#${TONE[k.tone] || BRAND.violet}` } }), D('sk-label', k.label), D('sk-value', k.value), k.sub ? D('sk-sub', k.sub) : null)));
  } else if (b.type === 'hero') {
    box.append(
      h('img.sh-el', { src: slideImg('elementDark'), alt: '' }),
      D('sh-main', D('sh-eyebrow', b.eyebrow), D('sh-value', b.value), D('sh-text', b.text)),
      D('sh-stats', b.stats.map((s) => D('sh-stat', D('sh-stat-label', s.label), D('sh-stat-value', s.value)))),
    );
  } else if (b.type === 'chart') {
    const ch = (b.h - (b.title ? 0.42 : 0)) * PX;
    box.append(title || '', svgElement(b.spec, b.w * PX, ch, P));
  } else if (b.type === 'table') {
    const total = sum(b.cols, (c) => c.w);
    const table = h(
      'table.st',
      h('colgroup', b.cols.map((c) => h('col', { style: { width: `${(c.w / total) * 100}%` } }))),
      h('thead', h('tr', b.cols.map((c) => h('th', { style: { 'text-align': logicalAlign(c.align) } }, c.label)))),
      h(
        'tbody',
        b.rows.map((r) =>
          h(
            'tr',
            r.map((c, ci) => {
              const o = typeof c === 'object' && c ? c : { text: String(c ?? '') };
              const kids = o.sev ? h('span', { class: `sev-chip sev-${o.sev}` }, o.text) : o.grade ? h('span', { class: `grade grade-${o.grade}` }, o.text) : o.mono ? h('code', o.text) : o.text;
              return h('td', { style: { 'text-align': logicalAlign(o.align || b.cols[ci].align), 'font-weight': o.bold ? '700' : '400' } }, kids);
            }),
          ),
        ),
      ),
    );
    box.append(title || '', b.rows.length ? table : D('sb-empty', t('No data for this period')));
  } else if (b.type === 'bullets') {
    box.append(title || '', D('sbul', b.items.map((it) => D(`sbul-item sbul-${it.tone}`, h('span.sbul-dot'), h('span', it.text)))));
  } else if (b.type === 'segbar') {
    box.append(title || '', segBar(b.segments, { height: 22, P, fmtV: b.fmt === 'cur' ? (v) => fmt.cur(v) : (v) => fmt.num(v) }));
  } else if (b.type === 'stories') {
    if (!b.items.length) box.append(D('sb-empty', noStoriesText()));
    box.append(
      ...b.items.slice(0, 4).map((f) => {
        const loc = f.pkg || f.img || (f.file ? `${f.file}${f.line ? ':' + f.line : ''}` : '');
        return D(
          'ss',
          D('ss-top', h('span', { class: `sev-chip sev-${f.s}` }, SEV_LABEL()[f.s]), D('ss-fixed', f.ttr != null ? t('Fixed in {d}', { d: fmt.days(f.ttr) }) : t('Fixed'))),
          D('ss-title', f.title),
          D('ss-meta', joinParts([f.project, ENGINE_LABEL(f.t === 'sscs-secret-detection' ? 'secrets' : f.t), f.cwe ? `CWE-${f.cwe}` : '', f.cvss ? `CVSS ${fmt.num(f.cvss, 1)}` : ''])),
          loc ? h('code.ss-loc', truncate(loc, 70)) : null,
          D('ss-foot', h('div', D('ss-label', t('Exposure removed')), D('ss-value', fmt.cur(f.exposure))), D('ss-right', D('ss-label', t('Detected')), D('ss-date', fmt.date(f.detected)))),
        );
      }),
    );
  }
  return box;
}
function htmlSlide(s, i, total) {
  if (s.kind === 'cover') {
    const m = s.meta;
    const lines = [m.org && [t('Prepared for'), m.org], [t('Period'), m.period], [t('Scope'), m.scope], m.tenant && [t('Tenant'), m.tenant], m.by && [t('Prepared by'), m.by], [t('Generated'), m.date]].filter(Boolean);
    return D(
      'slide slide-cover',
      h('img.sc-el', { src: slideImg('elementDark'), alt: '' }),
      h('img.sc-logo', { src: slideImg('logoWhite'), alt: 'Checkmarx' }),
      D('sc-eyebrow', `CHECKMARX ONE · ${t('Value report')}`),
      D('sc-title', s.title),
      D('sc-sub', s.subtitle),
      D('sc-meta', lines.map(([k, v]) => D('sc-line', h('span', `${k}: `), h('b', v)))),
      m.confidential ? D('sc-conf', t('Confidential')) : null,
    );
  }
  const meta = s.meta || {};
  return D(
    'slide',
    s.eyebrow ? D('s-eyebrow', s.eyebrow) : null,
    D('s-title', s.title),
    s.subtitle ? D('s-sub', s.subtitle) : null,
    s.blocks.map(htmlBlock),
    h('img.s-logo', { src: slideImg('logoViolet'), alt: 'Checkmarx' }),
    D('s-foot', meta.footer || ''),
    D('s-num', String(i + 1)),
  );
}
function buildHtmlSlides(slides) {
  const meta = slides[0]?.meta || {};
  const footer = [meta.confidential ? t('Confidential') : '', meta.org, `${t('Generated')} ${meta.date}`].filter(Boolean).join('  ·  ');
  return slides.map((s, i) => htmlSlide({ ...s, meta: s.kind === 'cover' ? s.meta : { footer } }, i, slides.length));
}
async function toPdf(slides, filename, onProgress) {
  await Promise.all([loadAsset('html2canvas.min.js'), loadAsset('jspdf.umd.min.js')]);
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF || !window.html2canvas) throw new Error('PDF libraries unavailable');
  const host = h('div.slide-host');
  document.body.appendChild(host);
  try {
    SLIDE_IMG = await rasterBrand();
    const nodes = buildHtmlSlides(slides);
    await document.fonts?.ready;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'in', format: [SLIDE_W, SLIDE_H], compress: true });
    pdf.setProperties({ title: t('Application Security Value Report'), author: Store.s.report.preparedBy || 'Checkmarx One Value Dashboard', creator: 'Checkmarx One Value Dashboard' });
    for (let i = 0; i < nodes.length; i++) {
      onProgress?.(i + 1, nodes.length);
      host.replaceChildren(nodes[i]);
      await Promise.all([...nodes[i].querySelectorAll('img')].map((img) => img.decode?.().catch(() => {})));
      const canvas = await window.html2canvas(nodes[i], { scale: 1.6, backgroundColor: '#FCF9FE', logging: false, useCORS: true, x: 0, y: 0, scrollX: 0, scrollY: 0, width: SLIDE_W * PX, height: SLIDE_H * PX, windowWidth: SLIDE_W * PX, windowHeight: SLIDE_H * PX });
      if (i) pdf.addPage([SLIDE_W, SLIDE_H], 'landscape');
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, SLIDE_W, SLIDE_H, undefined, 'FAST');
    }
    pdf.save(filename);
  } finally {
    SLIDE_IMG = null;
    host.remove();
  }
}
function printSlides(slides) {
  const frame = h('iframe.print-frame', { title: 'print', 'aria-hidden': 'true' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.documentElement.lang = Store.s.lang;
  doc.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
  const style = doc.createElement('style');
  style.textContent = `${document.getElementById('cx-fonts')?.textContent || ''}\n${document.getElementById('cx-style')?.textContent || ''}\n@page { size: ${SLIDE_W}in ${SLIDE_H}in; margin: 0; } html,body{margin:0;padding:0;background:#fff} .slide{position:relative!important;left:0!important;page-break-after:always;break-after:page}`;
  doc.head.appendChild(style);
  doc.title = t('Application Security Value Report');
  const host = doc.createElement('div');
  host.className = 'print-host';
  host.append(...buildHtmlSlides(slides).map((n) => doc.importNode(n, true)));
  doc.body.appendChild(host);
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60_000);
  }, 600);
}

const Exporter = {
  busy: false,
  async run(format, scope) {
    if (this.busy || !App.M) return;
    this.busy = true;
    const scopeName = scope === 'all' ? 'executive-pack' : scope;
    const name = `checkmarx-one-value-${slug(scopeName)}-${slug(Store.s.report.org || App.ds?.tenant?.name)}-${fileStamp()}`;
    const overlay = showBusy(t('Building your report…'));
    try {
      const slides = buildSlides(App.M, scope);
      if (format === 'print') printSlides(slides);
      else if (format === 'pptx') await toPptx(slides, `${name}.pptx`);
      else await toPdf(slides, `${name}.pdf`, (i, n) => overlay.update(t('Rendering slide {i} of {n}…', { i, n })));
      if (format !== 'print') toast(t('Report downloaded'), 'success');
    } catch (e) {
      console.error(e);
      toast(t('Export failed: {e}', { e: e.message }), 'error', 7000);
    } finally {
      overlay.close();
      this.busy = false;
    }
  },
};
function showBusy(msg) {
  const label = h('div.busy-label', msg);
  const el = D('busy-overlay', D('busy-card', D('spinner-border text-primary'), label));
  document.body.appendChild(el);
  return { update: (m) => (label.textContent = m), close: () => el.remove() };
}

/* ---------- CSV / JSON --------------------------------------------------------------------- */
function exportFindingsCsv(M) {
  const rows = filteredFindings(M);
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = ['Severity', 'Finding', 'Scanner', 'Project', 'Location', 'CWE', 'CVE', 'Recommended version', 'State', 'First found', 'Age (days)', 'SLA (days)', 'Overdue'];
  const lines = [head.map(cell).join(',')];
  for (const f of rows) lines.push([SEV_LABEL()[f.s], f.title, ENGINE_LABEL(f.t), f.project, findingLocation(f), f.cwe ? `CWE-${f.cwe}` : '', f.cve || '', f.rec || '', f.st, f.ff ? f.ff.slice(0, 10) : '', f.age ?? '', f.sla, f.overdue ? 'yes' : 'no'].map(cell).join(','));
  downloadBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `checkmarx-findings-${fileStamp()}.csv`);
}
function exportSnapshot(ds) {
  downloadBlob(new Blob([JSON.stringify({ ...ds, source: 'snapshot', exportedAt: new Date().toISOString() })], { type: 'application/json' }), `checkmarx-one-snapshot-${slug(ds.tenant?.name)}-${fileStamp()}.json`);
}
