# Renders a spread of pages at phone and desktop widths and reports only the
# ones that overflow horizontally or log errors.
#
#   powershell -File tools\probe-sweep.ps1 [baseUrl]
#
# Pages are chosen to cover every layout generation on the site, because markup
# drifted substantially between 2009 and 2026.

param([string]$BaseUrl = 'http://localhost:8099')

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$rels = [System.Collections.Generic.List[string]]::new()
@(
  'index.htm', 'about.htm', 'catalog/index.htm', 'you/index.htm',
  'galleries/featured.htm'
) | ForEach-Object { if (Test-Path $_) { $rels.Add($_) } }

# One gallery and one /you/ event per year, so every markup generation is hit.
foreach ($dir in @('galleries', 'you')) {
  Get-ChildItem $dir -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d{4}$' } |
    Sort-Object Name |
    ForEach-Object {
      $hit = Get-ChildItem $_.FullName -Recurse -Filter 'index.htm' -File -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($hit) { $rels.Add($hit.FullName.Substring($root.Length + 1).Replace('\', '/')) }
    }
}

$rels = $rels | Sort-Object -Unique
Write-Host "probing $($rels.Count) pages x 2 widths" -ForegroundColor Cyan

$bad = 0
foreach ($rel in $rels) {
  foreach ($w in @(390, 1280)) {
    $out = & node tools\layout-probe.js "$BaseUrl/$rel" $w 2>&1 | Out-String

    $overflow = $out -match '"overflows":\s*true'
    $errs = -not ($out -match 'Console errors: none')
    $fails = -not ($out -match 'Failed requests: none')

    if (-not ($overflow -or $errs -or $fails)) { continue }

    $bad++
    Write-Host "  FAIL @${w}px  /$rel" -ForegroundColor Red
    if ($overflow) {
      $sw = ([regex]'"scrollWidth":\s*(\d+)').Match($out).Groups[1].Value
      $tags = ([regex]'"(?:tag|cls)":\s*"([^"]+)"').Matches($out) |
        ForEach-Object { $_.Groups[1].Value } | Where-Object { $_ } | Select-Object -Unique
      Write-Host "      overflow: scrollWidth=$sw vs viewport=$w"
      Write-Host "      offenders: $($tags -join ', ')"
    }
    if ($errs) {
      ($out -split "`r?`n") | Select-String -Pattern '^\s+x ' | ForEach-Object { Write-Host "      err $_" }
    }
    if ($fails) {
      ($out -split "`r?`n") | Select-String -Pattern '^\s+! ' | ForEach-Object { Write-Host "      $_" }
    }
  }
}

if ($bad -eq 0) {
  Write-Host "`nAll pages fit their viewport, with no console errors or failed requests." -ForegroundColor Green
  exit 0
}
Write-Host "`n$bad failing page/width combinations." -ForegroundColor Red
exit 1
