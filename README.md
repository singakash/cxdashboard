# Checkmarx One Value Dashboard

A single-file, zero-dependency tool that turns a Checkmarx One tenant's scan history into an
interactive value dashboard — risk avoided, ROI, remediation performance and program health —
with views for **CISO, CIO, Security Architect, Team Lead and Developer**, and one-click
**PowerPoint / PDF** reports.

```
node cxone-dashboard.mjs
```

Paste an API key, and the dashboard opens in your browser. Everything runs on your machine:
the key is held in memory only and every call to Checkmarx One is a read-only `GET`.

---

## Quick start

1. Install **Node.js 18 or newer** (tested on Node 26). Nothing else — no `npm install`.
2. In Checkmarx One go to **Identity and Access Management → API Keys** and create a key.
3. Run the tool:

   ```bash
   node dist/cxone-dashboard.mjs              # opens http://127.0.0.1:8787/
   ```

4. Paste the key and press **Connect & build dashboard**. Tenant and region are read from the key.

Prefer not to paste? Start with the key in the environment and click **Use it** on the setup screen:

```bash
CX_APIKEY=eyJhbGciOi... node dist/cxone-dashboard.mjs          # macOS / Linux
$env:CX_APIKEY = "eyJhbGciOi..."; node dist\cxone-dashboard.mjs  # Windows PowerShell
```

No tenant at hand? **Explore with demo data** shows a realistic synthetic company.

### Two builds

| File | Use when |
|---|---|
| `dist/cxone-dashboard.mjs` (≈0.8 MB) | Normal use. UI libraries (Tabler, ApexCharts, PptxGenJS, jsPDF, html2canvas) are fetched once from jsDelivr/unpkg and cached in `~/.cxone-dashboard`. |
| `dist/cxone-dashboard-offline.mjs` (≈1.5 MB) | Air-gapped or locked-down machines. All libraries are embedded; the only network traffic is to your Checkmarx One tenant. |

---

## Options

```
--port <n>          Local port (default 8787, moves to the next free port if busy)
--host <ip>         Bind address (default 127.0.0.1)
--no-open           Do not open the browser automatically
--base-url <url>    Checkmarx One API base URL (e.g. https://eu.ast.checkmarx.net) — auto-detected from the key
--iam-url <url>     Checkmarx One IAM URL (e.g. https://eu.iam.checkmarx.net) — auto-detected from the key
--tenant <name>     Tenant name — auto-detected from the key
--concurrency <n>   Parallel API requests (default 6)
--cache-dir <dir>   Where scan summaries and UI libraries are cached (default ~/.cxone-dashboard)
--no-cache          Do not persist scan-summary counters to disk
--help              Show this help
```

| Environment variable | Meaning |
|---|---|
| `CX_APIKEY` | API key offered on the setup screen (safer than a command-line argument) |
| `CX_BASE_URI`, `CX_BASE_AUTH_URI`, `CX_TENANT` | Same as `--base-url`, `--iam-url`, `--tenant` (the names used by the `cx` CLI) |
| `NODE_EXTRA_CA_CERTS` | PEM bundle of your corporate root CA, for TLS-inspecting proxies |
| `NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY` | Route requests through an HTTP(S) proxy (supported by Node 24 and newer) |

**Other ways to connect** (setup screen → *Advanced options*): choose a region explicitly
(US, US2, EU, EU2, DEU, ANZ, IND, SNG, UAE), enter tenant/URLs for a single-tenant
deployment, or use an **OAuth client ID + secret** instead of an API key.

### Permissions

The key or OAuth client only needs **read access** to:

| Data | Endpoint | Required |
|---|---|---|
| Projects | `/api/projects` | yes |
| Scans | `/api/scans` | yes |
| Scan summaries (counts per engine/severity) | `/api/scan-summary` | yes |
| Results (critical & high, top projects) | `/api/results` | recommended — powers MTTR, SLA, "how we reduced risk" stories and developer lists |
| Applications | `/api/applications` | optional — enables the application filter |

If a permission is missing, the dashboard still loads and lists what was skipped under
*Settings → Data*.

---

## What you get

| View | Focus |
|---|---|
| **CISO** | Value delivered, risk exposure avoided, exposure trend, SLA compliance, security grades, compliance mapping, and *How Checkmarx One reduced financial & reputational risk* — notable critical issues (e.g. Log4Shell, malicious packages) found and fixed, with the exposure each removed |
| **CIO** | ROI, payback, cumulative value vs. investment, developer hours saved (FTE), value by scanner, adoption & automation |
| **Security Architect** | Scanner coverage, integrations, scan health, triage status, vulnerability and language landscape |
| **Team Lead** | Backlog & remediation velocity, backlog ageing, projects needing attention, SLA breaches |
| **Developer** | What to fix next, recurring patterns, quick-win package upgrades |
| **ROI Model** | Every assumption, editable, with presets (Conservative / Balanced / Aggressive), sensitivity table and the full formula |

**Exports** (header → *Export*): PowerPoint with native, editable charts and tables · PDF ·
Print / vector PDF · findings CSV · data snapshot (JSON). Export the current view or the
16-slide **Executive pack**. A snapshot can be re-opened later (or by a colleague) without
any tenant access.

**Localisation** (Settings → General): English, Deutsch, Français, Español, Português (BR),
日本語, العربية; number/date format; 18 currencies (including AED, SAR, QAR, KWD) with an
editable exchange rate. Settings are remembered in the browser.

**Arabic / right-to-left:** choosing العربية mirrors the whole UI (Tabler RTL stylesheet,
settings drawer from the left, direction-aware arrows) and every export — PowerPoint slides are
laid out right-to-left with RTL paragraphs, and PDF/print slides mirror too. Charts, code,
file paths and package names stay left-to-right; Latin-only text such as finding titles keeps
its own direction inside Arabic layouts. The default format `ar-AE` uses Western digits
(1,721); pick `ar-SA` or `ar-EG` under *Number & date format* for Arabic-Indic digits (١٬٧٢١).
Arabic decks use Arial, because the brand fonts have no Arabic glyphs.

---

## How value is calculated

All monetary values are **risk-adjusted estimates**; every input is editable in the ROI Model
and is printed on the *Methodology & assumptions* slide of each report.

**Remediated vulnerability** — a finding present in a scan of a project's primary branch and
absent from the next scan, counted per engine and severity:
`fixedᵢ = max(0, totalᵢ₋₁ − recurrentᵢ)`. This is a conservative lower bound (a finding fixed
and re-introduced between scans is not counted).

1. **Remediation cost avoided** — fixing early is cheaper than fixing late:
   `Σ fixed × fix hours(severity) × (late-fix multiplier − 1) × developer hourly cost`
2. **Incident risk avoided** — the chance that a fixed vulnerability would have led to a breach:
   `expected incidents = Σ projects [1 − Π (1 − P(exploit | severity))^fixed]`, capped at
   *max incidents per year × years*, then `× average breach cost`. The *reputational share*
   splits the result into direct and reputational cost.
3. **ROI** — `(total value − investment) ÷ investment`, with the annual Checkmarx One
   investment pro-rated to the analysis period.

Defaults (Balanced preset): developer cost $85/h; fix hours C/H/M/L = 8/5/3/1; late-fix
multiplier 6×; P(exploit) C/H/M/L = 0.5% / 0.1% / 0.01% / 0; at most 1 incident per year;
average breach cost $4.44M (IBM *Cost of a Data Breach* 2025); reputational share 30%;
SLA C/H/M/L = 7/30/90/180 days. Enter your annual investment to see ROI and payback.

---

## Security & privacy

- Binds to `127.0.0.1` only; requests with a foreign `Host` header are rejected.
- The browser talks only to the local server, using a per-session token; a strict
  Content-Security-Policy blocks third-party connections from the page.
- Credentials live in memory and are dropped on **Disconnect** or exit. Nothing is sent
  anywhere except your Checkmarx One tenant.
- On disk (`~/.cxone-dashboard`, disable with `--no-cache`): scan-summary **counters** to
  speed up refreshes, and the cached UI libraries. No source code, no finding details, no keys.
- Snapshots you export contain finding metadata (titles, files, packages) — treat them like
  any other security report.

---

## Development

```
src/server.mjs        Local server: Checkmarx One client, collection pipeline, static assets
src/web/              UI — index.html, styles.css, js/{util,i18n,charts,metrics,demo,views,export,app}.js
build.mjs             Bundles src/ into one self-contained .mjs
test/mock-cxone.mjs   Mock Checkmarx One (IAM + API) with an evolving finding history
```

```bash
node src/server.mjs                 # dev mode — the UI is re-assembled from src/web on every page load
node build.mjs                      # → dist/cxone-dashboard.mjs
node build.mjs --embed-vendor       # → dist/cxone-dashboard-offline.mjs
```

**Testing without a tenant:** `node test/mock-cxone.mjs --port 9911` prints a mock API key;
start the dashboard and paste that key. The mock serves 8 projects, 2 applications and ~450
scans with findings that appear, persist and get fixed over time. Add
`--deny results,applications` to simulate a key with missing permissions.

**Translations:** English strings are the keys in `src/web/js/i18n.js`; anything missing falls
back to English. Keep `{placeholders}` intact. Right-to-left languages are listed in
`RTL_LANGS` (`util.js`); use logical CSS properties (`margin-inline-start`, `text-align: start`)
so new UI mirrors automatically.

### Brand notes

Colours, logo and illustration follow the Checkmarx visual identity (R1.2). Web UI and PDF use
the embedded DM Sans; PowerPoint decks reference Founders Grotesk (headings) and Aptos (body)
— install them for an exact render, otherwise PowerPoint substitutes a similar font (Arabic
decks use Arial throughout). Severity
colours (critical/high/medium/low) are functional status colours, not brand accents. Decks are
generated with brand styling rather than from the official `.potx` template.
