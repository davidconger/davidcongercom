/**
 * Repairs event dates that are missing the space between month and day.
 *
 * The retired generator wrote some dates as "July1, 2013" instead of
 * "July 1, 2013". The text is visible on the event and photo pages, so this is
 * a content bug rather than a cosmetic one, and it also leaked into the page
 * titles that seo-pass.js builds from the same data.
 *
 *   node tools/fix-dates.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['1cnf', '1pvt', '.git', 'node_modules', 'tools']);
const dryRun = process.argv.includes('--dry-run');

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
// A month name butted directly against a day number, e.g. "July1, 2013".
const BAD_DATE = new RegExp(`\\b(${MONTHS})(\\d{1,2})\\b`, 'g');

const files = [];
(function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); continue; }
    if (/\.html?$/i.test(e.name)) files.push(p);
  }
})(ROOT);

let changed = 0;
let fixes = 0;
const samples = new Map();

/**
 * Applies the fix only to text between tags. Doing it on the raw file would
 * also rewrite anything like href=".../July4-fireworks/", silently breaking
 * links, so attribute values and tag internals are left alone.
 */
function fixTextNodes(html, onFix) {
  return html.replace(/>([^<]+)</g, (whole, text) => {
    BAD_DATE.lastIndex = 0;
    if (!BAD_DATE.test(text)) return whole;
    const fixed = text.replace(BAD_DATE, (m0, month, day) => {
      onFix(m0, `${month} ${day}`);
      return `${month} ${day}`;
    });
    return `>${fixed}<`;
  });
}

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  BAD_DATE.lastIndex = 0;
  if (!BAD_DATE.test(before)) continue;
  const hadBom = before.charCodeAt(0) === 0xfeff;
  let n = 0;
  const after = fixTextNodes(before, (from, to) => {
    n++;
    samples.set(from, to);
  });
  if (after === before) continue;
  changed++;
  fixes += n;
  if (!dryRun) {
    fs.writeFileSync(file, hadBom && after.charCodeAt(0) !== 0xfeff ? '\ufeff' + after : after, 'utf8');
  }
}

console.log(`  pages scanned : ${files.length}`);
console.log(`  pages changed : ${changed}`);
console.log(`  dates fixed   : ${fixes}`);
console.log(`  distinct      : ${samples.size}`);
[...samples.entries()].sort().forEach(([from, to]) => console.log(`      ${from} -> ${to}`));
if (dryRun) console.log('\n  Dry run; nothing written.');
