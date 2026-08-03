# Deploying davidconger.com

The site has always been published by dragging files into an FTP client. That
works, but there is no record of what was deployed, no way to roll back, and
nothing stopping a half-finished upload from going live. This note describes the
deploy path that now exists, and what it would take to do better.

## What the site actually is

Measured from the current tree:

| | Files | Size |
|---|---:|---:|
| Photographs (`.jpg`, untracked) | 43,014 | 5,292 MB |
| Pages (`.htm`) | 11,454 | 132.5 MB |
| CSS and JS | 70 | 0.5 MB |
| Icons and graphics | 113 | 1.7 MB |
| Other (config, XML, text) | 273 | 2.8 MB |
| **Tracked in git — the deploy payload** | **11,910** | **137.5 MB** |

Two facts follow from that table, and they drive everything below.

**The photographs are 97% of the bytes and almost none of the churn.** A typical
change touches markup. Re-uploading 5.3 GB to publish a stylesheet edit is not a
deployment strategy.

**The B1 plan provides 10 GB of disk.** The site is at roughly 5.4 GB locally,
and the server additionally still holds the FrontPage cruft that phase 1 removed
here, so actual usage is higher. Every event adds more. This is the constraint
that eventually forces a decision.

## What is on the server right now

Nothing from the modernization has been deployed. Probing the live site shows it
is still entirely pre-modernization:

| Request | Live result | Meaning |
|---|---|---|
| `/css/site.css` | 404 | the consolidated stylesheet has never shipped |
| `/robots.txt` | 404 | never shipped |
| `/sitemap.xml` | 200, 1,738 URLs | the stale 2021 stub; the new one has 2,734 |
| `/galleries/2011/05/atrak/` | 403 | the folder exists but holds no `index.htm` |
| `/galleries/2011/05/atrak/atrak-01.jpg` | 200 | the photographs were re-filed years ago |
| `/you/` | 200 | `index.htm` is already a default document |

The last two lines matter. The photographs already sit at the paths the new
markup expects, and IIS already serves `index.htm` for a directory request — so
the directory-form canonical URLs will resolve as soon as the pages land. The
403s are folders waiting for an `index.htm` this deploy supplies.

The first deploy is therefore the whole modernization at once, against a server
that has never seen any of it.

## What exists now

`.github/workflows/deploy.yml` deploys over FTPS from GitHub Actions.

- **Manual trigger only**, with a `dry-run` input that defaults to on and a
  `scope` input that defaults to `config-only`. Both defaults are the cautious
  choice, so an accidental run does nothing.
- **Only tracked files are shipped** — the 137.5 MB of markup, CSS, JS and icons.
  `*.jpg` is excluded, and the exclude list governs deletion as well as upload,
  so the sync can never delete the photographs from the server.
- **Three gates run before the upload:** `web.config` must parse, `sitemap.xml`
  must parse with the correct namespace and more than 2,400 URLs, and
  `check-links.js --skip-ext jpg,jpeg --max-broken 90` must pass.
- **A smoke test runs after a real upload** and fails the workflow if the site
  did not come back correctly.

The broken-reference gate deserves an explanation. The site carries about 108
broken references, nearly all of them inside archived trees whose relative paths
broke when they were moved years ago. The gate checks that a change has not made
things *worse* — which is exactly the failure mode of a bad bulk edit across
11,454 pages.

It runs with `--skip-ext jpg,jpeg`, and that is not a weakening of the check but
a consequence of where it runs. The workflow deploys from a git checkout, and
git does not track the photographs, so on a runner every `<img>` points at a
file that is not there: an unfiltered run reports about 48,500 broken references
and proves nothing. Filtered, it sees 69 — the page-to-page links, stylesheets
and scripts — and those are what a bulk markup edit actually breaks.

Run it unfiltered on a full local copy to check the image references too:

    node tools/check-links.js . --max-broken 140

### Setting it up

Download the publish profile from the portal (davidconger -> Overview -> Get
publish profile) and copy the FTP entry's values into repository secrets:

| Secret | Value |
|---|---|
| `AZURE_FTP_SERVER` | `ftps://waws-prod-...ftp.azurewebsites.windows.net/site/wwwroot/` |
| `AZURE_FTP_USERNAME` | `davidconger\$davidconger` |
| `AZURE_FTP_PASSWORD` | from the publish profile |

Paste the FTP endpoint exactly as the publish profile gives it. The action
itself wants a bare hostname and a separate remote path, so the workflow splits
the URL before handing it over — a bare hostname works too, and is assumed to
mean `/site/wwwroot/`.

### The first deploy, in five runs

`web.config` is the one file that can take the entire site down. Its rewrite
section carries a 747-entry map redirecting every pre-2012 gallery address to its
new home, and that section has never been executed by real IIS. If the URL
Rewrite module were unavailable, or the map were rejected, **every page would
answer 500**. So it goes up on its own and is verified in isolation, before
anything else can confuse the diagnosis.

It does not go up *first*, though, and the reason is worth writing down. The
server was measured before the first deploy:

    /galleries/akon.htm          200   the old flat page, still there
    /galleries/2011/05/akon/     403   the photographs are there, the page is not

Every redirect in the map points at an address of the second kind. The
photographs have lived under `YYYY/MM/` since 2012, but the `index.htm` that
makes each one a page is new work that has never been uploaded. Ship the config
before the content and all 747 of those long-published URLs would answer a 301
into a 403 for as long as the content upload takes. So the content goes first,
and the redirect map is switched on once it has somewhere to point.

`web.config` and `404.htm` are excluded from the `full` scope precisely so this
ordering is possible - see `.github/deploy-exclude.txt`.

| # | `scope` | `dry-run` | What it proves |
|---|---|---|---|
| 1 | `config-only` | on | The gates pass and the FTPS credentials work. Uploads nothing. |
| 2 | `full` | on | The list of files about to change looks right, and nothing is queued for deletion. |
| 3 | `full` | **off** | Every page and stylesheet is on the server. The redirect targets now exist. |
| 4 | `config-only` | **off** | IIS accepted the rewrite map. `web.config` and `404.htm` are the only files that moved. |
| 5 | `images` | on, then **off** | The tracked thumbnails and page images reach the server. |

Run 5 is last because it is the only one that is not urgent: until it runs, the
newly generated `/you/` thumbnails are referenced by pages that are already
live, so the archive grid will show gaps. Run it with `dry-run` on first and
confirm the log lists only files under `you/`, `catalog/` and `images/`.

Run 4 is the one that matters. It uploads two small files, waits, then runs:

    node tools/smoke-test.js https://www.davidconger.com \
      --only=home,redirect-issued,notfound,cache

- `redirect-issued` requests `/galleries/atrak.htm` and requires a 301 pointing
  at `/galleries/2011/05/atrak/`. That single request exercises the whole rewrite
  map and would catch a 500 immediately.
- `cache` confirms the new `Cache-Control` header is actually being applied to a
  photograph, which today has no cache header at all.

**If run 4 fails, delete `web.config` from the server over FTP.** IIS reverts to
its default behaviour instantly and the site keeps serving. Because the full
scope excludes the file, no later content deploy will put it back.

Note that the first run of any scope uploads without deleting: with no state
file on the server the action reports `Server Files: 0` and treats everything as
new. Deletions only become possible from the second run of that scope onward,
which is why run 2's empty delete list is worth confirming rather than assuming.

Run 3 runs the full ten-check smoke test, which additionally confirms the
stylesheet, `robots.txt` and the 2,734-URL sitemap all shipped, that a
directory URL resolves, that a long-published URL like
`/galleries/2019/12/deadmau5/index.htm` is untouched, and that `/you/` is up.
The `notfound` and `cache` checks may fail there, since they need the config
that run 4 has not yet shipped.

You can run that suite by hand at any time:

    node tools/smoke-test.js https://www.davidconger.com

### What happens to the old FrontPage files on the server

The action tracks what it has deployed in a sync-state file it keeps on the
server, one per scope: `.ftp-deploy-config-only.json`, `.ftp-deploy-full.json`
and `.ftp-deploy-images.json`. On the first run there is no such file, so it has
no record of the ~46,400 FrontPage files sitting in `wwwroot` and will not touch
them — it uploads the new tree alongside them. **Read the run 3 dry-run log
before running 4 to confirm this**; the log lists every delete it intends to
make, and on a first deploy that list should be empty.

The state files are deliberately separate. The action decides what to delete by
comparing the server's manifest against what is on disk, so a shared file would
mean an `images` run reading a manifest that lists the whole site, finding only
thumbnails locally, and concluding that every page had been deleted.

Clearing that cruft off the server is a separate, optional job. It is dead
weight against the 10 GB quota but it is not harmful, and it is safer done
deliberately than as a side effect of a deploy. Never use the action's
`dangerous-clean-slate` option to do it: that deletes everything on the server
*including excluded paths*, which here means all 5.3 GB of photographs.

### New photographs

The split is by what the image is for, not by its extension.

**Site furniture is in git and ships with the `images` scope**: the 240x160 grid
thumbnails under `you/**/thumbnail.jpg` and `catalog/`, and the page chrome under
`images/`. 3,012 files, 79 MB. These change whenever a tool regenerates them, so
they need a deploy path.

**Photographs are not in git and are never deployed.** 5.3 GB of originals live
on the server and in the local OneDrive copy. Publishing an event is still:
generate it with `tools/new-gallery.js`, upload that one folder over FTP, then
commit and deploy the markup. The workflow picks up the new pages, and the
`images` scope picks up the thumbnail; the full-size JPEGs go up once, by hand.

That exclusion is load-bearing. `**/*.jpg` in the full scope's exclude list is
what guarantees a deploy can never delete the archive, which is why the `images`
scope stages its payload separately with `git ls-files` rather than relaxing it.

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

There is a third API, though, and it is worth knowing about because it behaves
nothing like the other two. Kudu exposes **three** different things called zip
deployment and their deletion semantics differ completely:

| Endpoint | Deletes? |
|---|---|
| `az webapp deploy --type zip`, i.e. `/api/publish?type=zip` | Yes — OneDeploy defaults to `clean=true` and removes anything not in the zip |
| `/api/zipdeploy` | Sometimes — defaults to `clean=false` but still deletes files its own previous manifest recorded |
| `PUT /api/zip/site/wwwroot/` | **No.** It extracts over what is there and touches nothing else |

The last one is described in Kudu's own source as "more of a PATCH than a PUT",
and it is the only one that is safe here without moving the images first,
because it cannot delete the archive under any argument. It is the fallback if
FTPS proves unreliable:

    curl --fail-with-body -u "$KUDU_USER:$KUDU_PASSWORD" \
      -X PUT -H 'Content-Type: application/zip' --data-binary @site.zip \
      "https://davidconger.scm.azurewebsites.net/api/zip/site/wwwroot/"

What it gives up is the incremental sync: it ships the whole tree every time and
can never remove a file. For a site whose central constraint is "never delete
anything", that is a smaller loss than it sounds.

### If the deploy dies with ECONNRESET

The first live run failed like this, immediately after printing a correct
file-by-file plan:

    Making changes to 14559 files/folders to sync server state
    creating folder ".well-known/"
    Error: Client is closed because read ECONNRESET (data socket)

Nothing was wrong with the site or the credentials. On a first publish the
sync-state file does not exist yet; the action tries to `RETR` it anyway, the
server rejects the missing file, and the data socket is reset. The library
catches that as "this must be your first publish" without noticing that
`basic-ftp` has already marked the whole client dead, so the next command — the
first `MKD` — throws. A dry run never notices, because it issues no further
commands after the diff. This is
[issue #153](https://github.com/SamKirkland/FTP-Deploy-Action/issues/153) and
[#489](https://github.com/SamKirkland/FTP-Deploy-Action/issues/489).

The workflow now seeds an empty state file over FTPS before handing over to the
action, but only when that file is genuinely absent, so a real one is never
clobbered. An empty state means "the server holds nothing", which is what the
action already believed — it just reaches that conclusion without a failing
request. That step is also the diagnostic: it uses the same passive FTPS path,
so if it cannot write the file, the problem is the network or Azure and not the
library, and it says so and stops.

## The change that actually helps: split storage from markup

Move the photographs to **Azure Blob Storage** and serve them through **Azure
Front Door**, routing on path:

    /galleries/**/*.jpg   -> blob storage
    /you/**/*.jpg         -> blob storage
    everything else       -> the existing App Service

Every public URL stays byte-for-byte identical, which is the hard requirement
for a 16-year archive full of external links. No redirects are involved.

What it buys:

- **The disk ceiling disappears.** App Service holds ~138 MB instead of 5.4 GB.
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
if it is wrong; deleting it over FTP returns IIS to its default behaviour and the
site keeps serving. That is why it ships first and alone.

The gap in this story is that FTPS sync has no atomic unit: a revert is another
11,900-file upload, not a swap. Zip deploy fixes that, and zip deploy needs the
images out of `wwwroot` — which is the case for the storage split above.
