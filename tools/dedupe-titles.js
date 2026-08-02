/**
 * Makes duplicate <title> values unique, and only those.
 *
 * seo-pass.js already dates the per-photo and per-page titles. What is left are
 * pages whose title is genuinely ambiguous: an artist who played the same venue
 * several times, or an event page with no date in its markup at all. Search
 * engines treat those as competing duplicates.
 *
 * The rule is deliberately narrow:
 *
 *   - group every page by its exact <title>
 *   - leave any title that appears once completely alone
 *   - for a colliding group, append a date to each member's leading segment
 *   - write only if that actually makes every title in the group distinct
 *
 * The last condition is what keeps this idempotent. Once a group is fixed it no
 * longer collides, so a second run finds nothing to do; and a group that cannot
 * be separated is skipped rather than being appended to over and over.
 *
 *   node tools/dedupe-titles.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set([
  '1cnf', '1pvt', '.git', 'node_modules', 'tools',
  '!template', 'template', 'test', 'test2',
]);
/**
 * galleries/0000/ is the retired generator's placeholder year, and
 * you/<year>/Old/ is a superseded copy of nineteen events. Neither is indexed,
 * so neither should hold a title hostage from the page that is.
 */
const SKIP_PATHS = [/^galleries\/0000\//i, /^you\/\d{4}\/old\//i];
const dryRun = process.argv.includes('--dry-run');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function decode(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeAttr(s) {
  return s.replace(/&(?![a-z#0-9]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The event date as written in the page, e.g. "August 3, 2013". */
function markupDate(html) {
  const m = html.match(/<span[^>]+id=["']date["'][^>]*>([\s\S]*?)<\/span>/i);
  const v = m ? decode(m[1]) : '';
  return /\d/.test(v) ? v : '';
}

/**
 * A date recovered from the images the page displays.
 *
 * The 749 flat /galleries/<artist>.htm pages predate the dated URL scheme and
 * carry no date anywhere in their markup or path, but they still load their
 * photographs from the dated archive, e.g. "2011/03/eastoncorbin/...jpg".
 */
function imageDate(html) {
  const m = html.match(/(?:src|href)\s*=\s*["'](?:\.\.\/)*(\d{4})\/(\d{1,2})\/[^"']*\.jpe?g["']/i);
  if (!m) return '';
  const year = parseInt(m[1], 10);
  if (year < 1995 || year > 2100) return '';
  const mo = MONTHS[parseInt(m[2], 10) - 1];
  return mo ? `${mo} ${m[1]}` : m[1];
}

/**
 * A date recovered from the URL. Pre-2014 galleries carry no #details block,
 * but the archive has always been filed under /galleries/YYYY/MM/, and the
 * section trees -- festivals, radio and the rest -- are filed by year, which is
 * enough to tell an annual event apart from itself.
 */
function pathDate(rel) {
  let m = rel.match(/^galleries\/(\d{4})\/(\d{1,2})\//i);
  if (m) {
    const mo = MONTHS[parseInt(m[2], 10) - 1];
    return mo ? `${mo} ${m[1]}` : m[1];
  }
  m = rel.match(/^(?:you|you_old)\/(\d{4})\//i);
  if (m) return m[1];
  m = rel.match(/^(?:festivals|other|radio|tearsheets|catalog)\/(\d{4})\//i);
  if (m) return m[1];
  m = rel.match(/^galleries\/(\d{4})\//i);
  return m ? m[1] : '';
}

const files = [];
(function collect(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) collect(p); continue; }
    if (/\.html?$/i.test(e.name)) files.push(p);
  }
})(ROOT);

const pages = [];
const groups = new Map();

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (SKIP_PATHS.some((re) => re.test(rel))) continue;

  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) continue;
  const title = decode(m[1]);
  if (!title || title.includes('{0}')) continue;

  const page = { file, rel, html, raw: m[0], title, date: markupDate(html) || pathDate(rel) || imageDate(html) };
  pages.push(page);
  if (!groups.has(title)) groups.set(title, []);
  groups.get(title).push(page);
}

/** Appends the date to the segment before the first " | ". */
function withDate(title, date) {
  const i = title.indexOf(' | ');
  const head = i === -1 ? title : title.slice(0, i);
  const tail = i === -1 ? '' : title.slice(i);
  if (head.endsWith(date)) return title;
  return `${head} \u2014 ${date}${tail}`;
}

const taken = new Set(pages.map((p) => p.title));
let groupsFixed = 0;
let groupsSkipped = 0;
let written = 0;
const samples = [];
const skipped = [];

for (const [title, members] of groups) {
  if (members.length < 2) continue;

  const proposed = members.map((p) => (p.date ? withDate(title, p.date) : title));
  const distinct = new Set(proposed);

  // Every member must end up with its own title, and none may squat on a title
  // another page already owns.
  const separable = distinct.size === members.length
    && proposed.every((t) => t !== title && !taken.has(t));

  if (!separable) {
    groupsSkipped++;
    if (skipped.length < 6) skipped.push(`${members.length} x ${title.slice(0, 78)}`);
    continue;
  }

  groupsFixed++;
  members.forEach((p, i) => {
    const next = proposed[i];
    taken.add(next);
    if (samples.length < 6) samples.push(`${p.rel}\n        ${next}`);
    if (dryRun) { written++; return; }
    const out = p.html.replace(p.raw, `<title>${escapeAttr(next)}</title>`);
    if (out === p.html) return;
    fs.writeFileSync(p.file, out, 'utf8');
    written++;
  });
}

console.log(`  pages with a title  : ${pages.length}`);
console.log(`  colliding groups    : ${groupsFixed + groupsSkipped}`);
console.log(`  groups separated    : ${groupsFixed}`);
console.log(`  groups left alone   : ${groupsSkipped}`);
console.log(`  titles rewritten    : ${written}`);
if (samples.length) {
  console.log('\n  examples:');
  samples.forEach((s) => console.log(`      ${s}`));
}
if (skipped.length) {
  console.log('\n  not separable by date (left untouched):');
  skipped.forEach((s) => console.log(`      ${s}`));
}
if (dryRun) console.log('\n  Dry run; nothing written.');
