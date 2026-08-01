/**
 * Builds the thumbnail catalog pages under catalog/ from the retired
 * generator's surviving source data.
 *
 * Each year keeps its event list in catalog/<year>/_data/<year>-<mm>.txt, one
 * semicolon-delimited record per event:
 *
 *   <description>; <gallery path>; <flag>; <source>; <id>
 *   Sara Bareilles, WaMu Theater, Seattle, WA. October 22, 2019; 2019/10/sarabareilles/index.htm; l;  (CollabDb); 8D95834FE854805
 *
 * catalog/2019 and catalog/2020 were never rendered -- only their _data files
 * survive -- so those two years exist nowhere on the site despite all 96
 * galleries being present. This rebuilds them.
 *
 * The 240x160 catalog thumbnail for each event is cut from the gallery's own
 * cover frame, which the gallery page declares as its og:image and is always
 * <slug>-01.jpg (or <slug>.jpg for the single-photo galleries). Verified
 * against the thumbnails the original tool produced.
 *
 * _data is incomplete for some years, so the galleries/<year> folders are
 * treated as the authoritative event list; anything _data does not cover has
 * its description rebuilt from the gallery page's own og:description.
 *
 * Usage:
 *
 *   node tools/build-catalog.js --year 2019 --dry-run
 *   node tools/build-catalog.js --year 2019 --year 2020
 *   node tools/build-catalog.js --all
 *
 * Options:
 *   --year <yyyy>   year to build; repeatable
 *   --all           build every year that has a _data folder
 *   --root          also rewrite catalog/index.htm as a copy of the newest year
 *   --nav           only refresh the prev/next year navigation on existing pages
 *   --force-thumbs  re-cut thumbnails that already exist
 *   --dry-run       report what would happen, write nothing
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CATALOG = path.join(ROOT, 'catalog');
const TEMPLATES = path.join(__dirname, 'templates');
const SITE = 'https://www.davidconger.com';
const COPYRIGHT_YEAR = '2026';
const THUMB_W = 240;
const THUMB_H = 160;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/* ------------------------------------------------------------------- args */

function parseArgs(argv) {
  const out = { flags: new Set(), years: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out.flags.add(key); continue; }
    if (key === 'year') out.years.push(next); else out[key] = next;
    i++;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const dryRun = args.flags.has('dry-run');

function fail(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}

const allYears = fs.readdirSync(CATALOG, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name)
    && fs.existsSync(path.join(CATALOG, d.name, '_data')))
  .map((d) => d.name)
  .sort();

if (!args.years.length && !args.flags.has('all') && !args.flags.has('nav')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ ?\* ?/gm, ''));
  console.log(`  Years with source data: ${allYears.join(', ')}\n`);
  process.exit(0);
}

const years = args.flags.has('all') ? allYears : args.years;
for (const y of years) if (!allYears.includes(y)) fail(`catalog/${y}/_data does not exist`);

/* -------------------------------------------------------------- parsing */

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "Sara Bareilles, WaMu Theater, Seattle, WA. October 22, 2019" -> a sort key. */
function eventDate(desc) {
  const m = /([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})\s*$/.exec(desc);
  if (!m) return null;
  const mon = MONTHS.findIndex((x) => x === m[1]);
  if (mon < 0) return null;
  return { y: +m[3], m: mon + 1, d: +m[2] };
}

function readYear(year) {
  const dir = path.join(CATALOG, year, '_data');
  const byRel = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => /\.txt$/i.test(f)).sort()) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      const parts = line.split(';').map((s) => s.trim());
      const desc = parts[0];
      const rel = (parts[1] || '').replace(/\\/g, '/').replace(/\/index\.html?$/i, '');
      if (!desc || !rel) return;
      byRel.set(rel, { desc, source: '_data', order: [file, String(i).padStart(5, '0')].join(':') });
    });
  }

  // The _data files are incomplete for several years -- 2018 is missing two
  // whole months, 2019 is missing two events -- so the gallery folders, not
  // _data, are the authoritative list of what was shot. Anything _data does
  // not describe gets its description rebuilt from the gallery's own og tags.
  const derived = [];
  const orphans = [];
  for (const rel of galleryFolders(year)) {
    if (byRel.has(rel)) continue;
    const desc = descriptionFromGallery(rel);
    if (desc) { byRel.set(rel, { desc, source: 'gallery', order: 'zzz:' + rel }); derived.push(rel); }
    else orphans.push(rel);
  }
  if (derived.length) console.log(`  ${derived.length} event(s) not in _data, described from the gallery page: ${derived.join(', ')}`);
  if (orphans.length) console.log(`  ${orphans.length} gallery folder(s) skipped, no usable page: ${orphans.join(', ')}`);

  for (const rel of byRel.keys()) {
    if (!fs.existsSync(path.join(ROOT, 'galleries', rel))) {
      console.log(`  WARNING: _data lists ${rel} but the gallery folder is missing`);
    }
  }

  const entries = [...byRel.entries()].map(([rel, v]) => {
    const seg = rel.split('/');
    return {
      desc: v.desc,
      rel,                                // 2019/10/sarabareilles
      year: seg[0], month: seg[1], slug: seg[2],
      // The artist is everything before the first comma, which is what the
      // original tool used for alt text.
      artist: v.desc.split(',')[0].trim(),
      date: eventDate(v.desc),
      source: v.source,
      order: v.order,
    };
  });

  // Newest first, matching every rendered year. Records already sit in
  // newest-first order inside each month file, so ties keep their file order.
  entries.sort((a, b) => {
    const ka = a.date ? a.date.y * 10000 + a.date.m * 100 + a.date.d : 0;
    const kb = b.date ? b.date.y * 10000 + b.date.m * 100 + b.date.d : 0;
    if (ka !== kb) return kb - ka;
    return a.order < b.order ? -1 : 1;
  });
  return entries;
}

/** Every galleries/<year>/<month>/<slug> folder, as "year/month/slug". */
function galleryFolders(year) {
  const base = path.join(ROOT, 'galleries', year);
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const m of fs.readdirSync(base, { withFileTypes: true })) {
    if (!m.isDirectory()) continue;
    for (const s of fs.readdirSync(path.join(base, m.name), { withFileTypes: true })) {
      if (s.isDirectory()) out.push(`${year}/${m.name}/${s.name}`);
    }
  }
  return out.sort();
}

const decodeHtml = (s) => String(s)
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * Rebuilds a catalog description from a gallery page for events the retired
 * tool never wrote to _data. Gallery pages phrase it as
 *   "Deleasa at Tacoma Dome in Tacoma, WA on October 13, 2019."
 * where the catalog wants
 *   "Deleasa, Tacoma Dome, Tacoma, WA. October 13, 2019"
 */
function descriptionFromGallery(rel) {
  const file = path.join(ROOT, 'galleries', rel, 'index.htm');
  if (!fs.existsSync(file)) return null;
  const html = fs.readFileSync(file, 'utf8');
  const og = /<meta property="og:description" content="([^"]*)"/.exec(html);
  if (!og) return null;
  const text = decodeHtml(og[1]).trim().replace(/\.\s*$/, '');
  const m = /^(.*?) at (.*?) in (.*?) on ([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(text);
  if (!m) return null;
  return `${m[1]}, ${m[2]}, ${m[3]}. ${m[4]} ${Number(m[5])}, ${m[6]}`;
}

/* ----------------------------------------------------------- thumbnails */

/** The gallery's cover frame, which its own page declares as og:image. */
function coverSource(e) {
  const dir = path.join(ROOT, 'galleries', e.year, e.month, e.slug);
  if (!fs.existsSync(dir)) return null;
  const first = path.join(dir, `${e.slug}-01.jpg`);
  if (fs.existsSync(first)) return first;
  const single = path.join(dir, `${e.slug}.jpg`);
  if (fs.existsSync(single)) return single;
  const any = fs.readdirSync(dir)
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return any.length ? path.join(dir, any[0]) : null;
}

function cutThumbnails(entries) {
  const jobs = [];
  const missing = [];
  for (const e of entries) {
    const dst = path.join(CATALOG, e.year, e.month, `${e.slug}.jpg`);
    if (fs.existsSync(dst) && !args.flags.has('force-thumbs')) continue;
    const src = coverSource(e);
    if (!src) { missing.push(e.rel); continue; }
    jobs.push({ src, dst, width: THUMB_W, height: THUMB_H, mode: 'cover' });
  }
  if (missing.length) {
    console.log(`  ${missing.length} event(s) have no gallery image:`);
    missing.slice(0, 10).forEach((m) => console.log(`    ${m}`));
  }
  if (!jobs.length) { console.log('  thumbnails: all present'); return; }
  console.log(`  thumbnails: cutting ${jobs.length}`);
  if (dryRun) return;
  for (const j of jobs) fs.mkdirSync(path.dirname(j.dst), { recursive: true });
  const jobFile = path.join(os.tmpdir(), `dc-catalog-${process.pid}.json`);
  fs.writeFileSync(jobFile, JSON.stringify(jobs), 'utf8');
  try {
    execFileSync('powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(__dirname, 'resize-images.ps1'), '-JobFile', jobFile, '-Quality', '82'],
      { stdio: 'inherit' });
  } finally { fs.unlinkSync(jobFile); }
}

/* --------------------------------------------------------------- render */

const tpl = fs.readFileSync(path.join(TEMPLATES, 'catalog-year.htm'), 'utf8');
const render = (t, vars) =>
  t.replace(/\{([A-Z_]+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m));

/**
 * @param isRoot catalog/index.htm sits one level higher than catalog/<year>/,
 *               so every relative path in it is one segment shorter.
 */
function renderPage(year, entries, isRoot) {
  const up = isRoot ? '../' : '../../';
  const thumbBase = isRoot ? '' : '../';

  const items = entries.map((e) => [
    '\t\t<li>',
    '\t\t<div>',
    `\t\t\t<a href="${up}galleries/${e.rel}/">`,
    `\t\t\t<img src="${thumbBase}${e.year}/${e.month}/${e.slug}.jpg" width="${THUMB_W}" height="${THUMB_H}" alt="${escapeHtml(e.artist)}" loading="lazy" decoding="async"/>`,
    `\t\t\t<br/>${escapeHtml(e.desc)}`,
    '\t\t\t</a>',
    '\t\t</div>',
    '\t\t</li>',
  ].join('\n')).join('\n');

  const prev = allYears.filter((y) => +y < +year).pop();
  const next = allYears.filter((y) => +y > +year).shift();
  const yearHref = (y) => (isRoot ? `${y}/` : `../${y}/`);

  const nav = [
    prev ? `<a href="${yearHref(prev)}">&lt;- ${prev}</a>` : null,
    next ? `<a href="${yearHref(next)}">${next} -&gt;</a>` : null,
  ].filter(Boolean).join(' | ');

  const tail = prev
    ? `\n<div id="dcCatalogNav">\n\t<br/>\n\t<span id="catalogTitle">See more from last year, <a href="${yearHref(prev)}">${prev}</a>.</span>\n</div>\n`
    : '';

  const viewNav = isRoot
    ? `<a href="${up}festivals/index.htm">Festivals</a><!-- -or- List: <a href="${up}byartist.htm">By Artist</a>--> | <a href="${up}bydate.htm">By Date</a><!-- | <a href="${up}byvenue.htm">By Venue</a>-->`
    : `<a href="../">Thumbnail Catalog</a> | <a href="${up}festivals/index.htm">Festivals</a><!-- -or- List: <a href="${up}byartist.htm">By Artist</a>--> | <a href="${up}bydate.htm">By Date</a><!-- | <a href="${up}byvenue.htm">By Venue</a>-->`;

  const cover = entries[0];
  return render(tpl, {
    PAGETITLE: isRoot
      ? 'Concert &amp; Event Catalog | The Concert Photography of David Conger'
      : `${year} Catalog | The Concert Photography of David Conger`,
    DESCRIPTION: isRoot
      ? 'A thumbnail catalog of the concerts, festivals and events photographed by David Conger in Seattle and the Pacific Northwest.'
      : `A thumbnail catalog of the ${entries.length} concerts and events photographed by David Conger in ${year}, in Seattle and the Pacific Northwest.`,
    OGTITLE: isRoot ? 'Concert &amp; Event Catalog' : `${year} Concert &amp; Event Catalog`,
    OGIMAGE: cover ? `${SITE}/catalog/${cover.year}/${cover.month}/${cover.slug}.jpg` : `${SITE}/images/header.png`,
    CANONICAL: isRoot ? `${SITE}/catalog/` : `${SITE}/catalog/${year}/`,
    ROOT: up,
    VIEWNAV: viewNav,
    CATALOGTITLE: `${year} Catalog`,
    CATALOGNAV: nav,
    ENTRIES: items,
    TAILNAV: tail,
    COPYRIGHT: COPYRIGHT_YEAR,
  });
}

function write(file, text) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (dryRun) { console.log(`  would write ${rel}`); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  console.log(`  wrote ${rel} (${(text.length / 1024).toFixed(0)} KB)`);
}

/* ------------------------------------------------- navigation refresh
 * A newly built year has to become reachable from the year before it, which
 * was rendered when it was still the most recent one and so has a dead
 * "<next> ->" label instead of a link.
 */
function refreshNav() {
  for (const year of allYears) {
    const file = path.join(CATALOG, year, 'index.htm');
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    const prev = allYears.filter((y) => +y < +year).pop();
    const next = allYears.filter((y) => +y > +year).shift();
    const nav = [
      prev ? `<a href="../${prev}/">&lt;- ${prev}</a>` : null,
      next ? `<a href="../${next}/">${next} -&gt;</a>` : null,
    ].filter(Boolean).join(' | ');
    const updated = html.replace(
      /(<span id="catalogNav">)([\s\S]*?)(<\/span>)/,
      (m, a, body, b) => a + nav + b
    );
    if (updated === html) continue;
    if (dryRun) { console.log(`  would refresh nav in catalog/${year}/index.htm`); continue; }
    fs.writeFileSync(file, updated, 'utf8');
    console.log(`  refreshed nav in catalog/${year}/index.htm`);
  }
}

/* ------------------------------------------------------------------ run */

if (args.flags.has('nav')) {
  refreshNav();
  process.exit(0);
}

let newest = null;
for (const year of years) {
  console.log(`\n=== catalog/${year}`);
  const entries = readYear(year);
  console.log(`  ${entries.length} event(s)`);
  const undated = entries.filter((e) => !e.date);
  if (undated.length) {
    console.log(`  ${undated.length} entr(ies) have no parseable date, kept in file order`);
  }
  cutThumbnails(entries);
  write(path.join(CATALOG, year, 'index.htm'), renderPage(year, entries, false));
  if (!newest || +year > +newest.year) newest = { year, entries };
}

refreshNav();

if (args.flags.has('root') && newest) {
  console.log('\n=== catalog/index.htm');
  write(path.join(CATALOG, 'index.htm'), renderPage(newest.year, newest.entries, true));
}

if (!dryRun) {
  console.log('\n  Preview:  node tools/serve.js . 8099');
  for (const y of years) console.log(`            http://localhost:8099/catalog/${y}/`);
  console.log('\n  Then rebuild the sitemap:  node tools/build-sitemap.js');
}
