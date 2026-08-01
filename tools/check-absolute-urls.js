/**
 * Finds absolute davidconger.com URLs and separates the ones that would move a
 * visitor off a secondary domain from the ones that are supposed to be absolute.
 *
 * Navigational and resource references -- href, src, action, url() -- must be
 * relative, or a visitor arriving on the alternate domain is thrown back to the
 * primary one the moment they click anything.
 *
 * Metadata is the opposite: rel=canonical, og:url, og:image and sitemap entries
 * are defined to be absolute, and pointing them at the primary domain is how
 * you tell a search engine which host is canonical. Those are reported
 * separately and should be left alone.
 *
 * Usage:
 *   node tools/check-absolute-urls.js            report only
 *   node tools/check-absolute-urls.js --all      report every occurrence
 *   node tools/check-absolute-urls.js --fix      rewrite the navigational ones
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHOW_ALL = process.argv.includes('--all');
const FIX = process.argv.includes('--fix');
const HOST = /(?:https?:)?\/\/(?:www\.)?davidconger\.com/i;

const SKIP_DIRS = new Set(['.git', 'node_modules', '_backup', 'images']);
const EXTS = /\.(html?|css|js|json|xml|txt|webmanifest)$/i;

const navigational = [];
const metadata = [];
const other = [];

function classify(file, lineNo, line) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const trimmed = line.trim().slice(0, 200);
  const low = line.toLowerCase();

  const isMeta = /rel\s*=\s*["']?canonical/.test(low)
    || /og:url|og:image|og:video|twitter:image|twitter:url/.test(low)
    // The old store pages carry "Xog:Ximage" tags -- deliberately broken
    // property names, left in place rather than deleted. A browser never
    // follows them, so they cannot bounce anyone.
    || /x(?:og|twitter):x/.test(low)
    || /<loc>|"@context"|schema\.org/.test(low)
    || /^sitemap:/.test(low.trim());

  // href/src/action/url() are what a browser actually follows.
  const isNav = /(?:href|src|srcset|action|content)\s*=\s*["'][^"']*davidconger\.com/i.test(line)
    || /url\(\s*["']?[^)"']*davidconger\.com/i.test(line);

  const entry = { file: rel, line: lineNo, text: trimmed };
  if (isMeta) metadata.push(entry);
  else if (isNav) navigational.push(entry);
  else other.push(entry);
}

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
      walk(full);
    } else if (EXTS.test(e.name)) {
      let text;
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (!HOST.test(text)) continue;
      text.split(/\r?\n/).forEach((line, i) => {
        if (HOST.test(line)) classify(full, i + 1, line);
      });
    }
  }
}

walk(ROOT);

/* Only <a>, <img>, <script>, <iframe>, <form> and <source> are rewritten, and
   only when the target actually exists on disk.

   Matching on the attribute name alone is not enough, which cost a round trip:
   rel=canonical also uses href, so an href-wide rewrite quietly turned every
   canonical tag into a relative path and destroyed the one thing that tells a
   search engine which host is authoritative. <link> and <meta> are therefore
   excluded by tag, not by attribute. The handful of "Xog:Ximage" tags in the
   old store pages are deliberately disabled rather than live, and are likewise
   left alone. */
const NAV_TAGS = /<(a|img|script|iframe|form|source)\b[^>]*>/gi;

function toRelative(file, url) {
  const m = /^(?:https?:)?\/\/(?:www\.)?davidconger\.com(\/[^"'\s>]*)?$/i.exec(url);
  if (!m) return null;
  const target = path.join(ROOT, (m[1] || '/').replace(/\//g, path.sep));
  const probe = /\.[a-z0-9]+$/i.test(m[1] || '') ? target : path.join(target, 'index.htm');
  if (!fs.existsSync(probe)) return null;
  let rel = path.relative(path.dirname(file), probe).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

if (FIX) {
  const touched = new Set();
  let changes = 0;
  for (const file of new Set(navigational.map((e) => e.file))) {
    const full = path.join(ROOT, file);
    const before = fs.readFileSync(full, 'utf8');
    const after = before.replace(NAV_TAGS, (tag) => tag.replace(
      /\b(href|src|action)(\s*=\s*)(["'])((?:https?:)?\/\/(?:www\.)?davidconger\.com[^"']*)\3/gi,
      (whole, attr, eq, q, url) => {
        const rel = toRelative(full, url);
        if (!rel) return whole;
        changes++;
        return `${attr}${eq}${q}${rel}${q}`;
      }));
    if (after !== before) { fs.writeFileSync(full, after, 'utf8'); touched.add(file); }
  }
  console.log(`\nrewrote ${changes} reference(s) across ${touched.size} file(s)`);
  for (const f of [...touched].sort()) console.log(`  ${f}`);
  process.exit(0);
}

function report(title, list, note) {
  console.log(`\n=== ${title}: ${list.length} reference(s)`);
  if (note) console.log(`    ${note}`);
  const byFile = new Map();
  for (const e of list) {
    if (!byFile.has(e.file)) byFile.set(e.file, []);
    byFile.get(e.file).push(e);
  }
  const files = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);
  const shown = SHOW_ALL ? files : files.slice(0, 25);
  for (const [file, entries] of shown) {
    console.log(`  ${file}  (${entries.length})`);
    for (const e of (SHOW_ALL ? entries : entries.slice(0, 2))) console.log(`      ${e.line}: ${e.text}`);
  }
  if (files.length > shown.length) console.log(`  ... and ${files.length - shown.length} more file(s)`);
}

report('WOULD BOUNCE -- navigational or resource', navigational,
  'These send a visitor on the alternate domain back to the primary one.');
report('CORRECT AS ABSOLUTE -- metadata', metadata,
  'canonical / og / sitemap are defined to be absolute. Leave these.');
report('OTHER -- text or unclassified', other,
  'Usually prose, an email address, or a comment. Check before changing.');

console.log(`\nnavigational=${navigational.length} metadata=${metadata.length} other=${other.length}`);
process.exitCode = navigational.length ? 1 : 0;
