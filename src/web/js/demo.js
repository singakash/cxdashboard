/* ============================================================================================
 * demo.js — deterministic synthetic tenant with the exact shape produced by the collector,
 * so every view, export and calculation can be explored without an API key.
 * ========================================================================================== */
function makeDemoDataset(months = 12) {
  let seed = 20261105;
  const rnd = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const poisson = (l) => {
    let L = Math.exp(-l),
      k = 0,
      p = 1;
    do {
      k++;
      p *= rnd();
    } while (p > L);
    return k - 1;
  };
  const binom = (n, p) => {
    if (n > 60) return Math.max(0, Math.round(n * p + (rnd() - 0.5) * Math.sqrt(n * p * (1 - p)) * 2));
    let k = 0;
    for (let i = 0; i < n; i++) if (rnd() < p) k++;
    return k;
  };
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => ((c === 'x' ? rnd() * 16 : (rnd() * 4) | 8) | 0).toString(16));
  // `months` can come from the URL (?demo&months=N) or a form field; bound it so the generation loops
  // (which scale with the period length) cannot be driven to unbounded CPU/memory use.
  months = Math.min(Math.max(Math.trunc(Number(months)) || 12, 1), 60);
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - months);
  const span = to - from;

  const APPS = [
    ['Payments Platform', 5, ['payments-api', 'payments-gateway', 'card-vault', 'fraud-scoring']],
    ['Customer Portal', 4, ['portal-web', 'portal-bff', 'notifications-service']],
    ['Mobile Banking', 5, ['mobile-api', 'mobile-android-backend', 'mobile-ios-backend']],
    ['Identity & Access', 5, ['auth-service', 'sso-gateway', 'user-directory']],
    ['Trading Engine', 4, ['order-matching', 'market-data-feed', 'risk-limits']],
    ['Data Platform', 3, ['etl-pipelines', 'data-lake-infra', 'reporting-api', 'ml-feature-store']],
    ['Partner APIs', 4, ['partner-gateway', 'open-banking-api', 'webhooks-dispatcher']],
    ['Claims Processing', 3, ['claims-intake', 'claims-workflow', 'document-ocr']],
    ['Internal Tools', 2, ['hr-portal', 'expense-tracker', 'wiki-sync', 'build-tools']],
    ['Marketing Web', 2, ['corporate-website', 'campaign-landing', 'cms-headless']],
    ['Cloud Infrastructure', 4, ['terraform-core', 'k8s-platform', 'network-baseline']],
  ];
  const LANGS = [
    ['Java', 'Kotlin'],
    ['TypeScript', 'JavaScript'],
    ['Python'],
    ['Go'],
    ['CSharp'],
    ['Java'],
    ['JavaScript'],
  ];
  const ORIGINS = ['GitHub Actions', 'GitHub Actions', 'Jenkins', 'Jenkins', 'GitLab CI', 'Azure DevOps', 'CLI', 'VS Code', 'Web Portal', 'GitHub (PR decoration)'];
  const devs = Array.from({ length: 84 }, (_, i) => `dev${i}`.padEnd(12, 'x'));

  const SAST_Q = {
    C: [
      ['SQL Injection', '89'],
      ['Command Injection', '78'],
      ['Deserialization of Untrusted Data', '502'],
      ['JWT Signature Not Verified', '347'],
    ],
    H: [
      ['Stored XSS', '79'],
      ['Reflected XSS', '79'],
      ['Path Traversal', '22'],
      ['Server Side Request Forgery', '918'],
      ['XML External Entity', '611'],
      ['Hardcoded Password', '798'],
      ['Second Order SQL Injection', '89'],
      ['LDAP Injection', '90'],
      ['Prototype Pollution', '1321'],
    ],
    M: [
      ['Open Redirect', '601'],
      ['Missing HSTS Header', '319'],
      ['Use of Weak Hashing Algorithm', '328'],
      ['CSRF', '352'],
      ['Privacy Violation', '359'],
      ['Information Exposure Through an Error Message', '209'],
    ],
    L: [
      ['Log Forging', '117'],
      ['Insecure Cookie', '614'],
      ['Unchecked Return Value', '252'],
    ],
  };
  const SCA_V = {
    C: [
      ['CVE-2021-44228', 'Maven-org.apache.logging.log4j:log4j-core-2.14.1', '2.17.1', 10, 'Log4Shell — remote code execution'],
      ['CVE-2022-22965', 'Maven-org.springframework:spring-beans-5.3.17', '5.3.18', 9.8, 'Spring4Shell — remote code execution'],
      ['CVE-2022-42889', 'Maven-org.apache.commons:commons-text-1.9', '1.10.0', 9.8, 'Text4Shell — remote code execution'],
      ['CVE-2021-44906', 'Npm-minimist-1.2.5', '1.2.6', 9.8, 'Prototype pollution'],
      ['CVE-2024-3094', 'Generic-xz-utils-5.6.0', '5.6.2', 10, 'Backdoored upstream release (supply chain)'],
      ['Malicious package', 'Npm-event-stream-3.3.6', '3.3.4', 9.9, 'Malicious package — credential stealing payload'],
      ['CVE-2020-14343', 'Python-PyYAML-5.3', '5.4', 9.8, 'Arbitrary code execution'],
    ],
    H: [
      ['CVE-2020-36518', 'Maven-com.fasterxml.jackson.core:jackson-databind-2.9.10', '2.12.6.1', 7.5, 'Denial of service'],
      ['CVE-2020-8203', 'Npm-lodash-4.17.15', '4.17.21', 7.4, 'Prototype pollution'],
      ['CVE-2021-3749', 'Npm-axios-0.21.1', '0.21.2', 7.5, 'ReDoS'],
      ['CVE-2022-1471', 'Maven-org.yaml:snakeyaml-1.30', '2.0', 8.3, 'Unsafe deserialization'],
      ['CVE-2022-23529', 'Npm-jsonwebtoken-8.5.1', '9.0.0', 7.6, 'Signature validation bypass'],
      ['CVE-2023-44487', 'Maven-io.netty:netty-codec-http2-4.1.94', '4.1.100', 7.5, 'HTTP/2 Rapid Reset'],
      ['CVE-2022-3602', 'Generic-openssl-3.0.6', '3.0.7', 7.5, 'Buffer overflow'],
    ],
    M: [['CVE-2024-29041', 'Npm-express-4.17.1', '4.19.2', 6.1, 'Open redirect']],
    L: [['CVE-2023-26136', 'Npm-tough-cookie-4.0.0', '4.1.3', 3.7, 'Prototype pollution']],
  };
  const KICS_Q = {
    C: [['S3 Bucket Allows Public Read', 'Terraform']],
    H: [
      ['Security Group Open to the Internet (SSH)', 'Terraform'],
      ['Container Running in Privileged Mode', 'Kubernetes'],
      ['Hardcoded AWS Access Key', 'Terraform'],
      ['Storage Account Without Encryption', 'Terraform'],
    ],
    M: [
      ['Container Running As Root', 'Dockerfile'],
      ['Missing Resource Limits', 'Kubernetes'],
      ['Healthcheck Not Set', 'Dockerfile'],
    ],
    L: [['Image Version Not Pinned', 'Dockerfile']],
  };
  const SECRET_Q = {
    C: [['Stripe Live API Key']],
    H: [['AWS Access Key ID'], ['GitHub Personal Access Token'], ['Private RSA Key']],
    M: [['Slack Webhook URL']],
    L: [['Generic API Key']],
  };
  const FILES = { Java: 'src/main/java/com/acme/', Kotlin: 'src/main/kotlin/com/acme/', TypeScript: 'src/app/', JavaScript: 'src/', Python: 'app/', Go: 'internal/', CSharp: 'src/Acme.' };
  const COMPLIANCE = ['OWASP Top 10 2021', 'PCI DSS v4.0', 'OWASP ASVS', 'NIST SP 800-53', 'CWE Top 25', 'ISO/IEC 27001', 'HIPAA', 'SOC 2'];
  const PLATFORMS = ['Terraform', 'Kubernetes', 'Dockerfile', 'CloudFormation', 'Helm'];

  const applications = [];
  const projects = [];
  const scans = [];
  const summaries = {};
  const chains = {};
  const latest = {};
  const primary = {};
  const fixedEvents = {}; // pid -> [{engine, sev, at, detected}]
  const openPools = {}; // pid -> {engine: {sev: count}}

  for (const [appName, appCrit, names] of APPS) {
    const app = { id: uuid(), name: appName, crit: appCrit, projectIds: [], tags: {} };
    applications.push(app);
    for (const name of names) {
      const pid = uuid();
      app.projectIds.push(pid);
      const crit = clamp(appCrit + int(-1, 0), 1, 5);
      const iac = /infra|terraform|k8s|network|platform/.test(name);
      const langs = iac ? [] : pick(LANGS);
      const onboardedLate = rnd() < 0.22;
      const created = onboardedLate ? new Date(from.getTime() + rnd() * span * 0.7) : new Date(from.getTime() - rnd() * 400 * DAY);
      const branch = rnd() < 0.8 ? 'main' : pick(['master', 'develop']);
      const engines = iac ? ['kics'] : ['sast', ...(rnd() < 0.92 ? ['sca'] : []), ...(rnd() < 0.5 ? ['kics'] : []), ...(rnd() < 0.3 ? ['containers'] : []), ...(rnd() < 0.18 ? ['apisec'] : []), ...(rnd() < 0.4 ? ['secrets'] : [])];
      const stale = rnd() < 0.07;
      projects.push({ id: pid, name, groups: [appName.split(' ')[0]], tags: {}, crit, apps: [app.id], created: created.toISOString(), mainBranch: branch, origin: 'GitHub', _langs: langs, _engines: engines, _stale: stale, _size: int(2, 10) });
    }
  }

  const engineSize = { sast: 1, sca: 1.2, kics: 0.6, containers: 0.8, apisec: 0.3, secrets: 0.15 };
  for (const p of projects) {
    const start = Math.max(from.getTime(), new Date(p.created).getTime());
    const end = p._stale ? start + rnd() * (to - start) * 0.4 : to.getTime() - rnd() * 3 * DAY;
    const cadence = int(2, 9) * DAY;
    const pools = {};
    for (const e of p._engines) {
      const k = 0.55 * p._size * engineSize[e] * (0.6 + p.crit * 0.18);
      pools[e] = { C: Math.round(k * (0.3 + rnd() * 0.8)), H: Math.round(k * (1.6 + rnd() * 2.4)), M: Math.round(k * (3 + rnd() * 4)), L: Math.round(k * (2 + rnd() * 3)) };
    }
    const chain = [];
    fixedEvents[p.id] = [];
    let first = true;
    for (let tm = start + rnd() * cadence; tm < end; tm += cadence * (0.5 + rnd())) {
      const progress = (tm - from) / span; // program maturity: fix rate grows, intake shrinks
      const status = rnd() < 0.03 ? 'Failed' : rnd() < 0.03 ? 'Partial' : 'Completed';
      const id = uuid();
      const created = new Date(tm);
      const dur = (4 + rnd() * 18 + p._size * 1.5) * 60000;
      const es = {};
      for (const e of p._engines) es[e] = status === 'Failed' ? 'Failed' : status === 'Partial' && e === p._engines[p._engines.length - 1] ? 'Failed' : 'Completed';
      const scan = { id, p: p.id, b: p.mainBranch, c: created.toISOString(), u: new Date(tm + dur).toISOString(), s: status, e: [...p._engines], es, o: pick(ORIGINS), t: 'git', i: pick(devs), loc: p._langs.length ? p._size * int(9000, 14000) : undefined };
      scans.push(scan);
      // feature-branch scans (volume only)
      const extra = poisson(1.4);
      for (let k = 0; k < extra; k++) {
        const ft = tm + rnd() * cadence;
        if (ft > to) continue;
        scans.push({ id: uuid(), p: p.id, b: `feature/${pick(['login', 'checkout', 'api-v2', 'search', 'reports', 'upgrade-deps', 'perf'])}-${int(10, 999)}`, c: new Date(ft).toISOString(), u: new Date(ft + dur * 0.8).toISOString(), s: rnd() < 0.04 ? 'Failed' : 'Completed', e: [...p._engines], es: {}, o: pick(ORIGINS), t: 'git', i: pick(devs) });
      }
      if (status === 'Failed') continue;
      const e = {};
      for (const eng of p._engines) {
        if (es[eng] !== 'Completed') continue;
        const pool = pools[eng];
        const ss = {};
        const sev = {};
        for (const s of SEVS) {
          const fixP = first ? 0 : { C: 0.12, H: 0.05, M: 0.02, L: 0.01 }[s] * (0.6 + progress * 1.1);
          const fixedN = binom(pool[s], clamp(fixP, 0, 0.9));
          const lam = 0.55 * { C: 0.035, H: 0.13, M: 0.13, L: 0.07 }[s] * engineSize[eng] * (p._size / 4) * (1.25 - progress * 0.6);
          // A project that existed before the window starts with a backlog (recurrent); a newly onboarded one detects everything as new.
          const preExisting = new Date(p.created) < from;
          const newN = first ? (preExisting ? 0 : pool[s]) : poisson(lam);
          const recurrent = first ? (preExisting ? pool[s] : 0) : pool[s] - fixedN;
          pool[s] = recurrent + newN;
          sev[s] = pool[s];
          ss[s] = { NEW: newN, RECURRENT: recurrent };
          if ((s === 'C' || s === 'H') && fixedN) for (let q = 0; q < fixedN; q++) fixedEvents[p.id].push({ engine: eng, sev: s, at: created.toISOString() });
        }
        const total = sevTotal(sev);
        const ne = Math.round(total * (0.06 + rnd() * 0.08));
        const conf = Math.round(total * (0.1 + progress * 0.25));
        const urgent = Math.round((sev.C || 0) * 0.4);
        e[eng] = {
          sev,
          ss,
          st: { NEW: sum(SEVS, (s) => ss[s].NEW), RECURRENT: sum(SEVS, (s) => ss[s].RECURRENT) },
          state: { TO_VERIFY: Math.max(0, total - ne - conf - urgent), CONFIRMED: conf, URGENT: urgent, NOT_EXPLOITABLE: ne },
          total,
        };
      }
      summaries[id] = { e, d: 0 };
      chain.push(scan);
      first = false;
    }
    if (!chain.length) continue;
    chains[p.id] = chain.map((s) => s.id);
    latest[p.id] = chain[chain.length - 1].id;
    primary[p.id] = p.mainBranch;
    openPools[p.id] = pools;
    const sm = summaries[latest[p.id]];
    sm.d = 1;
    if (sm.e.sast) {
      const q = [];
      for (const s of ['C', 'H', 'M', 'L']) {
        let left = sm.e.sast.sev[s];
        const qs = SAST_Q[s];
        qs.forEach(([name], i) => {
          const c = i === qs.length - 1 ? left : Math.round(left * (0.25 + rnd() * 0.4));
          left -= c;
          if (c > 0) q.push([name, s, c]);
        });
      }
      sm.q = q;
      const tot = sm.e.sast.total;
      sm.lang = {};
      p._langs.forEach((l, i) => (sm.lang[l] = Math.round(tot * (i === 0 ? 0.8 : 0.2))));
      sm.comp = {};
      COMPLIANCE.forEach((c, i) => (sm.comp[c] = Math.round(tot * (0.9 - i * 0.09) * (0.7 + rnd() * 0.3))));
    }
    if (sm.e.kics) {
      sm.plat = {};
      PLATFORMS.forEach((pl, i) => {
        if (rnd() < 0.7 || i === 0) sm.plat[pl] = Math.round(sm.e.kics.total * (0.5 - i * 0.08) + 1);
      });
    }
    if (sm.e.sca) sm.pkg = { total: int(80, 900), outdated: int(20, 300) };
  }

  /* ---- deep findings: concrete critical/high items for the riskiest projects -------------- */
  const scored = projects
    .filter((p) => latest[p.id])
    .map((p) => ({ p, score: sum(Object.values(summaries[latest[p.id]].e), (e) => (e.sev.C || 0) * 10 + (e.sev.H || 0) * 3) * (0.6 + 0.2 * p.crit) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);
  const deep = { projects: scored.map((x) => x.p.id), open: [], fixed: [], triaged: 0, sampled: {}, severities: ['C', 'H'] };
  const mkFinding = (p, engine, s) => {
    const lang = p._langs[0] || 'Terraform';
    if (engine === 'sast') {
      const [title, cwe] = pick(SAST_Q[s] || SAST_Q.H);
      const file = `${FILES[lang] || 'src/'}${pick(['controllers', 'services', 'api', 'handlers', 'repository', 'util'])}/${pick(['Payment', 'User', 'Order', 'Account', 'Report', 'Session', 'Upload'])}${pick(['Controller', 'Service', 'Handler', 'Dao', 'Resource'])}.${{ Java: 'java', Kotlin: 'kt', TypeScript: 'ts', JavaScript: 'js', Python: 'py', Go: 'go', CSharp: 'cs' }[lang] || 'java'}`;
      return { t: 'sast', s, title, cwe, file, line: int(12, 840), lang };
    }
    if (engine === 'sca') {
      const [cve, pkg, rec, cvss, desc] = pick(SCA_V[s] || SCA_V.H);
      return { t: 'sca', s, title: cve === 'Malicious package' ? `Malicious package: ${pkg.split('-').slice(1).join('-')}` : `${cve} · ${desc}`, cve: cve.startsWith('CVE') ? cve : '', cvss, pkg, rec };
    }
    if (engine === 'kics') {
      const [title, plat] = pick(KICS_Q[s] || KICS_Q.H);
      return { t: 'kics', s, title, file: plat === 'Dockerfile' ? 'Dockerfile' : plat === 'Kubernetes' ? 'deploy/k8s/deployment.yaml' : `infra/${pick(['main', 's3', 'network', 'iam'])}.tf`, line: int(3, 120) };
    }
    if (engine === 'secrets') {
      const [title] = pick(SECRET_Q[s] || SECRET_Q.H);
      return { t: 'sscs-secret-detection', s, title, file: pick(['config/application.yml', '.env.example', 'scripts/deploy.sh', 'src/config.ts']), line: int(2, 60) };
    }
    if (engine === 'containers') return { t: 'containers', s, title: `${pick(['CVE-2023-4911 · glibc Looney Tunables', 'CVE-2024-6387 · OpenSSH regreSSHion', 'CVE-2023-38545 · curl SOCKS5 overflow'])}`, img: `${p.name}:${int(1, 9)}.${int(0, 20)}` };
    return { t: engine, s, title: s === 'C' ? 'Broken Object Level Authorization' : 'Excessive Data Exposure' };
  };
  const scanDate = new Map(scans.map((s) => [s.id, s.c]));
  for (const { p } of scored) {
    const chain = chains[p.id];
    const idx = new Set([0, chain.length - 1]);
    for (let k = 1; k < 5; k++) idx.add(Math.round((k * (chain.length - 1)) / 5));
    deep.sampled[p.id] = [...idx].sort((a, b) => a - b).map((i) => ({ id: chain[i], date: scanDate.get(chain[i]) }));
    const sm = summaries[latest[p.id]];
    const lastId = latest[p.id];
    for (const [engine, c] of Object.entries(sm.e)) {
      for (const s of ['C', 'H']) {
        const n = Math.min(c.sev[s] || 0, s === 'C' ? 25 : 40);
        for (let i = 0; i < n; i++) {
          const f = mkFinding(p, engine, s);
          const age = Math.round(rnd() ** 1.6 * Math.min(400, (to - new Date(p.created)) / DAY));
          deep.open.push({ ...f, k: uuid(), p: p.id, scan: lastId, st: rnd() < 0.15 ? 'CONFIRMED' : rnd() < 0.08 ? 'URGENT' : 'TO_VERIFY', ff: new Date(to - age * DAY).toISOString() });
        }
      }
    }
    const events = fixedEvents[p.id].slice(-70);
    for (const ev of events) {
      const f = mkFinding(p, ev.engine, ev.sev);
      const fixedAt = new Date(ev.at);
      const maturity = (fixedAt - from) / span;
      const ttr = Math.max(1, Math.round((ev.sev === 'C' ? 4 + rnd() * 16 : 8 + rnd() * 45) * (1.3 - maturity * 0.7)));
      const detected = new Date(fixedAt - ttr * DAY);
      deep.fixed.push({ ...f, k: uuid(), p: p.id, st: 'TO_VERIFY', ff: detected.toISOString(), detected: detected.toISOString(), fixedAt: fixedAt.toISOString(), ttr });
    }
    deep.triaged += int(0, 6);
  }

  for (const p of projects) {
    delete p._langs;
    delete p._engines;
    delete p._stale;
    delete p._size;
  }
  return {
    version: 1,
    source: 'demo',
    generatedAt: to.toISOString(),
    tool: BOOT.version,
    tenant: { name: 'acme-demo', astUrl: 'https://eu.ast.checkmarx.net' },
    period: { from: from.toISOString(), to: to.toISOString(), months },
    projects,
    applications,
    scans: scans.sort((a, b) => new Date(b.c) - new Date(a.c)),
    primary,
    chains,
    latest,
    summaries,
    deep,
    warnings: [],
    stats: { requests: 0, ms: 0 },
  };
}
