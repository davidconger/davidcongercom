/**
 * PROTOTYPE -- builds the "year stream" concept into _proto/, which is excluded
 * from the sitemap and from deployment. Nothing under catalog/ or you/ is
 * touched.
 *
 * The idea being tested: replace the thumbnail catalog as the destination for
 * "Concert & Event Photos" with a scrollable year of full 640px frames, two per
 * row on a desktop and one on a phone, each carrying the homepage-style caption
 * and an optional small rotator for a second or third frame from that show.
 *
 * The part that needs proving is the caption. Today it is a flat grey panel
 * whose real job is covering the burned-in davidconger.com watermark. Here it
 * is tinted to the photograph behind it: sample-overlay-colors.ps1 measures the
 * bottom-right of each frame at build time, and the result becomes a diagonal
 * gradient -- light in the corner where the panel meets the photograph, opaque
 * by the time it reaches the watermark -- plus a text colour chosen for
 * contrast. Doing it at build time keeps the output static: no canvas, no CORS,
 * no flash of grey before the tint lands.
 *
 * Usage:
 *   node tools/build-stream.js --year 2019 --year 2020
 *   node tools/build-stream.js --year 2019 --photos 4
 *
 * Options:
 *   --year <yyyy>  year to build; repeatable
 *   --photos N     maximum frames per show, default 3
 *   --limit N      only the first N shows, for a quick look
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '_proto', 'stream');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const argv = process.argv.slice(2);
const years = [];
let maxPhotos = 3;
let limit = Infinity;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--year') years.push(argv[++i]);
  else if (argv[i] === '--photos') maxPhotos = Number(argv[++i]);
  else if (argv[i] === '--limit') limit = Number(argv[++i]);
}
if (!years.length) { console.error('Usage: node tools/build-stream.js --year 2019 [--year 2020] [--photos 3]'); process.exit(1); }

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

function descriptionFromGallery(rel) {
  const file = path.join(ROOT, 'galleries', rel, 'index.htm');
  if (!fs.existsSync(file)) return null;
  const og = /<meta property="og:description" content="([^"]*)"/.exec(fs.readFileSync(file, 'utf8'));
  if (!og) return null;
  const text = decodeHtml(og[1]).trim().replace(/\.\s*$/, '');
  const m = /^(.*?) at (.*?) in (.*?) on ([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(text);
  return m ? `${m[1]}, ${m[2]}, ${m[3]}. ${m[4]} ${Number(m[5])}, ${m[6]}` : null;
}

function shows(year) {
  const byRel = new Map();
  const dataDir = path.join(ROOT, 'catalog', year, '_data');
  if (fs.existsSync(dataDir)) {
    for (const f of fs.readdirSync(dataDir).filter((x) => /\.txt$/i.test(x)).sort()) {
      fs.readFileSync(path.join(dataDir, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (!line.trim()) return;
        const p = line.split(';').map((s) => s.trim());
        const rel = (p[1] || '').replace(/\\/g, '/').replace(/\/index\.html?$/i, '');
        if (p[0] && rel) byRel.set(rel, { desc: p[0], order: `${f}:${String(i).padStart(5, '0')}` });
      });
    }
  }
  const base = path.join(ROOT, 'galleries', year);
  if (fs.existsSync(base)) {
    for (const m of fs.readdirSync(base, { withFileTypes: true })) {
      if (!m.isDirectory()) continue;
      for (const s of fs.readdirSync(path.join(base, m.name), { withFileTypes: true })) {
        if (!s.isDirectory()) continue;
        const rel = `${year}/${m.name}/${s.name}`;
        if (byRel.has(rel)) continue;
        const d = descriptionFromGallery(rel);
        if (d) byRel.set(rel, { desc: d, order: `zzz:${rel}` });
      }
    }
  }

  const out = [];
  for (const [rel, v] of byRel) {
    const dir = path.join(ROOT, 'galleries', rel);
    if (!fs.existsSync(dir)) continue;
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
    out.push({ rel, ...splitDescription(v.desc), desc: v.desc, order: v.order, frames });
  }

  out.sort((a, b) => {
    const k = (x) => (x.date ? x.date.y * 10000 + x.date.m * 100 + x.date.d : 0);
    return k(b) - k(a) || (a.order < b.order ? -1 : 1);
  });
  return out.slice(0, limit);
}

/* -------------------------------------------------------- overlay sampling */

function sampleColors(paths) {
  if (!paths.length) return new Map();
  const jobFile = path.join(os.tmpdir(), `dc-sample-${process.pid}.json`);
  const outFile = path.join(os.tmpdir(), `dc-sample-out-${process.pid}.json`);
  fs.writeFileSync(jobFile, JSON.stringify(paths), 'utf8');
  try {
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'sample-overlay-colors.ps1'),
      '-JobFile', jobFile, '-OutFile', outFile,
      // Matches the caption's own footprint: bottom 18% of the frame, right
      // 40%. Sampling a wider region than the panel actually covers pulls the
      // tint toward parts of the photograph the viewer can still see, which is
      // exactly what makes the join visible.
      '-CropTop', '0.82', '-CropLeft', '0.60'], { stdio: 'inherit' });
    const raw = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    return new Map((Array.isArray(raw) ? raw : [raw]).map((r) => [r.path, r]));
  } finally {
    for (const f of [jobFile, outFile]) if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

/**
 * Turns a sampled colour into a caption fill.
 *
 * Two deliberate moves. First a partial desaturation, because a single
 * saturated stage light at the bottom of the frame would otherwise produce a
 * violently magenta caption. Second a push toward black or white depending on
 * which side of mid-grey the sample sits, which is what keeps the text legible
 * without abandoning the photograph's own colour.
 */
/**
 * Turns a sampled colour into a caption fill.
 *
 * Two problems to solve. A single saturated stage light produces a violently
 * coloured panel, so the chroma is capped -- but by scaling the spread rather
 * than washing every sample out by a fixed amount, which is what a flat
 * desaturation did. A muted photograph keeps its colour; only the extreme ones
 * are pulled back. The panel then moves toward black or white depending on what
 * it is covering, far enough to stay readable and no further.
 */
function captionFill(rgb, lum, alpha) {
  const MAX_CHROMA = 60;
  const mean = (rgb[0] + rgb[1] + rgb[2]) / 3;
  const dark = lum <= 0.5;
  const target = dark ? 0 : 255;
  const pull = dark ? 0.46 : 0.4;
  const spread = Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]);
  const damp = spread > MAX_CHROMA ? MAX_CHROMA / spread : 1;
  const c = rgb.map((v) => {
    const toned = mean + (v - mean) * damp;
    return Math.round(toned + (target - toned) * pull);
  });
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}

/* ------------------------------------------------------------------ render */

function renderShow(show, colors) {
  const up = '../../../';
  const href = `${up}galleries/${show.rel}/`;
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
    const abs = path.join(ROOT, 'galleries', show.rel, f.file);
    const c = colors.get(abs);
    const lum = c ? c.lum : 0.2;
    const style = c
      // The ramp runs corner to corner, from the panel's top-left to its
      // bottom-right, so it can carry an alpha shift as well as a colour one:
      // open where the panel meets the photograph, opaque by the time it
      // reaches the burned-in watermark in the bottom-right. --cap-top is
      // sampled from the upper half of the panel's footprint and --cap-bot
      // from the lower half.
      //
      // --cap-bot must stay at 0.99 or above. That end of the ramp is the only
      // thing masking the wordmark; the stylesheet's backdrop-filter helps but
      // cannot be relied on, because any ancestor stacking context disables it
      // without warning. See the long note in stream.css.
      ? `--cap-top:${captionFill(c.top, lum, 0.5)};--cap-bot:${captionFill(c.bottom, lum, 0.995)};--cap-fg:${lum <= 0.5 ? 'rgba(255,255,255,.88)' : 'rgba(17,17,17,.86)'}`
      : '';
    return `				<div class="showSlide${i === 0 ? ' is-active' : ''}" style="${style}"${i === 0 ? '' : ' aria-hidden="true"'}>
					<img src="${up}galleries/${show.rel}/${f.file}" width="${f.width}" height="${f.height}" alt="${escapeHtml(show.artist)}" loading="lazy" decoding="async">${caption(i)}
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

function renderYear(year, list, colors, available) {
  const prev = available.filter((y) => +y < +year).pop();
  const next = available.filter((y) => +y > +year).shift();
  const up = '../../../';

  const CHEVRON_LEFT = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M15.5303 4.21967C15.8232 4.51256 15.8232 4.98744 15.5303 5.28033L8.81066 12L15.5303 18.7197C15.8232 19.0126 15.8232 19.4874 15.5303 19.7803C15.2374 20.0732 14.7626 20.0732 14.4697 19.7803L7.21967 12.5303C6.92678 12.2374 6.92678 11.7626 7.21967 11.4697L14.4697 4.21967C14.7626 3.92678 15.2374 3.92678 15.5303 4.21967Z"/></svg>';
  const CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8.46967 4.21967C8.17678 4.51256 8.17678 4.98744 8.46967 5.28033L15.1893 12L8.46967 18.7197C8.17678 19.0126 8.17678 19.4874 8.46967 19.7803C8.76256 20.0732 9.23744 20.0732 9.53033 19.7803L16.7803 12.5303C17.0732 12.2374 17.0732 11.7626 16.7803 11.4697L9.53033 4.21967C9.23744 3.92678 8.76256 3.92678 8.46967 4.21967Z"/></svg>';

  // Fluent's home glyph, regular and filled, swapped on hover exactly as the
  // mail icon is -- so the one navigation control on the page reads as part of
  // the same set as the social links rather than as leftover text.
  const HOME_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path class="iconRegular" fill="currentColor" d="M10.5495 2.53189C11.3874 1.82531 12.6126 1.82531 13.4505 2.5319L20.2005 8.224C20.7074 8.65152 21 9.2809 21 9.94406L21 19.2539C21 20.2204 20.2165 21.0039 19.25 21.0039H15.75C14.7835 21.0039 14 20.2204 14 19.2539L14 14.2468C14 14.1088 13.8881 13.9968 13.75 13.9968H10.25C10.1119 13.9968 9.99999 14.1088 9.99999 14.2468L9.99999 19.2539C9.99999 20.2204 9.2165 21.0039 8.25 21.0039H4.75C3.7835 21.0039 3 20.2204 3 19.2539V9.94406C3 9.2809 3.29255 8.65152 3.79952 8.224L10.5495 2.53189ZM12.4835 3.6786C12.2042 3.44307 11.7958 3.44307 11.5165 3.6786L4.76651 9.37071C4.59752 9.51321 4.5 9.72301 4.5 9.94406L4.5 19.2539C4.5 19.392 4.61193 19.5039 4.75 19.5039H8.25C8.38807 19.5039 8.49999 19.392 8.49999 19.2539L8.49999 14.2468C8.49999 13.2803 9.2835 12.4968 10.25 12.4968H13.75C14.7165 12.4968 15.5 13.2803 15.5 14.2468L15.5 19.2539C15.5 19.392 15.6119 19.5039 15.75 19.5039H19.25C19.3881 19.5039 19.5 19.392 19.5 19.2539L19.5 9.94406C19.5 9.72301 19.4025 9.51321 19.2335 9.37071L12.4835 3.6786Z"/><path class="iconFilled" fill="currentColor" d="M13.4508 2.53318C12.6128 1.82618 11.3872 1.82618 10.5492 2.53318L3.79916 8.22772C3.29241 8.65523 3 9.28447 3 9.94747V19.2526C3 20.2191 3.7835 21.0026 4.75 21.0026H7.75C8.7165 21.0026 9.5 20.2191 9.5 19.2526V15.25C9.5 14.5707 10.0418 14.018 10.7169 14.0004H13.2831C13.9582 14.018 14.5 14.5707 14.5 15.25V19.2526C14.5 20.2191 15.2835 21.0026 16.25 21.0026H19.25C20.2165 21.0026 21 20.2191 21 19.2526V9.94747C21 9.28447 20.7076 8.65523 20.2008 8.22772L13.4508 2.53318Z"/></svg>';

  // Arrows rather than a list of adjacent years: the control says which year
  // you are in and which way to go, and nothing else.
  const yearNav = `<nav class="yearNav" aria-label="Year">
		${prev
      ? `<a class="yearStep" href="../${prev}/" rel="prev" aria-label="${prev}" title="${prev}">${CHEVRON_LEFT}</a>`
      : `<span class="yearStep is-disabled" aria-hidden="true">${CHEVRON_LEFT}</span>`}
		<span class="yearLabel">${year}</span>
		${next
      ? `<a class="yearStep" href="../${next}/" rel="next" aria-label="${next}" title="${next}">${CHEVRON_RIGHT}</a>`
      : `<span class="yearStep is-disabled" aria-hidden="true">${CHEVRON_RIGHT}</span>`}
	</nav>`;

  return `<!DOCTYPE html>
<html lang="en">

<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">

<title>${year} Concert &amp; Event Photos | The Concert Photography of David Conger</title>
<meta name="description" content="Concerts and events photographed by David Conger in ${year}.">

<link href='https://fonts.googleapis.com/css?family=Hind:400,600' rel='stylesheet' type='text/css' />
<link rel="stylesheet" href="${up}css/site.css">
<link rel="stylesheet" href="../stream.css">
<script src="../stream.js" defer></script>
</head>

<body>

<div class="streamTopBar">
	<div class="streamBar topBarInner">
		<div class="headerNavText streamSocial streamHome">
			<a class="socialLink socialHome" href="${up}index.htm" aria-label="Home" title="Home">${HOME_ICON}</a>
		</div>
		<div class="brandCompact"><span class="brandCompactName">David Conger Photography</span> <span class="brandCompactPlace">Seattle, WA</span></div>
		<div class="headerSocialLinks streamSocial">
			<a class="socialLink socialInstagram" target="_top" href="https://instagram.com/dcongerphoto" aria-label="David Conger Photography on Instagram" title="Instagram">
				<svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true" focusable="false"><path fill="currentColor" d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"/></svg>
			</a>
			<a class="socialLink socialX" target="_top" href="https://twitter.com/dcongerphoto" aria-label="David Conger Photography on X" title="X">
				<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>
			</a>
			<a class="socialLink socialFacebook" target="_top" href="https://www.facebook.com/pages/david-conger-photography/139826329427348" aria-label="David Conger Photography on Facebook" title="Facebook">
				<svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/></svg>
			</a>
			<a class="socialLink socialMail" target="_top" href="mailto:david@davidconger.com" aria-label="Email David Conger" title="Email">
				<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path class="iconRegular" fill="currentColor" d="M5.25 4H18.75C20.483 4 21.8992 5.35645 21.9949 7.06558L22 7.25V16.75C22 18.483 20.6435 19.8992 18.9344 19.9949L18.75 20H5.25C3.51697 20 2.10075 18.6435 2.00514 16.9344L2 16.75V7.25C2 5.51697 3.35645 4.10075 5.06558 4.00514L5.25 4H18.75H5.25ZM20.5 9.373L12.3493 13.6637C12.1619 13.7623 11.9431 13.7764 11.7468 13.706L11.6507 13.6637L3.5 9.374V16.75C3.5 17.6682 4.20711 18.4212 5.10647 18.4942L5.25 18.5H18.75C19.6682 18.5 20.4212 17.7929 20.4942 16.8935L20.5 16.75V9.373ZM18.75 5.5H5.25C4.33183 5.5 3.57881 6.20711 3.5058 7.10647L3.5 7.25V7.679L12 12.1525L20.5 7.678V7.25C20.5 6.33183 19.7929 5.57881 18.8935 5.5058L18.75 5.5Z"/><path class="iconFilled" fill="currentColor" d="M22 8.608V16.75C22 18.483 20.6435 19.8992 18.9344 19.9949L18.75 20H5.25C3.51697 20 2.10075 18.6435 2.00514 16.9344L2 16.75V8.608L11.652 13.6644C11.87 13.7785 12.13 13.7785 12.348 13.6644L22 8.608ZM5.25 4H18.75C20.4347 4 21.8201 5.28191 21.9838 6.92355L12 12.1533L2.01619 6.92355C2.17386 5.34271 3.46432 4.09545 5.06409 4.00523L5.25 4H18.75H5.25Z"/></svg>
			</a>
		</div>
	</div>
</div>

<div class="headerText streamHeader">
	<div class="headerTextPre">the concert &amp; event photography of</div>
	<div class="headerTextMain">David Conger</div>
	<div class="headerTextSub"><a class="quietLink" href="mailto:david@davidconger.com">david@davidconger.com</a> | Seattle, WA</div>
</div>

<div class="yearBar">
	${yearNav}
</div>

<main class="stream">
	<ul class="showGrid">
${list.map((s) => renderShow(s, colors)).join('\n')}
	</ul>
</main>


<p class="siteFooter streamFooter">
Copyright 2008-2026 | David Conger, LLC | All Rights Reserved<br />Not for distribution or reuse without permission.</p>

</body>

</html>
`;
}

/* --------------------------------------------------------------------- run */

fs.mkdirSync(OUT, { recursive: true });
const built = [];
const data = new Map();

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

for (const year of built) {
  const dir = path.join(OUT, year);
  fs.mkdirSync(dir, { recursive: true });
  const html = renderYear(year, data.get(year), colors, built);
  fs.writeFileSync(path.join(dir, 'index.htm'), html, 'utf8');
  console.log(`  wrote _proto/stream/${year}/index.htm (${(html.length / 1024).toFixed(0)} KB)`);
}

console.log(`\n  http://localhost:8099/_proto/stream/${built[built.length - 1]}/`);
