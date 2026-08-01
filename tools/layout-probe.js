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

  const shotIdx = process.argv.indexOf('--shot');
  if (shotIdx > -1 && process.argv[shotIdx + 1]) {
    // Captured through CDP rather than --screenshot, because --window-size does
    // not reliably set the layout viewport in headless Edge and produces
    // misleading clipped images.
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
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
