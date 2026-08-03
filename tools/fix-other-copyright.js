#!/usr/bin/env node
'use strict';

/*
 * fix-other-copyright.js
 *
 * The twelve pages under other/ each print the same copyright line twice.
 *
 * These pages were hand-authored years before the site had a shared footer, so
 * they ended with their own copyright paragraph. Modernization then added the
 * standard <p class="siteFooter"> to every page in the tree without noticing the
 * old one was still sitting just above </main>. Nobody removed it, so the page
 * asserts copyright, closes, and asserts it again.
 *
 * Two shapes exist, and they are treated differently:
 *
 *   1. On three pages the in-page paragraph is a pure duplicate of the footer
 *      (or the copyright line followed by nothing at all). It carries no
 *      information the footer does not, so the whole paragraph goes.
 *
 *   2. On nine pages the paragraph is the copyright line *plus* a Creative
 *      Commons grant and a request to be notified and attributed. Only the
 *      duplicated copyright sentence is removed; the licensing text is left
 *      exactly as written.
 *
 * What this script deliberately does NOT do is resolve the contradiction on
 * those nine pages, where the in-page text grants a BY-NC-ND licence and the
 * footer immediately below reads "Not for distribution or reuse without
 * permission." That is a statement about the owner's own photographs and is his
 * call, not a refactor.
 *
 *   node tools/fix-other-copyright.js            # dry run
 *   node tools/fix-other-copyright.js --apply
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'other');
const APPLY = process.argv.includes('--apply');

const COPYRIGHT = 'Copyright 2008-2026 | David Conger, LLC | All Rights Reserved';

/* The in-page paragraph is always the last thing before </main>. */
const BLOCK = new RegExp(
  '<p>(\\s*)' + COPYRIGHT.replace(/[|.*+?^${}()[\]\\]/g, '\\$&') +
  '<br />([\\s\\S]*?)</p>(\\s*)</main>',
  'i'
);

/* Text that adds nothing over the shared footer. */
function isRedundant(remainder) {
  const t = remainder.replace(/<br\s*\/?>/gi, '').trim();
  return t === '' || /^Not for distribution or reuse without permission\.$/i.test(t);
}

function pages(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...pages(p));
    else if (/\.html?$/i.test(e.name)) out.push(p);
  }
  return out;
}

let removed = 0, trimmed = 0, skipped = 0;

for (const file of pages(DIR)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const before = fs.readFileSync(file, 'utf8');

  if ((before.match(new RegExp(COPYRIGHT.replace(/[|]/g, '\\|'), 'gi')) || []).length < 2) {
    continue;
  }

  const m = before.match(BLOCK);
  if (!m) {
    skipped++;
    console.log('  ?  ' + rel + ' - two copyright lines but no paragraph before </main>');
    continue;
  }

  let after;
  if (isRedundant(m[2])) {
    after = before.replace(BLOCK, '</main>');
    removed++;
    console.log('  -  ' + rel + ' - duplicate paragraph removed');
  } else {
    after = before.replace(BLOCK, '<p>$1$2</p>$3</main>');
    trimmed++;
    console.log('  ~  ' + rel + ' - copyright sentence removed, licensing text kept');
  }

  if (APPLY && after !== before) fs.writeFileSync(file, after);
}

console.log(
  '\n' + (APPLY ? 'Applied' : 'Dry run') + ': ' +
  removed + ' paragraphs removed, ' + trimmed + ' trimmed' +
  (skipped ? ', ' + skipped + ' skipped' : '') + '.'
);
if (!APPLY && (removed || trimmed)) console.log('Re-run with --apply to write.');
