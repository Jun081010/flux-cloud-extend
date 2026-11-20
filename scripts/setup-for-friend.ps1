<#
 * FluxDown Cloud extension - one-shot setup for a new machine.
 *
 * What it does:
 *   1. Detects the sideloaded extension ID for Edge / Chrome (or takes it via -ExtensionId).
 *   2. Registers it in the Native Messaging whitelist (HKCU only, no admin, backups first).
 *   3. Prints the remaining manual steps.
 *
 * Prerequisite: FluxDown desktop is installed. Starting it once is recommended
 * (the relay executable path can then be auto-detected).
 *
 * The extension registers its own Native Messaging host name
 * (com.fluxdown.cloud.nmh) instead of reusing the official com.fluxdown.nmh one.
 * The FluxDown desktop app rewrites the official manifest and its two HKCU keys
 * on every start, which used to drop this sideloaded extension ID from the
 * whitelist and make the panel show "not connected" again after each restart.
 * A private host name is immune to that self-repair.
 *
 * Usage (from the extracted folder root):
 *   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-for-friend.ps1
 *   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-for-friend.ps1 -Browser Edge
 *   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-for-friend.ps1 -ExtensionId <32-char-id>
#>
[CmdletBinding()]
param(
    [ValidateSet('Edge', 'Chrome', 'All')]
    [string]$Browser = 'All',
    [string]$ExtensionId = '',
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# install-native-host.ps1 uses [CmdletBinding(SupportsShouldProcess)] with
# ConfirmImpact=Medium. PowerShell 5.1 cannot bind a boolean to a switch through
# the command line (-Confirm:$false throws), so suppress the prompt here.
$ConfirmPreference = 'None'

Write-Host ""
Write-Host "=== FluxDown Cloud extension setup ===" -ForegroundColor Cyan

$flusdownProc = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match '^fluxdown-(agent|desktop)$' } |
    Select-Object -First 1
if (-not $flusdownProc) {
    Write-Host "[WARN] FluxDown desktop does not appear to be running." -ForegroundColor Yellow
    Write-Host "[WARN] Start it once before continuing, otherwise the native-messaging relay path cannot be auto-detected." -ForegroundColor Yellow
}
else {
    Write-Host ("[INFO] FluxDown desktop running: {0}" -f $flusdownProc.Path)
}

if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
    Write-Host "[INFO] detecting sideloaded extension ID ..."
    $idScript = Join-Path $scriptDir 'Get-ExtensionId.ps1'
    # Get-ExtensionId.ps1 writes its human-readable banner with Write-Host (not
    # capturable) and emits one detection object per hit on the pipeline. Keep
    # only those objects; the banner still reaches the console on its own.
    $detected = @(& $idScript -Browser $Browser | Where-Object { $_ -and $_.PSObject.Properties['Id'] })
    if ($detected.Count -gt 0) { $ExtensionId = [string]$detected[0].Id }
}

if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
    Write-Host ""
    Write-Host "[ERROR] could not detect the extension ID automatically." -ForegroundColor Red
    Write-Host "[ERROR] 1) Load the extension folder in your browser (edge://extensions -> Load unpacked)" -ForegroundColor Red
    Write-Host "[ERROR] 2) Copy the 32-char ID shown on that page" -ForegroundColor Red
    Write-Host "[ERROR] 3) Re-run: .\scripts\setup-for-friend.ps1 -ExtensionId <the-id>" -ForegroundColor Red
    exit 1
}

Write-Host ("[INFO] using extension ID: {0}" -f $ExtensionId) -ForegroundColor Green

$installer = Join-Path $scriptDir 'install-native-host.ps1'
$installerArgs = @{
    ExtensionId = $ExtensionId
    Browser     = $Browser
}
if ($WhatIf) { $installerArgs['WhatIf'] = $true }

& $installer @installerArgs

Write-Host ""
Write-Host "=== Next steps ===" -ForegroundColor Cyan
Write-Host "1. Fully quit and restart the browser (all windows)."
Write-Host "2. Start FluxDown desktop and enable browser-extension integration."
Write-Host "3. Click the FluxDown toolbar icon; the header must show 'connected'."
Write-Host ""
Write-Host "This extension registers its own host name (com.fluxdown.cloud.nmh), so the" -ForegroundColor Yellow
Write-Host "FluxDown desktop app's registry self-repair no longer drops it." -ForegroundColor Yellow
Write-Host "If the header still shows 'not connected', fully quit the browser (all windows," -ForegroundColor Yellow
Write-Host "including the tray icon) and re-run this script." -ForegroundColor Yellow
