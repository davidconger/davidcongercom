/**
 * Repairs <meta name="description"> tags truncated at an apostrophe.
 *
 * seo-pass.js copied each page's hand-written og:description into a new
 * name="description" tag, but captured the attribute value with a ["']([^"']*)["']
 * pattern. An apostrophe is an ordinary character inside a double-quoted
 * attribute, so every description containing one was cut short at it:
 *
 *   <meta property="og:description" content="Photos of Guns N' Roses performing at Key Arena."/>
 *   <meta name="description" content="Photos of Guns N">
 *
 * The og:description tags were never rewritten and still hold the full text,
 * so the repair is to copy their raw attribute content back across verbatim.
 * Verbatim, not decoded and re-escaped, because the source value is already
 * escaped for a double-quoted attribute context.
 *
 * Usage:
 *   node tools/fix-descriptions.js --dry-run
 *   node tools/fix-descriptions.js
 *
 * Safe to re-run: it only touches pages where the description is a strict
 * prefix of the og:description.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['.git', 'node_modules', 'tools', 'you_old']);
const dryRun = process.argv.includes('--dry-run');
const verbose = process.argv.includes('--verbose');

const DESC_RE = /(<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*)(["'])([\s\S]*?)\2/i;
const OG_RE = /<meta[^>]+property\s*=\s*["']og:description["'][^>]*content\s*=\s*(["'])([\s\S]*?)\1/i;

let scanned = 0;
let fixed = 0;
const samples = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(path.join(dir, e.name)); continue; }
    if (!/\.html?$/i.test(e.name)) continue;
    const file = path.join(dir, e.name);
    scanned++;

    const html = fs.readFileSync(file, 'utf8');
    const desc = DESC_RE.exec(html);
    const og = OG_RE.exec(html);
    if (!desc || !og) continue;

    const short = desc[3];
    const full = og[2];
    // A genuine truncation, not merely a shorter alternative wording.
    if (full.length <= short.length || !full.startsWith(short)) continue;
    // The template pages carry literal {2} placeholders in both tags.
    if (/^\{\d+\}$/.test(short)) continue;

    const replacement = `${desc[1]}${desc[2]}${full}${desc[2]}`;
    const out = html.replace(desc[0], () => replacement);
    fixed++;
    if (samples.length < 8) samples.push([path.relative(ROOT, file).replace(/\\/g, '/'), short, full]);
    if (verbose) console.log(`  ${path.relative(ROOT, file).replace(/\\/g, '/')}`);
    if (!dryRun) fs.writeFileSync(file, out, 'utf8');
  }
}

walk(ROOT);

console.log(`\npages scanned          : ${scanned.toLocaleString()}`);
console.log(`truncated descriptions : ${fixed.toLocaleString()}${dryRun ? ' (dry run, nothing written)' : ' repaired'}`);
if (samples.length) {
  console.log('\nsample:');
  for (const [f, s, l] of samples) {
    console.log(`  ${f}`);
    console.log(`    was : "${s}"`);
    console.log(`    now : "${l}"`);
  }
}
