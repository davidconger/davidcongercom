/**
 * Removes the 8,036 retired /you/ pages from the server.
 *
 * The lightbox replaced a page-per-photograph with a single gallery, and commit
 * 2a76421fe deleted those pages from the repository. They are still on the
 * server, because the directories holding them are excluded from deploys -- and
 * they are excluded for a very good reason, which is that a deploy once pruned
 * those same directories and took 16,479 photographs with them. So the pages
 * have to be swept up deliberately rather than by letting a sync notice them.
 *
 * Nothing reaches them: IIS runs its rewrite rules before it looks for a file,
 * so every one of these URLs answers 301 whether or not the page is there. This
 * reclaims ~77 MB and removes a trap for anyone reading the tree later.
 *
 * WHAT IT WILL AND WILL NOT TOUCH
 *
 * The list is not guessed and the server is not enumerated. It is exactly the
 * set of files that commit removed, read back out of git, and every path is
 * checked against three shapes before anything is sent:
 *
 *     you/<year>/<event>/gallery/<name>.htm
 *     you/<year>/<event>/page-<n>/<name>.htm
 *     you/<year>/<event>/page-<n>.htm
 *
 * A path that is not under you/, does not end in .htm, or does not match one of
 * those is a bug rather than an edge case, and the tool stops instead of
 * deciding what to do about it. No extension other than .htm can be deleted by
 * this script even if the commit is wrong, which is the property that matters:
 * the archive is .jpg, and no .jpg can be named here.
 *
 * It also asks the live site for a photograph out of the affected folders
 * before and after, and stops if one stops being served.
 *
 * Usage:
 *   node tools/sweep-retired.js                 # dry run: says what it would delete
 *   node tools/sweep-retired.js --delete --limit=5   # prove the mechanism on five
 *   node tools/sweep-retired.js --delete        # actually deletes the rest
 *
 * Needs AZURE_FTP_USERNAME and AZURE_FTP_PASSWORD for the --delete pass. The
 * Kudu username is the FTP one without the `davidconger\` prefix; that is
 * handled here.
 */
const https = require('https');
const { execFileSync } = require('child_process');

const SCM = process.env.AZURE_SCM_SERVER || 'davidconger.scm.azurewebsites.net';
const SITE = process.env.SYNC_SITE || 'www.davidconger.com';
const COMMIT = process.env.SWEEP_COMMIT || '2a76421fe';
const CONCURRENCY = 8;

const doDelete = process.argv.includes('--delete');
/* Deleting five and looking is how you find out the request shape is right
   before finding out eight thousand times. */
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 0;

const SHAPES = [
  /^you\/[^/]+\/[^/]+\/gallery\/[^/]+\.htm$/,
  /^you\/[^/]+\/[^/]+\/page-\d+\/[^/]+\.htm$/,
  /^you\/[^/]+\/[^/]+\/page-\d+\.htm$/,
];

/* Photographs living in the folders this touches. If deleting pages ever costs
   us one of these, that is the same failure as before and the run stops. */
const CANARIES = [
  '/you/2009/jbb-tickets-on-sale/gallery/jbb-tickets-on-sale-01.jpg',
  '/you/2013/austin-mahone-at-seattle-childrens-hospital/page-1/austin-mahone-at-seattlechildrens-hospital-01.jpg',
];
/* A retired URL: it must still answer 301 afterwards, because the rewrite runs
   before IIS looks for the file. If this ever stops being true, deleting the
   pages would be turning live URLs into 404s. */
const REDIRECT_PROBE = '/you/2013/buddy-guy-at-snoqualmie-casino/page-1/buddy-guy-at-snoqualmie-casino-03.htm';

function request(opts, body) {
  return new Promise(resolve => {
    const r = https.request(opts, res => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location });
    });
    r.on('error', e => resolve({ status: 0, error: e.message }));
    r.on('timeout', () => { r.destroy(); resolve({ status: 0, error: 'timeout' }); });
    if (body) r.write(body);
    r.end();
  });
}

const head = path =>
  request({ host: SITE, path: path.split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/'), method: 'HEAD', timeout: 20000 });

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const n = i++; out[n] = await fn(items[n], n); }
  }));
  return out;
}

function listRetired() {
  const raw = execFileSync('git', ['show', '--diff-filter=D', '--name-only', '--pretty=format:', COMMIT],
    { encoding: 'utf8', maxBuffer: 1 << 28 });
  return raw.split('\n').map(s => s.trim()).filter(Boolean);
}

(async () => {
  const files = listRetired();
  console.log(`commit ${COMMIT} deleted ${files.length.toLocaleString()} file(s)\n`);

  const bad = files.filter(f => !SHAPES.some(re => re.test(f)));
  if (bad.length) {
    console.error(`${bad.length} path(s) do not match a retired-page shape. Refusing to delete anything.`);
    bad.slice(0, 20).forEach(f => console.error('   ' + f));
    process.exit(1);
  }
  console.log(`all ${files.length.toLocaleString()} paths matched a retired-page shape (.htm under you/, in gallery/ or page-N/)`);

  process.stdout.write('checking the archive and the redirects before starting ... ');
  const before = await Promise.all(CANARIES.map(head));
  const redirect = await head(REDIRECT_PROBE);
  console.log('done');
  before.forEach((r, i) => console.log(`   photograph ${r.status}   ${CANARIES[i]}`));
  console.log(`   retired URL ${redirect.status}${redirect.location ? ' -> ' + redirect.location : ''}   ${REDIRECT_PROBE}`);
  if (before.some(r => r.status !== 200)) {
    console.error('\nA photograph is not being served. Fix that before deleting anything.');
    process.exit(1);
  }
  if (redirect.status !== 301) {
    console.error('\nThe retired URL is not redirecting, so these pages may still be reachable. Stopping.');
    process.exit(1);
  }

  if (!doDelete) {
    const n = limit ? Math.min(limit, files.length) : files.length;
    console.log(`\nDry run. ${n.toLocaleString()} pages would be deleted, ~${Math.round(n * 9.6 / 1024)} MB.`);
    console.log('Nothing was sent. Re-run with --delete to actually remove them.');
    if (limit) (limit ? files.slice(0, limit) : files).forEach(f => console.log('   ' + f));
    return;
  }

  const user = (process.env.AZURE_FTP_USERNAME || '').includes('\\')
    ? process.env.AZURE_FTP_USERNAME.split('\\').pop()
    : process.env.AZURE_FTP_USERNAME;
  const pass = process.env.AZURE_FTP_PASSWORD;
  if (!user || !pass) {
    console.error('\nAZURE_FTP_USERNAME and AZURE_FTP_PASSWORD must be set to delete.');
    process.exit(1);
  }

  console.log(`\ndeleting ${(limit ? Math.min(limit, files.length) : files.length).toLocaleString()} pages over HTTPS ...`);
  const targets = limit ? files.slice(0, limit) : files;
  let done = 0, gone = 0, already = 0;
  const failures = [];

  await mapLimit(targets, CONCURRENCY, async rel => {
    const path = '/api/vfs/site/wwwroot/' + rel.split('/').map(encodeURIComponent).join('/');
    let last = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await request({
        host: SCM, path, method: 'DELETE', timeout: 30000,
        auth: `${user}:${pass}`, headers: { 'If-Match': '*' },
      });
      if (r.status === 200 || r.status === 204) { gone++; last = null; break; }
      if (r.status === 404) { already++; last = null; break; }
      last = r.error ? r.error : 'HTTP ' + r.status;
      await new Promise(r2 => setTimeout(r2, 500 * (attempt + 1)));
    }
    if (last) failures.push(`${rel}  ${last}`);
    if (++done % 500 === 0) process.stdout.write(`${done} `);
  });
  console.log(`done (${done.toLocaleString()} processed)`);

  console.log(`\ndeleted            : ${gone.toLocaleString()}`);
  console.log(`already gone       : ${already.toLocaleString()}`);
  console.log(`failed             : ${failures.length.toLocaleString()}`);
  failures.slice(0, 15).forEach(f => console.log('   ' + f));

  process.stdout.write('\nchecking the archive and the redirects again ... ');
  const after = await Promise.all(CANARIES.map(head));
  const redirectAfter = await head(REDIRECT_PROBE);
  console.log('done');
  after.forEach((r, i) => console.log(`   photograph ${r.status}   ${CANARIES[i]}`));
  console.log(`   retired URL ${redirectAfter.status}${redirectAfter.location ? ' -> ' + redirectAfter.location : ''}`);

  const lostPhoto = after.some(r => r.status !== 200);
  const lostRedirect = redirectAfter.status !== 301;
  if (lostPhoto || lostRedirect) {
    console.error('\nSomething that was working before is not working now. Investigate before running this again.');
    process.exit(1);
  }
  console.log('\nThe photographs are still served and the retired URLs still redirect.');
})();
