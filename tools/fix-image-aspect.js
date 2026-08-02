#!/usr/bin/env node
/**
 * Corrects width/height attributes that describe the wrong picture.
 *
 * fix-image-dims.js repaired the four thousand tags that were a pixel or two
 * out and deliberately left everything further away than that alone, because a
 * large difference is not a rounding error and could mean any number of things.
 * Reading the sixty-seven it set aside, it turns out they mean two things and
 * only two:
 *
 *   - The box is a faithful scale-down. A 240x160 cell pointing at the full
 *     500x334 photograph, because the thumbnail was never generated. The page
 *     draws correctly; it just fetches more bytes than it needs. Nothing to fix
 *     in the markup, so these are reported and left.
 *
 *   - The box is the wrong shape. A portrait cell around a landscape
 *     photograph, a 3:2 box around a 4:3 one, a 800px box around a 640px file.
 *     Every one of these is visibly wrong: the browser honours the attributes,
 *     so the picture is squashed, stretched, or blown up past its own
 *     resolution and left soft.
 *
 * The second kind is set to the size of the file, which is the only size that
 * is certainly right. Nothing is scaled to fit a layout -- the catalog cells
 * are 240px wide in the stylesheet and every thumbnail corrected here is
 * already 240px or narrower, so the grid keeps its shape.
 *
 * Usage:
 *   node tools/fix-image-aspect.js --dry
 *   node tools/fix-image-aspect.js
 *
 * Options:
 *   --dry          report what would change and write nothing
 *   --tolerance N  aspect ratio difference treated as faithful, in percent;
 *                  default 0.5
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['tools', 'node_modules', '.git', 'davidconger_backup', '1cnf', '1pvt']);

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
let tolerance = 0.5;
for (let i = 0; i < argv.length; i++) if (argv[i] === '--tolerance') tolerance = Number(argv[++i]);

/* Intrinsic size from the file header rather than from a decoder -- the same
   reader fix-image-dims.js uses, and for the same reason: the frame marker is a
   fixed offset into the first few hundred bytes. */
function jpegSize(buf) {
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
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

let changedPages = 0;
const fixed = [];
const faithful = [];

for (const page of pages) {
  const before = fs.readFileSync(page, 'utf8');
  if (!/<img/i.test(before)) continue;
  const rel = path.relative(ROOT, page).replace(/\\/g, '/');

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

    const w = Number(wm[1]);
    const h = Number(hm[1]);
    if (Math.abs(real.w - w) <= 2 && Math.abs(real.h - h) <= 2) return tag;

    const drift = Math.abs((w / h) - (real.w / real.h)) / (real.w / real.h) * 100;
    // A box that keeps the picture's shape and asks for less of it than the
    // file holds is a thumbnail, not a mistake.
    if (drift <= tolerance && w <= real.w && h <= real.h) {
      faithful.push(`${rel}  ${src}  shown ${w}x${h}  file ${real.w}x${real.h}`);
      return tag;
    }

    const why = drift > tolerance
      ? `shape ${(w / h).toFixed(3)} -> ${(real.w / real.h).toFixed(3)}`
      : 'drawn larger than the file';
    fixed.push(`${rel}  ${src}  ${w}x${h} -> ${real.w}x${real.h}  (${why})`);

    return tag
      .replace(/(\swidth=")\d+(")/i, (_, a, b) => a + real.w + b)
      .replace(/(\sheight=")\d+(")/i, (_, a, b) => a + real.h + b);
  });

  if (after === before) continue;
  changedPages++;
  if (!dry) fs.writeFileSync(page, after, 'utf8');
}

console.log(`\n  corrected : ${fixed.length} tag(s) on ${changedPages} page(s)${dry ? ' (dry run, nothing written)' : ''}`);
for (const f of fixed) console.log(`      ${f}`);
console.log(`\n  left as a thumbnail of a larger file : ${faithful.length}`);
for (const f of faithful) console.log(`      ${f}`);
