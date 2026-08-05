/**
 * Behaviour test for the /you/ gallery lightbox.
 *
 * The thumbnails are ordinary links to the full-size JPEG carrying a download
 * attribute, so with JavaScript blocked a click still gets the visitor their
 * photograph. This checks the enhanced path: that a click opens the photograph
 * over the page instead of navigating, that the controls sit clear of the
 * image so clicking the photograph still downloads it, that every documented
 * way of dismissing it works, and that a photograph missing from the server
 * produces a message rather than a broken image icon.
 *
 * Drives headless Edge over the DevTools protocol, like tools/layout-probe.js
 * and tools/test-rotator.js, so it needs no npm packages.
 *
 * Usage: node tools/test-lightbox.js [origin]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const origin = (process.argv[2] || 'http://127.0.0.1:8099').replace(/\/$/, '');
const NEWER = origin + '/you/2026/craigcampbell-at-snoqualmiecasinoandhotel/';
const OLDER = origin + '/you/2013/buddy-guy-at-snoqualmie-casino/';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));

if (!EDGE) {
  console.error('Microsoft Edge not found');
  process.exit(1);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-lightbox-'));
const PORT = 9300 + Math.floor(Math.random() * 400);

const browser = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1280,900',
  'about:blank',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}

async function main() {
  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await res.json();
      if (targets && targets.length) break;
    } catch {
      /* not ready yet */
    }
    await sleep(250);
  }
  if (!targets || !targets.length) throw new Error('DevTools endpoint never became ready');

  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  let consoleErrors = [];

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value || a.description).join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      consoleErrors.push([
        d.text,
        d.exception && (d.exception.description || d.exception.value),
      ].filter(Boolean).join(' '));
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await new Promise((r) => ws.addEventListener('open', r));
  await send('Runtime.enable');
  await send('Page.enable');

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.result && r.result.description));
    return r.result.value;
  };

  async function goto(url) {
    consoleErrors = [];
    // Via about:blank so a target differing only by #hash is still a real
    // load, which is what a visitor following a redirected link gets.
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(120);
    consoleErrors = [];
    await send('Page.navigate', { url });
    for (let i = 0; i < 80; i++) {
      const ready = await evaluate("document.readyState === 'complete' && !!document.getElementById('youimages')");
      if (ready) break;
      await sleep(250);
    }
    await sleep(150); // let the deferred script run
  }

  // What the page looks like right now, from the visitor's point of view.
  const state = () => evaluate(`(function () {
    var box = document.querySelector('.lightbox');
    var img = box && box.querySelector('.lightboxPhoto img');
    var link = box && box.querySelector('.lightboxPhoto');
    var save = box && box.querySelector('.lightboxSave');
    var note = box && box.querySelector('.lightboxNote');
    var inner = box && box.querySelector('.lightboxInner');
    return {
      exists: !!box,
      open: !!box && !box.hidden,
      scrollLocked: document.documentElement.classList.contains('lightboxOpen'),
      imgSrc: img ? img.getAttribute('src') : null,
      imgAlt: img ? img.getAttribute('alt') : null,
      linkHref: link ? link.getAttribute('href') : null,
      linkDownload: link ? link.hasAttribute('download') : false,
      linkDownloadName: link ? link.getAttribute('download') : null,
      saveHref: save ? save.getAttribute('href') : null,
      saveDownload: save ? save.hasAttribute('download') : false,
      saveDownloadName: save ? save.getAttribute('download') : null,
      saveHidden: save ? save.hidden : null,
      photoHidden: link ? link.hidden : null,
      noteHidden: note ? note.hidden : null,
      missing: inner ? inner.classList.contains('isMissing') : false,
      activeClass: document.activeElement ? document.activeElement.className : '',
      path: location.pathname,
      controlsOverlapPhoto: (function () {
        if (!box || box.hidden || !link || link.hidden) return null;
        var p = link.getBoundingClientRect();
        var tools = box.querySelectorAll('.lightboxBtn');
        for (var i = 0; i < tools.length; i++) {
          var t = tools[i].getBoundingClientRect();
          var overlap = !(t.right <= p.left || t.left >= p.right || t.bottom <= p.top || t.top >= p.bottom);
          if (overlap) return true;
        }
        return false;
      })()
    };
  })()`);

  const firstAnchor = () => evaluate(`(function () {
    var a = document.querySelector('#youimages li a');
    return {
      href: a.getAttribute('href'),
      download: a.hasAttribute('download'),
      downloadName: a.getAttribute('download'),
      li: a.parentNode.id
    };
  })()`);

  console.log('\nGallery lightbox — ' + NEWER + '\n');
  await goto(NEWER);

  const anchor = await firstAnchor();
  check('thumbnail links straight to the JPEG', /\.jpe?g$/i.test(anchor.href), anchor.href);
  check('thumbnail carries download, so it works with JS off', anchor.download === true);
  check('thumbnail li has a deep-link id', /^p-\d+$/.test(anchor.li), anchor.li);

  // The photographs on disk are named however the retired generator happened to
  // name them, which is not always after the event. The download attribute is
  // what the visitor actually ends up with in their downloads folder, so that
  // is the name that has to be right.
  const slug = NEWER.replace(/\/+$/, '').split('/').pop();
  const expectedName = slug + '-' + anchor.li.slice(2) + '.jpg';
  check('saved file is named after the event', anchor.downloadName === expectedName, anchor.downloadName);

  let s = await state();
  check('no overlay is built until it is needed', s.exists === false);

  const before = s.path;
  await evaluate("document.querySelector('#youimages li a').click()");
  await sleep(400);
  s = await state();
  check('clicking a thumbnail opens the lightbox', s.open === true);
  check('clicking a thumbnail does not navigate', s.path === before, s.path);
  check('lightbox shows the full-size photograph', s.imgSrc === anchor.href, String(s.imgSrc));
  check('photograph carries the thumbnail alt text', !!s.imgAlt, String(s.imgAlt));
  check('clicking the photograph downloads it', s.linkDownload === true && s.linkHref === anchor.href);
  check('download button points at the same photograph', s.saveDownload === true && s.saveHref === anchor.href);
  check('lightbox keeps the event-based filename',
    s.linkDownloadName === expectedName && s.saveDownloadName === expectedName,
    s.linkDownloadName + ' / ' + s.saveDownloadName);
  check('controls sit clear of the photograph', s.controlsOverlapPhoto === false);
  check('page behind is scroll-locked', s.scrollLocked === true);
  check('focus moves into the dialog', /lightboxClose/.test(s.activeClass), s.activeClass);

  // The header bar is sticky, so the overlay has to sit above it or the site
  // navigation would still be clickable over the photograph.
  const covers = await evaluate(`(function () {
    var box = document.querySelector('.lightbox');
    var pts = [[20, 25], [innerWidth - 30, 26], [innerWidth / 2, 12]];
    return pts.every(function (p) {
      var el = document.elementFromPoint(p[0], p[1]);
      return !!el && (el === box || box.contains(el));
    });
  })()`);
  check('overlay covers the sticky header', covers === true);

  // Clicking the photograph must not dismiss it - that click is the download.
  // The default is suppressed so the test does not start a real download.
  await evaluate(`(function () {
    window.__block = function (e) { e.preventDefault(); };
    document.querySelector('.lightboxPhoto').addEventListener('click', window.__block);
    document.querySelector('.lightboxPhoto').click();
  })()`);
  await sleep(250);
  s = await state();
  check('clicking the photograph does not close it', s.open === true);
  await evaluate("document.querySelector('.lightboxPhoto').removeEventListener('click', window.__block)");

  // Escape
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await sleep(400);
  s = await state();
  check('Escape closes the lightbox', s.open === false);
  check('scroll lock is released', s.scrollLocked === false);
  check('focus returns to the thumbnail', /lightbox/.test(s.activeClass) === false, s.activeClass);

  // Close button
  await evaluate("document.querySelector('#youimages li a').click()");
  await sleep(300);
  await evaluate("document.querySelector('.lightboxClose').click()");
  await sleep(400);
  s = await state();
  check('close button closes the lightbox', s.open === false);

  // Backdrop
  await evaluate("document.querySelector('#youimages li a').click()");
  await sleep(300);
  await evaluate(`(function () {
    var box = document.querySelector('.lightbox');
    var r = box.getBoundingClientRect();
    box.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 2, clientY: r.top + 2 }));
  })()`);
  await sleep(400);
  s = await state();
  check('clicking outside closes the lightbox', s.open === false);

  // A modified click must be left to the browser.
  await evaluate(`(function () {
    var a = document.querySelector('#youimages li a');
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  })()`);
  await sleep(250);
  s = await state();
  check('ctrl-click is left to the browser', s.open === false);

  // A photograph the server does not have must explain itself.
  await evaluate(`(function () {
    var a = document.querySelector('#youimages li a');
    a.setAttribute('href', 'gallery/definitely-not-here.jpg');
    a.click();
  })()`);
  await sleep(700);
  s = await state();
  check('missing photograph shows a message', s.open === true && s.missing === true && s.noteHidden === false);
  check('missing photograph hides the broken image', s.photoHidden === true);
  check('missing photograph hides the download button', s.saveHidden === true);
  await evaluate("document.querySelector('.lightboxClose').click()");
  await sleep(300);

  check('no console errors on the gallery', consoleErrors.length === 0, consoleErrors.join(' | '));

  // Deep link, which is what a retired per-photo URL will redirect to.
  await goto(NEWER + '#p-04');
  await sleep(400);
  s = await state();
  check('#p-NN deep link opens that photograph', s.open === true && /-04\.jpg$/.test(s.imgSrc || ''), String(s.imgSrc));

  // IIS is not reliable about carrying a fragment through a redirect, so the
  // rewrite rules send ?p=NN instead. It has to open the same photograph and
  // then tidy the URL back to the fragment form.
  await goto(NEWER + '?p=05');
  await sleep(400);
  s = await state();
  check('?p=NN query deep link opens that photograph', s.open === true && /-05\.jpg$/.test(s.imgSrc || ''), String(s.imgSrc));
  const tidied = await evaluate('location.search + location.hash');
  check('?p=NN is swapped for the tidy #p-NN', tidied === '#p-05', String(tidied));
  await evaluate("document.querySelector('.lightboxClose').click()");
  await sleep(300);

  // Same page, hash changed afterwards - an in-page link to a photograph.
  await evaluate("document.querySelector('.lightboxClose').click()");
  await sleep(400);
  await evaluate("location.hash = '#p-06'");
  await sleep(400);
  s = await state();
  check('changing the hash in place opens that photograph', s.open === true && /-06\.jpg$/.test(s.imgSrc || ''), String(s.imgSrc));

  // The older era had no download link at all on its per-photo pages, so this
  // is the change that gives those galleries one.
  console.log('\nOlder-era gallery — ' + OLDER + '\n');
  await goto(OLDER);
  const oldAnchor = await firstAnchor();
  check('older gallery links straight to the JPEG', /\.jpe?g$/i.test(oldAnchor.href), oldAnchor.href);
  check('older gallery gains a download affordance', oldAnchor.download === true);
  await evaluate("document.querySelector('#youimages li a').click()");
  await sleep(500);
  s = await state();
  check('older gallery opens the lightbox', s.open === true);
  check('older gallery shows the right photograph', s.imgSrc === oldAnchor.href, String(s.imgSrc));
  check('no console errors on the older gallery', consoleErrors.length === 0, consoleErrors.join(' | '));

  ws.close();
}

main()
  .then(() => {
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    browser.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* windows file locks */ }
    process.exit(failed.length ? 1 : 0);
  })
  .catch((err) => {
    console.error('\n' + err.stack);
    browser.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* windows file locks */ }
    process.exit(1);
  });
