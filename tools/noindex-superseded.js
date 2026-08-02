/**
 * Marks superseded copies of live pages "noindex".
 *
 * you/<year>/Old/ holds a second copy of nineteen events that are also
 * published at their proper path. Nothing links to it, and build-sitemap.js
 * leaves it out, but a copy that is merely absent from the sitemap is still
 * indexable the moment anything points at it -- and 637 pages carrying the same
 * titles, the same photographs and the same descriptions as the live events is
 * exactly the duplication a search engine penalises. Before this, those copies
 * accounted for 456 of the site's 476 colliding titles.
 *
 * The URLs keep working. "noindex, follow" only says do not list this page,
 * while still crediting the links it carries, so nothing that already points
 * here breaks.
 *
 *   node tools/noindex-superseded.js [--dry]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dry = process.argv.includes('--dry');

/** Superseded copies: same content, published elsewhere under its own URL. */
const SUPERSEDED = [/^you\/\d{4}\/old\//i];

const TAG = '<meta name="robots" content="noindex, follow">';

const files = [];
(function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (/\.html?$/i.test(entry.name)) files.push(full);
  }
})(path.join(ROOT, 'you'));

let changed = 0;
let already = 0;
const failed = [];

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (!SUPERSEDED.some((re) => re.test(rel))) continue;

  const html = fs.readFileSync(file, 'utf8');
  if (/<meta[^>]+name\s*=\s*["']robots["'][^>]*noindex/i.test(html)) { already++; continue; }

  // Straight after the charset, so it is read before anything that could
  // delay the head.
  const out = html.replace(/(<meta charset="utf-8">)/i, `$1\r\n${TAG}`);
  if (out === html) { failed.push(rel); continue; }

  changed++;
  if (!dry) fs.writeFileSync(file, out);
}

console.log(`  superseded pages   : ${changed + already + failed.length}`);
console.log(`  marked noindex     : ${changed}${dry ? ' (dry run, nothing written)' : ''}`);
console.log(`  already marked     : ${already}`);
console.log(`  no charset to anchor: ${failed.length}`);
for (const f of failed.slice(0, 10)) console.log(`      ${f}`);
