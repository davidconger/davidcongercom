# Samples the colour of the region a caption overlay will cover, so the overlay
# can be tinted to the photograph behind it at build time rather than with
# client-side canvas work (which would flash, cost CPU and need CORS).
#
#   powershell -File tools/sample-overlay-colors.ps1 -JobFile jobs.json -OutFile out.json
#
# JobFile is a JSON array of image paths. OutFile receives one record per image:
#
#   { "path": "...", "top": [r,g,b], "bottom": [r,g,b], "lum": 0.31 }
#
# top/bottom are the mean colours of the upper and lower halves of the crop, so
# the caller can build a vertical gradient rather than a flat fill. The crop is
# the bottom-right of the frame, which is where the caption sits and where the
# davidconger.com watermark is burned in.

param(
    [Parameter(Mandatory = $true)][string]$JobFile,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [double]$CropTop = 0.78,
    [double]$CropLeft = 0.28
)

Add-Type -AssemblyName System.Drawing

$paths = Get-Content -Raw -LiteralPath $JobFile | ConvertFrom-Json
$results = New-Object System.Collections.ArrayList
$failed = 0

# 16x4 is enough: the point is a mean, and letting the bicubic resampler do the
# averaging is far faster than walking a few hundred thousand pixels per image.
$cols = 16
$rows = 4

foreach ($p in $paths) {
    try {
        $img = [System.Drawing.Image]::FromFile($p)
    } catch {
        $failed++
        continue
    }

    try {
        $x = [int]($img.Width * $CropLeft)
        $y = [int]($img.Height * $CropTop)
        $w = $img.Width - $x
        $h = $img.Height - $y
        if ($w -lt 1) { $w = 1 }
        if ($h -lt 1) { $h = 1 }

        $bmp = New-Object System.Drawing.Bitmap $cols, $rows
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.DrawImage($img,
            (New-Object System.Drawing.Rectangle 0, 0, $cols, $rows),
            (New-Object System.Drawing.Rectangle $x, $y, $w, $h),
            [System.Drawing.GraphicsUnit]::Pixel)
        $g.Dispose()

        $lr = 0; $lg = 0; $lb = 0; $ln = 0
        $rr = 0; $rg = 0; $rb = 0; $rn = 0
        for ($cx = 0; $cx -lt $cols; $cx++) {
            for ($cy = 0; $cy -lt $rows; $cy++) {
                $c = $bmp.GetPixel($cx, $cy)
                if ($cy -lt ($rows / 2)) {
                    $lr += $c.R; $lg += $c.G; $lb += $c.B; $ln++
                } else {
                    $rr += $c.R; $rg += $c.G; $rb += $c.B; $rn++
                }
            }
        }
        $bmp.Dispose()

        $top = @([int]($lr / $ln), [int]($lg / $ln), [int]($lb / $ln))
        $bottom = @([int]($rr / $rn), [int]($rg / $rn), [int]($rb / $rn))
        $mr = ($top[0] + $bottom[0]) / 2
        $mg = ($top[1] + $bottom[1]) / 2
        $mb = ($top[2] + $bottom[2]) / 2
        $lum = (0.2126 * $mr + 0.7152 * $mg + 0.0722 * $mb) / 255

        [void]$results.Add([pscustomobject]@{
            path   = $p
            top    = $top
            bottom = $bottom
            lum    = [math]::Round($lum, 4)
            width  = $img.Width
            height = $img.Height
        })
    } finally {
        $img.Dispose()
    }
}

$json = $results | ConvertTo-Json -Depth 4 -Compress
[IO.File]::WriteAllText($OutFile, $json, (New-Object Text.UTF8Encoding $false))
Write-Host "sampled $($results.Count) image(s), $failed failed"
