/**
 * Census of external asset references across every HTML page.
 *
 * Reports how many pages reference each script/stylesheet, and for rarely-used
 * assets lists the referencing pages by name so a deletion can be justified
 * rather than guessed at.
 *
 * Usage: node tools/asset-census.js [root] [--list-under N]
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '.');
const listIdx = process.argv.indexOf('--list-under');
const listUnder = listIdx > -1 ? parseInt(process.argv[listIdx + 1], 10) : 5;

const SKIP_DIRS = new Set(['.git', 'node_modules', 'tools', '1cnf', '1pvt']);

const pages = [];
(function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full);
    } else if (/\.html?$/i.test(e.name)) {
      pages.push(full);
    }
  }
})(root);

// asset key -> Set of pages
const script = new Map();
const style = new Map();

const add = (map, key, page) => {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(path.relative(root, page).replace(/\\/g, '/'));
};

// Normalise a reference to a comparable key: local refs collapse to basename-ish
// tail, remote refs keep their host so CDN usage is visible.
function keyFor(url) {
  const u = url.trim().replace(/^['"]|['"]$/g, '');
  if (/^(https?:)?\/\//i.test(u)) {
    try {
      const parsed = new URL(u.startsWith('//') ? 'https:' + u : u);
      return parsed.host + parsed.pathname;
    } catch {
      return u;
    }
  }
  return u.split('?')[0].split('#')[0].replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');
}

for (const p of pages) {
  let html;
  try {
    html = fs.readFileSync(p, 'utf8');
  } catch {
    continue;
  }
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    add(script, keyFor(m[1]), p);
  }
  for (const m of html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    if (/stylesheet/i.test(m[0])) add(style, keyFor(m[1]), p);
  }
}

function report(title, map) {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
  const rows = [...map.entries()].sort((a, b) => b[1].size - a[1].size);
  for (const [k, set] of rows) {
    console.log(String(set.size).padStart(6) + '  ' + k);
    if (set.size <= listUnder) {
      [...set].forEach((pg) => console.log('          -> ' + pg));
    }
  }
}

console.log(`Pages scanned: ${pages.length}`);
report('SCRIPT src references (pages per asset)', script);
report('STYLESHEET href references (pages per asset)', style);
