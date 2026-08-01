# Fails loudly if any file in the tree is a OneDrive Files On-Demand
# placeholder.
#
# Dehydrated files and folders can enumerate as empty and are invisible to
# `git add`, which is how a previous cleanup pass deleted three live content
# directories. Always run this before any bulk write or delete.
#
#   powershell -File tools\check-hydration.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

# FILE_ATTRIBUTE_OFFLINE | RECALL_ON_OPEN | RECALL_ON_DATA_ACCESS
$OFFLINE = 0x1000
$RECALL_OPEN = 0x40000
$RECALL_DATA = 0x400000
$mask = $OFFLINE -bor $RECALL_OPEN -bor $RECALL_DATA

$items = Get-ChildItem $root -Recurse -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\\\.git\\' }

$placeholders = $items | Where-Object { ([int]$_.Attributes -band $mask) -ne 0 }

Write-Host ("scanned    : {0:N0} items" -f $items.Count)
Write-Host ("placeholders: {0:N0}" -f $placeholders.Count)

if ($placeholders.Count -gt 0) {
  Write-Host "`nNOT SAFE TO WRITE - dehydrated entries found:" -ForegroundColor Red
  $placeholders | Select-Object -First 25 | ForEach-Object {
    "  {0}  [{1}]" -f $_.FullName.Replace("$root\", ''), $_.Attributes
  }
  Write-Host "`nRun this, wait for it to finish, then re-check:" -ForegroundColor Yellow
  Write-Host ('  attrib -U +P /s "' + $root + '\*"') -ForegroundColor Yellow
  exit 1
}

Write-Host "`nAll content is local. Safe to write." -ForegroundColor Green
exit 0
