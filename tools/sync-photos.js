#!/usr/bin/env node
/**
 * sync-photos.js - push photographs that exist locally but not on the server.
 *
 * WHY THIS EXISTS
 *
 * The site has two kinds of image and they need different machinery.
 *
 *   1. Derived site furniture - the 240x160 grid thumbnails, the per-event
 *      thumbnail.jpg covers, page chrome. About 3,100 files and 81 MB. These
 *      are generated from the originals, they change whenever the generator or
 *      the layout changes, and the markup cannot render without them. They are
 *      tracked in git and GitHub Actions ships them as the `images` scope.
 *
 *   2. The photographic archive - roughly 80,000 originals and 5.3 GB. These
 *      never change once published and they are the product. Putting them in
 *      git would mean a 5.3 GB clone, a 5.3 GB checkout on every CI run, and
 *      paying for LFS bandwidth to move bytes that never differ. They are
 *      deliberately untracked.
 *
 * That split is what .gitignore already encodes. The consequence is that a
 * GitHub Action can never publish tier 2, because the runner checks out git and
 * the originals are not in git. Something on the machine that actually holds
 * the photographs has to send them. This is that something.
 *
 * HOW IT DECIDES WHAT TO SEND
 *
 * It asks the live site. Every photograph has a public URL, so a HEAD request
 * is an exact answer to "is this already up?" - no FTP directory listing of
 * 80,000 files, no local state file to drift out of sync, and nothing to seed
 * on a first run. Re-running is therefore always safe and always cheap: files
 * already present are skipped after one HEAD each.
 *
 * It only ever uploads. There is no delete path in this script at all, which is
 * the same guarantee the deploy workflow gets from excluding *.jpg: nothing
 * here can remove a photograph from the server.
 *
 * USAGE
 *
 *   set AZURE_FTP_SERVER, AZURE_FTP_USERNAME, AZURE_FTP_PASSWORD
 *   node tools/sync-photos.js you/2009 --dry-run
 *   node tools/sync-photos.js you/2009
 *   node tools/sync-photos.js you --concurrency 8
 *
 * The path argument is required and scopes the run, so an accidental
 * invocation cannot start walking all 5.3 GB.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync, spawnSync } = require('child_process');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif']);
const SITE = process.env.SYNC_SITE || 'https://www.davidconger.com';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const includeTracked = args.includes('--include-tracked');
const cIdx = args.indexOf('--concurrency');
const CONCURRENCY = cIdx >= 0 ? Math.max(1, parseInt(args[cIdx + 1], 10) || 6) : 6;
const concurrencyValue = cIdx >= 0 ? args[cIdx + 1] : null;
const subtree = args.find(a => !a.startsWith('--') && a !== concurrencyValue);

if (!subtree) {
  console.error('usage: node tools/sync-photos.js <path-under-site-root> [--dry-run] [--concurrency N] [--include-tracked]');
  console.error('example: node tools/sync-photos.js you/2009 --dry-run');
  process.exit(2);
}

const ROOT = process.cwd();
const base = path.join(ROOT, subtree);
if (!fs.existsSync(base)) {
  console.error(`no such path: ${subtree}`);
  process.exit(2);
}

// ---------------------------------------------------------------- local files
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (IMAGE_EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}
const localFiles = fs.statSync(base).isDirectory() ? walk(base, []) : [base];
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

// Anything git tracks is the deploy workflow's job, not this script's. Sending
// it from here too would work but would put two publishers on one file.
let tracked = new Set();
if (!includeTracked) {
  try {
    tracked = new Set(
      execFileSync('git', ['ls-files', subtree], { cwd: ROOT, maxBuffer: 1 << 28 })
        .toString().split('\n').map(s => s.trim()).filter(Boolean)
    );
  } catch { /* not a git repo; treat everything as ours */ }
}

const candidates = localFiles.filter(f => !tracked.has(rel(f)));
const skippedTracked = localFiles.length - candidates.length;

console.log(`scope        : ${subtree}`);
console.log(`local images : ${localFiles.length}`);
if (skippedTracked) console.log(`  of which tracked by git (the deploy workflow ships these): ${skippedTracked}`);
console.log(`to check     : ${candidates.length}`);
if (!candidates.length) { console.log('\nnothing to do.'); process.exit(0); }

// ------------------------------------------------------------- server probing
function head(urlPath) {
  return new Promise(resolve => {
    const req = https.request(
      SITE + '/' + urlPath.split('/').map(encodeURIComponent).join('/'),
      { method: 'HEAD', timeout: 30000 },
      res => { res.resume(); resolve(res.statusCode); }
    );
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.end();
  });
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

// ------------------------------------------------------------------- uploading

/* No npm dependencies here, so the wait between attempts is done the only way a
 * synchronous loop can do it. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

let retried = 0;

function ftpUpload(localPath, remoteRel, creds, attempts = 3) {
  // curl speaks FTPS and creates missing directories, which keeps this free of
  // any npm dependency. --ftp-pasv matters behind NAT; -sS keeps the output to
  // errors only so the progress line below stays readable.
  //
  // curl is given --retry, but that does not cover what actually goes wrong here.
  // curl retries only what it considers transient - timeouts, an FTP 4xx, a few
  // HTTP 5xx - and Azure's FTP rejects the occasional STOR with 550, which is a
  // permanent code that curl will not retry by design. Measured over 1,388
  // uploads the rate was 0.9%, every one of them a full-size photograph and none
  // a thumbnail, and files larger than the largest failure went up fine. That is
  // a server-side hiccup that scales with how long the transfer is open, not
  // anything about the file. Retrying the whole invocation is the fix; the delay
  // grows so a busy moment on the server is given time to pass.
  const url = `ftp://${creds.server}/site/wwwroot/${remoteRel}`;
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const r = spawnSync('curl', [
      '--ssl-reqd', '--ftp-pasv', '--ftp-create-dirs',
      '--retry', '3', '--retry-delay', '2', '--connect-timeout', '30',
      '-sS', '-T', localPath,
      '-u', `${creds.user}:${creds.pass}`,
      url
    ], { encoding: 'utf8' });
    if (r.status === 0) {
      if (attempt > 1) retried++;
      return null;
    }
    // curl repeats its message once per internal retry, so the same sentence can
    // arrive four times over. Say it once.
    lastErr = [...new Set((r.stderr || `curl exit ${r.status}`).trim().split('\n')
      .map(s => s.trim()).filter(Boolean))].join('; ');

    // Some failures are settled on the first answer and will be identical on the
    // third: an unresolvable host, a rejected login, a local file that cannot be
    // read. Retrying those turns one wrong credential into three times the wait
    // on every one of several thousand files.
    if (/curl: \((6|67|26)\)/.test(lastErr)) return lastErr;

    if (attempt < attempts) sleepSync(attempt * 1500);
  }
  return lastErr + ` (after ${attempts} attempts)`;
}

(async () => {
  process.stdout.write('checking the server ... ');
  let checked = 0;
  const statuses = await mapLimit(candidates, CONCURRENCY, async f => {
    const s = await head(rel(f));
    if (++checked % 250 === 0) process.stdout.write(`${checked} `);
    return s;
  });
  console.log(`done (${checked} checked)`);

  const missing = [];
  let present = 0, errors = 0;
  candidates.forEach((f, i) => {
    const s = statuses[i];
    if (s === 200) present++;
    else if (s === 404) missing.push(f);
    else errors++;
  });

  const bytes = missing.reduce((n, f) => n + fs.statSync(f).size, 0);
  console.log(`\nalready on the server : ${present}`);
  console.log(`missing               : ${missing.length}  (${(bytes / 1048576).toFixed(1)} MB)`);
  if (errors) console.log(`inconclusive          : ${errors}  (network or non-200/404 status; left alone)`);

  if (!missing.length) { console.log('\nnothing to upload.'); return; }

  const byDir = {};
  for (const f of missing) {
    const d = path.dirname(rel(f)).split('/').slice(0, 3).join('/');
    byDir[d] = (byDir[d] || 0) + 1;
  }
  console.log('\nmissing by area:');
  Object.entries(byDir).sort((a, b) => b[1] - a[1]).slice(0, 20)
    .forEach(([d, n]) => console.log(`  ${String(n).padStart(5)}  ${d}`));

  if (dryRun) { console.log('\n--dry-run: nothing was uploaded.'); return; }

  const creds = {
    server: process.env.AZURE_FTP_SERVER,
    user: process.env.AZURE_FTP_USERNAME,
    pass: process.env.AZURE_FTP_PASSWORD
  };
  if (!creds.server || !creds.user || !creds.pass) {
    console.error('\nAZURE_FTP_SERVER, AZURE_FTP_USERNAME and AZURE_FTP_PASSWORD must be set to upload.');
    console.error('Run with --dry-run to see the plan without them.');
    process.exit(1);
  }
  // The publish profile stores a URL; this wants a bare hostname.
  creds.server = creds.server.replace(/^ftps?:\/\//i, '').replace(/\/.*$/, '');

  console.log(`\nuploading ${missing.length} files to ${creds.server} ...`);
  let ok = 0; const failed = [];
  const started = Date.now();
  for (let i = 0; i < missing.length; i++) {
    const r = rel(missing[i]);
    const err = ftpUpload(missing[i], r, creds);
    if (err) { failed.push([r, err]); } else { ok++; }
    if ((i + 1) % 25 === 0 || i === missing.length - 1) {
      const pct = (((i + 1) / missing.length) * 100).toFixed(0);
      const secs = (Date.now() - started) / 1000;
      process.stdout.write(`\r  ${i + 1}/${missing.length} (${pct}%)  ok=${ok} failed=${failed.length}  ${secs.toFixed(0)}s   `);
    }
  }
  console.log('');

  if (retried) {
    console.log(`\n${retried} upload(s) failed once and succeeded on a retry.`);
  }

  if (failed.length) {
    console.log(`\n${failed.length} failed:`);
    failed.slice(0, 20).forEach(([f, e]) => console.log(`  ${f}\n     ${e}`));
    console.log('\nRe-run the same command; anything that made it up is skipped by the HEAD check.');
    process.exit(1);
  }
  console.log(`\nuploaded ${ok} files. Re-run with --dry-run to confirm the server now has them.`);
})();
