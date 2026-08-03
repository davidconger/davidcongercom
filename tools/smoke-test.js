#!/usr/bin/env node
'use strict';

/*
 * smoke-test.js
 *
 * Checks the handful of things that would be catastrophic and silent if a deploy
 * got them wrong. It is deliberately short: this is not a crawl, it is the set of
 * behaviours that either work for the whole site or fail for the whole site.
 *
 * The most important line is the redirect check. web.config now carries a
 * 747-entry rewrite map, and that map has never run against real IIS. If the URL
 * Rewrite module were unavailable the whole site would answer 500, and if the map
 * were subtly wrong every link published before 2012 would break at once. One
 * request proves both.
 *
 *   node tools/smoke-test.js https://www.davidconger.com
 *   node tools/smoke-test.js https://www.davidconger.com --only home,redirect,notfound
 *   node tools/smoke-test.js https://www.davidconger.com --skip cache
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const base = (process.argv[2] || 'https://www.davidconger.com').replace(/\/$/, '');
function listArg(flag) {
  const a = process.argv.find(x => x.startsWith(flag + '='));
  return a ? a.slice(flag.length + 1).split(',').map(s => s.trim()).filter(Boolean) : null;
}
const only = listArg('--only');
const skip = listArg('--skip');

function request(url, chain = []) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(url, { method: 'GET', timeout: 30000 }, res => {
      const loc = res.headers.location;
      if (loc && res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        if (chain.length >= 5) return reject(new Error('too many redirects'));
        chain.push({ status: res.statusCode, to: new URL(loc, url).href });
        return resolve(request(new URL(loc, url).href, chain));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        chain
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timed out')); });
    req.end();
  });
}

/* Shared by the two redirect checks: did IIS issue the right permanent redirect? */
function redirectProblem(r) {
  if (r.status === 500) {
    return 'IIS returned 500 - the rewrite section is probably malformed or URL Rewrite is missing';
  }
  const moved = r.chain.find(h => h.status === 301);
  if (!moved) return 'no permanent redirect was issued (status ' + r.status + ')';
  if (!/\/galleries\/2011\/05\/atrak\/?$/.test(new URL(moved.to).pathname)) {
    return 'redirected to ' + moved.to + ', which is not where the gallery now lives';
  }
  return null;
}

/* Each check returns null when it passes, or a sentence saying what was wrong. */
const CHECKS = [
  ['home', 'home page is served',
    '/', r => r.status === 200 && /David Conger/.test(r.body) ? null
      : 'status ' + r.status + (r.status === 200 ? ', but the name is missing from the body' : '')],

  ['css', 'the modernized stylesheet shipped',
    '/css/site.css', r => r.status === 200 && /--dc-|:root/.test(r.body) ? null
      : 'status ' + r.status + ' (before the first deploy this file does not exist)'],

  ['robots', 'robots.txt is served',
    '/robots.txt', r => r.status === 200 ? null : 'status ' + r.status],

  ['sitemap', 'sitemap lists the whole archive',
    '/sitemap.xml', r => {
      if (r.status !== 200) return 'status ' + r.status;
      const n = (r.body.match(/<loc>/g) || []).length;
      // 2,734 URLs: the gallery and event pages worth ranking, not the 8,045
      // single-photo and pagination pages that still answer but are no longer
      // advertised. The floor catches a truncated upload, not a slim sitemap.
      return n >= 2400 ? null : 'only ' + n + ' URLs';
    }],

  ['dirindex', 'a directory URL resolves to its index.htm',
    '/galleries/2011/05/atrak/', r => r.status === 200 ? null : 'status ' + r.status],

  // The whole 747-entry rewrite map stands or falls on this one request.
  ['redirect', 'a pre-2012 gallery address still redirects',
    '/galleries/atrak.htm', r => {
      const bad = redirectProblem(r);
      if (bad) return bad;
      if (r.status !== 200) return 'redirected correctly but the destination answered ' + r.status;
      return /Beyond Wonderland|A-Trak/i.test(r.body) ? null : 'landed on the right URL but the page looks wrong';
    }],

  // Same request, but stopping at the redirect itself. This is the version to run
  // when web.config has been shipped ahead of the pages, because the destination
  // gallery has no index.htm on the server yet and would answer 403.
  ['redirect-issued', 'the rewrite map is loaded and answering',
    '/galleries/atrak.htm', r => redirectProblem(r)],

  ['legacyurl', 'a long-published gallery URL is untouched',
    '/galleries/2019/12/deadmau5/index.htm', r => r.status === 200 ? null : 'status ' + r.status],

  ['you', 'the meet and greet section is up',
    '/you/', r => r.status === 200 ? null : 'status ' + r.status],

  // Bluesky proves the account owns davidconger.com by fetching this file. It is
  // the only extensionless file on the site, which is exactly why it is worth a
  // check: IIS answers 404.3 for an unmapped extension, so this URL 404s unless
  // web.config carries the mapping, and nothing else on the site would notice.
  ['atproto', 'the Bluesky domain verification file is served',
    '/.well-known/atproto-did', r => {
      if (r.status !== 200) {
        return 'status ' + r.status + ' - IIS needs the extensionless MIME map in web.config';
      }
      if (!/^did:plc:[a-z2-7]+$/.test(r.body.trim())) {
        return 'body is "' + r.body.trim().slice(0, 60) + '", which is not a DID';
      }
      // The spec says clients should tolerate stray whitespace, but also that the
      // server should not send any. This is our own file, so hold it to the
      // stricter half: a trailing newline is the classic way this breaks.
      if (r.body !== r.body.trim()) return 'the DID is served with surrounding whitespace';
      return null;
    }],

  ['notfound', 'a missing page gets the custom 404',
    '/this-page-should-never-exist-' + Date.now(), r => {
      if (r.status !== 404) return 'status ' + r.status + ', expected 404';
      return /David Conger/.test(r.body) ? null : 'served a 404 but not the site\'s own 404 page';
    }],

  ['cache', 'photographs are sent with a cache lifetime',
    '/galleries/2011/05/atrak/atrak-01.jpg', r => {
      if (r.status !== 200) return 'status ' + r.status;
      const cc = r.headers['cache-control'] || '';
      return /max-age=\d{4,}/.test(cc) ? null : 'Cache-Control is "' + (cc || 'absent') + '"';
    }]
];

(async () => {
  let checks = only ? CHECKS.filter(c => only.includes(c[0])) : CHECKS;
  if (skip) checks = checks.filter(c => !skip.includes(c[0]));

  const unknown = [...(only || []), ...(skip || [])]
    .filter(id => !CHECKS.some(c => c[0] === id));
  if (unknown.length) {
    console.error('No such check: ' + unknown.join(', '));
    console.error('Known checks: ' + CHECKS.map(c => c[0]).join(', '));
    process.exit(2);
  }

  const scope = [];
  if (only) scope.push('only ' + only.join(', '));
  if (skip) scope.push('without ' + skip.join(', '));
  console.log('Smoke testing ' + base + (scope.length ? ' (' + scope.join('; ') + ')' : '') + '\n');
  let failed = 0;

  for (const [, name, path, verify] of checks) {
    let problem;
    try {
      problem = verify(await request(base + path));
    } catch (err) {
      problem = err.message;
    }
    if (problem) {
      failed++;
      console.log('  FAIL  ' + name + '\n        ' + path + ' - ' + problem);
    } else {
      console.log('  ok    ' + name);
    }
  }

  console.log('');
  if (failed) {
    console.log(failed + ' of ' + checks.length + ' checks failed.');
    process.exit(1);
  }
  console.log('All ' + checks.length + ' checks passed.');
})();
