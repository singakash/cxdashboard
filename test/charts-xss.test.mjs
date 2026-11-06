/**
 * Regression test: dataset-derived strings (category labels, series names) that reach the ApexCharts
 * tooltip must be HTML-escaped, because ApexCharts renders the tooltip with innerHTML.
 *
 *   node --test test/charts-xss.test.mjs
 *
 * The real src/web/js/charts.js (and the real `esc` from util.js) are evaluated in a vm sandbox with
 * minimal stubs for the browser globals they use.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const WEB_JS = new URL('../src/web/js/', import.meta.url);
const read = (f) => readFileSync(new URL(f, WEB_JS), 'utf8');

// Take the real `esc` definition from util.js (the rest of util.js needs a full DOM).
const escSrc = /^const esc = .*$/m.exec(read('util.js'))?.[0];
assert.ok(escSrc, 'esc() must be defined in util.js');

function loadApexOptions() {
  const sandbox = {
    Store: { s: { theme: 'light' } },
    fxRate: () => 1,
    fmt: { cur: String, money: String, pct: String, daysShort: String, hours: String, compact: String },
    isRtl: () => false,
    t: (s) => s,
    debounce: (fn) => fn,
    appendKids: () => {},
    window: {},
    document: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(`${escSrc}\n${read('charts.js')}\n;globalThis.__apexOptions = apexOptions;`, sandbox);
  return sandbox.__apexOptions;
}

const PAYLOAD = '<img src=x onerror=alert(1)>';
const ESCAPED = '&lt;img src=x onerror=alert(1)&gt;';

const baseSpec = (kind) => ({
  kind,
  fmt: 'num',
  labels: ['Jan', PAYLOAD],
  series: [
    { name: PAYLOAD, data: [1, 2] },
    { name: 'Other', data: [3, 4] },
  ],
});

for (const kind of ['bar', 'stacked', 'line', 'area', 'hbar', 'hstacked']) {
  test(`tooltip series name is HTML-escaped (${kind})`, () => {
    const opts = loadApexOptions()(baseSpec(kind));
    const out = opts.tooltip.y.title.formatter(PAYLOAD);
    assert.equal(out, ESCAPED);
    assert.ok(!out.includes('<'));
  });

  test(`tooltip category header is HTML-escaped (${kind})`, () => {
    const opts = loadApexOptions()(baseSpec(kind));
    const out = opts.tooltip.x.formatter(PAYLOAD);
    assert.equal(out, ESCAPED);
    assert.ok(!out.includes('<'));
  });
}

test('quotes and ampersands are escaped; benign text is unchanged', () => {
  const opts = loadApexOptions()(baseSpec('bar'));
  assert.equal(opts.tooltip.x.formatter('"a" & \'b\''), '&quot;a&quot; &amp; &#39;b&#39;');
  assert.equal(opts.tooltip.y.title.formatter('Critical'), 'Critical');
  assert.equal(opts.tooltip.x.formatter('Jan'), 'Jan');
});
