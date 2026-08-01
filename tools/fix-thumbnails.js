/**
 * Rebuilds the /you/ event thumbnails at the size they are actually displayed.
 *
 * you/index.htm shows 48 events at 240x160, but every thumbnail.jpg is a
 * full-size 1280x854 export averaging 367 KB, so that one page pulls 17 MB to
 * paint a grid of postage stamps. The markup already declares 240x160, so
 * resizing the files changes no URL and no layout - only the bytes.
 *
 *   node tools/fix-thumbnails.js [--dry-run]
 *
 * Originals are left untouched: only files named thumbnail.jpg are rewritten,
 * never the gallery photos.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

const TARGET_W = 240;
const TARGET_H = 160;

/** Reads a JPEG's dimensions from its SOF marker, without decoding pixels. */
function jpegSize(file) {
  const buf = fs.readFileSync(file);
  let i = 2;
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) break;
    i += 2 + len;
  }
  return null;
}

const found = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (e.name.toLowerCase() !== 'thumbnail.jpg') continue;
    const size = jpegSize(p);
    const bytes = fs.statSync(p).size;
    found.push({ file: p, size, bytes });
  }
})(path.join(ROOT, 'you'));

const oversized = found.filter((f) => !f.size || f.size.width > TARGET_W || f.size.height > TARGET_H);

const totalBefore = found.reduce((n, f) => n + f.bytes, 0);
const overBytes = oversized.reduce((n, f) => n + f.bytes, 0);

console.log(`  thumbnail.jpg files : ${found.length}`);
console.log(`  oversized           : ${oversized.length}  (${(overBytes / 1048576).toFixed(1)} MB)`);
console.log(`  total               : ${(totalBefore / 1048576).toFixed(1)} MB`);

if (!oversized.length) {
  console.log('\n  Nothing to do.');
  process.exit(0);
}
if (dryRun) {
  console.log('\n  Dry run; nothing written.');
  for (const f of oversized.slice(0, 5)) {
    console.log(`    ${path.relative(ROOT, f.file).replace(/\\/g, '/')}  ` +
      `${f.size ? f.size.width + 'x' + f.size.height : '?'}  ${(f.bytes / 1024).toFixed(0)} KB`);
  }
  process.exit(0);
}

// Resize via a temp file per image, so a failure part-way through cannot leave
// a truncated thumbnail in place of a good one.
const jobs = oversized.map((f) => ({
  src: f.file,
  dst: f.file + '.tmp',
  width: TARGET_W,
  height: TARGET_H,
  mode: 'cover',
}));

const jobFile = path.join(os.tmpdir(), `dc-thumbs-${process.pid}.json`);
fs.writeFileSync(jobFile, JSON.stringify(jobs), 'utf8');
try {
  execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'resize-images.ps1'), '-JobFile', jobFile, '-Quality', '82'],
    { stdio: 'inherit' }
  );
} finally {
  fs.unlinkSync(jobFile);
}

let after = 0;
let swapped = 0;
for (const j of jobs) {
  if (!fs.existsSync(j.dst)) {
    console.log(`  kept original (resize failed): ${path.relative(ROOT, j.src)}`);
    continue;
  }
  fs.renameSync(j.dst, j.src);
  after += fs.statSync(j.src).size;
  swapped++;
}

const unchanged = found.filter((f) => !oversized.includes(f)).reduce((n, f) => n + f.bytes, 0);
console.log(`\n  resized ${swapped} thumbnail(s)`);
console.log(`  total: ${(totalBefore / 1048576).toFixed(1)} MB -> ${((after + unchanged) / 1048576).toFixed(2)} MB`);
