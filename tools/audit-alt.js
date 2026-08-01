/**
 * Reports <img> elements that have no alt attribute, grouped by image, so that
 * accessibility gaps are visible as a count per asset rather than a wall of
 * individual pages.
 *
 *   node tools/audit-alt.js [root]
 */
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || '.';
const SKIP = new Set(['.git', 'node_modules', 'tools', 'davidconger_backup']);

const missing = new Map();
let pages = 0;
let imgs = 0;

(function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(p);
      continue;
    }
    if (!/\.html?$/i.test(e.name)) continue;
    pages++;
    const html = fs.readFileSync(p, 'utf8');
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      imgs++;
      if (/\balt\s*=/i.test(m[0])) continue;
      const src = (m[0].match(/src=["']([^"']*)["']/i) || [, '(no src)'])[1];
      // Collapse the numbered photo filenames so the report stays readable.
      const key = src.replace(/[^/]+$/, (f) => f.replace(/\d+/g, 'N'));
      if (!missing.has(key)) missing.set(key, { count: 0, sample: p });
      missing.get(key).count++;
    }
  }
})(root);

const rows = [...missing.entries()].sort((a, b) => b[1].count - a[1].count);
const totalMissing = rows.reduce((n, [, v]) => n + v.count, 0);

console.log(`  pages ${pages}  images ${imgs}  missing alt ${totalMissing}`);
for (const [key, v] of rows.slice(0, 20)) {
  console.log(`  ${String(v.count).padStart(6)}  ${key}`);
  console.log(`          e.g. ${path.relative(root, v.sample).replace(/\\/g, '/')}`);
}
if (rows.length > 20) console.log(`  ... and ${rows.length - 20} more`);
