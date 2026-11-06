/* ============================================================================================
 * metrics.js — turns the collected dataset into every KPI, series and ROI figure.
 *
 * Fixed / new derivation (per project, primary branch, per engine, consecutive scans i-1 → i):
 *   new_i[sev]   = results with status NEW in scan i                 (scan-summary)
 *   fixed_i[sev] = max(0, total_{i-1}[sev] − recurrent_i[sev])         (left the code base)
 * Recurrent counts are relative to any earlier scan of the project, so the estimate is a
 * conservative lower bound. Without status counters the net decrease between scans is used.
 * ========================================================================================== */
const WEIGHT = { C: 10, H: 5, M: 2, L: 0.5 };
const critFactor = (c) => [0.5, 0.5, 0.75, 1, 1.25, 1.5][clamp(Math.round(Number(c) || 3), 1, 5)];
const NE_STATES = new Set(['NOT_EXPLOITABLE', 'PROPOSED_NOT_EXPLOITABLE']);

function monthKeys(from, to) {
  const out = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (d <= to) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}
const addSev = (a, b, k = 1) => {
  for (const s of SEVS) a[s] += (Number(b?.[s]) || 0) * k;
  return a;
};
const sevTotal = (o) => sum(SEVS, (s) => o?.[s] || 0);
const riskWeight = (o) => sum(SEVS, (s) => (o?.[s] || 0) * WEIGHT[s]);

function gradeOf(o) {
  if (!o) return 'N/A';
  if (o.C >= 5) return 'F';
  if (o.C >= 1) return 'D';
  if (o.H >= 10) return 'C';
  if (o.H >= 1 || o.M >= 25) return 'B';
  return 'A';
}

/** Split a scan-summary engine entry into NEW and RECURRENT counts per severity. */
function splitStatus(e) {
  const nw = sevZero();
  const rc = sevZero();
  if (e.ss) {
    for (const s of SEVS) {
      const tot = e.sev[s] || 0;
      nw[s] = e.ss[s]?.NEW || 0;
      rc[s] = e.ss[s]?.RECURRENT ?? Math.max(0, tot - nw[s]);
    }
    return { nw, rc, ok: true };
  }
  if (e.st && (e.st.NEW != null || e.st.RECURRENT != null)) {
    const tot = sevTotal(e.sev) || 1;
    const fN = clamp((e.st.NEW || 0) / tot, 0, 1);
    for (const s of SEVS) {
      nw[s] = Math.round((e.sev[s] || 0) * fN);
      rc[s] = (e.sev[s] || 0) - nw[s];
    }
    return { nw, rc, ok: true };
  }
  return { nw, rc, ok: false };
}

function projectScope(ds, filter) {
  let ids = ds.projects.map((p) => p.id);
  if (filter?.app) {
    const app = ds.applications.find((a) => a.id === filter.app);
    const set = new Set([...(app?.projectIds || []), ...ds.projects.filter((p) => p.apps?.includes(filter.app)).map((p) => p.id)]);
    ids = ids.filter((id) => set.has(id));
  }
  if (filter?.group) ids = ids.filter((id) => ds.projects.find((p) => p.id === id)?.groups?.includes(filter.group));
  return new Set(ids);
}

function computeMetrics(ds, S, filter = {}) {
  const from = new Date(ds.period.from);
  const to = new Date(ds.period.to);
  const months = monthKeys(from, to);
  const mIndex = new Map(months.map((m, i) => [m, i]));
  const monthOf = (d) => mIndex.get(String(d).slice(0, 7)) ?? (new Date(d) < from ? 0 : months.length - 1);
  const monthEnds = months.map((m) => {
    const d = new Date(`${m}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return Math.min(d.getTime() - 1, to.getTime());
  });
  const years = Math.max(1 / 12, (to - from) / (365.25 * DAY));
  const nMonths = Math.max(1, Math.round(years * 12));
  const scope = projectScope(ds, filter);
  const projects = ds.projects.filter((p) => scope.has(p.id));
  const scanById = new Map(ds.scans.map((s) => [s.id, s]));
  const appById = new Map((ds.applications || []).map((a) => [a.id, a]));
  const SUM = ds.summaries || {};

  const mNew = months.map(sevZero);
  const mFixed = months.map(sevZero);
  const mOpen = months.map(sevZero);
  const engines = new Map(); // engine -> { open, fixed, new }
  const eng = (e) => engines.get(e) || engines.set(e, { open: sevZero(), fixed: sevZero(), new: sevZero(), projects: 0 }).get(e);
  const perProject = [];
  const tot = { open: sevZero(), fixed: sevZero(), new: sevZero(), start: sevZero(), nowChain: sevZero() };
  let methodFallback = 0;

  for (const p of projects) {
    const chain = (ds.chains?.[p.id] || []).map((id) => scanById.get(id)).filter((s) => s && SUM[s.id]);
    const latestId = ds.latest?.[p.id];
    const latestSum = latestId ? SUM[latestId] : null;
    const pr = {
      id: p.id,
      name: p.name,
      crit: p.crit || 3,
      apps: p.apps || [],
      appNames: (p.apps || []).map((a) => appById.get(a)?.name).filter(Boolean),
      groups: p.groups || [],
      open: sevZero(),
      openByEng: {},
      fixed: sevZero(),
      new: sevZero(),
      start: sevZero(),
      trend: months.map(() => 0),
      scans: chain.length,
      lastScan: latestId ? scanById.get(latestId) : null,
      branch: ds.primary?.[p.id] || '',
      engines: new Set(),
    };
    if (latestSum) {
      for (const [e, c] of Object.entries(latestSum.e || {})) {
        addSev(pr.open, c.sev);
        pr.openByEng[e] = { ...sevZero(), ...c.sev };
        addSev(eng(e).open, c.sev);
      }
    }
    const engNames = new Set();
    for (const s of chain) for (const e of Object.keys(SUM[s.id].e || {})) engNames.add(e);
    for (const e of engNames) {
      const seq = chain.filter((s) => SUM[s.id].e?.[e] && (!s.es || !s.es[e] || s.es[e] === 'Completed'));
      if (!seq.length) continue;
      eng(e).projects++;
      let prev = null;
      let ptr = 0;
      seq.forEach((s, i) => {
        const cur = SUM[s.id].e[e];
        const mi = monthOf(s.c);
        const { nw, rc, ok } = splitStatus(cur);
        const fixed = sevZero();
        const nn = sevZero();
        if (!ok) methodFallback++;
        for (const k of SEVS) {
          const c = cur.sev[k] || 0;
          if (prev) {
            const pv = prev.sev[k] || 0;
            fixed[k] = ok ? Math.max(0, pv - rc[k]) : Math.max(0, pv - c);
            nn[k] = ok ? nw[k] : Math.max(0, c - pv);
          } else nn[k] = ok ? nw[k] : 0;
        }
        if (i === 0) addSev(pr.start, cur.sev);
        addSev(pr.fixed, fixed);
        addSev(pr.new, nn);
        addSev(mFixed[mi], fixed);
        addSev(mNew[mi], nn);
        addSev(eng(e).fixed, fixed);
        addSev(eng(e).new, nn);
        prev = cur;
      });
      // monthly open (step function, carried forward)
      for (let m = 0; m < months.length; m++) {
        while (ptr < seq.length && new Date(seq[ptr].c).getTime() <= monthEnds[m]) ptr++;
        if (ptr === 0) continue;
        const c = SUM[seq[ptr - 1].id].e[e].sev;
        addSev(mOpen[m], c);
        pr.trend[m] += (c.C || 0) + (c.H || 0);
      }
      const lastC = SUM[seq[seq.length - 1].id].e[e].sev;
      addSev(tot.nowChain, lastC);
    }
    for (const s of chain) for (const e of s.e || []) pr.engines.add(e);
    if (pr.lastScan) for (const e of pr.lastScan.e || []) pr.engines.add(e);
    addSev(tot.open, pr.open);
    addSev(tot.fixed, pr.fixed);
    addSev(tot.new, pr.new);
    addSev(tot.start, pr.start);
    pr.grade = latestSum ? gradeOf(pr.open) : 'N/A';
    pr.risk = riskWeight(pr.open) * critFactor(pr.crit);
    pr.netCH = (pr.fixed.C + pr.fixed.H) - (pr.new.C + pr.new.H);
    perProject.push(pr);
  }

  /* ---------------- ROI ------------------------------------------------------------------ */
  const roi = computeRoi(perProject, tot.fixed, mFixed, S, years, nMonths, engines);

  /* ---------------- Deep findings (critical / high) ------------------------------------- */
  const pName = new Map(ds.projects.map((p) => [p.id, p.name]));
  const pCrit = new Map(ds.projects.map((p) => [p.id, p.crit || 3]));
  const deep = ds.deep || { open: [], fixed: [], projects: [] };
  const now = to.getTime();
  const open = (deep.open || [])
    .filter((f) => scope.has(f.p) && !NE_STATES.has(f.st))
    .map((f) => {
      const age = f.ff ? Math.max(0, Math.round((now - new Date(f.ff)) / DAY)) : null;
      const sla = S.sla[f.s] || 90;
      return { ...f, project: pName.get(f.p) || f.p, age, sla, daysLeft: age == null ? null : sla - age, overdue: age != null && age > sla };
    })
    .sort((a, b) => (a.s === b.s ? (b.age || 0) - (a.age || 0) : a.s === 'C' ? -1 : 1));
  const fixedF = (deep.fixed || [])
    .filter((f) => scope.has(f.p))
    .map((f) => {
      const sla = S.sla[f.s] || 90;
      const exposure = S.breachCost * ((S.pExploit[f.s] || 0) / 100) * (S.critWeighting ? critFactor(pCrit.get(f.p)) : 1);
      return { ...f, project: pName.get(f.p) || f.p, sla, withinSla: f.ttr != null && f.ttr <= sla, exposure };
    });
  const ttrBy = { C: [], H: [] };
  for (const f of fixedF) if (f.ttr != null && ttrBy[f.s]) ttrBy[f.s].push(f.ttr);
  const mttr = { C: median(ttrBy.C), H: median(ttrBy.H), all: median([...ttrBy.C, ...ttrBy.H]) };
  const mttrMean = { C: ttrBy.C.length ? sum(ttrBy.C) / ttrBy.C.length : null, H: ttrBy.H.length ? sum(ttrBy.H) / ttrBy.H.length : null };
  const slaFixedPct = fixedF.length ? fixedF.filter((f) => f.withinSla).length / fixedF.filter((f) => f.ttr != null).length : null;
  const openOverdue = open.filter((f) => f.overdue);
  const slaOpenPct = open.length ? 1 - openOverdue.length / open.length : null;
  const slaCompliance = fixedF.length + open.length ? (fixedF.filter((f) => f.withinSla).length + (open.length - openOverdue.length)) / (fixedF.filter((f) => f.ttr != null).length + open.length) : null;
  const AGE_BUCKETS = [
    [0, 30, '0–30'],
    [31, 90, '31–90'],
    [91, 180, '91–180'],
    [181, 365, '181–365'],
    [366, Infinity, '365+'],
  ];
  const aging = AGE_BUCKETS.map(([a, b, label]) => {
    const r = { label, C: 0, H: 0 };
    for (const f of open) if (f.age != null && f.age >= a && f.age <= b) r[f.s]++;
    return r;
  });
  // One story per vulnerability: the most relevant instance, with exposure summed across projects.
  const storyMap = new Map();
  for (const f of [...fixedF].sort((a, b) => (a.s === b.s ? (b.cvss || 0) - (a.cvss || 0) || (pCrit.get(b.p) || 3) - (pCrit.get(a.p) || 3) || (a.ttr ?? 999) - (b.ttr ?? 999) : a.s === 'C' ? -1 : 1))) {
    const g = storyMap.get(f.title);
    if (!g) storyMap.set(f.title, { ...f, others: new Set(), exposure: f.exposure || 0 });
    else {
      if (f.p !== g.p) g.others.add(f.p);
      g.exposure += f.exposure || 0;
    }
  }
  const stories = [...storyMap.values()].slice(0, 8).map((g) => ({ ...g, alsoIn: g.others.size, project: g.others.size ? t('{p} +{n} more', { p: g.project, n: g.others.size }) : g.project }));
  const quickWins = open.filter((f) => f.t === 'sca' && f.rec);

  /* ---------------- Scans, coverage, adoption ------------------------------------------- */
  const scans = ds.scans.filter((s) => scope.has(s.p) && new Date(s.c) >= from);
  const mScans = months.map(() => ({ total: 0, Completed: 0, Partial: 0, Failed: 0, Canceled: 0, other: 0, eng: {} }));
  const origins = {};
  const contributors = new Set();
  const mContrib = months.map(() => new Set());
  const durations = [];
  const engUse = {};
  for (const s of scans) {
    const mi = monthOf(s.c);
    const b = mScans[mi];
    b.total++;
    if (b[s.s] !== undefined) b[s.s]++;
    else b.other++;
    for (const e of s.e || []) b.eng[e] = (b.eng[e] || 0) + 1;
    const o = s.o || s.t || t('Unknown');
    origins[o] = (origins[o] || 0) + 1;
    if (s.i) {
      contributors.add(s.i);
      mContrib[mi].add(s.i);
    }
    if (s.s === 'Completed' && s.u) {
      const d = (new Date(s.u) - new Date(s.c)) / 60000;
      if (d > 0 && d < 24 * 60) durations.push(d);
    }
  }
  for (const pr of perProject) for (const e of pr.engines) engUse[e] = (engUse[e] || 0) + 1;
  const completed = sum(mScans, (b) => b.Completed);
  const failed = sum(mScans, (b) => b.Failed);
  const partial = sum(mScans, (b) => b.Partial);
  const lastScanAge = (pr) => (pr.lastScan ? (now - new Date(pr.lastScan.c)) / DAY : Infinity);
  const scanned30 = perProject.filter((pr) => lastScanAge(pr) <= 30).length;
  const scanned90 = perProject.filter((pr) => lastScanAge(pr) <= 90).length;
  const neverScanned = perProject.filter((pr) => !pr.lastScan).length;
  const staleList = perProject.filter((pr) => lastScanAge(pr) > 90).sort((a, b) => lastScanAge(b) - lastScanAge(a));
  const loc = sum(perProject, (pr) => pr.lastScan?.loc || 0);
  const createdByMonth = months.map(() => 0);
  let createdBefore = 0;
  for (const p of projects) {
    if (!p.created) continue;
    const d = new Date(p.created);
    if (d < from) createdBefore++;
    else createdByMonth[monthOf(p.created)]++;
  }
  let acc = createdBefore;
  const onboarded = createdByMonth.map((c) => (acc += c));

  /* ---------------- Latest-scan composition --------------------------------------------- */
  const queries = new Map();
  const langs = {};
  const comp = {};
  const plat = {};
  const states = {};
  const pkg = { total: 0, outdated: 0 };
  for (const pr of perProject) {
    const sm = SUM[ds.latest?.[pr.id]];
    if (!sm) continue;
    for (const [name, sev, c] of sm.q || []) {
      const k = `${name}|${sev}`;
      queries.set(k, (queries.get(k) || 0) + c);
    }
    for (const [k, v] of Object.entries(sm.lang || {})) langs[k] = (langs[k] || 0) + v;
    for (const [k, v] of Object.entries(sm.comp || {})) comp[k] = (comp[k] || 0) + v;
    for (const [k, v] of Object.entries(sm.plat || {})) plat[k] = (plat[k] || 0) + v;
    for (const e of Object.values(sm.e || {})) for (const [k, v] of Object.entries(e.state || {})) states[k] = (states[k] || 0) + v;
    if (sm.pkg) {
      pkg.total += sm.pkg.total || 0;
      pkg.outdated += sm.pkg.outdated || 0;
    }
  }
  const topQueries = [...queries.entries()]
    .map(([k, c]) => {
      const [name, sev] = k.split('|');
      return { name, sev, count: c };
    })
    .sort((a, b) => b.count - a.count);

  /* ---------------- Headline posture ----------------------------------------------------- */
  const startW = riskWeight(tot.start);
  const nowW = riskWeight(tot.nowChain);
  const riskReduction = startW > 0 ? (startW - nowW) / startW : null;
  const critReduction = tot.start.C + tot.start.H > 0 ? (tot.start.C + tot.start.H - (tot.nowChain.C + tot.nowChain.H)) / (tot.start.C + tot.start.H) : null;
  const grades = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const pr of perProject) if (grades[pr.grade] !== undefined) grades[pr.grade]++;
  const ranked = [...perProject].filter((p) => p.lastScan).sort((a, b) => b.risk - a.risk);
  const totalRisk = sum(ranked, (p) => p.risk);
  let cumRisk = 0;
  let concentration = 0;
  for (const p of ranked) {
    if (cumRisk >= totalRisk * 0.8) break;
    cumRisk += p.risk;
    concentration++;
  }

  return {
    ds,
    S,
    filter,
    months,
    years,
    nMonths,
    from,
    to,
    projects: perProject,
    projectsTotal: projects.length,
    projectsScanned: perProject.filter((p) => p.scans > 0).length,
    tot,
    mNew,
    mFixed,
    mOpen,
    engines,
    roi,
    open,
    fixed: fixedF,
    openOverdue,
    mttr,
    mttrMean,
    slaFixedPct,
    slaOpenPct,
    slaCompliance,
    aging,
    stories,
    quickWins,
    triaged: deep.triaged || 0,
    deepProjects: (deep.projects || []).filter((id) => scope.has(id)).length,
    scans,
    mScans,
    origins,
    contributors: contributors.size,
    mContrib: mContrib.map((s) => s.size),
    medianDuration: median(durations),
    successRate: completed + failed + partial ? completed / (completed + failed + partial) : null,
    completed,
    failed,
    partial,
    engUse,
    scanned30,
    scanned90,
    neverScanned,
    staleList,
    loc,
    onboarded,
    topQueries,
    langs,
    comp,
    plat,
    states,
    pkg,
    riskReduction,
    critReduction,
    grades,
    concentration,
    ranked,
    methodFallback,
  };
}

function computeRoi(perProject, fixed, mFixed, S, years, nMonths, engines) {
  const hrs = S.fixHours;
  const mult = Math.max(1, Number(S.lateMultiplier) || 1);
  const rate = Number(S.devRate) || 0;
  const fixHoursSpent = sum(SEVS, (k) => fixed[k] * (hrs[k] || 0));
  const hoursSaved = fixHoursSpent * (mult - 1);
  const remediation = hoursSaved * rate;
  const p = (k) => clamp((Number(S.pExploit[k]) || 0) / 100, 0, 1);
  let expIncidents = 0;
  const projIncidents = new Map();
  for (const pr of perProject) {
    let keep = 1;
    for (const k of SEVS) keep *= (1 - p(k)) ** (pr.fixed[k] || 0);
    const v = (1 - keep) * (S.critWeighting ? critFactor(pr.crit) : 1);
    projIncidents.set(pr.id, v);
    expIncidents += v;
  }
  const cap = Math.max(0, Number(S.maxIncidentsPerYear) || 0) * years;
  const incidents = cap > 0 ? Math.min(expIncidents, cap) : expIncidents;
  const capped = cap > 0 && expIncidents > cap;
  const risk = incidents * (Number(S.breachCost) || 0);
  const reputational = risk * clamp((Number(S.repShare) || 0) / 100, 0, 1);
  const direct = risk - reputational;
  const total = remediation + risk;
  const invest = (Number(S.investment) || 0) * years;
  const pw = (o) => sum(SEVS, (k) => (o[k] || 0) * p(k));
  const pwTotal = pw(fixed) || 1;
  const rh = (o) => sum(SEVS, (k) => (o[k] || 0) * (hrs[k] || 0)) * (mult - 1) * rate;
  const monthly = mFixed.map((m) => rh(m) + (risk * pw(m)) / pwTotal);
  let acc = 0;
  const cumulative = monthly.map((v) => (acc += v));
  const cumInvest = mFixed.map((_, i) => (invest * (i + 1)) / mFixed.length);
  const byEngine = [...engines.entries()].map(([e, v]) => ({ engine: e, value: rh(v.fixed) + (risk * pw(v.fixed)) / pwTotal, fixed: sevTotal(v.fixed) })).sort((a, b) => b.value - a.value);
  return {
    fixHoursSpent,
    hoursSaved,
    fte: hoursSaved / (1760 * years),
    remediation,
    expIncidents,
    incidents,
    capped,
    risk,
    reputational,
    direct,
    total,
    invest,
    roi: invest > 0 ? (total - invest) / invest : null,
    multiple: invest > 0 ? total / invest : null,
    payback: invest > 0 && total > 0 ? invest / (total / nMonths) : null,
    monthly,
    cumulative,
    cumInvest,
    byEngine,
    projIncidents,
  };
}

/* ---------------- Narrative insights per persona ----------------------------------------- */
function insights(M, persona) {
  const out = [];
  const L = SEV_LABEL();
  const firstMonth = M.months.length ? fmt.monthLong(M.months[0]) : '';
  const fixedCH = M.tot.fixed.C + M.tot.fixed.H;
  const r = M.roi;
  const push = (tone, ic, text) => out.push({ tone, icon: ic, text });
  if (persona === 'ciso' || persona === 'cio') {
    if (r.total > 0) push('good', 'shield-check', t('Checkmarx One delivered an estimated {v} in risk-adjusted value over {m} months.', { v: fmt.cur(r.total), m: M.nMonths }));
    if (r.multiple != null) push(r.multiple >= 1 ? 'good' : 'warn', 'coin', t('Return on investment of {x} — every {c1} invested returned {c2}.', { x: fmt.mult(r.multiple), c1: fmt.cur(1 / fxRate(), false), c2: fmt.cur(r.multiple / fxRate(), false) }));
  }
  if (persona === 'ciso') {
    if (M.critReduction != null) push(M.critReduction >= 0 ? 'good' : 'bad', M.critReduction >= 0 ? 'trending-down' : 'trending-up', M.critReduction >= 0 ? t('Open critical & high exposure is down {p} since {d}.', { p: fmt.pct(M.critReduction), d: firstMonth }) : t('Open critical & high exposure is up {p} since {d}.', { p: fmt.pct(-M.critReduction), d: firstMonth }));
    if (fixedCH) push('good', 'target', t('{n} critical and high vulnerabilities were remediated before they could be exploited.', { n: fmt.num(fixedCH) }));
    if (M.concentration && M.ranked.length > 3) push('info', 'flame', t('{n} of {total} projects hold 80% of the remaining risk — focus here for the fastest reduction.', { n: M.concentration, total: M.ranked.length }));
    if (M.mttr.C != null) push(M.mttr.C <= M.S.sla.C ? 'good' : 'warn', 'clock', t('Median time to remediate critical findings: {d} (SLA {s}).', { d: fmt.days(M.mttr.C), s: fmt.days(M.S.sla.C) }));
  }
  if (persona === 'cio') {
    if (r.hoursSaved > 0) push('good', 'clock', t('{h} developer hours saved by fixing early — about {f} full-time engineers per year.', { h: fmt.compact(Math.round(r.hoursSaved)), f: fmt.num(r.fte, 1) }));
    if (r.payback != null) push('info', 'calculator', t('Estimated payback period: {m} months.', { m: fmt.num(r.payback, 1) }));
    if (M.projectsTotal) push('info', 'sitemap', t('{p} of projects were scanned in the last 30 days.', { p: fmt.pct(M.scanned30 / M.projectsTotal) }));
    if (M.contributors) push('info', 'users', t('{n} people and pipelines initiated scans in this period.', { n: fmt.num(M.contributors) }));
  }
  if (persona === 'architect') {
    const stale = M.staleList.length;
    if (stale) push('warn', 'alert', t('{n} projects have not been scanned in the last 90 days.', { n: fmt.num(stale) }));
    const scanned = M.projectsScanned || 1;
    const scaPct = (M.engUse.sca || 0) / scanned;
    if (scaPct < 0.9) push('warn', 'package', t('Only {p} of scanned projects use SCA — open-source risk may be under-reported.', { p: fmt.pct(scaPct) }));
    const kicsPct = (M.engUse.kics || 0) / scanned;
    if (kicsPct < 0.5) push('info', 'sitemap', t('IaC scanning covers {p} of scanned projects.', { p: fmt.pct(kicsPct) }));
    if (M.successRate != null) push(M.successRate > 0.95 ? 'good' : 'warn', 'check', t('Scan success rate: {p}.', { p: fmt.pct(M.successRate, 1) }));
    const topLang = Object.entries(M.langs).sort((a, b) => b[1] - a[1])[0];
    if (topLang) push('info', 'code', t('{l} carries the most SAST findings.', { l: topLang[0] }));
  }
  if (persona === 'lead') {
    const net = M.tot.fixed.C + M.tot.fixed.H - (M.tot.new.C + M.tot.new.H);
    push(net >= 0 ? 'good' : 'bad', net >= 0 ? 'trending-down' : 'trending-up', net >= 0 ? t('Teams fixed {n} more critical/high findings than were introduced.', { n: fmt.num(net) }) : t('{n} more critical/high findings were introduced than fixed.', { n: fmt.num(-net) }));
    if (M.openOverdue.length) push('bad', 'clock', t('{n} critical/high findings are past their remediation SLA.', { n: fmt.num(M.openOverdue.length) }));
    const worst = [...M.projects].sort((a, b) => b.open.C - a.open.C)[0];
    if (worst?.open.C) push('warn', 'flame', t('{p} has the most open critical findings ({n}).', { p: worst.name, n: worst.open.C }));
    if (M.mttr.H != null) push('info', 'clock', t('Median time to fix high findings: {d}.', { d: fmt.days(M.mttr.H) }));
  }
  if (persona === 'dev') {
    if (M.quickWins.length) push('good', 'bolt', t('{n} quick wins: vulnerable packages with a known fixed version.', { n: fmt.num(M.quickWins.length) }));
    const oldest = [...M.open].sort((a, b) => (b.age || 0) - (a.age || 0))[0];
    if (oldest?.age) push('warn', 'clock', t('Oldest open {s} finding: {title} ({d}).', { s: L[oldest.s].toLowerCase(), title: oldest.title, d: fmt.days(oldest.age) }));
    const q = M.topQueries[0];
    if (q) push('info', 'bug', t('Most common vulnerability type: {q}.', { q: q.name }));
    if (M.fixed.length) push('good', 'trophy', t('Your teams closed {n} critical/high findings in this period — great work.', { n: fmt.num(M.fixed.length) }));
  }
  return out;
}
