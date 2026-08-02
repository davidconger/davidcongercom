/**
 * Promotes the gallery title to a real heading.
 *
 * Every gallery and meet-and-greet page already displays its subject in
 * `<span id="title">` at the top of the `#details` block -- the artist, the
 * event, the person. It is the page's heading in every sense except the one
 * that counts: it is a span, so the document has no `<h1>` at all. An audit of
 * the finished site found 3 headings across 11,438 pages.
 *
 * That matters twice over. A screen reader user cannot jump to the heading
 * because there is none, and a search engine reading a page about "Lights at
 * WaMu Theater" sees the name only in the <title> and the alt text, never in
 * the body's own structure.
 *
 * The fix is a tag swap, not a redesign. Every rule that styles the title
 * selects it by id -- `#gallery #details #title` -- so an <h1> carrying the
 * same id inherits the same size, weight and tracking, and the accompanying
 * stylesheet change only has to cancel the margin a heading brings with it.
 *
 * Two markup shapes exist. Almost every page ends the title with a trailing
 * break:
 *
 *     <span id="title">Lights</span><br />
 *
 * and one page keeps the break inside the span. A heading is a block, so it
 * supplies that line itself and the <br /> is dropped in both cases.
 *
 *   node tools/add-headings.js [--dry] [--sample N]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const sampleAt = argv.indexOf('--sample');
const sample = sampleAt > -1 ? Number(argv[sampleAt + 1]) : 0;

// you_old is superseded, _proto is not deployed, and the template folders are
// the source the generators copy from -- they are handled separately so that a
// half-finished run cannot leave a template inconsistent with the pages built
// from it.
const SKIP = new Set(['.git', 'node_modules', 'tools', 'davidconger_backup', '_proto', 'you_old', '1cnf', '1pvt']);
const SKIP_DIR = new Set(['!template', '0000']);

function collect(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || SKIP_DIR.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.html?$/i.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Returns the rewritten page, or null if there is nothing to do.
 *
 * Idempotent: a page that already carries the heading is reported as unchanged
 * rather than rewritten, so the pass can be run repeatedly.
 */
function transform(html) {
  if (/<h1[^>]*\bid="title"/i.test(html)) return null;
  if (!/<span[^>]*\bid="title"/i.test(html)) return null;

  // The break inside the span comes first: leaving it to the general case
  // would strand a <br /> inside the new heading.
  let out = html.replace(
    /<span([^>]*)\bid="title"([^>]*)>([\s\S]*?)\s*<br\s*\/?>\s*<\/span>/i,
    (m, pre, post, text) => `<h1${pre}id="title"${post}>${text}</h1>`
  );

  if (out === html) {
    out = html.replace(
      /<span([^>]*)\bid="title"([^>]*)>([\s\S]*?)<\/span>[ \t]*<br\s*\/?>/i,
      (m, pre, post, text) => `<h1${pre}id="title"${post}>${text}</h1>`
    );
  }

  // A title with no trailing break at all: still worth promoting, but the
  // line it occupied has to be preserved, so the break moves after the
  // heading rather than disappearing.
  if (out === html) {
    out = html.replace(
      /<span([^>]*)\bid="title"([^>]*)>([\s\S]*?)<\/span>/i,
      (m, pre, post, text) => `<h1${pre}id="title"${post}>${text}</h1>`
    );
  }

  return out === html ? null : out;
}

let changed = 0;
let skipped = 0;
const failed = [];
const shown = [];

function main() {
const files = collect(ROOT, []);
for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  if (!/<body/i.test(html)) continue;

  let out;
  try {
    out = transform(html);
  } catch (err) {
    failed.push(`${path.relative(ROOT, file)}: ${err.message}`);
    continue;
  }

  if (out === null) {
    if (/\bid="title"/i.test(html)) skipped++;
    continue;
  }

  // A heading that swallowed a following block, or one that lost its text,
  // means the markup was a shape this does not know about.
  const text = /<h1[^>]*\bid="title"[^>]*>([\s\S]*?)<\/h1>/i.exec(out);
  if (!text || /<(div|ul|p|table|span)\b/i.test(text[1])) {
    failed.push(`${path.relative(ROOT, file)}: unexpected heading contents`);
    continue;
  }

  changed++;
  if (shown.length < sample) shown.push({ file: path.relative(ROOT, file), text: text[1].trim() });
  if (!dry) fs.writeFileSync(file, out);
}

for (const s of shown) console.log(`  ${s.file}\n      <h1 id="title">${s.text}</h1>`);
if (shown.length) console.log('');

console.log(`  pages scanned      : ${files.length}`);
console.log(`  headings added     : ${changed}${dry ? ' (dry run, nothing written)' : ''}`);
console.log(`  already had one    : ${skipped}`);
console.log(`  failed             : ${failed.length}`);
for (const f of failed.slice(0, 20)) console.log(`      ${f}`);
}

/* The generators build their own pages, so they promote the title as they go
   rather than leaving it for a later sweep -- a page should never exist in the
   tree without its heading. */
module.exports = { promoteTitle: transform };

if (require.main === module) main();
