/**
 * Batch horizontal-overflow scan.
 *
 * layout-probe.js starts a browser per page, which is fine for one page and
 * far too slow for a few hundred. This drives one browser through a list of
 * URLs and reports only the ones that scroll sideways, with the widest element
 * responsible for each.
 *
 * Usage:
 *   node tools/overflow-scan.js <listFile> [width] [--json out.json]
 *
 * listFile holds one site-relative path per line, e.g. festivals/2012/watershed.htm
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const listFile = process.argv[2];
const width = parseInt(process.argv[3] || '390', 10);
const jsonIdx = process.argv.indexOf('--json');
const ORIGIN = 'http://localhost:8099/';

if (!listFile) {
  console.error('Usage: node tools/overflow-scan.js <listFile> [width] [--json out.json]');
  process.exit(1);
}

const paths = fs.readFileSync(listFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!EDGE) { console.error('Microsoft Edge not found'); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-scan-'));
const PORT = 9800 + Math.floor(Math.random() * 190);

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${width},900`, 'about:blank',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MEASURE = `
  (() => {
    const vw = document.documentElement.clientWidth;
    let worst = null;
    document.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && (!worst || r.right > worst.right)) {
        worst = {
          tag: el.tagName.toLowerCase(),
          cls: (typeof el.className === 'string' ? el.className : '') || '',
          style: (el.getAttribute('style') || '').slice(0, 90),
          width: Math.round(r.width),
          right: Math.round(r.right)
        };
      }
    });
    return JSON.stringify({
      viewport: vw,
      scrollWidth: document.documentElement.scrollWidth,
      worst
    });
  })()
`;

async function main() {
  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await res.json();
      if (targets && targets.length) break;
    } catch { /* not ready */ }
    await sleep(250);
  }
  if (!targets || !targets.length) throw new Error('DevTools endpoint never became ready');

  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  let loaded = false;

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      return;
    }
    if (msg.method === 'Page.loadEventFired') loaded = true;
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await new Promise((r) => ws.addEventListener('open', r));
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width, height: 900, deviceScaleFactor: 1, mobile: width < 600,
  });

  const bad = [];
  for (let i = 0; i < paths.length; i++) {
    loaded = false;
    await send('Page.navigate', { url: ORIGIN + paths[i] });
    for (let w = 0; w < 40 && !loaded; w++) await sleep(50);
    await sleep(120);

    let data;
    try {
      const { result } = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
      data = JSON.parse(result.value);
    } catch {
      continue;
    }
    if (data.scrollWidth > data.viewport) {
      bad.push({ path: paths[i], scrollWidth: data.scrollWidth, worst: data.worst });
      console.log(`  ${paths[i]}  ${data.scrollWidth}px  <${data.worst.tag}${data.worst.cls ? '.' + data.worst.cls.split(' ')[0] : ''}> ${data.worst.style}`);
    }
    if ((i + 1) % 100 === 0) console.error(`  ...${i + 1}/${paths.length} scanned, ${bad.length} overflowing`);
  }

  console.log(`\n  scanned    : ${paths.length} at ${width}px`);
  console.log(`  overflowing: ${bad.length}`);
  if (jsonIdx > -1 && process.argv[jsonIdx + 1]) {
    fs.writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(bad, null, 2));
    console.log(`  report     : ${process.argv[jsonIdx + 1]}`);
  }

  ws.close();
  browser.kill();
  process.exit(0);
}

main().catch((err) => { console.error(err); browser.kill(); process.exit(1); });
