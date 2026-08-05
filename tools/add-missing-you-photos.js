/**
 * Puts the last few /you/ photographs back on their event pages.
 *
 * Fifteen photographs across four events exist on disk, complete with
 * thumbnails, but were never listed on the event's grid - the retired generator
 * stopped short. Until now they were still reachable, because each one had a
 * page of its own that the sitemap and search engines knew about. Retiring
 * those pages would have quietly orphaned them, so they get added to the grid
 * first.
 *
 * Dimensions are read out of the JPEGs themselves rather than copied from a
 * neighbouring entry, so the width and height attributes are true and the
 * browser reserves the right amount of space.
 *
 *   node tools/add-missing-you-photos.js --dry-run
 *   node tools/add-missing-you-photos.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const YOU = path.join(ROOT, 'you');
const DRY = process.argv.includes('--dry-run');

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

// Width and height from the JPEG's start-of-frame marker. Enough of a reader
// for files this generator produced, and it needs no dependencies.
function jpegSize(file) {
	const buf = fs.readFileSync(file);
	if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
	let i = 2;
	while (i + 9 < buf.length) {
		if (buf[i] !== 0xff) { i++; continue; }
		const marker = buf[i + 1];
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
		const len = buf.readUInt16BE(i + 2);
		const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
		i += 2 + len;
	}
	return null;
}

const LI = /<li id="p-(\d+)"[\s\S]*?<\/li>/g;

let events = 0, added = 0;
const notes = [];

for (const year of fs.readdirSync(YOU, { withFileTypes: true })) {
	if (!year.isDirectory() || year.name === '!template') continue;
	for (const ev of fs.readdirSync(path.join(YOU, year.name), { withFileTypes: true })) {
		if (!ev.isDirectory()) continue;
		const dir = path.join(YOU, year.name, ev.name);
		const indexFile = path.join(dir, 'index.htm');
		if (!fs.existsSync(indexFile)) continue;

		const html = fs.readFileSync(indexFile, 'utf8');
		const items = html.match(LI);
		if (!items || !items.length) continue;
		const shown = new Set(items.map((li) => li.match(/id="p-(\d+)"/)[1]));

		// Every full-size photograph in the event's folders, by number.
		const disk = new Map();
		for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
			if (!sub.isDirectory() || !/^(gallery|page-\d+)$/i.test(sub.name)) continue;
			for (const f of fs.readdirSync(path.join(dir, sub.name))) {
				if (!/\.jpe?g$/i.test(f) || /_sm\.jpe?g$/i.test(f)) continue;
				const m = f.match(/-(\d+)\.jpe?g$/i);
				if (m) disk.set(m[1], { sub: sub.name, file: f });
			}
		}

		const missing = [...disk.keys()].filter((n) => !shown.has(n)).sort();
		if (!missing.length) continue;
		events++;

		// The alt text follows one house style; borrow the description from a
		// photograph that is already listed rather than inventing one.
		const sample = items[items.length - 1];
		const sampleAlt = (sample.match(/alt="([^"]*)"/) || [])[1] || '';
		const altPrefix = sampleAlt.replace(/,?\s*photo\s+\d+\s*$/i, '');

		const built = [];
		for (const num of missing) {
			const { sub, file } = disk.get(num);
			const thumb = file.replace(/(\.jpe?g)$/i, '_sm$1');
			const thumbPath = path.join(dir, sub, thumb);
			if (!fs.existsSync(thumbPath)) { notes.push(rel(dir) + ' p-' + num + ': no thumbnail, left alone'); continue; }

			const full = jpegSize(path.join(dir, sub, file));
			const small = jpegSize(thumbPath);
			if (!full || !small) { notes.push(rel(dir) + ' p-' + num + ': unreadable JPEG, left alone'); continue; }

			const alt = altPrefix + ', photo ' + parseInt(num, 10);
			built.push('<li id="p-' + num + '">'
				+ '<a href="' + sub + '/' + file + '"'
				+ ' download="' + ev.name + '-' + num + '.jpg"'
				+ ' data-full-width="' + full.width + '" data-full-height="' + full.height + '">'
				+ '<img src="' + sub + '/' + thumb + '"'
				+ ' height="' + small.height + '" width="' + small.width + '"'
				+ ' alt="' + alt.replace(/"/g, '&quot;') + '"'
				+ ' loading="lazy" decoding="async"></a></li>');
		}
		if (!built.length) continue;

		const all = items.concat(built)
			.sort((a, b) => parseInt(a.match(/id="p-(\d+)"/)[1], 10) - parseInt(b.match(/id="p-(\d+)"/)[1], 10));

		let seen = 0;
		const next = html.replace(LI, () => all[seen++])
			.replace(/(<li id="p-\d+"[\s\S]*?<\/li>)(\s*<\/ul>)/, (m0, last, tail) =>
				last + all.slice(seen).map((li) => '\n\t\t' + li).join('') + tail);

		added += built.length;
		console.log(rel(indexFile) + ': +' + built.length + ' (' + built.map((b) => b.match(/id="(p-\d+)"/)[1]).join(', ') + ')');
		if (!DRY) fs.writeFileSync(indexFile, next);
	}
}

console.log('');
console.log((DRY ? 'DRY RUN — ' : '') + 'events updated: ' + events + ', photographs added: ' + added);
for (const n of notes) console.log('  ' + n);
