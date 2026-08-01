# Rebuilds a sandbox of representative pages from every era, runs the
# modernizer over it, and reports what legacy markup (if any) survives.
#
#   powershell -File tools\sandbox-check.ps1
#
# The sandbox mirrors the real directory depth so that the site.css path the
# transform computes is exercised exactly as it would be in production.

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$sb = Join-Path $env:TEMP 'dc-sandbox'
Remove-Item $sb -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $sb | Out-Null

# A fixed spine of known-interesting pages, plus a random spread across every
# year so that markup drift we have not catalogued still gets sampled.
$pages = [System.Collections.Generic.List[string]]::new()
@(
  'index.htm', 'about.htm', 'catalog/index.htm', 'you/index.htm',
  'galleries/featured.htm',
  'galleries/2019/12/deadmau5/index.htm',
  'galleries/2012/03/dariusrucker/index.htm',
  'galleries/2011/10/journey/index.htm',
  'you/!template/2024/gallery.htm'
) | ForEach-Object { if (Test-Path $_) { $pages.Add((Resolve-Path $_).Path) } }

foreach ($dir in @('galleries', 'you')) {
  Get-ChildItem $dir -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d{4}$' } |
    ForEach-Object {
      Get-ChildItem $_.FullName -Recurse -Include *.htm -File |
        Get-Random -Count 3 -ErrorAction SilentlyContinue |
        ForEach-Object { $pages.Add($_.FullName) }
    }
}

$pages = $pages | Sort-Object -Unique
foreach ($f in $pages) {
  $rel = $f.Substring($root.Length + 1)
  $dest = Join-Path $sb $rel
  New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
  Copy-Item $f $dest
}
Write-Host "sandbox: $($pages.Count) pages" -ForegroundColor Cyan

node tools\modernize.js $sb --write

$total = $pages.Count
Write-Host "`n=== legacy markup that survived ===" -ForegroundColor Cyan
$dead = @(
  'connect\.facebook\.net', 'platform\.twitter\.com', 'plusone',
  'assets\.pinterest\.com/js', 'sitemeter', 'aspnetcdn', 'jquery',
  'js/galleries\.js', 'fbpublish', 'fb-root', 'fb:like', 'shareWide',
  'shareTall', 'data-original', 'class="lazy"', 'XHTML', 'http-equiv',
  'Copyright 2008-20(0|1|2[0-5])', 'twitter-share-button',
  'twitter\.com/#!', 'css/all\.css', 'css/core\.css', 'css/galleries\.css',
  'catalog\.css', 'text/javascript', 'davidconger\.com/images/header\.png'
)
$bad = 0
foreach ($p in $dead) {
  $hits = Get-ChildItem $sb -Recurse -Include *.htm -File | Select-String -Pattern $p -List
  if ($hits) { $bad++; "  {0,5}  {1}" -f $hits.Count, $p; $hits | Select-Object -First 2 | ForEach-Object { "          $($_.Path.Replace($sb,''))" } }
}
if ($bad -eq 0) { Write-Host '  none' -ForegroundColor Green }

Write-Host "`n=== required markup ===" -ForegroundColor Cyan
foreach ($p in @('<!DOCTYPE html>', '<html lang="en">', 'name="viewport"', 'css/site\.css', 'Copyright 2008-2026', 'charset="utf-8"')) {
  $n = (Get-ChildItem $sb -Recurse -Include *.htm -File | Select-String -Pattern $p -List).Count
  $color = if ($n -eq $total) { 'Green' } else { 'Red' }
  Write-Host ("  {0,5}/{1}  {2}" -f $n, $total, $p) -ForegroundColor $color
}

Write-Host "`n=== images still missing alt ===" -ForegroundColor Cyan
node tools\audit-alt.js $sb

Write-Host "`n=== idempotency (must report 0) ===" -ForegroundColor Cyan
node tools\modernize.js $sb --dry-run
