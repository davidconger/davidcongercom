/**
 * Marks pages that should not be listed by a search engine.
 *
 * Two kinds of page qualify:
 *
 *   - Superseded copies. you/<year>/Old/ holds a second copy of nineteen events
 *     that are also published at their proper path. Nothing links to it, and
 *     build-sitemap.js leaves it out, but a copy that is merely absent from the
 *     sitemap is still indexable the moment anything points at it -- and 637
 *     pages carrying the same titles, the same photographs and the same
 *     descriptions as the live events is exactly the duplication a search
 *     engine penalises. Before this, those copies accounted for 456 of the
 *     site's 476 colliding titles.
 *
 *   - Templates and abandoned drafts. A file whose name begins with "!" is a
 *     blank the generators copy from, and galleries/index_old.htm is the
 *     gallery list the year stream replaced. Neither is a page anybody should
 *     arrive at. build-sitemap.js skips !template *directories* but not a
 *     stray template file sitting beside real pages, and it drops anything
 *     carrying this tag -- so marking them is enough to keep them out.
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
const SUPERSEDED = [
  /^you\/\d{4}\/old\//i,
  /(^|\/)!/,
  /(^|\/)0000(\/|$)/,
  /^galleries\/index_old\.htm$/i,
];

const TAG = '<meta name="robots" content="noindex, follow">';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'tools', '_proto', 'you_old', '1cnf', '1pvt', 'davidconger_backup']);

const files = [];
(function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (/\.html?$/i.test(entry.name)) files.push(full);
  }
})(ROOT);

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
  console.log(`      + ${rel}`);
  if (!dry) fs.writeFileSync(file, out);
}

console.log(`  superseded pages   : ${changed + already + failed.length}`);
console.log(`  marked noindex     : ${changed}${dry ? ' (dry run, nothing written)' : ''}`);
console.log(`  already marked     : ${already}`);
console.log(`  no charset to anchor: ${failed.length}`);
for (const f of failed.slice(0, 10)) console.log(`      ${f}`);
