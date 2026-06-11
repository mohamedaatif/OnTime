# Generates the PWA PNG icons (pastel clock) using System.Drawing.
# Run: pwsh ./tools/make-icons.ps1
Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force $out | Out-Null

function New-Icon([int]$size, [string]$path, [double]$clockScale) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # pastel pink gradient background
    $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
    $c1 = [System.Drawing.ColorTranslator]::FromHtml('#f9b4d2')
    $c2 = [System.Drawing.ColorTranslator]::FromHtml('#ffe2ef')
    $br = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $c1, $c2, 45.0
    $g.FillRectangle($br, $rect)

    # clock face
    $c = $size / 2.0
    $r = $size * $clockScale
    $white = [System.Drawing.Brushes]::White
    $g.FillEllipse($white, ($c - $r), ($c - $r), (2 * $r), (2 * $r))
    $rimPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#e26f9e')), ($size * 0.028)
    $g.DrawEllipse($rimPen, ($c - $r), ($c - $r), (2 * $r), (2 * $r))

    # hands: green minute (12 o'clock), pink hour (~4 o'clock)
    $greenPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#4f9e72')), ($size * 0.045)
    $greenPen.StartCap = 'Round'; $greenPen.EndCap = 'Round'
    $pinkPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#e26f9e')), ($size * 0.045)
    $pinkPen.StartCap = 'Round'; $pinkPen.EndCap = 'Round'
    $g.DrawLine($greenPen, $c, $c, $c, ($c - $r * 0.62))
    $g.DrawLine($pinkPen, $c, $c, ($c + $r * 0.46), ($c + $r * 0.27))
    $dot = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#e26f9e'))
    $dr = $size * 0.035
    $g.FillEllipse($dot, ($c - $dr), ($c - $dr), (2 * $dr), (2 * $dr))

    $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "wrote $path"
}

New-Icon 180 (Join-Path $out 'apple-touch-icon.png') 0.36
New-Icon 192 (Join-Path $out 'icon-192.png') 0.36
New-Icon 512 (Join-Path $out 'icon-512.png') 0.36
New-Icon 512 (Join-Path $out 'icon-maskable-512.png') 0.28   # extra padding for maskable safe zone
