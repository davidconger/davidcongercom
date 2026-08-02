/**
 * Builds the "year stream" pages -- galleries/<year>/index.htm -- one page per
 * year of the archive. Nothing under catalog/ or you/ is touched, and no
 * existing URL is taken: /galleries/<year>/ was an unused level between the
 * gallery index and the per-month folders.
 *
 * What these pages replace: the thumbnail catalog as the destination for
 * "Concert & Event Photos". A year is a scrollable column of full 640px frames,
 * two per row on a desktop and one on a phone, each carrying a caption and an
 * optional small rotator for a second or third frame from that show.
 *
 * The part that needed proving is the caption. It used to be a flat grey panel
 * whose real job is covering the burned-in davidconger.com watermark. Here it
 * is tinted to the photograph behind it: the bottom-right of each frame is
 * measured at build time, and the result becomes a diagonal gradient -- light
 * in the corner where the panel meets the photograph, opaque by the time it
 * reaches the watermark -- plus a text colour chosen for contrast. Doing it at
 * build time keeps the output static: no canvas, no CORS, no flash of grey
 * before the tint lands.
 *
 * Usage:
 *   node tools/build-stream.js --year 2019 --year 2020
 *   node tools/build-stream.js --year 2019 --photos 4
 *
 * Options:
 *   --year <yyyy>  year to build; repeatable
 *   --photos N     maximum frames per show, default 3
 *   --limit N      only the first N shows, for a quick look
 *   --index-only   rebuild galleries/index.htm alone
 *   --nav-only     rewrite the year bar on the existing year pages and stop.
 *                  A full run re-samples every frame and takes minutes; when
 *                  only the navigation markup has changed there is nothing to
 *                  re-sample, and the sampled caption tints already on those
 *                  pages are left exactly as they are.
 */
const fs = require('fs');
const path = require('path');
const { sampleColors, captionStyle } = require('./lib/caption');
const { CHEVRON_LEFT, CHEVRON_RIGHT, CHEVRON_UP, CHEVRON_DOWN, topBar, homeLink, masthead, footer } = require('./lib/chrome');

const ROOT = path.resolve(__dirname, '..');
// The year pages live alongside the galleries they index, at
// /galleries/<year>/. Nothing occupied that path before -- the archive only
// ever had /galleries/<year>/<month>/<slug>/ -- so this adds a URL rather than
// taking one, and it makes each year the natural parent of the shows beneath
// it, which is what lets a gallery page link back up with a plain "../../".
const OUT = path.join(ROOT, 'galleries');
const SITE = 'https://www.davidconger.com';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const argv = process.argv.slice(2);
const years = [];
let maxPhotos = 3;
let limit = Infinity;
// The year list is assembled from the year pages already on disk, so it can be
// rebuilt on its own without re-sampling six thousand frames.
const indexOnly = argv.includes('--index-only');
const navOnly = argv.includes('--nav-only');
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--year') years.push(argv[++i]);
  else if (argv[i] === '--photos') maxPhotos = Number(argv[++i]);
  else if (argv[i] === '--limit') limit = Number(argv[++i]);
}
if (!years.length && !indexOnly && !navOnly) { console.error('Usage: node tools/build-stream.js --year 2019 [--year 2020] [--photos 3] | --index-only | --nav-only'); process.exit(1); }

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decodeHtml = (s) => String(s)
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Reads a JPEG's dimensions straight from its SOF marker. */
function jpegSize(file) {
  const buf = fs.readFileSync(file);
  let i = 2;
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/* ------------------------------------------------------------- source data */

function eventDate(desc) {
  const m = /([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})\s*$/.exec(desc);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1]);
  if (mon < 0) return null;
  return { y: +m[3], m: mon + 1, d: +m[2], text: `${m[1]} ${+m[2]}, ${m[3]}` };
}

/* --------------------------------------------------------------- venue name

   The caption shows the venue alone -- "WaMu Theater", not "WaMu Theater,
   Seattle, WA". Descriptions are written as "Artist[, Tour], Venue, City, ST",
   so the venue is usually third from last, but a good number of entries omit
   the city ("Ho Ngoc Ha, Snoqualmie Casino, WA") and positional counting picks
   the artist or the tour name out of those instead.

   So the venue names are learned from the corpus first. The well-formed
   entries are unambiguous, and there are only around 140 distinct venues
   across sixteen years, so the ambiguous entries can be resolved by looking
   for a venue the archive already knows about.
   -------------------------------------------------------------------------- */

const STATE = /^[A-Z]{2}$/;
const DATE_TAIL = /,?\s*[A-Z][a-z]+\s+\d{1,2},\s*\d{4}\s*$/;
let venueVocab = null;

/** Description -> comma-separated parts, with the trailing date removed. */
function headParts(desc) {
  let head = String(desc).replace(DATE_TAIL, '');
  const cut = head.lastIndexOf('.');
  if (cut > 0) head = head.slice(0, cut);
  return head.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Strips the "Seattle, WA" / "Seattle WA" tail, however it is punctuated. */
function dropPlace(parts) {
  if (parts.length > 2 && STATE.test(parts[parts.length - 1])) return parts.slice(0, -2);
  if (parts.length > 1 && /\s+[A-Z]{2}$/.test(parts[parts.length - 1])) return parts.slice(0, -1);
  return parts;
}

/**
 * Learns which names are venues and which are cities by counting where each
 * one lands across the whole catalog. In a well-formed entry the city sits
 * second from last and the venue third from last; the malformed ones shift
 * everything one place left. Since venues and cities both repeat heavily over
 * sixteen years -- Snoqualmie Casino appears 676 times -- whichever position a
 * name lands in more often is the position it really occupies.
 */
function venueVocabulary() {
  if (venueVocab) return venueVocab;
  const asVenue = new Map();
  const asPlace = new Map();
  const bump = (map, key) => { if (key) map.set(key, (map.get(key) || 0) + 1); };

  const catalog = path.join(ROOT, 'catalog');
  if (fs.existsSync(catalog)) {
    for (const year of fs.readdirSync(catalog, { withFileTypes: true })) {
      if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) continue;
      const dataDir = path.join(catalog, year.name, '_data');
      if (!fs.existsSync(dataDir)) continue;
      for (const f of fs.readdirSync(dataDir)) {
        if (!/\.txt$/i.test(f)) continue;
        for (const line of fs.readFileSync(path.join(dataDir, f), 'utf8').split(/\r?\n/)) {
          const desc = line.split(';')[0].trim();
          if (!desc) continue;
          const parts = headParts(desc);
          if (parts.length < 3 || !STATE.test(parts[parts.length - 1])) continue;
          bump(asPlace, parts[parts.length - 2]);
          if (parts.length > 3) bump(asVenue, parts[parts.length - 3]);
        }
      }
    }
  }

  venueVocab = new Set();
  for (const [name, n] of asVenue) if (n > (asPlace.get(name) || 0)) venueVocab.add(name);
  return venueVocab;
}

/** "Artist, Venue, City, ST. Month D, YYYY" -> artist, venue and date. */
function splitDescription(desc) {
  const date = eventDate(desc);
  const parts = headParts(desc);
  const artist = parts[0] || String(desc);

  // A name the archive already knows to be a venue beats counting positions,
  // because entries that omit the city shift every position by one.
  const known = venueVocabulary();
  for (let i = parts.length - 1; i > 0; i--) {
    if (known.has(parts[i])) return { artist, venue: parts[i], date };
  }

  const trimmed = dropPlace(parts);
  return { artist, venue: trimmed.length > 1 ? trimmed[trimmed.length - 1] : '', date };
}

/* The catalog data for 2016 and 2017 was recorded without venues. Its entries
   read "Pretenders, Seattle, WA. December 11, 2016", where every other year
   writes "Pretenders, KeyArena, Seattle, WA. ...", so 28 shows across those two
   years lost the middle line of their caption.

   The gallery page itself never lost it, so the venue is taken from there. Its
   #venue field is the archive's structured record of the venue and is written
   "<Venue>[, <Complex>], <City>, <ST>", which makes the venue the first part.
   The og:description is tried second, because a handful of pages phrase it as
   "performs at X on Friday, ..." rather than the "X at Y in Z on <date>" shape
   descriptionFromGallery can read, and a few older pages have no #venue at all.

   Only the venue is taken. The catalog stays authoritative for the artist, the
   date and the order shows appear in, because it is the source the rest of the
   page is built from and disagreeing with it halfway would be worse than a
   missing line. */
function venueFromGalleryPage(rel) {
  const file = path.join(ROOT, 'galleries', rel, 'index.htm');
  if (!fs.existsSync(file)) return '';
  const m = /<span id="venue">([^<]*)<\/span>/i.exec(fs.readFileSync(file, 'utf8'));
  if (!m) return '';

  const parts = decodeHtml(m[1]).split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return '';

  // "Seattle, WA" on its own names a city, not a venue, and calling a show's
  // venue "Seattle" would read worse than showing no venue at all.
  if (parts.length < 3 && /^[A-Z]{2}$/.test(parts[parts.length - 1])) return '';
  return parts[0];
}

function describeShow(rel, desc) {
  const parsed = splitDescription(desc);
  if (parsed.venue) return parsed;

  const direct = venueFromGalleryPage(rel);
  if (direct) return { ...parsed, venue: direct };

  const fromGallery = descriptionFromGallery(rel);
  if (!fromGallery) return parsed;

  const venue = splitDescription(fromGallery).venue;
  return venue ? { ...parsed, venue } : parsed;
}

function descriptionFromGallery(rel) {
  const file = path.join(ROOT, 'galleries', rel, 'index.htm');
  if (!fs.existsSync(file)) return null;
  const og = /<meta property="og:description" content="([^"]*)"/.exec(fs.readFileSync(file, 'utf8'));
  if (!og) return null;
  const text = decodeHtml(og[1]).trim().replace(/\.\s*$/, '');
  const m = /^(.*?) at (.*?) in (.*?) on ([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(text);
  return m ? `${m[1]}, ${m[2]}, ${m[3]}. ${m[4]} ${Number(m[5])}, ${m[6]}` : null;
}

// The 2009 galleries are only folders of JPEGs: no per-gallery page, no
// catalog data, and no og:description anywhere. What does exist is the flat
// legacy page the slug used to point at, whose <title> reads
// "Katy Perry at KISS-FM | Seattle | davidconger.com". That is enough for an
// artist and a venue, which is what the caption is mostly made of. No date is
// recorded anywhere for these shows, so they carry none rather than an invented
// one -- the caption already handles a missing line, as 51 venue-less shows do.
//
// The city is deliberately dropped. Elsewhere the archive writes places as
// "Seattle, WA", and the venue classifier leans on that trailing state to tell
// a place from a venue; a bare "Seattle" gets mistaken for the venue and wins,
// so Katy Perry ends up playing Seattle rather than KISS-FM. Adding the state
// back would be a guess, and not every show here is in Washington.
function descriptionFromLegacyPage(slug) {
  const file = path.join(ROOT, 'galleries', `${slug}.htm`);
  if (!fs.existsSync(file)) return null;
  const t = /<title>([^<]*)<\/title>/i.exec(fs.readFileSync(file, 'utf8'));
  if (!t) return null;

  const parts = decodeHtml(t[1]).split('|').map((s) => s.trim())
    .filter((s) => s && !/^davidconger\.com$/i.test(s));
  if (!parts.length) return null;

  const head = /^(.*?) at (?:the )?(.+)$/i.exec(parts[0]);
  const artist = head ? head[1].trim() : parts[0];
  const venue = head ? head[2].trim() : '';
  if (!artist) return null;

  return [artist, venue].filter(Boolean).join(', ');
}

function shows(year) {
  const byRel = new Map();

  // The catalog data for 2010 and 2011 refers to each show by a flat legacy
  // page -- "joenichols.htm" -- left over from before galleries were foldered
  // by month. The frames themselves did get moved, so the show is really at
  // galleries/2010/01/joenichols/; only the reference was never rewritten.
  // Indexing the year's folders by slug lets those two years resolve, which is
  // some 500 shows that would otherwise be dropped from the stream entirely.
  const base = path.join(ROOT, 'galleries', year);
  const bySlug = new Map();
  if (fs.existsSync(base)) {
    for (const m of fs.readdirSync(base, { withFileTypes: true })) {
      if (!m.isDirectory()) continue;
      for (const s of fs.readdirSync(path.join(base, m.name), { withFileTypes: true })) {
        if (!s.isDirectory()) continue;
        if (!bySlug.has(s.name)) bySlug.set(s.name, `${year}/${m.name}/${s.name}`);
      }
    }
  }

  const resolve = (raw) => {
    const rel = raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/index\.html?$/i, '');
    if (/^\d{4}\//.test(rel)) return rel;
    const slug = rel.replace(/\.html?$/i, '').split('/').pop();
    return bySlug.get(slug) || null;
  };

  const dataDir = path.join(ROOT, 'catalog', year, '_data');
  if (fs.existsSync(dataDir)) {
    for (const f of fs.readdirSync(dataDir).filter((x) => /\.txt$/i.test(x)).sort()) {
      fs.readFileSync(path.join(dataDir, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (!line.trim()) return;
        const p = line.split(';').map((s) => s.trim());
        const rel = resolve(p[1] || '');
        if (p[0] && rel) byRel.set(rel, { desc: p[0], order: `${f}:${String(i).padStart(5, '0')}` });
      });
    }
  }
  if (fs.existsSync(base)) {
    for (const m of fs.readdirSync(base, { withFileTypes: true })) {
      if (!m.isDirectory()) continue;
      for (const s of fs.readdirSync(path.join(base, m.name), { withFileTypes: true })) {
        if (!s.isDirectory()) continue;
        const rel = `${year}/${m.name}/${s.name}`;
        if (byRel.has(rel)) continue;
        const d = descriptionFromGallery(rel) || descriptionFromLegacyPage(s.name);
        if (d) byRel.set(rel, { desc: d, order: `zzz:${rel}` });
      }
    }
  }

  const out = [];
  for (const [rel, v] of byRel) {
    const dir = path.join(ROOT, 'galleries', rel);
    // The catalog data for the early years lists some shows as a flat legacy
    // page -- "joenichols.htm" rather than "2009/07/joenichols" -- which exists
    // but is a file, not a folder of frames. Those pre-date the current gallery
    // layout and have no directory to read, so they are skipped rather than
    // crashing the walk.
    let stat = null;
    try { stat = fs.statSync(dir); } catch { /* missing */ }
    if (!stat || !stat.isDirectory()) continue;
    const files = fs.readdirSync(dir)
      .filter((f) => /\.jpe?g$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    // Landscape only, and every frame in a show must be exactly the same size.
    // The slides after the first are absolutely positioned over the frame the
    // first one sizes, so a frame with a different ratio renders at a
    // different height and drags the caption off the bottom of the picture --
    // which uncovers the watermark the caption exists to hide. Rather than
    // trust the first file, the sizes are counted and the largest matching set
    // wins, so an odd lead frame costs that show its rotator instead of
    // costing every other frame its alignment.
    const candidates = [];
    for (const f of files) {
      const size = jpegSize(path.join(dir, f));
      if (!size || size.width <= size.height) continue;
      candidates.push({ file: f, ...size });
    }
    if (!candidates.length) continue;

    const bySize = new Map();
    for (const c of candidates) {
      const key = `${c.width}x${c.height}`;
      if (!bySize.has(key)) bySize.set(key, []);
      bySize.get(key).push(c);
    }
    let best = null;
    for (const group of bySize.values()) {
      if (!best || group.length > best.length) best = group;
    }
    const frames = best.slice(0, maxPhotos);
    if (!frames.length) continue;

    // Where the caption should point. Most shows have a gallery page inside
    // their own folder, but the 2009 galleries are bare folders of frames whose
    // page is the flat legacy file at galleries/<slug>.htm. Linking to the
    // folder there gives a directory with no index, so the destination is
    // resolved here rather than assumed. A show with neither is dropped: a
    // caption that goes nowhere is worse than one frame fewer on the page.
    const slug = rel.split('/').pop();
    let href;
    if (fs.existsSync(path.join(dir, 'index.htm'))) href = `${rel}/`;
    else if (fs.existsSync(path.join(ROOT, 'galleries', `${slug}.htm`))) href = `${slug}.htm`;
    else continue;

    out.push({ rel, href, ...describeShow(rel, v.desc), desc: v.desc, order: v.order, frames });
  }

  out.sort((a, b) => {
    const k = (x) => (x.date ? x.date.y * 10000 + x.date.m * 100 + x.date.d : 0);
    return k(b) - k(a) || (a.order < b.order ? -1 : 1);
  });
  return out.slice(0, limit);
}

/* ------------------------------------------------------------------ render */

function renderShow(show, colors) {
  // The page sits at galleries/<year>/, which is the parent of every show it
  // lists, so frames and galleries are addressed by the part of the path below
  // the year. The exceptions are the 2009-era shows whose page is a flat file
  // at galleries/<slug>.htm, one level up.
  const within = (p) => p.replace(/^\d{4}\//, '');
  const href = /^\d{4}\//.test(show.href) ? within(show.href) : `../${show.href}`;
  const many = show.frames.length > 1;

  // The photograph advances the rotator and the caption is the way through to
  // the gallery. Clicking a picture to see the next picture is the obvious
  // reading of a stack of frames, and it leaves the caption -- which is already
  // the only text on the frame -- to carry the navigation.
  const caption = (i) => `
					<a class="showCaption" href="${href}"${i === 0 ? '' : ' tabindex="-1"'}>
						<span class="showArtist">${escapeHtml(show.artist)}</span>${show.venue ? `<span class="showVenue">${escapeHtml(show.venue)}</span>` : ''}
						${show.date ? `<span class="showDate">${escapeHtml(show.date.text)}</span>` : ''}
					</a>`;
  const slides = show.frames.map((f, i) => {
    // The ramp runs corner to corner, from the panel's top-left to its
    // bottom-right, so it carries an alpha shift as well as a colour one: open
    // where the panel meets the photograph, opaque by the time it reaches the
    // burned-in watermark in the bottom-right. See tools/lib/caption.js.
    const style = captionStyle(colors.get(path.join(ROOT, 'galleries', show.rel, f.file)));
    return `				<div class="showSlide${i === 0 ? ' is-active' : ''}" style="${style}"${i === 0 ? '' : ' aria-hidden="true"'}>
					<img src="${within(show.rel)}/${f.file}" width="${f.width}" height="${f.height}" alt="${escapeHtml(show.artist)}" loading="lazy" decoding="async">${caption(i)}
				</div>`;
  }).join('\n');

  const dots = many ? `
			<div class="showDots" role="tablist" aria-label="More frames from this show">
${show.frames.map((f, i) => `				<button type="button" role="tab" data-index="${i}" aria-selected="${i === 0}" aria-label="Frame ${i + 1} of ${show.frames.length}"></button>`).join('\n')}
			</div>` : '';

  return `		<li class="show${many ? ' has-rotator' : ''}">
			<div class="showFrame">
${slides}
			</div>${dots}
		</li>`;
}

/* The year bar on a year page: an arrow either side and the year between them.

   The arrows are the common move -- one year back, one year forward -- and they
   say where you are without being asked. The jump to a distant year is the
   rarer one, so it hides behind the year itself: clicking it opens a short list
   of every year, positioned so the year you are already on stays exactly where
   it was and the others appear around it. Nothing in the bar moves, which is
   what makes it read as the same control opening rather than a new one arriving.

   The year is still a plain link to the list of all years, so the bar works
   with no JavaScript at all; the script takes the click over once it has wired
   the list up. */
function renderYearNav(year, available) {
  const prev = available.filter((y) => +y < +year).pop();
  const next = available.filter((y) => +y > +year).shift();

  // Newest first, matching the order the index puts the years in.
  const items = available.slice().reverse().map((y) => (y === year
    ? `<li><a class="yearMenuItem is-current" href="../${y}/" aria-current="page">${y}</a></li>`
    : `<li><a class="yearMenuItem" href="../${y}/">${y}</a></li>`)).join('\n\t\t\t\t\t');
  return `<nav class="yearNav" aria-label="Year">
		${prev
      ? `<a class="yearStep" href="../${prev}/" rel="prev" aria-label="${prev}" title="${prev}">${CHEVRON_LEFT}</a>`
      : `<span class="yearStep is-disabled" aria-hidden="true">${CHEVRON_LEFT}</span>`}
		<div class="yearPick">
			<a class="yearLabel" href="../" title="All years">${year}</a>
			<div class="yearMenu" id="yearMenu" hidden>
				<span class="yearMenuStep is-up" aria-hidden="true">${CHEVRON_UP}</span>
				<ul class="yearMenuList">
					${items}
				</ul>
				<span class="yearMenuStep is-down" aria-hidden="true">${CHEVRON_DOWN}</span>
				<a class="yearMenuAll" href="../">All years</a>
			</div>
		</div>
		${next
      ? `<a class="yearStep" href="../${next}/" rel="next" aria-label="${next}" title="${next}">${CHEVRON_RIGHT}</a>`
      : `<span class="yearStep is-disabled" aria-hidden="true">${CHEVRON_RIGHT}</span>`}
	</nav>`;
}

function renderYear(year, list, colors, available) {
  const up = '../../';

  // A year page's description is worth more than "photographs from 2019" -- the
  // names on it are what anyone would actually search for -- so the first few
  // artists go into the description and the social card.
  const names = [];
  for (const s of list) {
    if (names.length >= 6) break;
    if (s.artist && !names.includes(s.artist)) names.push(s.artist);
  }
  const summary = names.length
    ? `${list.length} concerts and events photographed by David Conger in ${year}, including ${names.join(', ')}.`
    : `Concerts and events photographed by David Conger in ${year}.`;
  const lead = list.length ? `${list[0].rel}/${list[0].frames[0].file}` : '';



  // Arrows either side to step a year at a time, and the year itself as the way
  // into any other year. The arrows answer "the one before this" without a
  // click; the picker answers "take me to 2013" without twelve.
  const yearNav = renderYearNav(year, available);

  return `<!DOCTYPE html>
<html lang="en">

<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">

<title>${year} Concert &amp; Event Photos | The Concert Photography of David Conger</title>
<meta name="description" content="${escapeHtml(summary)}">
<link rel="canonical" href="${SITE}/galleries/${year}/">

<link href='https://fonts.googleapis.com/css?family=Hind:400,600' rel='stylesheet' type='text/css' />
<link rel="stylesheet" href="${up}css/site.css">
<link rel="stylesheet" href="${up}css/stream.css">
<meta property="og:title" content="${year} Concert &amp; Event Photos" />
<meta property="og:description" content="${escapeHtml(summary)}" />
<meta property="og:url" content="${SITE}/galleries/${year}/" />${lead ? `
<meta property="og:image" content="${SITE}/galleries/${lead}" />` : ''}
<meta property="og:type" content="website" />
<meta property="og:site_name" content="www.davidconger.com" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:site" content="@dcongerphoto" />
<script src="${up}js/stream.js" defer></script>
<script src="${up}js/azureinsights.js" defer></script>
</head>

<body>

${topBar(up, homeLink(up))}

${masthead()}

<div class="yearBar">
	${yearNav}
</div>

<main class="stream">
	<ul class="showGrid">
${list.map((s) => renderShow(s, colors)).join('\n')}
	</ul>
</main>


${footer()}

</body>

</html>
`;
}

/* ---------------------------------------------------------------- year list */

/**
 * The landing page at /galleries/ -- one card per year, newest first.
 *
 * It reads the year pages back off disk rather than taking the years built in
 * this run, so a single-year rebuild leaves it correct instead of shrinking it
 * to one entry. Everything it needs is already in the markup: the lead frame,
 * its caption tint, and how many shows the year holds.
 */
/**
 * The year list at /galleries/.
 *
 * Every year is one card carrying a rotator of frames from that year, so the
 * page is a set of moving photographs rather than a list of links -- the same
 * thing a year page is, one level up.
 *
 * The frames come from two places. First choice is js/featured-images.json,
 * which is the hand-picked pool the home page rotates through and already
 * carries a measured caption tint per image. Where a year has fewer than seven
 * picks, the rest are taken from the year's own page: the lead frame of each
 * show, with the tint it was built with. Nothing is re-sampled, so the index
 * costs nothing to rebuild.
 *
 * It reads the year pages back off disk rather than from the build's own data,
 * so rebuilding a single year leaves the index whole instead of shrinking it to
 * that one year.
 */
const CARD_FRAMES = 7;

function featuredByYear() {
  const file = path.join(ROOT, 'js', 'featured-images.json');
  const out = new Map();
  if (!fs.existsSync(file)) return out;
  for (const it of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    const m = /^galleries\/(\d{4})\//.exec(it.image || '');
    if (!m || !it.width || !it.height) continue;
    const cap = it.cap || [];
    if (!out.has(m[1])) out.set(m[1], []);
    out.get(m[1]).push({
      src: it.image.replace(/^galleries\//, ''),
      width: it.width,
      height: it.height,
      style: cap.length === 3 ? `--cap-top:${cap[0]};--cap-bot:${cap[1]};--cap-fg:${cap[2]}` : '',
    });
  }
  return out;
}

function renderIndex() {
  const years = fs.readdirSync(OUT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name))
    .map((e) => e.name)
    .filter((y) => fs.existsSync(path.join(OUT, y, 'index.htm')))
    .sort()
    .reverse();
  if (!years.length) return null;

  const featured = featuredByYear();

  const cards = years.map((year) => {
    const html = fs.readFileSync(path.join(OUT, year, 'index.htm'), 'utf8');

    // Every show's lead frame, with the tint that year page was built with.
    const fromYear = [];
    const re = /<div class="showSlide is-active" style="([^"]*)">\s*<img src="([^"]+)" width="(\d+)" height="(\d+)"/g;
    let m;
    while ((m = re.exec(html))) {
      fromYear.push({ style: m[1], src: `${year}/${m[2]}`, width: Number(m[3]), height: Number(m[4]) });
    }
    if (!fromYear.length) return '';

    // Every slide in a card is stacked on the first one, so they all have to
    // be the same shape or the caption moves when the rotator advances. The
    // lead frame decides, and anything a different size is passed over.
    const shape = `${fromYear[0].width}x${fromYear[0].height}`;
    const fits = (f) => `${f.width}x${f.height}` === shape;

    const picks = [];
    const seen = new Set();
    for (const f of [...(featured.get(year) || []).map((f) => ({ ...f, src: `${year}/${f.src.replace(/^\d{4}\//, '')}` })), ...fromYear]) {
      if (picks.length >= CARD_FRAMES || seen.has(f.src) || !fits(f)) continue;
      seen.add(f.src);
      picks.push(f);
    }

    // The caption is the only way in, so it says so: the word, then the year,
    // underlined the way a link is.
    const caption = (i) => `
					<a class="showCaption yearCaption" href="${year}/"${i === 0 ? '' : ' tabindex="-1"'}>
						<span class="yearCaptionLead">View</span><span class="yearCaptionYear">${year}</span>
					</a>`;

    const slides = picks.map((f, i) => `				<div class="showSlide${i === 0 ? ' is-active' : ''}" style="${f.style}"${i === 0 ? '' : ' aria-hidden="true"'}>
					<img src="${f.src}" width="${f.width}" height="${f.height}" alt="${year}" loading="lazy" decoding="async">${caption(i)}
				</div>`).join('\n');

    const many = picks.length > 1;
    const dots = many ? `
			<div class="showDots" role="tablist" aria-label="More frames from ${year}">
${picks.map((f, i) => `				<button type="button" role="tab" data-index="${i}" aria-selected="${i === 0}" aria-label="Frame ${i + 1} of ${picks.length}"></button>`).join('\n')}
			</div>` : '';

    return `		<li class="show${many ? ' has-rotator' : ''}">
			<div class="showFrame">
${slides}
			</div>${dots}
		</li>`;
  }).filter(Boolean).join('\n');

  const up = '../';
  const span = `${years[years.length - 1]}\u2013${years[0]}`;
  const summary = `Every concert and event gallery by David Conger, ${span}, one page per year.`;

  return `<!DOCTYPE html>
<html lang="en">

<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">

<title>Concert &amp; Event Photos | The Concert Photography of David Conger</title>
<meta name="description" content="${escapeHtml(summary)}">
<link rel="canonical" href="${SITE}/galleries/">

<link href='https://fonts.googleapis.com/css?family=Hind:400,600' rel='stylesheet' type='text/css' />
<link rel="stylesheet" href="${up}css/site.css">
<link rel="stylesheet" href="${up}css/stream.css">
<meta property="og:title" content="Concert &amp; Event Photos" />
<meta property="og:description" content="${escapeHtml(summary)}" />
<meta property="og:url" content="${SITE}/galleries/" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="www.davidconger.com" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:site" content="@dcongerphoto" />
<script src="${up}js/stream.js" defer></script>
<script src="${up}js/azureinsights.js" defer></script>
</head>

<body>

${topBar(up, homeLink(up))}

${masthead()}

<div class="yearBar">
	<nav class="yearNav" aria-label="Year">
		<span class="yearLabel is-static">Concert &amp; Event Photo Galleries</span>
	</nav>
</div>

<main class="stream">
	<ul class="showGrid">
${cards}
	</ul>
</main>


${footer()}

</body>

</html>
`;
}

/* Which years exist, not which are being rebuilt. A run for a single year
   still has to know what sits either side of it: passing the run's own list
   here is what left 2020 with both arrows greyed out and no way back to 2019. */
function knownYears(building) {
  const onDisk = fs.readdirSync(OUT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name)
      && fs.existsSync(path.join(OUT, e.name, 'index.htm')))
    .map((e) => e.name);
  return [...new Set([...onDisk, ...building])].sort();
}

/* --------------------------------------------------------------------- run */

fs.mkdirSync(OUT, { recursive: true });
const built = [];
const data = new Map();

/* Rewriting only the bar. The year pages are otherwise expensive to produce --
   a full run measures the corner of every frame in the archive -- and the
   caption tints those measurements produced are already sitting in the files.
   Replacing the one block that changed leaves them untouched. */
if (navOnly) {
  const available = knownYears([]);
  let changed = 0;
  for (const year of available) {
    const file = path.join(OUT, year, 'index.htm');
    const before = fs.readFileSync(file, 'utf8');
    const after = before.replace(
      /<nav class="yearNav" aria-label="Year">[\s\S]*?<\/nav>/,
      () => renderYearNav(year, available)
    );
    if (!/<nav class="yearNav"/.test(before)) { console.error(`  ! galleries/${year}/index.htm: year bar not found`); continue; }
    if (after === before) { console.log(`  galleries/${year}/index.htm unchanged`); continue; }
    fs.writeFileSync(file, after, 'utf8');
    changed++;
    console.log(`  rewrote the year bar on galleries/${year}/index.htm`);
  }
  console.log(`\n${changed} of ${available.length} year page(s) changed.`);
  console.log(`\n  http://localhost:8099/galleries/`);
  return;
}

if (!indexOnly) {
  for (const year of years) {
    const list = shows(year);
    console.log(`\n=== ${year}: ${list.length} show(s), ${list.reduce((n, s) => n + s.frames.length, 0)} frame(s)`);
    data.set(year, list);
    built.push(year);
  }

  const allPaths = [];
  for (const list of data.values()) {
    for (const s of list) for (const f of s.frames) allPaths.push(path.join(ROOT, 'galleries', s.rel, f.file));
  }
  console.log(`\nsampling caption colours for ${allPaths.length} frame(s)...`);
  const colors = sampleColors(allPaths);

  const available = knownYears(built);
  for (const year of built) {
    const dir = path.join(OUT, year);
    fs.mkdirSync(dir, { recursive: true });
    const html = renderYear(year, data.get(year), colors, available);
    fs.writeFileSync(path.join(dir, 'index.htm'), html, 'utf8');
    console.log(`  wrote galleries/${year}/index.htm (${(html.length / 1024).toFixed(0)} KB)`);
  }
}

const indexHtml = renderIndex();
if (indexHtml) {
  fs.writeFileSync(path.join(OUT, 'index.htm'), indexHtml, 'utf8');
  console.log(`  wrote galleries/index.htm (${(indexHtml.length / 1024).toFixed(0)} KB)`);
}

/* The home page sends "Concert & Event Photos" straight to the newest year
   rather than to the list of years: someone arriving at the front door wants
   photographs, not a menu, and the year they almost certainly want is the last
   one shot. Retargeting it here means adding a year folder moves the link on
   its own, instead of leaving the front page pointing at a year that is no
   longer the newest. */
const newest = knownYears(built).slice(-1)[0];
if (newest) {
  const home = path.join(ROOT, 'index.htm');
  const before = fs.readFileSync(home, 'utf8');
  const after = before.replace(
    /(<a href=")galleries\/(?:\d{4}\/)?(">Concert &amp; Event Photos<\/a>)/,
    `$1galleries/${newest}/$2`
  );
  if (after !== before) {
    fs.writeFileSync(home, after, 'utf8');
    console.log(`  pointed the home page at galleries/${newest}/`);
  }
}

console.log(`\n  http://localhost:8099/galleries/`);
