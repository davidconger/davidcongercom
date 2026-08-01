# Batch image resizer built on .NET System.Drawing, so it needs no npm packages
# and no ImageMagick install.
#
#   powershell -File tools\resize-images.ps1 -JobFile jobs.json
#
# The job file is a JSON array; one object per output image:
#
#   [ { "src": "...", "dst": "...", "width": 1280, "height": 854, "mode": "fit" } ]
#
#   mode "fit"   - scale to fit inside width x height, preserving aspect ratio
#   mode "cover" - scale and centre-crop to fill width x height exactly
#
# Jobs are batched into a single PowerShell invocation because process startup
# dominates the cost when generating a few hundred thumbnails.

param(
  [Parameter(Mandatory = $true)][string]$JobFile,
  [int]$Quality = 82
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object { $_.MimeType -eq 'image/jpeg' }
$encParams = New-Object System.Drawing.Imaging.EncoderParameters 1
$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
  [System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)

# EXIF orientation. Cameras record rotation as a tag rather than rotating the
# pixels, and System.Drawing does not apply it, so portrait shots would come out
# sideways without this.
$ORIENTATION_TAG = 0x0112
$rotations = @{
  2 = 'RotateNoneFlipX'; 3 = 'Rotate180FlipNone'; 4 = 'Rotate180FlipX'
  5 = 'Rotate90FlipX'; 6 = 'Rotate90FlipNone'; 7 = 'Rotate270FlipX'
  8 = 'Rotate270FlipNone'
}

function Convert-Image {
  param([string]$Src, [string]$Dst, [int]$W, [int]$H, [string]$Mode)

  $img = [System.Drawing.Image]::FromFile($Src)
  try {
    if ($img.PropertyIdList -contains $ORIENTATION_TAG) {
      $o = $img.GetPropertyItem($ORIENTATION_TAG).Value[0]
      if ($rotations.ContainsKey([int]$o)) {
        $img.RotateFlip([System.Drawing.RotateFlipType]::($rotations[[int]$o]))
        $img.RemovePropertyItem($ORIENTATION_TAG)
      }
    }

    if ($Mode -eq 'cover') {
      # Fill the box exactly, cropping whatever overflows on the long axis.
      $scale = [Math]::Max($W / $img.Width, $H / $img.Height)
      $sw = [int][Math]::Round($img.Width * $scale)
      $sh = [int][Math]::Round($img.Height * $scale)
      $outW = $W; $outH = $H
      $dx = [int](($W - $sw) / 2); $dy = [int](($H - $sh) / 2)
    } else {
      # Never upscale: a source smaller than the box is copied at its own size.
      $scale = [Math]::Min([Math]::Min($W / $img.Width, $H / $img.Height), 1.0)
      $outW = [int][Math]::Round($img.Width * $scale)
      $outH = [int][Math]::Round($img.Height * $scale)
      $sw = $outW; $sh = $outH; $dx = 0; $dy = 0
    }

    $bmp = New-Object System.Drawing.Bitmap($outW, $outH)
    try {
      $bmp.SetResolution(72, 72)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.CompositingQuality = 'HighQuality'
        $g.InterpolationMode = 'HighQualityBicubic'
        $g.SmoothingMode = 'HighQuality'
        $g.PixelOffsetMode = 'HighQuality'
        $g.DrawImage($img, $dx, $dy, $sw, $sh)
      } finally { $g.Dispose() }

      $dir = Split-Path $Dst -Parent
      if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
      $bmp.Save($Dst, $jpegCodec, $encParams)
    } finally { $bmp.Dispose() }
  } finally { $img.Dispose() }
}

$jobs = Get-Content $JobFile -Raw | ConvertFrom-Json
$n = 0
$failed = 0
foreach ($j in $jobs) {
  try {
    Convert-Image -Src $j.src -Dst $j.dst -W $j.width -H $j.height -Mode $j.mode
    $n++
    if ($n % 25 -eq 0) { Write-Host "  ...$n/$($jobs.Count)" }
  } catch {
    $failed++
    Write-Host "  FAILED $($j.src): $($_.Exception.Message)" -ForegroundColor Red
  }
}
Write-Host "  wrote $n image(s), $failed failed"
if ($failed -gt 0) { exit 1 }
exit 0
