#!/usr/bin/env node
/**
 * add-page-headings.js -- the last pages with no <h1>.
 *
 * tools/add-headings.js promoted `<span id="title">` on the eleven thousand
 * gallery and meet-and-greet pages, and tools/fix-gallery-h1.js caught the
 * twenty-nine that carried the artist's name as a bare text node. What is left
 * is the hand-authored part of the site -- the catalog, the festival pages, the
 * "other photos" section, the radio pages, the list pages at the root -- where
 * the heading has always been a styled <span> or a bold <p> and never a
 * heading. Seventy pages, ten shapes, barely any of them the same twice.
 *
 * The rule throughout is that nothing may move on screen. Each page already
 * displays its title; the only thing wrong is the tag around it. So the tag
 * changes and the styling comes with it -- written onto the <h1> itself rather
 * than left behind on the element that was carrying it -- and the stylesheet
 * only has to cancel the margin, size and weight a browser gives an <h1> by
 * default.
 *
 * Two things need more than a tag swap:
 *
 *   - A heading may not sit inside a <p>. The parser closes the paragraph when
 *     it meets one and the rest of the block escapes. So where the title is the
 *     first line of a centred paragraph, that paragraph becomes a
 *     <div class="legacyCaption"> carrying the margins it would otherwise lose.
 *
 *   - Three radio pages, the galleries redirect stub and the featured grid have
 *     no title text at all, only a banner image, a sentence or photographs.
 *     Those take a heading that is read but not drawn, because inventing
 *     visible text would be a design change rather than a structural fix.
 *
 * Matching ignores HTML comments. Several festival pages keep a commented-out
 * copy of the catalog navigation above their real heading, and a naive regex
 * happily promotes the copy instead.
 *
 *   node tools/add-page-headings.js --dry     report, write nothing
 *   node tools/add-page-headings.js           write
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');

/* Superseded trees, tooling, and the generator templates -- a template is not a
   page, and giving one a heading would put that heading into every page built
   from it later without anyone having decided so. */
const SKIP = new Set([
  '.git', 'node_modules', 'tools', '_proto', 'you_old',
  '1cnf', '1pvt', 'davidconger_backup', '!template', '0000',
]);

/**
 * Each rule finds the element already acting as the page's heading and returns
 * the replacement for it. Order matters: the narrow shapes come before the
 * broad ones that would otherwise swallow them.
 */
const RULES = [
  {
    // The catalog and the festival pages: the year, or the event. Every one of
    // them carries a #listingTitle section label above this ("Concert & Event
    // Photos") but that names the section, not the page, so it stays a span.
    name: 'catalogTitle',
    re: /<span id="catalogTitle">([\s\S]*?)<\/span>(?:\s*<br ?\/>)?/,
    build: (m) => `<h1 id="catalogTitle">${m[1]}</h1>`,
  },
  {
    // /you/ -- the section bar label, exactly as galleries/index.htm has it.
    name: 'yearLabel',
    re: /<span class="yearLabel is-static">([\s\S]*?)<\/span>/,
    build: (m) => `<h1 class="yearLabel is-static">${m[1]}</h1>`,
  },
  {
    // you/previous.htm names itself above the list of years. The <br /> goes
    // with it -- a heading is a block and brings its own line break.
    name: 'pageHeader',
    re: /<span class="pageHeader">([\s\S]*?)<\/span>\s*<br ?\/>/,
    build: (m) => `<h1 class="pageHeader">${m[1]}</h1>`,
  },
  {
    // The home page. The masthead is chrome everywhere else on the site, but
    // here it is the subject of the page, so here it is the heading.
    name: 'masthead',
    only: 'index.htm',
    re: /<div class="headerTextMain">([\s\S]*?)<\/div>/,
    build: (m) => `<h1 class="headerTextMain">${m[1]}</h1>`,
  },
  {
    // 2009-2012 festival pages: the whole paragraph is the title.
    name: 'boldParagraph',
    re: /<p style="font-size: medium; font-weight: 700; text-align: center; letter-spacing: 4px">\s*([^<>]+?)\s*<\/p>/,
    build: (m) => `<h1 class="legacyHeading" style="font-size: medium; font-weight: 700; text-align: center; letter-spacing: 4px">${m[1]}</h1>`,
  },
  {
    // The root list pages, where the title is a bold span among plain text.
    name: 'rootList',
    re: /<p style="text-align: center; ">(\s*)((?:[^<]*)<span style="font-size: medium; font-weight: 700;letter-spacing: 4px">[\s\S]*?<\/span>[^<]*)<br \/>/,
    build: (m) => `<div class="legacyCaption" style="text-align: center;">${m[1]}<h1 class="legacyTitle">${m[2]}</h1>`,
    closesParagraph: true,
  },
  {
    // Two Deck The Hall Ball pages: a plain centred paragraph, nothing else.
    name: 'plainParagraph',
    re: /<p style="text-align: center; ">\s*([^<>]+?)\s*<\/p>/,
    build: (m) => `<h1 class="legacyHeading" style="text-align: center;">${m[1]}</h1>`,
  },
  {
    // other/ -- the place or subject, then where and when. The span stays
    // inside the heading rather than having its size copied onto it: a line of
    // small text inside a normal paragraph is taller than a line of small text
    // on its own, and the page would close up by three pixels without it.
    name: 'legacyCaption',
    re: /<p style="text-align: center; color: #FFFFFF; font-family: Arial, Helvetica, sans-serif;">(\s*)<span class="style2">([^<]+)<\/span><br \/>/,
    build: (m) => `<div class="legacyCaption" style="text-align: center; color: #FFFFFF; font-family: Arial, Helvetica, sans-serif;">${m[1]}<h1 class="legacyTitle"><span class="style2">${m[2]}</span></h1>`,
    closesParagraph: true,
  },
  {
    // tearsheets, and one zoo page: the same idea with the styling inline.
    name: 'boldSpanCaption',
    re: /<p style="text-align: center([^"]*)">(\s*)<span style="font-weight: 700; letter-spacing: 4pt;">([^<]+)<\/span><br \/>/,
    build: (m) => `<div class="legacyCaption" style="text-align: center${m[1]}">${m[2]}<h1 class="legacyTitle" style="font-weight: 700; letter-spacing: 4pt;">${m[3]}</h1>`,
    closesParagraph: true,
  },
];

/**
 * Pages whose heading exists only as a banner image, a photo grid or a single
 * sentence. The text is written out rather than taken from the <title>, because
 * these four titles are either duplicated between pages or carry the station
 * branding rather than the subject of the page.
 */
const SILENT = new Map([
  ['radio/index.htm', 'Dave on Seattle Radio'],
  ['radio/kiss.htm', '106.1 KISS-FM On-Air and Production Airchecks'],
  ['radio/nk2.htm', 'New KISS 2 Airchecks'],
  ['galleries.htm', 'Galleries'],
  ['galleries/featured.htm', 'Featured Photographs'],
]);

const blankComments = (html) => html.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('!')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (/\.html?$/i.test(entry.name)) files.push(full);
  }
})(ROOT);

const counts = {};
const unmatched = [];
let changed = 0;

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const html = fs.readFileSync(file, 'utf8');
  if (!/<body/i.test(html)) continue;
  if (/<h1[\s>]/i.test(html)) continue;

  let out = null;
  let used = null;

  if (SILENT.has(rel)) {
    out = html.replace(/(<main[^>]*>)/i, `$1\r\n<h1 class="srOnly">${SILENT.get(rel)}</h1>`);
    used = 'srOnly';
  } else {
    // Comments decide only *where* to cut, never what the replacement says.
    const bare = blankComments(html);
    for (const rule of RULES) {
      if (rule.only && rel !== rule.only) continue;
      const at = rule.re.exec(bare);
      if (!at) continue;

      const real = rule.re.exec(html.slice(at.index, at.index + at[0].length));
      if (!real) continue;

      let next = html.slice(0, at.index) + rule.build(real) + html.slice(at.index + at[0].length);

      if (rule.closesParagraph) {
        // The paragraph the heading was lifted out of now has to close as a
        // div. It is the first </p> after the block that was just opened.
        const end = next.indexOf('</p>', at.index);
        if (end < 0) continue;
        next = next.slice(0, end) + '</div>' + next.slice(end + 4);
      }

      out = next;
      used = rule.name;
      break;
    }
  }

  if (!out || !/<h1[\s>]/i.test(out)) { unmatched.push(rel); continue; }

  counts[used] = (counts[used] || 0) + 1;
  changed++;
  const text = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(out)[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  console.log(`  ${used.padEnd(16)} ${rel}\n${' '.repeat(19)}"${text}"`);
  if (!DRY) fs.writeFileSync(file, out);
}

console.log(`\n  pages given an <h1> : ${changed}${DRY ? ' (dry run, nothing written)' : ''}`);
for (const [k, v] of Object.entries(counts)) console.log(`      ${k.padEnd(16)} ${v}`);
console.log(`  still without one   : ${unmatched.length}`);
for (const u of unmatched) console.log(`      ${u}`);
