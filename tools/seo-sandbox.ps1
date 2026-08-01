# Copies a spread of pages from every era into a sandbox, runs seo-pass.js
# there, and prints the generated <title> and description for each so the
# wording can be eyeballed before the change is made to the real site.
#
# Markup drifted a lot between 2009 and 2026, so a sample from a single year
# proves nothing.

$ErrorActionPreference = 'Stop'
$site = Split-Path -Parent $PSScriptRoot
$sandbox = Join-Path $env:TEMP 'dc-seo-sandbox'

if (Test-Path $sandbox) { Remove-Item $sandbox -Recurse -Force }
New-Item -ItemType Directory -Path $sandbox -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $sandbox 'tools') -Force | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'seo-pass.js') (Join-Path $sandbox 'tools')

$samples = New-Object System.Collections.ArrayList

# One event index and one photo page from each /you/ year.
foreach ($year in (Get-ChildItem (Join-Path $site 'you') -Directory | Where-Object { $_.Name -match '^\d{4}$' })) {
    $event = Get-ChildItem $year.FullName -Directory | Select-Object -First 1
    if (-not $event) { continue }
    $idx = Join-Path $event.FullName 'index.htm'
    if (Test-Path $idx) { [void]$samples.Add($idx) }
    $photo = Get-ChildItem $event.FullName -Recurse -Filter '*-01.htm' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($photo) { [void]$samples.Add($photo.FullName) }
}

# One concert gallery per year.
foreach ($year in (Get-ChildItem (Join-Path $site 'galleries') -Directory | Where-Object { $_.Name -match '^\d{4}$' })) {
    $g = Get-ChildItem $year.FullName -Recurse -Filter 'index.htm' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($g) { [void]$samples.Add($g.FullName) }
}

# Hand-authored and listing pages, which must come through untouched or nearly so.
foreach ($p in 'index.htm', 'about.htm', 'bydate.htm', 'byartist.htm', 'catalog/index.htm', 'you/index.htm') {
    $full = Join-Path $site $p
    if (Test-Path $full) { [void]$samples.Add($full) }
}

foreach ($s in $samples) {
    $rel = $s.Substring($site.Length).TrimStart('\')
    $dst = Join-Path $sandbox $rel
    New-Item -ItemType Directory -Path (Split-Path $dst) -Force | Out-Null
    Copy-Item $s $dst
}

Write-Host "sandbox: $($samples.Count) pages from $((Get-ChildItem (Join-Path $site 'you') -Directory).Count) /you/ years and every gallery year"
Write-Host ""

Push-Location $sandbox
try {
    node tools/seo-pass.js
    Write-Host ""
    Write-Host "=== generated metadata ==="
    Get-ChildItem $sandbox -Recurse -Filter '*.htm' | Sort-Object FullName | ForEach-Object {
        $t = [IO.File]::ReadAllText($_.FullName)
        $rel = $_.FullName.Substring($sandbox.Length).TrimStart('\').Replace('\', '/')
        $title = [regex]::Match($t, '(?s)<title[^>]*>(.*?)</title>').Groups[1].Value.Trim()
        $desc = [regex]::Match($t, '<meta\s+name="description"\s+content="([^"]*)"').Groups[1].Value
        Write-Host ""
        Write-Host "  $rel"
        Write-Host "    title: $title"
        if ($desc) { Write-Host "    desc : $desc" } else { Write-Host "    desc : (none)" }
    }

    Write-Host ""
    Write-Host "=== idempotence ==="
    node tools/seo-pass.js
}
finally { Pop-Location }
