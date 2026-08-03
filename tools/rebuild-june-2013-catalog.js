#!/usr/bin/env node
'use strict';

/**
 * Rebuild catalog/2013/06/index.htm in the shape every other catalog page uses.
 *
 * It is the only month-level catalog page on the site -- the survivor of a
 * monthly-catalog experiment whose neighbours (catalog/2013-05, catalog/2013-07)
 * were never built. It still draws its thumbnails in a fixed 800px table, which
 * is why it was the last page overflowing on a phone, and its relative links
 * were written for a page one directory shallower, so six of them were broken.
 *
 * The URL stays exactly where it is. Only the markup inside <main> changes, to
 * the #dcListingNav / #dcCatalogNav / ul.catalogList structure that
 * catalog/2013/index.htm and its siblings use.
 *
 *   node tools/rebuild-june-2013-catalog.js [--dry]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'catalog', '2013', '06', 'index.htm');
const DRY = process.argv.includes('--dry');

const crlf = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');

/** Everything the old table cells held: where each thumbnail goes and says. */
function cells(html) {
  const re = /<a href="([^"]+)">\s*<img src="([^"]+)"[^>]*\/><br\/>\s*([^<]+?)\s*<\/a>/g;
  return [...html.matchAll(re)].map((m) => ({
    // The catalog links to a gallery by its directory, not its index file.
    href: m[1].replace(/index\.html?$/i, ''),
    img: m[2],
    caption: m[3].replace(/\s+/g, ' ').trim(),
  }));
}

/** The catalog's alt text is the act, which is the caption up to its first comma. */
const subject = (caption) => caption.split(',')[0].trim();

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function buildMain(list) {
  const items = list.map((c) => [
    '\t\t<li>',
    '\t\t<div>',
    `\t\t\t<a href="${c.href}">`,
    `\t\t\t<img src="${c.img}" width="240" height="160" alt="${escapeAttr(subject(c.caption))}" loading="lazy" decoding="async"/>`,
    `\t\t\t<br/>${c.caption}`,
    '\t\t\t</a>',
    '\t\t</div>',
    '\t\t</li>',
  ].join('\r\n'));

  return [
    '<main class="stream pageStream">',
    '<div id="dcListingNav">',
    '\t<span id="listingTitle">Music &amp; Event Photography</span>',
    '\t<br />',
    '\t<span id="listingNav">View: <a href="../../">Thumbnail Catalog</a> | ' +
      '<a href="../../../festivals/index.htm">Festivals</a> | ' +
      '<a href="../../../bydate.htm">By Date</a></span>',
    '</div>',
    '',
    '<div id="dcCatalogNav">',
    '\t<h1 id="catalogTitle">June 2013 Catalog</h1>',
    '\t<span id="catalogNav"><a href="../">All of 2013</a></span>',
    '</div>',
    '',
    '<!--CATALOG START-->',
    '<div id="catalog">',
    '\t<ul class="catalogList">',
    items.join('\r\n'),
    '\t</ul>',
    '</div>',
    '<!--CATALOG END-->',
    '</main>',
  ].join('\r\n');
}

function main() {
  const before = fs.readFileSync(PAGE, 'utf8');
  const list = cells(before.replace(/\r\n/g, '\n'));
  if (!list.length) throw new Error('catalog/2013/06/index.htm: no thumbnails found');

  const start = before.indexOf('<main');
  const end = before.indexOf('</main>');
  if (start < 0 || end < 0) throw new Error('catalog/2013/06/index.htm: no <main>');

  let out = before.slice(0, start) + crlf(buildMain(list)) + before.slice(end + '</main>'.length);

  // A style block for .dcNavHeaderText, a class this page no longer contains.
  out = out.replace(/<style type="text\/css">\.dcNavHeaderText \{[\s\S]*?<\/style>\r?\n/, '');

  // Its siblings all report to Application Insights; this one never did.
  if (!/azureinsights\.js/.test(out)) {
    out = out.replace(
      /(<script src="\.\.\/\.\.\/\.\.\/js\/stream\.js" defer><\/script>)/,
      '<script src="../../../js/azureinsights.js" defer></script>\r\n$1'
    );
  }

  console.log(`  thumbnails         : ${list.length}`);
  console.log(`  first              : ${list[0].href}`);
  console.log(`  last               : ${list[list.length - 1].href}`);
  console.log(`  changed            : ${out !== before}`);
  if (DRY) { console.log('\n  DRY RUN -- nothing written'); return; }
  if (out !== before) fs.writeFileSync(PAGE, out);
  console.log('\n  wrote catalog/2013/06/index.htm');
}

main();
