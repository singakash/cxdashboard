/* ============================================================================================
 * charts.js — one chart "spec" rendered three ways: ApexCharts (dashboard), SVG (PDF/print),
 * native PowerPoint charts (export.js). Palettes validated with the dataviz validator:
 *   categorical light  #6B34FD,#A822BF,#F25929,#006BD5 (surface #FFFFFF)  — all checks pass
 *   categorical dark   #9670FF,#A822BF,#F25929,#2F86E0 (surface #1B1029)  — all checks pass
 *   severity light     #8E1A9E,#DC2626,#F59E0B,#006BD5 — pass (amber <3:1 → labels/table view)
 *   severity dark      #C04FD6,#F43F5E,#C98500,#3B8BE5 — pass with CVD warn → legends + gaps
 * All values interpolated into SVG/HTML are either escaped (text), coerced with num() (numbers)
 * or allow-listed with safeColor() (colours) — datasets may come from user-supplied snapshot files.
 * ========================================================================================== */
const PALETTES = {
  light: {
    mode: 'light',
    cat: ['#6B34FD', '#A822BF', '#F25929', '#006BD5'],
    other: '#9A93A6',
    sev: { C: '#8E1A9E', H: '#DC2626', M: '#F59E0B', L: '#006BD5', I: '#9A93A6' },
    status: { good: '#0CA30C', warning: '#FAB219', serious: '#EC835A', critical: '#D03B3B', neutral: '#9A93A6' },
    grade: { A: '#0CA30C', B: '#7DBE4A', C: '#FAB219', D: '#EC835A', F: '#D03B3B' },
    surface: '#FFFFFF',
    text: '#140921',
    muted: '#6E6680',
    grid: '#ECE7F3',
    axis: '#D6CFE1',
    violetTint: '#E1D6FF',
  },
  dark: {
    mode: 'dark',
    cat: ['#9670FF', '#A822BF', '#F25929', '#2F86E0'],
    other: '#8A8299',
    sev: { C: '#C04FD6', H: '#F43F5E', M: '#C98500', L: '#3B8BE5', I: '#8A8299' },
    status: { good: '#0CA30C', warning: '#FAB219', serious: '#EC835A', critical: '#D03B3B', neutral: '#8A8299' },
    grade: { A: '#0CA30C', B: '#6FB23E', C: '#FAB219', D: '#EC835A', F: '#D03B3B' },
    surface: '#1B1029',
    text: '#FCF9FE',
    muted: '#AFA6BF',
    grid: '#2C2140',
    axis: '#3B2E52',
    violetTint: '#3A2770',
  },
};
const pal = () => PALETTES[Store.s.theme === 'dark' ? 'dark' : 'light'];
const LIGHT = PALETTES.light;
const num = (v, d = 1) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : 0;
};
const safeColor = (c) => (/^#[0-9a-fA-F]{3,8}$/.test(String(c)) ? String(c) : '#9A93A6');

/** Money specs hold USD; convert to the display currency *before* scaling so axis ticks are
 *  round numbers in the currency the reader sees (not converted 5/10/15M USD ticks). */
function displaySpec(spec) {
  if (!spec || spec.fmt !== 'cur') return spec;
  const fx = fxRate();
  return { ...spec, fmt: 'money', series: spec.series.map((s) => ({ ...s, data: s.data.map((v) => (v == null ? null : (Number(v) || 0) * fx)) })) };
}
function valueFormatter(f) {
  if (f === 'cur') return (v) => fmt.cur(v);
  if (f === 'money') return (v) => fmt.money(v);
  if (f === 'pct') return (v) => fmt.pct(v);
  if (f === 'days') return (v) => fmt.daysShort(v);
  if (f === 'hours') return (v) => fmt.hours(v);
  return (v) => (v == null ? '—' : fmt.compact(v));
}
const truncate = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const specEmpty = (spec) => !spec || !spec.labels?.length || !spec.series?.some((s) => s.data?.some((v) => Number(v) > 0));
/** Resolve series colours. A series may carry a literal colour, or a role such as "sev:C" / "cat:2". */
function resolveColor(c, i, P) {
  let out;
  if (!c) out = P.cat[i % P.cat.length];
  else if (c.startsWith('sev:')) out = P.sev[c.slice(4)];
  else if (c.startsWith('cat:')) out = P.cat[Number(c.slice(4))];
  else if (c.startsWith('status:')) out = P.status[c.slice(7)];
  else if (c.startsWith('grade:')) out = P.grade[c.slice(6)];
  else if (c === 'other') out = P.other;
  else out = c;
  return safeColor(out);
}

/** Chart text font; Arabic needs fallbacks with Arabic glyphs (DM Sans has none). */
const chartFont = () => (isRtl() ? '"DM Sans", "Segoe UI", "Geeza Pro", Tahoma, Arial, sans-serif' : '"DM Sans", Helvetica, Arial, sans-serif');

/* ---------- ApexCharts -------------------------------------------------------------------- */
function apexOptions(spec, width = 0) {
  spec = displaySpec(spec);
  const P = pal();
  const isH = spec.kind === 'hbar' || spec.kind === 'hstacked';
  // Narrow charts: show every n-th category label (untrimmed) instead of ApexCharts' "Jan…" / "." stubs.
  const nLab = spec.labels.length;
  const maxLab = width ? Math.max(2, Math.floor(width / 64)) : nLab;
  const step = !isH && nLab > maxLab ? Math.ceil(nLab / maxLab) : 1;
  const labIdx = new Map(spec.labels.map((l, i) => [String(l), i]));
  const xFmt = step > 1 ? (v) => (labIdx.get(String(v)) % step === 0 ? v : '') : undefined;
  const stacked = spec.kind === 'stacked' || spec.kind === 'hstacked';
  const type = spec.kind === 'line' ? 'line' : spec.kind === 'area' ? 'area' : 'bar';
  const f = valueFormatter(spec.fmt);
  const multi = spec.series.length > 1;
  const colors = spec.distributed ? spec.colors.map((c, i) => resolveColor(c, i, P)) : spec.series.map((s, i) => resolveColor(s.color, i, P));
  return {
    chart: {
      type,
      height: spec.height || 280,
      stacked,
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: chartFont(),
      foreColor: P.muted,
      background: 'transparent',
      animations: { enabled: true, easing: 'easeinout', speed: 380, animateGradually: { enabled: false } },
      parentHeightOffset: 0,
      // Resizing is handled by Charts.onResize: ApexCharts' own debounced redraw can fire after a
      // chart was destroyed by a page change and then throws NaN attribute errors.
      redrawOnParentResize: false,
      redrawOnWindowResize: false,
    },
    theme: { mode: P.mode },
    series: spec.series.map((s) => ({ name: String(s.name), data: s.data.map((v) => (v == null ? null : num(v, 2))) })),
    colors,
    xaxis: {
      categories: spec.labels.map(String),
      labels: { style: { colors: P.muted, fontSize: '11px' }, rotate: 0, hideOverlappingLabels: true, trim: !isH && step === 1, formatter: isH ? f : xFmt },
      axisBorder: { show: !isH, color: P.axis },
      axisTicks: { show: false },
      tooltip: { enabled: false },
      tickAmount: isH ? 4 : undefined,
    },
    yaxis: {
      labels: {
        style: { colors: isH ? P.text : P.muted, fontSize: isH ? '12px' : '11px' },
        formatter: isH ? (v) => truncate(v, 30) : f,
        maxWidth: isH ? 220 : 90,
      },
      min: spec.kind === 'line' && spec.yMin != null ? spec.yMin : undefined,
      forceNiceScale: true,
      tickAmount: isH ? undefined : 4,
    },
    grid: { borderColor: P.grid, strokeDashArray: 0, xaxis: { lines: { show: isH } }, yaxis: { lines: { show: !isH } }, padding: { left: 6, right: 12, top: -6, bottom: 0 } },
    stroke: type === 'bar' ? { show: true, width: 2, colors: [P.surface] } : { curve: 'smooth', width: 2, lineCap: 'round' },
    fill: type === 'area' ? { type: 'gradient', gradient: { shadeIntensity: 0, opacityFrom: 0.26, opacityTo: 0.02, stops: [0, 100] } } : { opacity: 1 },
    plotOptions: {
      bar: {
        horizontal: isH,
        borderRadius: 4,
        borderRadiusApplication: 'end',
        borderRadiusWhenStacked: 'last',
        columnWidth: multi && !stacked ? '64%' : '52%',
        barHeight: spec.series.length > 1 && !stacked ? '72%' : '58%',
        distributed: Boolean(spec.distributed),
      },
    },
    dataLabels: { enabled: false },
    markers: { size: spec.kind === 'line' && spec.labels.length < 16 ? 3 : 0, strokeColors: P.surface, strokeWidth: 2, hover: { size: 5 } },
    legend: {
      show: multi && !spec.distributed,
      position: 'top',
      horizontalAlign: 'left',
      fontSize: '12px',
      labels: { colors: P.text },
      markers: { width: 10, height: 10, radius: 3 },
      itemMargin: { horizontal: 10, vertical: 2 },
      offsetY: 0,
    },
    tooltip: { theme: P.mode, shared: type !== 'bar' || stacked, intersect: false, y: { formatter: f }, x: { show: true, ...(xFmt ? { formatter: (v) => v } : {}) } },
    states: { hover: { filter: { type: 'darken', value: 0.92 } }, active: { filter: { type: 'none' } } },
    noData: { text: t('No data for this period'), style: { color: P.muted } },
  };
}

const Charts = {
  live: new Map(),
  specs: new Map(),
  register(id, spec) {
    this.specs.set(id, spec);
  },
  mountAll() {
    for (const [id, spec] of this.specs) this.mount(id, spec);
  },
  // Re-mount live charts (without animation) when the viewport width changes.
  lastW: 0,
  onResize: debounce(() => {
    const w = window.innerWidth;
    if (Math.abs(w - Charts.lastW) < 8) return;
    Charts.lastW = w;
    for (const [id, spec] of Charts.specs) if (Charts.live.has(id) && document.getElementById(id)?.clientWidth) Charts.mount(id, spec, { animate: false });
  }, 200),
  mount(id, spec, { animate = true } = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    this.lastW ||= window.innerWidth;
    if (this.live.has(id)) {
      try {
        this.live.get(id).destroy();
      } catch {
        /* ignore */
      }
      this.live.delete(id);
    }
    el.replaceChildren();
    if (specEmpty(spec)) {
      const box = document.createElement('div');
      box.className = 'empty-chart';
      box.textContent = t('No data for this period');
      el.appendChild(box);
      return;
    }
    if (!window.ApexCharts) {
      el.appendChild(svgElement(spec, el.clientWidth || 600, spec.height || 280, pal()));
      return;
    }
    const opts = apexOptions(spec, el.clientWidth);
    if (!animate) opts.chart.animations = { enabled: false };
    const c = new window.ApexCharts(el, opts);
    c.render();
    this.live.set(id, c);
  },
  destroyAll() {
    for (const c of this.live.values()) {
      try {
        c.destroy();
      } catch {
        /* ignore */
      }
    }
    this.live.clear();
    this.specs.clear();
  },
  toggleTable(id) {
    const el = document.getElementById(id);
    const tb = document.getElementById(`${id}-table`);
    if (!el || !tb) return;
    const showTable = tb.classList.contains('d-none');
    if (showTable) tb.replaceChildren(specTableElement(this.specs.get(id)));
    tb.classList.toggle('d-none', !showTable);
    el.classList.toggle('d-none', showTable);
    // The window may have been resized while the chart was hidden.
    if (!showTable && this.specs.has(id)) this.mount(id, this.specs.get(id), { animate: false });
  },
};

/** Table twin of a chart (accessible equivalent; also used by "Show as table"). Built with DOM APIs. */
function specTableElement(spec) {
  const wrap = document.createElement('div');
  if (!spec || specEmpty(spec)) {
    wrap.className = 'text-secondary small p-3';
    wrap.textContent = t('No data for this period');
    return wrap;
  }
  spec = displaySpec(spec);
  const f = valueFormatter(spec.fmt);
  wrap.className = 'table-responsive chart-table-inner';
  const table = document.createElement('table');
  table.className = 'table table-sm table-vcenter mb-0';
  const thead = table.createTHead().insertRow();
  thead.appendChild(document.createElement('th'));
  for (const s of spec.series) {
    const th = document.createElement('th');
    th.className = 'text-end';
    appendKids(th, [s.name]);
    thead.appendChild(th);
  }
  const tbody = table.createTBody();
  spec.labels.forEach((l, i) => {
    const tr = tbody.insertRow();
    appendKids(tr.insertCell(), [l]); // isolates Latin labels on RTL pages
    for (const s of spec.series) {
      const td = tr.insertCell();
      td.className = 'text-end tabular';
      td.textContent = f(s.data[i]);
    }
  });
  wrap.appendChild(table);
  return wrap;
}

/* ---------- Sparkline (inline SVG) -------------------------------------------------------- */
function sparkline(values, color, w = 96, ht = 28) {
  const v = values.map((x) => num(x, 2));
  const col = safeColor(color);
  const svg = h('svg', { class: 'spark', width: num(w), height: num(ht), viewBox: `0 0 ${num(w)} ${num(ht)}`, 'aria-hidden': 'true' });
  if (v.length < 2 || v.every((x) => x === 0)) return svg;
  const max = Math.max(...v, 1);
  const min = Math.min(...v, 0);
  const sx = (i) => num(2 + (i * (w - 4)) / (v.length - 1));
  const sy = (x) => num(ht - 3 - ((x - min) / (max - min || 1)) * (ht - 6));
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${sx(i)},${sy(x)}`).join('');
  const last = v.length - 1;
  svg.append(
    h('path', { d, fill: 'none', stroke: col, 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    h('circle', { cx: sx(last), cy: sy(v[last]), r: 2.5, fill: col }),
  );
  return svg;
}

/** Part-to-whole bar (≤ 6 segments) with legend; segments separated by 2px surface gaps. */
function segBar(segments, { height = 14, fmtV = (v) => fmt.num(v), showPct = true, P = pal() } = {}) {
  const total = sum(segments, (s) => s.value);
  if (!total) return h('div.text-secondary.small', t('No data for this period'));
  const bars = h('div.segbar');
  const legend = h('div.seg-legend');
  segments.forEach((s, i) => {
    const col = resolveColor(s.color, i, P);
    const v = num(s.value, 2);
    if (v > 0) bars.appendChild(h('div.seg', { style: { flex: String(v), background: col, height: `${num(height)}px` }, title: `${s.label}: ${fmtV(v)}` }));
    legend.appendChild(
      h('div.seg-legend-item', h('span.dot', { style: { background: col } }), h('span.lbl', s.label), h('span.val', fmtV(v), showPct ? h('span.text-secondary', ` · ${fmt.pct(v / total)}`) : null)),
    );
  });
  return frag(bars, legend);
}

/* ---------- SVG renderer (PDF / print) ---------------------------------------------------- */
/** Round axis scale: a "nice" step (1/2/2.5/5 × 10^n) so that 3–5 ticks cover the data. */
function niceScale(v, target = 4) {
  if (!(v > 0)) return { max: 1, step: 0.25, ticks: 4 };
  const raw = v / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  const ticks = Math.max(1, Math.ceil(v / step - 1e-9));
  return { max: step * ticks, step, ticks };
}
/** Builds the chart as an SVG element tree (no string-to-markup parsing). */
function svgElement(spec, W, H, P = LIGHT) {
  const NS = 'http://www.w3.org/2000/svg';
  const FONT = chartFont();
  const svg = document.createElementNS(NS, 'svg');
  const el = (tag, attrs, text) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, typeof v === 'number' ? String(num(v)) : String(v));
    if (text !== undefined) e.textContent = text;
    svg.appendChild(e);
    return e;
  };
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('direction', 'ltr'); // text-anchor must not flip inside RTL pages
  svg.setAttribute('width', String(num(W)));
  svg.setAttribute('height', String(num(H)));
  svg.setAttribute('viewBox', `0 0 ${num(W)} ${num(H)}`);
  svg.setAttribute('font-family', FONT);
  if (specEmpty(spec)) {
    el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', 'font-size': 13, fill: P.muted }, t('No data for this period'));
    return svg;
  }
  const isH = spec.kind === 'hbar' || spec.kind === 'hstacked';
  const stacked = spec.kind === 'stacked' || spec.kind === 'hstacked';
  const isLine = spec.kind === 'line' || spec.kind === 'area';
  spec = displaySpec(spec);
  const f = valueFormatter(spec.fmt);
  const series = spec.series.map((s, i) => ({ name: String(s.name), data: s.data.map((v) => num(v, 2)), col: spec.distributed ? null : resolveColor(s.color, i, P) }));
  const legend = series.length > 1 && !spec.distributed;
  const L = spec.labels.map(String);
  let maxV = 0;
  L.forEach((_, i) => {
    const vals = series.map((s) => s.data[i]);
    maxV = Math.max(maxV, stacked ? vals.reduce((a, b) => a + b, 0) : Math.max(...vals));
  });
  const { max: vmax, ticks } = niceScale(maxV);
  const top = legend ? 30 : 10;
  // Vertical charts: room for the widest tick label (e.g. "12,5 Mio. €").
  const tickW = Math.max(...Array.from({ length: ticks + 1 }, (_, k) => String(f((vmax * k) / ticks)).length)) * 6.2 + 12;
  const left = isH ? Math.min(240, Math.max(90, Math.max(...L.map((l) => l.length)) * 6.6 + 12)) : Math.max(40, Math.min(110, tickW));
  // Horizontal bars: room for the last tick label and the value label of the longest bar.
  const right = isH ? Math.max(18, String(f(vmax)).length * 3.2, String(f(maxV)).length * 6.2 + 10) : 18;
  const bottom = isH ? 24 : 30;
  const pw = W - left - right;
  const ph = H - top - bottom;
  if (legend) {
    let lx = left;
    for (const s of series) {
      el('rect', { x: lx, y: 6, width: 10, height: 10, rx: 3, fill: s.col });
      el('text', { x: lx + 15, y: 15, 'font-size': 12, fill: P.text }, s.name);
      lx += 30 + s.name.length * 6.6;
    }
  }
  for (let k = 0; k <= ticks; k++) {
    const v = (vmax * k) / ticks;
    if (isH) {
      const x = left + (pw * k) / ticks;
      el('line', { x1: x, y1: top, x2: x, y2: top + ph, stroke: P.grid, 'stroke-width': 1 });
      el('text', { x, y: H - 6, 'font-size': 11, fill: P.muted, 'text-anchor': 'middle' }, f(v));
    } else {
      const y = top + ph - (ph * k) / ticks;
      el('line', { x1: left, y1: y, x2: left + pw, y2: y, stroke: k === 0 ? P.axis : P.grid, 'stroke-width': 1 });
      el('text', { x: left - 8, y: y + 4, 'font-size': 11, fill: P.muted, 'text-anchor': 'end' }, f(v));
    }
  }
  const n = L.length;
  if (isH) {
    const band = ph / n;
    const bh = Math.min(26, band * 0.62);
    L.forEach((lab, i) => {
      const cy = top + band * i + band / 2;
      el('text', { x: left - 8, y: cy + 4, 'font-size': 12, fill: P.text, 'text-anchor': 'end' }, truncate(lab, 34));
      let x0 = left;
      const nb = stacked ? 1 : series.length;
      series.forEach((s, si) => {
        const v = s.data[i];
        const w = (v / vmax) * pw;
        const col = spec.distributed ? resolveColor(spec.colors[i], i, P) : s.col;
        const h = bh / nb;
        const y = stacked ? cy - bh / 2 : cy - bh / 2 + si * h;
        if (w > 0) el('rect', { x: x0, y: y + 1, width: Math.max(1, w - 1), height: Math.max(1, h - 2), rx: 3, fill: col });
        if (stacked) x0 += w;
        else if (series.length === 1 && w > 0) el('text', { x: x0 + w + 6, y: cy + 4, 'font-size': 11, fill: P.muted }, f(v));
      });
    });
  } else {
    const band = pw / n;
    const every = Math.ceil(n / Math.max(1, Math.floor(pw / 64)));
    L.forEach((lab, i) => {
      if (i % every === 0) el('text', { x: left + band * i + band / 2, y: H - 10, 'font-size': 11, fill: P.muted, 'text-anchor': 'middle' }, truncate(lab, 12));
    });
    if (isLine) {
      for (const s of series) {
        const pts = s.data.map((v, i) => [num(left + band * i + band / 2), num(top + ph - (v / vmax) * ph)]);
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('');
        if (spec.kind === 'area') el('path', { d: `${d}L${pts[pts.length - 1][0]},${num(top + ph)}L${pts[0][0]},${num(top + ph)}Z`, fill: s.col, 'fill-opacity': 0.14 });
        el('path', { d, fill: 'none', stroke: s.col, 'stroke-width': 2.25, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
        const lp = pts[pts.length - 1];
        el('circle', { cx: lp[0], cy: lp[1], r: 3.5, fill: s.col, stroke: P.surface, 'stroke-width': 2 });
      }
    } else {
      const gw = band * (series.length > 1 && !stacked ? 0.72 : 0.56);
      L.forEach((_, i) => {
        let y0 = top + ph;
        series.forEach((s, si) => {
          const v = s.data[i];
          const h = (v / vmax) * ph;
          const col = spec.distributed ? resolveColor(spec.colors[i], i, P) : s.col;
          const bw = stacked ? gw : gw / series.length;
          const x = left + band * i + (band - gw) / 2 + (stacked ? 0 : si * bw);
          if (h > 0) el('rect', { x: x + 1, y: y0 - h + (stacked ? 1 : 0), width: Math.max(1, bw - 2), height: Math.max(1, h - (stacked ? 2 : 0)), rx: 3, fill: col });
          if (stacked) y0 -= h;
        });
      });
    }
  }
  return svg;
}
