#!/usr/bin/env node
/**
 * fix-gallery-h1.js -- give the last gallery pages their <h1> back.
 *
 * Almost every gallery page opens its caption block with
 *
 *   <div id="details">
 *     <h1 id="title">Barenaked Ladies</h1>
 *     <span id="venue">White River Amphitheatre, Auburn, WA</span><br />
 *     <span id="date">June 30, 2013</span>
 *   </div>
 *
 * A run of pages from 2013, 2014 and one from 2020 instead carry the artist's
 * name as a bare text node followed by a <br />, so those pages have no heading
 * at all -- nothing for a screen reader to navigate by, nothing for a search
 * engine to read as the subject of the page, and a different shape from the
 * eleven hundred pages around them. The text is already styled by #title's
 * siblings; it was simply never wrapped.
 *
 * This wraps it, and drops the <br /> that was standing in for the line break a
 * block-level heading gives for free -- which is exactly the markup the correct
 * pages have.
 *
 * Only the first text node inside #details is touched, and only when there is
 * no <h1> anywhere on the page, so the script is safe to run repeatedly and
 * cannot disturb a page that is already right.
 *
 *   node tools/fix-gallery-h1.js --dry     list what would change
 *   node tools/fix-gallery-h1.js           write it
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');

// The retired generator's own templates still sit under galleries/0000; their
// placeholders are not artists and must not be wrapped.
const SKIP = /(^|[\\/])0000([\\/]|$)/;

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (entry.name.endsWith('.htm')) files.push(full);
  }
})(path.join(ROOT, 'galleries'));

let changed = 0;
const skipped = [];

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (SKIP.test(file)) continue;

  const before = fs.readFileSync(file, 'utf8');
  if (/<h1[\s>]/i.test(before)) continue;

  // The name, then the break that a heading makes unnecessary. [^<]+ stops at
  // the first tag, so an entity in the name -- "Hall &amp; Oates" -- survives.
  const after = before.replace(
    /(<div id="details">\s*?\r?\n(\s*))([^<\s][^<]*?)\s*<br\s*\/?>\r?\n?\s*/,
    (m, lead, indent, name) => `${lead}<h1 id="title">${name.trim()}</h1>\n${indent}`
  );

  if (after === before) { skipped.push(rel); continue; }

  const name = /<h1 id="title">([^<]*)<\/h1>/.exec(after)[1];
  console.log(`${DRY ? 'would wrap' : 'wrapped'}  ${rel}  ->  ${name}`);
  if (!DRY) fs.writeFileSync(file, after);
  changed++;
}

console.log(`\n${changed} page(s) ${DRY ? 'would be ' : ''}given an <h1>.`);
if (skipped.length) {
  console.log(`\n${skipped.length} page(s) still have no <h1> and no bare name to wrap:`);
  skipped.forEach((s) => console.log('  ' + s));
}
