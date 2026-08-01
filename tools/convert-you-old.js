/**
 * Converts the 2009-2011 you_old archive into the current /you/ structure.
 *
 * you_old is the original "Photos of You" system. It was served by an ASP.NET
 * app on a separate subdomain (you.davidconger.com/<event>/index.aspx) that no
 * longer resolves, and the tree was never migrated when /you/ was rebuilt --
 * you/previous.htm starts at 2013. Nothing under you_old/ is reachable on the
 * live site today, so this conversion is purely additive: it cannot break an
 * existing URL because there are no existing URLs to break.
 *
 * What survives per event:
 *
 *   you_old/<YYYY>-<MM>-<slug>/tp/*.jpg   display copies, 400-700px
 *   you_old/<YYYY>-<MM>-<slug>/sm/*.jpg   thumbnails, already exactly 240x160
 *
 * Both sets use identical filenames, and 240x160 is the size the current /you/
 * templates want, so the images are copied through untouched rather than
 * re-encoded (tp/ is the largest copy that exists -- there are no originals).
 *
 * Titles and cover images come from you_old/index.htm, the only surviving
 * listing. Dates are known to month precision only: the folder name encodes
 * YYYY-MM and the day of the event was never recorded anywhere in the tree.
 *
 * Page generation is delegated to new-gallery.js so there is one definition of
 * the /you/ markup.
 *
 * Usage:
 *
 *   node tools/convert-you-old.js --list
 *   node tools/convert-you-old.js --only 2011-05-hot-chelle-rae
 *   node tools/convert-you-old.js --all
 *
 * Options:
 *   --list          show what would be converted and exit
 *   --only <folder> convert a single you_old event folder
 *   --all           convert every event folder
 *   --no-listing    do not add entries to you/previous.htm
 *   --force         overwrite event folders that already exist
 *   --dry-run       report what would happen, write nothing
 *
 * you_old/private/ is never converted. Those folders were given deliberately
 * obfuscated names because they were meant to stay unlisted.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'you_old');
const LISTING = path.join(ROOT, 'you', 'previous.htm');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/* Events whose display title never made it into you_old/index.htm -- both are
 * linked there by thumbnail only, with no anchor text to recover. */
const TITLE_FALLBACK = {
  '2010-07-the-maine': 'The Maine Meet-And-Greet',
  '2010-09-john-legend': 'John Legend Meet-And-Greet',
};

/* ------------------------------------------------------------------- args */

function parseArgs(argv) {
  const out = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out.flags.add(key);
    else { out[key] = next; i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const dryRun = args.flags.has('dry-run');

if (!args.only && !args.flags.has('all') && !args.flags.has('list')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ ?\* ?/gm, ''));
  process.exit(0);
}

function fail(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}

/* --------------------------------------------------- metadata recovery */

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const stripTags = (s) =>
  s.replace(/<[^>]+>/g, '')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Pulls display titles and cover thumbnails out of the old listing page. */
function readOldIndex() {
  const html = fs.readFileSync(path.join(SRC, 'index.htm'), 'utf8');
  const titles = {}, covers = {};
  // Some entries link with /index.aspx and some without, and the anchor text
  // wraps across lines, so match the whole anchor and clean it up afterwards.
  const re = /<a href="https?:\/\/you\.davidconger\.com\/([^/"]+)\/?(?:index\.aspx)?"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const folder = m[1];
    const img = /<img[^>]+src="[^"]*?([^/"]+\.jpe?g)"/i.exec(m[2]);
    if (img && !covers[folder]) covers[folder] = img[1];
    const text = stripTags(m[2]);
    if (text && !titles[folder]) titles[folder] = text;
  }
  return { titles, covers };
}

const { titles, covers } = readOldIndex();

const jpgs = (dir) => {
  try {
    return fs.readdirSync(dir)
      .filter((f) => /\.jpe?g$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  } catch { return []; }
};

function collect() {
  const events = [];
  for (const d of fs.readdirSync(SRC, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const m = /^(\d{4})-(\d{2})-(.+)$/.exec(d.name);
    if (!m) continue; // skips private/ and the leftover template folders
    const [, year, month, slug] = m;
    const tp = jpgs(path.join(SRC, d.name, 'tp'));
    const sm = jpgs(path.join(SRC, d.name, 'sm'));
    const cover = covers[d.name];
    const coverIndex = cover ? tp.indexOf(cover) + 1 : 0;
    events.push({
      folder: d.name,
      year,
      month,
      slug,
      title: titles[d.name] || TITLE_FALLBACK[d.name] || '',
      guessedTitle: !titles[d.name],
      date: `${MONTHS[+month - 1]} ${year}`,
      tp,
      sm,
      // The old listing recorded which frame was the cover; keep that choice
      // when the file is still present, otherwise fall back to the first photo.
      cover: coverIndex > 0 ? coverIndex : 1,
      coverKept: coverIndex > 0,
    });
  }
  return events.sort((a, b) => (a.folder < b.folder ? 1 : -1)); // newest first
}

let events = collect();

if (args.only) {
  const one = events.find((e) => e.folder === args.only);
  if (!one) fail(`No you_old event folder named "${args.only}"`);
  events = [one];
}

/* ------------------------------------------------------------------ list */

if (args.flags.has('list')) {
  console.log('\n  folder'.padEnd(48) + 'photos  cover  date'.padEnd(24) + 'title');
  for (const e of events) {
    console.log(
      '  ' + e.folder.padEnd(44) +
      String(e.tp.length).padStart(6) +
      String(e.cover).padStart(7) + (e.coverKept ? ' ' : '*') + '  ' +
      e.date.padEnd(16) +
      e.title + (e.guessedTitle ? '  (title not recorded, supplied)' : '')
    );
  }
  console.log(`\n  ${events.length} event(s), ${events.reduce((a, e) => a + e.tp.length, 0)} photos`);
  console.log('  * cover frame no longer present in tp/, defaulted to the first photo');
  process.exit(0);
}

/* -------------------------------------------------------------- convert */

const done = [];

for (const e of events) {
  if (!e.title) fail(`No title recoverable for ${e.folder}; add one to TITLE_FALLBACK.`);
  if (!e.tp.length) fail(`${e.folder} has no images in tp/`);

  const missing = e.tp.filter((f) => !e.sm.includes(f));
  if (missing.length) fail(`${e.folder}: ${missing.length} file(s) in tp/ have no thumbnail in sm/ (e.g. ${missing[0]})`);

  const target = path.join(ROOT, 'you', e.year, e.slug);
  if (fs.existsSync(target) && !args.flags.has('force') && !dryRun) {
    console.log(`  skip  you/${e.year}/${e.slug}/ already exists (use --force to replace)`);
    continue;
  }

  const argv = [
    path.join(__dirname, 'new-gallery.js'),
    '--source', path.join(SRC, e.folder, 'tp'),
    '--presized', path.join(SRC, e.folder, 'sm'),
    '--artist', e.title,
    '--date', `${e.year}-${e.month}`,
    '--slug', e.slug,
    '--year', e.year,
    '--cover', String(e.cover),
    '--courtesy', '',
    // These predate the current listing by more than a decade, so they belong
    // in the previous-events archive, not on the front /you/ page.
    '--no-listing',
  ];
  if (args.flags.has('force')) argv.push('--force');
  if (dryRun) argv.push('--dry-run');

  console.log(`\n=== ${e.folder} -> you/${e.year}/${e.slug}/`);
  execFileSync(process.execPath, argv, { stdio: 'inherit', cwd: ROOT });
  done.push(e);
}

/* ------------------------------------------- you/previous.htm insertion */

if (!args.flags.has('no-listing') && done.length && !dryRun) {
  let html = fs.readFileSync(LISTING, 'utf8');
  const EOL = html.includes('\r\n') ? '\r\n' : '\n';
  const added = [];

  // done is newest-first; insert oldest-first so that each new line lands
  // directly under its year header and the section ends up newest-first.
  for (const e of [...done].reverse()) {
    const href = `${e.year}/${e.slug}/`;
    if (html.includes(`href="${href}"`)) continue;

    // Month precision only, so the line reads MM.YYYY rather than inventing a
    // day the archive never recorded.
    const line = `\t${e.month}.${e.year}: <a href="${href}">${escapeHtml(e.title)}</a><br />`;

    const header = new RegExp(`<span class="yearHeader">${e.year}</span><br />`);
    if (header.test(html)) {
      html = html.replace(header, (m) => `${m}${EOL}${line}`);
    } else {
      // New year section. Sections run newest first, so insert before the first
      // existing header for an older year, otherwise after the last entry.
      const headers = [...html.matchAll(/\t<br \/>\r?\n\t<span class="yearHeader">(\d{4})<\/span><br \/>\r?\n/g)];
      const block = `\t<br />${EOL}\t<span class="yearHeader">${e.year}</span><br />${EOL}${line}${EOL}`;
      const older = headers.find((h) => +h[1] < +e.year);
      if (older) {
        html = html.slice(0, older.index) + block + html.slice(older.index);
      } else {
        // Fall back to the close of the listing container, which is the last
        // </div> before the footer.
        const footer = html.indexOf('<p class="siteFooter">');
        const end = html.lastIndexOf('</div>', footer < 0 ? html.length : footer);
        if (end < 0) fail('Could not find the end of the listing in you/previous.htm');
        html = html.slice(0, end) + block + html.slice(end);
      }
    }
    added.push(line.trim());
  }

  if (added.length) {
    // Insertion order depends on which events were converted in which run, so
    // normalise every touched section to newest-first rather than relying on
    // the sequence of writes.
    for (const year of [...new Set(done.map((e) => e.year))]) {
      const head = `<span class="yearHeader">${year}</span><br />`;
      const at = html.indexOf(head);
      if (at < 0) continue;
      const from = at + head.length;
      const stop = html.indexOf('\t<br />', from);
      const endOfSection = stop < 0 ? html.indexOf('</div>', from) : stop;
      const body = html.slice(from, endOfSection);
      const lines = body.split(/\r?\n/).filter((l) => l.trim());
      const key = (l) => {
        const m = /^\s*(\d{2})\.(?:(\d{2})\.)?(\d{4}):/.exec(l);
        return m ? `${m[3]}${m[1]}${m[2] || '00'}` : '0';
      };
      lines.sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
      html = html.slice(0, from) + EOL + lines.join(EOL) + EOL + html.slice(endOfSection);
    }

    fs.writeFileSync(LISTING, html, 'utf8');
    console.log(`\n  you/previous.htm: added ${added.length} entr${added.length === 1 ? 'y' : 'ies'}`);
  } else {
    console.log('\n  you/previous.htm: already lists these events, left unchanged.');
  }
}

/* -------------------------------------------------------------- summary */

if (done.length) {
  console.log(`\n  ${dryRun ? 'would convert' : 'converted'} ${done.length} event(s), ` +
    `${done.reduce((a, e) => a + e.tp.length, 0)} photos`);
  if (!dryRun) {
    console.log('\n  Preview:  node tools/serve.js . 8099');
    for (const e of done.slice(0, 3)) {
      console.log(`            http://localhost:8099/you/${e.year}/${e.slug}/`);
    }
    console.log('\n  Then rebuild the sitemap:  node tools/build-sitemap.js');
  }
}
