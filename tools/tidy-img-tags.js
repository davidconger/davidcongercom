#!/usr/bin/env node
/**
 * Two repairs to the <img> tags the old generators left behind.
 *
 * 1. Deferred loading. Half the archive already carries
 *    loading="lazy" decoding="async" -- the catalogs, the year stream, the
 *    2020 galleries, the recent /you/ events -- because those pages were
 *    rebuilt. The other half, 25,852 tags across the older galleries and the
 *    older meet-and-greet events, still asks the browser for every photograph
 *    the moment the page is parsed. A /you/ event page holds thirteen
 *    thumbnails and an older gallery page can hold forty full-size
 *    photographs; on a phone that is several megabytes fetched before anything
 *    below the first screen is even known to be wanted.
 *
 *    The convention already set by the rebuilt pages is followed exactly:
 *    every photograph is deferred, and the chrome is not. The site's icons and
 *    banners sit above the fold and are a couple of kilobytes each -- deferring
 *    those would cost a round trip and save nothing. None of the 115 chrome
 *    images in the rebuilt pages carries the attribute, and none gets one here.
 *
 * 2. style="width:-334". A negative length is not a valid CSS width, so every
 *    browser has always thrown the declaration away -- but it is sitting in
 *    2,897 tags across 391 pages, and anyone reading the markup has to work out
 *    whether it matters. It does not, and now it is gone. The z-index it shares
 *    the attribute with is left alone.
 *
 * Usage:
 *   node tools/tidy-img-tags.js --dry
 *   node tools/tidy-img-tags.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['tools', 'node_modules', '.git', 'davidconger_backup', '1cnf', '1pvt', 'you_old', '_proto']);
const dry = process.argv.includes('--dry');

/** Site furniture: above the fold, tiny, and wanted immediately. */
const isChrome = (src, width) =>
  /images\/(icons|header)/i.test(src) || (width > 0 && width <= 48);

/* The three photographs the radio pages cross-fade. homerotate.js swaps their
   src on a timer, so whether they are on screen is not something the browser
   can work out from the document. */
const isScripted = (tag) => /\sid="Rotating\d*"/i.test(tag);

const pages = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name.toLowerCase())) walk(f); continue; }
    if (/\.html?$/i.test(e.name)) pages.push(f);
  }
}(ROOT));

let changedPages = 0, deferred = 0, skippedChrome = 0, stripped = 0;

for (const page of pages) {
  const before = fs.readFileSync(page, 'utf8');
  if (!/<img/i.test(before)) continue;

  const after = before.replace(/<img\b[^>]*>/gi, (tag) => {
    let out = tag;

    // A negative width was never applied by anything; drop the declaration and
    // the separator that introduced it, and tidy up if it leaves the attribute
    // empty or with a stray semicolon.
    if (/width:\s*-\d+/i.test(out)) {
      out = out.replace(/style="([^"]*)"/i, (whole, css) => {
        const kept = css
          .split(';')
          .map((d) => d.trim())
          .filter((d) => d && !/^width:\s*-\d+$/i.test(d));
        stripped++;
        return kept.length ? `style="${kept.join('; ')}"` : '';
      }).replace(/\s{2,}/g, ' ').replace(/\s+(\/?>)$/, '$1');
    }

    if (!/\sloading\s*=/i.test(out)) {
      const src = (out.match(/\ssrc="([^"]+)"/i) || [])[1] || '';
      const width = Number((out.match(/\swidth="(\d+)"/i) || [])[1] || 0);
      if (src && !isChrome(src, width) && !isScripted(out)) {
        const attrs = /\sdecoding\s*=/i.test(out)
          ? ' loading="lazy"'
          : ' loading="lazy" decoding="async"';
        out = out.replace(/\s*(\/?)>$/, `${attrs}$1>`);
        deferred++;
      } else if (src) {
        skippedChrome++;
      }
    }

    return out;
  });

  if (after === before) continue;
  changedPages++;
  if (!dry) fs.writeFileSync(page, after, 'utf8');
}

console.log(`  pages rewritten            : ${changedPages}${dry ? ' (dry run, nothing written)' : ''}`);
console.log(`  photographs deferred       : ${deferred}`);
console.log(`  chrome left loading eagerly: ${skippedChrome}`);
console.log(`  width:-NNN declarations cut: ${stripped}`);
