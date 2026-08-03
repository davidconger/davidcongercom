#!/usr/bin/env node
'use strict';

/**
 * Give every /you/ event a thumbnail.jpg.
 *
 * The 2023-2026 seasons are listed on you/index.htm as a grid of thumbnails,
 * because the current generator writes a 240x160 thumbnail.jpg alongside each
 * event. Everything older was produced by the retired desktop app, which never
 * did -- so 243 of the 273 archived events have no thumbnail and could only be
 * listed as a line of text. This crops one from the event's own first photo so
 * the whole archive can use the same grid.
 *
 *   node tools/you-thumbnails.js [--dry-run] [--limit N]
 *
 * Only ever writes thumbnail.jpg, and only where one is missing: the gallery
 * photos are never read for anything but pixels and never modified. Re-running
 * is a no-op, so it is safe to call again after new events are added.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const YOU = path.join(ROOT, 'you');

const DRY = process.argv.includes('--dry-run');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const TARGET_W = 240;
const TARGET_H = 160;
const YEAR_DIR = /^(?:19|20)\d{2}$/;

/* OneDrive reports cloud placeholders through Dirent in a way that makes
   isDirectory() unreliable, so every probe goes through stat instead. */
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const list = (p) => { try { return fs.readdirSync(p).sort(); } catch { return []; } };

/** Every you/<year>/<slug>/ that looks like an event, i.e. has an index page. */
function events() {
  const out = [];
  for (const year of list(YOU)) {
    if (!YEAR_DIR.test(year)) continue;
    const yearDir = path.join(YOU, year);
    if (!isDir(yearDir)) continue;
    for (const slug of list(yearDir)) {
      const dir = path.join(yearDir, slug);
      if (!isDir(dir)) continue;
      if (!fs.existsSync(path.join(dir, 'index.htm'))) continue;
      out.push({ year, slug, dir, rel: `you/${year}/${slug}` });
    }
  }
  return out;
}

/**
 * The photo to crop from. The first frame of the first page is the one the
 * event leads with, so it is the closest thing the archive has to a chosen
 * cover shot. `_sm` files are the generator's own small copies -- too small to
 * crop from, so they are only a last resort.
 */
function coverPhoto(dir) {
  const full = [];
  const small = [];
  (function walk(d, depth) {
    if (depth > 2) return;
    for (const name of list(d)) {
      const p = path.join(d, name);
      if (isDir(p)) { walk(p, depth + 1); continue; }
      if (!/\.jpe?g$/i.test(name)) continue;
      if (/thumbnail\.jpg$/i.test(name)) continue;
      (/_sm\.jpe?g$/i.test(name) ? small : full).push(p);
    }
  })(dir, 0);
  return full[0] || small[0] || null;
}

const all = events();
const missing = [];
const noPhoto = [];

for (const e of all) {
  if (fs.existsSync(path.join(e.dir, 'thumbnail.jpg'))) continue;
  const src = coverPhoto(e.dir);
  if (!src) { noPhoto.push(e.rel); continue; }
  missing.push({ ...e, src });
}

console.log(`  /you/ events        : ${all.length}`);
console.log(`  already have one    : ${all.length - missing.length - noPhoto.length}`);
console.log(`  to generate         : ${missing.length}`);
if (noPhoto.length) {
  console.log(`  no photo to crop    : ${noPhoto.length}`);
  for (const rel of noPhoto) console.log(`      ${rel}`);
}

if (!missing.length) {
  console.log('\n  Nothing to do.');
  process.exit(0);
}

const todo = missing.slice(0, LIMIT);

if (DRY) {
  console.log('\n  Dry run; nothing written. First few:');
  for (const m of todo.slice(0, 8)) {
    console.log(`      ${m.rel}/thumbnail.jpg`);
    console.log(`          from ${path.relative(ROOT, m.src).replace(/\\/g, '/')}`);
  }
  process.exit(0);
}

/* Written to a temp name and renamed on success, so an interrupted run cannot
   leave a half-written thumbnail that later runs would treat as done. */
const jobs = todo.map((m) => ({
  src: m.src,
  dst: path.join(m.dir, 'thumbnail.jpg.tmp'),
  width: TARGET_W,
  height: TARGET_H,
  mode: 'cover',
}));

const jobFile = path.join(os.tmpdir(), `dc-you-thumbs-${process.pid}.json`);
fs.writeFileSync(jobFile, JSON.stringify(jobs), 'utf8');
try {
  execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'resize-images.ps1'), '-JobFile', jobFile, '-Quality', '82'],
    { stdio: 'inherit' }
  );
} finally {
  fs.unlinkSync(jobFile);
}

let written = 0;
let bytes = 0;
const failed = [];
for (let i = 0; i < jobs.length; i++) {
  const j = jobs[i];
  if (!fs.existsSync(j.dst)) { failed.push(todo[i].rel); continue; }
  const final = path.join(todo[i].dir, 'thumbnail.jpg');
  fs.renameSync(j.dst, final);
  bytes += fs.statSync(final).size;
  written++;
}

console.log(`\n  written             : ${written} thumbnail(s), ${(bytes / 1048576).toFixed(1)} MB`);
if (failed.length) {
  console.log(`  failed              : ${failed.length}`);
  for (const rel of failed.slice(0, 20)) console.log(`      ${rel}`);
}
