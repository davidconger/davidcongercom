// Points the /you/ thumbnail grids at their full-size photographs so the
// lightbox can be pure progressive enhancement, and loads js/lightbox.js.
//
// Why the target is read out of each per-photo page rather than derived from
// the thumbnail filename: at least one event (you/2016/kane-brown-at-art-marble-21)
// carries thumbnails misnamed after a different artist, so dropping "_sm" from
// the thumbnail src would point 20 anchors at files that do not exist. The
// per-photo page's own download link is authoritative, and every resolved
// target is checked against the disk before anything is written.
//
//   node tools/add-you-lightbox.js --dry-run
//   node tools/add-you-lightbox.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const YOU = path.join(ROOT, 'you');
const DRY = process.argv.includes('--dry-run');

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const attr = (s, name) => {
	const m = s.match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"', 'i'));
	return m ? m[1] : null;
};

function walk(dir, out) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) {
			if (e.name === '!template' || rel(p) === 'you/2023/Old') continue;
			walk(p, out);
		} else if (e.name.toLowerCase().endsWith('.htm')) {
			out.push(p);
		}
	}
	return out;
}

// The full-size photograph a per-photo page shows, plus its dimensions so the
// lightbox can reserve space before the image loads.
//
// Two era layouts exist and both must be read:
//   newer  <ul id="youimage"><li><a href="X.jpg" download><img src="X.jpg">
//   older  <ul id="images"><li><img src="X.jpg">          - no anchor at all
// The older era therefore has no download affordance today; routing it through
// the lightbox is what gives those galleries one.
const photoCache = new Map();
const shapes = { youimage: 0, images: 0 };
function readPhotoPage(file) {
	if (photoCache.has(file)) return photoCache.get(file);
	let result = null;
	if (fs.existsSync(file)) {
		const html = fs.readFileSync(file, 'utf8');
		const block = html.match(/<ul\b[^>]*id="(youimage|images)"[^>]*>([\s\S]*?)<\/ul>/i);
		if (block) {
			const inner = block[2];
			const a = inner.match(/<a\b([^>]*)>/i);
			const img = inner.match(/<img\b([^>]*?)\/?>/i);
			// Prefer the page's own download link; fall back to what it displays.
			const href = (a && attr(a[1], 'href')) || (img && attr(img[1], 'src'));
			if (href && /\.jpe?g$/i.test(href)) {
				shapes[block[1].toLowerCase() === 'youimage' ? 'youimage' : 'images']++;
				result = {
					href,
					width: img ? attr(img[1], 'width') : null,
					height: img ? attr(img[1], 'height') : null,
				};
			}
		}
	}
	photoCache.set(file, result);
	return result;
}

const report = { scanned: 0, changed: 0, already: 0, anchors: 0, skipped: [], missing: [], unresolved: [] };

for (const file of walk(YOU, [])) {
	const html = fs.readFileSync(file, 'utf8');
	if (!/id="youimages"/i.test(html)) continue;
	report.scanned++;

	const dir = path.dirname(file);
	const gridRe = /<ul\b[^>]*id="youimages"[^>]*>([\s\S]*?)<\/ul>/i;
	const grid = html.match(gridRe);
	if (!grid) { report.skipped.push(rel(file) + ' (no grid block)'); continue; }

	// Every entry must be a li wrapping an anchor wrapping an img. Anything
	// else means the markup is not the shape this transform assumes, so the
	// page is left alone rather than half-converted.
	const liRe = /<li\b([^>]*)>(\s*)<a\b([^>]*)>(\s*)<img\b([^>]*?)(\s*\/?)>(\s*)<\/a>(\s*)<\/li>/gi;
	const entries = grid[1].match(liRe) || [];
	const anchorCount = (grid[1].match(/<a\b[^>]*>\s*<img\b/gi) || []).length;
	if (entries.length !== anchorCount) {
		report.skipped.push(rel(file) + ' (' + entries.length + ' of ' + anchorCount + ' entries matched)');
		continue;
	}
	if (!anchorCount) { report.skipped.push(rel(file) + ' (empty grid)'); continue; }

	let bad = false;
	const slug = path.basename(dir);
	const newGrid = grid[1].replace(liRe, (m, liAttrs, s1, aAttrs, s2, imgAttrs, selfClose, s3, s4) => {
		const href = attr(aAttrs, 'href');
		if (!href) { bad = true; return m; }

		let target;
		let info;
		if (/\.jpe?g$/i.test(href)) {
			// Already pointing at the photograph from an earlier run.
			target = href;
			info = {
				width: attr(aAttrs, 'data-full-width'),
				height: attr(aAttrs, 'data-full-height'),
			};
		} else {
			const photoPage = path.resolve(dir, href);
			const page = readPhotoPage(photoPage);
			if (!page) { report.unresolved.push(rel(file) + ' -> ' + href); bad = true; return m; }

			const abs = path.resolve(path.dirname(photoPage), page.href);
			if (!fs.existsSync(abs)) { report.missing.push(rel(file) + ' -> ' + rel(abs)); bad = true; return m; }
			target = path.relative(dir, abs).replace(/\\/g, '/');
			info = page;
		}

		const base = path.basename(target);
		const num = base.match(/-(\d+)\.jpe?g$/i);
		const ext = (base.match(/(\.jpe?g)$/i) || ['.jpg'])[0].toLowerCase();

		let li = '<li';
		if (num && !/\bid\s*=/i.test(liAttrs)) li += ' id="p-' + num[1] + '"';
		li += liAttrs + '>';

		// Name the saved file after the event rather than after whatever the
		// file happens to be called on disk. Those two drifted apart long ago:
		// 85 of 324 events use a different stem, and one event's thumbnails are
		// named after an entirely different artist. Renaming 2.4 GB of
		// photographs to fix that would mean re-uploading all of them, so the
		// download attribute carries the correct name instead and nothing on
		// disk or on the server has to move.
		const saveAs = num ? slug + '-' + num[1] + ext : base;

		let a = '<a href="' + target + '" download="' + saveAs + '"';
		if (info.width) a += ' data-full-width="' + info.width + '"';
		if (info.height) a += ' data-full-height="' + info.height + '"';
		// Keep any attribute the anchor already carried apart from the ones
		// this tool owns.
		const kept = aAttrs
			.replace(/\s*\bhref\s*=\s*"[^"]*"/i, '')
			.replace(/\s*\bdownload(\s*=\s*"[^"]*")?/i, '')
			.replace(/\s*\bdata-full-(width|height)\s*=\s*"[^"]*"/gi, '')
			.trim();
		if (kept) a += ' ' + kept;
		a += '>';

		report.anchors++;
		return li + s1 + a + s2 + '<img' + imgAttrs + selfClose + '>' + s3 + '</a>' + s4 + '</li>';
	});

	if (bad) { report.skipped.push(rel(file) + ' (unresolved target)'); continue; }

	let out = html;
	const gridChanged = newGrid !== grid[1];
	if (gridChanged) out = out.replace(gridRe, (full, inner) => full.replace(inner, newGrid));

	// Load the lightbox next to stream.js, reusing whatever prefix that tag
	// already uses so this stays correct at any depth.
	let scriptChanged = false;
	if (!/js\/lightbox\.js/i.test(out)) {
		const streamRe = /([\t ]*)<script src="([^"]*js\/)stream\.js"([^>]*)><\/script>/i;
		if (streamRe.test(out)) {
			out = out.replace(streamRe, (m, indent, prefix, tail) =>
				m + '\n' + indent + '<script src="' + prefix + 'lightbox.js" defer></script>');
			scriptChanged = true;
		} else {
			report.skipped.push(rel(file) + ' (no stream.js tag to anchor the script to)');
			continue;
		}
	}

	if (!gridChanged && !scriptChanged) { report.already++; continue; }
	report.changed++;
	if (!DRY) fs.writeFileSync(file, out);
}

console.log((DRY ? 'DRY RUN — ' : '') + 'thumbnail pages scanned: ' + report.scanned);
console.log('  changed:          ' + report.changed);
console.log('  already current:  ' + report.already);
console.log('  anchors repointed:' + report.anchors);
console.log('  per-photo shapes: youimage=' + shapes.youimage + ' images=' + shapes.images);
console.log('  skipped:          ' + report.skipped.length);
for (const s of report.skipped.slice(0, 20)) console.log('    ' + s);
if (report.unresolved.length) {
	console.log('  UNRESOLVED per-photo pages: ' + report.unresolved.length);
	for (const s of report.unresolved.slice(0, 20)) console.log('    ' + s);
}
if (report.missing.length) {
	console.log('  MISSING photographs: ' + report.missing.length);
	for (const s of report.missing.slice(0, 20)) console.log('    ' + s);
}
