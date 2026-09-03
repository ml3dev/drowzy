# Build drowzy-<version>.zip with forward-slash entry names (ZIP-spec compliant,
# Chrome Web Store compatible). Mirrors the file list in scripts/package.sh.
param([string]$Version)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not $Version) {
  $m = Get-Content 'manifest.json' -Raw | ConvertFrom-Json
  $Version = $m.version
}
$out = "drowzy-$Version.zip"
Remove-Item -Force $out -ErrorAction SilentlyContinue

$topFiles = @(
  'manifest.json','background.js','formcheck.js','icons.js',
  'popup.html','popup.css','popup.js',
  'sidepanel.html',
  'onboarding.html','onboarding.js',
  'changelog.html','changelog.js',
  'privacy-policy.html','privacy-policy.js',
  'LICENSE'
)
$dirs = @('_locales','icons')

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$fs = [System.IO.File]::Open((Join-Path (Get-Location) $out), [System.IO.FileMode]::CreateNew)
$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
$level = [System.IO.Compression.CompressionLevel]::Optimal

function Add-One($full, $entryName) {
  $entryName = $entryName -replace '\\','/'
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $full, $entryName, $level) | Out-Null
}

$base = (Get-Location).Path
foreach ($f in $topFiles) { Add-One (Join-Path $base $f) $f }
foreach ($d in $dirs) {
  Get-ChildItem -Path (Join-Path $base $d) -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($base.Length + 1)
    Add-One $_.FullName $rel
  }
}
$zip.Dispose(); $fs.Dispose()
Write-Output "wrote $out"
