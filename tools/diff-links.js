const fs = require('fs');
const a = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const b = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));

const key = (x) => `${x.page}|${x.ref}`;
const setA = new Set(a.broken.map(key));
const setB = new Set(b.broken.map(key));

const added = b.broken.filter((x) => !setA.has(key(x)));
const fixed = a.broken.filter((x) => !setB.has(key(x)));

console.log(`Baseline broken : ${a.brokenCount}`);
console.log(`Current broken  : ${b.brokenCount}`);
console.log(`NEWLY broken    : ${added.length}`);
console.log(`Fixed/removed   : ${fixed.length}`);

if (added.length) {
  const byTarget = {};
  for (const x of added) byTarget[x.resolved] = (byTarget[x.resolved] || 0) + 1;
  console.log('\nNewly broken targets:');
  Object.entries(byTarget)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k}`));
  console.log('\nSample newly broken refs:');
  added.slice(0, 10).forEach((x) => console.log(`  ${x.page}  ->  ${x.ref}`));
}
