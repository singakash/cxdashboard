#!/usr/bin/env node
/**
 * Build script — produces a single self-contained file:
 *   node build.mjs                 → dist/cxone-dashboard.mjs          (UI libraries fetched from CDN on first run, then cached)
 *   node build.mjs --embed-vendor  → dist/cxone-dashboard-offline.mjs  (UI libraries embedded; no internet needed except Checkmarx One)
 *
 * The server imports assemble() in development mode (node src/server.mjs) so edits under src/web
 * are picked up on every page load.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(ROOT, 'src', 'web');
const JS_ORDER = ['util', 'i18n', 'charts', 'metrics', 'demo', 'views', 'export', 'app'];
const FONTS = [
  ['DMSans-Regular.ttf', 400],
  ['DMSans-Medium.ttf', 500],
  ['DMSans-Bold.ttf', 700],
];
const BRAND = { logoViolet: 'logo-violet.svg', logoWhite: 'logo-white.svg', symbol: 'symbol-violet.svg', elementDark: 'element-dark.svg', elementLight: 'element-light.svg' };
const VENDOR = {
  'tabler.min.css': 'npm/@tabler/core@1.0.0/dist/css/tabler.min.css',
  'tabler.rtl.min.css': 'npm/@tabler/core@1.0.0/dist/css/tabler.rtl.min.css',
  'apexcharts.min.js': 'npm/apexcharts@3.54.1/dist/apexcharts.min.js',
  'pptxgen.bundle.js': 'npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
  'jspdf.umd.min.js': 'npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
  'html2canvas.min.js': 'npm/html2canvas@1.4.1/dist/html2canvas.min.js',
};
const MIRRORS = ['https://cdn.jsdelivr.net/', 'https://unpkg.com/'];

const read = (p) => readFile(path.join(WEB, p));
const dataUri = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;
/** Text inlined into <script>/<style> must not be able to close the element early. */
const scriptSafe = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const styleSafe = (s) => s.replace(/<\/(style)/gi, '<\\/$1');

export async function assemble() {
  const tpl = String(await read('index.html'));
  const css = String(await read('styles.css'));
  const fontCss = (
    await Promise.all(FONTS.map(async ([file, weight]) => `@font-face{font-family:'DM Sans';font-style:normal;font-weight:${weight};font-display:swap;src:url(${dataUri('font/ttf', await read(`assets/fonts/${file}`))}) format('truetype')}`))
  ).join('\n');
  const assets = {};
  for (const [key, file] of Object.entries(BRAND)) assets[key] = dataUri('image/svg+xml', await read(`assets/brand/${file}`));
  const assetsJs = `const ASSETS = Object.freeze(${JSON.stringify(assets)});`;
  const parts = [];
  for (const name of JS_ORDER) parts.push(`/* ---- ${name}.js ---- */\n${String(await read(`js/${name}.js`))}`);
  const js = `(() => {\n'use strict';\n${parts.join('\n')}\n})();`;

  const html = tpl
    .replace('{{FAVICON}}', () => assets.symbol)
    .replace('{{FONTS}}', () => styleSafe(fontCss))
    .replace('{{STYLE}}', () => styleSafe(css))
    .replace('{{ASSETS}}', () => scriptSafe(assetsJs))
    .replace('{{SCRIPTS}}', () => scriptSafe(js));
  const boots = html.split('__CXD_BOOT__').length - 1;
  if (boots !== 1) throw new Error(`index.html must contain __CXD_BOOT__ exactly once (found ${boots}).`);
  for (const m of ['{{FAVICON}}', '{{FONTS}}', '{{STYLE}}', '{{ASSETS}}', '{{SCRIPTS}}']) if (html.includes(m)) throw new Error(`Unreplaced marker ${m}`);
  return html;
}

async function fetchVendor(rel) {
  for (const mirror of MIRRORS) {
    try {
      const r = await fetch(mirror + rel, { signal: AbortSignal.timeout(60_000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch {
      /* next mirror */
    }
  }
  throw new Error(`Could not download ${rel}`);
}

async function main() {
  const embedVendor = process.argv.includes('--embed-vendor');
  const html = await assemble();
  let server = String(await readFile(path.join(ROOT, 'src', 'server.mjs')));
  const HTML_MARK = '/*__EMBED_HTML__*/ null';
  const VENDOR_MARK = '/*__EMBED_VENDOR__*/ null';
  if (!server.includes(HTML_MARK) || !server.includes(VENDOR_MARK)) throw new Error('Embed markers not found in src/server.mjs');
  server = server.replace(HTML_MARK, () => JSON.stringify(html));
  if (embedVendor) {
    const vendor = {};
    for (const [name, rel] of Object.entries(VENDOR)) {
      process.stdout.write(`  embedding ${name}… `);
      const buf = await fetchVendor(rel);
      vendor[name] = zlib.gzipSync(buf, { level: 9 }).toString('base64');
      console.log(`${(buf.length / 1024).toFixed(0)} KB`);
    }
    server = server.replace(VENDOR_MARK, () => JSON.stringify(vendor));
  }
  await mkdir(path.join(ROOT, 'dist'), { recursive: true });
  const out = path.join(ROOT, 'dist', embedVendor ? 'cxone-dashboard-offline.mjs' : 'cxone-dashboard.mjs');
  await writeFile(out, server);
  console.log(`✓ Built ${path.relative(ROOT, out)} (${(Buffer.byteLength(server) / 1024).toFixed(0)} KB)`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
