/**
 * SEO and accessibility pass over the archive.
 *
 * The bulk modernization in phases 4/5 fixed the markup but left three gaps that
 * only showed up once `audit-seo.js` and `audit-alt.js` were pointed at the
 * finished site:
 *
 *  - 4 of 9,567 pages had a <meta name="description">;
 *  - 332 <title> values were duplicated, in one case across 172 pages, because
 *    every photo in an event repeated the event's title verbatim;
 *  - 16,434 images had no alt text, almost all of them in /you/.
 *
 * All three are fixable from metadata the pages already carry: gallery pages
 * embed `<span id="title">`, `<span id="venue">` and `<span id="date">`. This
 * script reads those and fills in the head and the alt attributes. It changes
 * nothing that is visible on screen.
 *
 *   node tools/seo-pass.js [--dry-run] [--limit N] [subdir ...]
 *
 * Idempotent: re-running it makes no further changes.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://www.davidconger.com';
const SKIP_DIRS = new Set(['1cnf', '1pvt', '.git', 'node_modules', 'tools']);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx > -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const flagValues = new Set([limitIdx].filter((i) => i > -1).map((i) => i + 1));
const roots = args.filter((a, i) => !a.startsWith('--') && !flagValues.has(i));

const decode = (s) => s
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&ndash;/g, '\u2013').replace(/&mdash;/g, '\u2014')
  .replace(/\s+/g, ' ')
  .trim();

const escapeAttr = (s) => s
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Pulls the artist / venue / date the gallery templates already emit. */
function details(html) {
  // The title ships as an <h1> and the other two as spans, so the element is
  // matched by its id rather than its tag.
  const grab = (id) => {
    const m = html.match(new RegExp(`<([a-z0-9]+)[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)</\\1>`, 'i'));
    return m ? decode(m[2]) : '';
  };
  return { title: grab('title'), venue: grab('venue'), date: grab('date') };
}

/**
 * The photo number, for pages that show a single frame from an event.
 *
 * "page-2.htm" is a paginated grid of thumbnails, not a photo, so it is
 * excluded here and disambiguated as a page instead.
 */
function photoNumber(file) {
  const base = path.basename(file);
  if (/^page-\d+\.html?$/i.test(base)) return null;
  const m = base.match(/-(\d+)\.html?$/i);
  return m ? String(parseInt(m[1], 10)) : null;
}

/** The grid number, for the paginated thumbnail listings of a large event. */
function listingPageNumber(file) {
  const m = path.basename(file).match(/^page-(\d+)\.html?$/i);
  return m ? String(parseInt(m[1], 10)) : null;
}

function canonicalFor(file) {
  let rel = path.relative(ROOT, file).replace(/\\/g, '/');
  rel = rel.replace(/(^|\/)index\.html?$/i, '$1');
  return ORIGIN + '/' + rel.split('/').map(encodeURIComponent).join('/');
}

/** An existing hand-written og:description is better copy than anything this
 *  script can generate, so it wins over the generated sentence.
 *
 *  The content is captured with a backreference to the opening quote rather
 *  than a [^"']* class: an apostrophe inside a double-quoted attribute is a
 *  perfectly ordinary character, and matching against both quote characters
 *  silently truncated every description containing one ("Photos of Guns N"). */
function existingOgDescription(html) {
  const m = html.match(/<meta[^>]+property\s*=\s*["']og:description["'][^>]*content\s*=\s*(["'])([\s\S]*?)\1/i)
    || html.match(/<meta[^>]+content\s*=\s*(["'])([\s\S]*?)\1[^>]*property\s*=\s*["']og:description["']/i);
  return m && m[2].trim() ? decode(m[2]) : null;
}

/** First photograph on the page, as an absolute URL, for og:image. */
function firstPhoto(file, html) {
  for (const m of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const src = m[1];
    if (!/\.jpe?g$/i.test(src)) continue;
    if (/\/icons?\//i.test(src)) continue;
    if (/^https?:/i.test(src)) return src;
    const abs = path.resolve(path.dirname(file), src.replace(/\//g, path.sep));
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    if (rel.startsWith('..')) continue;
    return ORIGIN + '/' + rel.split('/').map(encodeURIComponent).join('/');
  }
  return null;
}

/**
 * The handful of landing pages that carry no gallery metadata of their own.
 * Three of them shipped with the home page's exact <title>, so search engines
 * could not tell them apart, and the catalog's title still said "2017".
 * Keyed by site-relative path.
 */
const LANDING_PAGES = {
  'bydate.htm': {
    title: 'Concert Galleries by Date | David Conger Photography | Seattle, WA',
    description: 'Browse the full archive of concert, festival and event photo galleries by date, from 2008 to today.',
  },
  'bydate_older.htm': {
    title: 'Older Concert Galleries by Date | David Conger Photography | Seattle, WA',
    description: 'The earlier years of the concert and event photography archive, listed by date.',
  },
  'byartist.htm': {
    title: 'Concert Galleries by Artist | David Conger Photography | Seattle, WA',
    description: 'Browse the concert and event photography archive alphabetically by artist, covering hundreds of shows a year since 2008.',
  },
  'byvenue.htm': {
    title: 'Concert Galleries by Venue | David Conger Photography | Seattle, WA',
    description: 'Browse the concert and event photography archive by venue across Seattle and the Pacific Northwest.',
  },
  'catalog/index.htm': {
    title: 'Concert & Event Catalog | The Concert Photography of David Conger',
    description: 'A thumbnail catalog of the concerts, festivals and events photographed by David Conger in Seattle and the Pacific Northwest.',
  },
  'festivals/index.htm': {
    description: 'Festival photography by David Conger, including Bumbershoot, Warped Tour, Watershed, Summer Jam and Jingle Bell Bash.',
  },
  'you/index.htm': {
    description: 'Meet and greet photos from recent events. Find your event, then find and download your photo.',
  },
  'you/previous.htm': {
    title: 'Previous Meet and Greet Photos | David Conger Photography | Seattle, WA',
    description: 'Meet and greet photo galleries from previous events, covering 2013 through 2023.',
  },
  'galleries/featured.htm': {
    title: 'Featured Photographs | David Conger Photography | Seattle, WA',
  },
};

function buildDescription(file, d, photoNo, listingNo) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const isYou = /^you\//i.test(rel);
  if (!d.title) return null;

  const when = d.date ? ` on ${d.date}` : '';
  const page = listingNo ? `, page ${listingNo}` : '';

  if (isYou) {
    // /you/ venues read "Meet and Greet at Snoqualmie Casino", so the location
    // already carries its own preposition once the prefix is stripped.
    const where = d.venue ? ' ' + d.venue.replace(/^Meet and Greet\s*/i, '').trim() : '';
    return photoNo
      ? `Photo ${photoNo} from the ${d.title} meet and greet${where}${when}. Event photography by David Conger, Seattle.`
      : `Meet and greet photos with ${d.title}${where}${when}${page}. Event photography by David Conger, Seattle.`;
  }

  // Concert galleries store a bare venue, e.g. "WaMu Theater, Seattle, WA".
  const where = d.venue ? ` at ${d.venue}` : '';
  return photoNo
    ? `Photo ${photoNo} of ${d.title}${where}${when}. Concert photography by David Conger, Seattle.`
    : `Photos of ${d.title}${where}${when}${page}. Concert photography by David Conger, Seattle.`;
}

/**
 * Marks a photo page's title as distinct from the event's own title.
 *
 * The photo number alone is not enough: an artist who plays the same venue
 * several times produces several "Photo 2" pages, so the event date goes in too.
 * Any suffix added by an earlier run is stripped first, which keeps the
 * transform idempotent even when this rule changes.
 */
function uniqueTitle(title, photoNo, date, listingNo) {
  // Split on the site-name separator first. Stripping with a single regex was
  // too greedy and swallowed the space before the pipe, which made the
  // transform non-idempotent.
  const i = title.indexOf(' | ');
  const head = (i === -1 ? title : title.slice(0, i))
    .replace(/\s\u2014 (?:Photo|Page) \d+.*$/, '');
  const tail = i === -1 ? '' : title.slice(i);

  let suffix = '';
  if (photoNo) suffix = date ? ` \u2014 Photo ${photoNo}, ${date}` : ` \u2014 Photo ${photoNo}`;
  else if (listingNo) suffix = date ? ` \u2014 Page ${listingNo}, ${date}` : ` \u2014 Page ${listingNo}`;

  return head + suffix + tail;
}

/**
 * Normalizes the pipe separators in a <title>.
 *
 * The 2016-era generator emitted "Artist at Venue | Seattle, WA, | Site name",
 * leaving a dangling comma before the separator on 70 pages.
 */
function tidyTitle(title) {
  return title
    .replace(/\s*,\s*\|/g, ' |')
    .replace(/\|\s*\|/g, '|')
    .replace(/[\s,|]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Adds alt text to gallery images that have none. */
function addAltText(html, d, isYou) {
  if (!d.title) return html;
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    if (/\balt\s*=/i.test(tag)) return tag;
    const src = (tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    // Site chrome (icons, banners, buttons) is handled by modernize.js; only
    // photographs are named after the event.
    if (!/\.(jpe?g)$/i.test(src)) return tag;
    if (/\/icons?\//i.test(src) || /header\.png$/i.test(src)) return tag;

    const n = (src.match(/-(\d+)(?:_sm)?\.jpe?g$/i) || [])[1];
    let alt;
    if (isYou) {
      const venue = d.venue ? d.venue.replace(/^Meet and Greet\s*/i, '') : '';
      alt = n ? `${d.title} meet and greet, photo ${parseInt(n, 10)}` : `${d.title} meet and greet ${venue}`.trim();
    } else {
      alt = n ? `${d.title}, photo ${parseInt(n, 10)}` : d.title;
    }
    return tag.replace(/\s*\/?>$/, (end) => ` alt="${escapeAttr(alt)}"${end}`);
  });
}

function transform(file, html) {
  const hasHead = /<head[\s>]/i.test(html);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const isYou = /^you\//i.test(rel);
  const d = details(html);
  const photoNo = photoNumber(file);
  const listingNo = listingPageNumber(file);
  let out = html;

  out = addAltText(out, d, isYou);

  if (hasHead) {
    const landing = LANDING_PAGES[rel] || {};

    // Unique <title> for the per-photo pages, and for the landing pages that
    // shipped with a stale or duplicated one.
    out = out.replace(/<title[^>]*>([\s\S]*?)<\/title>/i, (m0, t) => {
      const next = landing.title || uniqueTitle(tidyTitle(decode(t)), photoNo, d.date, listingNo);
      return `<title>${escapeAttr(next).replace(/&quot;/g, '"')}</title>`;
    });

    // <meta name="description">, only where the page carries enough metadata to
    // say something true. A vague description is worse than none.
    if (!/<meta[^>]+name\s*=\s*["']description["']/i.test(out)) {
      const desc = landing.description || existingOgDescription(out) || buildDescription(file, d, photoNo, listingNo);
      if (desc) {
        out = out.replace(/(<title[^>]*>[\s\S]*?<\/title>)/i,
          `$1\n<meta name="description" content="${escapeAttr(desc)}">`);
      }
    } else if (listingNo) {
      // An earlier run mistook the paginated thumbnail grids for photo pages and
      // described them as "Photo N from ...". Only that generated shape is
      // replaced, so hand-written copy is left alone.
      const desc = buildDescription(file, d, null, listingNo);
      if (desc) {
        const stale = /((?:name|property)\s*=\s*["'](?:description|og:description)["'][^>]*content\s*=\s*")Photo \d+ (?:from|of) [^"]*(")/gi;
        out = out.replace(stale, `$1${escapeAttr(desc)}$2`);
      }
    }

    // Canonical URL, so /path/ and /path/index.htm are not treated as two pages.
    if (!/<link[^>]+rel\s*=\s*["']canonical["']/i.test(out)) {
      const href = canonicalFor(file);
      const anchor = out.match(/<meta[^>]+name\s*=\s*["']description["'][^>]*>/i)
        || out.match(/<title[^>]*>[\s\S]*?<\/title>/i);
      if (anchor) {
        out = out.replace(anchor[0], `${anchor[0]}\n<link rel="canonical" href="${escapeAttr(href)}">`);
      }
    }

    // OpenGraph, so a shared link shows the photograph rather than a bare URL.
    // Only added where the page has real metadata to describe itself with.
    if (!/<meta[^>]+property\s*=\s*["']og:/i.test(out)) {
      const desc = (out.match(/<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*(["'])([\s\S]*?)\1/i) || [])[2];
      const ogTitle = d.title
        ? (d.venue ? `${d.title} \u2014 ${d.venue}` : d.title)
        : null;
      if (ogTitle && desc) {
        const image = firstPhoto(file, out);
        const tags = [
          `<meta property="og:type" content="website">`,
          `<meta property="og:title" content="${escapeAttr(ogTitle)}">`,
          `<meta property="og:description" content="${escapeAttr(decode(desc))}">`,
          `<meta property="og:url" content="${escapeAttr(canonicalFor(file))}">`,
        ];
        if (image) tags.push(`<meta property="og:image" content="${escapeAttr(image)}">`);
        const anchor = out.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*>/i);
        if (anchor) out = out.replace(anchor[0], `${anchor[0]}\n${tags.join('\n')}`);
      }
    }
  }
  return out;
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

const targets = roots.length
  ? files.filter((f) => roots.some((r) => path.relative(ROOT, f).replace(/\\/g, '/').startsWith(r.replace(/\\/g, '/'))))
  : files;

let changed = 0;
let altAdded = 0;
let descAdded = 0;
let canonAdded = 0;
let titleAdded = 0;
let ogAdded = 0;
let n = 0;

for (const file of targets) {
  if (n++ >= limit) break;
  const before = fs.readFileSync(file, 'utf8');
  const hadBom = before.charCodeAt(0) === 0xfeff;
  const after = transform(file, before);
  if (after === before) continue;
  changed++;

  const countAlt = (s) => (s.match(/\balt\s*=/gi) || []).length;
  altAdded += countAlt(after) - countAlt(before);
  if (!/name="description"/i.test(before) && /name="description"/i.test(after)) descAdded++;
  if (!/rel="canonical"/i.test(before) && /rel="canonical"/i.test(after)) canonAdded++;
  if (!/property="og:/i.test(before) && /property="og:/i.test(after)) ogAdded++;
  if ((before.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]
      !== (after.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]) titleAdded++;

  if (!dryRun) {
    fs.writeFileSync(file, hadBom && after.charCodeAt(0) !== 0xfeff ? '\ufeff' + after : after, 'utf8');
  }
}

console.log(`  pages considered   : ${targets.length}`);
console.log(`  pages changed      : ${changed}`);
console.log(`  alt attributes     : +${altAdded}`);
console.log(`  descriptions       : +${descAdded}`);
console.log(`  canonical links    : +${canonAdded}`);
console.log(`  OpenGraph blocks   : +${ogAdded}`);
console.log(`  titles made unique : ${titleAdded}`);
if (dryRun) console.log('\n  Dry run; nothing written.');
