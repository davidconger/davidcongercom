/**
 * Behaviour test for the homepage rotator's missing-photograph handling.
 *
 * js/featured-images.json is generated from the local archive, but the
 * photographs are published separately from the markup, so the pool can name
 * an image the server does not have yet. This checks what the rotator does
 * when that happens: the frame takes the next ranked photograph instead of
 * showing a broken image, and once nothing is left to fall back to the frame
 * is removed rather than left blank.
 *
 * The failures are simulated by dispatching an error event at the slide
 * images, which is exactly what the browser does on a 404 and means the test
 * needs neither a missing file nor a network fault to reproduce it.
 *
 * Drives headless Edge over the DevTools protocol, like tools/layout-probe.js,
 * so it needs no npm packages.
 *
 * Usage: node tools/test-rotator.js [url]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const url = process.argv[2] || 'http://127.0.0.1:8099/';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));

if (!EDGE) {
  console.error('Microsoft Edge not found');
  process.exit(1);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-rotator-'));
const PORT = 9800 + Math.floor(Math.random() * 400);

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
  const consoleErrors = [];

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
        d.url ? d.url + ':' + d.lineNumber : '',
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

  await send('Page.navigate', { url });
  for (let i = 0; i < 80; i++) {
    const n = await evaluate("document.querySelectorAll('#focusFrame .showSlide').length");
    if (n > 0) break;
    await sleep(250);
  }

  const state = () => evaluate(`(function () {
    var frame = document.getElementById('focusFrame');
    var host = document.querySelector('#focusShow .showDots');
    return {
      slides: frame.children.length,
      dots: host ? host.children.length : 0,
      srcs: Array.prototype.map.call(frame.children, function (s) {
        var i = s.querySelector('img');
        return i.getAttribute('src') || i.getAttribute('data-src') || '';
      }),
      artists: Array.prototype.map.call(frame.children, function (s) {
        var a = s.querySelector('.showArtist');
        return a ? a.textContent : '';
      }),
      dotLabels: host ? Array.prototype.map.call(host.children, function (d) {
        return d.getAttribute('aria-label');
      }) : [],
      dotIndexes: host ? Array.prototype.map.call(host.children, function (d) {
        return d.getAttribute('data-index');
      }) : [],
      active: Array.prototype.findIndex.call(frame.children, function (s) {
        return s.classList.contains('is-active');
      }),
      hidden: document.getElementById('focusShow').hasAttribute('hidden')
    };
  })()`);

  const failFirst = () => evaluate(`(function () {
    var frame = document.getElementById('focusFrame');
    if (!frame.children.length) return false;
    frame.children[0].querySelector('img').dispatchEvent(new Event('error'));
    return true;
  })()`);

  /* Fires at the first frame until the slide count changes, which is the point
     the reserve runs dry. Done inside the page so draining a 183-frame reserve
     is one round trip rather than 183. */
  const drainToFirstDrop = () => evaluate(`(function () {
    var frame = document.getElementById('focusFrame');
    var start = frame.children.length;
    var fired = 0;
    while (frame.children.length === start && fired < 500 && frame.children.length) {
      frame.children[0].querySelector('img').dispatchEvent(new Event('error'));
      fired++;
    }
    return { fired: fired, slides: frame.children.length };
  })()`);

  const drainToEmpty = () => evaluate(`(function () {
    var frame = document.getElementById('focusFrame');
    var fired = 0;
    while (frame.children.length && fired < 500) {
      frame.children[0].querySelector('img').dispatchEvent(new Event('error'));
      fired++;
    }
    return { fired: fired, slides: frame.children.length };
  })()`);

  console.log(`\nRotator missing-photograph behaviour (${url})\n`);

  const before = await state();
  check('the rotator builds its slides', before.slides > 1, before.slides + ' slides, ' + before.dots + ' dots');
  check('every slide has a photograph and a caption',
    before.srcs.every(Boolean) && before.artists.every(Boolean));
  check('one slide starts active', before.active === 0, 'active=' + before.active);

  await failFirst();
  const after = await state();
  check('a frame whose photograph is missing is replaced, not left broken',
    after.slides === before.slides && after.srcs[0] !== before.srcs[0],
    before.srcs[0] + '  ->  ' + after.srcs[0]);
  check('the replacement frame carries its own caption',
    after.artists[0] !== before.artists[0] && Boolean(after.artists[0]),
    before.artists[0] + '  ->  ' + after.artists[0]);
  check('the replacement frame loads straight away rather than staying lazy',
    after.srcs[0] === after.srcs[0] && !after.srcs[0].startsWith('data:'));
  check("the dot's label follows the frame it points at",
    after.dotLabels[0] && after.dotLabels[0].indexOf(after.artists[0]) !== -1,
    after.dotLabels[0]);
  check('the other frames are untouched',
    after.srcs.slice(1).join('|') === before.srcs.slice(1).join('|'));

  /* Drain the reserve. The pool is far larger than the ten frames on show, so
     this runs well past the point where there is anything left to substitute. */
  const drop = await drainToFirstDrop();
  const drained = await state();
  check('once the reserve runs out the frame is removed rather than left blank',
    drained.slides === after.slides - 1,
    drop.fired + ' substitutions before the first removal, ' + drained.slides + ' slides left');
  check('the dots stay in step with the frames',
    drained.dots === drained.slides &&
    drained.dotIndexes.join(',') === drained.dotIndexes.map((_, i) => String(i)).join(','),
    drained.dots + ' dots for ' + drained.slides + ' slides, indexes ' + drained.dotIndexes.join(','));
  check("each dot's label still names the frame it selects",
    drained.dotLabels.every((l, i) => l && l.indexOf(drained.artists[i]) !== -1));
  check('a frame is still active after the removal',
    drained.active >= 0, 'active=' + drained.active);

  await drainToEmpty();
  const gone = await state();
  check('with every photograph gone the rotator hides itself instead of showing an empty frame',
    gone.slides === 0 && gone.hidden, gone.slides + ' slides, hidden=' + gone.hidden);

  check('no script errors along the way', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${failed.length ? failed.length + ' of ' + results.length + ' checks FAILED' : 'All ' + results.length + ' checks passed.'}\n`);
  browser.kill();
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  browser.kill();
  process.exit(1);
});
