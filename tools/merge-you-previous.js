#!/usr/bin/env node
'use strict';

/**
 * Fold you/previous.htm's year-grouped list into you/index.htm.
 *
 * you/index.htm carries a thumbnail grid of the most recent seasons and used to
 * send visitors to you/previous.htm for anything older. That split meant two
 * pages, two clicks and one duplicated year (2023 appeared in both). This
 * rebuilds the archive list directly underneath the grid, in exactly the format
 * previous.htm already uses, and emits only the years the grid does not cover.
 *
 * The block is delimited by ARCHIVE START/END comments so the script is
 * idempotent and can be re-run after a new event is added to either page.
 *
 * previous.htm itself stays live -- 16 years of links must keep working -- but
 * its canonical now points at /you/ because everything on it is on /you/.
 *
 *   node tools/merge-you-previous.js [--dry]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'you', 'index.htm');
const PREVIOUS = path.join(ROOT, 'you', 'previous.htm');
const DRY = process.argv.includes('--dry');

const START = '<!--ARCHIVE START-->';
const END = '<!--ARCHIVE END-->';

const read = (p) => fs.readFileSync(p, 'utf8');
const crlf = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');

/** Years the index grid already shows as thumbnails. */
function gridYears(indexHtml) {
  const catalog = /<!--CATALOG START-->([\s\S]*?)<!--CATALOG END-->/.exec(indexHtml);
  if (!catalog) throw new Error('you/index.htm: no CATALOG START/END markers');
  const years = new Set();
  for (const m of catalog[1].matchAll(/<a href="(\d{4})\//g)) years.add(m[1]);
  return years;
}

/** Split previous.htm's intro into one entry per year heading. */
function yearBlocks(previousHtml) {
  const intro = /<div class="catalogIntro">([\s\S]*?)\r?\n<\/div>/.exec(previousHtml);
  if (!intro) throw new Error('you/previous.htm: no catalogIntro block');
  const body = intro[1];
  const marks = [...body.matchAll(/<span class="yearHeader">(\d{4})<\/span>/g)];
  if (!marks.length) throw new Error('you/previous.htm: no year headings');

  return marks.map((m, i) => {
    const from = m.index;
    const to = i + 1 < marks.length ? marks[i + 1].index : body.length;
    // Trim the blank-line separator that precedes the next heading so the
    // spacing between years is reproduced exactly once.
    const html = body.slice(from, to).replace(/(\r?\n\t*<br \/>\s*)+$/, '');
    return { year: m[1], html: html.replace(/\s+$/, '') };
  });
}

function buildArchive(blocks) {
  const parts = blocks.map((b) => '\t' + b.html.replace(/^\s+/, ''));
  return [
    START,
    '<div class="youArchive">',
    '\t<h2 class="pageHeader">Previous Events</h2>',
    parts.join('\r\n'),
    '</div>',
    END,
  ].join('\r\n');
}

function main() {
  const indexHtml = read(INDEX);
  const previousHtml = read(PREVIOUS);

  const covered = gridYears(indexHtml);
  const blocks = yearBlocks(previousHtml).filter((b) => !covered.has(b.year));
  const events = blocks.reduce((n, b) => n + (b.html.match(/<a href="/g) || []).length, 0);

  console.log(`  grid years         : ${[...covered].sort().join(', ')}`);
  console.log(`  archive years      : ${blocks.map((b) => b.year).join(', ')}`);
  console.log(`  archive events     : ${events}`);

  let out = indexHtml;

  // 1. The intro no longer needs to point at a second page.
  const navLine = /[ \t]*<span id="catalogNav">[\s\S]*?<\/span><br\s*\/?>\r?\n/i;
  if (navLine.test(out)) {
    out = out.replace(navLine, '');
    console.log('  intro nav          : removed');
  } else {
    console.log('  intro nav          : already gone');
  }

  // 2. The outro said "not finding your event? view previous events" -- the
  //    events are now on this page, so the archive block takes its place.
  const archive = crlf(buildArchive(blocks));
  const existing = new RegExp(`${START}[\\s\\S]*?${END}`);
  const outro = /<div class="catalogOutro">[\s\S]*?<\/div>/i;

  if (existing.test(out)) {
    out = out.replace(existing, archive);
    console.log('  archive block      : refreshed');
  } else if (outro.test(out)) {
    out = out.replace(outro, archive);
    console.log('  archive block      : replaced catalogOutro');
  } else {
    throw new Error('you/index.htm: found neither an archive block nor a catalogOutro');
  }

  // 3. previous.htm is duplicate content now; point search engines at /you/ and
  //    tell anyone arriving on an old link where the complete list lives.
  let prevOut = previousHtml.replace(
    /<link rel="canonical" href="https:\/\/www\.davidconger\.com\/you\/previous\.htm">/,
    '<link rel="canonical" href="https://www.davidconger.com/you/">'
  );
  const canonicalMoved = prevOut !== previousHtml;
  console.log(`  previous canonical : ${canonicalMoved ? 'repointed at /you/' : 'already /you/'}`);

  const notice =
    '\t<span id="catalogNav">Every event is now listed on the ' +
    '<a href="./">Meet and Greet Photos</a> page.</span><br />';
  if (!/id="catalogNav"/.test(prevOut)) {
    const anchor = /([ \t]*<h1 class="pageHeader">Previous Events<\/h1><br \/>\r?\n)/;
    if (!anchor.test(prevOut)) throw new Error('you/previous.htm: no page header to anchor the notice to');
    prevOut = prevOut.replace(anchor, `$1${crlf(notice)}\r\n`);
    console.log('  previous notice    : added');
  } else {
    console.log('  previous notice    : already present');
  }

  const prevChanged = prevOut !== previousHtml;
  const indexChanged = out !== indexHtml;
  if (DRY) {
    console.log(`\n  DRY RUN -- index.htm ${indexChanged ? 'would change' : 'unchanged'}`);
    return;
  }
  if (indexChanged) fs.writeFileSync(INDEX, out);
  if (prevChanged) fs.writeFileSync(PREVIOUS, prevOut);
  console.log(`\n  written            : ${(indexChanged ? 1 : 0) + (prevChanged ? 1 : 0)} file(s)`);
}

main();
