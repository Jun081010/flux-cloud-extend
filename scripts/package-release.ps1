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

$edgeBuild = Join-Path $repoRoot 'app\.output\edge-mv3'
$chromeBuild = Join-Path $repoRoot 'app\.output\chrome-mv3'
foreach ($build in @($edgeBuild, $chromeBuild)) {
    if (-not (Test-Path -LiteralPath $build -PathType Container)) {
        throw "build output missing: $build (run 'bun run build' and 'bun run build:edge' first)"
    }
}

$manifestVersions = @{}
foreach ($build in @($edgeBuild, $chromeBuild)) {
    $manifestPath = Join-Path $build 'manifest.json'
    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    }
    catch {
        throw "cannot read manifest $manifestPath : $($_.Exception.Message)"
    }
    if ($manifest.manifest_version -ne 3) {
        throw "expected an MV3 manifest: $manifestPath"
    }
    $manifestVersions[$build] = $manifest.version
}
$buildVersion = $manifestVersions[$edgeBuild]
if ($buildVersion -notmatch '\A[0-9]+(?:\.[0-9]+){2,3}\z') {
    throw "edge build has an invalid version in $edgeBuild\manifest.json"
}
if ($manifestVersions[$chromeBuild] -ne $buildVersion) {
    throw ("edge/chrome build version mismatch: edge={0} chrome={1}" -f $buildVersion, $manifestVersions[$chromeBuild])
}
$sourceVersion = (Get-Content -LiteralPath (Join-Path $repoRoot 'app\package.json') -Raw | ConvertFrom-Json).version
if ($sourceVersion -ne $buildVersion) {
    throw "source/build version mismatch: source=$sourceVersion build=$buildVersion. Rebuild both browsers."
}
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = $buildVersion
}
elseif ($Version -ne $buildVersion) {
    throw ("-Version '{0}' does not match built manifest version '{1}'. Rebuild or fix -Version." -f $Version, $buildVersion)
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
$requiredSources = @(
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'scripts\Get-ExtensionId.ps1',
    'scripts\install-native-host.ps1',
    'scripts\setup-for-friend.ps1',
    'scripts\reinstall-native-host.ps1',
    'scripts\one-click.ps1',
    'scripts\uninstall.ps1',
    'scripts\release-launch.cmd',
    'scripts\release-uninstall.cmd',
    'scripts\release-readme-template.md',
    'tools\ffmpeg\ffmpeg.exe',
    'tools\ffmpeg\ffprobe.exe'
)
foreach ($required in $requiredSources) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $required) -PathType Leaf)) {
        throw "missing release input: $required"
    }
}
$tempRoot = [System.IO.Path]::GetFullPath($env:TEMP)
$stagingRoot = [System.IO.Path]::GetFullPath($stagingRoot + '-' + [guid]::NewGuid().ToString('N'))
if ((Split-Path -Parent $stagingRoot).TrimEnd('\') -ne $tempRoot.TrimEnd('\')) {
    throw "Staging path is outside TEMP: $stagingRoot"
}

try {
    New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $stagingRoot 'extension') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $stagingRoot 'scripts') -Force | Out-Null

    Write-Host "[INFO] staging: $stagingRoot"
    Copy-Item -LiteralPath $edgeBuild -Destination (Join-Path $stagingRoot 'extension\edge-mv3') -Recurse -Force
    Copy-Item -LiteralPath $chromeBuild -Destination (Join-Path $stagingRoot 'extension\chrome-mv3') -Recurse -Force

    foreach ($file in @('Get-ExtensionId.ps1', 'install-native-host.ps1', 'setup-for-friend.ps1', 'reinstall-native-host.ps1')) {
        Copy-Item -LiteralPath (Join-Path $scriptDir $file) -Destination (Join-Path $stagingRoot "scripts\$file") -Force
    }

    # One-click installer: the .ps1 must ship as UTF-8 WITH BOM because Windows
    # PowerShell 5.1 otherwise decodes the Chinese strings as ANSI and prints
    # mojibake (or fails to parse them).
    foreach ($file in @('one-click.ps1', 'uninstall.ps1')) {
        $text = Get-Content -LiteralPath (Join-Path $scriptDir $file) -Raw -Encoding UTF8
        [System.IO.File]::WriteAllText(
            (Join-Path $stagingRoot "scripts\$file"),
            $text,
            (New-Object System.Text.UTF8Encoding $true))
    }

    # Root launcher. Built from code points so this script stays pure ASCII.
    $launcherName = (-join ([char]0x4E00, [char]0x952E, [char]0x5B89, [char]0x88C5)) + '.cmd'
    $uninstallerName = (-join ([char]0x4E00, [char]0x952E, [char]0x5378, [char]0x8F7D)) + '.cmd'
    Copy-Item -LiteralPath (Join-Path $scriptDir 'release-launch.cmd') -Destination (Join-Path $stagingRoot $launcherName) -Force
    Copy-Item -LiteralPath (Join-Path $scriptDir 'release-uninstall.cmd') -Destination (Join-Path $stagingRoot $uninstallerName) -Force

    # Bundled FFmpeg (used by the FluxDown engine to mux DASH audio/video).
    $ffmpegSource = Join-Path $repoRoot 'tools\ffmpeg'
    $ffmpegTarget = Join-Path $stagingRoot 'tools\ffmpeg'
    New-Item -ItemType Directory -Path $ffmpegTarget -Force | Out-Null
    if ($SkipFfmpegCheck) {
        Write-Warning 'SkipFfmpegCheck set: packaging FFmpeg without verifying the pinned hashes.'
    }
    $sumLines = foreach ($name in $ffmpegHashes.Keys) {
        $packedBinary = Join-Path $ffmpegTarget $name
        Copy-Item -LiteralPath (Join-Path $ffmpegSource $name) -Destination $packedBinary
        $hash = (Get-FileHash -LiteralPath $packedBinary -Algorithm SHA256).Hash
        if (-not $SkipFfmpegCheck -and $hash -ne $ffmpegHashes[$name]) {
            throw ("FFmpeg hash mismatch for {0}`n  expected: {1}`n  actual:   {2}" -f $name, $ffmpegHashes[$name], $hash)
        }
        "{0}  {1}" -f $hash.ToLowerInvariant(), $name
    }
    $ffmpegReadme = Join-Path $ffmpegSource 'README.txt'
    if (Test-Path -LiteralPath $ffmpegReadme -PathType Leaf) {
        Copy-Item -LiteralPath $ffmpegReadme -Destination $ffmpegTarget
    }
    [System.IO.File]::WriteAllLines(
        (Join-Path $ffmpegTarget 'SHA256SUMS.txt'),
        [string[]]$sumLines,
        (New-Object System.Text.UTF8Encoding $false))

    foreach ($file in @('LICENSE', 'THIRD_PARTY_NOTICES.md')) {
        Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination $stagingRoot
    }

    $readmeSource = Join-Path $scriptDir 'release-readme-template.md'
    $content = (Get-Content -LiteralPath $readmeSource -Raw -Encoding UTF8).Replace('{{VERSION}}', $Version)
    [System.IO.File]::WriteAllText((Join-Path $stagingRoot $readmeName), $content, (New-Object System.Text.UTF8Encoding $false))

    if (-not (Test-Path -LiteralPath $DesktopDir -PathType Container)) {
        New-Item -ItemType Directory -Path $DesktopDir -Force | Out-Null
    }
    $zipPath = Join-Path $DesktopDir "$packageName.zip"
    $shaPath = "$zipPath.sha256"
    $checkFiles = @(
        'LICENSE',
        'THIRD_PARTY_NOTICES.md',
        'extension\edge-mv3\manifest.json',
        'extension\edge-mv3\background.js',
        'extension\chrome-mv3\manifest.json',
        'extension\chrome-mv3\background.js',
        'scripts\setup-for-friend.ps1',
        'scripts\Get-ExtensionId.ps1',
        'scripts\install-native-host.ps1',
        'scripts\reinstall-native-host.ps1',
        'scripts\one-click.ps1',
        'scripts\uninstall.ps1',
        $launcherName,
        $uninstallerName,
        'tools\ffmpeg\ffmpeg.exe',
        'tools\ffmpeg\ffprobe.exe',
        'tools\ffmpeg\SHA256SUMS.txt',
        $readmeName
    )
    $tempZip = Join-Path $DesktopDir ("{0}-{1}.zip" -f $packageName, [guid]::NewGuid().ToString('N'))
    $tempSha = "$tempZip.sha256"
    try {
        $stagedPaths = @(Get-ChildItem -LiteralPath $stagingRoot | ForEach-Object FullName)
        Compress-Archive -LiteralPath $stagedPaths -DestinationPath $tempZip -CompressionLevel Optimal
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [System.IO.Compression.ZipFile]::OpenRead($tempZip)
        try {
            $entryNames = @($archive.Entries | Where-Object Length -gt 0 | ForEach-Object { $_.FullName.Replace('\', '/') })
            foreach ($relative in $checkFiles) {
                if ($entryNames -notcontains $relative.Replace('\', '/')) { throw "archive missing or empty: $relative" }
            }
        }
        finally {
            $archive.Dispose()
        }

        $zipHash = (Get-FileHash -LiteralPath $tempZip -Algorithm SHA256).Hash.ToLowerInvariant()
        [System.IO.File]::WriteAllText(
            $tempSha,
            ("{0}  {1}`r`n" -f $zipHash, "$packageName.zip"),
            (New-Object System.Text.UTF8Encoding $false))
        Move-Item -LiteralPath $tempZip -Destination $zipPath -Force
        Move-Item -LiteralPath $tempSha -Destination $shaPath -Force
    }
    finally {
        foreach ($temporary in @($tempZip, $tempSha)) {
            [System.IO.File]::Delete([System.IO.Path]::GetFullPath($temporary))
        }
    }

    $zipItem = Get-Item -LiteralPath $zipPath
    Write-Host ("[INFO] package verified: {0}" -f $zipItem.FullName) -ForegroundColor Green
    Write-Host ("[INFO] size: {0:N1} MB" -f ($zipItem.Length / 1MB))
    Write-Host ("[INFO] sha256: {0}" -f $zipHash)
    Write-Host ("[INFO] checksum file: {0}" -f $shaPath)
}
finally {
    if (Test-Path -LiteralPath $stagingRoot -PathType Container) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
}
