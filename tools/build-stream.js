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
 * bottom-right of each frame at build time, and the result becomes a horizontal
 * gradient plus a text colour chosen for contrast. Doing it at build time keeps
 * the output static -- no canvas, no CORS, no flash of grey before the tint
 * lands.
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

/** "Artist, Venue, City, ST. Month D, YYYY" -> its parts. */
function splitDescription(desc) {
  const date = eventDate(desc);
  let head = desc;
  const cut = desc.lastIndexOf('.');
  if (date && cut > 0) head = desc.slice(0, cut);
  const parts = head.split(',').map((s) => s.trim()).filter(Boolean);
  return { artist: parts[0] || head, venue: parts.slice(1).join(', '), date };
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
    // Landscape only. Mixing orientations in a fixed-ratio frame would make the
    // whole row jump when the rotator advanced; portrait pairing is a later
    // question.
    const frames = [];
    for (const f of files) {
      if (frames.length >= maxPhotos) break;
      const size = jpegSize(path.join(dir, f));
      if (!size || size.width <= size.height) continue;
      frames.push({ file: f, ...size });
    }
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
function captionFill(rgb, lum, alpha) {
  const mean = (rgb[0] + rgb[1] + rgb[2]) / 3;
  const dark = lum <= 0.5;
  const target = dark ? 0 : 255;
  const pull = dark ? 0.58 : 0.5;
  const c = rgb.map((v) => {
    const desaturated = v + (mean - v) * 0.35;
    return Math.round(desaturated + (target - desaturated) * pull);
  });
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}

/* ------------------------------------------------------------------ render */

function renderShow(show, colors) {
  const up = '../../../';
  const href = `${up}galleries/${show.rel}/`;
  const slides = show.frames.map((f, i) => {
    const abs = path.join(ROOT, 'galleries', show.rel, f.file);
    const c = colors.get(abs);
    const lum = c ? c.lum : 0.2;
    const style = c
      // The gradient runs top to bottom, not left to right, so it can carry an
      // alpha ramp as well as a colour shift: nearly transparent where the
      // panel meets the photograph, opaque by the time it reaches the burned-in
      // watermark along the bottom edge. A horizontal gradient looked better in
      // isolation but had to be uniformly opaque to hide the wordmark, which
      // made every caption read as a sticker laid on the frame.
      ? `--cap-top:${captionFill(c.top, lum, 0.78)};--cap-bot:${captionFill(c.bottom, lum, 0.99)};--cap-fg:${lum <= 0.5 ? '#ffffff' : '#141414'}`
      : '';
    const caption = i === 0 ? `
					<span class="showCaption">
						<span class="showArtist">${escapeHtml(show.artist)}</span>${show.venue ? `<span class="showVenue">${escapeHtml(show.venue)}</span>` : ''}
						${show.date ? `<span class="showDate">${escapeHtml(show.date.text)}</span>` : ''}
					</span>` : `
					<span class="showCaption">
						<span class="showArtist">${escapeHtml(show.artist)}</span>${show.venue ? `<span class="showVenue">${escapeHtml(show.venue)}</span>` : ''}
						${show.date ? `<span class="showDate">${escapeHtml(show.date.text)}</span>` : ''}
					</span>`;
    return `				<a class="showSlide${i === 0 ? ' is-active' : ''}" href="${href}" style="${style}" ${i === 0 ? '' : 'tabindex="-1" aria-hidden="true"'}>
					<img src="${up}galleries/${show.rel}/${f.file}" width="${f.width}" height="${f.height}" alt="${escapeHtml(show.artist)}" loading="lazy" decoding="async">${caption}
				</a>`;
  }).join('\n');

  const dots = show.frames.length > 1 ? `
			<div class="showDots" role="tablist" aria-label="More frames from this show">
${show.frames.map((f, i) => `				<button type="button" role="tab" data-index="${i}" aria-selected="${i === 0}" aria-label="Frame ${i + 1} of ${show.frames.length}"></button>`).join('\n')}
			</div>` : '';

  return `		<li class="show">
			<div class="showFrame">
${slides}
			</div>${dots}
		</li>`;
}

function renderYear(year, list, colors, available) {
  const prev = available.filter((y) => +y < +year).pop();
  const next = available.filter((y) => +y > +year).shift();
  const nav = [
    prev ? `<a href="../${prev}/">&lt;- ${prev}</a>` : null,
    next ? `<a href="../${next}/">${next} -&gt;</a>` : null,
  ].filter(Boolean).join(' | ');
  const up = '../../../';

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

<div class="headerNav">
	<div class="headerNavText">
		<a href="${up}index.htm">Home</a>
	</div>
	<div class="headerSocialLinks">
		<a target="_top" href="https://www.facebook.com/pages/david-conger-photography/139826329427348"><img src="${up}images/icons/facebook-24.png" style="background-color: #3B5998; border-width: 0px;" width="24" height="24" alt="David Conger Photography on Facebook"/></a>&nbsp;
		<a target="_top" href="https://www.flickr.com/photos/davidconger"><img src="${up}images/icons/flickr-24.png" style="background-color: #0063DB; border-width: 0px;" width="24" height="24" alt="David Conger Photography on Flickr"/></a>&nbsp;
		<a target="_top" href="https://twitter.com/dcongerphoto"><img src="${up}images/icons/twitter-24.png" style="background-color: #00ACED; border-width: 0px;" width="24" height="24" alt="David Conger Photography on Twitter"/></a>&nbsp;
		<a target="_top" href="https://instagram.com/dcongerphoto"><img src="${up}images/icons/instagram-24.png" style="background-color: #3F729B; border-width: 0px;" width="24" height="24" alt="David Conger Photography on Instagram"/></a>&nbsp;
		<a target="_top" href="mailto:david@davidconger.com"><img src="${up}images/icons/email-24.png" style="background-color: #3B5998; border-width: 0px;" width="24" height="24" alt="Email David Conger"/></a>
	</div>
</div>

<div class="headerText">
	<div class="headerTextPre">the concert &amp; event photography of</div>
	<div class="headerTextMain">David Conger</div>
	<div class="headerTextSub">david@davidconger.com | Seattle, WA</div>
</div>

<div id="dcListingNav">
	<span id="listingTitle">Concert &amp; Event Photos</span>
	<br />
	<span id="listingNav">View: <a href="${up}festivals/index.htm">Festivals</a> | <a href="${up}bydate.htm">By Date</a></span>
</div>

<div class="streamHead">
	<span class="streamYear">${year}</span>
	<br/>
	<span class="streamNav">${nav}</span>
</div>

<main class="stream">
	<ul class="showGrid">
${list.map((s) => renderShow(s, colors)).join('\n')}
	</ul>
</main>

${prev ? `<div class="streamHead streamFoot">
	<span class="streamNav">See more from last year, <a href="../${prev}/">${prev}</a>.</span>
</div>` : ''}

<p class="siteFooter">
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
