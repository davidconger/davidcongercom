/**
 * Replays retired URLs through the redirect rules in web.config.
 *
 * IIS is not available here - the local server is a small Node one - so the
 * rewrite rules cannot be exercised until the site is deployed, which is
 * exactly the wrong time to find out a pattern was wrong. This reads the rules
 * out of web.config itself, applies them in order the way IIS would, and checks
 * where each retired URL ends up.
 *
 * It reads the rules rather than restating them, so a typo in web.config fails
 * here instead of in production. tools/serve.js applies the same rules through
 * the same module, so the local preview and this check cannot disagree.
 *
 * What it proves for each URL:
 *   - some rule matches it, so it does not fall through to a 404
 *   - the redirect target is a page that exists on disk
 *   - a ?p=NN target names a photograph that is really on that page
 *
 *   node tools/rewrite-sim.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { readRules, apply } = require('./rewrite-rules');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'web.config');
const URLS = path.join(ROOT, 'tools', 'you-retired-urls.txt');

const rules = readRules(CONFIG);
console.log('rules read from web.config: ' + rules.length);
for (const r of rules) {
	console.log('  ' + (r.hasConditions ? 'skipped (needs a rewrite map)  ' : 'replayed                      ') + r.name);
}

const urls = fs.readFileSync(URLS, 'utf8').split(/\r?\n/)
	.filter((l) => l && !l.startsWith('#'));
console.log('\nretired URLs to replay: ' + urls.length);

const pageCache = new Map();
function photoIds(dir) {
	if (!pageCache.has(dir)) {
		const file = path.join(ROOT, dir, 'index.htm');
		pageCache.set(dir, fs.existsSync(file)
			? new Set([...fs.readFileSync(file, 'utf8').matchAll(/<li id="([^"]*)"/g)].map((x) => x[1]))
			: null);
	}
	return pageCache.get(dir);
}

const fail = { unmatched: [], notRedirect: [], noPage: [], noPhoto: [], badRule: [] };
const hits = new Map();

for (const url of urls) {
	const out = apply(rules, url);
	if (!out) { fail.unmatched.push(url); continue; }
	if (out.type === 'BadPattern') { fail.badRule.push(url + ': rule "' + out.rule + '" — ' + out.error); continue; }
	hits.set(out.rule, (hits.get(out.rule) || 0) + 1);
	if (out.type !== 'Redirect') { fail.notRedirect.push(url + ' -> ' + out.type + ' ' + (out.status || '')); continue; }

	const [target, query] = out.target.split('?');
	const dir = target.replace(/^\//, '').replace(/\/$/, '');
	const ids = photoIds(dir);
	if (!ids) { fail.noPage.push(url + ' -> ' + out.target + ' (no index.htm)'); continue; }
	if (query) {
		const n = (query.match(/(?:^|&)p=([\w-]+)/) || [])[1];
		const id = /^p-/.test(n || '') ? n : 'p-' + n;
		if (!ids.has(id)) fail.noPhoto.push(url + ' -> ' + out.target + ' (' + id + ' is not on that page)');
	}
}

console.log('');
for (const [name, n] of hits) console.log('  ' + String(n).padStart(6) + '  ' + name);

const problems = Object.entries(fail).filter(([, v]) => v.length);
console.log('');
if (!problems.length) {
	console.log('all ' + urls.length + ' retired URLs redirect to a page that exists, and every');
	console.log('?p=NN names a photograph that is really on it.');
} else {
	for (const [kind, list] of problems) {
		console.log(kind + ': ' + list.length);
		for (const l of list.slice(0, 15)) console.log('    ' + l);
	}
	process.exitCode = 1;
}

// A redirect that lands on another redirect costs the visitor a round trip and
// search engines treat long chains as a smell, so check the targets too.
const chained = [];
const targets = new Set();
for (const u of urls) {
	const out = apply(rules, u);
	if (out && out.target) targets.add(out.target);
}
for (const url of targets) {
	const again = apply(rules, url);
	if (again) chained.push(url + ' -> ' + (again.target || again.type));
}
console.log('\nredirect targets that redirect again: ' + chained.length);
for (const c of chained.slice(0, 10)) console.log('    ' + c);
if (chained.length) process.exitCode = 1;

// The rules are broad by design - they have to cover sixteen years of drift in
// how the generator named things - so it is worth being explicit about what
// they must leave alone. Everything here is a live URL.
const mustNotMatch = [
	'/you/',
	'/you/previous.htm',
	'/you/2026/craigcampbell-at-snoqualmiecasinoandhotel/',
	'/you/2026/craigcampbell-at-snoqualmiecasinoandhotel/index.htm',
	'/you/2013/buddy-guy-at-snoqualmie-casino/index.htm',
	'/you/2026/craigcampbell-at-snoqualmiecasinoandhotel/gallery/craigcampbell-at-snoqualmiecasinoandhotel-02.jpg',
	'/you/2013/buddy-guy-at-snoqualmie-casino/page-1/buddy-guy-at-snoqualmie-casino-01_sm.jpg',
	'/you/2013/buddy-guy-at-snoqualmie-casino/thumbnail.jpg',
	'/galleries/2019/12/deadmau5/index.htm',
	'/index.htm',
	'/about.htm',
];
const caught = [];
for (const url of mustNotMatch) {
	const out = apply(rules, url);
	if (out) caught.push(url + ' -> ' + out.rule);
}
console.log('\nlive URLs wrongly caught by a rule: ' + caught.length);
for (const c of caught) console.log('    ' + c);
if (caught.length) process.exitCode = 1;
