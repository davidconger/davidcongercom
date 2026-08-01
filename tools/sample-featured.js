/**
 * Fills in what the home page rotator needs but the extractor cannot know:
 * each frame's pixel dimensions and its caption tint.
 *
 * The year pages bake the caption's colours into a style attribute at build
 * time. The rotator cannot -- it swaps frames at runtime -- so the same three
 * values ride along in the JSON and are applied as custom properties when a
 * frame becomes active. Same sampling, same maths, same file:
 * tools/lib/caption.js.
 *
 * Idempotent: entries that already carry every field are left alone unless
 * --force is passed.
 *
 * Usage:
 *   node tools/sample-featured.js
 *   node tools/sample-featured.js --force
 */
const fs = require('fs');
const path = require('path');
const { sampleColors, captionVars } = require('./lib/caption');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'js', 'featured-images.json');
const force = process.argv.includes('--force');

/** Reads a JPEG's dimensions straight from its SOF marker. */
function jpegSize(file) {
  const b = fs.readFileSync(file);
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

const items = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const todo = items.filter((it) => force || !it.cap || !it.width);
console.log(`${items.length} featured image(s), ${todo.length} to sample`);
if (!todo.length) process.exit(0);

const missing = [];
const paths = [];
for (const it of todo) {
  const abs = path.join(ROOT, it.image.replace(/\//g, path.sep));
  if (!fs.existsSync(abs)) { missing.push(it.image); continue; }
  it._abs = abs;
  paths.push(abs);
}
if (missing.length) {
  console.log(`  ${missing.length} missing file(s):`);
  for (const m of missing.slice(0, 10)) console.log(`    ${m}`);
}

const colors = sampleColors(paths);

let sized = 0;
let tinted = 0;
for (const it of items) {
  if (!it._abs) continue;
  if (force || !it.width) {
    const size = jpegSize(it._abs);
    if (size) { it.width = size.width; it.height = size.height; sized++; }
  }
  const v = captionVars(colors.get(it._abs));
  if (v) { it.cap = [v.top, v.bottom, v.fg]; tinted++; }
  delete it._abs;
}

fs.writeFileSync(FILE, JSON.stringify(items, null, 1) + '\n', 'utf8');
console.log(`  sized ${sized}, tinted ${tinted}`);
console.log(`  wrote js/featured-images.json`);
