/**
 * Measures the risk introduced by hoisting catalog.css's generic `.style1` /
 * `.style2` rules into the site-wide stylesheet.
 *
 * catalog.css used to load on 195 pages. site.css loads on all 9,598. Any page
 * that uses class="style1" but does NOT carry its own inline override is now
 * picking up catalog's `letter-spacing: 3px`, which it never had before.
 *
 *   node tools/audit-style-classes.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['tools', '.git', 'node_modules']);
const CLASSES = ['style1', 'style2', 'style3', 'style4', 'auto-style1', 'auto-style2'];

const rows = [];

(function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); continue; }
    if (!/\.html?$/i.test(e.name)) continue;
    const text = fs.readFileSync(p, 'utf8');
    const styleBlock = (text.match(/<style[^>]*>([\s\S]*?)<\/style>/i) || [])[1] || '';
    const used = new Set();
    for (const m of text.matchAll(/\bclass\s*=\s*["']([^"']+)["']/gi)) {
      for (const c of m[1].trim().split(/\s+/)) if (CLASSES.includes(c)) used.add(c);
    }
    if (!used.size) continue;
    const declared = new Set();
    for (const c of used) if (new RegExp('\\.' + c + '\\s*\\{').test(styleBlock)) declared.add(c);
    rows.push({
      rel: path.relative(ROOT, p).replace(/\\/g, '/'),
      used: [...used],
      undeclared: [...used].filter((c) => !declared.has(c)),
    });
  }
})(ROOT);

const exposed = rows.filter((r) => r.undeclared.length);
console.log(`  pages using a generic styleN class        : ${rows.length}`);
console.log(`  ...with no local definition (now inherit) : ${exposed.length}\n`);

const byClass = new Map();
for (const r of exposed) for (const c of r.undeclared) {
  if (!byClass.has(c)) byClass.set(c, []);
  byClass.get(c).push(r.rel);
}
for (const [c, list] of [...byClass].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  .${c}: ${list.length} page(s)`);
  list.slice(0, 6).forEach((f) => console.log(`      ${f}`));
}
