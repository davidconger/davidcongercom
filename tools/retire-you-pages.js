/**
 * Deletes the /you/ pages the lightbox replaced.
 *
 * Only the HTML goes. The photographs live in the same folders and stay exactly
 * where they are, because the event pages link straight to them and the names
 * are what the server already has.
 *
 * Nothing is deleted that is not first proven redundant: every page must be one
 * of the three retiring shapes, must sit in an event that still has an
 * index.htm, and - for a numbered photo page - the photograph it showed must be
 * on that index. Anything that fails a check is left alone and reported.
 *
 * The copies already on the server are not removed by a deploy, and do not need
 * to be: IIS runs its rewrite rules before it looks for a file, so the redirect
 * wins whether or not the old page is still sitting there.
 *
 *   node tools/retire-you-pages.js --dry-run
 *   node tools/retire-you-pages.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const YOU = path.join(ROOT, 'you');
const DRY = process.argv.includes('--dry-run');

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

let deleted = 0, bytes = 0, events = 0;
const kept = [];

for (const year of fs.readdirSync(YOU, { withFileTypes: true })) {
	if (!year.isDirectory() || year.name === '!template') continue;
	for (const ev of fs.readdirSync(path.join(YOU, year.name), { withFileTypes: true })) {
		if (!ev.isDirectory()) continue;
		const dir = path.join(YOU, year.name, ev.name);
		const index = path.join(dir, 'index.htm');
		if (!fs.existsSync(index)) continue;

		const ids = new Set(
			[...fs.readFileSync(index, 'utf8').matchAll(/<li id="([^"]*)"/g)].map((m) => m[1])
		);
		if (!ids.size) { kept.push(rel(dir) + ': index has no photographs, left untouched'); continue; }
		events++;

		const doomed = [];
		for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
			if (child.isFile() && /^page-\d+\.html?$/i.test(child.name)) {
				doomed.push(path.join(dir, child.name));
				continue;
			}
			if (!child.isDirectory() || !/^(gallery|page-\d+)$/i.test(child.name)) continue;
			for (const f of fs.readdirSync(path.join(dir, child.name))) {
				if (!/\.html?$/i.test(f)) continue;
				const file = path.join(dir, child.name, f);
				const num = f.match(/-(\d+)\.html?$/i);
				if (num && !ids.has('p-' + num[1])) {
					kept.push(rel(file) + ': photograph p-' + num[1] + ' is not on the event page');
					continue;
				}
				doomed.push(file);
			}
		}

		for (const file of doomed) {
			bytes += fs.statSync(file).size;
			deleted++;
			if (!DRY) fs.unlinkSync(file);
		}
	}
}

console.log((DRY ? 'DRY RUN — ' : '') + 'events: ' + events);
console.log('  pages retired: ' + deleted.toLocaleString());
console.log('  freed: ' + (bytes / 1024 / 1024).toFixed(1) + ' MB');
console.log('  left in place: ' + kept.length);
for (const k of kept.slice(0, 20)) console.log('    ' + k);
