[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$ExtensionId,

    [ValidateSet('Edge', 'Chrome', 'All')]
    [string]$Browser = 'All',

    # Path to the FluxDown native-messaging relay (fluxdown_nmh.exe).
    # When omitted it is discovered automatically (see Resolve-RelayExe).
    [string]$RelayPath = '',

    # Legacy alias kept for the older docs: an official NMH manifest is only
    # used as a hint for locating the relay executable.
    [string]$HostManifest = '',

    [switch]$Uninstall,

    [switch]$Restore,

    [string]$BackupPath
)

$ErrorActionPreference = 'Stop'

<#
 * This extension registers its OWN native messaging host name instead of
 * reusing the official "com.fluxdown.nmh" one.
 *
 * Why: the FluxDown desktop app (fluxdown-agent.exe) rewrites
 *   <install>\portable_data\nmh\com.fluxdown.nmh.json
 * and repoints the HKCU ".../NativeMessagingHosts/com.fluxdown.nmh" default
 * value at that official manifest every time it starts. That manifest only
 * whitelists the official extension IDs, so a sideloaded build gets dropped
 * and connectNative() fails -> the panel shows "not connected", again after
 * every desktop restart.
 *
 * The relay binary itself does not care about the host name (it just forwards
 * between the browser's stdio and the \\.\pipe\fluxdown-* pipe), so a private
 * host name keeps the same download pipeline while making the registration
 * immune to the desktop app's self-repair.
#>

$HostName = 'com.fluxdown.cloud.nmh'

function Write-Info([string]$Message) {
    Write-Host "[INFO] $Message"
}

function Fail([string]$Message) {
    Write-Error -Message $Message -ErrorAction Continue
    exit 1
}

function Get-FullPathSafe([string]$Path, [string]$Label) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        Fail "$Label must not be empty."
    }
    try {
        return [System.IO.Path]::GetFullPath($Path)
    }
    catch {
        Fail "$Label is not a valid path: $Path"
    }
}

function Test-ReparsePoint([string]$Path) {
    $current = Get-FullPathSafe -Path $Path -Label 'path'
    while ($true) {
        if ((Test-Path -LiteralPath $current -PathType Leaf) -or (Test-Path -LiteralPath $current -PathType Container)) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                return $true
            }
        }
        $parent = [System.IO.Path]::GetDirectoryName($current)
        if ([string]::IsNullOrEmpty($parent) -or $parent -eq $current) {
            break
        }
        $current = $parent
    }
    return $false
}

function Assert-UnderDirectory([string]$ChildPath, [string]$ParentPath, [string]$Label) {
    $child = Get-FullPathSafe -Path $ChildPath -Label $Label
    $parent = Get-FullPathSafe -Path $ParentPath -Label "$Label root"
    $parentWithSeparator = $parent.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $child.StartsWith($parentWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {
        Fail "$Label must stay inside $parent : $child"
    }
    if (Test-ReparsePoint -Path $child) {
        Fail "$Label or one of its parents is a reparse point (symlink/junction), refusing: $child"
    }
    return $child
}

function Write-JsonAtomic([string]$Path, [string]$Content) {
    $directory = [System.IO.Path]::GetDirectoryName($Path)
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        [void](New-Item -ItemType Directory -Path $directory -Force)
    }
    if (Test-ReparsePoint -Path $Path) {
        Fail "target is a reparse point, refusing to write: $Path"
    }
    $tempPath = Join-Path $directory ('.' + [System.IO.Path]::GetFileName($Path) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [System.IO.File]::WriteAllText($tempPath, $Content, (New-Object System.Text.UTF8Encoding $false))
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            # Windows PowerShell 5.1 binds $null to an empty string, and
            # File.Replace throws ArgumentException for an empty backup path;
            # fall back to an overwriting Move (also an atomic rename).
            $replaced = $false
            try {
                [System.IO.File]::Replace($tempPath, $Path, $null)
                $replaced = $true
            }
            catch [System.ArgumentException] {
                $replaced = $false
            }
            if (-not $replaced) {
                Move-Item -LiteralPath $tempPath -Destination $Path -Force
            }
        }
        else {
            [System.IO.File]::Move($tempPath, $Path)
        }
    }
    catch {
        if (Test-Path -LiteralPath $tempPath -PathType Leaf) {
            Remove-Item -LiteralPath $tempPath -Force
        }
        throw
    }
}

function Get-RegistryDefault([Microsoft.Win32.RegistryKey]$Hive, [string]$SubKeyPath) {
    $key = $Hive.OpenSubKey($SubKeyPath, $false)
    if ($null -eq $key) {
        return [pscustomobject]@{ Exists = $false; Value = $null; Kind = $null }
    }
    try {
        $boundValue = $key.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($null -eq $boundValue) {
            return [pscustomobject]@{ Exists = $true; Value = $null; Kind = $null }
        }
        return [pscustomobject]@{
            Exists = $true
            Value  = [string]$boundValue
            Kind   = $key.GetValueKind('').ToString()
        }
    }
    finally {
        $key.Dispose()
    }
}

function Set-RegistryDefault([Microsoft.Win32.RegistryKey]$Hive, [string]$SubKeyPath, [string]$Value) {
    $key = $Hive.CreateSubKey($SubKeyPath, $true)
    if ($null -eq $key) {
        Fail "cannot create or open registry key: HKCU\$SubKeyPath"
    }
    try {
        $key.SetValue('', $Value, [Microsoft.Win32.RegistryValueKind]::String)
    }
    finally {
        $key.Dispose()
    }
}

function Remove-RegistryDefault([Microsoft.Win32.RegistryKey]$Hive, [string]$SubKeyPath) {
    $key = $Hive.OpenSubKey($SubKeyPath, $true)
    if ($null -eq $key) {
        return
    }
    try {
        $key.DeleteValue('', $false)
    }
    finally {
        $key.Dispose()
    }
}

function Remove-RegistryKeyTree([Microsoft.Win32.RegistryKey]$Hive, [string]$SubKeyPath) {
    $key = $Hive.OpenSubKey($SubKeyPath, $false)
    if ($null -ne $key) { $key.Dispose() }
    else { return }
    try {
        $Hive.DeleteSubKeyTree($SubKeyPath, $false)
    }
    catch {
        Write-Warning "could not remove HKCU\$SubKeyPath : $($_.Exception.Message)"
    }
}

# Official (desktop-app owned) keys: read-only hints for locating the relay.
$officialKeys = [ordered]@{
    Chrome = 'Software\Google\Chrome\NativeMessagingHosts\com.fluxdown.nmh'
    Edge   = 'Software\Microsoft\Edge\NativeMessagingHosts\com.fluxdown.nmh'
}
# Keys owned by this project. The desktop app never touches these.
$browserKeys = [ordered]@{
    Chrome = "Software\Google\Chrome\NativeMessagingHosts\$HostName"
    Edge   = "Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
}

<#
 * Locate fluxdown_nmh.exe (the relay). Order:
 *   1. -RelayPath (explicit) or -HostManifest (legacy: read its "path"),
 *   2. the running fluxdown-agent.exe directory,
 *   3. the official manifest referenced by the HKCU official keys,
 *   4. a directory scan for FluxDown* / *\portable_data\nmh.
#>
function Resolve-RelayExe([string]$explicitRelay, [string]$officialManifestHint) {
    $candidates = New-Object System.Collections.Generic.List[string]

    if (-not [string]::IsNullOrWhiteSpace($explicitRelay)) {
        $candidates.Add($explicitRelay)
    }
    if (-not [string]::IsNullOrWhiteSpace($officialManifestHint)) {
        if (Test-Path -LiteralPath $officialManifestHint -PathType Leaf) {
            try {
                $parsed = [System.IO.File]::ReadAllText($officialManifestHint, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
                if (-not [string]::IsNullOrWhiteSpace([string]$parsed.path)) { $candidates.Add([string]$parsed.path) }
            }
            catch {
                Write-Warning "cannot parse $officialManifestHint : $($_.Exception.Message)"
            }
        }
    }

    $agent = Get-Process -Name 'fluxdown-agent' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path } | Select-Object -First 1
    if ($agent) { $candidates.Add((Join-Path (Split-Path -Parent $agent.Path) 'fluxdown_nmh.exe')) }

    foreach ($name in @('Chrome', 'Edge')) {
        $hive = [Microsoft.Win32.Registry]::CurrentUser
        $key = $hive.OpenSubKey($officialKeys[$name], $false)
        if ($null -eq $key) { continue }
        try {
            $value = [string]$key.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        }
        finally {
            $key.Dispose()
        }
        if ([string]::IsNullOrWhiteSpace($value) -or -not (Test-Path -LiteralPath $value -PathType Leaf)) { continue }
        try {
            $parsed = [System.IO.File]::ReadAllText($value, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
            if (-not [string]::IsNullOrWhiteSpace([string]$parsed.path)) { $candidates.Add([string]$parsed.path) }
        }
        catch {
            Write-Warning "cannot parse $value : $($_.Exception.Message)"
        }
    }

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            Write-Info "relay: $candidate"
            return (Get-FullPathSafe -Path $candidate -Label 'RelayPath')
        }
    }

    $searchRoots = New-Object System.Collections.Generic.List[string]
    foreach ($drive in @('C:\', 'D:\', 'E:\', 'F:\')) {
        if (Test-Path -LiteralPath $drive -PathType Container) { $searchRoots.Add($drive) }
    }
    $searchRoots.Add($env:LOCALAPPDATA)
    $searchRoots.Add($env:ProgramFiles)
    $searchRoots.Add((Join-Path $env:LOCALAPPDATA 'Programs'))
    foreach ($root in $searchRoots) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        $dirs = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like 'FluxDown*' }
        foreach ($dir in $dirs) {
            $relay = Join-Path $dir.FullName 'fluxdown_nmh.exe'
            if (Test-Path -LiteralPath $relay -PathType Leaf) {
                Write-Info "relay (directory scan): $relay"
                return (Get-FullPathSafe -Path $relay -Label 'RelayPath')
            }
            $nested = Join-Path $dir.FullName 'portable_data\nmh\com.fluxdown.nmh.json'
            if (Test-Path -LiteralPath $nested -PathType Leaf) {
                try {
                    $parsed = [System.IO.File]::ReadAllText($nested, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
                    if (-not [string]::IsNullOrWhiteSpace([string]$parsed.path)) {
                        $candidates.Add([string]$parsed.path)
                        if (Test-Path -LiteralPath ([string]$parsed.path) -PathType Leaf) {
                            Write-Info "relay (from $nested): $($parsed.path)"
                            return (Get-FullPathSafe -Path ([string]$parsed.path) -Label 'RelayPath')
                        }
                    }
                }
                catch {
                    Write-Warning "cannot parse $nested : $($_.Exception.Message)"
                }
            }
        }
    }
    return ''
}

$targetBrowsers = if ($Browser -eq 'All') { @('Chrome', 'Edge') } else { @($Browser) }
$hive = [Microsoft.Win32.Registry]::CurrentUser
$localAppDataRoot = Get-FullPathSafe -Path $env:LOCALAPPDATA -Label 'LOCALAPPDATA'
$dataRoot = Get-FullPathSafe -Path (Join-Path $localAppDataRoot 'FluxDownCloudExtension') -Label 'DataDirectory'
$_ = Assert-UnderDirectory -ChildPath $dataRoot -ParentPath $localAppDataRoot -Label 'FluxDownCloudExtension data directory'
$backupDirectory = Join-Path $dataRoot 'backups'
$manifestDirectory = Join-Path $dataRoot 'nmh'
$projectManifest = Join-Path $manifestDirectory "$HostName.json"

if (Test-ReparsePoint -Path $dataRoot) {
    Fail "DataDirectory or one of its parents is a reparse point, refusing: $dataRoot"
}

# --- Restore ----------------------------------------------------------
if ($Restore.IsPresent) {
    if ([string]::IsNullOrWhiteSpace($BackupPath)) {
        Fail '-Restore requires -BackupPath.'
    }
    $backupFile = Assert-UnderDirectory -ChildPath $BackupPath -ParentPath $backupDirectory -Label 'BackupPath'
    if (-not (Test-Path -LiteralPath $backupFile -PathType Leaf)) {
        Fail "backup file not found: $backupFile"
    }
    if (Test-ReparsePoint -Path $backupFile) {
        Fail "backup file is a reparse point, refusing to read: $backupFile"
    }

    $backup = $null
    try {
        $backup = [System.IO.File]::ReadAllText($backupFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    }
    catch {
        Fail "cannot parse backup JSON: $backupFile ; $($_.Exception.Message)"
    }
    if ($backup.schema -ne 1 -or $null -eq $backup.browsers) {
        Fail "unsupported backup format: $backupFile"
    }
    # Backups written before the private host name existed recorded the OFFICIAL
    # key values (com.fluxdown.nmh) and have no hostName field. Restoring one
    # would point this project's key at the desktop app's manifest, so refuse it
    # instead of silently writing the wrong value.
    if ($backup.hostName -ne $HostName) {
        Fail "backup belongs to a different/older host name (expected '$HostName', found '$($backup.hostName)'); refusing to restore: $backupFile"
    }

    Write-Info 'Restore will rewrite the following HKCU default values:'
    foreach ($name in $targetBrowsers) {
        $subKeyPath = $browserKeys[$name]
        if (-not $backup.browsers.PSObject.Properties[$name]) {
            Write-Host "  - HKCU\$subKeyPath : [not in backup, skipped]"
            continue
        }
        $entry = $backup.browsers.PSObject.Properties[$name].Value
        $before = Get-RegistryDefault -Hive $hive -SubKeyPath $subKeyPath
        $after = if ($null -eq $entry.defaultValue) { '<remove default value>' } else { [string]$entry.defaultValue }
        Write-Host "  - HKCU\$subKeyPath : $(if ($before.Exists -and $null -ne $before.Value) { $before.Value } else { '<no default value>' }) -> $after"
    }

    if (-not $PSCmdlet.ShouldProcess("HKCU NativeMessagingHosts\$HostName", 'restore from backup')) {
        Write-Info 'WhatIf / declined: registry untouched.'
        return
    }

    foreach ($name in $targetBrowsers) {
        $subKeyPath = $browserKeys[$name]
        if (-not $backup.browsers.PSObject.Properties[$name]) { continue }
        $entry = $backup.browsers.PSObject.Properties[$name].Value
        try {
            if ($null -eq $entry.defaultValue) {
                Remove-RegistryDefault -Hive $hive -SubKeyPath $subKeyPath
            }
            else {
                Set-RegistryDefault -Hive $hive -SubKeyPath $subKeyPath -Value ([string]$entry.defaultValue)
            }
        }
        catch {
            Fail "restoring HKCU\$subKeyPath failed: $($_.Exception.Message)"
        }
    }

    Write-Info "restore finished; backup kept at $backupFile"
    return
}

# --- Uninstall --------------------------------------------------------
if ($Uninstall.IsPresent) {
    $manifestInUse = $false
    foreach ($name in @('Chrome', 'Edge')) {
        if ($targetBrowsers -contains $name) { continue }
        $registration = Get-RegistryDefault -Hive $hive -SubKeyPath $browserKeys[$name]
        if ($registration.Value -eq $projectManifest) { $manifestInUse = $true }
    }
    foreach ($name in $targetBrowsers) {
        $subKeyPath = $browserKeys[$name]
        Write-Host "  - HKCU\$subKeyPath -> <removed>"
    }
    Write-Host "  - $projectManifest -> $(if ($manifestInUse) { '<kept for another browser>' } else { '<removed>' })"
    if (-not $PSCmdlet.ShouldProcess("HKCU NativeMessagingHosts\$HostName", 'uninstall registration')) {
        Write-Info 'WhatIf / declined: nothing removed.'
        return
    }
    foreach ($name in $targetBrowsers) {
        Remove-RegistryKeyTree -Hive $hive -SubKeyPath $browserKeys[$name]
    }
    if (-not $manifestInUse -and (Test-Path -LiteralPath $projectManifest -PathType Leaf)) {
        Remove-Item -LiteralPath $projectManifest -Force
    }
    Write-Info 'uninstall finished. The official com.fluxdown.nmh registration is untouched.'
    return
}

# --- Install ----------------------------------------------------------
if (-not [string]::IsNullOrWhiteSpace($BackupPath)) {
    Fail '-BackupPath is only valid together with -Restore.'
}
if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
    Fail '-ExtensionId is required in install mode (32 lowercase a-p characters).'
}
if ($ExtensionId -cnotmatch '^[a-p]{32}$') {
    Fail "extension ID must be 32 lowercase a-p characters: $ExtensionId"
}

$resolvedRelay = Resolve-RelayExe -explicitRelay $RelayPath -officialManifestHint $HostManifest
if ([string]::IsNullOrWhiteSpace($resolvedRelay)) {
    Fail 'could not find fluxdown_nmh.exe. Install/start FluxDown desktop once, or pass -RelayPath "D:\FluxDown-<version>-windows-x64\fluxdown_nmh.exe".'
}
if (-not (Test-Path -LiteralPath $resolvedRelay -PathType Leaf)) {
    Fail "relay executable not found: $resolvedRelay"
}
if (Test-ReparsePoint -Path $resolvedRelay) {
    Fail "relay executable is a reparse point, refusing to use: $resolvedRelay"
}
$_ = Assert-UnderDirectory -ChildPath $projectManifest -ParentPath $dataRoot -Label 'project manifest target'

$customOrigin = "chrome-extension://$ExtensionId/"
$allowedOrigins = @()
if (Test-Path -LiteralPath $projectManifest -PathType Leaf) {
    try {
        $existingManifest = [System.IO.File]::ReadAllText($projectManifest, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
        if ($existingManifest.name -cne $HostName -or $existingManifest.type -cne 'stdio' -or
            $existingManifest.allowed_origins -isnot [array]) {
            throw 'unexpected native host manifest format'
        }
        foreach ($origin in $existingManifest.allowed_origins) {
            if ($origin -isnot [string] -or $origin -cnotmatch '\Achrome-extension://[a-p]{32}/\z') {
                throw 'invalid origin in the existing project manifest'
            }
            if ($allowedOrigins -cnotcontains $origin) { $allowedOrigins += $origin }
        }
    }
    catch {
        Fail "cannot preserve the existing bridge registration: $projectManifest ; $($_.Exception.Message)"
    }
}
if ($allowedOrigins -cnotcontains $customOrigin) { $allowedOrigins += $customOrigin }
$projectManifestObject = [ordered]@{
    name            = $HostName
    description     = 'FluxDown Native Messaging Host (FluxDown Cloud extension)'
    path            = $resolvedRelay
    type            = 'stdio'
    allowed_origins = $allowedOrigins
}
$projectManifestJson = $projectManifestObject | ConvertTo-Json -Depth 5

$snapshot = [ordered]@{
    schema          = 1
    createdAt       = (Get-Date).ToString('o')
    hostName        = $HostName
    relayPath       = $resolvedRelay
    projectManifest = $projectManifest
    browsers        = [ordered]@{}
}
foreach ($name in @('Chrome', 'Edge')) {
    $subKeyPath = $browserKeys[$name]
    $entry = Get-RegistryDefault -Hive $hive -SubKeyPath $subKeyPath
    $snapshot.browsers[$name] = [ordered]@{
        registryKey    = "HKCU\$subKeyPath"
        keyExisted     = [bool]$entry.Exists
        defaultValue   = $entry.Value
        valueKind      = $entry.Kind
    }
}

$backupName = 'nmhcloud-backup-' + (Get-Date).ToString('yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.json'
$backupFile = Assert-UnderDirectory -ChildPath (Join-Path $backupDirectory $backupName) -ParentPath $backupDirectory -Label 'backup target'

Write-Info 'install will change the following:'
Write-Host "  - relay executable (read only) : $resolvedRelay"
Write-Host "  - project manifest             : $projectManifest"
Write-Host "  - backup file                  : $backupFile"
foreach ($name in $targetBrowsers) {
    $subKeyPath = $browserKeys[$name]
    $before = Get-RegistryDefault -Hive $hive -SubKeyPath $subKeyPath
    Write-Host "  - HKCU\$subKeyPath : $(if ($before.Exists -and $null -ne $before.Value) { $before.Value } else { '<none>' }) -> $projectManifest"
}
Write-Host "  - allowed_origins: $($allowedOrigins -join ', ')"
Write-Host "  - official com.fluxdown.nmh keys: NOT touched (desktop-app owned)"

if (-not $PSCmdlet.ShouldProcess("HKCU NativeMessagingHosts\$HostName", 'install')) {
    Write-Info 'WhatIf / declined: no file or registry write.'
    return
}

try {
    Write-JsonAtomic -Path $backupFile -Content ($snapshot | ConvertTo-Json -Depth 8)
    Write-JsonAtomic -Path $projectManifest -Content $projectManifestJson
    # Read the file back before touching the registry: "reported success but the
    # file was never rewritten" is the failure mode users hit silently, because
    # the browser then reports a forbidden host and nothing else.
    $written = [System.IO.File]::ReadAllText($projectManifest, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    $writtenOrigins = @($written.allowed_origins | Where-Object { $_ })
    if ($writtenOrigins.Count -ne $allowedOrigins.Count -or
        (Compare-Object -ReferenceObject $allowedOrigins -DifferenceObject $writtenOrigins -CaseSensitive)) {
        throw ("manifest read-back mismatch: allowed_origins = [{0}]" -f ($writtenOrigins -join ', '))
    }
}
catch {
    Fail "writing files failed: $($_.Exception.Message)"
}

try {
    foreach ($name in $targetBrowsers) {
        Set-RegistryDefault -Hive $hive -SubKeyPath $browserKeys[$name] -Value $projectManifest
    }
}
catch {
    Write-Warning "writing the registry failed, rolling the touched keys back: $($_.Exception.Message)"
    foreach ($name in @('Chrome', 'Edge')) {
        $subKeyPath = $browserKeys[$name]
        $entry = $snapshot.browsers[$name]
        try {
            if ($null -eq $entry.defaultValue) {
                Remove-RegistryDefault -Hive $hive -SubKeyPath $subKeyPath
            }
            else {
                Set-RegistryDefault -Hive $hive -SubKeyPath $subKeyPath -Value ([string]$entry.defaultValue)
            }
        }
        catch {
            Write-Warning "rollback of HKCU\$subKeyPath failed: $($_.Exception.Message)"
        }
    }
    Fail "install incomplete. backup: $backupFile ; project manifest: $projectManifest"
}

Write-Info 'install finished.'
Write-Info "host name : $HostName"
Write-Info "backup    : $backupFile"
Write-Info "manifest  : $projectManifest"
Write-Info "verified  : allowed_origins contains $customOrigin"
Write-Info ("mtime     : {0}" -f (Get-Item -LiteralPath $projectManifest).LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))
Write-Info 'restart the browser, then confirm the popup header shows Connected.'
