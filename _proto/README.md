# `_proto/` — design prototypes

Nothing in this folder is live. It is a sandbox for trying out ideas against the
real archive before committing to them.

`_proto/**` is excluded from `sitemap.xml` (`tools/build-sitemap.js`) and from
the FTP deploy (`.github/workflows/deploy.yml`), so building a prototype cannot
leak onto the site or into search results.

---

## `stream/` — the year stream

A proposed replacement for the *browse* experience behind **Concert & Event
Photos**. Today that link goes to `catalog/index.htm`: a grid of 240x160
thumbnails, one per show, that you click through to reach a gallery. The
prototype replaces that landing step with the photographs themselves.

Clicking **Concert & Event Photos** would land on the current year. Each show is
a full 640px frame carrying the homepage-style caption — artist, venue, date —
newest first, two per row on a desktop and one per row on a phone. Year
navigation at the top walks back through the archive the same way the catalog
does.

### Try it

```powershell
node tools\build-stream.js --year 2019
# then open http://localhost:8099/_proto/stream/2019/
```

`2018`, `2019` and `2020` are checked in so the year navigation works in both
directions. Any year with galleries can be built.

### What the design decides

**Two columns, 1348px maximum.** The source photographs *are* 640x426 — that is
what the gallery generator produces — so two frames plus a 28px gutter is the
widest the grid can go without upscaling. Beyond 1348px the grid centres rather
than stretching. It collapses to a single column at 980px and the type scales
down again at 560px.

**No border, but real depth.** The homepage rotator reads as layered because the
photograph sits above a background bar. There is no such bar here, so the depth
comes from a two-part shadow: a tight `0 1px 2px` contact shadow plus a soft
`0 10px 26px` lift. The shadow is on the frame rather than the image, so it does
not fade during a crossfade.

**The rotator sits below the photograph.** Small dots, right-aligned under the
frame, never over the image. A show can carry 2-4 frames; a show with one frame
gets no dots at all. Clicks are handled by one delegated listener for the whole
page, because a busy year is eighty shows and eighty listeners is wasteful. The
markup works with JavaScript disabled — the first frame is already active and
every slide is a link into the gallery.

**Landscape frames only.** Mixing orientations inside a fixed-ratio frame would
make an entire row jump every time a rotator advanced. Pairing two portrait
frames side by side to fill one landscape slot is a good idea and is deliberately
left for later.

### The adaptive caption

This is the part that took the most iteration.

Every gallery image carries a burned-in `davidconger.com` watermark. Measured on
a 640x426 frame it occupies **x 73-99%, y 91-98%** — the bottom-right corner.
The caption panel's real job, beyond carrying the metadata, is to cover it. The
current site uses a flat grey for this; the prototype tints the panel to the
photograph instead.

`tools/sample-overlay-colors.ps1` samples the image **at build time** — no
canvas, no CORS, no flash of grey on load — and `build-stream.js` writes the
result into the page as three custom properties per show (`--cap-top`,
`--cap-bot`, `--cap-fg`).

Three attempts were needed:

1. **Horizontal gradient, 0.88 alpha.** The watermark bled through, and on shows
   with short captions it poked out past the left edge of the panel.
2. **0.95 alpha plus `min-width: 36%`.** The overhang was fixed, but the darkest
   frames still showed a ghost of the watermark.
3. **Vertical gradient, 0.78 to 0.99.** This is the one that works. The panel is
   translucent where it meets the photograph, so it reads as joined to the image
   rather than stuck on top of it, and fully opaque by the bottom edge — exactly
   where the watermark is. Sampling was switched from left/right halves to
   top/bottom halves to feed it.

The sampler crops to the caption's actual footprint (`-CropTop 0.82
-CropLeft 0.60`). Sampling wider than the panel covers pulls the tint toward
pixels the viewer can still see, which is what makes the join visible.

`captionFill()` then does two things to the sampled colour. It pulls it 35%
toward the mean of its own channels — without that, a single saturated stage
light produces a violently magenta caption — and then pushes it toward black or
white depending on the luminance of what it is covering. Text flips between
`#ffffff` and `#141414` to match.

### What the prototype does not cover

- Year navigation only spans the years actually built here, not the full archive.
- `--photos 3` is a guess at the right default.
- The stream has no `catalog/`-style "Festivals" or "By Date" alternate views.
- No portrait pairing.

### Open question

Whether the stream *replaces* `catalog/index.htm` or sits alongside it. The
recommendation is that the stream becomes the browse layer while the per-show
gallery pages stay exactly where they are: they are the indexable
artist/venue/date landing pages that bring people in from search, and every one
of their URLs must keep working regardless.

---

## Files

| File | Role |
|---|---|
| `stream/stream.css` | The whole visual design |
| `stream/stream.js` | Rotator: delegated click, arrow keys, focus management |
| `stream/advance-rotators.js` | Test hook — advances every rotator by one frame for screenshots, via `layout-probe.js --eval` |
| `stream/<year>/index.htm` | Generated by `tools/build-stream.js` |
