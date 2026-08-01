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
down again at 560px. Every band of the page — the top bar, the year, the grid —
shares that same frame, so nothing runs full-bleed to the browser edge.

**No border, but real depth.** The homepage rotator reads as layered because the
photograph sits above a background bar. There is no such bar here, so the depth
comes from a two-part shadow: a tight `0 1px 2px` contact shadow plus a soft
`0 10px 26px` lift. The shadow is on the frame rather than the image, so it does
not fade during a crossfade.

**The photograph advances; the caption navigates.** Clicking a picture brings up
the next picture — the obvious reading of a stack of frames — and the caption is
the way through to the gallery. The caption is the whole link target, but it
still has to read as a caption, so the only sign it gives is an underline
arriving under the artist's name on hover.

**The rotator sits below the photograph.** Small dots, right-aligned under the
frame, never over the image. A show can carry 2-4 frames; a show with one frame
gets no dots at all. Clicks are handled by one delegated listener for the whole
page, because a busy year is eighty shows and eighty listeners is wasteful. The
markup works with JavaScript disabled — the first frame is already active and
every caption is a link into the gallery.

**Landscape frames only.** Mixing orientations inside a fixed-ratio frame would
make an entire row jump every time a rotator advanced. Pairing two portrait
frames side by side to fill one landscape slot is a good idea and is deliberately
left for later.

**The caption names the venue, not the address.** "WaMu Theater", not "WaMu
Theater, Seattle, WA" — the city adds a line of text and no information anyone
browsing a year of Seattle concerts is short of. Getting the venue out of the
catalog descriptions is harder than it looks; see below.

### Chrome that gets out of the way

**The utility bar pins to the top.** Home and the social links stay reachable at
any scroll depth, which on a year of eighty shows is a long way from the top of
the page. It starts down beside the masthead it belongs to and travels up until
it pins, and it carries no fill on the way: an opaque bar would swallow the
masthead fifty pixels before the masthead reached the top of the window.

**The masthead collapses into it.** The handover happens the moment the name
itself starts to leave the frame, and what is left of the full masthead fades out
as the compact one arrives, so the two are never both on screen. The bar then
reads *David Conger Photography | Seattle, WA*, set at the same size as the year
beneath it, and is never just two anonymous controls.

**The year pins below it.** Photographs pass underneath a translucent, blurred
band rather than vanishing at a hard edge — the content stays continuous and the
chrome reads as floating above it. The band only raises its background once it
is actually pinned; before that it is just a line on the page. Pinned, the year
also steps down a size: it has stopped being the thing you are looking at and
become a marker, and the height it gives back goes to the photographs.

**The section header is four lines shorter than it was.** It used to be a title,
then "View: Festivals | By Date", then the year, then the adjacent years spelled
out as links. Now it is a year between two chevrons; the title said nothing the
photographs were not already saying. The Festivals and By Date views are dropped
for the moment; a collections model is the more interesting version of that idea.

**Home and the social icons are one set of monochrome line art** — a Fluent home
glyph on the left, Instagram, X, Facebook and mail on the right — drawn in
`currentColor` so they sit quietly in the bar and declare themselves only on
hover, by brand colour or by swapping to the filled cut of the same glyph. The
"Home" text link that used to sit there matched none of them. Flickr is gone. The
coloured PNG tiles they replaced were the loudest thing on the page.

### Motion

**One show changes at a time, every 3.2 seconds.** A page of eighty still frames
is inert, but eighty rotators all turning at once is a slot machine. So a single
show is picked at random and crossfaded to its next frame.

Excluded from the draw: anything scrolled out of view (tracked by
`IntersectionObserver` at a 0.5 threshold, so a show clipped by the fold does not
change while half hidden), the show under the pointer, anything holding keyboard
focus, and any rotator driven by hand within the last 20 seconds. The previous
pick is skipped while anything else is available, so the movement reads as
scattered rather than as one busy frame. `prefers-reduced-motion` turns the whole
thing off.

**Hovering one photograph steps the others back** to 62% — caption and rotator
included, since dimming only the image would leave the captions floating at full
strength. It is pure CSS via `.showGrid:hover .show:not(:hover)`; no JavaScript
is involved.

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

Four attempts were needed:

1. **Horizontal gradient, 0.88 alpha.** The watermark bled through, and on shows
   with short captions it poked out past the left edge of the panel.
2. **0.95 alpha plus `min-width: 36%`.** The overhang was fixed, but the darkest
   frames still showed a ghost of the watermark.
3. **Vertical gradient.** The panel became translucent where it met the
   photograph and fully opaque along the bottom edge, exactly where the watermark
   is, so it read as joined to the image rather than stuck on top of it.
   Sampling was switched from left/right halves to top/bottom halves to feed it.
4. **Diagonal gradient.** The watermark is not along the bottom edge, it is in
   the bottom-*right* corner, so the ramp now runs from the opposite corner. The
   translucent part of the panel is the top-left triangle — the part with no
   watermark behind it and, because the type is right-aligned, the least text
   over it. The panel also shrank from a 36% floor to 32%, which is as narrow as
   it can be and still reach the wordmark.

The current ramp runs **0.45 alpha at the top-left corner to 0.995 by 16%** along
the diagonal. Those two numbers are not interchangeable:

- The start is free. Nothing is hidden behind that corner, so it can stay light
  and let the photograph read through. That dissolve is what keeps the panel
  from reading as a label.
- **The end has no latitude at all.** An attempt to soften the panel by dropping
  the floor to 0.96 brought the wordmark straight back — a few percent of a
  bright mark transmitted over a dark panel is still perfectly legible. If the
  caption needs to feel lighter, take it out of the padding, the type or the
  tint, not out of the end of the ramp.
- **16% is set by the narrowest panel, not the average one.** Behind a short
  artist name the panel collapses to its 32% floor, and on a panel that narrow
  the wordmark starts about 20% along the diagonal. A more generous stop looks
  better on wide captions and fails on "deadmau5".

The sampler crops to the caption's actual footprint (`-CropTop 0.82
-CropLeft 0.60`). Sampling wider than the panel covers pulls the tint toward
pixels the viewer can still see, which is what makes the join visible.

`captionFill()` then does two things to the sampled colour. It **caps the
chroma** — scaling the channel spread down only when it exceeds a ceiling,
rather than washing every sample out by a fixed amount, so a muted photograph
keeps its colour and only a violently lit one gets pulled back — and then pushes
it toward black or white depending on the luminance of what it is covering. Text
flips between white and near-black to match, both at slightly under full
strength so the caption sits below the photograph in the visual order.

### Getting the venue out of the descriptions

Catalog descriptions read `Artist[, Tour], Venue, City, ST. Month D, YYYY`, so
the venue is third from last — except in the several hundred entries that omit
the city (`Ho Ngoc Ha, Snoqualmie Casino, WA`), where counting positions returns
the artist or, worse, the tour name.

So the venue names are learned from the corpus instead. Across all 4,822
descriptions, each name is counted in the city slot and in the venue slot; a name
that lands in the venue slot more often than the city slot is a venue. That
yields about 140 of them, and since venues repeat heavily over sixteen years —
Snoqualmie Casino appears 676 times — the malformed entries can then be resolved
by looking for a name the archive already knows.

Measured over the whole catalog: **0 entries** now return a state code, **31**
(0.6%) return a festival or tour name because the source names no venue at all,
and **51** (1.1%) return nothing because the description only ever gave a city.
Those last two are limits of the source data, not of the rule; a caption with no
venue simply omits the line.

### What the prototype does not cover

- Year navigation only spans the years actually built here, not the full archive.
- `--photos 3` is a guess at the right default.
- No replacement yet for the Festivals view that was dropped from the header; a
  collections model is the idea worth exploring there.
- No portrait pairing.
- 31 captions across the archive show a festival or tour name where the source
  description names no venue, and 51 show no venue line at all.

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
| `stream/stream.js` | Rotator, ambient motion, and the sticky-chrome state |
| `stream/advance-rotators.js` | Test hook — advances every rotator by one frame, via `layout-probe.js --eval` |
| `stream/scroll-past-header.js` | Test hook — scrolls past the masthead so the collapsed bar and pinned year can be captured |
| `stream/<year>/index.htm` | Generated by `tools/build-stream.js` |
