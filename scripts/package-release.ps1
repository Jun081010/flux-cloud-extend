<#
 * Build the shareable release zip that goes to the Desktop.
 *
 * Assembles into a staging folder:
 *   - extension/edge-mv3/    (Edge MV3 build)
 *   - extension/chrome-mv3/  (Chrome MV3 build)
 *   - scripts/               (Get-ExtensionId / install-native-host / setup-for-friend)
 *   - README-<install guide>.md (friend-facing quick start)
 *   - LICENSE / THIRD_PARTY_NOTICES.md
 *
 * Usage (from the project root):
 *   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-release.ps1
#>
[CmdletBinding()]
param(
    [string]$Version = '',
    [string]$DesktopDir = '',

    # Escape hatch for a deliberate FFmpeg upgrade. Do not use it to silence a
    # hash mismatch you cannot explain.
    [switch]$SkipFfmpegCheck
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

# This script must stay pure ASCII (PowerShell 5.1 mis-parses non-ASCII .ps1 files
# without a BOM), so the localized README filename is built from code points:
# U+5B89 U+88C5 U+8BF4 U+660E = "an zhuang shuo ming" (install guide).
$readmeName = 'README-' + [char]0x5B89 + [char]0x88C5 + [char]0x8BF4 + [char]0x660E + '.md'

if ([string]::IsNullOrWhiteSpace($DesktopDir)) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    if ([string]::IsNullOrWhiteSpace($desktop)) {
        $desktop = Join-Path $env:USERPROFILE 'Desktop'
    }
    $DesktopDir = $desktop
}

if ([string]::IsNullOrWhiteSpace($Version)) {
    $versionFile = Join-Path $repoRoot '.test-artifacts\release-version.txt'
    if (Test-Path -LiteralPath $versionFile -PathType Leaf) {
        $Version = (Get-Content -LiteralPath $versionFile -Raw).Trim()
    }
}
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = (Get-Date).ToString('yyyyMMdd')
}

$edgeBuild = Join-Path $repoRoot 'app\.output\edge-mv3'
$chromeBuild = Join-Path $repoRoot 'app\.output\chrome-mv3'
foreach ($build in @($edgeBuild, $chromeBuild)) {
    if (-not (Test-Path -LiteralPath $build -PathType Container)) {
        throw "build output missing: $build (run 'bun run build' and 'bun run build:edge' first)"
    }
}

# Guard against packaging a stale build: the background bundle must contain the
# project's own native messaging host name, otherwise the panel shows
# "not connected" on the friend's machine.
$expectedHostName = 'com.fluxdown.cloud.nmh'
foreach ($build in @($edgeBuild, $chromeBuild)) {
    $backgroundBundle = Join-Path $build 'background.js'
    if (-not (Test-Path -LiteralPath $backgroundBundle -PathType Leaf)) {
        throw "background bundle missing: $backgroundBundle"
    }
    $found = Select-String -LiteralPath $backgroundBundle -SimpleMatch -Pattern $expectedHostName -Quiet
    if (-not $found) {
        throw "$backgroundBundle does not contain '$expectedHostName' - rebuild with 'bun run build' and 'bun run build:edge' first."
    }
}

# Pinned FFmpeg payload. These are the exact binaries this project has been
# shipping and testing against; a mismatch means the tools\ffmpeg folder was
# replaced by something else, which must never be redistributed silently.
$ffmpegHashes = [ordered]@{
    'ffmpeg.exe'  = 'E9FD5E711DEBAB9D680955FC1E38A2C1160FD280B144476CC3F62BC43EF49DB1'
    'ffprobe.exe' = '139F8420BCB2F29FCD5734E29D686289DF826CADCE5D2B7B5F56D0000EA9A951'
}

$packageName = "FluxDown-Cloud-Extension-$Version"
$stagingRoot = Join-Path $env:TEMP $packageName
if (Test-Path -LiteralPath $stagingRoot) {
    $resolvedStaging = [System.IO.Path]::GetFullPath($stagingRoot)
    $resolvedTemp = [System.IO.Path]::GetFullPath($env:TEMP)
    if (-not $resolvedStaging.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "refusing to clean a staging dir outside TEMP: $resolvedStaging"
    }
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stagingRoot 'extension') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stagingRoot 'scripts') -Force | Out-Null

Write-Host "[INFO] staging: $stagingRoot"
Copy-Item -LiteralPath $edgeBuild -Destination (Join-Path $stagingRoot 'extension\edge-mv3') -Recurse -Force
Copy-Item -LiteralPath $chromeBuild -Destination (Join-Path $stagingRoot 'extension\chrome-mv3') -Recurse -Force

foreach ($file in @('Get-ExtensionId.ps1', 'install-native-host.ps1', 'setup-for-friend.ps1', 'reinstall-native-host.ps1')) {
    $source = Join-Path $scriptDir $file
    if (Test-Path -LiteralPath $source -PathType Leaf) {
        Copy-Item -LiteralPath $source -Destination (Join-Path $stagingRoot "scripts\$file") -Force
    }
}

# One-click installer: the .ps1 must ship as UTF-8 WITH BOM because Windows
# PowerShell 5.1 otherwise decodes the Chinese strings as ANSI and prints
# mojibake (or fails to parse them).
$oneClickSource = Join-Path $scriptDir 'one-click.ps1'
if (Test-Path -LiteralPath $oneClickSource -PathType Leaf) {
    $oneClickText = Get-Content -LiteralPath $oneClickSource -Raw -Encoding UTF8
    [System.IO.File]::WriteAllText(
        (Join-Path $stagingRoot 'scripts\one-click.ps1'),
        $oneClickText,
        (New-Object System.Text.UTF8Encoding $true))
}

# Uninstaller: same BOM requirement as the installer.
$uninstallSource = Join-Path $scriptDir 'uninstall.ps1'
if (Test-Path -LiteralPath $uninstallSource -PathType Leaf) {
    $uninstallText = Get-Content -LiteralPath $uninstallSource -Raw -Encoding UTF8
    [System.IO.File]::WriteAllText(
        (Join-Path $stagingRoot 'scripts\uninstall.ps1'),
        $uninstallText,
        (New-Object System.Text.UTF8Encoding $true))
}
else {
    throw "missing uninstaller: $uninstallSource"
}

# Root launcher. Built from code points so this script stays pure ASCII.
$launcherSource = Join-Path $scriptDir 'release-launch.cmd'
if (Test-Path -LiteralPath $launcherSource -PathType Leaf) {
    $launcherName = -join ([char]0x4E00, [char]0x952E, [char]0x5B89, [char]0x88C5)
    Copy-Item -LiteralPath $launcherSource -Destination (Join-Path $stagingRoot ($launcherName + '.cmd')) -Force
}

$uninstallerSource = Join-Path $scriptDir 'release-uninstall.cmd'
if (Test-Path -LiteralPath $uninstallerSource -PathType Leaf) {
    $uninstallerName = -join ([char]0x4E00, [char]0x952E, [char]0x5378, [char]0x8F7D)
    Copy-Item -LiteralPath $uninstallerSource -Destination (Join-Path $stagingRoot ($uninstallerName + '.cmd')) -Force
}
else {
    throw "missing uninstaller launcher: $uninstallerSource"
}

# Bundled FFmpeg (used by the FluxDown engine to mux DASH audio/video).
$ffmpegSource = Join-Path $repoRoot 'tools\ffmpeg'
if (Test-Path -LiteralPath $ffmpegSource -PathType Container) {
    foreach ($name in $ffmpegHashes.Keys) {
        $binary = Join-Path $ffmpegSource $name
        if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
            throw "bundled FFmpeg missing: $binary"
        }
    }

    if (-not $SkipFfmpegCheck) {
        foreach ($name in $ffmpegHashes.Keys) {
            $actual = (Get-FileHash -LiteralPath (Join-Path $ffmpegSource $name) -Algorithm SHA256).Hash
            if ($actual -ne $ffmpegHashes[$name]) {
                throw ("FFmpeg hash mismatch for {0}`n  expected: {1}`n  actual:   {2}`nRefusing to package. Verify the new binary first, then update `$ffmpegHashes in this script." -f $name, $ffmpegHashes[$name], $actual)
            }
        }
        Write-Host "[INFO] FFmpeg binaries match the pinned SHA-256 values."
    }
    else {
        Write-Warning 'SkipFfmpegCheck set: packaging FFmpeg without verifying the pinned hashes.'
    }

    $ffmpegTarget = Join-Path $stagingRoot 'tools\ffmpeg'
    New-Item -ItemType Directory -Path $ffmpegTarget -Force | Out-Null
    Copy-Item -Path (Join-Path $ffmpegSource '*') -Destination $ffmpegTarget -Recurse -Force

    # Friends can check the shipped binaries with: certutil -hashfile ffmpeg.exe SHA256
    $sumLines = @()
    foreach ($name in @('ffmpeg.exe', 'ffprobe.exe')) {
        $hash = (Get-FileHash -LiteralPath (Join-Path $ffmpegTarget $name) -Algorithm SHA256).Hash.ToLowerInvariant()
        $sumLines += "$hash  $name"
    }
    [System.IO.File]::WriteAllLines(
        (Join-Path $ffmpegTarget 'SHA256SUMS.txt'),
        $sumLines,
        (New-Object System.Text.UTF8Encoding $false))
}

foreach ($file in @('LICENSE', 'THIRD_PARTY_NOTICES.md')) {
    $source = Join-Path $repoRoot $file
    if (Test-Path -LiteralPath $source -PathType Leaf) {
        Copy-Item -LiteralPath $source -Destination (Join-Path $stagingRoot $file) -Force
    }
}

$readmeSource = Join-Path $scriptDir 'release-readme-template.md'
if (Test-Path -LiteralPath $readmeSource -PathType Leaf) {
    $content = Get-Content -LiteralPath $readmeSource -Raw -Encoding UTF8
    $content = $content.Replace('{{VERSION}}', $Version)
    [System.IO.File]::WriteAllText((Join-Path $stagingRoot $readmeName), $content, (New-Object System.Text.UTF8Encoding $false))
}

if (-not (Test-Path -LiteralPath $DesktopDir -PathType Container)) {
    New-Item -ItemType Directory -Path $DesktopDir -Force | Out-Null
}
$zipPath = Join-Path $DesktopDir "$packageName.zip"
if (Test-Path -LiteralPath $zipPath -PathType Leaf) {
    Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $stagingRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal

$zipItem = Get-Item -LiteralPath $zipPath
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$shaPath = "$zipPath.sha256"
[System.IO.File]::WriteAllText(
    $shaPath,
    ("{0}  {1}`r`n" -f $zipHash, $zipItem.Name),
    (New-Object System.Text.UTF8Encoding $false))

Write-Host ""
Write-Host ("[INFO] package created: {0}" -f $zipItem.FullName) -ForegroundColor Green
Write-Host ("[INFO] size: {0:N1} MB" -f ($zipItem.Length / 1MB))
Write-Host ("[INFO] sha256: {0}" -f $zipHash)
Write-Host ("[INFO] checksum file: {0}" -f $shaPath)
Write-Host "[INFO] staging folder kept for inspection: $stagingRoot"

$verify = Join-Path $env:TEMP ("$packageName-verify")
if (Test-Path -LiteralPath $verify) { Remove-Item -LiteralPath $verify -Recurse -Force }
Expand-Archive -LiteralPath $zipPath -DestinationPath $verify -Force
$checkFiles = @(
    'extension\edge-mv3\manifest.json',
    'extension\chrome-mv3\manifest.json',
    'scripts\setup-for-friend.ps1',
    'scripts\Get-ExtensionId.ps1',
    'scripts\one-click.ps1',
    'scripts\uninstall.ps1',
    (-join ([char]0x4E00, [char]0x952E, [char]0x5B89, [char]0x88C5) + '.cmd'),
    (-join ([char]0x4E00, [char]0x952E, [char]0x5378, [char]0x8F7D) + '.cmd'),
    'tools\ffmpeg\ffmpeg.exe',
    'tools\ffmpeg\ffprobe.exe',
    'tools\ffmpeg\SHA256SUMS.txt',
    $readmeName
)
Write-Host ""
Write-Host "[INFO] verifying archive contents:"
foreach ($relative in $checkFiles) {
    $present = Test-Path -LiteralPath (Join-Path $verify $relative)
    $mark = if ($present) { 'OK  ' } else { 'MISS' }
    Write-Host ("  {0} {1}" -f $mark, $relative)
    if (-not $present) { throw "archive missing: $relative" }
}
Write-Host "[INFO] archive verified." -ForegroundColor Green
