#!/usr/bin/env node
/*
 * fix-you-subdomain-links.js
 *
 * Forty-three pages still send visitors to https://you.davidconger.com/ --
 * the ASP.NET "Photos of You" application that ran on its own subdomain from
 * 2009 to 2011. That subdomain no longer resolves, so every one of these
 * links is a dead end.
 *
 * The events themselves were not lost: tools/convert-you-old.js brought all
 * twenty-four of them into /you/2009/, /you/2010/ and /you/2011/ as static
 * pages. The old URLs were of the form
 *
 *     https://you.davidconger.com/2011-05-beyond-wonderland/index.aspx
 *
 * and the slug after the date is exactly the folder name the converter used,
 * so the mapping is mechanical. Every target is verified to exist on disk
 * before a link is rewritten, and the replacement is written relative to the
 * page doing the linking, matching how these pages link to everything else.
 *
 *   node tools/fix-you-subdomain-links.js [--dry]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');
const SKIP = new Set(['1cnf', '1pvt', 'node_modules', '.git', 'tools', 'you_old']);

const URL_RE = /https?:\/\/you\.davidconger\.com\/([^"'\s<>)]*)/gi;

/* `2011-05-beyond-wonderland/index.aspx` -> `you/2011/beyond-wonderland`.
   A handful of the oldest links omit the month, so the year is taken from the
   front and everything after the first date component is the slug. */
function targetFor(tail) {
	const m = /^(\d{4})-(?:\d{2}-)?([a-z0-9-]+?)\/?(?:index\.aspx)?\/?$/i.exec(tail);
	if (!m) return null;
	return 'you/' + m[1] + '/' + m[2];
}

function relativeTo(fromFile, target) {
	const rel = path.relative(path.dirname(fromFile), path.join(ROOT, target));
	return rel.split(path.sep).join('/') + '/';
}

const files = [];
(function walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.isDirectory()) {
			if (SKIP.has(e.name)) continue;
			walk(path.join(dir, e.name));
			continue;
		}
		if (/\.html?$/i.test(e.name)) files.push(path.join(dir, e.name));
	}
})(ROOT);

const unresolved = new Map();
let touched = 0;
let rewritten = 0;

for (const abs of files) {
	const before = fs.readFileSync(abs, 'utf8');
	if (!/you\.davidconger\.com/i.test(before)) continue;

	let count = 0;
	const after = before.replace(URL_RE, (whole, tail) => {
		const target = targetFor(tail);
		if (!target || !fs.existsSync(path.join(ROOT, target, 'index.htm'))) {
			unresolved.set(whole, (unresolved.get(whole) || 0) + 1);
			return whole;
		}
		count += 1;
		return relativeTo(abs, target);
	});

	if (!count) continue;
	touched += 1;
	rewritten += count;
	console.log('  ' + (DRY ? 'would fix' : 'fixed    ') + ' ' + path.relative(ROOT, abs).replace(/\\/g, '/') + '  (' + count + ')');
	if (!DRY) fs.writeFileSync(abs, after, 'utf8');
}

console.log('');
console.log('  pages     : ' + touched);
console.log('  links     : ' + rewritten);
if (unresolved.size) {
	console.log('  unresolved:');
	for (const [u, n] of unresolved) console.log('    ' + n + '  ' + u);
} else {
	console.log('  unresolved: none');
}
if (DRY) console.log('  dry run - nothing written');
