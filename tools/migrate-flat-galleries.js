#!/usr/bin/env node
/*
 * migrate-flat-galleries.js
 *
 * Moves the flat /galleries/<name>.htm pages into the YYYY/MM/slug/index.htm
 * layout the rest of the archive already uses, and leaves a permanent
 * redirect behind for every old address.
 *
 * These are the oldest pages on the site, from before the archive was
 * organised by date. Their photographs, though, were re-filed years ago and
 * already sit in galleries/YYYY/MM/slug/ -- so for most of them the move is
 * simply putting the page back with its own pictures. The rest are dated from
 * the structured data on the page, and a short list of the very earliest ones
 * is dated by hand below.
 *
 *   node tools/migrate-flat-galleries.js [--dry]
 *
 * What it does, in order:
 *   1. works out a destination for every flat page and refuses to run if any
 *      one of them is unresolved, collides, or would overwrite something
 *   2. moves each page, re-basing every relative URL on it -- stylesheets,
 *      scripts, photographs, sibling galleries -- and rewriting the addresses
 *      it states for itself
 *   3. walks the whole site and repoints every link that named a flat page
 *   4. writes the redirect map into web.config
 *
 * Safe to re-run: once the flat pages are gone there is nothing left to move.
 */

const fs = require('fs');
const path = require('path');
const posix = path.posix;

const ROOT = path.resolve(__dirname, '..');
const GAL = 'galleries';
const DRY = process.argv.includes('--dry');
const SITE = 'https://www.davidconger.com';

/* Index pages rather than galleries. They stay where they are. */
const KEEP = new Set(['index.htm', 'index_old.htm', 'featured.htm']);

/* The 2008-2009 pages whose photographs were never re-filed because they are
   still hosted on Flickr, so nothing on the page says when the show was. Dates
   come from the by-date listing, except BFD 2008, which is dated from the
   public record of the concert (Marymoor Park, 28 June 2008). */
const DATED_BY_HAND = {
	'bfd2008.htm': '2008/06',
	'panicatthedisco.htm': '2008/10',
	'secondhandserenade.htm': '2008/10',
	'davidarchuleta.htm': '2008/10',
	'jbb2008-falloutboy.htm': '2008/12',
	'jbb2008-boyslikegirls.htm': '2008/12',
	'jbb2008-tai.htm': '2008/12',
	'lilwayne.htm': '2009/01',
	'lilwayneopeningacts.htm': '2009/01',
	'moneta.htm': '2009/03',
	/* Two event landing pages that link to the galleries below them. Dated
	   from those galleries, which all agree. */
	'doormattstweetup.htm': '2009/08',
	'davematthewscaravan.htm': '2011/09',
};

const SKIP_DIRS = new Set(['1cnf', '1pvt', 'node_modules', '.git', 'tools', 'you_old']);

function decode(s) {
	try {
		return decodeURIComponent(s);
	} catch (e) {
		return s;
	}
}

/* ---------------------------------------------------------------- planning */

function targetFromPhotos(html) {
	const re = /(?:^|["'\/])(\d{4})\/(\d{2})\/([^\/"'?]+)\/[^\/"'?]+\.jpe?g/gi;
	const seen = new Map();
	let m;
	while ((m = re.exec(html))) {
		const key = m[1] + '/' + m[2] + '/' + decode(m[3]);
		seen.set(key, (seen.get(key) || 0) + 1);
	}
	if (!seen.size) return null;
	return [...seen.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function targetFromMetadata(html, base) {
	const m = /"datePublished"\s*:\s*"(\d{4})-(\d{2})/.exec(html);
	return m ? m[1] + '/' + m[2] + '/' + base : null;
}

const plan = [];
for (const name of fs.readdirSync(path.join(ROOT, GAL))) {
	if (!/\.html?$/i.test(name)) continue;
	if (KEEP.has(name.toLowerCase())) continue;

	const html = fs.readFileSync(path.join(ROOT, GAL, name), 'utf8');
	const base = name.replace(/\.html?$/i, '');
	const hand = DATED_BY_HAND[name.toLowerCase()];

	const target = targetFromPhotos(html) || (hand ? hand + '/' + base : null) || targetFromMetadata(html, base);
	plan.push({ name: name, from: GAL + '/' + name, target: target });
}

const problems = [];
const wanted = new Map();
for (const p of plan) {
	if (!p.target) {
		problems.push('no destination for ' + p.from);
		continue;
	}
	p.dir = GAL + '/' + p.target;
	p.to = p.dir + '/index.htm';
	if (fs.existsSync(path.join(ROOT, p.to))) problems.push(p.to + ' already exists');
	if (wanted.has(p.to)) problems.push(p.to + ' wanted by both ' + wanted.get(p.to) + ' and ' + p.from);
	wanted.set(p.to, p.from);
}

if (!plan.length) {
	console.log('  nothing to move - the galleries root holds no flat pages');
	process.exit(0);
}
if (problems.length) {
	console.log('  refusing to run:');
	problems.forEach((x) => console.log('    ' + x));
	process.exit(1);
}

/* Keyed lowercase because links to these pages are not consistently cased. */
const MOVES = new Map(plan.map((p) => [p.from.toLowerCase(), p]));

console.log('  flat pages to move : ' + plan.length);

/* ------------------------------------------------------------- rewriting */

/* Split a URL into the part that names a file and everything after it. */
function splitSuffix(raw) {
	const i = raw.search(/[?#]/);
	return i < 0 ? [raw, ''] : [raw.slice(0, i), raw.slice(i)];
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/* Where does `raw`, written on a page in `baseDir`, point? Returns a
   site-relative path, or null if the URL is not ours to touch. */
function siteTarget(raw, baseDir) {
	if (!raw) return null;
	const [p, suffix] = splitSuffix(raw.replace(/&amp;/g, '&').trim());
	if (!p || EXTERNAL.test(p)) return null;
	const abs = p.startsWith('/') ? posix.normalize(decode(p).slice(1)) : posix.normalize(posix.join(baseDir, decode(p)));
	return { abs: abs, suffix: suffix, rooted: p.startsWith('/') };
}

function encodeOut(p) {
	return encodeURI(p).replace(/&/g, '&amp;');
}

/* Rewrite every href and src on a page. `oldDir` is where the page was when
   those URLs were written; `newDir` is where it is going. */
function rebase(html, oldDir, newDir) {
	return html.replace(/(\b(?:href|src)\s*=\s*)(["'])((?:(?!\2)[\s\S])*)\2/gi, (whole, lead, q, raw) => {
		const t = siteTarget(raw, oldDir);
		if (!t) return whole;

		const moved = MOVES.get(t.abs.toLowerCase());
		const abs = moved ? moved.to : t.abs;
		if (!moved && oldDir === newDir) return whole;

		const value = encodeOut(posix.relative(newDir, abs) || 'index.htm') + t.suffix;
		const quote = value.includes(q) ? (q === '"' ? "'" : '"') : q;
		return lead + quote + value + quote;
	});
}

/* Links written as full addresses rather than relative paths. Rare, but they
   exist, and a page's own canonical, og:url and structured-data url are always
   written this way. */
const ABSOLUTE = new RegExp('https?://(?:www\\.)?davidconger\\.com/(galleries/[^"\'\\s<>)]+\\.html?)', 'gi');

function restate(html) {
	return html.replace(ABSOLUTE, (whole, tail) => {
		const page = MOVES.get(decode(tail).toLowerCase());
		return page ? SITE + '/' + page.dir + '/' : whole;
	});
}

/* ------------------------------------------------------------------- run */

const files = [];
(function walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.isDirectory()) {
			if (SKIP_DIRS.has(e.name)) continue;
			walk(path.join(dir, e.name));
			continue;
		}
		if (/\.html?$/i.test(e.name)) files.push(path.join(dir, e.name));
	}
})(ROOT);

let moved = 0;
let repointed = 0;

for (const abs of files) {
	const rel = path.relative(ROOT, abs).split(path.sep).join('/');
	const page = MOVES.get(rel.toLowerCase());
	const oldDir = posix.dirname(rel);
	const newDir = page ? page.dir : oldDir;

	const before = fs.readFileSync(abs, 'utf8');
	let after = restate(rebase(before, oldDir, newDir));

	if (after === before && !page) continue;

	if (page) {
		moved += 1;
		if (!DRY) {
			fs.mkdirSync(path.join(ROOT, page.dir), { recursive: true });
			fs.writeFileSync(path.join(ROOT, page.to), after, 'utf8');
			fs.unlinkSync(abs);
		}
	} else {
		repointed += 1;
		if (!DRY) fs.writeFileSync(abs, after, 'utf8');
	}
}

console.log('  pages moved        : ' + moved);
console.log('  pages repointed    : ' + repointed);

/* --------------------------------------------------------- redirect map */

const entries = plan
	.slice()
	.sort((a, b) => a.name.localeCompare(b.name))
	.map((p) => '        <add key="/' + encodeURI(p.from).toLowerCase() + '" value="/' + encodeURI(p.dir) + '/" />')
	.join('\n');

const block =
	'\n    <!--\n' +
	'      The oldest galleries lived directly in /galleries/ as one page each,\n' +
	'      named after the act. They now sit with their photographs under\n' +
	'      /galleries/YYYY/MM/<name>/, like every other gallery on the site.\n' +
	'      Sixteen years of links point at the old addresses, so each one is\n' +
	'      answered with a permanent redirect. The lookup is a hash on the\n' +
	'      requested path, so the length of this list costs nothing per request.\n\n' +
	'      Generated by tools/migrate-flat-galleries.js. Do not edit by hand.\n' +
	'    -->\n' +
	'    <rewrite>\n' +
	'      <rewriteMaps>\n' +
	'        <rewriteMap name="FlatGalleries" defaultValue="">\n' +
	entries +
	'\n        </rewriteMap>\n' +
	'      </rewriteMaps>\n' +
	'      <rules>\n' +
	'        <rule name="Flat galleries moved under their year" stopProcessing="true">\n' +
	'          <match url=".*" />\n' +
	'          <conditions>\n' +
	'            <add input="{FlatGalleries:{ToLower:{URL}}}" pattern="(.+)" />\n' +
	'          </conditions>\n' +
	'          <action type="Redirect" url="{C:1}" redirectType="Permanent" />\n' +
	'        </rule>\n' +
	'      </rules>\n' +
	'    </rewrite>\n';

const cfgPath = path.join(ROOT, 'web.config');
let cfg = fs.readFileSync(cfgPath, 'utf8');
cfg = cfg.replace(/\n[ \t]*<!--[^!]*?Generated by tools\/migrate-flat-galleries\.js[\s\S]*?<\/rewrite>\n/, '\n');
cfg = cfg.replace(/(\n\s*)<\/system\.webServer>/, block + '$1</system.webServer>');

if (!DRY) fs.writeFileSync(cfgPath, cfg, 'utf8');
console.log('  redirects written  : ' + plan.length);
if (DRY) console.log('  dry run - nothing written');
