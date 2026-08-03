#!/usr/bin/env node
'use strict';

/*
 * prune-missing-photos.js
 *
 * A handful of galleries have been rendering empty frames for years because the
 * photographs behind them no longer exist anywhere: thirteen David Guetta files
 * that are absent from this tree and from the live server, and thirteen Flickr
 * photographs that Flickr itself now answers 404 or 410 for. A broken frame is
 * worse than no frame, so the dead items are removed.
 *
 * Where that empties a gallery completely the page is kept, because sixteen years
 * of links point at it, and the image list is replaced with a short note in the
 * same place the older unpublished galleries say "...coming soon...".
 *
 * The Flickr list below was established by requesting every one of the 345
 * distinct Flickr URLs in the tree; these are the only ones that did not answer
 * 200. Nothing is deleted on the strength of a guess.
 *
 * Idempotent. Run with --dry to report without writing.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');

const DEAD_REMOTE = new Set([
  '4102/4902994491_c25d8edfdb_s.jpg',  // 410 Gone
  '3916/15005205592_a4d1f79368_z.jpg',
  '5557/14982597356_b170e3f59d_z.jpg',
  '5578/15005592815_4b9e42ceab_z.jpg',
  '3866/14818970618_b9754073d5_z.jpg',
  '5556/14818970508_0ff8f6ea21_z.jpg',
  '5595/15002487851_b316fb713c_z.jpg',
  '5575/15005205692_06c6e04269_z.jpg',
  '3889/14818970278_7189e8a915_z.jpg',
  '3906/15005205682_1fcbebffe2_z.jpg',
  '5593/14819070587_d2de0404ed_z.jpg',
  '3845/14819070937_2961b96b96_z.jpg',
  '3893/14818867789_9e2b9f7bb4_z.jpg'
]);

const NOTE = 'These photographs are no longer available.';

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'you_old'].includes(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (/\.html?$/i.test(entry.name)) out.push(abs);
  }
  return out;
}

function isDead(src, pageDir) {
  if (/^https?:/i.test(src)) {
    const m = /staticflickr\.com\/(.+)$/i.exec(src) || /static\.flickr\.com\/\d+\/(.+)$/i.exec(src);
    return m ? DEAD_REMOTE.has(m[1]) : false;
  }
  let rel = src;
  try { rel = decodeURIComponent(rel); } catch (e) { /* leave as-is */ }
  return !fs.existsSync(path.resolve(pageDir, rel));
}

const stats = { pagesPruned: 0, framesRemoved: 0, pagesEmptied: [] };

for (const abs of walk(ROOT, [])) {
  const before = fs.readFileSync(abs, 'utf8');
  const list = /(<ul id="images"[^>]*>)([\s\S]*?)(<\/ul>)/i.exec(before);
  if (!list) continue;

  const pageDir = path.dirname(abs);
  const items = list[2].split(/(?=<li[\s>])/i).filter(s => /<li[\s>]/i.test(s));
  if (!items.length) continue;

  const kept = [];
  let removed = 0;
  for (const item of items) {
    const src = (/<img[^>]+src="([^"]+)"/i.exec(item) || [])[1];
    if (src && isDead(src, pageDir)) removed++;
    else kept.push(item);
  }
  if (!removed) continue;

  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  stats.pagesPruned++;
  stats.framesRemoved += removed;

  let after;
  if (kept.length) {
    after = before.replace(list[0], list[1] + kept.join('') + list[3]);
  } else {
    stats.pagesEmptied.push(rel);
    const eol = list[2].includes('\r\n') ? '\r\n' : '\n';
    after = before.replace(list[0],
      '<div class="flatImages">' + eol + '<p>' + NOTE + '</p>' + eol + '</div>');
  }

  if (!DRY) fs.writeFileSync(abs, after, 'utf8');
}

console.log((DRY ? '[dry run] ' : '') + 'pages pruned  : ' + stats.pagesPruned);
console.log((DRY ? '[dry run] ' : '') + 'frames removed: ' + stats.framesRemoved);
console.log('galleries left with no photographs: ' + stats.pagesEmptied.length);
stats.pagesEmptied.forEach(s => console.log('   ' + s));
