<#
 * Re-register this project's extension ID in the Native Messaging whitelist.
 *
 * Why this exists: the FluxDown desktop app (fluxdown-agent.exe) rewrites the
 * OFFICIAL registration on every start:
 *   D:\FluxDown-<ver>-windows-x64\portable_data\nmh\com.fluxdown.nmh.json
 * plus the two HKCU "...\NativeMessagingHosts\com.fluxdown.nmh" defaults. That
 * manifest only lists the official Chrome / Edge extension IDs, so a sideloaded
 * ID placed there gets dropped and the browser rejects connectNative() -> the
 * panel shows "not connected" again after every desktop restart.
 *
 * This project therefore registers its OWN host name, com.fluxdown.cloud.nmh,
 * which the desktop app never touches. install-native-host.ps1 owns that name.
 * Run this script after the relay executable moves or after switching browsers.
 *
 * Usage (from the project root):
 *   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\reinstall-native-host.ps1
 *   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\reinstall-native-host.ps1 -ExtensionId <32-char-id>
#>
[CmdletBinding()]
param(
    [string]$ExtensionId,
    [ValidateSet('Edge', 'Chrome', 'All')]
    [string]$Browser = 'All'
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
    $idFile = Join-Path $repoRoot '.test-artifacts\known-extension-id.txt'
    if (Test-Path -LiteralPath $idFile -PathType Leaf) {
        $ExtensionId = (Get-Content -LiteralPath $idFile -Raw).Trim()
    }
}
if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
    $ExtensionId = 'jloamngboafblehcipgjmhemkgmmkggc'
}

$installer = Join-Path $scriptDir 'install-native-host.ps1'
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw "installer not found: $installer"
}

# install-native-host.ps1 uses SupportsShouldProcess with ConfirmImpact=Medium.
# PowerShell 5.1 cannot bind a boolean to -Confirm through the command line, so
# suppress the prompt instead of passing -Confirm:$false.
$ConfirmPreference = 'None'

Write-Host "[INFO] extension id: $ExtensionId (browser: $Browser)"
& $installer -ExtensionId $ExtensionId -Browser $Browser

$manifestPath = Join-Path $env:LOCALAPPDATA 'FluxDownCloudExtension\nmh\com.fluxdown.cloud.nmh.json'
if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $present = @($manifest.allowed_origins) -contains "chrome-extension://$ExtensionId/"
    Write-Host "[INFO] project manifest contains this id: $present"
}

foreach ($name in @('Chrome', 'Edge')) {
    $key = if ($name -eq 'Chrome') {
        'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.fluxdown.cloud.nmh'
    } else {
        'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.fluxdown.cloud.nmh'
    }
    if (Test-Path -LiteralPath $key) {
        Write-Host ("[INFO] {0} -> {1}" -f $name, (Get-ItemProperty -LiteralPath $key).'(default)')
    }
}

Write-Host "[INFO] restart the browser, then check the popup connection state."
