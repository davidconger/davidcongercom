/**
 * Fingerprints every page by which legacy constructs it contains, so the bulk
 * transform can be designed against the real distribution of markup rather
 * than one sample page.
 *
 * Usage: node tools/fingerprint.js [root]
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '.');
const SKIP = new Set(['.git', 'node_modules', 'tools']);

const FEATURES = {
  xhtmlDoctype: /<!DOCTYPE[^>]*XHTML/i,
  html5Doctype: /<!DOCTYPE html>/i,
  hasViewport: /<meta[^>]+name=["']viewport["']/i,
  hasCharsetMeta: /<meta[^>]+charset=["']?utf-8/i,
  httpEquivType: /http-equiv=["']Content-Type["']/i,
  httpEquivLang: /http-equiv=["']Content-Language["']/i,
  keywordsMeta: /<meta[^>]+name=["']keywords["']/i,
  linkAllCss: /css\/all\.css/i,
  linkCoreCss: /css\/core\.css/i,
  linkGalleriesCss: /css\/galleries\.css/i,
  linkCatalogCss: /catalog\.css/i,
  linkSiteCss: /css\/site\.css/i,
  googleFonts: /fonts\.googleapis\.com/i,
  scriptGalleries: /js\/galleries\.js/i,
  scriptAzure: /azureinsights\.js/i,
  scriptFbPublish: /fbpublish\.js/i,
  jqueryCdn: /ajax\.aspnetcdn\.com/i,
  lazyloadPlugin: /jquery\.lazyload\.js/i,
  scrollstopPlugin: /jquery\.scrollstop\.js/i,
  lazyloadCall: /\.lazyload\s*\(/i,
  imgLazyClass: /class=["']lazy["']/i,
  dataOriginal: /data-original=/i,
  fbRoot: /id=["']fb-root["']/i,
  fbLike: /<fb:like/i,
  fbSdkInline: /connect\.facebook\.net/i,
  twitterWidget: /platform\.twitter\.com/i,
  googlePlusone: /plusone/i,
  pinterestPinit: /assets\.pinterest\.com/i,
  siteMeter: /sitemeter\.com/i,
  shareOverlay: /class=["']share(Wide|TallL|TallR)["']/i,
  bodyClassStd: /<body[^>]*class=["']dcStandardBody["']/i,
  bodyOnload: /<body[^>]*onload=/i,
  inlineOnclick: /\son(click|load)\s*=/i,
  copyright: /Copyright\s+2008-(\d{4})/i,
  posterous: /posterous/i,
  headerNav: /class=["']headerNav["']/i,
  galleryDiv: /id=["']gallery["']/i,
  catalogDiv: /id=["']catalog["']/i,
  youImages: /id=["']youimages?["']/i,
};

const counts = {};
const copyrightYears = {};
let pages = 0;

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
      if (!SKIP.has(e.name)) walk(full);
    } else if (/\.html?$/i.test(e.name)) {
      let html;
      try {
        html = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      pages++;
      for (const [name, re] of Object.entries(FEATURES)) {
        if (re.test(html)) counts[name] = (counts[name] || 0) + 1;
      }
      const m = html.match(/Copyright\s+2008-(\d{4})/i);
      if (m) copyrightYears[m[1]] = (copyrightYears[m[1]] || 0) + 1;
    }
  }
})(root);

console.log(`Pages scanned: ${pages}\n`);
console.log('Feature'.padEnd(22) + 'Pages'.padStart(8) + '   %');
console.log('-'.repeat(40));
Object.entries(counts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) =>
    console.log(k.padEnd(22) + String(v).padStart(8) + '   ' + ((v / pages) * 100).toFixed(1))
  );

console.log('\nCopyright end-year distribution:');
Object.entries(copyrightYears)
  .sort()
  .forEach(([y, n]) => console.log('  2008-' + y + '  ' + n));
