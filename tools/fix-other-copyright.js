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
 * What this script deliberately does NOT do is change which licence applies. The
 * pages link to BY-NC-ND *3.0*, superseded by 4.0 in 2013, but moving between
 * licence versions alters the terms and is the owner's decision.
 *
 * It does, however, remove the sentence that contradicts the grant. On the nine
 * licensed pages the footer reads "Not for distribution or reuse without
 * permission" directly beneath text granting a licence that expressly permits
 * redistribution. Checking the earliest tracked copy of these pages shows why:
 *
 *     <p>
 *     Copyright 2008-2024 | David Conger, LLC | All Rights Reserved<br />Photos
 *     on this page can be used under the Creative Commons BY-NC-ND License.
 *     ...
 *     </body>
 *
 * The page ended there. The prohibition was never on these pages - it arrived
 * when a later pass stamped the standard footer across the whole tree. So the
 * contradiction is a regression introduced by modernization, and removing the
 * sentence restores what the owner actually wrote. The copyright assertion
 * stays, because asserting ownership and granting a licence are compatible and
 * both were in the original.
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

/* A page that grants a licence must not also forbid reuse in its footer. */
const GRANTS_LICENCE = /creativecommons\.org\/licenses/i;
const FOOTER_PROHIBITION = new RegExp(
  '(<p class="siteFooter[^"]*">\\s*' +
  COPYRIGHT.replace(/[|.*+?^${}()[\]\\]/g, '\\$&') +
  ')<br />Not for distribution or reuse without permission\\.',
  'i'
);

function pages(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...pages(p));
    else if (/\.html?$/i.test(e.name)) out.push(p);
  }
  return out;
}

let removed = 0, trimmed = 0, unblocked = 0, skipped = 0;

for (const file of pages(DIR)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const before = fs.readFileSync(file, 'utf8');
  let after = before;

  const duplicated =
    (before.match(new RegExp(COPYRIGHT.replace(/[|]/g, '\\|'), 'gi')) || []).length > 1;

  if (duplicated) {
    const m = before.match(BLOCK);
    if (!m) {
      skipped++;
      console.log('  ?  ' + rel + ' - two copyright lines but no paragraph before </main>');
    } else if (isRedundant(m[2])) {
      after = after.replace(BLOCK, '</main>');
      removed++;
      console.log('  -  ' + rel + ' - duplicate paragraph removed');
    } else {
      after = after.replace(BLOCK, '<p>$1$2</p>$3</main>');
      trimmed++;
      console.log('  ~  ' + rel + ' - copyright sentence removed, licensing text kept');
    }
  }

  if (GRANTS_LICENCE.test(after) && FOOTER_PROHIBITION.test(after)) {
    after = after.replace(FOOTER_PROHIBITION, '$1');
    unblocked++;
    console.log('  !  ' + rel + ' - footer no longer contradicts the licence granted above');
  }

  if (APPLY && after !== before) fs.writeFileSync(file, after);
}

console.log(
  '\n' + (APPLY ? 'Applied' : 'Dry run') + ': ' +
  removed + ' paragraphs removed, ' + trimmed + ' trimmed, ' +
  unblocked + ' footers reconciled' +
  (skipped ? ', ' + skipped + ' skipped' : '') + '.'
);
if (!APPLY && (removed || trimmed || unblocked)) console.log('Re-run with --apply to write.');
