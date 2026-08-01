/**
 * Audits breadcrumb links whose visible text names a specific destination, and
 * reports the ones that resolve somewhere else.
 *
 * Relative paths on this site were hand-maintained for years, and a link with
 * one too many or too few "../" segments still resolves to a real page, so
 * check-links.js reports it as healthy. Only comparing the link text against
 * the resolved target finds these.
 *
 *   node tools/audit-breadcrumbs.js [root]
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '.');
const SKIP = new Set(['.git', 'node_modules', 'tools', 'davidconger_backup']);

/** Link text -> the site-root-relative page it is supposed to open. */
const EXPECTED = {
  'home': 'index.htm',
  'photos of you': 'you/index.htm',
  'concert & event photos': 'catalog/index.htm',
  'concert and event photos': 'catalog/index.htm',
};

/** Resolves an href the way a browser does, clamping excess "../" at the root. */
function resolveHref(pageRel, href) {
  const base = path.posix.dirname(pageRel.replace(/\\/g, '/'));
  const segs = (base === '.' ? [] : base.split('/')).concat(href.split('/'));
  const out = [];
  for (const s of segs) {
    if (s === '' || s === '.') continue;
    if (s === '..') out.pop();
    else out.push(s);
  }
  return out.join('/');
}

const problems = new Map();
let checked = 0;

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

    const pageRel = path.relative(root, p).replace(/\\/g, '/');
    const html = fs.readFileSync(p, 'utf8');

    for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const [, href, rawText] = m;
      if (/^(?:[a-z]+:|\/\/|#)/i.test(href)) continue;

      const text = rawText
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

      const want = EXPECTED[text];
      if (!want) continue;

      checked++;
      const got = resolveHref(pageRel, href.split(/[?#]/)[0]);
      if (got === want) continue;

      const key = `${text} -> ${got}  (expected ${want})`;
      if (!problems.has(key)) problems.set(key, { count: 0, sample: pageRel, href });
      problems.get(key).count++;
    }
  }
})(root);

const rows = [...problems.entries()].sort((a, b) => b[1].count - a[1].count);
const total = rows.reduce((n, [, v]) => n + v.count, 0);

console.log(`  breadcrumb links checked: ${checked}`);
console.log(`  pointing at the wrong page: ${total}\n`);
for (const [key, v] of rows) {
  console.log(`  ${String(v.count).padStart(6)}  ${key}`);
  console.log(`          href="${v.href}"  e.g. ${v.sample}`);
}
