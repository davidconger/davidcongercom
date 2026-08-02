#!/usr/bin/env node
'use strict';

/*
 * Repairs listing-page links under /you/ that point at a photo page which does
 * not exist.
 *
 * A couple of 2016 events were published with the previous event's slug baked
 * into the listing pages: you/2016/kane-brown-at-art-marble-21/index.htm links
 * to page-1/kenny-loggins-2014-at-snoqualmie-casino-01.htm while the file on
 * disk is page-1/kane-brown-at-art-marble-01.htm. The thumbnails are fine, so
 * the page looks correct until you click a photo.
 *
 * Every photo page is named <slug>-NN.htm and every event numbers its photos
 * once across all of its pages, so the number is enough to identify the target
 * unambiguously. This rewrites the href to whatever file actually carries that
 * number in the directory the link already points at.
 *
 * Only href="...htm" is touched. The thumbnails are left alone, because their
 * filenames are genuinely what is on disk even when they disagree with the
 * photo pages.
 *
 *   node tools/fix-you-links.js --dry     report without writing
 *   node tools/fix-you-links.js           apply
 */

const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(__dirname, '..');
const YOU = path.join(ROOT, 'you');

/* Superseded duplicate tree, unreachable and not deployed. */
const SKIP = /[\\/]2023[\\/]Old[\\/]/i;

/* The generator's own template, whose {PLACEHOLDER} links never resolve. */
const TEMPLATE = /[\\/]!template[\\/]/i;

function listingPages(dir, out) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) {
			listingPages(p, out);
		} else if (/^(index|page-\d+)\.htm$/i.test(e.name) && !SKIP.test(p) && !TEMPLATE.test(p)) {
			out.push(p);
		}
	}
	return out;
}

/* number -> filename, for the photo pages sitting in one page-N directory */
const dirIndexCache = new Map();

function photoPagesByNumber(dir) {
	if (dirIndexCache.has(dir)) return dirIndexCache.get(dir);
	const map = new Map();
	if (fs.existsSync(dir)) {
		for (const f of fs.readdirSync(dir)) {
			const m = /-(\d+)\.htm$/i.exec(f);
			if (m) {
				const n = String(parseInt(m[1], 10));
				/* Ambiguous numbering means we cannot be sure; drop the entry. */
				map.set(n, map.has(n) ? null : f);
			}
		}
	}
	dirIndexCache.set(dir, map);
	return map;
}

let filesChanged = 0;
let linksFixed = 0;
let unresolved = 0;
const changedFiles = [];

for (const page of listingPages(YOU, [])) {
	const original = fs.readFileSync(page, 'utf8');
	const baseDir = path.dirname(page);
	let fixedHere = 0;

	const updated = original.replace(
		/(href=")([^"]*?)(page-\d+)\/([^"/]+?)-(\d+)\.htm(")/gi,
		(whole, pre, prefix, pageDir, slug, num, post) => {
			const targetDir = path.join(baseDir, prefix, pageDir);
			const current = `${slug}-${num}.htm`;
			if (fs.existsSync(path.join(targetDir, current))) return whole;

			const actual = photoPagesByNumber(targetDir).get(String(parseInt(num, 10)));
			if (!actual) {
				unresolved++;
				return whole;
			}
			fixedHere++;
			return `${pre}${prefix}${pageDir}/${actual}${post}`;
		}
	);

	if (fixedHere) {
		linksFixed += fixedHere;
		filesChanged++;
		changedFiles.push(path.relative(ROOT, page).replace(/\\/g, '/') + '  (' + fixedHere + ')');
		if (!DRY) fs.writeFileSync(page, updated);
	}
}

console.log((DRY ? 'Would fix ' : 'Fixed ') + linksFixed + ' link(s) in ' + filesChanged + ' file(s).');
if (unresolved) console.log(unresolved + ' broken link(s) had no file with a matching number and were left alone.');
changedFiles.forEach((f) => console.log('  ' + f));
