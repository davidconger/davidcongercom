/**
 * Recover files that exist on the live site but are missing locally.
 *
 * Why this exists: OneDrive Files On-Demand keeps some folders as dehydrated
 * placeholders. Those folders are invisible to git and can read as empty to
 * directory-walking scripts, so local copies of the site can be incomplete.
 * Production on Azure is the authoritative copy, so pull the gaps from there.
 *
 * Usage:
 *   node tools/recover-from-live.js <siteRoot> <linkReport.json> [--baseline <b.json>] [--apply]
 *
 * Without --apply it only reports what it would fetch.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const siteRoot = path.resolve(process.argv[2]);
const reportPath = process.argv[3];
const baseIdx = process.argv.indexOf('--baseline');
const basePath = baseIdx > -1 ? process.argv[baseIdx + 1] : null;
const apply = process.argv.includes('--apply');
const ORIGIN = 'https://www.davidconger.com';

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
let broken = report.broken;

// If a baseline is supplied, only chase things that broke *since* the baseline.
if (basePath) {
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const seen = new Set(base.broken.map((x) => `${x.page}|${x.ref}`));
  broken = broken.filter((x) => !seen.has(`${x.page}|${x.ref}`));
}

// Unique target paths that look like real files (have an extension).
const targets = [...new Set(broken.map((b) => b.resolved))]
  .filter((t) => /\.[a-z0-9]{2,5}$/i.test(t))
  .sort();

console.log(`Candidate files to recover from ${ORIGIN}: ${targets.length}`);
if (!apply) {
  targets.forEach((t) => console.log('  ' + t));
  console.log('\n(dry run - pass --apply to download)');
  process.exit(0);
}

function fetch(urlPath) {
  return new Promise((resolve) => {
    const url = ORIGIN + '/' + urlPath.split('/').map(encodeURIComponent).join('/');
    https
      .get(url, { timeout: 30000 }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve({ ok: false, status: res.statusCode });
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ ok: true, body: Buffer.concat(chunks) }));
      })
      .on('error', (e) => resolve({ ok: false, status: e.message }))
      .on('timeout', function () {
        this.destroy();
        resolve({ ok: false, status: 'timeout' });
      });
  });
}

(async () => {
  let recovered = 0;
  const failed = [];
  for (const t of targets) {
    const dest = path.join(siteRoot, t);
    if (fs.existsSync(dest)) continue;
    const r = await fetch(t);
    if (r.ok) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, r.body);
      recovered++;
      console.log(`  OK   ${t}  (${r.body.length.toLocaleString()} bytes)`);
    } else {
      failed.push({ t, status: r.status });
      console.log(`  MISS ${t}  (${r.status})`);
    }
  }
  console.log(`\nRecovered: ${recovered}`);
  console.log(`Not on live site: ${failed.length}`);
  failed.forEach((f) => console.log(`  ${f.t}  ${f.status}`));
})();
