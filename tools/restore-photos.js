#!/usr/bin/env node
/**
 * restore-photos.js - put photographs back on the server in bulk, over HTTPS.
 *
 * WHY THIS EXISTS
 *
 * sync-photos.js sends one file per FTP connection, which is fine for the
 * handful a new event adds but not for a restore. Measured on this site it
 * manages roughly 0.6 files a second, so the 16,479 photographs a deploy once
 * pruned from /you/ would take about eight hours.
 *
 * Kudu will extract an archive server-side:
 *
 *     PUT https://<app>.scm.azurewebsites.net/api/zip/site/wwwroot/<dir>/
 *
 * That is one request per folder instead of one per photograph, and the bytes
 * travel as a single stream rather than several hundred handshakes. The same
 * restore takes minutes.
 *
 * WHAT IT WILL NOT DO
 *
 * The zip endpoint extracts *into* a directory. It adds and overwrites; it does
 * not mirror, so nothing already on the server is removed by a run of this
 * script. As with sync-photos.js there is no delete path here at all.
 *
 * It also refuses to send a folder it has not first confirmed is incomplete,
 * which keeps a re-run cheap and makes an interrupted restore safe to repeat.
 *
 * USAGE
 *
 *   set AZURE_FTP_USERNAME and AZURE_FTP_PASSWORD   (same as sync-photos.js)
 *   node tools/restore-photos.js you --dry-run
 *   node tools/restore-photos.js you
 *   node tools/restore-photos.js you/2011 --concurrency 12
 *
 * The path argument is required, so an accidental invocation cannot start
 * zipping all 5.3 GB.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif']);
const SITE = process.env.SYNC_SITE || 'https://www.davidconger.com';
const SCM = process.env.AZURE_SCM_SERVER || 'davidconger.scm.azurewebsites.net';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const cIdx = args.indexOf('--concurrency');
const CONCURRENCY = cIdx >= 0 ? Math.max(1, parseInt(args[cIdx + 1], 10) || 8) : 8;
const concurrencyValue = cIdx >= 0 ? args[cIdx + 1] : null;
const subtree = args.find(a => !a.startsWith('--') && a !== concurrencyValue);

if (!subtree) {
  console.error('usage: node tools/restore-photos.js <path-under-site-root> [--dry-run] [--concurrency N]');
  console.error('example: node tools/restore-photos.js you/2011 --dry-run');
  process.exit(2);
}

const ROOT = process.cwd();
const base = path.join(ROOT, subtree);
if (!fs.existsSync(base)) {
  console.error(`no such path: ${subtree}`);
  process.exit(2);
}

const rel = f => path.relative(ROOT, f).replace(/\\/g, '/');

// ------------------------------------------------------------------ zip writer
//
// Written by hand because tools/ carries no npm dependencies. Only the subset
// the endpoint needs: one flat directory of files, stored rather than deflated.
//
// Deflating a JPEG buys nothing -- the entropy coding has already been done --
// and storing keeps this short enough to read, which matters more than a
// percent of transfer size for a format where a subtle bug means silently
// corrupt photographs.

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* MS-DOS packed date and time, which is what the format stores. */
function dosStamp(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF,
    date: (((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF
  };
}

/* Builds a zip of the given files, flat, and returns the path of a temp file.
 * Written to disk rather than held in memory so a large event folder cannot
 * push the process into swap. */
function buildZip(files) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-'));
  const zipPath = path.join(out, 'payload.zip');
  const fd = fs.openSync(zipPath, 'w');
  let offset = 0;
  const central = [];

  const write = buf => { fs.writeSync(fd, buf); offset += buf.length; };

  for (const file of files) {
    const data = fs.readFileSync(file);
    const name = Buffer.from(path.basename(file), 'utf8');
    const st = fs.statSync(file);
    const { time, date } = dosStamp(st.mtime);
    const crc = crc32(data);
    const localOffset = offset;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // UTF-8 names
    local.writeUInt16LE(0, 8);           // method: stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    write(local); write(name); write(data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);             // version made by
    cd.writeUInt16LE(20, 6);             // version needed
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);             // extra
    cd.writeUInt16LE(0, 32);             // comment
    cd.writeUInt16LE(0, 34);             // disk
    cd.writeUInt16LE(0, 36);             // internal attrs
    cd.writeUInt32LE(0, 38);             // external attrs
    cd.writeUInt32LE(localOffset, 42);
    central.push(Buffer.concat([cd, name]));
  }

  const cdOffset = offset;
  for (const c of central) write(c);
  const cdSize = offset - cdOffset;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(cdOffset, 16);
  end.writeUInt16LE(0, 20);
  write(end);

  fs.closeSync(fd);
  return zipPath;
}

// ------------------------------------------------------------------ local files

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (IMAGE_EXT.has(path.extname(e.name).toLowerCase())) out.push(f);
  }
  return out;
}

// ------------------------------------------------------------------- server ask

function head(urlPath) {
  const safe = urlPath.split('/').map(encodeURIComponent).join('/');
  return new Promise(resolve => {
    const req = https.request(
      { host: SITE.replace(/^https?:\/\//, ''), path: '/' + safe, method: 'HEAD', timeout: 20000 },
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
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) { const n = i++; out[n] = await fn(items[n], n); }
  }));
  return out;
}

// ---------------------------------------------------------------- kudu transfer

function putZip(zipPath, remoteDir, creds) {
  const user = creds.user.includes('\\') ? creds.user.split('\\').pop() : creds.user;
  const url = `https://${SCM}/api/zip/site/wwwroot/${remoteDir}/`;
  const r = spawnSync('curl', [
    '-sS', '--connect-timeout', '30', '--max-time', '900',
    '-X', 'PUT',
    '-u', `${user}:${creds.pass}`,
    '-T', zipPath,
    '-H', 'Content-Type: application/zip',
    '-o', os.devNull,
    '-w', '%{http_code}',
    url
  ], { encoding: 'utf8' });
  if (r.status !== 0) {
    return [...new Set((r.stderr || `curl exit ${r.status}`).trim().split('\n')
      .map(s => s.trim()).filter(Boolean))].join('; ');
  }
  const code = (r.stdout || '').trim();
  return /^20[0-46]$/.test(code) ? null : `Kudu answered HTTP ${code}`;
}

// ------------------------------------------------------------------------- main

(async () => {
  const local = walk(base);
  console.log(`scope        : ${subtree}`);
  console.log(`local images : ${local.length}`);
  if (!local.length) { console.log('nothing to do.'); return; }

  process.stdout.write('checking the server ... ');
  let checked = 0;
  const codes = await mapLimit(local, CONCURRENCY, async f => {
    const c = await head(rel(f));
    if (++checked % 500 === 0) process.stdout.write(`${checked} `);
    return c;
  });
  console.log(`done (${checked} checked)`);

  const missing = local.filter((f, i) => codes[i] !== 200);
  const present = local.length - missing.length;
  console.log(`\nalready on the server : ${present}`);
  const bytes = missing.reduce((s, f) => s + fs.statSync(f).size, 0);
  console.log(`missing               : ${missing.length}  (${(bytes / 1048576).toFixed(1)} MB)`);
  if (!missing.length) { console.log('\nnothing to restore.'); return; }

  /* One zip per directory, because that is the unit the endpoint extracts
   * into. Sending only the files that are actually missing keeps a resumed run
   * proportional to what is left rather than to the size of the folder. */
  const byDir = new Map();
  for (const f of missing) {
    const d = path.dirname(f);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(f);
  }
  console.log(`folders               : ${byDir.size}`);

  if (dryRun) {
    console.log('\nwould send:');
    for (const [d, files] of byDir) console.log(`  ${String(files.length).padStart(5)}  ${rel(d)}`);
    console.log('\n--dry-run: nothing was uploaded.');
    return;
  }

  const creds = { user: process.env.AZURE_FTP_USERNAME, pass: process.env.AZURE_FTP_PASSWORD };
  if (!creds.user || !creds.pass) {
    console.error('\nAZURE_FTP_USERNAME and AZURE_FTP_PASSWORD must be set to upload.');
    console.error('Run with --dry-run to see the plan without them.');
    process.exit(1);
  }

  console.log(`\nsending ${byDir.size} folders to ${SCM} ...`);
  const started = Date.now();
  let done = 0, sent = 0;
  const failed = [];

  for (const [dir, files] of byDir) {
    const remote = rel(dir);
    let zipPath = null;
    try {
      zipPath = buildZip(files);
      const err = putZip(zipPath, remote, creds);
      if (err) failed.push([remote, err]); else sent += files.length;
    } catch (e) {
      failed.push([remote, e.message]);
    } finally {
      if (zipPath) fs.rmSync(path.dirname(zipPath), { recursive: true, force: true });
    }
    done++;
    const secs = Math.round((Date.now() - started) / 1000);
    process.stdout.write(`\r  ${done}/${byDir.size} folders  ${sent} files  ${failed.length} failed  ${secs}s   `);
  }
  console.log('');

  if (failed.length) {
    console.log(`\n${failed.length} folder(s) failed:`);
    failed.slice(0, 20).forEach(([d, e]) => console.log(`  ${d}\n     ${e}`));
    if (failed.length > 20) console.log(`  ... and ${failed.length - 20} more`);
  }
  console.log(`\nsent ${sent} files. Re-run with --dry-run to confirm the server has them.`);
  process.exit(failed.length ? 1 : 0);
})();
