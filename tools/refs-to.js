/**
 * Counts inbound references to specific files, by scanning every .htm on the
 * site. Used to decide whether an orphaned-looking page is safe to touch.
 *
 *   node tools/refs-to.js index-X.htm old_index.htm previous.htm
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['tools', '.git', 'node_modules']);
const targets = process.argv.slice(2);
if (!targets.length) {
  console.error('usage: node tools/refs-to.js <name> [name...]');
  process.exit(1);
}

const hits = new Map(targets.map((t) => [t, []]));
let scanned = 0;

(function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); continue; }
    if (!/\.html?$/i.test(e.name)) continue;
    scanned++;
    const text = fs.readFileSync(p, 'utf8');
    for (const t of targets) {
      if (text.includes(t)) hits.get(t).push(path.relative(ROOT, p).replace(/\\/g, '/'));
    }
  }
})(ROOT);

console.log(`  scanned ${scanned} pages\n`);
for (const t of targets) {
  const list = hits.get(t).filter((f) => !f.endsWith('/' + t) && f !== t);
  console.log(`  ${t}: ${list.length} inbound`);
  for (const f of list.slice(0, 10)) console.log(`      ${f}`);
}
