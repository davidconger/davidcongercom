#!/usr/bin/env node
'use strict';

/*
 * add-gallery-year-crumb.js
 *
 * The generated gallery pages carry a year link next to the home icon in the top
 * bar, so a visitor who lands on one from a search result can walk up to that
 * year's stream. The 747 pages that were migrated out of the flat galleries/
 * root never had one, because the flat layout had no year to link to.
 *
 * Now that they live under galleries/YYYY/MM/slug/ they do, so this adds the same
 * crumb in the same place. The seven 2008 pages point at the gallery index
 * instead, because 2008 has no year stream.
 *
 * Idempotent. Run with --dry to report without writing.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');

const HOME_LINK = /(<a class="socialLink socialHome"[^>]*>[\s\S]*?<\/a>)(\s*)(<\/div>)/;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (/^index\.htm$/i.test(entry.name)) out.push(abs);
  }
  return out;
}

const stats = { year: 0, index: 0, skipped: 0, noAnchor: [] };

for (const abs of walk(path.join(ROOT, 'galleries'), [])) {
  const rel = path.relative(ROOT, path.dirname(abs)).replace(/\\/g, '/');
  const m = /^galleries\/(\d{4})\/\d{2}\/[^/]+$/.exec(rel);
  if (!m) continue;

  const year = m[1];
  const html = fs.readFileSync(abs, 'utf8');
  if (html.includes('class="crumbYear"')) { stats.skipped++; continue; }

  const hasYearStream = fs.existsSync(path.join(ROOT, 'galleries', year, 'index.htm'));
  const crumb = hasYearStream
    ? '<a class="crumbYear" href="../../" title="All ' + year + ' galleries">' + year + '</a>'
    : '<a class="crumbYear" href="../../../" title="All galleries">Galleries</a>';

  if (!HOME_LINK.test(html)) { stats.noAnchor.push(rel); continue; }

  const next = html.replace(HOME_LINK, (all, home, gap, close) =>
    home + gap + crumb + gap + close);

  if (!DRY) fs.writeFileSync(abs, next, 'utf8');
  if (hasYearStream) stats.year++; else stats.index++;
}

console.log((DRY ? '[dry run] ' : '') + 'year crumbs added   : ' + stats.year);
console.log((DRY ? '[dry run] ' : '') + 'gallery crumbs added: ' + stats.index + ' (years with no stream)');
console.log('already had one     : ' + stats.skipped);
console.log('no home anchor found: ' + stats.noAnchor.length);
stats.noAnchor.slice(0, 10).forEach(s => console.log('   ' + s));
