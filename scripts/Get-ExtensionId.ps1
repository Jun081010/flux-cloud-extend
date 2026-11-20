<#
 * Detect the sideloaded FluxDown Cloud extension ID for a browser profile.
 *
 * Edge / Chrome derive the ID of an unpacked ("load unpacked") extension from
 * its absolute folder path, so every machine gets a different ID. The Native
 * Messaging manifest must whitelist that exact ID, otherwise connectNative()
 * fails and the popup shows "not connected".
 *
 * Usage:
 *   powershell -NoProfile -ExecutionPolicy Bypass -File .\Get-ExtensionId.ps1
 *   powershell -NoProfile -ExecutionPolicy Bypass -File .\Get-ExtensionId.ps1 -Browser Edge
#>
[CmdletBinding()]
param(
    [ValidateSet('Edge', 'Chrome', 'All')]
    [string]$Browser = 'All',
    [string]$FolderName = '',
    [string[]]$ExtraRoot = @()
)

$ErrorActionPreference = 'Stop'

function Get-Roots([string]$browserName) {
    if ($browserName -eq 'Edge') {
        return @((Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'))
    }
    if ($browserName -eq 'Chrome') {
        return @((Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'))
    }
    return @(
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data')
    )
}

if ($Browser -eq 'Edge') { $targetBrowsers = @('Edge') }
elseif ($Browser -eq 'Chrome') { $targetBrowsers = @('Chrome') }
else { $targetBrowsers = @('Edge', 'Chrome') }

$pattern = if ($FolderName) { [regex]::Escape($FolderName) } else { '(edge|chrome)-mv3' }
$found = @()

foreach ($browserName in $targetBrowsers) {
    $roots = @(Get-Roots $browserName) + $ExtraRoot
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        $profiles = @('Default', 'Profile 1', 'Profile 2', 'Profile 3')
        $profiles += (Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' } |
            ForEach-Object { $_.Name })
        $profiles = $profiles | Select-Object -Unique

        foreach ($profile in $profiles) {
            $profileDir = Join-Path $root $profile
            # Chrome / Edge store extension settings either in "Preferences" or in
            # "Secure Preferences" (both are one-line JSON). Unpacked extensions
            # usually end up in "Secure Preferences", so both must be scanned.
            foreach ($name in @('Preferences', 'Secure Preferences')) {
                $prefs = Join-Path $profileDir $name
                if (-not (Test-Path -LiteralPath $prefs -PathType Leaf)) { continue }
                $raw = Get-Content -LiteralPath $prefs -Raw

                # Extension settings nest sub-objects, so braces cannot be matched
                # naively. Take each "path" occurrence and walk back to the nearest
                # preceding extension ID key.
                $idMatches = [regex]::Matches($raw, '"([a-p]{32})"\s*:\s*\{')
                $pathMatches = [regex]::Matches($raw, '"path"\s*:\s*"([^"]*)"')
                foreach ($pm in $pathMatches) {
                    $path = $pm.Groups[1].Value -replace '\\\\', '\'
                    if ($path -notmatch $pattern) { continue }
                    $owner = $null
                    foreach ($im in $idMatches) {
                        if ($im.Index -ge $pm.Index) { break }
                        $owner = $im.Groups[1].Value
                    }
                    if (-not $owner) { continue }
                    $found += [pscustomobject]@{ Browser = $browserName; Profile = $profile; Id = $owner; Path = $path }
                }
            }
        }
    }
}

$unique = @{}
foreach ($item in $found) { $unique[$item.Id] = $item }

if ($unique.Count -eq 0) {
    Write-Host "[INFO] no sideloaded (edge|chrome)-mv3 extension found." -ForegroundColor Yellow
    Write-Host "[INFO] load the extension folder in the browser first, then run this script again." -ForegroundColor Yellow
    Write-Host "[INFO] or copy the ID manually from edge://extensions or chrome://extensions."
    exit 1
}

foreach ($item in $unique.Values) {
    Write-Host ("{0} ({1}): {2}" -f $item.Browser, $item.Profile, $item.Id) -ForegroundColor Green
    Write-Host ("  path: {0}" -f $item.Path)
    # Machine-readable copy on the pipeline. Write-Host writes to the host and is
    # NOT capturable by a caller ($x = & .\Get-ExtensionId.ps1), so callers such as
    # setup-for-friend.ps1 need this separate object stream.
    Write-Output ([pscustomobject]@{
        Browser = $item.Browser
        Profile = $item.Profile
        Id      = $item.Id
        Path    = $item.Path
    })
}

if ($unique.Count -eq 1) {
    $only = @($unique.Values)[0]
    Write-Host ""
    Write-Host ("[INFO] install with: .\install-native-host.ps1 -ExtensionId {0} -Browser {1}" -f $only.Id, $only.Browser)
}
