/**
 * Inbound-reference check for trees proposed for deletion.
 *
 * Answers: does any page OUTSIDE a doomed tree link INTO it? If nothing does,
 * the tree is unreachable by navigation and safe to remove.
 */
const fs = require('fs');
const path = require('path');

const siteRoot = path.resolve(process.argv[2]);
const targets = process.argv.slice(3);
if (!targets.length) {
  console.error('usage: node check-inbound.js <siteRoot> <tree> [tree...]');
  process.exit(1);
}

const SKIP_DIRS = new Set(['1cnf', '1pvt', '.git', 'node_modules', 'tools']);
const pages = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name));
    } else if (/\.html?$/i.test(e.name)) {
      pages.push(path.join(dir, e.name));
    }
  }
})(siteRoot);

const REF_RE = /(?:href|src|data-original)\s*=\s*["']([^"']+)["']/gi;
const isExternal = (u) => /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//') || u.startsWith('#') || !u.trim();

const results = Object.fromEntries(targets.map((t) => [t, []]));

for (const page of pages) {
  const pageRel = path.relative(siteRoot, page).replace(/\\/g, '/');
  const html = fs.readFileSync(page, 'utf8');
  const baseSegs = path.relative(siteRoot, path.dirname(page)).replace(/\\/g, '/').split('/').filter(Boolean);

  for (const m of html.matchAll(REF_RE)) {
    let ref = m[1].trim();
    if (isExternal(ref)) continue;
    ref = ref.split('#')[0].split('?')[0];
    if (!ref) continue;

    const out = ref.startsWith('/') ? [] : [...baseSegs];
    for (const seg of ref.replace(/^\//, '').split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') out.pop();
      else out.push(seg);
    }
    const resolved = out.join('/');

    for (const t of targets) {
      const inTarget = resolved.toLowerCase().startsWith(t.toLowerCase() + '/') || resolved.toLowerCase() === t.toLowerCase();
      const fromInside = pageRel.toLowerCase().startsWith(t.toLowerCase() + '/');
      if (inTarget && !fromInside) results[t].push({ from: pageRel, ref: m[1] });
    }
  }
}

for (const t of targets) {
  const hits = results[t];
  console.log(`\n=== ${t} ===`);
  console.log(`  inbound references from OUTSIDE the tree: ${hits.length}`);
  if (hits.length) {
    const byPage = {};
    for (const h of hits) byPage[h.from] = (byPage[h.from] || 0) + 1;
    Object.entries(byPage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .forEach(([p, n]) => console.log(`    ${String(n).padStart(5)}  from ${p}`));
    console.log('  sample refs:');
    hits.slice(0, 5).forEach((h) => console.log(`    ${h.ref}   (in ${h.from})`));
  } else {
    console.log('  -> unreachable by navigation; safe to delete');
  }
}
