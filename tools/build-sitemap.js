/**
 * Regenerates sitemap.xml from what is actually on disk.
 *
 * The previous file was produced by a third-party web generator years ago. Two
 * things were wrong with it:
 *
 *  - Its XML namespace had been rewritten to `https://www.sitemaps.org/...` by
 *    the same site-wide http -> https find/replace that touched the XHTML
 *    doctypes. A namespace is an identifier, not a URL to fetch, so this one no
 *    longer matches the sitemap schema and crawlers reject the document.
 *  - It listed 1,737 of 9,579 publishable pages, so 82% of the archive was
 *    invisible to search engines.
 *
 *   node tools/build-sitemap.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://www.davidconger.com';
const dryRun = process.argv.includes('--dry-run');

/** Trees that are superseded, internal, or tooling rather than published pages. */
const SKIP_DIRS = new Set([
  '1cnf', '1pvt', '.git', 'node_modules', 'tools',
  'you_old',      // superseded copy of the /you/ section
  'old',          // galleries/old/ and friends
  '_data',        // the retired generator's source data
  '!template',    // page templates, not content
  'template',     // galleries/0000/00/template, still full of {0} placeholders
  'test', 'test2', // leftover galleries from testing the retired generator
  'proofs',       // client proof sheets, not meant for search results
]);

/**
 * Paths that are never published:
 *   - galleries/0000/ is the retired generator's placeholder year
 *   - you/2023/Old/ is a superseded copy of 19 events, unreachable by navigation
 */
const SKIP_PATHS = [/^galleries\/0000\//i, /^you\/\d{4}\/old\//i];

const pages = [];
(function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); continue; }
    if (!/\.html?$/i.test(e.name)) continue;
    pages.push(p);
  }
})(ROOT);

const urls = [];
const skipped = { fragment: 0, noindex: 0, excluded: 0 };

for (const file of pages) {
  const relRaw = path.relative(ROOT, file).replace(/\\/g, '/');
  if (SKIP_PATHS.some((re) => re.test(relRaw))) { skipped.excluded++; continue; }

  const text = fs.readFileSync(file, 'utf8');

  // Fragments (catalog/*/list.htm and similar) are injected into other pages
  // and are not addressable content.
  if (!/<html[\s>]/i.test(text) || !/<head[\s>]/i.test(text)) { skipped.fragment++; continue; }
  if (/<meta[^>]+name\s*=\s*["']robots["'][^>]*noindex/i.test(text)) { skipped.noindex++; continue; }

  let rel = path.relative(ROOT, file).replace(/\\/g, '/');
  // A directory's index page is canonically the directory itself; that is the
  // form the site's own navigation links to.
  rel = rel.replace(/(^|\/)index\.html?$/i, '$1');

  const loc = ORIGIN + '/' + rel.split('/').map(encodeURIComponent).join('/');
  urls.push({ loc, lastmod: fs.statSync(file).mtime.toISOString().slice(0, 10) });
}

urls.sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));

const body = urls
  .map((u) => `  <url>\n    <loc>${u.loc.replace(/&/g, '&amp;')}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n  </url>`)
  .join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;

console.log(`  pages found        : ${pages.length}`);
console.log(`  skipped, fragment  : ${skipped.fragment}`);
console.log(`  skipped, noindex   : ${skipped.noindex}`);
console.log(`  skipped, excluded  : ${skipped.excluded}`);
console.log(`  URLs written       : ${urls.length}`);
console.log(`  size               : ${(Buffer.byteLength(xml) / 1048576).toFixed(2)} MB`);

if (urls.length > 50000) console.log('  WARNING: over the 50,000-URL limit; split into a sitemap index.');
if (Buffer.byteLength(xml) > 50 * 1048576) console.log('  WARNING: over the 50 MB uncompressed limit.');

if (dryRun) { console.log('\n  Dry run; nothing written.'); process.exit(0); }
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml, 'utf8');
console.log('\n  wrote sitemap.xml');
