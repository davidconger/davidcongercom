/**
 * Brings the remaining section pages onto the shared chrome.
 *
 * Everything outside /galleries/ and /you/ that still carried one of the older
 * headers: the root listing pages, the year catalogs, the festival and radio
 * pages, the one-off shoots under other/, and the tearsheets. Between them they
 * use five different headers, laid down at different times:
 *
 *   <header> + div.headerNav + div.headerText   the last generation before this one
 *   div.headerNav + div.headerText              the same, without the landmark
 *   table.dcNavHeaderText + banner image        the FrontPage era
 *   banner image alone                          the earliest pages
 *   nothing at all                              a few pages that never had one
 *
 * Rather than try to recognise each one, the transform finds every header
 * marker that appears in the opening stretch of the body and cuts to the end of
 * the last one. What follows is the page's actual content and is left alone --
 * this is a chrome swap, not a redesign, so a catalog grid or a prose page
 * keeps whatever markup it already had.
 *
 * Idempotent. Usage:
 *   node tools/restyle-pages.js --dry [--sample 2]
 *   node tools/restyle-pages.js
 */
const fs = require('fs');
const path = require('path');
const { topBar, homeLink, masthead, footer } = require('./lib/chrome');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const sample = argv.includes('--sample') ? Number(argv[argv.indexOf('--sample') + 1]) || 0 : 0;

const FONT = "<link href='https://fonts.googleapis.com/css?family=Hind:400,600' rel='stylesheet' type='text/css' />";

const SECTIONS = ['catalog', 'festivals', 'other', 'radio', 'tearsheets'];

/* The two /you/ landing pages have the same old header as the sections and no
   #gallery, so restyle-you.js cannot see them. */
const EXTRA = ['you/index.htm', 'you/previous.htm'];

/* index.htm is the home page and already current. The Pinterest file exists
   only to carry a verification tag and is not a page anyone navigates to. */
const ROOT_SKIP = new Set(['index.htm', 'pinterest-7d38d.html']);

/**
 * Walks forward from an opening tag to just past its matching close, counting
 * nested opens on the way. The old headers nest divs two deep and the FrontPage
 * nav tables sometimes hold another table, so a lazy match is not enough.
 */
function endOfElement(html, openIdx, tag) {
  const re = new RegExp(`<(/?)${tag}\\b`, 'gi');
  re.lastIndex = openIdx;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) {
      const close = html.indexOf('>', re.lastIndex);
      return close < 0 ? -1 : close + 1;
    }
  }
  return -1;
}

/** The end of the last header marker in the opening stretch of the body. */
function endOfChrome(html, bodyStart) {
  const window = html.slice(bodyStart, bodyStart + 12000);
  let end = 0;

  const header = window.indexOf('<header');
  if (header >= 0) {
    const e = endOfElement(window, header, 'header');
    if (e > end) end = e;
  }

  for (const cls of ['headerNav', 'headerText']) {
    const i = window.search(new RegExp(`<div class="${cls}"`));
    if (i >= 0) {
      const e = endOfElement(window, i, 'div');
      if (e > end) end = e;
    }
  }

  // The FrontPage nav table is recognised by a class on one of its cells, so
  // the search has to walk back to the <table> that owns it.
  const cell = window.indexOf('dcNavHeaderText');
  if (cell >= 0) {
    const open = window.lastIndexOf('<table', cell);
    if (open >= 0) {
      const e = endOfElement(window, open, 'table');
      if (e > end) end = e;
    }
  }

  const banner = window.search(/<p><a href="[^"]*">\s*<img src="[^"]*images\/header\.png"[^>]*><\/a><\/p>/);
  if (banner >= 0) {
    const e = window.indexOf('</p>', banner) + 4;
    if (e > end) end = e;
  }

  return end ? bodyStart + end : bodyStart;
}

function transform(file, html) {
  if (/streamTopBar/.test(html)) return 'skip';
  const bodyOpen = html.indexOf('<body');
  if (bodyOpen < 0) return null;                       // catalog list fragments

  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const up = '../'.repeat(rel.split('/').length - 1);

  let head = html.slice(0, bodyOpen);
  if (!/css\/site\.css/.test(head)) return null;
  if (!/fonts\.googleapis\.com/.test(head)) {
    head = head.replace(/(<link[^>]*css\/site\.css[^>]*>)/, `${FONT}\n$1`);
  }
  head = head.replace(/(<link[^>]*css\/site\.css[^>]*>)/,
    `$1\n<link rel="stylesheet" href="${up}css/stream.css">`);
  if (!/js\/stream\.js/.test(head)) {
    head = head.replace(/<\/head>/, `<script src="${up}js/stream.js" defer></script>\n</head>`);
  }

  const bodyTagEnd = html.indexOf('>', bodyOpen) + 1;
  let content = html.slice(endOfChrome(html, bodyTagEnd));
  // Whatever spacing held the old banner off the top of the page.
  content = content.replace(/^(?:\s*<p>(?:&nbsp;|\s)*<\/p>)+/, '');

  const bodyTag = html.slice(bodyOpen, bodyTagEnd)
    .replace(/<body[^>]*>/, '<body class="pageStream">');

  // The old footer comes out here and the shared one goes back after the
  // content, so it ends up outside <main> the way it does everywhere else.
  content = content.replace(
    /\s*(?:<footer>[\s\S]*?<\/footer>|<p class="siteFooter">[\s\S]*?<\/p>)\s*/, '\n');

  const bodyEnd = content.search(/<\/body>/i);
  const tail = bodyEnd >= 0 ? content.slice(bodyEnd) : '</body>\n\n</html>\n';
  content = (bodyEnd >= 0 ? content.slice(0, bodyEnd) : content).trim();

  /* Two of these pages already have a <main>; the rest have loose content.
     Reusing the existing landmark keeps the document from nesting two. */
  const main = /<main\b/i.test(content)
    ? content.replace(/<main\b([^>]*)>/i, (m, attrs) => (/class="/.test(attrs)
      ? `<main${attrs.replace(/class="/, 'class="stream pageStream ')}>`
      : `<main${attrs} class="stream pageStream">`))
    : `<main class="stream pageStream">\n${content}\n</main>`;

  return head
    + bodyTag + '\n\n'
    + topBar(up, homeLink(up)) + '\n\n'
    + masthead() + '\n\n'
    + main + '\n\n'
    + footer() + '\n\n'
    + tail;
}

function collect() {
  const out = fs.readdirSync(ROOT)
    .filter((f) => /\.html?$/i.test(f) && !ROOT_SKIP.has(f.toLowerCase()))
    .map((f) => path.join(ROOT, f));
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.html?$/i.test(ent.name)) out.push(p);
    }
  };
  for (const s of SECTIONS) walk(path.join(ROOT, s));
  for (const f of EXTRA) out.push(path.join(ROOT, f.replace(/\//g, path.sep)));
  return out;
}

const files = collect();
let changed = 0;
let skipped = 0;
const failed = [];
const shown = [];

for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const out = transform(f, html);
  if (out === 'skip') { skipped++; continue; }
  if (out === null) { failed.push(path.relative(ROOT, f)); continue; }
  changed++;
  if (sample && shown.length < sample) shown.push([path.relative(ROOT, f), out]);
  if (!dry) fs.writeFileSync(f, out, 'utf8');
}

console.log(`${files.length} page(s): ${changed} ${dry ? 'would change' : 'changed'}, ${skipped} already current, ${failed.length} not a page`);
for (const f of failed) console.log('  SKIPPED (no body/site.css) ' + f);

for (const [name, out] of shown) {
  console.log('\n' + '='.repeat(70) + '\n' + name + '\n' + '='.repeat(70));
  const b = out.indexOf('<body');
  console.log(out.slice(b, b + 160) + '\n   ... [chrome] ...');
  const m = out.search(/<main\b/);
  console.log(out.slice(m, m + 700));
  console.log('   ...\n' + out.slice(-360));
}
