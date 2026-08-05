/**
 * A small reader and matcher for the redirect rules in web.config.
 *
 * IIS is not available locally, so without this the two things that most need
 * to agree about the rules - the preview server and the check that replays
 * retired URLs through them - would each have their own copy of the patterns.
 * They share this one instead, and both read the rules out of web.config rather
 * than restating them, so a typo there shows up here.
 *
 * This covers the subset of the rewrite format the site uses: a match pattern,
 * an optional negate, and a Redirect or CustomResponse action. Rules with
 * <conditions> depend on server variables and rewrite maps that only IIS has;
 * they are reported as skipped rather than guessed at.
 */
'use strict';

const fs = require('fs');

function decode(s) {
	return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function readRules(xmlOrFile) {
	const xml = xmlOrFile.includes('<') ? xmlOrFile : fs.readFileSync(xmlOrFile, 'utf8');
	const block = xml.match(/<rules>([\s\S]*?)<\/rules>/);
	if (!block) throw new Error('no <rules> section found');
	const rules = [];
	for (const m of block[1].matchAll(/<rule\s+([^>]*?)>([\s\S]*?)<\/rule>/g)) {
		const attrs = m[1], body = m[2];
		const match = body.match(/<match\s+url="([^"]*)"([^>]*)\/>/);
		if (!match) continue;
		const action = body.match(/<action\s+([^>]*?)\/>/);
		const a = action ? action[1] : '';
		rules.push({
			name: (attrs.match(/name="([^"]*)"/) || [])[1] || '(unnamed)',
			pattern: decode(match[1]),
			negate: /negate="true"/.test(match[2] || ''),
			ignoreCase: !/ignoreCase="false"/.test(match[2] || ''),
			hasConditions: /<conditions/.test(body),
			type: (a.match(/type="([^"]*)"/) || [])[1] || null,
			url: decode((a.match(/\burl="([^"]*)"/) || [])[1] || ''),
			statusCode: (a.match(/statusCode="([^"]*)"/) || [])[1] || null,
			redirectType: (a.match(/redirectType="([^"]*)"/) || [])[1] || 'Permanent',
		});
	}
	return rules;
}

const STATUS = { Permanent: 301, Found: 302, SeeOther: 303, Temporary: 307 };

/**
 * Runs a request path through the rules the way IIS would: in order, first
 * match wins. IIS matches the path without its leading slash and without the
 * query string.
 *
 * Returns null when nothing matches, otherwise { rule, type, ... }.
 */
function apply(rules, url) {
	const requestPath = String(url).replace(/^\//, '').split('?')[0];
	for (const rule of rules) {
		if (rule.hasConditions) continue;
		let re;
		try { re = new RegExp(rule.pattern, rule.ignoreCase ? 'i' : ''); }
		catch (err) { return { rule: rule.name, type: 'BadPattern', error: err.message }; }
		const m = re.exec(requestPath);
		if (rule.negate ? !!m : !m) continue;
		if (rule.type === 'Redirect') {
			return {
				rule: rule.name,
				type: 'Redirect',
				status: STATUS[rule.redirectType] || 301,
				target: rule.url.replace(/\{R:(\d+)\}/g, (all, n) => (m && m[Number(n)] !== undefined ? m[Number(n)] : '')),
			};
		}
		return { rule: rule.name, type: rule.type, status: Number(rule.statusCode) || 404 };
	}
	return null;
}

module.exports = { readRules, apply };
