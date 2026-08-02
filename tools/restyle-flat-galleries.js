/**
 * Brings the flat legacy gallery pages onto the same design as the rest.
 *
 * These are the 750 pages at galleries/<slug>.htm -- the 2009-2012 archive,
 * and the destination of every caption on those four year pages. They predate
 * the foldered generator and share none of its structure: no #gallery, no
 * #images, just a 710px banner image, a centred <p> holding the title, and the
 * photographs laid out in a mix of <p> and two-column <table> blocks with the
 * old 5px white border, each one linking out to Flickr.
 *
 * The photographs and their links are left exactly as they are. What changes is
 * everything around them:
 *
 *   - the banner and the two &nbsp; spacers become the shared top bar and
 *     masthead
 *   - the centred title paragraph becomes #gallery > #details, so it picks up
 *     the same type treatment the foldered galleries now use
 *   - the copyright paragraph becomes the shared footer
 *   - inline borders on the photographs are stripped, since an inline style
 *     cannot be overridden from a stylesheet
 *
 * The year for the breadcrumb is read out of the first image path
 * (2010/08/slug/...); pages whose photographs are still hosted on Flickr have
 * no year to read, and simply get Home on its own.
 *
 * Idempotent. Usage:
 *   node tools/restyle-flat-galleries.js --dry [--sample 2]
 *   node tools/restyle-flat-galleries.js
 */
const fs = require('fs');
const path = require('path');
const { HOME_ICON, topBar, masthead, footer } = require('./lib/chrome');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const sample = argv.includes('--sample') ? Number(argv[argv.indexOf('--sample') + 1]) || 0 : 0;

const FONT = "<link href='https://fonts.googleapis.com/css?family=Hind:400,600' rel='stylesheet' type='text/css' />";

/* Not galleries: the year list, two superseded index pages, and two hubs whose
   thumbnails link on to the real galleries. */
const NOT_A_GALLERY = new Set([
  'index.htm', 'index_old.htm', 'featured.htm',
  'davematthewscaravan.htm', 'doormattstweetup.htm',
]);

/** Inline border declarations beat any stylesheet, so they come out of the tag. */
function stripInlineBorders(html) {
  return html.replace(/<img\b[^>]*>/gi, (tag) =>
    tag.replace(/\sstyle="([^"]*)"/i, (m, css) => {
      const kept = css
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d && !/^border/i.test(d))
        .join('; ');
      return kept ? ` style="${kept}"` : '';
    }));
}

/* The 290px table above the first photograph on most of these pages held the
   Facebook Like button and a share count. Both went years ago and what is left
   is an empty two-cell table opening a gap the size of a photograph. */
function stripEmptyTables(html) {
  return html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (block) =>
    (/<img\b|<a\b/i.test(block) ? block : ''));
}

function transform(file, html) {
  if (/css\/stream\.css/.test(html) && /class="galleryPage flatGallery"/.test(html)) return 'skip';

  /* The same markup family lives at two depths: galleries/<slug>.htm from the
     2009-2012 archive, and galleries/YYYY/MM/<slug>/index.htm from the years
     where the foldered layout was already in use but the page was still hand
     built. Everything relative is derived from the depth rather than assumed. */
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const UP = '../'.repeat(rel.split('/').length - 1);

  const bodyOpen = html.indexOf('<body');
  if (bodyOpen < 0) return null;

  let head = html.slice(0, bodyOpen);
  let rest = html.slice(bodyOpen);

  if (!/css\/site\.css/.test(head)) return null;
  head = head.replace(/(<link[^>]*css\/site\.css[^>]*>)/,
    `${FONT}\n$1\n<link rel="stylesheet" href="${UP}css/stream.css">`);
  if (!/js\/stream\.js/.test(head)) {
    head = head.replace(/<\/head>/, `<script src="${UP}js/stream.js" defer></script>\n</head>`);
  }

  // Everything from <body> through the banner link is chrome, and goes. The
  // banner links home on some pages and at the catalog on others, and two
  // pages have an empty nav and no banner at all -- there the cut runs to the
  // title instead.
  const banner = new RegExp(`<p><a href="[^"]*">\\s*<img src="${UP.replace(/\./g, '\\.')}images/header\\.png"[^>]*></a></p>`);
  const m = rest.match(banner);
  if (m) rest = rest.slice(m.index + m[0].length);

  // The centred paragraph that follows the banner is the title block.
  const title = rest.match(/<p style="text-align: center[^"]*">([\s\S]*?)<\/p>/);
  if (!title) return null;

  /* The first tag in that block is the span holding the artist, in one of
     three shapes depending on the year the page was made. Whichever it is, it
     becomes #title and picks up the same treatment as the foldered galleries.
     A handful of pages have no span at all, and there the first line is
     wrapped. */
  let details = title[1].trim();
  details = /^<span\b/.test(details)
    ? details.replace(/^<span\b[^>]*>/, '<span id="title">')
    : details.replace(/^([\s\S]*?)(<br\s*\/?>)/, '<span id="title">$1</span>$2');

  /* Foldered pages carry the year in their own path; the flat ones only reveal
     it through an image src, and those whose photographs are still on Flickr
     do not reveal it at all. */
  const year = (rel.match(/^galleries\/(20\d\d)\//) || [])[1]
    || (rest.match(/<img src="(20\d\d)\/\d\d\//) || [])[1]
    || null;
  const crumb = year
    ? `\n			<a class="crumbYear" href="${UP}galleries/${year}/" title="All ${year} galleries">${year}</a>`
    : '';
  const left = `			<a class="socialLink socialHome" href="${UP}index.htm" aria-label="Home" title="Home">${HOME_ICON}</a>${crumb}`;

  const body = html.slice(bodyOpen, html.indexOf('>', bodyOpen) + 1)
    .replace(/<body[^>]*>/, '<body class="galleryPage flatGallery">');

  let tail = rest.slice(title.index + title[0].length);
  // A few pages lost the opening <p> of the copyright block somewhere along
  // the way, so it is optional here.
  const copy = tail.match(/(?:<p>\s*)?Copyright 2008-\d{4}[\s\S]*?<\/p>/);
  if (!copy) return null;
  const photos = stripEmptyTables(stripInlineBorders(tail.slice(0, copy.index)));
  const after = tail.slice(copy.index + copy[0].length);

  return head
    + body + '\n\n'
    + topBar(UP, left) + '\n\n'
    + masthead() + '\n\n'
    + '<div id="gallery">\n<div id="details">\n' + details + '\n</div>\n'
    + '<div class="flatImages">' + photos + '</div>\n</div>\n\n'
    + footer() + after;
}

/* Walks the whole gallery tree rather than just its root: the same hand built
   markup turns up at galleries/<slug>.htm and at galleries/YYYY/MM/<slug>/.
   Pages the foldered restyler already owns are recognised by #gallery and left
   to it; galleries/0000/ holds generator templates and is not public. */
function collect(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== '0000') collect(p, out);
      continue;
    }
    if (!/\.html?$/i.test(ent.name)) continue;
    if (NOT_A_GALLERY.has(ent.name.toLowerCase())
      && path.dirname(p) === path.join(ROOT, 'galleries')) continue;
    const html = fs.readFileSync(p, 'utf8');
    if (/id="gallery"/.test(html) && !/class="galleryPage flatGallery"/.test(html)) continue;
    // The generated year stream pages are already current and are not galleries.
    if (/streamTopBar/.test(html) && !/class="galleryPage flatGallery"/.test(html)) continue;
    out.push(p);
  }
  return out;
}

const files = collect(path.join(ROOT, 'galleries'), []);

let changed = 0;
let skipped = 0;
const failed = [];
const shown = [];

for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const out = transform(f, html);
  if (out === 'skip') { skipped++; continue; }
  if (out === null) { failed.push(path.relative(ROOT, f)); continue; }
  changed++;
  if (sample && shown.length < sample) shown.push([path.relative(ROOT, f), out]);
  if (!dry) fs.writeFileSync(f, out, 'utf8');
}

console.log(`${files.length} flat page(s): ${changed} ${dry ? 'would change' : 'changed'}, ${skipped} already current, ${failed.length} failed`);
for (const f of failed) console.log('  FAILED ' + f);

for (const [name, out] of shown) {
  console.log('\n' + '='.repeat(70) + '\n' + name + '\n' + '='.repeat(70));
  const b = out.indexOf('<body');
  console.log(out.slice(b, b + 200));
  console.log('   ... [chrome] ...');
  const g = out.indexOf('<div id="gallery">');
  console.log(out.slice(g, g + 900));
  console.log('   ...');
  console.log(out.slice(-300));
}
