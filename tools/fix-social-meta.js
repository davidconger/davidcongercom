#!/usr/bin/env node
'use strict';

/*
 * fix-social-meta.js
 *
 * Repairs the Open Graph tags left behind by the retired desktop generator.
 *
 * Three separate faults accumulated over the years:
 *
 *  1. og:url drifted away from the canonical URL. The generator wrote og:url from
 *     the operator's typed slug, so it carries typos ("jounrney", "pheonix",
 *     "tonyorlandp"), superseded slugs, unsubstituted "{3}" placeholders and in one
 *     case a literal C:\Users path. The canonical is derived from the file's real
 *     location, so it is authoritative and og:url is simply set to match.
 *
 *  2. The catalog thumbnails were re-filed from catalog/YYYY-MM/ to catalog/YYYY/MM/
 *     and roughly a thousand og:image tags were never updated, so those pages share
 *     with no image at all.
 *
 *  3. The /you/ converter emitted og:title, og:description and og:image but no
 *     og:url.
 *
 * Idempotent. Run with --dry to report without writing.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');
const SITE = 'https://www.davidconger.com';

// Template files hold deliberate {PLACEHOLDER} markers; leave them alone.
const SKIP_DIRS = new Set(['node_modules', '.git', 'you_old']);
const SKIP_PATHS = [
  'tools/templates',
  'galleries/0000/00/template'
];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    if (SKIP_PATHS.some(s => rel === s || rel.startsWith(s + '/'))) continue;
    if (entry.isDirectory()) walk(abs, out);
    else if (/\.html?$/i.test(entry.name)) out.push(abs);
  }
  return out;
}

function siteRelative(url) {
  const m = /^https?:\/\/(?:www\.)?davidconger\.com\/(.*)$/i.exec(url);
  if (!m) return null;
  let rel = m[1];
  try { rel = decodeURIComponent(rel); } catch (e) { /* leave as-is */ }
  return rel;
}

function exists(rel) {
  if (!rel) return false;
  return fs.existsSync(path.join(ROOT, rel));
}

function toAbsolute(rel) {
  return SITE + '/' + encodeURI(rel).replace(/#/g, '%23');
}

/* Find a working replacement for an og:image that points at a missing file. */
function repairImage(rel, pageAbs, html) {
  // The catalog moved from catalog/YYYY-MM/ to catalog/YYYY/MM/.
  const refiled = rel.replace(/^catalog\/(\d{4})-(\d{2})\//, 'catalog/$1/$2/');
  if (refiled !== rel && exists(refiled)) return refiled;

  // Some catalog filenames had apostrophes stripped ("hell'sbelles" -> "hellsbelles").
  const deAposted = refiled.replace(/'/g, '');
  if (deAposted !== refiled && exists(deAposted)) return deAposted;

  // Otherwise fall back to the first photograph actually shown on the page.
  const dir = path.dirname(pageAbs);
  const re = /<img[^>]+src="([^"]+\.jpe?g)"/gi;
  let m;
  while ((m = re.exec(html))) {
    let src = m[1];
    if (/^https?:/i.test(src)) continue;
    try { src = decodeURIComponent(src); } catch (e) { /* leave as-is */ }
    const abs = path.resolve(dir, src);
    if (fs.existsSync(abs)) {
      return path.relative(ROOT, abs).replace(/\\/g, '/');
    }
  }
  return null;
}

const CANONICAL = /(<link\s+rel="canonical"\s+href=")([^"]*)(")/i;
const OG_URL = /(<meta\s+property="og:url"\s+content=")([^"]*)(")/i;
const OG_IMAGE = /(<meta\s+property="og:image"\s+content=")([^"]*)(")/i;
const OG_TITLE = /^([ \t]*)<meta\s+property="og:title"[^>]*>[ \t]*$/im;

const stats = {
  scanned: 0, changed: 0,
  urlSynced: 0, urlAdded: 0,
  imageRefiled: 0, imageFallback: 0, imageHost: 0,
  imageUnfixable: []
};

for (const abs of walk(ROOT, [])) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  const before = fs.readFileSync(abs, 'utf8');
  let html = before;
  stats.scanned++;

  const canonical = (html.match(CANONICAL) || [])[2];

  if (canonical) {
    const ogUrl = html.match(OG_URL);
    if (ogUrl) {
      if (ogUrl[2] !== canonical) {
        html = html.replace(OG_URL, (all, a, v, c) => a + canonical + c);
        stats.urlSynced++;
      }
    } else if (OG_TITLE.test(html)) {
      // The /you/ converter omitted og:url; add it alongside the tags it did write.
      const eol = html.includes('\r\n') ? '\r\n' : '\n';
      html = html.replace(OG_TITLE, (line, indent) =>
        line + eol + indent + '<meta property="og:url" content="' + canonical + '" />');
      stats.urlAdded++;
    }
  }

  const ogImage = html.match(OG_IMAGE);
  if (ogImage) {
    const value = ogImage[2];
    const imgRel = siteRelative(value);
    if (imgRel !== null) {
      let target = imgRel;
      if (!exists(imgRel)) {
        const repaired = repairImage(imgRel, abs, html);
        if (repaired) {
          target = repaired;
          if (repaired.startsWith('catalog/')) stats.imageRefiled++;
          else stats.imageFallback++;
        } else {
          stats.imageUnfixable.push(rel + ' -> ' + value);
          target = null;
        }
      }
      if (target !== null) {
        const next = toAbsolute(target);
        if (next !== value) {
          if (exists(imgRel)) stats.imageHost++;
          html = html.replace(OG_IMAGE, (all, a, v, c) => a + next + c);
        }
      }
    }
  }

  if (html !== before) {
    stats.changed++;
    if (!DRY) fs.writeFileSync(abs, html, 'utf8');
  }
}

console.log((DRY ? '[dry run] ' : '') + 'scanned ' + stats.scanned + ' pages, changed ' + stats.changed);
console.log('  og:url set to canonical : ' + stats.urlSynced);
console.log('  og:url added            : ' + stats.urlAdded);
console.log('  og:image re-filed       : ' + stats.imageRefiled);
console.log('  og:image photo fallback : ' + stats.imageFallback);
console.log('  og:image host normalized: ' + stats.imageHost);
console.log('  og:image unfixable      : ' + stats.imageUnfixable.length);
stats.imageUnfixable.slice(0, 20).forEach(s => console.log('     ' + s));
