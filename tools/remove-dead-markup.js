/**
 * Deletes commented-out markup that has been dead for years.
 *
 * This is not the same job as tools/strip-comments.js. That one hides
 * maintenance notes from the published copy while keeping them in git,
 * because they are worth something to whoever edits this next. What is
 * removed here is worth nothing to anybody, in the repository or on the
 * wire: markup that was commented out to disable it and then left behind.
 *
 *   fb:app_id      a Facebook application that no longer exists, commented
 *                  out on 641 pages and carried ever since
 *   dcListingNav   the FrontPage listing navigation, replaced years ago
 *   byartist /     the "-or- List: By Artist | By Venue" fragments that went
 *   byvenue        with it
 *   lte IE 6       a centring hack for a browser retired in 2014
 *   gte mso 9      two non-breaking spaces that only Word ever rendered
 *   01.25.2009     a single news item from the front page of 2009
 *
 * Matching is by explicit pattern against the comment body rather than by
 * anything general, so the blast radius is exactly the list above. Every
 * other comment in the tree is left untouched -- in particular CATALOG START
 * and CATALOG END, which tools/merge-you-previous.js parses and throws
 * without.
 *
 *   node tools/remove-dead-markup.js            report what would go
 *   node tools/remove-dead-markup.js --write    remove it
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', '.github', 'node_modules', 'tools']);

const DEAD = [
  { name: 'fb:app_id meta', test: (b) => /^<meta\s+property="fb:app_id"/i.test(b) },
  { name: 'dcListingNav block', test: (b) => /^<div\s+id="dcListingNav"/i.test(b) },
  { name: 'By Artist / By Venue nav', test: (b) => b.length < 400 && /byartist\.htm|byvenue\.htm/i.test(b) },
  { name: 'IE 6 centring hack', test: (b) => /^\[if\s+lte\s+IE\s+6\]/i.test(b) },
  { name: 'Word (mso) spacer', test: (b) => /^\[if\s+gte\s+mso\s+9\]/i.test(b) },
  { name: '2009 news item', test: (b) => /^01\.25\.2009:/.test(b) },
  { name: 'empty comment', test: (b) => b === '' },
];

/** Never removed, whatever else matches. */
const PROTECTED = /^CATALOG (START|END)$/;

const write = process.argv.includes('--write');

const tally = new Map(DEAD.map((d) => [d.name, 0]));
let files = 0, filesChanged = 0, removed = 0, bytes = 0;

function scrub(src) {
  let out = '';
  let i = 0;
  let hits = 0;
  while (i < src.length) {
    const at = src.indexOf('<!--', i);
    if (at === -1) { out += src.slice(i); break; }
    const end = src.indexOf('-->', at + 4);
    if (end === -1) { out += src.slice(i); break; }

    const body = src.slice(at + 4, end).trim();
    const match = PROTECTED.test(body) ? null : DEAD.find((d) => d.test(body));

    if (!match) {
      out += src.slice(i, end + 3);
      i = end + 3;
      continue;
    }

    tally.set(match.name, tally.get(match.name) + 1);
    hits++;
    bytes += end + 3 - at;

    // Take the whole line with it when the comment was the only thing on it,
    // so removing one does not leave a stranded blank line behind.
    const lineStart = src.lastIndexOf('\n', at - 1) + 1;
    const soloLine = /^[ \t]*$/.test(src.slice(lineStart, at));
    let stop = end + 3;
    if (soloLine) {
      const rest = src.slice(stop);
      const nl = rest.match(/^[ \t]*\r?\n/);
      if (nl) {
        out += src.slice(i, lineStart);
        i = stop + nl[0].length;
        continue;
      }
    }
    out += src.slice(i, at);
    i = stop;
  }
  return { out, hits };
}

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full);
      continue;
    }
    if (!/\.html?$|\.htm$/i.test(e.name)) continue;

    const src = fs.readFileSync(full, 'utf8');
    files++;
    if (!src.includes('<!--')) continue;

    const { out, hits } = scrub(src);
    if (!hits) continue;
    filesChanged++;
    removed += hits;
    if (write) fs.writeFileSync(full, out, 'utf8');
  }
}

walk(ROOT);

console.log(`HTML files scanned : ${files.toLocaleString()}`);
console.log(`files affected     : ${filesChanged.toLocaleString()}`);
console.log(`comments removed   : ${removed.toLocaleString()}  (${(bytes / 1024).toFixed(1)} KB)`);
console.log('');
for (const [name, n] of [...tally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)} x ${name}`);
}
console.log(write ? '\nRemoved.' : '\nDry run; nothing written. Re-run with --write to apply.');
