# Make icons/icon16|32|48|128.png from icons/icon.svg. ASCII only (PowerShell 5.1 reads BOM-less files as ANSI).
# Run from the repo root:  powershell -ExecutionPolicy Bypass -File tools/make_icons.ps1
# How: headless Chrome draws the SVG at 512x512 on a transparent background, then System.Drawing scales it down.
param([string]$Chrome = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$svg = Join-Path $root 'icons\icon.svg'
if (-not $Chrome) {
  $Chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Chrome) { throw 'Chrome not found. Pass -Chrome <path to chrome.exe>.' }

# 1. Render the SVG at 512x512 with a transparent background
$work = Join-Path $env:TEMP 'peekstock-icons'
New-Item -ItemType Directory -Force $work | Out-Null
$page = Join-Path $work 'icon.html'
$big = Join-Path $work 'icon512.png'
$svgUrl = 'file:///' + ($svg -replace '\\', '/')
Set-Content -Path $page -Encoding ascii -Value "<!doctype html><style>html,body{margin:0;background:transparent}</style><img src=`"$svgUrl`" width=`"512`" height=`"512`">"
$args = @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--default-background-color=00000000', '--window-size=512,512', "--user-data-dir=$work\profile",
  "--screenshot=$big", ('file:///' + ($page -replace '\\', '/')))
$p = Start-Process -FilePath $Chrome -ArgumentList $args -PassThru -Wait -WindowStyle Hidden
if (-not (Test-Path $big)) { throw "Chrome did not write $big (exit $($p.ExitCode))" }

# 2. Scale down to each size with high-quality resampling
$src = [System.Drawing.Image]::FromFile($big)
foreach ($size in 16, 32, 48, 128) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($src, 0, 0, $size, $size)
  $out = Join-Path $root "icons\icon$size.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  "saved $out"
}
$src.Dispose()
