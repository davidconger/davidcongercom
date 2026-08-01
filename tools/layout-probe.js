/**
 * Headless layout probe driven over the Chrome DevTools Protocol.
 *
 * Loads a page in Edge at a given viewport width and reports:
 *   - whether the document scrolls horizontally
 *   - which elements are actually wider than the viewport (the culprits)
 *   - console errors and failed network requests
 *
 * Node's built-in WebSocket is used, so this needs no npm packages.
 *
 * Usage: node tools/layout-probe.js <url> [width] [height]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const url = process.argv[2];
const width = parseInt(process.argv[3] || '390', 10);
const height = parseInt(process.argv[4] || '900', 10);

if (!url) {
  console.error('Usage: node tools/layout-probe.js <url> [width] [height]');
  process.exit(1);
}

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));

if (!EDGE) {
  console.error('Microsoft Edge not found');
  process.exit(1);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-probe-'));
const PORT = 9222 + Math.floor(Math.random() * 500);

const browser = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  `--window-size=${width},${height}`,
  'about:blank',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(pathname) {
  const res = await fetch(`http://127.0.0.1:${PORT}${pathname}`);
  return res.json();
}

async function main() {
  // Wait for the debugging endpoint to come up.
  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      targets = await getJson('/json/list');
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
  const failedRequests = [];

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
      consoleErrors.push(msg.params.exceptionDetails.text + ' ' +
        (msg.params.exceptionDetails.exception?.description || ''));
    }
    if (msg.method === 'Network.loadingFailed') {
      failedRequests.push(msg.params.requestId + ' ' + msg.params.errorText);
    }
    if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
      failedRequests.push(msg.params.response.status + ' ' + msg.params.response.url);
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
  await send('Network.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });

  await send('Page.navigate', { url });
  await sleep(4000);

  const expr = `
    (() => {
      const vw = document.documentElement.clientWidth;
      const wide = [];
      document.querySelectorAll('*').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > vw + 1 || r.right > vw + 1) {
          wide.push({
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            cls: (typeof el.className === 'string' ? el.className : '') || '',
            width: Math.round(r.width),
            left: Math.round(r.left),
            right: Math.round(r.right)
          });
        }
      });
      return JSON.stringify({
        viewport: vw,
        scrollWidth: document.documentElement.scrollWidth,
        overflows: document.documentElement.scrollWidth > vw,
        offenders: wide.slice(0, 25)
      }, null, 2);
    })()
  `;

  const { result } = await send('Runtime.evaluate', { expression: expr, returnByValue: true });

  console.log(`\n=== ${url} @ ${width}px ===`);
  console.log(result.value);

  // --eval runs a snippet in the page before the screenshot, so an interactive
  // state -- a rotator advanced, a menu opened -- can be captured rather than
  // only the state the page loads in. The value may be inline JavaScript or a
  // path to a .js file; prefer the file, because PowerShell strips embedded
  // double quotes when passing arguments to a native command and inline
  // snippets arrive silently corrupted.
  const evalIdx = process.argv.indexOf('--eval');
  if (evalIdx > -1 && process.argv[evalIdx + 1]) {
    const arg = process.argv[evalIdx + 1];
    const expression = /\.js$/i.test(arg) && fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg;
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true });
    if (r.exceptionDetails) {
      console.log('\n--eval threw: ' + (r.exceptionDetails.exception
        ? r.exceptionDetails.exception.description
        : r.exceptionDetails.text));
    }
    await new Promise((res) => setTimeout(res, 700));
  }

  // --hover moves a real pointer over the first element matching a selector.
  // CSS :hover cannot be triggered by a synthetic JavaScript event, so states
  // that depend on it are invisible to --eval; this dispatches through the
  // input pipeline instead, which does set :hover.
  const hoverIdx = process.argv.indexOf('--hover');
  if (hoverIdx > -1 && process.argv[hoverIdx + 1]) {
    const selector = process.argv[hoverIdx + 1];
    const { result } = await send('Runtime.evaluate', {
      expression: `(function () {
        var el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        var r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      }())`,
      returnByValue: true,
    });
    if (!result.value) {
      console.log('\n--hover: no element matched ' + selector);
    } else {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: result.value.x, y: result.value.y, buttons: 0,
      });
      await new Promise((res) => setTimeout(res, 900));
    }
  }

  const shotIdx = process.argv.indexOf('--shot');
  if (shotIdx > -1 && process.argv[shotIdx + 1]) {
    // Captured through CDP rather than --screenshot, because --window-size does
    // not reliably set the layout viewport in headless Edge and produces
    // misleading clipped images.
    //
    // --clip limits the capture to the viewport instead of the whole document,
    // which is what you want on a long lazy-loaded page: the images below the
    // fold have not been fetched, so a full-page capture is mostly empty boxes.
    //
    // The clip rectangle is in page coordinates, not viewport coordinates, so
    // it has to be offset by the current scroll position -- otherwise a --eval
    // snippet that scrolls the page is silently ignored by the capture.
    //
    // --zoom N magnifies through the capture's own scale factor, and --clip-sel
    // aims it at one element. Do NOT reach for a CSS transform to zoom instead:
    // a transform makes the element a stacking context, and backdrop-filter on
    // anything inside it then samples the backdrop of the whole group rather
    // than the siblings behind it. That silently disables the effect and makes
    // a glass panel look like a flat one -- an hour was lost to it once.
    const clip = process.argv.includes('--clip');
    const zoomIdx = process.argv.indexOf('--zoom');
    const zoom = zoomIdx > -1 ? Number(process.argv[zoomIdx + 1]) : 1;
    const selIdx = process.argv.indexOf('--clip-sel');
    let shotArgs = { format: 'png', captureBeyondViewport: true };
    if (selIdx > -1 && process.argv[selIdx + 1]) {
      const sel = JSON.stringify(process.argv[selIdx + 1]);
      const { result: box } = await send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelector(${sel});
          if (!el) { return null; }
          const r = el.getBoundingClientRect();
          const pad = 24;
          return {
            x: Math.max(0, r.left + window.scrollX - pad),
            y: Math.max(0, r.top + window.scrollY - pad),
            width: r.width + pad * 2,
            height: r.height + pad * 2,
          };
        })()`,
        returnByValue: true,
      });
      if (!box.value) {
        console.log('\n--clip-sel matched nothing: ' + process.argv[selIdx + 1]);
      } else {
        shotArgs = { format: 'png', clip: { ...box.value, scale: zoom } };
      }
    } else if (clip) {
      const { result: pos } = await send('Runtime.evaluate', {
        expression: '({x: window.scrollX, y: window.scrollY})',
        returnByValue: true,
      });
      shotArgs = {
        format: 'png',
        clip: { x: pos.value.x, y: pos.value.y, width: width / zoom, height: height / zoom, scale: zoom },
      };
    }
    const shot = await send('Page.captureScreenshot', shotArgs);
    fs.writeFileSync(process.argv[shotIdx + 1], Buffer.from(shot.data, 'base64'));
    console.log('\nScreenshot: ' + process.argv[shotIdx + 1]);
  }

  if (consoleErrors.length) {
    console.log('\nConsole errors:');
    consoleErrors.forEach((e) => console.log('  ! ' + e));
  } else {
    console.log('\nConsole errors: none');
  }

  const real404 = failedRequests.filter((f) => !/favicon/i.test(f));
  if (real404.length) {
    console.log('\nFailed requests:');
    [...new Set(real404)].forEach((f) => console.log('  ! ' + f));
  } else {
    console.log('Failed requests: none');
  }

  ws.close();
}

main()
  .catch((e) => {
    console.error('Probe failed:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    browser.kill();
    await sleep(300);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      /* profile cleanup is best effort */
    }
  });
