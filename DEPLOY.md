# Deploying davidconger.com

The site has always been published by dragging files into an FTP client. That
works, but there is no record of what was deployed, no way to roll back, and
nothing stopping a half-finished upload from going live. This note describes the
deploy path that now exists, and what it would take to do better.

## What the site actually is

Measured after the phase 1 purge:

| | Files | Size |
|---|---:|---:|
| Photographs (`.jpg`) | 43,041 | 5,306 MB |
| Pages (`.htm`) | 9,599 | 44 MB |
| CSS, JS, icons, config | 417 | 4 MB |
| **Total** | **53,057** | **5,355 MB** |

Two facts follow from that table, and they drive everything below.

**The photographs are 99% of the bytes and almost none of the churn.** A typical
change touches markup. Re-uploading 5.3 GB to publish a stylesheet edit is not a
deployment strategy.

**The B1 plan provides 10 GB of disk.** The site is at roughly 5.4 GB locally,
and the server additionally still holds the FrontPage cruft that phase 1 removed
here, so actual usage is higher. Every event adds more. This is the constraint
that eventually forces a decision.

## What exists now

`.github/workflows/deploy.yml` deploys over FTPS from GitHub Actions.

- **Manual trigger only**, with a `dry-run` input that defaults to on. Nothing
  deploys unless someone asks for it, and the first thing they see is a list of
  what would change.
- **Only tracked files are shipped** — the ~48 MB of markup, CSS, JS and icons.
  `*.jpg` is excluded, so the sync never sees the photographs as "missing
  locally" and can never delete them from the server.
- **Three gates run before the upload:** `web.config` must parse, `sitemap.xml`
  must parse with the correct namespace and more than 8,000 URLs, and
  `check-links.js --max-broken 4100` must pass.

That last gate deserves an explanation. The site carries about 4,068 broken
references, nearly all of them inside archived trees whose relative paths broke
when they were moved years ago. Zero is not a reachable bar, so the gate checks
that a change has not made things *worse* — which is exactly the failure mode of
a bad bulk edit across 9,597 pages.

### Setting it up

Download the publish profile from the portal (davidconger -> Overview -> Get
publish profile) and copy the FTP entry's values into repository secrets:

| Secret | Value |
|---|---|
| `AZURE_FTP_SERVER` | `ftps://waws-prod-...ftp.azurewebsites.windows.net/site/wwwroot/` |
| `AZURE_FTP_USERNAME` | `davidconger\$davidconger` |
| `AZURE_FTP_PASSWORD` | from the publish profile |

Run it once with dry-run on and read the log before running it for real.

### New photographs

Images are not in git and are not deployed by the workflow. Publishing an event
is still: generate it with `tools/new-gallery.js`, upload that one folder over
FTP, then commit and deploy the markup. The workflow will pick up the new pages;
the JPEGs go up once, by hand.

## Why not zip deploy

`az webapp deploy` and `WEBSITE_RUN_FROM_PACKAGE` are the modern answer, and
both give atomic, revertible deploys. Neither is usable while the photographs
live in `wwwroot`:

- the deployment package would have to contain all 5.3 GB, since anything not in
  the package is gone after the swap;
- `WEBSITE_RUN_FROM_PACKAGE` makes the content root read-only, so FTP-uploading
  a new event afterwards stops working.

Zip deploy becomes the obvious choice the moment the images move out — not
before.

## The change that actually helps: split storage from markup

Move the photographs to **Azure Blob Storage** and serve them through **Azure
Front Door**, routing on path:

    /galleries/**/*.jpg   -> blob storage
    /you/**/*.jpg         -> blob storage
    everything else       -> the existing App Service

Every public URL stays byte-for-byte identical, which is the hard requirement
for a 16-year archive full of external links. No redirects are involved.

What it buys:

- **The disk ceiling disappears.** App Service holds ~50 MB instead of 5.4 GB.
- **Storage gets cheaper.** Blob hot storage is a fraction of a cent per GB-month;
  5.3 GB is a rounding error next to the B1 plan itself.
- **Images get a real cache policy.** They are immutable once published, so they
  can carry a one-year `Cache-Control` at the edge instead of the one-day policy
  `web.config` currently applies to everything.
- **Zip deploy becomes possible**, and with it atomic deploys and one-click
  rollback.
- **Static Web Apps becomes possible** for the markup — free tier, global
  distribution, built-in CI/CD, free managed certificates — because the content
  is then well inside its size limits.

The migration is a one-time `azcopy` of the two image trees, then a Front Door
rule. It is reversible: leave the images in place on App Service until the
routing is proven.

## Worth checking regardless

The app runs under a **Visual Studio Enterprise subscription**. Those carry a
capped monthly credit and are licensed for development and testing rather than
production workloads. If the credit runs out, resources are disabled until the
next cycle — for a public site that is an availability risk, and it may explain
past trouble reaching the portal. Moving to pay-as-you-go costs roughly the same
at this scale (B1 is about $13/month) and removes the exposure.

Also unconfigured today: **Health Check**, and **HTTPS-Only** needs confirming.
`web.config` has HSTS ready but commented out; enable it only after HTTPS-Only
is on and both custom domains have valid certificates, because HSTS is difficult
to walk back once browsers have cached it.

## Rollback

Markup is in git, so `git revert` followed by a deploy restores any previous
state. `web.config` is the one file that can take the whole site down with a 500
if it is wrong; deleting it returns IIS to its default behaviour and the site
keeps serving.
