/**
 * Corrects width/height attributes that disagree with the image file.
 *
 * Across the archive, 4,322 <img> tags declare a size one or two pixels away
 * from the file they point at -- "333x500" for a photograph that is really
 * 334x500. The old export tool rounded a dimension somewhere and the number
 * stuck in the markup.
 *
 * That one pixel is not a rounding detail, it is the whole picture going soft.
 * A browser given width="333" for a 334px image scales it by 0.997: near
 * enough to 1 that there is no real size reduction to hide the interpolation,
 * so every output pixel becomes a blend of two neighbours. It is the same
 * defect that made the year stream look slightly out of focus until its tracks
 * were pinned to exactly 640px, and it is worse here because it also throws
 * the aspect ratio out -- a 333x500 box for a 334x500 photograph renders 498.5
 * tall, so the browser reserves the wrong height and the page shifts as each
 * image lands.
 *
 * Only mechanical differences are touched. Anything further out than a couple
 * of pixels is a different problem -- a thumbnail deliberately shown small, a
 * portrait declared as a landscape, an image replaced without the markup
 * following -- and those want a human, so they are listed rather than changed.
 *
 * Usage:
 *   node tools/fix-image-dims.js --dry
 *   node tools/fix-image-dims.js
 *
 * Options:
 *   --dry        report what would change and write nothing
 *   --max N      largest difference treated as mechanical, per axis; default 2
 *   --outliers   list the mismatches too large to touch
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['tools', 'node_modules', '.git', 'davidconger_backup', '1cnf', '1pvt']);

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const showOutliers = argv.includes('--outliers');
let max = 2;
for (let i = 0; i < argv.length; i++) if (argv[i] === '--max') max = Number(argv[++i]);

/* Intrinsic size from the file header rather than from a decoder: the frame
   marker is a fixed offset into the first few hundred bytes, so this reads a
   thirty thousand image archive in seconds and pulls in no dependency. */
function jpegSize(buf) {
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const marker = buf[i + 1];
    // Standalone markers carry no length field.
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    // Any start-of-frame except the huffman, arithmetic and restart tables.
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    }
    i += 2 + len;
  }
  return null;
}

function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504E47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function gifSize(buf) {
  if (buf.toString('latin1', 0, 3) !== 'GIF') return null;
  return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
}

const sizes = new Map();
function imageSize(file) {
  if (sizes.has(file)) return sizes.get(file);
  let out = null;
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, 65536, 0);
    fs.closeSync(fd);
    const head = buf.slice(0, n);
    if (n > 24) out = jpegSize(head) || pngSize(head) || gifSize(head);
  } catch (e) { /* linked but not on disk; the link checker's problem, not ours */ }
  sizes.set(file, out);
  return out;
}

const pages = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name.toLowerCase())) walk(f); continue; }
    if (/\.html?$/i.test(e.name)) pages.push(f);
  }
}(ROOT));

let changedPages = 0, changedTags = 0, checked = 0;
const outliers = [];

for (const page of pages) {
  const before = fs.readFileSync(page, 'utf8');
  if (!/<img/i.test(before)) continue;

  const after = before.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = (tag.match(/\ssrc="([^"]+)"/i) || [])[1];
    if (!src || /^(?:https?:)?\/\//i.test(src) || /^data:/i.test(src)) return tag;

    const wm = tag.match(/\swidth="(\d+)"/i);
    const hm = tag.match(/\sheight="(\d+)"/i);
    if (!wm || !hm) return tag;

    let file;
    try { file = path.resolve(path.dirname(page), decodeURIComponent(src.split(/[?#]/)[0])); }
    catch (e) { return tag; }

    const real = imageSize(file);
    if (!real || !real.w || !real.h) return tag;
    checked++;

    const dw = real.w - Number(wm[1]);
    const dh = real.h - Number(hm[1]);
    if (!dw && !dh) return tag;

    if (Math.abs(dw) > max || Math.abs(dh) > max) {
      outliers.push(`${path.relative(ROOT, page)}  ${src}  declared ${wm[1]}x${hm[1]}  actual ${real.w}x${real.h}`);
      return tag;
    }

    changedTags++;
    return tag
      .replace(/(\swidth=")\d+(")/i, (_, a, b) => a + real.w + b)
      .replace(/(\sheight=")\d+(")/i, (_, a, b) => a + real.h + b);
  });

  if (after === before) continue;
  changedPages++;
  if (!dry) fs.writeFileSync(page, after, 'utf8');
}

console.log(`${pages.length} page(s) scanned, ${checked} sized <img> tag(s) resolved to a file`);
console.log(`${changedTags} tag(s) on ${changedPages} page(s) ${dry ? 'would be' : 'were'} corrected`);
console.log(`${outliers.length} mismatch(es) further than ${max}px left alone`);
if (showOutliers) for (const o of outliers) console.log('  ' + o);
