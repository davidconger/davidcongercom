/**
 * Strips maintenance comments out of the published copy of the site.
 *
 * The source is 46% comment by weight -- 58 KB of it across css/ and js/ --
 * because the reasoning behind twenty years of layout decisions is written
 * down next to the code that depends on it. That is worth keeping in the
 * repository and worth nothing to a visitor, who downloads all of it.
 *
 * This runs on the deploy runner against its own checkout, so the comments
 * stay in git and only the copy on the wire loses them. Nothing here deletes
 * a file or renames one: it only rewrites contents, so it cannot interact
 * with the sync's idea of what has gone missing.
 *
 * Conservative by construction. Only comments that START A LINE are removed.
 * That single rule is what makes it safe without a parser:
 *
 *   - `https://example.com` can never be mistaken for a line comment, because
 *     the slashes are not at the start of a line.
 *   - A regex literal containing an escaped comment opener cannot be mistaken
 *     for a block comment for the same reason.
 *   - A comment opener inside a CSS string is never at column 0.
 *
 * Anything trailing a line of code is left alone. Those are short labels, not
 * the prose this is for.
 *
 * Kept deliberately:
 *   - `/*!` and `<!--!` -- the convention for "this one must survive".
 *   - `<!--[if ...]>` conditional comments, which are markup, not commentary.
 *   - <!--CATALOG START--> / <!--CATALOG END-->, which tools/merge-you-previous.js
 *     parses and throws without.
 *
 *   node tools/strip-comments.js --write        rewrite files in place
 *   node tools/strip-comments.js --out DIR      write a stripped copy instead
 *   node tools/strip-comments.js                report only, change nothing
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* Directories that never reach the server, plus the ones whose comments are
   the point (tools/ is the maintenance code itself). */
const SKIP_DIRS = new Set([
  '.git', '.github', 'node_modules', 'tools', '_deploy-config', '_deploy-images',
]);

/* Load-bearing comment bodies, matched after trimming. */
const KEEP_HTML = [/^\[if\s/i, /^<!\[endif\]/i, /^CATALOG (START|END)$/, /^!/];

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const outAt = argv.indexOf('--out');
const outDir = outAt > -1 ? path.resolve(argv[outAt + 1]) : null;

/**
 * Removes block comments that begin a line, and runs of whole-line `//`
 * comments. `open`/`close` let the same walker serve CSS, JS and HTML.
 */
function stripBlocks(src, open, close, keep) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const at = src.indexOf(open, i);
    if (at === -1) { out += src.slice(i); break; }

    // Only a comment that starts its own line qualifies.
    let lineStart = src.lastIndexOf('\n', at - 1) + 1;
    const indent = src.slice(lineStart, at);
    if (!/^[ \t]*$/.test(indent)) {
      out += src.slice(i, at + open.length);
      i = at + open.length;
      continue;
    }

    const end = src.indexOf(close, at + open.length);
    if (end === -1) { out += src.slice(i); break; }

    const body = src.slice(at + open.length, end).trim();
    if (keep.some((re) => re.test(body))) {
      out += src.slice(i, end + close.length);
      i = end + close.length;
      continue;
    }

    // Take the indent with it, and the newline that followed, so removing a
    // comment does not leave a blank line where it stood.
    out += src.slice(i, lineStart);
    i = end + close.length;
    if (src[i] === '\r') i++;
    if (src[i] === '\n') i++;
  }
  return out;
}

/** Runs of whole-line `//` comments. Never touches `//` inside a line. */
function stripLineComments(src) {
  return src.replace(/^[ \t]*\/\/(?!!).*(?:\r?\n)?/gm, '');
}

function stripCss(src) {
  return stripBlocks(src, '/*', '*/', [/^!/]);
}

function stripJs(src) {
  return stripLineComments(stripBlocks(src, '/*', '*/', [/^!/]));
}

function stripHtml(src) {
  return stripBlocks(src, '<!--', '-->', KEEP_HTML);
}

const handlers = { '.css': stripCss, '.js': stripJs, '.htm': stripHtml, '.html': stripHtml };

let files = 0, changed = 0, before = 0, after = 0;
const perType = new Map();

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full);
      continue;
    }
    const ext = path.extname(e.name).toLowerCase();
    const fn = handlers[ext];
    if (!fn) continue;

    const src = fs.readFileSync(full, 'utf8');
    const stripped = fn(src);
    files++;
    before += src.length;
    after += stripped.length;

    const t = perType.get(ext) || { files: 0, saved: 0 };
    t.files++;
    t.saved += src.length - stripped.length;
    perType.set(ext, t);

    if (stripped !== src) changed++;

    if (outDir) {
      const dest = path.join(outDir, path.relative(ROOT, full));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, stripped, 'utf8');
    } else if (write && stripped !== src) {
      fs.writeFileSync(full, stripped, 'utf8');
    }
  }
}

walk(ROOT);

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`files considered : ${files.toLocaleString()}`);
console.log(`files changed    : ${changed.toLocaleString()}`);
for (const [ext, t] of [...perType].sort((a, b) => b[1].saved - a[1].saved)) {
  console.log(`  ${ext.padEnd(6)} ${String(t.files).padStart(5)} files   saved ${kb(t.saved).padStart(9)}`);
}
console.log(`bytes before     : ${kb(before)}`);
console.log(`bytes after      : ${kb(after)}`);
console.log(`saved            : ${kb(before - after)} (${(((before - after) / before) * 100).toFixed(1)}%)`);
console.log(outDir ? `\nWrote a stripped copy to ${outDir}` : write ? '\nRewrote in place.' : '\nReport only; nothing written.');
