#!/usr/bin/env node
/*
 * fluid-legacy-tables.js
 *
 * Thirteen pages still lay themselves out with a FrontPage-era table whose
 * columns carry hard-coded pixel widths. Those pages are the only ones left on
 * the site that scroll sideways on a phone.
 *
 * The global `table { max-width: 100% }` in site.css cannot save them: CSS
 * 2.1 s17.5.2.1 says that when the sum of the specified column widths exceeds
 * the table's width, the table's used width becomes that sum. A 700px table
 * holding a 450px and a 250px cell therefore computes to 715px no matter what
 * max-width says.
 *
 * So the widths have to come off the markup. This script strips the pixel
 * widths from the table, its rows and its cells, and tags the table with a
 * class describing its shape. css/site.css then gives each shape a fluid
 * layout that matches what it looks like today on a desktop.
 *
 *   node tools/fluid-legacy-tables.js [--dry]
 *
 * Idempotent: a table that already carries a legacyTable class is skipped.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');

/* Which shape each page's table is. Listed by hand rather than sniffed,
   because these are the complete and closed set of pages that overflow --
   a scan of all 1,140 pages carrying a table found no others. */
const PAGES = [
	// One cell used purely as a centred container for a long list of links.
	['byartist.htm', 'list'],
	['bydate.htm', 'list'],
	['bydate_older.htm', 'list'],
	['byvenue.htm', 'list'],

	// A 450px column of links beside a 250px column of photographs.
	['festivals/2010/jbb.htm', 'fest'],
	['festivals/2011/beyondwonderland.htm', 'fest'],
	['festivals/2011/summerjam.htm', 'fest'],
	['festivals/2012/jingleball.htm', 'fest'],
	['festivals/2012/mayhem.htm', 'fest'],
	['festivals/2012/summerjam.htm', 'fest'],
	['festivals/2012/watershed.htm', 'fest'],

	// Rows of thumbnail | caption | thumbnail.
	['other/index.htm', 'thumb'],

	// A grid of banner thumbnails, three across.
	['galleries/index_old.htm', 'grid'],
];

/* Remove `width: NNNpx` (and a stray `height: NNNpx`) from one inline style,
   returning the tag with an empty style attribute dropped entirely. */
function stripPixelWidth(tag) {
	return tag.replace(/\sstyle\s*=\s*"([^"]*)"/i, (whole, style) => {
		const kept = style
			.split(';')
			.map((d) => d.trim())
			.filter((d) => d && !/^width\s*:\s*\d+(\.\d+)?px$/i.test(d));
		if (!kept.length) return '';
		return ' style="' + kept.join('; ') + '"';
	});
}

function addClass(tag, value) {
	if (/\sclass\s*=\s*"/i.test(tag)) {
		return tag.replace(/\sclass\s*=\s*"([^"]*)"/i, (w, c) => ' class="' + c.trim() + ' ' + value + '"');
	}
	return tag.replace(/^<table/i, '<table class="' + value + '"');
}

function convert(html, shape) {
	let changed = 0;

	const out = html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (block) => {
		if (/\blegacyTable\b/.test(block)) return block;

		const open = block.match(/<table\b[^>]*>/i)[0];
		if (!/width\s*:\s*\d+(\.\d+)?px/i.test(open)) return block;

		let next = block.replace(open, addClass(stripPixelWidth(open), 'legacyTable legacyTable--' + shape));
		next = next.replace(/<(tr|td|th)\b[^>]*>/gi, (tag) => stripPixelWidth(tag));

		changed += 1;
		return next;
	});

	return { out, changed };
}

let files = 0;
let tables = 0;

for (const [rel, shape] of PAGES) {
	const abs = path.join(ROOT, rel);
	if (!fs.existsSync(abs)) {
		console.log('  missing   ' + rel);
		continue;
	}

	const before = fs.readFileSync(abs, 'utf8');
	const { out, changed } = convert(before, shape);

	if (!changed || out === before) {
		console.log('  unchanged ' + rel);
		continue;
	}

	files += 1;
	tables += changed;
	console.log('  ' + (DRY ? 'would fix' : 'fixed    ') + ' ' + rel + '  (' + shape + ', ' + changed + ' table' + (changed === 1 ? '' : 's') + ')');

	if (!DRY) fs.writeFileSync(abs, out, 'utf8');
}

console.log('');
console.log('  pages  : ' + files);
console.log('  tables : ' + tables);
if (DRY) console.log('  dry run - nothing written');
