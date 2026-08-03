#!/usr/bin/env node
/*
 * plan-flat-galleries.js
 *
 * Reports where each of the flat /galleries/*.htm pages would move to under
 * the YYYY/MM/slug layout the rest of the archive uses, and flags anything
 * that would not move cleanly. Writes nothing. Run this before
 * migrate-flat-galleries.js and read the summary.
 *
 *   node tools/plan-flat-galleries.js [--json out.json]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GAL = path.join(ROOT, 'galleries');

/* Index pages, not galleries. These stay where they are. */
const KEEP = new Set(['index.htm', 'index_old.htm', 'featured.htm']);

function decode(s) {
	try {
		return decodeURIComponent(s);
	} catch (e) {
		return s;
	}
}

/* The photographs on a flat page are nearly always already stored under
   galleries/YYYY/MM/slug/, which names the destination directly. */
function fromImagePath(html) {
	const re = /(?:^|["'\/])(\d{4})\/(\d{2})\/([^\/"'?]+)\/[^\/"'?]+\.jpe?g/gi;
	const seen = new Map();
	let m;
	while ((m = re.exec(html))) {
		const key = m[1] + '/' + m[2] + '/' + decode(m[3]);
		seen.set(key, (seen.get(key) || 0) + 1);
	}
	if (!seen.size) return null;
	// The page's own photographs are the most-repeated path; a stray catalog
	// thumbnail or "see also" link appears once.
	return [...seen.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/* Otherwise the structured data on the page carries the date, and the file
   name is the slug the rest of the site already links by. */
function fromMetadata(html, file) {
	const m = /"datePublished"\s*:\s*"(\d{4})-(\d{2})/.exec(html);
	if (!m) return null;
	return m[1] + '/' + m[2] + '/' + path.basename(file, path.extname(file));
}

const rows = [];
for (const name of fs.readdirSync(GAL)) {
	if (!/\.html?$/i.test(name)) continue;
	if (KEEP.has(name.toLowerCase())) continue;

	const html = fs.readFileSync(path.join(GAL, name), 'utf8');
	const byImage = fromImagePath(html);
	const target = byImage || fromMetadata(html, name);
	const photos = (html.match(/class="galleryphoto"/g) || []).length;

	rows.push({
		file: name,
		target: target,
		source: byImage ? 'photos' : target ? 'metadata' : null,
		photos: photos,
		dirExists: target ? fs.existsSync(path.join(GAL, target)) : false,
		indexExists: target ? fs.existsSync(path.join(GAL, target, 'index.htm')) : false,
	});
}

/* Who links to these pages, so the migration knows what it has to update. */
const SKIP = new Set(['1cnf', '1pvt', 'node_modules', '.git', 'tools', 'you_old']);
const inbound = new Map();
(function walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.isDirectory()) {
			if (SKIP.has(e.name)) continue;
			walk(path.join(dir, e.name));
			continue;
		}
		if (!/\.html?$/i.test(e.name)) continue;
		const abs = path.join(dir, e.name);
		const html = fs.readFileSync(abs, 'utf8');
		const re = /(?:^|["'\/])galleries\/([a-z0-9 _.'!&-]+\.html?)/gi;
		let m;
		while ((m = re.exec(html))) {
			const t = decode(m[1]).toLowerCase();
			if (!inbound.has(t)) inbound.set(t, new Set());
			inbound.get(t).add(path.relative(ROOT, abs).replace(/\\/g, '/'));
		}
	}
})(ROOT);

for (const r of rows) r.inboundPages = (inbound.get(r.file.toLowerCase()) || new Set()).size;

/* Collisions: two flat pages that want the same destination. */
const byTarget = new Map();
for (const r of rows) {
	if (!r.target) continue;
	if (!byTarget.has(r.target)) byTarget.set(r.target, []);
	byTarget.get(r.target).push(r.file);
}
const collisions = [...byTarget.entries()].filter(([, f]) => f.length > 1);

const noTarget = rows.filter((r) => !r.target);
const noPhotos = rows.filter((r) => r.photos === 0);
const clean = rows.filter((r) => r.target && r.dirExists && !r.indexExists);
const occupied = rows.filter((r) => r.indexExists);
const missingDir = rows.filter((r) => r.target && !r.dirExists);

console.log('  flat pages          : ' + rows.length);
console.log('  target from photos  : ' + rows.filter((r) => r.source === 'photos').length);
console.log('  target from metadata: ' + rows.filter((r) => r.source === 'metadata').length);
console.log('  no target           : ' + noTarget.length);
console.log('');
console.log('  directory exists, free : ' + clean.length);
console.log('  directory missing      : ' + missingDir.length);
console.log('  index.htm already there: ' + occupied.length);
console.log('  collisions             : ' + collisions.length);
console.log('  pages with no photos   : ' + noPhotos.length);
console.log('  total inbound links    : ' + rows.reduce((a, r) => a + r.inboundPages, 0));

const show = (label, list, fmt) => {
	if (!list.length) return;
	console.log('\n  ' + label);
	list.slice(0, 40).forEach((x) => console.log('    ' + fmt(x)));
	if (list.length > 40) console.log('    ... and ' + (list.length - 40) + ' more');
};

show('no target:', noTarget, (r) => r.file + '  (photos: ' + r.photos + ', inbound: ' + r.inboundPages + ')');
show('directory missing:', missingDir, (r) => r.file + '  -> ' + r.target);
show('index.htm already there:', occupied, (r) => r.file + '  -> ' + r.target);
show('collisions:', collisions, ([t, f]) => t + '  <- ' + f.join(', '));
show('no photos:', noPhotos, (r) => r.file + '  -> ' + (r.target || '?') + '  (inbound: ' + r.inboundPages + ')');

const jsonIdx = process.argv.indexOf('--json');
if (jsonIdx > -1 && process.argv[jsonIdx + 1]) {
	fs.writeFileSync(process.argv[jsonIdx + 1], JSON.stringify({ rows, collisions }, null, 1), 'utf8');
	console.log('\n  wrote ' + process.argv[jsonIdx + 1]);
}
