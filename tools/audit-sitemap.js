/**
 * Audits sitemap.xml against what is actually on disk.
 *
 * The existing file was produced by a third-party generator years ago and then
 * caught in a site-wide http -> https find/replace, which also rewrote the
 * sitemap XML namespace. The namespace is an identifier, not a URL to fetch, so
 * `https://www.sitemaps.org/schemas/sitemap/0.9` does not match the schema and
 * the whole document is invalid to a crawler.
 *
 *   node tools/audit-sitemap.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const XML = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');

const ns = (XML.match(/xmlns\s*=\s*"([^"]+)"/) || [])[1];
console.log(`  declared namespace : ${ns}`);
console.log(`  namespace valid    : ${ns === 'http://www.sitemaps.org/schemas/sitemap/0.9'}\n`);

const locs = [...XML.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
console.log(`  <loc> entries      : ${locs.length}`);

const hosts = new Map();
for (const l of locs) {
  const h = (l.match(/^https?:\/\/([^/]+)/) || [])[1] || '(relative)';
  hosts.set(h, (hosts.get(h) || 0) + 1);
}
for (const [h, n] of [...hosts].sort((a, b) => b[1] - a[1])) console.log(`      ${h}: ${n}`);

let missing = 0;
let present = 0;
const missingSample = [];
for (const l of locs) {
  let p = l.replace(/^https?:\/\/[^/]+/, '');
  p = decodeURIComponent(p.split(/[?#]/)[0]);
  if (p.endsWith('/') || p === '') p += 'index.htm';
  const abs = path.join(ROOT, p.replace(/^\//, '').replace(/\//g, path.sep));
  if (fs.existsSync(abs)) present++;
  else { missing++; if (missingSample.length < 15) missingSample.push(l); }
}
console.log(`\n  resolve to a file  : ${present}`);
console.log(`  missing            : ${missing}`);
missingSample.forEach((m) => console.log(`      ${m}`));

// How much of the live site is actually covered?
const SKIP = new Set(['1cnf', '1pvt', '.git', 'node_modules', 'tools', 'you_old', 'old', '_data', '!template']);
const onDisk = [];
(function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); continue; }
    if (/\.html?$/i.test(e.name)) onDisk.push('/' + path.relative(ROOT, p).replace(/\\/g, '/'));
  }
})(ROOT);
console.log(`\n  publishable pages on disk : ${onDisk.length}`);
const inMap = new Set(locs.map((l) => decodeURIComponent(l.replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0])));
const uncovered = onDisk.filter((p) => !inMap.has(p) && !inMap.has(p.replace(/index\.html?$/i, '')));
console.log(`  not in the sitemap        : ${uncovered.length}`);
