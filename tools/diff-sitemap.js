/**
 * Confirms the regenerated sitemap still covers every URL the old one listed.
 * Coverage may only grow: a URL dropping out would mean losing an indexed page.
 *
 *   node tools/diff-sitemap.js <old.xml> <new.xml>
 */
const fs = require('fs');

const locs = (f) => new Set(
  [...fs.readFileSync(f, 'utf8').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
    .map((m) => decodeURIComponent(m[1].replace(/&amp;/g, '&')))
);

const [oldFile, newFile] = process.argv.slice(2);
const before = locs(oldFile);
const after = locs(newFile);

/** The old generator listed both `/path/` and `/path/index.htm`; the new one
 *  emits only the canonical directory form, so compare on that basis. */
const canon = (u) => u.replace(/index\.html?$/i, '');
const afterCanon = new Set([...after].map(canon));

const dropped = [...before].filter((u) => !after.has(u) && !afterCanon.has(canon(u)));
const added = [...after].filter((u) => !before.has(u) && !before.has(canon(u)));

console.log(`  old URLs : ${before.size}`);
console.log(`  new URLs : ${after.size}`);
console.log(`  added    : ${added.length}`);
console.log(`  DROPPED  : ${dropped.length}`);
dropped.slice(0, 25).forEach((u) => console.log(`      ${u}`));
