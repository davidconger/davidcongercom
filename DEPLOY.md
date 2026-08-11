# Deploying davidconger.com

The site has always been published by dragging files into an FTP client. That
works, but there is no record of what was deployed, no way to roll back, and
nothing stopping a half-finished upload from going live. This note describes the
deploy path that now exists, and what it would take to do better.

## Ground rule: deploys are authorized by the owner, every time

**Nothing reaches production without David asking for it.** Not a config tweak,
not a "safe" one-liner, not a re-run of something that worked yesterday. When
there is any doubt at all, do not deploy — ask.

This is enforced at three levels, and none of them may be weakened:

- `deploy.yml` is `workflow_dispatch` only. There is deliberately no `push:`
  trigger, so committing and pushing can never publish anything.
- `dry-run` defaults to on and `scope` defaults to `config-only`, so even an
  accidental run does nothing.
- The workflow uses the `production` environment, which is where a required
  reviewer can be added in GitHub if that extra gate is ever wanted.

Committing and pushing freely is fine and expected — that is how work is saved
and reviewed. The line is publication. Changes get tested locally first
(`node tools/serve.js`, then `layout-probe.js` / `smoke-test.js` against
`http://127.0.0.1:8099/`), and only then does David decide whether they ship.

The reason is on the record: an unattended `web.config` deploy took the whole
site down with a 500 on every extensionless URL, including the homepage. See
"If some URLs 500 and others are fine" under Rollback.

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

## What was on the server before the first deploy

*Historical — this is the baseline the first deploy was measured against. The
modernization has since shipped and all 14 smoke checks pass. Kept because it
explains why the first deploy was shaped the way it was.*

Nothing from the modernization had been deployed. Probing the live site showed
it was still entirely pre-modernization:

| Request | Live result | Meaning |
|---|---|---|
| `/css/site.css` | 404 | the consolidated stylesheet has never shipped |
| `/robots.txt` | 404 | never shipped |
| `/sitemap.xml` | 200, 1,738 URLs | the stale 2021 stub; the new one has 2,734 |
| `/galleries/2011/05/atrak/` | 403 | the folder exists but holds no `index.htm` |
| `/galleries/2011/05/atrak/atrak-01.jpg` | 200 | the photographs were re-filed years ago |
| `/you/` | 200 | `index.htm` is already a default document |

The last two lines matter. The photographs already sat at the paths the new
markup expects, and IIS already served `index.htm` for a directory request — so
the directory-form canonical URLs resolved as soon as the pages landed. The
403s were folders waiting for an `index.htm` that deploy supplied.

The first deploy was therefore the whole modernization at once, against a server
that had never seen any of it.

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

### The retired `/you/` pages will still be on the server

8,036 per-photo and pagination pages under `/you/` were deleted from the source
tree when the lightbox replaced them. Whether a deploy also deletes them from
the server depends on that sync-state file, and it is not worth relying on
either way, because it does not matter: **IIS runs its rewrite rules before it
looks for a file**, so `web.config` redirects those URLs whether or not the old
page is still sitting there.

That ordering is the whole reason the redirects can be trusted. It is also why
`tools/serve.js` applies the same rules before touching the file system — a
preview that served the old page instead of the redirect would be testing
something the live site does not do.

If they do linger, they are ~77 MB of files nothing can reach. Worth sweeping up
eventually, no hurry.

`tools/rewrite-sim.js` replays all 8,036 retired URLs through the rules as
written in `web.config` and checks each one lands on a page that exists, and on
a photograph that is really on it. Run it after any change to the rewrite rules.

### New photographs

The split is by what the image is for, not by its extension.

**Site furniture is in git and ships with the `images` scope**: the 240x160 grid
thumbnails under `you/**/thumbnail.jpg` and `catalog/`, and the page chrome under
`images/`. 3,110 files, 80 MB — 3,012 JPEG thumbnails plus 98 PNGs and GIFs of
page chrome. These change whenever a tool regenerates them, so they need a
deploy path.

**Photographs are not in git.** 5.3 GB of originals live on the server and in the
local OneDrive copy. Putting them in git would mean a 5.3 GB clone, a 5.3 GB
checkout on every CI run, and paying for LFS bandwidth to move bytes that never
differ. They stay out.

That exclusion is load-bearing. `**/*.jpg` in the full scope's exclude list is
what guarantees a deploy can never delete the archive, which is why the `images`
scope stages its payload separately with `git ls-files` rather than relaxing it.

#### Why GitHub Actions cannot publish the photographs

The runner checks out git. The originals are not in git. So no amount of
workflow work can make the Action publish them — whatever sends the
photographs has to run on a machine that actually holds them. That is not a
limitation of the pipeline, it is a direct consequence of the tier split, and
it is the right trade: the 80 MB that CI *can* reproduce is in git, and the
5.3 GB it cannot is handled separately.

#### `tools/sync-photos.js`

Replaces opening an FTP client and dragging a folder. It works out what the
server is missing by asking the live site — every photograph has a public URL,
so a `HEAD` request is an exact answer to "is this already up?". No FTP listing
of 80,000 files, no local state file to drift, nothing to seed on a first run.

Run it from the repository root, because the path argument is resolved against
the working directory. The three values come from the App Service publish
profile (Portal → davidconger → Overview → Download publish profile), from the
entry with `publishMethod="FTP"`: `publishUrl`, `userName`, `userPWD`. The same
values are in GitHub as repository secrets, but GitHub will not show a secret
again once it is saved, so the publish profile is the place to read them.

**Single-quote the username and password in PowerShell.** The username contains
a `$`, and inside double quotes PowerShell expands it as a variable — so
`"davidconger\$davidconger"` silently becomes `davidconger\` and every upload
fails to authenticate for a reason nothing reports. Backslash is not an escape
character in PowerShell; single quotes are the fix. The same applies to any
password containing `$`.

    $env:AZURE_FTP_SERVER   = 'waws-prod-ch1-011.ftp.azurewebsites.windows.net'
    $env:AZURE_FTP_USERNAME = 'davidconger\$davidconger'
    $env:AZURE_FTP_PASSWORD = '...'

    node tools/sync-photos.js you/2026/newevent --dry-run
    node tools/sync-photos.js you/2026/newevent

The variables live only in that PowerShell window and are gone when it closes,
which is the point — nothing is written to disk and nothing can reach git.

Properties worth knowing:

- **It only ever uploads.** There is no delete path in the script, so it carries
  the same guarantee the workflow gets from excluding `*.jpg`.
- **Re-running is free and safe.** Anything already up costs one `HEAD` and is
  skipped, so an interrupted run is resumed by repeating the command.
- **Failed uploads are retried up to three times.** Azure's FTP rejects the
  occasional `STOR` with a 550: measured at 0.9% over 1,388 uploads and 1.5% over
  1,874, scattered across events and hitting full-size photographs and
  thumbnails alike, with files *larger* than any failure going up fine in the
  same run. It is a server-side hiccup rather than anything about the file. curl
  is already given `--retry`, but that only covers what curl deems transient
  (timeouts, FTP 4xx, some HTTP 5xx); 550 is a permanent code to curl and was
  never retried, which is why this went unnoticed for so long. Errors that will
  read the same on the third attempt as the first — an unresolvable host, a
  rejected login, an unreadable local file — still fail immediately, so a
  mistyped password does not cost three times the wait on every file.
- **A 550 that survives the retries is a different problem.** Two files in
  `you/2009` failed identically across two runs and six attempts. A transient
  fault does not repeat like that; check whether something already occupies the
  remote path, by listing the directory over FTP and by uploading the same file
  beside it under another name.
- **It skips anything git tracks**, because those are the `images` scope's job
  and two publishers on one file is how files get clobbered.
- **The path argument is required**, so a mistyped invocation cannot start
  walking all 5.3 GB.
- It shells out to `curl` for FTPS, so `tools/` still has no npm dependencies.

Publishing an event is therefore: generate it with `tools/new-gallery.js`, run
`sync-photos.js` for that folder, then commit and deploy the markup.

#### Known backlog: what the server has never held

Converting `you_old/` into `/you/2009/`, `/you/2010/` and `/you/2011/` created 24
events at addresses the server has never had photographs for. The pages are
live; every image on them 404s. Measured with `--dry-run`:

| Scope | Missing | Size |
|---|---:|---:|
| `you/2009` | 404 | 27.4 MB |
| `you/2010` | 1,388 | 95.1 MB |
| `you/2011` | 1,874 | 165.9 MB |
| **total** | **3,666** | **288.4 MB** |

That turned out not to be the whole of it. Eleven of the 193 frames in the
homepage rotator were 404ing, and chasing why found the same fault in
`/galleries/`: 27 events across two months are live, their index pages answer
200, and not one of their photographs is on the server. Nothing about the site
showed it, because a gallery page with broken images still looks like a page.

Probing the first photograph of every folder that holds any — 3,358 folders,
32,245 photographs — puts the real figure at **59 folders and 2,153
photographs**:

| Tree | Folders | Photographs | |
|---|---:|---:|---|
| `you/2011` | 10 | 937 | `you_old` conversion |
| `you/2010` | 11 | 694 | `you_old` conversion |
| `you/2009` | 3 | 202 | `you_old` conversion |
| `galleries/2019` | 22 | 207 | never uploaded |
| `galleries/2018` | 7 | 78 | never uploaded |
| `you/2018` | 3 | 18 | never uploaded |
| `galleries/2016` | 2 | 15 | mostly the deliberately-404ed test galleries |
| `galleries/2012` | 1 | 2 | ditto |

Run `sync-photos.js` per tree, dry first. It decides what to send by asking the
live site, so re-running costs nothing and resumes where it stopped.

Worth re-probing after any bulk upload, and worth knowing that the count above
is folder-level: it asks whether a folder's first photograph is present, so a
folder that is only partly uploaded is not counted. `sync-photos.js` checks
every file and will catch those.

#### When to stop doing it this way

The B1 plan has a 10 GB disk and the archive is already 5.3 GB before the
server's own FrontPage cruft. Every event adds to it and nothing is ever
removed. The structural fix is to stop storing photographs on the App Service
disk at all — see "split storage from markup" below. Until then, watch the
quota; running out of disk on the plan that serves the site is a worse failure
than any deploy bug in this document.

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

### If some URLs 500 and others are fine

This happened on the first live `web.config`, and the shape of it points away
from the cause, so it is worth recognising.

Every URL with a file extension answered 200 — `/index.htm`, `/about.htm`,
`/css/site.css`, `/js/featured-images.json`. Every extensionless URL answered
500: `/`, `/you/`, every gallery directory, every missing page, and every
flat-gallery redirect, since those land on a directory. A site serving
`/index.htm` perfectly while `/` returns 500 is not a broken page and not a
broken rewrite rule. Files with extensions are served by the native static file
handler without ASP.NET being involved; extensionless URLs go through the
managed pipeline. So that split means **the ASP.NET application is failing to
start**, and only the requests that need it can show it.

The cause was `<location path=".well-known">`. ASP.NET reads every `<location>`
element in `web.config` during application startup and will not accept a path
whose segment begins with a dot. Do not add one back — the comment in
`web.config` says the same thing next to the code.

Two things make this harder to diagnose than it should be:

- `errorMode="Detailed"` does not help. The failure happens while configuration
  is still loading, so what comes back is ASP.NET's generic "Runtime Error"
  page, which names nothing.
- `<customErrors mode="Off">` does not help either, for the same reason — the
  setting is in the file that failed to load. That it changes nothing is itself
  the confirmation that the fault is in startup rather than in a request.

What did work was bisection: strip the file to the part known to be serving,
deploy, confirm the site returns, then add sections back until it breaks. A
`config-only` deploy is about forty seconds, so this costs minutes.
