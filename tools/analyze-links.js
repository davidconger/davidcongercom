const fs = require('fs');
const path = require('path');
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const byTop = {};
for (const b of d.broken) {
  const top = b.page.split('/').slice(0, 2).join('/');
  byTop[top] = (byTop[top] || 0) + 1;
}
console.log('Broken refs grouped by page location (top 15):');
Object.entries(byTop)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([k, v]) => console.log('  ' + String(v).padStart(7) + '  ' + k));

const pages = new Set(d.broken.map((b) => b.page));
console.log(`\nDistinct pages with >=1 broken ref: ${pages.size} of ${d.pagesScanned}`);

console.log('\nSample pages referencing you/css/all.css:');
d.broken
  .filter((b) => b.resolved === 'you/css/all.css')
  .slice(0, 5)
  .forEach((b) => console.log('  ' + b.page + '   ref=' + b.ref));

console.log('\nSample pages referencing you/2023/index.htm:');
d.broken
  .filter((b) => b.resolved === 'you/2023/index.htm')
  .slice(0, 5)
  .forEach((b) => console.log('  ' + b.page + '   ref=' + b.ref));

// How many broken refs live in directories we are about to delete anyway?
// Note: folder casing is inconsistent across eras ("old" vs "Old"), so match
// case-insensitively or the you/2023/Old tree gets miscounted as live.
const DOOMED = /(^|\/)(_data|old|you_old)\//i;
const doomed = d.broken.filter((b) => DOOMED.test(b.page) || /\.old$/i.test(b.page));
console.log(`\nBroken refs inside soon-to-be-deleted trees (_data, old, you_old): ${doomed.length}`);

const live = d.broken.filter((b) => !(DOOMED.test(b.page) || /\.old$/i.test(b.page)));
console.log(`Broken refs on genuinely live pages: ${live.length}`);
const liveByTarget = {};
for (const b of live) liveByTarget[b.resolved] = (liveByTarget[b.resolved] || 0) + 1;
console.log('\nTop missing targets on live pages:');
Object.entries(liveByTarget)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([k, v]) => console.log('  ' + String(v).padStart(6) + '  ' + k));
