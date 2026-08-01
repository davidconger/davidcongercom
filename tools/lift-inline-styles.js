/**
 * Lifts the duplicated `.yearHeader` / `.pageHeader` <style> block out of the
 * listing pages and into css/site.css, which is where every other rule already
 * lives. Only removes a <style> block whose rules are exactly the ones site.css
 * now provides - anything with extra declarations is reported and left alone.
 *
 *   node tools/lift-inline-styles.js [--apply]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const apply = process.argv.includes('--apply');
const SKIP = new Set(['tools', '.git', 'node_modules']);

/** Normalizes CSS to a comparable shape: no comments, no incidental whitespace. */
function normalize(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, '')
    .replace(/;}/g, '}')
    .toLowerCase();
}

const EXPECTED = normalize(`
.yearHeader { font-size: 18pt; letter-spacing: 2px; font-weight: bold; color: #949494; }
.pageHeader { font-size: 12pt; letter-spacing: 4px; text-align: center; font-weight: bold; }
`);

const matched = [];
const skipped = [];

(function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); continue; }
    if (!/\.html?$/i.test(e.name)) continue;
    const text = fs.readFileSync(p, 'utf8');
    const m = text.match(/(?:[ \t]*\r?\n)?[ \t]*<style[^>]*>([\s\S]*?)<\/style>[ \t]*\r?\n?/i);
    if (!m) continue;
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    if (normalize(m[1]) === EXPECTED) matched.push({ file: p, rel, block: m[0] });
    else skipped.push(rel);
  }
})(ROOT);

console.log(`  pages with the exact duplicated block : ${matched.length}`);
if (skipped.length) {
  console.log(`  pages with a different <style> block  : ${skipped.length}`);
  const variants = new Map();
  for (const s of skipped) {
    const text = fs.readFileSync(path.join(ROOT, s), 'utf8');
    const m = text.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    const key = normalize(m[1]);
    if (!variants.has(key)) variants.set(key, { count: 0, sample: s, css: m[1].trim() });
    variants.get(key).count++;
  }
  console.log(`  distinct variants among those        : ${variants.size}\n`);
  [...variants.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .forEach((v) => {
      console.log(`  --- ${v.count} page(s), e.g. ${v.sample}`);
      console.log(v.css.split(/\r?\n/).map((l) => '      ' + l).join('\n'));
    });
}

if (!apply) { console.log('\n  Dry run; pass --apply to write.'); process.exit(0); }

for (const m of matched) {
  let text = fs.readFileSync(m.file, 'utf8');
  const hadBom = text.charCodeAt(0) === 0xfeff;
  text = text.replace(m.block, '');
  fs.writeFileSync(m.file, hadBom && text.charCodeAt(0) !== 0xfeff ? '\ufeff' + text : text, 'utf8');
}
console.log(`\n  removed the inline block from ${matched.length} page(s)`);
