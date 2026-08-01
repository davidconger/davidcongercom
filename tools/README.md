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
