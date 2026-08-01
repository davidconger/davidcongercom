/**
 * Bulk markup modernizer for the davidconger.com archive.
 *
 * Applies the agreed head/chrome normalization to legacy pages. Every
 * transform is idempotent: running this twice produces identical output, so it
 * is safe to re-run over a partially-converted tree.
 *
 * Usage:
 *   node tools/modernize.js <root> --dry-run [--limit N] [--filter substring]
 *   node tools/modernize.js <root> --write   [--limit N] [--filter substring]
 *
 * What it does, and why:
 *   - XHTML 1.0 doctype and xmlns soup  -> <!DOCTYPE html> / <html lang="en">
 *   - http-equiv Content-Type/Language  -> <meta charset="utf-8">
 *   - adds <meta name="viewport">       -> the single highest-impact change;
 *                                          only 4 of 9,759 pages had one
 *   - drops <meta name="keywords">      -> ignored by search engines since ~2009
 *   - all.css + core.css + galleries.css + catalog.css -> one css/site.css link,
 *     at a depth recomputed from the file's real location (this also repairs
 *     the pages whose stylesheet path was wrong to begin with)
 *   - removes js/galleries.js           -> the file is entirely commented out
 *   - removes jQuery + lazyload + scrollstop and rewrites
 *     <img class="lazy" data-original="x.jpg"> to native
 *     <img src="x.jpg" loading="lazy">
 *   - removes the dead social widgets: Facebook SDK and fb:like, Twitter
 *     widgets.js, Google+ plusone (Google+ shut down in 2019), Pinterest
 *     pinit.js, SiteMeter (shut down in 2022) and fbpublish.js
 *   - removes the share overlay markup, which was only ever revealed by a
 *     function that has been commented out for years
 *   - defers azureinsights.js
 *   - updates the footer copyright to 2026
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const root = path.resolve(args[0] && !args[0].startsWith('--') ? args[0] : '.');
const write = args.includes('--write');
const dryRun = !write;
const limitIdx = args.indexOf('--limit');
const limit = limitIdx > -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const filterIdx = args.indexOf('--filter');
const filter = filterIdx > -1 ? args[filterIdx + 1] : null;
const showDiffIdx = args.indexOf('--show');
const showDiff = showDiffIdx > -1 ? parseInt(args[showDiffIdx + 1], 10) : 0;

const SKIP_DIRS = new Set(['.git', 'node_modules', 'tools']);
const COPYRIGHT_YEAR = '2026';

/**
 * Accessible names for the social profile icons in the site header. Keyed by
 * the icon basename, with the "-24" size suffix already stripped, so both the
 * 16px and 24px icon sets resolve to the same label.
 */
const ICON_ALT = {
  facebook: 'David Conger Photography on Facebook',
  flickr: 'David Conger Photography on Flickr',
  twitter: 'David Conger Photography on Twitter',
  instagram: 'David Conger Photography on Instagram',
  tumblr: 'David Conger Photography on Tumblr',
  pinterest: 'David Conger Photography on Pinterest',
  posterous: 'David Conger Photography on Posterous',
  rss: 'Subscribe to the RSS feed',
  email: 'Email David Conger',
};

/**
 * Breadcrumb links, keyed by their visible text, mapped to the page they are
 * supposed to open (site-root-relative).
 *
 * These "../" chains were hand-maintained for years and drifted: 1,337 pages
 * have a "Photos of You" crumb with one segment too many, which lands on the
 * home page instead. It resolves to a real page, so a broken-link check calls
 * it healthy — only comparing the text to the destination catches it.
 */
const BREADCRUMBS = {
  'home': 'index.htm',
  'photos of you': 'you/index.htm',
  'concert & event photos': 'catalog/index.htm',
  'concert and event photos': 'catalog/index.htm',
};

/**
 * Declarations that css/site.css already applies to `body`. Any inline copy of
 * these on a page is redundant, so the transform strips them.
 */
const BODY_DEFAULTS = {
  color: ['#ffffff', '#fff', 'white'],
  'background-color': ['#2a2a2a'],
  'font-family': ['arial, helvetica, sans-serif'],
  'text-align': ['center'],
};

/* ------------------------------------------------------------------ helpers */

/**
 * Removes an element and its contents, honouring nesting of the same tag name.
 * Regex alone cannot do this correctly when the element contains another
 * element of the same type.
 */
function removeElement(html, openTagRegex, tagName) {
  let out = html;
  for (;;) {
    openTagRegex.lastIndex = 0;
    const m = openTagRegex.exec(out);
    if (!m) break;

    const start = m.index;
    let i = start + m[0].length;

    // A self-closed opening tag has no matching close tag.
    if (/\/>$/.test(m[0])) {
      out = out.slice(0, start) + out.slice(i);
      continue;
    }

    let depth = 1;
    const scan = new RegExp(`<(/?)${tagName}\\b[^>]*?(/?)>`, 'gi');
    scan.lastIndex = i;
    let s;
    let end = -1;
    while ((s = scan.exec(out))) {
      if (s[2] === '/') continue; // self-closing, does not change depth
      depth += s[1] === '/' ? -1 : 1;
      if (depth === 0) {
        end = s.index + s[0].length;
        break;
      }
    }
    if (end === -1) break; // unbalanced; leave the document alone
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}

/** Removes <script ...>...</script> blocks whose full text matches a pattern. */
function removeScripts(html, pattern) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>\s*/gi, (block) =>
    pattern.test(block) ? '' : block
  );
}

/** Relative path from a page to the site root, e.g. '../../../../'. */
function prefixFor(file) {
  const rel = path.relative(path.dirname(file), root).replace(/\\/g, '/');
  return rel === '' ? '' : rel + '/';
}

/* --------------------------------------------------------------- transforms */

function modernize(html, file) {
  const prefix = prefixFor(file);
  let out = html;

  // --- doctype and root element -------------------------------------------
  out = out.replace(/<!DOCTYPE[^>]*>/i, '<!DOCTYPE html>');
  out = out.replace(/<html\b[^>]*>/i, '<html lang="en">');

  // --- head meta ------------------------------------------------------------
  out = out.replace(/[ \t]*<meta[^>]+http-equiv=["']Content-Language["'][^>]*>\s*\n?/gi, '');
  out = out.replace(/[ \t]*<meta[^>]+name=["']keywords["'][^>]*>\s*\n?/gi, '');
  out = out.replace(/[ \t]*<meta[^>]+property=["']fb:admins["'][^>]*>\s*\n?/gi, '');

  // Content-Type becomes the short charset form. If a charset meta already
  // exists this is a no-op, which keeps the transform idempotent.
  out = out.replace(
    /<meta[^>]+http-equiv=["']Content-Type["'][^>]*>/gi,
    '<meta charset="utf-8">'
  );
  if (!/<meta[^>]+charset=/i.test(out)) {
    out = out.replace(/<head\b[^>]*>/i, (m) => m + '\n<meta charset="utf-8">');
  }

  // --- viewport -------------------------------------------------------------
  if (!/<meta[^>]+name=["']viewport["']/i.test(out)) {
    out = out.replace(
      /<meta[^>]+charset=[^>]*>/i,
      (m) => m + '\n<meta name="viewport" content="width=device-width, initial-scale=1">'
    );
  }

  // --- stylesheets ----------------------------------------------------------
  // Drop every legacy sheet, then add a single correctly-rooted site.css.
  const legacyCss = /[ \t]*<link\b[^>]*href=['"][^'"]*(?:css\/(?:all|core|galleries|lightbox)\.css|catalog\.css|you\.css)[^'"]*['"][^>]*>\s*\n?/gi;
  const hadLegacyCss = legacyCss.test(out);
  legacyCss.lastIndex = 0;
  out = out.replace(legacyCss, '');

  if (!new RegExp(`href=['"][^'"]*css/site\\.css`, 'i').test(out)) {
    const siteLink = `<link rel="stylesheet" href="${prefix}css/site.css">`;
    if (/<link\b[^>]*fonts\.googleapis\.com[^>]*>/i.test(out)) {
      out = out.replace(/(<link\b[^>]*fonts\.googleapis\.com[^>]*>)/i, `$1\n${siteLink}`);
    } else if (/<\/title>/i.test(out)) {
      out = out.replace(/<\/title>/i, `</title>\n${siteLink}`);
    } else {
      out = out.replace(/<head\b[^>]*>/i, (m) => m + '\n' + siteLink);
    }
  }
  void hadLegacyCss;

  // --- dead scripts ---------------------------------------------------------
  out = removeScripts(out, /js\/galleries\.js/i);
  out = removeScripts(out, /fbpublish\.js/i);
  out = removeScripts(out, /ajax\.aspnetcdn\.com/i);
  out = removeScripts(out, /jquery\.lazyload\.js/i);
  out = removeScripts(out, /jquery\.scrollstop\.js/i);
  out = removeScripts(out, /platform\.twitter\.com/i);
  out = removeScripts(out, /apis\.google\.com\/js\/plusone/i);
  out = removeScripts(out, /assets\.pinterest\.com/i);
  out = removeScripts(out, /sitemeter\.com/i);
  out = removeScripts(out, /connect\.facebook\.net/i);
  out = removeScripts(out, /\.lazyload\s*\(/i);
  out = removeScripts(out, /_uacct|urchin/i);

  // --- native lazy loading --------------------------------------------------
  // <img class="lazy" data-original="x.jpg" ...> -> <img src="x.jpg" loading="lazy" ...>
  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    if (!/data-original=/i.test(tag)) return tag;
    const src = tag.match(/data-original=["']([^"']*)["']/i);
    if (!src) return tag;

    let t = tag;
    t = t.replace(/\s*data-original=["'][^"']*["']/i, '');
    t = t.replace(/\s*class=["']lazy["']/i, '');
    t = t.replace(/(class=["'][^"']*)\blazy\b\s*/i, '$1');
    t = t.replace(/\s*src=["'][^"']*["']/i, '');
    t = t.replace(/<img\b/i, `<img src="${src[1]}"`);
    if (!/loading=/i.test(t)) t = t.replace(/\s*\/?>$/, ' loading="lazy" decoding="async"$&');
    return t.replace(/\s+/g, ' ').replace(/\s+(\/?)>$/, '$1>');
  });

  // Any remaining images below the fold benefit from lazy loading too, but the
  // first image on a page should stay eager, so only class="lazy" is converted.

  // --- dead social widget markup -------------------------------------------
  out = removeElement(out, /<div\b[^>]*id=["']fb-root["'][^>]*>/i, 'div');
  out = removeElement(out, /<div\b[^>]*class=["'](?:shareWide|shareTallL|shareTallR)["'][^>]*>/i, 'div');
  out = out.replace(/<fb:like\b[^>]*>\s*<\/fb:like>\s*/gi, '');
  out = out.replace(/<fb:like\b[^>]*\/>\s*/gi, '');
  out = out.replace(/<g:plusone\b[^>]*>\s*<\/g:plusone>\s*/gi, '');
  out = out.replace(/<g:plusone\b[^>]*\/>\s*/gi, '');
  out = out.replace(
    /<a\b[^>]*class=["']twitter-share-button["'][^>]*>\s*<\/a>\s*/gi,
    ''
  );

  // SiteMeter shut down in 2022. Removing its <script> leaves behind a
  // <noscript> beacon and comment wrapper, so take the whole block.
  out = out.replace(
    /[ \t]*<!--\s*Site Meter\s*-->[\s\S]*?<!--\s*Copyright[^>]*Site Meter\s*-->\s*\n?/gi,
    ''
  );
  out = out.replace(/[ \t]*<noscript>[\s\S]*?sitemeter[\s\S]*?<\/noscript>\s*\n?/gi, '');

  // --- social profile icons -------------------------------------------------
  // These are real links to the owner's own profiles, so they stay. But every
  // one of them shipped without an accessible name, which makes the header a
  // run of unlabelled links for screen-reader and keyboard users.
  out = out.replace(/<img\b([^>]*images\/icons\/([A-Za-z0-9._-]+?)(?:-24)?\.png[^>]*)>/gi,
    (m, attrs, name) => {
      if (/\balt=/i.test(attrs)) return m;
      const label = ICON_ALT[name.toLowerCase()];
      if (!label) return m;
      return `<img${attrs.replace(/\s*\/\s*$/, '')} alt="${label}"/>`;
    });

  // Posterous shut down in 2013; the link was commented out at the time and the
  // dead markup has been shipping on every page since.
  out = out.replace(
    /[ \t]*<!--\s*<a\b[^>]*>\s*<img\b[^>]*posterous\.png[^>]*>\s*<\/a>(?:&nbsp;)?\s*-->\s*\n?/gi,
    ''
  );

  // Twitter dropped hashbang profile URLs in 2012.
  out = out.replace(/(https?:\/\/twitter\.com)\/#!\//gi, '$1/');

  // --- site banner ----------------------------------------------------------
  // 1,372 pages load the banner from the hardcoded apex domain, so visitors on
  // www.davidconger.com pay for a second origin connection to fetch an asset
  // that sits right next to the page. Point it at the local copy instead.
  out = out.replace(
    /(<img\b[^>]*\ssrc=["'])https?:\/\/(?:www\.)?davidconger\.com\/images\/header\.png(["'])/gi,
    `$1${prefix}images/header.png$2`
  );
  out = out.replace(/<img\b([^>]*images\/header\.png[^>]*)>/gi, (m, attrs) =>
    /\balt=/i.test(attrs)
      ? m
      : `<img${attrs.replace(/\s*\/\s*$/, '')} alt="David Conger Photography"/>`
  );

  // --- breadcrumbs ----------------------------------------------------------
  out = out.replace(
    /<a\b([^>]*?)href=(["'])([^"']*index\.html?)\2([^>]*)>([\s\S]*?)<\/a>/gi,
    (m, pre, q, href, post, text) => {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(href)) return m;
      const label = text
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      const target = BREADCRUMBS[label];
      if (!target) return m;
      return `<a ${pre.trim()}${pre.trim() ? ' ' : ''}href=${q}${prefix}${target}${q}${post}>${text}</a>`;
    }
  );

  // --- body -----------------------------------------------------------------
  out = out.replace(/<body\b([^>]*)\sclass=["']dcStandardBody["']/i, '<body$1');

  // 2,339 pages repeat the site palette as an inline <body> style. It matches
  // css/site.css exactly, so it is pure duplication that would silently defeat
  // any future theme change. Drop only the properties the stylesheet already
  // owns, so the handful of pages with extra declarations keep them.
  out = out.replace(/(<body\b[^>]*?)\sstyle=(["'])([^"']*)\2/i, (m, head, q, css) => {
    const kept = css
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .filter((d) => {
        const i = d.indexOf(':');
        if (i < 0) return true;
        const prop = d.slice(0, i).trim().toLowerCase();
        const val = d.slice(i + 1).trim().toLowerCase().replace(/\s+/g, ' ');
        return !(BODY_DEFAULTS[prop] && BODY_DEFAULTS[prop].includes(val));
      });
    return kept.length ? `${head} style=${q}${kept.join('; ')};${q}` : head;
  });

  // --- analytics ------------------------------------------------------------
  out = out.replace(/<script\b([^>]*azureinsights\.js[^>]*)>/gi, (m, attrs) =>
    /\bdefer\b/i.test(attrs) ? m : `<script${attrs} defer>`
  );
  out = out.replace(/\stype=["']text\/javascript["']/gi, '');

  // --- copyright ------------------------------------------------------------
  out = out.replace(/(Copyright\s+2008-)\d{4}/gi, `$1${COPYRIGHT_YEAR}`);

  // A minority of listing pages never had a footer at all. Give every page the
  // same one so the notice is consistent site-wide.
  if (!/Copyright\s+2008-/i.test(out) && /<\/body>/i.test(out)) {
    out = out.replace(
      /([ \t]*)<\/body>/i,
      `\n<p class="siteFooter">\nCopyright 2008-${COPYRIGHT_YEAR} | David Conger, LLC | All Rights Reserved<br />Not for distribution or reuse without permission.</p>\n\n$1</body>`
    );
  }

  // --- tidy -----------------------------------------------------------------
  out = out.replace(/\n{3,}/g, '\n\n');

  return out;
}

/* -------------------------------------------------------------------- main */

const pages = [];
(function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full);
    } else if (/\.html?$/i.test(e.name)) {
      if (!filter || full.replace(/\\/g, '/').includes(filter)) pages.push(full);
    }
  }
})(root);

let changed = 0;
let shown = 0;
let scanned = 0;

for (const file of pages) {
  if (scanned >= limit) break;
  scanned++;

  let html;
  try {
    html = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  const hadBom = html.charCodeAt(0) === 0xfeff;
  const body = hadBom ? html.slice(1) : html;

  const next = modernize(body, file);
  if (next === body) continue;

  changed++;

  if (showDiff && shown < showDiff) {
    shown++;
    console.log('\n' + '='.repeat(72));
    console.log(path.relative(root, file).replace(/\\/g, '/'));
    console.log('='.repeat(72));
    console.log(next.slice(0, 2600));
  }

  if (write) {
    fs.writeFileSync(file, (hadBom ? '\ufeff' : '') + next, 'utf8');
  }
}

console.log(
  `\n${dryRun ? 'DRY RUN' : 'WROTE'}: ${changed} of ${scanned} scanned pages would change` +
    (filter ? ` (filter: ${filter})` : '')
);
