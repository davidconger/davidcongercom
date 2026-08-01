/**
 * Builds a publishable /you/ meet-and-greet gallery from a folder of JPEGs.
 *
 * Replaces the retired desktop generator. Output is plain static files in the
 * exact URL shape the site has always used, so nothing about the FTP workflow
 * or any existing link changes:
 *
 *   you/<year>/<slug>/index.htm
 *   you/<year>/<slug>/thumbnail.jpg              240x160, for the /you/ listing
 *   you/<year>/<slug>/gallery/<slug>-NN.htm      one page per photo
 *   you/<year>/<slug>/gallery/<slug>-NN.jpg      1280px display copy
 *   you/<year>/<slug>/gallery/<slug>-NN_sm.jpg   240x160 thumbnail
 *
 * Usage:
 *
 *   node tools/new-gallery.js --source "D:\exports\louis-yuen" \
 *        --artist "Louis Yuen" --venue "Snoqualmie Casino and Hotel" \
 *        --date "March 15, 2026"
 *
 * Options:
 *   --source <dir>      folder of source JPEGs (required)
 *   --artist <name>     (required)
 *   --venue <name>      (required)
 *   --date <date>       e.g. "March 15, 2026" or 2026-03-15 (required)
 *   --courtesy <name>   defaults to the venue
 *   --photos-by <html>  optional credit line
 *   --slug <slug>       defaults to <artist>-at-<venue>, lowercased alphanumeric
 *   --year <yyyy>       defaults to the year in --date
 *   --cover <n>         which photo becomes thumbnail.jpg (default 1)
 *   --no-listing        skip adding the event to you/index.htm
 *   --force             overwrite an existing event folder
 *   --dry-run           report what would be produced, write nothing
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATES = path.join(__dirname, 'templates');
const COPYRIGHT_YEAR = '2026';

// Matches the dimensions the site has used since 2019.
const FULL_MAX = 1280;
const THUMB_W = 240;
const THUMB_H = 160;

/* ------------------------------------------------------------------- args */

function parseArgs(argv) {
  const out = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out.flags.add(key);
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const dryRun = args.flags.has('dry-run');

function fail(msg) {
  console.error(`\nError: ${msg}\n`);
  console.error('Run with no arguments to see usage.');
  process.exit(1);
}

if (!args.source || !args.artist || !args.venue || !args.date) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ ?\* ?/gm, ''));
  process.exit(args.source || args.artist ? 1 : 0);
}

/* -------------------------------------------------------------- metadata */

/** "Snoqualmie Casino and Hotel" -> "snoqualmiecasinoandhotel" */
function slugPart(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** Accepts "2026-03-15" or "March 15, 2026" and returns both display and year. */
function parseDate(input) {
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return { display: `${MONTHS[+m - 1]} ${+d}, ${y}`, year: y };
  }
  const named = input.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (named) {
    const m = MONTHS.findIndex((x) => x.toLowerCase() === named[1].toLowerCase());
    if (m < 0) fail(`Unrecognised month in --date "${input}"`);
    return { display: `${MONTHS[m]} ${+named[2]}, ${named[3]}`, year: named[3] };
  }
  fail(`Could not parse --date "${input}". Use "2026-03-15" or "March 15, 2026".`);
}

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const date = parseDate(args.date);
const year = args.year || date.year;
const slug = args.slug || `${slugPart(args.artist)}-at-${slugPart(args.venue)}`;
const courtesy = args.courtesy || args.venue;
const photosBy = args['photos-by'] || '';
const cover = parseInt(args.cover || '1', 10);

/* ------------------------------------------------------------ source scan */

const sourceDir = path.resolve(args.source);
if (!fs.existsSync(sourceDir)) fail(`--source folder not found: ${sourceDir}`);

const sources = fs
  .readdirSync(sourceDir)
  .filter((f) => /\.jpe?g$/i.test(f) && !/_sm\.jpe?g$/i.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

if (!sources.length) fail(`No .jpg files found in ${sourceDir}`);
if (cover < 1 || cover > sources.length) {
  fail(`--cover ${cover} is out of range (1..${sources.length})`);
}

const eventDir = path.join(ROOT, 'you', year, slug);
const galleryDir = path.join(eventDir, 'gallery');

if (fs.existsSync(eventDir) && !args.flags.has('force') && !dryRun) {
  fail(`${path.relative(ROOT, eventDir)} already exists. Pass --force to overwrite.`);
}

const pad = (n) => String(n).padStart(2, '0');
const photos = sources.map((src, i) => {
  const n = i + 1;
  return {
    src: path.join(sourceDir, src),
    num: n,
    base: `${slug}-${pad(n)}`,
    jpg: `${slug}-${pad(n)}.jpg`,
    sm: `${slug}-${pad(n)}_sm.jpg`,
    htm: `${slug}-${pad(n)}.htm`,
  };
});

console.log(`\n  event   : ${args.artist} at ${args.venue}`);
console.log(`  date    : ${date.display}`);
console.log(`  output  : you/${year}/${slug}/`);
console.log(`  photos  : ${photos.length} (cover: #${cover})`);
if (dryRun) console.log('  MODE    : dry run, nothing will be written');

/* ---------------------------------------------------------------- images */

function runResize(jobs, quality) {
  if (!jobs.length) return;
  const jobFile = path.join(os.tmpdir(), `dc-resize-${process.pid}-${quality}.json`);
  fs.writeFileSync(jobFile, JSON.stringify(jobs), 'utf8');
  try {
    execFileSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(__dirname, 'resize-images.ps1'),
        '-JobFile', jobFile, '-Quality', String(quality)],
      { stdio: 'inherit' }
    );
  } finally {
    fs.unlinkSync(jobFile);
  }
}

if (!dryRun) {
  fs.mkdirSync(galleryDir, { recursive: true });

  // The display copies carry the photography, so they get the higher quality
  // setting; thumbnails are 240px wide and nobody inspects them closely.
  console.log('\n  resizing display images...');
  runResize(
    photos.map((p) => ({
      src: p.src, dst: path.join(galleryDir, p.jpg),
      width: FULL_MAX, height: FULL_MAX, mode: 'fit',
    })),
    88
  );

  console.log('  resizing thumbnails...');
  runResize(
    photos.map((p) => ({
      src: p.src, dst: path.join(galleryDir, p.sm),
      width: THUMB_W, height: THUMB_H, mode: 'cover',
    })).concat([{
      src: photos[cover - 1].src, dst: path.join(eventDir, 'thumbnail.jpg'),
      width: THUMB_W, height: THUMB_H, mode: 'cover',
    }]),
    82
  );
}

/* ------------------------------------------------------------------ pages */

const tpl = (name) => fs.readFileSync(path.join(TEMPLATES, name), 'utf8');

function render(template, vars) {
  return template.replace(/\{([A-Z_]+)\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m
  );
}

/** Reads a JPEG's dimensions straight from its SOF marker. */
function jpegSize(file) {
  const buf = fs.readFileSync(file);
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return { width: FULL_MAX, height: 854 };
}

const common = {
  ARTIST: escapeHtml(args.artist),
  VENUE: escapeHtml(args.venue),
  DATE: escapeHtml(date.display),
  COURTESY: escapeHtml(courtesy),
  PHOTOSBY: photosBy,
  YEAR: year,
  SLUG: slug,
  COPYRIGHT: COPYRIGHT_YEAR,
  COUNT: String(photos.length),
};

const written = [];
function write(file, text) {
  written.push(path.relative(ROOT, file).replace(/\\/g, '/'));
  if (dryRun) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

// Event index.
const items = photos
  .map((p) => `\t\t<li><a href="gallery/${p.htm}"><img src="gallery/${p.sm}" width="${THUMB_W}" height="${THUMB_H}" loading="lazy" decoding="async" alt="${escapeHtml(args.artist)} at ${escapeHtml(args.venue)}, photo ${p.num}"/></a></li>`)
  .join('\n');

write(
  path.join(eventDir, 'index.htm'),
  render(tpl('you-event.htm'), { ...common, ROOT: '../../../', IMAGES: items })
);

// One page per photo, with previous/next so a visitor can page through the set
// instead of returning to the index between every shot.
const photoTpl = tpl('you-photo.htm');
photos.forEach((p, i) => {
  const prev = i > 0 ? photos[i - 1] : null;
  const next = i < photos.length - 1 ? photos[i + 1] : null;
  const nav = [
    prev ? `<a href="${prev.htm}" rel="prev">&laquo; Previous</a>` : '<span class="navDisabled">&laquo; Previous</span>',
    '<a href="../index.htm">Back to Gallery</a>',
    next ? `<a href="${next.htm}" rel="next">Next &raquo;</a>` : '<span class="navDisabled">Next &raquo;</span>',
  ].join('\n\t\t');

  const dims = dryRun
    ? { width: FULL_MAX, height: 854 }
    : jpegSize(path.join(galleryDir, p.jpg));

  write(
    path.join(galleryDir, p.htm),
    render(photoTpl, {
      ...common,
      ROOT: '../../../../',
      IMAGEFILE: p.jpg,
      NUMBER: String(p.num),
      WIDTH: String(dims.width),
      HEIGHT: String(dims.height),
      NAVIGATION: nav,
    })
  );
});

/* ------------------------------------------------- /you/ listing insertion */

if (!args.flags.has('no-listing')) {
  const listing = path.join(ROOT, 'you', 'index.htm');
  const html = fs.readFileSync(listing, 'utf8');
  const marker = `${year}/${slug}/`;

  if (html.includes(marker)) {
    console.log('\n  you/index.htm already lists this event, left unchanged.');
  } else {
    const li = [
      '\t\t<li>',
      '\t\t\t<div>',
      `\t\t\t\t<a href="${year}/${slug}/">`,
      `\t\t\t\t\t<img src="${year}/${slug}/thumbnail.jpg" alt="${escapeHtml(args.artist)}" width="${THUMB_W}" height="${THUMB_H}" loading="lazy" decoding="async"/><br/>`,
      `\t\t\t\t\t<event>${escapeHtml(args.artist)}</event><br/>`,
      `\t\t\t\t\t<venue>${escapeHtml(args.venue)}</venue><br/>`,
      `\t\t\t\t\t<date>${escapeHtml(date.display)}</date>`,
      '\t\t\t\t</a>',
      '\t\t\t</div>',
      '\t\t</li>',
    ].join('\n');

    // The listing is newest-first, so the new event goes directly after the
    // opening <ul>.
    const m = html.match(/<ul\b[^>]*class=["']catalogList["'][^>]*>/i) || html.match(/<ul\b[^>]*>/i);
    if (!m) {
      console.log('\n  Could not find the list in you/index.htm; add the entry by hand.');
    } else {
      const at = m.index + m[0].length;
      const updated = html.slice(0, at) + '\n' + li + html.slice(at);
      written.push('you/index.htm');
      if (!dryRun) fs.writeFileSync(listing, updated, 'utf8');
    }
  }
}

/* ---------------------------------------------------------------- summary */

console.log(`\n  ${dryRun ? 'would write' : 'wrote'} ${written.length} file(s):`);
for (const f of written.slice(0, 6)) console.log(`    ${f}`);
if (written.length > 6) console.log(`    ... and ${written.length - 6} more`);

if (!dryRun) {
  console.log(`\n  Preview:  node tools/serve.js . 8099`);
  console.log(`            http://localhost:8099/you/${year}/${slug}/`);
  console.log(`\n  Then upload you/${year}/${slug}/ and you/index.htm over FTP.`);
}
