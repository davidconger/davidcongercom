# tools/

Maintenance scripts for davidconger.com. These are **development tools only** —
they are not part of the published site and do not need to be uploaded to Azure.

## check-links.js

Walks every `.htm`/`.html` page, resolves every local `href` / `src` /
`data-original` reference against the filesystem, and reports what is missing.

```bash
node tools/check-links.js . --json baseline-links.json
```

Why it exists: `.gitignore` deliberately excludes the ~80,000 `.jpg` originals,
so git cannot prove that a refactor kept image references intact. This script
closes that gap. Run it before and after any bulk change and compare the counts.

References are resolved the way a browser does (RFC 3986 §5.2.4) — excess `../`
segments are discarded at the site root rather than escaping above it, which
matters because many legacy pages use one `../` too many.

## analyze-links.js

Summarises a `check-links.js` JSON report: groups breakage by page location and
separates references inside dead trees from those on genuinely live pages.

```bash
node tools/analyze-links.js baseline-links.json
```

## diff-links.js

Diffs two `check-links.js` reports and prints what became **newly broken** and
what was fixed. This is the authoritative "did I break anything?" check — run it
after every phase. Ad-hoc greps have produced false negatives here; trust this
instead.

```bash
node tools/diff-links.js phase1-final.json phase2-links.json
```

## css-selector-diff.js

Compares the selector set of the pre-consolidation stylesheets against
`css/site.css`, so merging four files into one cannot silently drop a rule that
markup still depends on.

```bash
# extract the originals from git first, then:
node tools/css-selector-diff.js <dir-of-old-css> css/site.css
```

## asset-census.js

Counts how many pages reference each script and stylesheet, and names the
referencing pages for rarely-used assets so a deletion can be justified rather
than guessed at.

```bash
node tools/asset-census.js . --list-under 3
```

## layout-probe.js

Loads a page in headless Edge over the DevTools protocol and reports whether the
document scrolls horizontally, **which elements are wider than the viewport**,
plus console errors and failed requests. Optionally writes a screenshot.

Uses Node's built-in WebSocket, so it needs no npm packages.

```bash
node tools/serve.js . 8099          # in one shell
node tools/layout-probe.js "http://localhost:8099/index.htm" 390 900 --shot out.png
```

Screenshots are captured through the protocol rather than Edge's `--screenshot`
flag, because `--window-size` does not reliably set the layout viewport in
headless Edge and produces misleadingly clipped images.

## extract-featured.js

One-shot migration that pulled the hard-coded `imageArray` out of the old
`js/homerotate.js` into `js/featured-images.json`, dropping entries whose photo
no longer exists.

```bash
node tools/extract-featured.js js/homerotate.js js/featured-images.json
```

## fingerprint.js

Reports how many pages carry each legacy markup construct (XHTML doctype,
`http-equiv` metas, jQuery, Facebook/Twitter/Google+ widgets, `class="lazy"`,
missing viewport, and so on), plus the distribution of footer copyright years.

Run it before and after a bulk transform to prove a construct is actually gone
site-wide rather than merely gone from the pages you happened to look at.

```bash
node tools/fingerprint.js .
```

## modernize.js

The bulk transform behind the markup modernization. It is **idempotent** — a
second run over the same tree changes nothing — so it is safe to re-run after
adding a rule.

```bash
node tools/modernize.js . --dry-run
node tools/modernize.js . --write --filter galleries/
node tools/modernize.js . --write
```

Options: `--dry-run` / `--write`, `--limit N`, `--filter <substring>`,
`--show N` (print the first N transformed pages to stdout).

What it does, per page:

- XHTML 1.0 doctype and namespaced `<html>` → `<!DOCTYPE html>` +
  `<html lang="en">`
- `http-equiv` Content-Type/Content-Language → `<meta charset="utf-8">`
- inserts `<meta name="viewport">`
- collapses the three legacy stylesheet links into one `css/site.css`, with the
  depth recomputed **from the file's real location** — this also repairs pages
  whose stylesheet path was wrong to begin with
- removes jQuery, lazyload, scrollstop, `galleries.js`, `fbpublish.js`, and the
  Facebook / Twitter / Google+ / Pinterest / SiteMeter widgets
- `<img class="lazy" data-original="x.jpg">` → `<img src="x.jpg" loading="lazy"
  decoding="async">`
- removes `#fb-root` and the `.shareWide` / `.shareTallL` / `.shareTallR`
  overlays (nesting-aware, since those contain nested tables)
- adds `alt` text to the social profile icons and the site banner
- points the banner at the local copy instead of the hardcoded apex domain
- rewrites breadcrumb `href`s so the link text matches its destination
- strips the inline `<body style>` that duplicated `css/site.css`
- `defer`s `azureinsights.js`; drops `type="text/javascript"`
- sets the footer copyright to 2026, adding a footer to pages that lacked one

HTML fragments (`catalog/*/list.htm`, `you/!template/2024/eventitem.htm`) have no
`<head>`, so head-level rules skip them while the image and link rules still
apply.

## audit-breadcrumbs.js

Finds breadcrumb links whose visible text does not match where they actually
go. A crumb with one `../` too many still resolves to a real page, so
`check-links.js` reports it as healthy; only comparing text to destination
catches it.

```bash
node tools/audit-breadcrumbs.js .
```

## audit-alt.js

Lists `<img>` elements with no `alt` attribute, grouped by image with numbered
filenames collapsed, so the remaining gaps read as a short list rather than
thousands of individual pages.

```bash
node tools/audit-alt.js .
```

## check-hydration.ps1

**Run this before any bulk write or delete.**

Fails if any file in the tree is a OneDrive Files On-Demand placeholder.
Dehydrated folders can enumerate as empty and are invisible to `git add`, which
is how an earlier cleanup pass deleted three live content directories.

```powershell
powershell -File tools\check-hydration.ps1
```

## sandbox-check.ps1

Copies a spread of pages — a fixed spine of known-tricky ones plus a random
sample from every year — into a temp tree, runs `modernize.js` over it, and
asserts that no legacy markup survived, that the required markup is present on
every page, and that a second run is a no-op.

```powershell
powershell -File tools\sandbox-check.ps1
```

The sandbox mirrors the real directory depth, so the relative `css/site.css`
path the transform computes is exercised exactly as it would be in production.

## probe-sweep.ps1

Renders one gallery and one `/you/` event **per year** plus the hand-authored
pages, at 390px and 1280px, and reports only failures. Catches layout
regressions across markup generations that a single spot-check would miss.

```powershell
node tools/serve.js . 8099          # in one shell
powershell -File tools\probe-sweep.ps1
```

## serve.js

Minimal static server for previewing the site locally, with IIS-like directory →
`index.htm` fallback.

```bash
node tools/serve.js . 8099
```

## recover-from-live.js

Downloads missing files from `https://www.davidconger.com`, which is treated as
authoritative when a local file is lost.

```bash
node tools/recover-from-live.js <list-of-paths.txt>
```

## Baseline (2026-07-31, before any modernization work)

| Metric | Value |
|---|---:|
| Pages scanned | 9,759 |
| Local references | 283,112 |
| Broken references | 75,670 |
| — inside dead trees (`old/`, `_data/`, `you_old/`) | 75,304 |
| — **on genuinely live pages** | **366** |

The overwhelming majority of breakage is confined to archived copies whose
relative paths broke when they were moved into `old/` subfolders. Known genuine
issues on live pages include references to `posterous.png` (Posterous shut down
in 2013), two galleries with unescaped apostrophes in their paths
(`hell'sbelles`, `don't...`), and a handful of galleries that no longer exist.

## Progress against the baseline

| After | Pages | Broken refs | Newly broken |
|---|---:|---:|---:|
| Baseline | 9,759 | 75,670 | — |
| Phase 1 — purge FrontPage cruft | 9,759 | 73,807 | 22 |
| Phase 2 — CSS consolidation | 9,759 | 73,807 | 0 |
| Phase 3 — JavaScript cleanup | 9,759 | 73,807 | 0 |
| Phase 4/5 — markup modernization | 9,598 | 4,072 | **0** |

The large drop in phase 4/5 is mostly the deletion of 161 timestamped
`catalog/*/_data/index-old-*.htm` backups, which between them referenced tens of
thousands of thumbnails that no longer exist. The `.txt` files in those same
folders are the retired generator's source data and were kept.

Markup state after phase 4/5, from `fingerprint.js`:

| Construct | Before | After |
|---|---:|---:|
| Pages with a viewport meta | 4 | 9,589 |
| XHTML 1.0 doctype | 9,747 | 0 |
| `http-equiv` metas | 9,747 | 0 |
| jQuery + lazyload + scrollstop | 2,604 | 0 |
| Facebook SDK / Twitter / Google+ / Pinterest | ~2,100 | 0 |
| SiteMeter | 77 | 0 |
| Breadcrumbs pointing at the wrong page | 2,778 | 0 |
| Stylesheets | 5 | 1 |
| Script files | 15 | 2 |

The nine pages without a viewport meta are HTML fragments with no `<head>`.
