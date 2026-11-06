/* ============================================================================================
 * util.js — DOM helpers, settings store, i18n, formatting, icons
 * ========================================================================================== */
const BOOT = window.__CXD__ || { token: '', version: 'dev' };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c]);
/**
 * DOM builder — the whole UI is created with DOM APIs (no HTML string parsing), so data from the
 * tenant or from imported snapshot files can only ever become text nodes or attribute values.
 *   h('div.card.kpi#id', { 'data-action': 'x', title: 'y' }, child, 'text', [more children])
 */
const SVGNS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'text', 'g', 'polyline']);
function h(sel, ...args) {
  let attrs = null;
  if (args.length && args[0] && typeof args[0] === 'object' && !(args[0] instanceof Node) && !Array.isArray(args[0])) attrs = args.shift();
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
  const tag = m[1] || 'div';
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVGNS, tag) : document.createElement(tag);
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, String(sv));
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' && 'value' in el) el.value = String(v);
    else if (k === 'href') el.setAttribute('href', safeUrl(v));
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  appendKids(el, args);
  return el;
}
// Right-to-left scripts: Hebrew, Arabic, Syriac, Thaana, NKo … plus the Arabic presentation forms.
const RTL_CHARS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
/** Text that must run left-to-right inside an RTL page: it has letters and none of them is RTL. */
const isLtrText = (s) => /\p{L}/u.test(s) && !RTL_CHARS.test(s);
const NO_BDI = new Set(['OPTION', 'TEXTAREA', 'TITLE', 'SCRIPT', 'STYLE', 'BDI']);
const rtlNow = () => {
  try {
    return isRtl();
  } catch {
    return false; // settings not initialised yet
  }
};
function appendKids(el, kids) {
  // On RTL pages, Latin-only text (finding names, packages, paths, project names) is isolated in a
  // <bdi> so it keeps its own direction: otherwise "… (supply chain)" or a trailing "…" is mirrored.
  const iso = el.namespaceURI !== SVGNS && !NO_BDI.has(el.tagName) && rtlNow();
  for (const k of [kids].flat(Infinity)) {
    if (k == null || k === false || k === '') continue;
    if (k instanceof Node) el.append(k);
    else {
      const s = String(k);
      el.append(iso && isLtrText(s) ? h('bdi', s) : document.createTextNode(s));
    }
  }
  return el;
}
/** Parts joined by a separator as separate nodes, so on RTL pages each Latin part is isolated on its own. */
const joinParts = (parts, sep = ' · ') => parts.filter(Boolean).flatMap((p, i) => (i ? [sep, p] : [p]));
const frag = (...kids) => appendKids(document.createDocumentFragment(), kids);
const mount = (el, ...kids) => {
  if (!el) return;
  el.replaceChildren();
  appendKids(el, kids);
};
/** Only http(s) URLs (or in-page #anchors) are ever placed in href attributes. */
function safeUrl(u) {
  const s = String(u ?? '');
  if (s.startsWith('#')) return s;
  try {
    const x = new URL(s, location.href);
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '#';
  } catch {
    return '#';
  }
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const DAY = 86400000;
const SEVS = ['C', 'H', 'M', 'L'];
const sevZero = () => ({ C: 0, H: 0, M: 0, L: 0 });
const debounce = (fn, ms = 250) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};
/**
 * Keep KPI tile values on one line: shrink the ones that would overflow their tile (long compact
 * currency words such as "16.3 مليون د.إ." or "4,4 Mio. €"), and only let them wrap below 15px.
 */
function fitKpis(root = document) {
  for (const el of root.querySelectorAll('.kpi-value')) {
    el.style.removeProperty('font-size');
    el.style.removeProperty('white-space');
    const avail = el.clientWidth;
    if (!avail || el.scrollWidth <= avail + 1) continue;
    const size = Math.floor((parseFloat(getComputedStyle(el).fontSize) * avail) / el.scrollWidth) - 0.5;
    el.style.setProperty('font-size', `${Math.max(15, size)}px`);
    if (el.scrollWidth > avail + 1) el.style.setProperty('white-space', 'normal');
  }
}
const safeStore = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  },
};

/* ---------- Settings ---------------------------------------------------------------------- */
// All money values are stored in USD and converted with the FX rate of the selected currency.
const CURRENCIES = {
  USD: 1, EUR: 0.86, GBP: 0.75, INR: 88, JPY: 152, AUD: 1.53, CAD: 1.4, CHF: 0.8, SGD: 1.3, ILS: 3.3, BRL: 5.4, AED: 3.67, SAR: 3.75, QAR: 3.64, KWD: 0.31, SEK: 9.5, MXN: 18.5, ZAR: 17.5,
};
const LANGS = { en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', pt: 'Português', ja: '日本語', ar: 'العربية' };
// ar-AE: Arabic text with Western digits (common in Gulf enterprise software); ar-SA / ar-EG use Arabic-Indic digits.
const LANG_LOCALE = { en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', pt: 'pt-BR', ja: 'ja-JP', ar: 'ar-AE' };
const LOCALES = ['auto', 'en-US', 'en-GB', 'en-IN', 'en-AU', 'de-DE', 'de-CH', 'fr-FR', 'es-ES', 'es-MX', 'pt-BR', 'it-IT', 'nl-NL', 'ja-JP', 'ar-AE', 'ar-SA', 'ar-EG', 'he-IL', 'sv-SE'];
const RTL_LANGS = new Set(['ar']);
const isRtl = () => RTL_LANGS.has(Store.s?.lang);

const PRESETS = {
  conservative: { fixHours: { C: 6, H: 4, M: 2, L: 1 }, lateMultiplier: 4, pExploit: { C: 0.25, H: 0.05, M: 0.005, L: 0 }, maxIncidentsPerYear: 0.5 },
  balanced: { fixHours: { C: 8, H: 5, M: 3, L: 1 }, lateMultiplier: 6, pExploit: { C: 0.5, H: 0.1, M: 0.01, L: 0 }, maxIncidentsPerYear: 1 },
  aggressive: { fixHours: { C: 12, H: 8, M: 4, L: 2 }, lateMultiplier: 10, pExploit: { C: 1, H: 0.25, M: 0.02, L: 0.002 }, maxIncidentsPerYear: 2 },
};

const DEFAULT_SETTINGS = {
  lang: 'en',
  locale: 'auto',
  currency: 'USD',
  fx: { ...CURRENCIES },
  theme: 'light',
  persona: 'ciso',
  // cost model (USD)
  devRate: 85,
  ...JSON.parse(JSON.stringify(PRESETS.balanced)),
  investment: 0,
  // risk model
  breachCost: 4440000, // IBM Cost of a Data Breach Report 2025 — global average
  repShare: 30,
  critWeighting: false,
  // remediation SLAs (days)
  sla: { C: 7, H: 30, M: 90, L: 180 },
  // data collection
  months: 12,
  deepProjects: 25,
  deepScans: 6,
  // report branding
  report: { org: '', preparedBy: '', confidential: true },
  roiBannerDismissed: false,
};

const Store = {
  s: null,
  load() {
    const saved = safeStore.get('cxvd.settings') || {};
    this.s = deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), saved);
    if (!saved.lang) {
      const nav = (navigator.language || 'en').slice(0, 2);
      if (LANGS[nav]) this.s.lang = nav;
    }
    if (!saved.theme && window.matchMedia?.('(prefers-color-scheme: dark)').matches) this.s.theme = 'dark';
    return this.s;
  },
  save() {
    safeStore.set('cxvd.settings', this.s);
  },
  set(path, value) {
    const parts = path.split('.');
    let o = this.s;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] ||= {};
    o[parts[parts.length - 1]] = value;
    this.save();
  },
  get(path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), this.s);
  },
};
function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') deepMerge(a[k], v);
    else a[k] = v;
  }
  return a;
}

/* ---------- i18n ------------------------------------------------------------------------- */
// English strings are the keys; translations live in I18N[lang]. Missing entries fall back to English.
function t(key, vars) {
  const lang = Store.s?.lang || 'en';
  let s = (lang !== 'en' && window.I18N?.[lang]?.[key]) || key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
  return s;
}

/* ---------- Formatting ------------------------------------------------------------------- */
const locale = () => (Store.s.locale && Store.s.locale !== 'auto' ? Store.s.locale : LANG_LOCALE[Store.s.lang] || 'en-US');
const fxRate = () => Number(Store.s.fx?.[Store.s.currency] ?? CURRENCIES[Store.s.currency] ?? 1) || 1;
const nfCache = new Map();
function nf(opts) {
  const key = locale() + JSON.stringify(opts);
  if (!nfCache.has(key)) nfCache.set(key, new Intl.NumberFormat(locale(), opts));
  return nfCache.get(key);
}
/** Arabic: narrow symbols ("$", "€"); "US$" would be reordered to "$US" by the bidi algorithm. */
const curDisplay = () => (locale().startsWith('ar') ? 'narrowSymbol' : 'symbol');
// On RTL pages a Latin currency symbol next to Arabic words ("10.9 مليون US$") is split by the bidi
// algorithm and shows as "$US"; LRM marks around it keep it in one piece.
const bidiMoney = (f, v) =>
  rtlNow() ? f.formatToParts(v).map((p) => (p.type === 'currency' && /[A-Za-z]/.test(p.value) ? `‎${p.value}‎` : p.value)).join('') : f.format(v);
// Arabic short units are single letters ("س" for hour), so spell them out there.
const unitDisplay = () => (locale().startsWith('ar') ? 'long' : 'short');
const fmt = {
  num: (v, d = 0) => nf({ maximumFractionDigits: d, minimumFractionDigits: 0 }).format(Number(v) || 0),
  compact: (v) => (Math.abs(v) < 10000 ? fmt.num(v) : nf({ notation: 'compact', maximumFractionDigits: 1 }).format(Number(v) || 0)),
  /** USD amount → selected currency */
  cur: (usd, compact = true) => fmt.money((Number(usd) || 0) * fxRate(), compact),
  /** Amount already in the selected currency. Compact with one decimal only where the locale
   *  actually abbreviates (de/fr/es write thousands in full, so no stray decimal there). */
  money: (v, compact = true) => {
    v = Number(v) || 0;
    if (compact && Math.abs(v) >= 10000) {
      const c = nf({ style: 'currency', currency: Store.s.currency, currencyDisplay: curDisplay(), notation: 'compact', maximumFractionDigits: 1, minimumFractionDigits: 0 });
      if (c.formatToParts(v).some((p) => p.type === 'compact')) return bidiMoney(c, v);
    }
    return bidiMoney(nf({ style: 'currency', currency: Store.s.currency, currencyDisplay: curDisplay(), maximumFractionDigits: 0, minimumFractionDigits: 0 }), v);
  },
  curFull: (usd) => fmt.cur(usd, false),
  pct: (v, d = 0) => (v == null || !isFinite(v) ? '—' : nf({ style: 'percent', maximumFractionDigits: d, minimumFractionDigits: 0 }).format(v)),
  date: (d) => (d ? new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(d)) : '—'),
  month: (key) => new Intl.DateTimeFormat(locale(), { month: 'short', year: '2-digit' }).format(new Date(`${key}-15T00:00:00`)),
  monthLong: (key) => new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(new Date(`${key}-15T00:00:00`)),
  // Units via Intl: correct plurals and abbreviations per language ("1 day", "12 Tage", "12 يومًا", "76.2K hr").
  days: (v) => (v == null || !isFinite(v) ? '—' : nf({ style: 'unit', unit: 'day', unitDisplay: 'long', maximumFractionDigits: v < 10 ? 1 : 0 }).format(v)),
  daysShort: (v) => (v == null || !isFinite(v) ? '—' : nf({ style: 'unit', unit: 'day', unitDisplay: 'short', maximumFractionDigits: 0 }).format(v)),
  hours: (v) => {
    const n = Math.round(Number(v) || 0);
    const big = Math.abs(n) >= 10000;
    return nf({ style: 'unit', unit: 'hour', unitDisplay: unitDisplay(), notation: big ? 'compact' : 'standard', maximumFractionDigits: big ? 1 : 0 }).format(n);
  },
  mult: (v) => (v == null || !isFinite(v) ? '—' : `${fmt.num(v, v < 10 ? 1 : 0)}×`),
  rel: (d) => {
    if (!d) return '—';
    const days = Math.round((Date.now() - new Date(d)) / DAY);
    try {
      return new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(-days, 'day');
    } catch {
      return `${days} d`;
    }
  },
};
/** Localised short unit label, e.g. hour → "hr" / "Std." / "س". */
const unitLabel = (unit) => {
  try {
    // 11 picks the general form (Arabic 2 would give the dual "ساعتان").
    return nf({ style: 'unit', unit, unitDisplay: unitDisplay() }).formatToParts(11).find((p) => p.type === 'unit')?.value || unit;
  } catch {
    return unit;
  }
};
const curSymbol = () => {
  try {
    return (nf({ style: 'currency', currency: Store.s.currency, currencyDisplay: curDisplay(), maximumFractionDigits: 0, minimumFractionDigits: 0 }).formatToParts(0).find((p) => p.type === 'currency') || {}).value || Store.s.currency;
  } catch {
    return Store.s.currency;
  }
};

const SEV_LABEL = () => ({ C: t('Critical'), H: t('High'), M: t('Medium'), L: t('Low'), I: t('Info') });
const ENGINE_LABEL = (e) =>
  ({
    sast: 'SAST',
    sca: 'SCA',
    kics: t('IaC Security'),
    apisec: t('API Security'),
    containers: t('Container Security'),
    secrets: t('Secret Detection'),
    micro: t('Secrets & Scorecard'),
    microengines: t('Secrets & Scorecard'),
    'sscs-secret-detection': t('Secret Detection'),
    'sscs-scorecard': 'Scorecard',
  })[e] || e;

/* ---------- Icons (thin-line, rounded, 24px grid) --------------------------------------- */
const ICONS = {
  shield: '<path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"/>',
  'shield-check': '<path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"/><path d="M9 12l2 2l4 -4"/>',
  briefcase: '<path d="M3 9a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/><path d="M8 7v-2a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2"/><path d="M12 12l0 .01"/><path d="M3 13a20 20 0 0 0 18 0"/>',
  sitemap: '<path d="M3 15m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z"/><path d="M15 15m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z"/><path d="M9 3m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z"/><path d="M6 15v-1a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v1"/><path d="M12 9l0 3"/>',
  users: '<path d="M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0 -3 -3.85"/>',
  code: '<path d="M7 8l-4 4l4 4"/><path d="M17 8l4 4l-4 4"/><path d="M14 4l-4 16"/>',
  calculator: '<path d="M4 3m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"/><path d="M8 7m0 1a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1v1a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1z"/><path d="M8 14l0 .01"/><path d="M12 14l0 .01"/><path d="M16 14l0 .01"/><path d="M8 17l0 .01"/><path d="M12 17l0 .01"/><path d="M16 17l0 .01"/>',
  'trending-up': '<path d="M3 17l6 -6l4 4l8 -8"/><path d="M14 7l7 0l0 7"/>',
  'trending-down': '<path d="M3 7l6 6l4 -4l8 8"/><path d="M21 10l0 7l-7 0"/>',
  download: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 11l5 5l5 -5"/><path d="M12 4l0 12"/>',
  upload: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 9l5 -5l5 5"/><path d="M12 4l0 12"/>',
  refresh: '<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
  settings: '<path d="M4 6l8 0"/><path d="M16 6l4 0"/><path d="M14 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M4 12l2 0"/><path d="M10 12l10 0"/><path d="M8 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M4 18l11 0"/><path d="M19 18l1 0"/><path d="M17 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/>',
  moon: '<path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"/>',
  sun: '<path d="M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7"/>',
  clock: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 7v5l3 3"/>',
  alert: '<path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z"/><path d="M12 16h.01"/>',
  check: '<path d="M5 12l5 5l10 -10"/>',
  x: '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>',
  presentation: '<path d="M3 4l18 0"/><path d="M4 4v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-10"/><path d="M12 16l0 4"/><path d="M9 20l6 0"/><path d="M8 12l3 -3l2 2l3 -3"/>',
  file: '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/>',
  'file-pdf': '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4"/><path d="M5 18h1.5a1.5 1.5 0 0 0 0 -3h-1.5v6"/><path d="M17 18h2"/><path d="M20 15h-3v6"/><path d="M11 15v6h1a2 2 0 0 0 2 -2v-2a2 2 0 0 0 -2 -2h-1z"/>',
  printer: '<path d="M17 17h2a2 2 0 0 0 2 -2v-4a2 2 0 0 0 -2 -2h-14a2 2 0 0 0 -2 2v4a2 2 0 0 0 2 2h2"/><path d="M17 9v-4a2 2 0 0 0 -2 -2h-6a2 2 0 0 0 -2 2v4"/><path d="M7 13m0 2a2 2 0 0 1 2 -2h6a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2z"/>',
  key: '<path d="M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0z"/><path d="M15 9h.01"/>',
  lock: '<path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z"/><path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0"/><path d="M8 11v-4a4 4 0 1 1 8 0v4"/>',
  bolt: '<path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"/>',
  target: '<path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0"/><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/>',
  package: '<path d="M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5"/><path d="M12 12l8 -4.5"/><path d="M12 12l0 9"/><path d="M12 12l-8 -4.5"/>',
  bug: '<path d="M9 9v-1a3 3 0 0 1 6 0v1"/><path d="M8 9h8a6 6 0 0 1 1 3v3a5 5 0 0 1 -10 0v-3a6 6 0 0 1 1 -3"/><path d="M3 13l4 0"/><path d="M17 13l4 0"/><path d="M12 20l0 -6"/><path d="M4 19l3.35 -2"/><path d="M20 19l-3.35 -2"/><path d="M4 7l3.75 2.4"/><path d="M20 7l-3.75 2.4"/>',
  external: '<path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6"/><path d="M11 13l9 -9"/><path d="M15 4h5v5"/>',
  search: '<path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M21 21l-6 -6"/>',
  world: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M3.6 9h16.8"/><path d="M3.6 15h16.8"/><path d="M11.5 3a17 17 0 0 0 0 18"/><path d="M12.5 3a17 17 0 0 1 0 18"/>',
  info: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 9h.01"/><path d="M11 12h1v4h1"/>',
  trophy: '<path d="M8 21l8 0"/><path d="M12 17l0 4"/><path d="M7 4l10 0"/><path d="M17 4v8a5 5 0 0 1 -10 0v-8"/><path d="M5 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M19 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/>',
  table: '<path d="M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14z"/><path d="M3 10h18"/><path d="M10 3v18"/>',
  chart: '<path d="M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M4 20h14"/>',
  coin: '<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M14.8 9a2 2 0 0 0 -1.8 -1h-2a2 2 0 1 0 0 4h2a2 2 0 1 1 0 4h-2a2 2 0 0 1 -1.8 -1"/><path d="M12 7v10"/>',
  'git-branch': '<path d="M7 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M7 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M17 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M7 8l0 8"/><path d="M9 18h6a2 2 0 0 0 2 -2v-5"/><path d="M14 14l3 -3l3 3"/>',
  logout: '<path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2"/><path d="M9 12h12l-3 -3"/><path d="M18 15l3 -3"/>',
  'chevron-down': '<path d="M6 9l6 6l6 -6"/>',
  'arrow-right': '<path d="M5 12l14 0"/><path d="M13 18l6 -6"/><path d="M13 6l6 6"/>',
  database: '<path d="M12 6m-8 0a8 3 0 1 0 16 0a8 3 0 1 0 -16 0"/><path d="M4 6v6a8 3 0 0 0 16 0v-6"/><path d="M4 12v6a8 3 0 0 0 16 0v-6"/>',
  sparkles: '<path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z"/>',
  flame: '<path d="M12 12c2 -2.96 0 -7 -1 -8c0 3.038 -1.773 4.741 -3 6c-1.226 1.26 -2 3.24 -2 5a6 6 0 1 0 12 0c0 -1.532 -1.056 -3.94 -2 -5c-1.786 3 -2.791 3 -4 2z"/>',
  eye: '<path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"/>',
  filter: '<path d="M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227z"/>',
};
const ICON_PATHS = {};
for (const [k, v] of Object.entries(ICONS)) ICON_PATHS[k] = [...v.matchAll(/d="([^"]+)"/g)].map((m) => m[1]);
// Icons that point along the reading direction; mirrored in right-to-left layouts (see .icon-dir).
const DIR_ICONS = new Set(['arrow-right', 'arrow-left', 'chevron-right', 'chevron-left']);
function icon(name, cls = '') {
  if (DIR_ICONS.has(name)) cls = `${cls} icon-dir`.trim();
  const svg = h('svg', { class: `icon ${cls}`, width: 24, height: 24, viewBox: '0 0 24 24', 'stroke-width': 1.75, stroke: 'currentColor', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  for (const d of ICON_PATHS[name] || []) svg.appendChild(h('path', { d }));
  return svg;
}

/* ---------- Toasts ----------------------------------------------------------------------- */
function toast(msg, tone = 'info', ms = 4200) {
  const host = $('#toasts');
  if (!host) return;
  const el = h('div', { class: `cx-toast cx-toast-${tone}`, role: 'status' }, icon(tone === 'error' ? 'alert' : tone === 'success' ? 'check' : 'info'), h('span', msg));
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

/* ---------- Script loader (local vendor cache first, CDN fallback) ---------------------- */
const VENDOR_CDN = {
  'tabler.min.css': 'https://cdn.jsdelivr.net/npm/@tabler/core@1.0.0/dist/css/tabler.min.css',
  'tabler.rtl.min.css': 'https://cdn.jsdelivr.net/npm/@tabler/core@1.0.0/dist/css/tabler.rtl.min.css',
  'tabler.min.js': 'https://cdn.jsdelivr.net/npm/@tabler/core@1.0.0/dist/js/tabler.min.js',
  'apexcharts.min.js': 'https://cdn.jsdelivr.net/npm/apexcharts@3.54.1/dist/apexcharts.min.js',
  'pptxgen.bundle.js': 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
  'jspdf.umd.min.js': 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
  'html2canvas.min.js': 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
};
const loaded = new Map();
function loadAsset(name) {
  if (loaded.has(name)) return loaded.get(name);
  const isCss = name.endsWith('.css');
  const tryLoad = (src) =>
    new Promise((resolve, reject) => {
      const el = document.createElement(isCss ? 'link' : 'script');
      if (isCss) {
        el.rel = 'stylesheet';
        el.href = src;
        el.dataset.asset = name;
      } else {
        el.src = src;
        el.async = false;
      }
      el.onload = () => resolve();
      el.onerror = () => {
        el.remove();
        reject(new Error(`Failed to load ${src}`));
      };
      (isCss ? document.head.insertBefore(el, document.head.querySelector('style')) : document.body.appendChild(el));
    });
  const p = tryLoad(`/vendor/${name}`).catch(() => tryLoad(VENDOR_CDN[name]));
  loaded.set(name, p);
  return p;
}

/* ---------- Local API ------------------------------------------------------------------- */
async function api(path, body) {
  const r = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CXD-Token': BOOT.token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error || `HTTP ${r.status}`);
    e.status = r.status;
    e.detail = j.detail;
    throw e;
  }
  return j;
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
const fileStamp = () => new Date().toISOString().slice(0, 10);
const slug = (s) => String(s || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'report';
