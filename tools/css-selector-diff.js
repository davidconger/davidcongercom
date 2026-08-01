/**
 * Compare the selector sets of the old stylesheets against the consolidated
 * one, so consolidation cannot silently drop a rule that markup still uses.
 *
 * Usage: node tools/css-selector-diff.js <oldDir> <newFile>
 * where <oldDir> holds the pre-consolidation .css files extracted from git.
 */
const fs = require('fs');
const path = require('path');

function selectorsOf(css) {
  // Strip comments and at-rule preludes, then take everything before each '{'.
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Set();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(cleaned))) {
    const prelude = m[1].trim();
    if (!prelude || prelude.startsWith('@')) continue;
    prelude
      .split(',')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .forEach((s) => out.add(s));
  }
  return out;
}

const oldDir = process.argv[2];
const newFile = process.argv[3];

const oldSel = new Set();
for (const f of fs.readdirSync(oldDir).filter((f) => f.endsWith('.css'))) {
  selectorsOf(fs.readFileSync(path.join(oldDir, f), 'utf8')).forEach((s) => oldSel.add(s));
}

// Media-query bodies nest, so parse the new file's blocks after unwrapping @media.
const newRaw = fs.readFileSync(newFile, 'utf8').replace(/@media[^{]+\{/g, '');
const newSel = selectorsOf(newRaw);

const missing = [...oldSel].filter((s) => !newSel.has(s)).sort();
const added = [...newSel].filter((s) => !oldSel.has(s)).sort();

console.log(`Old selectors : ${oldSel.size}`);
console.log(`New selectors : ${newSel.size}`);
console.log(`\nPresent before, absent now (${missing.length}):`);
missing.forEach((s) => console.log('  - ' + s));
console.log(`\nNew in consolidated sheet (${added.length}):`);
added.forEach((s) => console.log('  + ' + s));
