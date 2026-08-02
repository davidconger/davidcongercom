/**
 * Brings the meet and greet pages under /you/ onto the shared chrome.
 *
 * This is the largest family on the site -- around 9,000 pages -- and it was
 * deliberately left alone until now because it is the part people are sent to
 * after an event and the part most likely to be linked from somewhere I cannot
 * see. It is also the least uniform: four generations of chrome, laid down
 * between 2009 and 2024.
 *
 *   div.headerNav + #gallery + #images                 the single photo pages
 *   div.headerNav + #gallery                            the event index pages
 *   div.headerNav + #gallery + p.siteFooter             the 2009-2012 pages
 *   table.dcNavHeaderText + banner + #gallery + #images the FrontPage era
 *
 * As with the concert galleries, all four keep their content in the same place
 * -- everything from <div id="gallery"> onwards -- so the transform replaces
 * the chrome around it outright rather than trying to edit four things.
 *
 * What is inside #gallery is not touched. Those pages carry the only copy of
 * somebody's photograph, the navigation between pages of an event, and the
 * "Back to Gallery" links, and none of that is mine to rewrite.
 *
 * The body class is `youPage`, not `galleryPage`, because the two want opposite
 * treatments: these photographs are unwatermarked, so they get no caption
 * overlay, and the thumbnails lose their border for a shadow.
 *
 * Idempotent. Usage:
 *   node tools/restyle-you.js --dry [--sample 2]
 *   node tools/restyle-you.js
 */
const fs = require('fs');
const path = require('path');
const { HOME_ICON, topBar, masthead, footer } = require('./lib/chrome');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const force = argv.includes('--force');
const sample = argv.includes('--sample') ? Number(argv[argv.indexOf('--sample') + 1]) || 0 : 0;

const FONT = "<link href='https://fonts.googleapis.com/css?family=Hind:400,600' rel='stylesheet' type='text/css' />";

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '!template') continue;
      walk(p, out);
    } else if (/\.html?$/i.test(e.name)) out.push(p);
  }
  return out;
}

function transform(file, html) {
  const rel = path.relative(ROOT, file).split(path.sep);
  const up = '../'.repeat(rel.length - 1);

  const bodyOpen = html.indexOf('<body');
  const bodyTagEnd = html.indexOf('>', bodyOpen);
  const galleryAt = html.indexOf('<div id="gallery">');
  if (bodyOpen < 0 || galleryAt < 0 || galleryAt < bodyTagEnd) return null;

  let head = html.slice(0, bodyOpen);
  if (!/css\/site\.css/.test(head)) return null;
  if (!/css\/stream\.css/.test(head)) {
    head = head.replace(/(<link[^>]*css\/site\.css[^>]*>)/,
      `$1\n<link rel="stylesheet" href="${up}css/stream.css">`);
  }
  // The older pages never linked the display face the rest of the site uses.
  if (!/fonts\.googleapis\.com/.test(head)) {
    head = head.replace(/(<link[^>]*css\/site\.css[^>]*>)/, `${FONT}\n$1`);
  }
  /* stream.js is what tells the top bar it has collapsed. Not every generation
     of these pages loads analytics, so it goes in ahead of that when it is
     there and at the end of the head when it is not. */
  if (!/js\/stream\.js/.test(head)) {
    const script = `<script src="${up}js/stream.js" defer></script>`;
    head = /azureinsights\.js/.test(head)
      ? head.replace(/(<script src="[^"]*js\/azureinsights\.js" defer><\/script>)/, `${script}\n$1`)
      : head.replace(/<\/head>/, `${script}\n</head>`);
  }

  /* One crumb, back to the meet and greet index. There is no year crumb here:
     /you/ is organised by event, not by year, and the year folders are not
     pages anyone can land on. */
  const crumb = `\n			<a class="crumbYear" href="${up}you/index.htm" title="All meet &amp; greet galleries">Meet &amp; Greet</a>`;
  const left = `			<a class="socialLink socialHome" href="${up}index.htm" aria-label="Home" title="Home">${HOME_ICON}</a>${crumb}`;

  const body = `<body class="youPage">\n\n${topBar(up, left)}\n\n${masthead()}\n\n`;

  let rest = html.slice(galleryAt);
  const before = rest;
  rest = rest.replace(/<p(?: class="siteFooter")?>\s*Copyright 2008-\d{4}[\s\S]*?<\/p>/, footer());
  if (rest === before) return null;

  return head + body + rest;
}

const files = walk(path.join(ROOT, 'you'))
  .filter((f) => fs.readFileSync(f, 'utf8').includes('<div id="gallery">'));

let changed = 0;
let skipped = 0;
const failed = [];
const shown = [];

for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  if (!force && /css\/stream\.css/.test(html) && /class="youPage"/.test(html)) { skipped++; continue; }
  const out = transform(f, html);
  if (out === null) { failed.push(path.relative(ROOT, f)); continue; }
  changed++;
  if (sample && shown.length < sample) shown.push([path.relative(ROOT, f), out]);
  if (!dry) fs.writeFileSync(f, out, 'utf8');
}

console.log(`${files.length} you page(s): ${changed} ${dry ? 'would change' : 'changed'}, ${skipped} already current, ${failed.length} failed`);
for (const f of failed.slice(0, 15)) console.log('  FAILED ' + f);

for (const [name, out] of shown) {
  console.log('\n' + '='.repeat(70) + '\n' + name + '\n' + '='.repeat(70));
  const b = out.indexOf('<body');
  console.log(out.slice(Math.max(0, b - 300), b + 200) + '\n   ... [chrome] ...');
  const g = out.indexOf('<div id="gallery">');
  console.log(out.slice(g, g + 700) + '\n   ...\n' + out.slice(-320));
}
