/**
 * Adds image structured data to the gallery pages.
 *
 * This archive's traffic is images. Someone looking for a photograph of a band
 * at the Gorge arrives through Google Images, not through a text search, and
 * until now every page told a crawler what it was only in prose: a <title>, a
 * description, and now an <h1>. None of that says "this is a set of
 * photographs, taken by this person, on this date, at this place, and here is
 * who to ask about using them".
 *
 * schema.org/ImageGallery says exactly that, and the per-image ImageObject
 * fields Google documents for image metadata -- creator, creditText,
 * copyrightNotice, acquireLicensePage -- are the ones that matter most here,
 * because they attach a name and a contact to a photograph that has been
 * lifted out of its page. The site already watermarks for the same reason;
 * this is the machine-readable half of it.
 *
 * Everything emitted is read from the page itself -- the heading, the venue and
 * date in #details, the canonical URL, and the photographs in document order --
 * so nothing here can drift out of step with what a visitor sees. Pages that do
 * not carry enough to describe get no markup rather than a guess.
 *
 * Scoped to /galleries/. The /you/ tree is private event work photographed for
 * the people in it, so it is deliberately left out of image search.
 *
 *   node tools/build-structured-data.js [--dry] [--sample N]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://www.davidconger.com';
const AUTHOR = 'David Conger';
const CREDIT = 'David Conger / davidconger.com';
const LICENSE_PAGE = `${SITE}/about.htm`;

/* A gallery of eighty frames does not need eighty ImageObjects to be
   understood, and the payload is served on every visit. The ninetieth
   percentile is thirteen photographs, so this keeps all of nearly every
   gallery while capping the outliers. */
const MAX_IMAGES = 30;

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const sampleAt = argv.indexOf('--sample');
const sample = sampleAt > -1 ? Number(argv[sampleAt + 1]) : 0;

const MARKER = 'data-dc="gallery"';

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

/** Reads an element of the #details block by id, whatever tag it uses. */
function field(html, id) {
  const m = html.match(new RegExp(`<([a-z0-9]+)[^>]+id="${id}"[^>]*>([\\s\\S]*?)</\\1>`, 'i'));
  return m ? decode(m[2]) : '';
}

/**
 * "December 19, 2019" as 2019-12-19.
 *
 * The flat pages write ordinals -- "October 21st, 2011" -- which Date refuses,
 * so the suffix comes off first. Formatted from the local date parts rather
 * than toISOString(), which would shift the day backwards for anyone west of
 * UTC.
 */
function isoDate(text) {
  if (!text) return '';
  const cleaned = text.replace(/(\d{1,2})(st|nd|rd|th)\b/gi, '$1').trim();
  if (!/\d{4}/.test(cleaned)) return '';
  const d = new Date(cleaned);
  if (isNaN(d)) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The venue and date of a flat legacy page.
 *
 * The 2009-2012 pages predate the #venue and #date spans: their details block
 * is the heading followed by loose lines separated by breaks -- a tour name, a
 * venue, a date, in no guaranteed order and not always all three. So each line
 * is tested rather than positioned. A line that parses as a date is the date;
 * of what remains, the one that looks like a place -- "Key Arena, Seattle, WA"
 * -- is the venue. A tour name matches neither and is left alone.
 */
function looseDetails(html) {
  const block = /<div id="details"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (!block) return { venue: '', date: '' };
  const lines = block[1]
    .replace(/<h1[\s\S]*?<\/h1>/i, '')
    .split(/<br\s*\/?>/i)
    .map(decode)
    .filter(Boolean);

  let venue = '';
  let date = '';
  for (const line of lines) {
    if (!date && isoDate(line)) { date = line; continue; }
    if (!venue && /,\s*[A-Za-z .]+(,\s*[A-Z]{2}\.?)?$/.test(line)) venue = line;
  }
  return { venue, date };
}

/**
 * "WaMu Theater, Seattle, WA" as a Place.
 *
 * The trailing city and state are split off when they are there and the rest is
 * the venue; anything that does not match that shape is used whole, which is
 * still truer than dropping it.
 */
function place(venue) {
  if (!venue) return null;
  const p = { '@type': 'Place' };
  const m = /^(.*?),\s*([^,]+),\s*([A-Z]{2})\.?$/.exec(venue);
  if (m) {
    p.name = m[1].trim();
    p.address = {
      '@type': 'PostalAddress',
      addressLocality: m[2].trim(),
      addressRegion: m[3],
      addressCountry: 'US',
    };
  } else {
    p.name = venue;
  }
  return p;
}

/** The photographs, in document order, as they appear below the details block. */
function photographs(html, pageUrl) {
  const body = html.slice(html.search(/<div id="gallery"|<main\b/i));
  const out = [];
  const seen = new Set();
  const re = /<img\s+([^>]*?)src="([^"]+\.jpe?g)"([^>]*)>/gi;
  let m;
  while ((m = re.exec(body))) {
    const attrs = `${m[1]} ${m[3]}`;
    const src = m[2];
    // The chrome carries its own images; only the photographs are described.
    if (/logo|banner|header|spacer|button|icon|_sm\./i.test(src)) continue;
    if (seen.has(src)) continue;
    seen.add(src);
    const alt = (/alt="([^"]*)"/i.exec(attrs) || [])[1] || '';
    const w = Number((/\bwidth="(\d+)"/i.exec(attrs) || [])[1]) || 0;
    const h = Number((/\bheight="(\d+)"/i.exec(attrs) || [])[1]) || 0;
    let url;
    try { url = new URL(src, pageUrl).href; } catch { continue; }
    out.push({ url, alt: decode(alt), width: w, height: h });
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}

function buildGraph(html, pageUrl, rel) {
  const name = field(html, 'title');
  if (!name) return null;

  // The foldered pages label the venue and date; the flat ones only lay them
  // out, so those are read back off the lines.
  const loose = looseDetails(html);
  const venue = field(html, 'venue') || loose.venue;
  const date = isoDate(field(html, 'date')) || isoDate(loose.date);
  const description = decode((/<meta[^>]+name="description"[^>]+content="([^"]*)"/i.exec(html) || [])[1] || '');

  const creator = { '@type': 'Person', name: AUTHOR, url: `${SITE}/` };
  // The archive is filed by year, so the path answers this even where the page
  // never says when it was.
  const year = (date && date.slice(0, 4)) || (/\/(\d{4})\//.exec(`/${rel}`) || [])[1] || '';
  const copyright = year
    ? `\u00a9 ${year} David Conger, LLC. All rights reserved.`
    : '\u00a9 David Conger, LLC. All rights reserved.';

  const images = photographs(html, pageUrl).map((img) => {
    const o = {
      '@type': 'ImageObject',
      contentUrl: img.url,
      creator,
      creditText: CREDIT,
      copyrightNotice: copyright,
      acquireLicensePage: LICENSE_PAGE,
    };
    if (img.alt) o.caption = img.alt;
    if (img.width && img.height) { o.width = img.width; o.height = img.height; }
    return o;
  });

  const gallery = {
    '@context': 'https://schema.org',
    '@type': 'ImageGallery',
    name: venue ? `${name} at ${venue}` : name,
    url: pageUrl,
    creator,
    copyrightHolder: { '@type': 'Organization', name: 'David Conger, LLC' },
    copyrightNotice: copyright,
    isFamilyFriendly: true,
  };
  if (description) gallery.description = description;
  if (date) gallery.datePublished = date;
  const where = place(venue);
  if (where) gallery.contentLocation = where;
  if (images.length) {
    gallery.image = images;
    gallery.numberOfItems = images.length;
  }

  return gallery;
}

const files = [];
(function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '0000' || entry.name === 'old') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (/\.htm$/i.test(entry.name)) files.push(full);
  }
})(path.join(ROOT, 'galleries'));

let changed = 0;
let replaced = 0;
let noData = 0;
let noImages = 0;
const shown = [];
let bytes = 0;

for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  if (!/<h1[^>]*id="title"/i.test(html)) continue;

  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const canonical = (/<link rel="canonical" href="([^"]+)"/i.exec(html) || [])[1];
  if (!canonical) { noData++; continue; }

  const graph = buildGraph(html, canonical, rel);
  if (!graph) { noData++; continue; }
  if (!graph.image) noImages++;

  const json = JSON.stringify(graph, null, 1).replace(/</g, '\\u003c');
  const block = `<script type="application/ld+json" ${MARKER}>\r\n${json}\r\n</script>`;

  const existing = new RegExp(`[ \\t]*<script type="application/ld\\+json" ${MARKER}>[\\s\\S]*?</script>\\r?\\n?`, 'i');
  let out;
  if (existing.test(html)) {
    out = html.replace(existing, `${block}\r\n`);
    if (out !== html) replaced++;
  } else {
    // The tree is CRLF throughout, and a handful of heads end in a bare LF.
    // Emitting the block's own line endings rather than echoing whichever was
    // found is what makes a second run a no-op instead of a whitespace churn.
    out = html.replace(/\r?\n<\/head>/i, `\r\n${block}\r\n</head>`);
    if (out !== html) changed++;
  }
  if (out === html) continue;

  bytes += block.length;

  if (shown.length < sample) shown.push({ file: path.relative(ROOT, file), json });
  if (!dry) fs.writeFileSync(file, out);
}

for (const s of shown) console.log(`  ${s.file}\n${s.json.split('\n').map((l) => `      ${l}`).join('\n')}\n`);

console.log(`  gallery pages       : ${files.length}`);
console.log(`  markup added        : ${changed}${dry ? ' (dry run, nothing written)' : ''}`);
console.log(`  markup refreshed    : ${replaced}`);
console.log(`  no photographs      : ${noImages}`);
console.log(`  too little to say   : ${noData}`);
console.log(`  average block       : ${changed + replaced ? Math.round(bytes / (changed + replaced)) : 0} bytes`);
