#!/usr/bin/env node
/**
 * davidconger.com — local link integrity checker.
 *
 * Walks every .htm/.html page, resolves every local href/src/data-original
 * reference against the filesystem, and reports anything that does not exist.
 *
 * Purpose: git tracks the markup but deliberately ignores the ~80,000 .jpg
 * originals, so git alone cannot prove that a refactor kept image references
 * intact. This script closes that gap. Run it before and after each phase and
 * compare the summary numbers.
 *
 * Usage:
 *   node check-links.js <siteRoot> [--json <outFile>] [--limit N] [--max-broken N]
 *
 * --max-broken makes this usable as a CI gate. The site carries a large number
 * of long-standing broken references inside archived trees, so "zero broken" is
 * not a reachable bar; what matters is that a bulk edit has not made it worse.
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx > -1 ? args[jsonIdx + 1] : null;
const limitIdx = args.indexOf('--limit');
const reportLimit = limitIdx > -1 ? parseInt(args[limitIdx + 1], 10) : 40;
const maxIdx = args.indexOf('--max-broken');
const maxBroken = maxIdx > -1 ? parseInt(args[maxIdx + 1], 10) : null;

/** The first argument that is neither a flag nor a flag's value is the site
 *  root. Picking it positionally used to swallow `--json`, silently scanning a
 *  directory that did not exist and reporting a clean bill of health. */
const flagValues = new Set([jsonIdx, limitIdx, maxIdx].filter((i) => i > -1).map((i) => i + 1));
const positional = args.filter((a, i) => !a.startsWith('--') && !flagValues.has(i));
const siteRoot = path.resolve(positional[0] || '.');

/** Directories that are build/tool noise rather than published content.
 *  `tools` is excluded because the generator templates under tools/templates
 *  contain {ROOT}-style placeholders that are not real paths. */
const SKIP_DIRS = new Set(['1cnf', '1pvt', '.git', 'node_modules', 'tools']);

/** Case-insensitive index of every real file, so we also catch case mismatches
 *  (harmless on Windows/IIS locally, fatal if content ever moves to Linux/blob). */
const filesLower = new Set();
const pages = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full);
    } else {
      const rel = path.relative(siteRoot, full).replace(/\\/g, '/');
      filesLower.add(rel.toLowerCase());
      if (/\.html?$/i.test(e.name)) pages.push(full);
    }
  }
}

/** Pull local (non-absolute, non-protocol) references out of a page. */
const REF_RE = /(?:href|src|data-original)\s*=\s*["']([^"']+)["']/gi;

function isExternal(u) {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(u) || // http:, https:, mailto:, javascript:, data:
    u.startsWith('//') ||
    u.startsWith('#') ||
    u.trim() === ''
  );
}

walk(siteRoot);

const broken = [];
let refsChecked = 0;
const perExt = {};

for (const page of pages) {
  let html;
  try {
    html = fs.readFileSync(page, 'utf8');
  } catch {
    continue;
  }
  const pageDir = path.dirname(page);
  const pageRel = path.relative(siteRoot, page).replace(/\\/g, '/');

  for (const m of html.matchAll(REF_RE)) {
    let ref = m[1].trim();
    if (isExternal(ref)) continue;

    // Strip query string and fragment before resolving on disk.
    ref = ref.split('#')[0].split('?')[0];
    if (!ref) continue;

    // Resolve the same way a browser does (RFC 3986 §5.2.4): join the ref onto
    // the page's directory, then collapse "." and ".." segments — discarding
    // any ".." that would escape the site root rather than walking above it.
    // path.resolve() would happily climb out of the site and report false
    // breakage for the many pages that use one "../" too many.
    const baseSegs = ref.startsWith('/')
      ? []
      : path.relative(siteRoot, pageDir).replace(/\\/g, '/').split('/').filter(Boolean);
    const out = [...baseSegs];
    for (const seg of ref.replace(/^\//, '').split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') out.pop();
      else out.push(seg);
    }
    const targetRel = decodeURIComponent(out.join('/'));

    refsChecked++;
    const isDirRef = ref.endsWith('/');
    const lastSeg = out[out.length - 1] || '';
    const ext = isDirRef || !lastSeg.includes('.') ? '(dir)' : path.extname(lastSeg).toLowerCase();
    perExt[ext] = (perExt[ext] || 0) + 1;

    // A reference to a directory is served by its index page.
    const candidates = [
      targetRel,
      `${targetRel}/index.htm`,
      `${targetRel}/index.html`,
    ];

    const ok = candidates.some(
      (c) => filesLower.has(c.toLowerCase()) || fs.existsSync(path.resolve(siteRoot, c))
    );
    if (!ok) broken.push({ page: pageRel, ref: m[1], resolved: targetRel });
  }
}

console.log('='.repeat(66));
console.log('Link integrity baseline');
console.log('='.repeat(66));
console.log(`Site root       : ${siteRoot}`);
console.log(`Files indexed   : ${filesLower.size.toLocaleString()}`);
console.log(`Pages scanned   : ${pages.length.toLocaleString()}`);
console.log(`Local refs      : ${refsChecked.toLocaleString()}`);
console.log(`Broken refs     : ${broken.length.toLocaleString()}`);

console.log('\nReferences by target type:');
Object.entries(perExt)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)
  .forEach(([ext, n]) => console.log(`  ${ext.padEnd(10)} ${n.toLocaleString()}`));

if (broken.length) {
  console.log(`\nFirst ${Math.min(reportLimit, broken.length)} broken references:`);
  for (const b of broken.slice(0, reportLimit)) {
    console.log(`  ${b.page}\n      -> ${b.ref}`);
  }
  // Group broken refs by target to expose systemic breakage vs one-offs.
  const byTarget = {};
  for (const b of broken) byTarget[b.resolved] = (byTarget[b.resolved] || 0) + 1;
  const top = Object.entries(byTarget).sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log('\nMost-referenced missing targets:');
  top.forEach(([t, n]) => console.log(`  ${String(n).padStart(6)}  ${t}`));
}

if (jsonOut) {
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        siteRoot,
        filesIndexed: filesLower.size,
        pagesScanned: pages.length,
        refsChecked,
        brokenCount: broken.length,
        broken,
      },
      null,
      2
    )
  );
  console.log(`\nJSON report written to ${jsonOut}`);
}

if (maxBroken !== null && Number.isFinite(maxBroken)) {
  if (broken.length > maxBroken) {
    console.error(
      `\nFAIL: ${broken.length} broken references, above the agreed ceiling of ${maxBroken}.\n` +
      'Something in the last change broke references that used to resolve.'
    );
    process.exit(1);
  }
  console.log(`\nOK: ${broken.length} broken references, at or below the ceiling of ${maxBroken}.`);
}
