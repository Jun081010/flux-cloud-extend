<#
 * One-command setup: launch the browser with the extension auto-loaded,
 * read the sideloaded extension ID from the profile, register the Native
 * Messaging host for it, and create a desktop shortcut that always starts
 * the browser with --load-extension so no manual "Load unpacked" is needed.
 *
 * Usage (from the extracted folder root):
 *   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\auto-setup.ps1
 *   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\auto-setup.ps1 -Browser Chrome
 * Dry run without changing anything:
 *   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\auto-setup.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateSet('Edge', 'Chrome')]
    [string]$Browser = 'Edge',
    [string]$ExtensionPath = ''
)

$ErrorActionPreference = 'Stop'
$ConfirmPreference = 'None'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if ([string]::IsNullOrWhiteSpace($ExtensionPath)) {
    $ExtensionPath = Join-Path (Split-Path -Parent $scriptDir) 'extension\edge-mv3'
}
$ExtensionPath = (Resolve-Path -LiteralPath $ExtensionPath -ErrorAction Stop).Path

function Get-BrowserExe([string]$name) {
    $candidates = if ($name -eq 'Edge') {
        @('C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
          'C:\Program Files\Microsoft\Edge\Application\msedge.exe')
    } else {
        @('C:\Program Files\Google\Chrome\Application\chrome.exe',
          'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe')
    }
    foreach ($path in $candidates) {
        if (Test-Path -LiteralPath $path) { return $path }
    }
    throw ("{0} executable not found in standard locations." -f $name)
}

$exe = Get-BrowserExe $Browser
$running = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $exe } |
    Select-Object -First 1
if ($running) {
    Write-Host "[WARN] $Browser is already running; the launch step will just open a window." -ForegroundColor Yellow
    Write-Host "[WARN] Close all $Browser windows first for the auto-load to take effect." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== FluxDown Cloud auto setup ($Browser) ===" -ForegroundColor Cyan
Write-Host "[INFO] extension: $ExtensionPath"

# Step 1: launch once so the profile records the extension (ID is path-derived
# per browser version; we read it back instead of computing it).
Write-Host "[INFO] step 1/4: launching $Browser with --load-extension ..."
if ($PSCmdlet.ShouldProcess($Browser, 'Launch with --load-extension')) {
    Start-Process $exe -ArgumentList @("--load-extension=$ExtensionPath")
}

Write-Host "[INFO] step 2/4: waiting for the extension ID to appear in the profile ..."
$idScript = Join-Path $scriptDir 'Get-ExtensionId.ps1'
$folderName = Split-Path -Leaf $ExtensionPath
$extensionId = ''
for ($i = 0; $i -lt 30 -and -not $extensionId; $i++) {
    Start-Sleep -Seconds 2
    if ($PSCmdlet.ShouldProcess($Browser, 'Detect extension ID')) {
        $detected = @(& $idScript -Browser $Browser -FolderName $folderName 2>$null |
            Where-Object { $_ -and $_.PSObject.Properties['Id'] } |
            Select-Object -First 1)
        if ($detected) { $extensionId = [string]$detected.Id }
    }
}
if (-not $extensionId) {
    Write-Host "[ERROR] Extension ID not detected. If a browser window just opened, keep it" -ForegroundColor Red
    Write-Host "[ERROR] open for ~20 seconds and re-run this script." -ForegroundColor Red
    exit 1
}
Write-Host ("[INFO] extension ID: {0}" -f $extensionId)

# Step 2b: NMH registration for the detected ID (HKCU only, backups kept).
Write-Host "[INFO] step 3/4: registering native messaging host ..."
if ($PSCmdlet.ShouldProcess($extensionId, 'Register NMH host')) {
    & (Join-Path $scriptDir 'install-native-host.ps1') -ExtensionId $extensionId -Browser $Browser
    if ($LASTEXITCODE -ne 0) { throw "install-native-host.ps1 failed ($LASTEXITCODE)" }
}

# Step 3: desktop shortcut that always launches with the extension loaded.
Write-Host "[INFO] step 4/4: creating desktop shortcut ..."
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop ("FluxDown Cloud ({0}).lnk" -f $Browser)
if ($PSCmdlet.ShouldProcess($shortcutPath, 'Create shortcut')) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $exe
    $shortcut.Arguments = "--load-extension=`"$ExtensionPath`""
    $shortcut.Description = 'FluxDown Cloud extension (auto-loaded)'
    $shortcut.Save()
}

Write-Host ""
Write-Host "[OK] setup complete. From now on start $Browser via the shortcut:" -ForegroundColor Green
Write-Host "[OK]   $shortcutPath"
Write-Host "[OK] Reload the browser once if it was already running."
