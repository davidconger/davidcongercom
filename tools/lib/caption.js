/**
 * Caption tinting, shared by every page that puts a caption panel on a
 * photograph -- the year pages, the individual gallery pages and the home page
 * rotator.
 *
 * The caption's real job is covering the burned-in davidconger.com wordmark in
 * the bottom-right of every frame. A flat grey panel does that, but it reads as
 * a sticker. Sampling the photograph underneath and tinting the panel to match
 * is what makes it read as part of the picture, and doing it at build time
 * keeps the pages static: no canvas, no CORS, no flash of grey before the tint
 * lands.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/* The panel is a ramp rather than a flat fill because it has two jobs that pull
   against each other: let the photograph read through, and completely hide the
   wordmark. A single even alpha cannot do both. Running the ramp corner to
   corner separates them in space -- the top-left, where nothing is hiding,
   opens up, and the fill is solid by the time it reaches the mark.

   CAP_BOT must stay at 0.99 or above. That end of the ramp is the only thing
   masking the wordmark: the stylesheet's backdrop-filter helps but cannot be
   relied on, because any ancestor stacking context turns it into a silent
   no-op. At 0.96 the mark ghosts back -- a few percent of a white mark over a
   dark panel is still legible. */
const CAP_TOP = 0.5;
const CAP_BOT = 0.995;

/**
 * Measures the caption's own footprint on each frame: bottom 18%, right 40%.
 * Sampling a wider region than the panel actually covers pulls the tint toward
 * parts of the photograph the viewer can still see, which is exactly what makes
 * the join visible.
 *
 * @param {string[]} paths absolute paths to JPEGs
 * @returns {Map<string, {path: string, top: number[], bottom: number[], lum: number}>}
 */
function sampleColors(paths, { quiet = false } = {}) {
  if (!paths.length) return new Map();
  const jobFile = path.join(os.tmpdir(), `dc-sample-${process.pid}.json`);
  const outFile = path.join(os.tmpdir(), `dc-sample-out-${process.pid}.json`);
  fs.writeFileSync(jobFile, JSON.stringify(paths), 'utf8');
  try {
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, '..', 'sample-overlay-colors.ps1'),
      '-JobFile', jobFile, '-OutFile', outFile,
      '-CropTop', '0.82', '-CropLeft', '0.60'], { stdio: quiet ? 'ignore' : 'inherit' });
    const raw = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    return new Map((Array.isArray(raw) ? raw : [raw]).map((r) => [r.path, r]));
  } finally {
    for (const f of [jobFile, outFile]) if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

/**
 * Turns a sampled colour into a caption fill.
 *
 * Two problems to solve. A single saturated stage light produces a violently
 * coloured panel, so the chroma is capped -- but by scaling the spread rather
 * than washing every sample out by a fixed amount, which is what a flat
 * desaturation did. A muted photograph keeps its colour; only the extreme ones
 * are pulled back. The panel then moves toward black or white depending on what
 * it is covering, far enough to stay readable and no further.
 */
function captionFill(rgb, lum, alpha) {
  const MAX_CHROMA = 60;
  const mean = (rgb[0] + rgb[1] + rgb[2]) / 3;
  const dark = lum <= 0.5;
  const target = dark ? 0 : 255;
  const pull = dark ? 0.46 : 0.4;
  const spread = Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]);
  const damp = spread > MAX_CHROMA ? MAX_CHROMA / spread : 1;
  const c = rgb.map((v) => {
    const toned = mean + (v - mean) * damp;
    return Math.round(toned + (target - toned) * pull);
  });
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}

/**
 * The three custom properties a caption needs, as an object. Callers either
 * serialise them into a style attribute (the year and gallery pages, which are
 * generated) or carry them in JSON (the home page rotator, which swaps them at
 * runtime).
 */
function captionVars(sample) {
  if (!sample) return null;
  const lum = typeof sample.lum === 'number' ? sample.lum : 0.2;
  return {
    top: captionFill(sample.top, lum, CAP_TOP),
    bottom: captionFill(sample.bottom, lum, CAP_BOT),
    fg: lum <= 0.5 ? 'rgba(255,255,255,.88)' : 'rgba(17,17,17,.86)',
  };
}

/** The same three properties as an inline style attribute value. */
function captionStyle(sample) {
  const v = captionVars(sample);
  return v ? `--cap-top:${v.top};--cap-bot:${v.bottom};--cap-fg:${v.fg}` : '';
}

module.exports = { CAP_TOP, CAP_BOT, sampleColors, captionFill, captionVars, captionStyle };
