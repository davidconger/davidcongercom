/**
 * Brings the individual gallery pages onto the same design as the year pages.
 *
 * There are two generations of them and both are handled the same way, because
 * both keep their content in the same three containers -- #details, #images and
 * the copyright paragraph -- and differ only in the chrome around it:
 *
 *   2016-2020 (258 pages)  div.headerNav + div.headerText, PNG social tiles
 *   2013-2015 (889 pages)  a layout table, a 710px header.png banner, and a
 *                          social row that still links Tumblr, Pinterest and
 *                          a FeedBurner RSS feed
 *
 * So rather than trying to edit either one, everything between <body> and
 * <div id="gallery"> is replaced outright with the shared chrome from
 * tools/lib/chrome.js, and the copyright paragraph at the end with the shared
 * footer. The gallery itself is not touched: the markup inside #images is what
 * every URL on the site points at.
 *
 * The visual changes are made in CSS, scoped to body.galleryPage, because
 * #gallery and #images are also used by ~5,000 pages under /you/ -- which is
 * live, actively published to, and deliberately out of scope.
 *
 * Idempotent: a page that already links css/stream.css is skipped.
 *
 * Usage:
 *   node tools/restyle-galleries.js --dry
 *   node tools/restyle-galleries.js --dry --sample 3
 *   node tools/restyle-galleries.js
 */
const fs = require('fs');
const path = require('path');
const { HOME_ICON, topBar, masthead, footer } = require('./lib/chrome');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const force = argv.includes('--force');
const sample = argv.includes('--sample') ? Number(argv[argv.indexOf('--sample') + 1]) || 0 : 0;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.html?$/i.test(e.name)) out.push(p);
  }
  return out;
}

const FONT = "<link href='https://fonts.googleapis.com/css?family=Hind:400,600' rel='stylesheet' type='text/css' />";

function transform(file, html) {
  // galleries/2019/12/lights/index.htm -> "../../../../" and year "2019".
  const rel = path.relative(ROOT, file).split(path.sep);
  const up = '../'.repeat(rel.length - 1);
  const year = /^\d{4}$/.test(rel[1]) ? rel[1] : null;
  // The year page is the parent of the month folder this page sits in.
  const yearHref = '../../';

  const bodyOpen = html.indexOf('<body');
  const bodyTagEnd = html.indexOf('>', bodyOpen);
  const galleryAt = html.indexOf('<div id="gallery">');
  if (bodyOpen < 0 || galleryAt < 0 || galleryAt < bodyTagEnd) return null;

  let head = html.slice(0, bodyOpen);

  // stream.css sits after site.css so it can layer on top of it.
  if (!/css\/stream\.css/.test(head)) {
    if (!/css\/site\.css/.test(head)) return null;
    head = head.replace(/(<link[^>]*css\/site\.css[^>]*>)/,
      `$1\n<link rel="stylesheet" href="${up}css/stream.css">`);
  }
  // The 2013-2015 pages never linked the display face the rest of the site uses.
  if (!/fonts\.googleapis\.com/.test(head)) {
    head = head.replace(/(<link rel="stylesheet" href="[^"]*css\/site\.css">)/, `${FONT}\n$1`);
  }
  // stream.js is what tells the top bar it has collapsed; without it the bar
  // never picks up its background and the masthead scrolls behind nothing.
  if (!/js\/stream\.js/.test(head)) {
    head = head.replace(/(<script src="[^"]*js\/azureinsights\.js" defer><\/script>)/,
      `<script src="${up}js/stream.js" defer></script>\n$1`);
  }

  /* The way back up. "Concert & Event Photos" is gone from here -- the page it
     pointed at is no longer the way anyone navigates -- and in its place the
     year sits next to Home in a ghosted grey, close to the background until the
     pointer reaches it. It is a breadcrumb, so it reads as one: an icon, then
     where you are. */
  const crumb = year
    ? `\n			<a class="crumbYear" href="${yearHref}" title="All ${year} galleries">${year}</a>`
    : '';
  const left = `			<a class="socialLink socialHome" href="${up}index.htm" aria-label="Home" title="Home">${HOME_ICON}</a>${crumb}`;

  const body = `<body class="galleryPage">\n\n${topBar(up, left)}\n\n${masthead()}\n\n`;

  let rest = html.slice(galleryAt);

  // The copyright paragraph, in the two shapes the generators produced.
  const before = rest;
  rest = rest.replace(/<p>\s*Copyright 2008-\d{4}[\s\S]*?<\/p>/, footer());
  if (rest === before) return null;

  return head + body + rest;
}

const files = walk(path.join(ROOT, 'galleries'))
  .filter((f) => !path.relative(ROOT, f).split(path.sep).includes('0000'))
  .filter((f) => {
    const t = fs.readFileSync(f, 'utf8');
    return t.includes('<div id="gallery">') && t.includes('id="images"');
  });

let changed = 0;
let skipped = 0;
let failed = [];
const shown = [];

for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  if (!force && /css\/stream\.css/.test(html) && /class="galleryPage"/.test(html)) { skipped++; continue; }
  const out = transform(f, html);
  if (out === null) { failed.push(path.relative(ROOT, f)); continue; }
  changed++;
  if (sample && shown.length < sample) shown.push([path.relative(ROOT, f), out]);
  if (!dry) fs.writeFileSync(f, out, 'utf8');
}

console.log(`${files.length} gallery page(s): ${changed} ${dry ? 'would change' : 'changed'}, ${skipped} already current, ${failed.length} failed`);
for (const f of failed.slice(0, 10)) console.log('  FAILED ' + f);

for (const [name, out] of shown) {
  console.log('\n' + '='.repeat(70) + '\n' + name + '\n' + '='.repeat(70));
  const b = out.indexOf('<body');
  console.log(out.slice(Math.max(0, b - 400), b + 260));
  console.log('   ... [chrome] ...');
  const g = out.indexOf('<div id="gallery">');
  console.log(out.slice(g, g + 300));
  console.log('   ...');
  console.log(out.slice(-320));
}
