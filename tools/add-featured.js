/**
 * Adds hand-picked frames to js/featured-images.json, the pool the homepage
 * rotator draws from.
 *
 * Picks are written as "<year>/<month>/<slug> <n>[,<n>...]", where each number
 * is the frame's position in that gallery page's own image list -- the order
 * you see clicking through the show -- not a filename. Filenames are usually
 * "<slug>-0N.jpg" and usually line up, but a gallery that had a frame pulled
 * after publication does not, so the position is resolved by reading the page.
 *
 * Artist, venue and date come from the gallery page too, so a picked entry
 * carries exactly the caption the show itself carries. Width and height are
 * recorded because the homepage caption is positioned against the frame to
 * cover the burned-in watermark: a frame of a different shape puts the panel
 * in the wrong place and uncovers the mark.
 *
 * Existing entries are never removed and never duplicated -- a pick already in
 * the pool is skipped -- so this is safe to re-run.
 *
 * Usage:
 *   node tools/add-featured.js --picks tools/picks-2019.txt
 *   node tools/add-featured.js --picks tools/picks-2019.txt --dry-run
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'js', 'featured-images.json');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const picksFile = argv[argv.indexOf('--picks') + 1];
if (!argv.includes('--picks') || !picksFile) {
  console.error('Usage: node tools/add-featured.js --picks <file> [--dry-run]');
  process.exit(1);
}

/* ------------------------------------------------------------------- parse */

function tag(html, id) {
  const m = html.match(new RegExp(`<span[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</span>`, 'i'));
  return m ? decode(m[1].replace(/<[^>]+>/g, '').trim()) : '';
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

// Only the gallery's own frames, never the social icons in the header: the
// list is scoped to <ul id="images"> before any <img> is looked at.
function galleryImages(html) {
  const m = html.match(/<ul[^>]*\bid="images"[^>]*>([\s\S]*?)<\/ul>/i);
  if (!m) return [];
  const out = [];
  const re = /<img\b([^>]*)>/gi;
  let img;
  while ((img = re.exec(m[1]))) {
    const attrs = img[1];
    const src = (attrs.match(/\bsrc\s*=\s*(["'])([\s\S]*?)\1/i) || [])[2];
    if (!src) continue;
    const w = (attrs.match(/\bwidth\s*=\s*(["'])?(\d+)\1?/i) || [])[2];
    const h = (attrs.match(/\bheight\s*=\s*(["'])?(\d+)\1?/i) || [])[2];
    out.push({ src, width: w ? +w : null, height: h ? +h : null });
  }
  return out;
}

/* -------------------------------------------------------------------- read */

const picks = [];
for (const raw of fs.readFileSync(picksFile, 'utf8').split(/\r?\n/)) {
  const line = raw.replace(/#.*$/, '').trim();
  if (!line) continue;
  const m = line.match(/^(\S+)\s+([\d\s,]+)$/);
  if (!m) { console.error(`  ! cannot parse: ${raw}`); process.exitCode = 1; continue; }
  const indices = m[2].split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0);
  picks.push({ rel: m[1].replace(/^\/+|\/+$/g, ''), indices });
}

const existing = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

// The pool was assembled by hand over the years and carries a few frames listed
// two or three times, which let one show turn up twice in a single ten-slot
// rotation. Keep the first occurrence of each image and drop the rest.
const have = new Set();
const pool = [];
let dropped = 0;
for (const entry of existing) {
  if (have.has(entry.image)) { dropped++; continue; }
  have.add(entry.image);
  pool.push(entry);
}
if (dropped) console.log(`  - dropped ${dropped} duplicate entr${dropped === 1 ? 'y' : 'ies'} already in the pool`);

// Entries added before this tool existed carry no dimensions. Read them off the
// gallery page so every entry can be shape-checked, since a frame that is not
// the usual 640x426 puts the homepage caption somewhere other than over the
// watermark.
let filled = 0;
const shapes = new Map();
const missing = [];
for (const entry of pool) {
  const rel = (entry.gallery || '').replace(/^galleries\/|\/+$/g, '');
  const page = path.join(ROOT, 'galleries', rel, 'index.htm');
  if (!entry.width && fs.existsSync(page)) {
    const frame = galleryImages(fs.readFileSync(page, 'utf8'))
      .find((f) => f.src.split('/').pop() === entry.image.split('/').pop());
    if (frame && frame.width) { entry.width = frame.width; entry.height = frame.height; filled++; }
  }
  if (!fs.existsSync(path.join(ROOT, entry.image))) missing.push(entry.image);
  const key = entry.width ? `${entry.width}x${entry.height}` : 'unknown';
  shapes.set(key, (shapes.get(key) || 0) + 1);
}
if (filled) console.log(`  ~ backfilled dimensions on ${filled} existing entr${filled === 1 ? 'y' : 'ies'}`);
for (const [shape, n] of [...shapes].sort((a, b) => b[1] - a[1])) console.log(`  . ${n} frame(s) at ${shape}`);
for (const m of missing) { console.error(`  ! file not on disk: ${m}`); process.exitCode = 1; }

const added = [];

for (const pick of picks) {
  const dir = path.join(ROOT, 'galleries', pick.rel);
  const page = path.join(dir, 'index.htm');
  if (!fs.existsSync(page)) { console.error(`  ! no such gallery: ${pick.rel}`); process.exitCode = 1; continue; }

  const html = fs.readFileSync(page, 'utf8');
  const images = galleryImages(html);
  const artist = tag(html, 'title');
  const venue = tag(html, 'venue');
  const date = tag(html, 'date');
  if (!images.length) { console.error(`  ! no images listed: ${pick.rel}`); process.exitCode = 1; continue; }

  for (const n of pick.indices) {
    const frame = images[n - 1];
    if (!frame) {
      console.error(`  ! ${pick.rel} has ${images.length} frame(s), asked for ${n}`);
      process.exitCode = 1;
      continue;
    }
    const file = frame.src.split('/').pop();
    if (!fs.existsSync(path.join(dir, file))) {
      console.error(`  ! missing file: ${pick.rel}/${file}`);
      process.exitCode = 1;
      continue;
    }
    const image = `galleries/${pick.rel}/${file}`;
    if (have.has(image)) { console.log(`  = already in pool: ${image}`); continue; }
    have.add(image);
    added.push({
      gallery: `galleries/${pick.rel}/`,
      image,
      date,
      artist,
      venue,
      width: frame.width,
      height: frame.height,
    });
    console.log(`  + ${image}  (${artist} -- frame ${n})`);
  }
}

console.log(`\n${pool.length} existing, ${added.length} added, ${pool.length + added.length} total`);

if (dryRun) { console.log('dry run -- nothing written'); process.exit(); }
if (!added.length && !dropped) { console.log('nothing to write'); process.exit(); }

fs.writeFileSync(JSON_PATH, `${JSON.stringify(pool.concat(added), null, 2)}\n`, 'utf8');
console.log(`wrote js/featured-images.json`);
