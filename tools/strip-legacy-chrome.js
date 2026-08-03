#!/usr/bin/env node
'use strict';

/**
 * Strip the last of the FrontPage-era page chrome.
 *
 * Two leftovers survive on a handful of pages, both of them duplicating
 * something the modern masthead already provides:
 *
 *   1. A 710px images/header.png banner, drawn as the first thing inside
 *      <main>, directly beneath the real header.
 *   2. A full-width table holding a "Home > Concert & Event Photos > Festivals"
 *      breadcrumb and a second copy of the social icons, followed by a
 *      &nbsp; spacer paragraph.
 *
 * Neither appears on the festival pages that were rebuilt later, so removing
 * them is what makes the section uniform rather than what changes it.
 *
 * Superseded trees (galleries/0000/, galleries/index_old.htm) are left alone --
 * they are already marked noindex and out of the sitemap.
 *
 *   node tools/strip-legacy-chrome.js [--dry]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'you_old', 'tools']);
const SUPERSEDED = [/^galleries[\\/]0000[\\/]/i, /^galleries[\\/]index_old\.htm$/i];

/** The banner paragraph, with or without the link that wrapped it. */
const BANNER = /[ \t]*<p style="text-align:center;">\s*(?:<a href="[^"]*">\s*)?<img src="[^"]*images\/header\.png"[^>]*\/>\s*(?:<\/a>)?<\/p>\r?\n/;

/** The breadcrumb-and-icons table, plus the spacer paragraph under it. */
const NAV_TABLE = /[ \t]*<table style="width: 100%" cellspacing="0" cellpadding="0">[\s\S]*?<\/table>\r?\n<p>&nbsp;<\/p>\r?\n/;

function pages() {
  const found = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.html?$/i.test(entry.name)) continue;
      const rel = path.relative(ROOT, full);
      if (SUPERSEDED.some((re) => re.test(rel))) continue;
      found.push(full);
    }
  })(ROOT);
  return found;
}

/**
 * Only strip a block that sits at the very top of <main>. Anything further
 * down is page content that happens to look similar, not leftover chrome.
 */
function stripAtTopOfMain(html, pattern) {
  const main = /<main[^>]*>\r?\n?/.exec(html);
  if (!main) return null;
  const start = main.index + main[0].length;
  const found = pattern.exec(html.slice(start));
  if (!found || found.index !== 0) return null;
  return html.slice(0, start) + html.slice(start + found[0].length);
}

function main() {
  let banners = 0;
  let tables = 0;
  const touched = [];

  for (const file of pages()) {
    const before = fs.readFileSync(file, 'utf8');
    let html = before;

    // The table comes first on the pages that have both, so it has to go first
    // for the banner to reach the top of <main>.
    const withoutTable = stripAtTopOfMain(html, NAV_TABLE);
    if (withoutTable) { html = withoutTable; tables++; }

    const withoutBanner = stripAtTopOfMain(html, BANNER);
    if (withoutBanner) { html = withoutBanner; banners++; }

    if (html === before) continue;
    touched.push(path.relative(ROOT, file).replace(/\\/g, '/'));
    if (!DRY) fs.writeFileSync(file, html);
  }

  console.log(`  banners removed    : ${banners}`);
  console.log(`  nav tables removed : ${tables}`);
  console.log(`  pages rewritten    : ${touched.length}${DRY ? ' (dry run)' : ''}`);
  touched.forEach((f) => console.log('    ' + f));
}

main();
