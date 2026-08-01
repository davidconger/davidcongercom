/**
 * One-shot migration: extract the hardcoded `imageArray` from js/homerotate.js
 * into js/featured-images.json.
 *
 * The original stored each entry as a semicolon-delimited string:
 *   path;file;date;artist;venue;width
 * The trailing width field was only used by code that was commented out, so it
 * is dropped.
 *
 * Usage: node tools/extract-featured.js js/homerotate.js js/featured-images.json
 */
const fs = require('fs');
const path = require('path');

const [, , src, out] = process.argv;
const js = fs.readFileSync(src, 'utf8');
const siteRoot = path.resolve(path.dirname(out), '..');

const start = js.indexOf('new Array(');
const end = js.indexOf('\n);', start);
if (start === -1 || end === -1) throw new Error('Could not locate imageArray literal');

const body = js.slice(start + 'new Array('.length, end);

const entries = [];
const dropped = [];
for (const m of body.matchAll(/"([^"]*)"/g)) {
  const parts = m[1].split(';');
  if (parts.length < 5) {
    console.warn('Skipping malformed entry: ' + m[1]);
    continue;
  }
  const [dir, file, date, artist, venue] = parts;
  const gallery = dir.replace(/\/+$/, '') + '/';
  const image = gallery + file;

  // Several entries point at galleries that were deleted years ago; they are
  // 404 in production too, so the rotator had a real chance of showing a
  // broken hero image. Drop anything whose photo is not on disk.
  if (!fs.existsSync(path.join(siteRoot, image))) {
    dropped.push(image);
    continue;
  }

  entries.push({
    gallery,
    image,
    date: date.trim(),
    artist: artist.trim(),
    venue: venue.trim(),
  });
}

fs.writeFileSync(out, JSON.stringify(entries, null, 2) + '\n', 'utf8');
console.log(`Extracted ${entries.length} featured entries -> ${out}`);
if (dropped.length) {
  console.log(`Dropped ${dropped.length} entries whose image is missing:`);
  dropped.forEach((d) => console.log('  - ' + d));
}
