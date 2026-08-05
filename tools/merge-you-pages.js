/**
 * Merges the paginated /you/ event galleries onto their single index page.
 *
 * 176 of the 324 events split their thumbnails across up to 18 pages, which
 * only ever existed because each photograph had a page of its own to link to.
 * The lightbox removed that need, so the pagination is now just extra pages to
 * load, extra URLs to keep alive and extra markup to maintain.
 *
 * The thumbnails are collected with a real DOM parser running in headless Edge
 * rather than by matching patterns, because the two era layouts differ in
 * attribute order and whitespace and a parser does not care about either. The
 * extracted markup is then spliced into the index page by locating the grid's
 * own tags, so the rest of the file is left byte-for-byte alone and the diff
 * stays readable.
 *
 * Photographs are re-sorted by their number on the way in. The retired
 * generator paginated in filename order, which is lexicographic, so any shoot
 * with more than 99 photographs ran 10, 100, 101 ... 11 — harmless while it was
 * spread over eighteen pages, obvious the moment it lands on one. Numeric order
 * is the order the photographs were taken.
 *
 * Re-running is safe: entries are keyed by photo id and the first copy wins, so
 * a second pass over an already-merged event is a no-op.
 *
 *   node tools/merge-you-pages.js --dry-run
 *   node tools/merge-you-pages.js
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const YOU = path.join(ROOT, 'you');
const DRY = process.argv.includes('--dry-run');

const GRID_OPEN = '<ul id="youimages">';
const GRID_CLOSE = '</ul>';
const NAV_OPEN = '<div class="younavigation">';
const NAV_CLOSE = '</div>';

const EDGE = [
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!EDGE) { console.error('Microsoft Edge not found'); process.exit(1); }

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function events() {
	const out = [];
	for (const year of fs.readdirSync(YOU, { withFileTypes: true })) {
		if (!year.isDirectory() || year.name === '!template') continue;
		for (const ev of fs.readdirSync(path.join(YOU, year.name), { withFileTypes: true })) {
			if (!ev.isDirectory()) continue;
			const dir = path.join(YOU, year.name, ev.name);
			if (rel(dir) === 'you/2023/Old') continue;
			if (!fs.existsSync(path.join(dir, 'index.htm'))) continue;
			const pages = fs.readdirSync(dir)
				.filter((f) => /^page-\d+\.htm$/i.test(f))
				.sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
			if (pages.length) out.push({ dir, pages });
		}
	}
	return out;
}

// Replace the content between a tag pair, leaving the tags and everything
// around them untouched. Returns null if the markers are not both present.
function spliceBetween(html, open, close, replacement, from) {
	const start = html.indexOf(open, from || 0);
	if (start === -1) return null;
	const inner = start + open.length;
	const end = html.indexOf(close, inner);
	if (end === -1) return null;
	return { text: html.slice(0, inner) + replacement + html.slice(end), next: inner + replacement.length + close.length };
}

(async () => {
	const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-merge-'));
	const PORT = 9100 + Math.floor(Math.random() * 300);
	const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
		'--no-default-browser-check', `--remote-debugging-port=${PORT}`,
		`--user-data-dir=${profile}`, 'about:blank']);

	let targets = null;
	for (let i = 0; i < 60; i++) {
		try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.length) break; } catch { /* not up yet */ }
		await sleep(250);
	}
	if (!targets || !targets.length) throw new Error('DevTools endpoint never became ready');

	const target = targets.find((t) => t.type === 'page') || targets[0];
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	let nextId = 1;
	const pending = new Map();
	ws.addEventListener('message', (ev) => {
		const m = JSON.parse(ev.data);
		if (m.id && pending.has(m.id)) {
			const p = pending.get(m.id); pending.delete(m.id);
			m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
		}
	});
	const send = (method, params = {}) => new Promise((resolve, reject) => {
		const id = nextId++; pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params }));
	});
	await new Promise((r) => ws.addEventListener('open', r));
	await send('Runtime.enable');
	const windowId = (await send('Runtime.evaluate', { expression: 'window' })).result.objectId;

	// Hand the browser a batch of documents and get their grid entries back.
	async function gridsOf(htmls) {
		const r = await send('Runtime.callFunctionOn', {
			objectId: windowId,
			returnByValue: true,
			arguments: [{ value: JSON.stringify(htmls) }],
			functionDeclaration: `function (json) {
				var parser = new DOMParser();
				return JSON.stringify(JSON.parse(json).map(function (html) {
					var doc = parser.parseFromString(html, 'text/html');
					var grid = doc.getElementById('youimages');
					if (!grid) return null;
					var items = [];
					for (var i = 0; i < grid.children.length; i++) {
						var el = grid.children[i];
						if (el.tagName !== 'LI') return { bad: el.tagName };
						items.push(el.outerHTML);
					}
					return { items: items };
				}));
			}`,
		});
		return JSON.parse(r.result.value);
	}

	const report = { events: 0, merged: 0, thumbnails: 0, pagesFolded: 0, skipped: [] };

	for (const ev of events()) {
		report.events++;
		const files = [path.join(ev.dir, 'index.htm'), ...ev.pages.map((p) => path.join(ev.dir, p))];
		const parsed = await gridsOf(files.map((f) => fs.readFileSync(f, 'utf8')));

		let ok = true;
		const items = [];
		parsed.forEach((info, i) => {
			if (!info) { report.skipped.push(rel(files[i]) + ' (no grid)'); ok = false; return; }
			if (info.bad) { report.skipped.push(rel(files[i]) + ' (unexpected <' + info.bad + '> in grid)'); ok = false; return; }
			for (const li of info.items) items.push(li);
		});
		if (!ok) continue;

		// Key on the photo id so a re-run over an already-merged event simply
		// finds the entries it added last time and changes nothing.
		const byId = new Map();
		let unkeyed = 0;
		for (const li of items) {
			const id = (li.match(/\bid="([^"]*)"/) || [])[1];
			if (!id) { unkeyed++; continue; }
			if (!byId.has(id)) byId.set(id, li);
		}
		if (unkeyed) { report.skipped.push(rel(ev.dir) + ' (' + unkeyed + ' entries without an id)'); continue; }

		const ids = [...byId.keys()];
		const numeric = ids.every((id) => /^p-\d+$/.test(id));
		if (numeric) ids.sort((a, b) => parseInt(a.slice(2), 10) - parseInt(b.slice(2), 10));
		const ordered = ids.map((id) => byId.get(id));
		if (!ordered.length) { report.skipped.push(rel(ev.dir) + ' (no photographs found)'); continue; }

		const indexFile = files[0];
		let html = fs.readFileSync(indexFile, 'utf8');

		// Nothing already on the index page may be dropped.
		const before = [...html.matchAll(/<li id="([^"]*)"/g)].map((m) => m[1]);
		const lost = before.filter((id) => !byId.has(id));
		if (lost.length) { report.skipped.push(rel(indexFile) + ' (would drop ' + lost.length + ': ' + lost[0] + ')'); continue; }

		const merged = '\n\t\t' + ordered.join('\n\t\t') + '\n\t';
		const grid = spliceBetween(html, GRID_OPEN, GRID_CLOSE, merged);
		if (!grid) { report.skipped.push(rel(indexFile) + ' (grid tags not found)'); continue; }
		html = grid.text;

		// The pagination links have nothing left to point at.
		const nav = '\n\t\t<a href="../../">Back to List</a>\n\t';
		let at = 0;
		for (;;) {
			const next = spliceBetween(html, NAV_OPEN, NAV_CLOSE, nav, at);
			if (!next) break;
			html = next.text;
			at = next.next;
		}

		report.merged++;
		report.thumbnails += ordered.length;
		report.pagesFolded += ev.pages.length;
		if (!DRY) fs.writeFileSync(indexFile, html);
	}

	console.log((DRY ? 'DRY RUN — ' : '') + 'paginated events: ' + report.events);
	console.log('  merged onto one page: ' + report.merged);
	console.log('  thumbnails carried over: ' + report.thumbnails);
	console.log('  pagination pages folded in: ' + report.pagesFolded);
	console.log('  skipped: ' + report.skipped.length);
	for (const s of report.skipped.slice(0, 20)) console.log('    ' + s);

	ws.close(); browser.kill();
	try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* windows file locks */ }
})();
