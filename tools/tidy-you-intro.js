#!/usr/bin/env node
/**
 * The paragraph on a /you/ event page that explains how to save a photo, and
 * the "Back to List" lines around the thumbnails, were given their breathing
 * room by the old generator the way everything else in that era was: a
 * non-breaking space and a line break standing in for a margin, above and
 * below. Those render as empty lines, which is why the paragraph floats so far
 * from the event name and the navigation from the grid.
 *
 * This takes the spacers out and gives the paragraph a class, so the space
 * around both can be set once in the stylesheet and changed without touching
 * 5,800 files again. No wording moves and no URL changes.
 *
 * Covers both shapes of page: the event and pagination lists, whose grid is
 * <ul id="youimages">, and the single-photo pages, whose one image sits in
 * <ul id="images">. The markup around the spacers is identical on both.
 *
 * Idempotent: a page with nothing left to strip is written back unchanged.
 *
 *   node tools/tidy-you-intro.js [--dry] [--sample N]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const YOU = path.join(ROOT, 'you');

/* The block always opens on its own line and always closes with the spacer
   still attached, so both ends can be matched exactly rather than guessed at.
   Non-greedy to the first </div>: the paragraph holds only a link and a span,
   never another div. */
const BLOCK = /<div>(\r?\n\t\t)&nbsp;<br \/>([\s\S]*?)<br \/>&nbsp;(\r?\n\t)<\/div>/;

const NAV = /<div class="younavigation">([\s\S]*?)<\/div>/g;

function tidyIntro(html) {
  let out = html.replace(BLOCK, (m, open, body, close) =>
    `<div class="youIntro">${open}${body}${close}</div>`);

  out = out.replace(NAV, (m, body) => {
    const tidy = body
      .replace(/^(\r?\n\t\t)&nbsp;<br \/>\r?\n\t\t/, '$1')
      .replace(/\r?\n\t\t<br \/>&nbsp;(\r?\n\t)$/, '$1');
    return `<div class="younavigation">${tidy}</div>`;
  });

  return out;
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, out); continue; }
    if (!/\.html?$/i.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function main() {
  const dry = process.argv.includes('--dry');
  const sampleIdx = process.argv.indexOf('--sample');
  const sample = sampleIdx > -1 ? Number(process.argv[sampleIdx + 1]) : 0;

  const pages = walk(YOU, []).filter((f) =>
    /<ul id="(?:you)?images"/.test(fs.readFileSync(f, 'utf8')));

  let changed = 0;
  let already = 0;

  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    const next = tidyIntro(html);
    if (next === html) { already++; continue; }
    changed++;
    if (sample && changed <= sample) {
      const i = next.indexOf('<div class="youIntro">');
      console.log(`\n--- ${path.relative(ROOT, file)}`);
      console.log(next.slice(i, i + 260));
    }
    if (!dry) fs.writeFileSync(file, next, 'utf8');
  }

  console.log(`\npages     ${pages.length}`);
  console.log(`changed   ${changed}${dry ? ' (dry run)' : ''}`);
  console.log(`unchanged ${already}`);
}

if (require.main === module) main();

module.exports = { tidyIntro };
