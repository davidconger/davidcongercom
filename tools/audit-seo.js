/**
 * Reports search-engine-facing metadata coverage across the site.
 *
 *   node tools/audit-seo.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['1cnf', '1pvt', '.git', 'node_modules', 'tools', 'you_old', 'old', '_data', '!template', 'proofs']);

const stats = { pages: 0, title: 0, emptyTitle: 0, description: 0, canonical: 0, og: 0, h1: 0 };
const dupTitles = new Map();
const noTitle = [];

(function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); continue; }
    if (!/\.html?$/i.test(e.name)) continue;
    const text = fs.readFileSync(p, 'utf8');
    if (!/<head[\s>]/i.test(text)) continue;
    stats.pages++;
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');

    const t = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    if (t === undefined) noTitle.push(rel);
    else if (!t.trim()) { stats.emptyTitle++; noTitle.push(rel); }
    else {
      stats.title++;
      const key = t.trim().replace(/\s+/g, ' ');
      if (!dupTitles.has(key)) dupTitles.set(key, 0);
      dupTitles.set(key, dupTitles.get(key) + 1);
    }

    if (/<meta[^>]+name\s*=\s*["']description["']/i.test(text)) stats.description++;
    if (/<link[^>]+rel\s*=\s*["']canonical["']/i.test(text)) stats.canonical++;
    if (/<meta[^>]+property\s*=\s*["']og:/i.test(text)) stats.og++;
    if (/<h1[\s>]/i.test(text)) stats.h1++;
  }
})(ROOT);

const pct = (n) => `${n} (${((n / stats.pages) * 100).toFixed(1)}%)`;
console.log(`  publishable pages     : ${stats.pages}`);
console.log(`  with a <title>        : ${pct(stats.title)}`);
console.log(`  with a description    : ${pct(stats.description)}`);
console.log(`  with a canonical link : ${pct(stats.canonical)}`);
console.log(`  with OpenGraph tags   : ${pct(stats.og)}`);
console.log(`  with an <h1>          : ${pct(stats.h1)}`);

if (noTitle.length) {
  console.log(`\n  missing or empty <title>: ${noTitle.length}`);
  noTitle.slice(0, 10).forEach((f) => console.log(`      ${f}`));
}

const dups = [...dupTitles].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
const dupPages = dups.reduce((n, [, c]) => n + c, 0);
console.log(`\n  duplicate <title> values : ${dups.length}`);
console.log(`  pages sharing a title    : ${dupPages} (${((dupPages / stats.pages) * 100).toFixed(1)}%)`);
console.log(`  worst collision          : ${dups.length ? dups[0][1] : 0} pages`);
dups.slice(0, 10).forEach(([t, n]) => console.log(`      ${n} x  "${t.slice(0, 70)}"`));
