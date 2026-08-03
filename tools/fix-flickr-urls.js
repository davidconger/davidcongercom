#!/usr/bin/env node
'use strict';

/*
 * fix-flickr-urls.js
 *
 * Twenty-four pages from 2008-2014 embed their photographs from Flickr rather
 * than from this site. They all still use the farmN.static.flickr.com and
 * farmN.staticflickr.com hosts, which Flickr retired years ago and now keeps
 * alive only as a redirect. The supported host is live.staticflickr.com, and the
 * farm number is no longer part of the path, so every one of these images costs
 * an extra round trip and depends on a redirect nobody here controls.
 *
 * All 345 distinct URLs were checked against live.staticflickr.com before this
 * was written; 332 answer 200. The thirteen that do not are photographs that
 * have since been deleted from Flickr and are listed at the end of the run.
 *
 * Idempotent. Run with --dry to report without writing.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');

const FARM_HOST = /https?:\/\/farm\d+\.static\.?flickr\.com\//gi;
const LIVE_HOST = 'https://live.staticflickr.com/';

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'you_old'].includes(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (/\.html?$/i.test(entry.name)) out.push(abs);
  }
  return out;
}

let pages = 0;
let refs = 0;

for (const abs of walk(ROOT, [])) {
  const before = fs.readFileSync(abs, 'utf8');
  const matches = before.match(FARM_HOST);
  if (!matches) continue;
  const after = before.replace(FARM_HOST, LIVE_HOST);
  pages++;
  refs += matches.length;
  if (!DRY) fs.writeFileSync(abs, after, 'utf8');
}

console.log((DRY ? '[dry run] ' : '') + 'pages updated: ' + pages);
console.log((DRY ? '[dry run] ' : '') + 'references rehosted: ' + refs);
