<#
 * FluxDown Cloud - one-click install / update for Windows.
 *
 * What it does in one run:
 *   1. Detects Edge / Chrome and the existing sideloaded extension (if any).
 *   2. Copies the bundled extension into a stable per-user folder
 *      (%LOCALAPPDATA%\FluxDownCloudExtension\extension\<browser>-mv3),
 *      or updates the folder the browser already loads.
 *   3. Registers the private Native Messaging host (com.fluxdown.cloud.nmh)
 *      for the resulting extension ID.
 *   4. Installs the bundled FFmpeg and adds it to the per-user PATH.
 *      Restarts FluxDown afterwards (when it is running and idle) so the
 *      engine actually sees the new FFmpeg.
 *   5. Creates a desktop shortcut that always launches the browser with
 *      --load-extension so no manual "Load unpacked" is needed.
 *
 * Runs on Windows PowerShell 5.1. This file must stay UTF-8 WITH BOM,
 * otherwise 5.1 mis-decodes the Chinese strings.
 *
 * Usage:
 *   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\one-click.ps1
 *   ... -Browser Chrome
 *   ... -NoLaunch
 *   ... -NoFfmpeg
 *   ... -NoRestartFluxDown
#>
[CmdletBinding()]
param(
    [ValidateSet('Auto', 'Edge', 'Chrome', 'All')]
    [string]$Browser = 'Auto',
    [switch]$NoLaunch,
    [switch]$NoFfmpeg,
    [switch]$NoRestartFluxDown,
    # 安装日志位置；省略时写入 %LOCALAPPDATA%\FluxDownCloudExtension\logs。
    # 日志包含每一步的结果与扩展 ID，出问题时可整份发给分享者。
    [string]$LogPath
)

$ErrorActionPreference = 'Stop'
$ConfirmPreference = 'None'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$installRoot = Join-Path $env:LOCALAPPDATA 'FluxDownCloudExtension'
$extensionRoot = Join-Path $installRoot 'extension'
$ffmpegDir = Join-Path $installRoot 'ffmpeg\bin'
$backupDir = Join-Path $installRoot 'backups'

$script:step = 0

function Write-Head([string]$Text) {
    Write-Host ""
    Write-Host $Text -ForegroundColor Cyan
    Write-Log 'HEAD' $Text
}

function Write-Step([string]$Text) {
    $script:step++
    Write-Host ("[{0}] {1}" -f $script:step, $Text) -ForegroundColor White
    Write-Log 'STEP' $Text
}

function Write-Ok([string]$Text) {
    Write-Host ("    OK  " + $Text) -ForegroundColor Green
    Write-Log 'OK  ' $Text
}

function Write-Note([string]$Text) {
    Write-Host ("    ..  " + $Text) -ForegroundColor DarkGray
    Write-Log 'NOTE' $Text
}

function Write-WarnMsg([string]$Text) {
    Write-Host ("    !!  " + $Text) -ForegroundColor Yellow
    Write-Log 'WARN' $Text
}

function Fail([string]$Text) {
    Write-Host ""
    Write-Host ("[失败] " + $Text) -ForegroundColor Red
    Write-Log 'FAIL' $Text
    if ($script:logFile) {
        Write-Host ("安装日志：{0}" -f $script:logFile) -ForegroundColor Red
        Write-Host "请把这份日志（或上面的报错截图）发给分享者。" -ForegroundColor Red
    }
    else {
        Write-Host "请把上面的报错截图发给分享者。" -ForegroundColor Red
    }
    exit 1
}

# ---------------------------------------------------------------- logging
# 安装失败时最难查的是「脚本到底走到哪一步」。所有输出同时落一份带时间戳的
# 文本日志，并在结尾追加可机读的 SUMMARY 行。

$script:logFile = $null

function Write-Log([string]$Level, [string]$Text) {
    if (-not $script:logFile) { return }
    try {
        $line = "{0} [{1}] {2}`r`n" -f (Get-Date).ToString('HH:mm:ss.fff'), $Level, $Text
        [System.IO.File]::AppendAllText($script:logFile, $line, (New-Object System.Text.UTF8Encoding($false)))
    }
    catch {
        # 日志写不进去不能影响安装本身。
    }
}

function Initialize-Log([string]$Path) {
    try {
        if ([string]::IsNullOrWhiteSpace($Path)) {
            $Path = Join-Path (Join-Path $installRoot 'logs') ('install-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
        }
        $directory = Split-Path -Parent $Path
        if ($directory -and -not (Test-Path -LiteralPath $directory -PathType Container)) {
            New-Item -ItemType Directory -Path $directory -Force | Out-Null
        }
        $script:logFile = [System.IO.Path]::GetFullPath($Path)
        Write-Log 'INFO' '=== FluxDown Cloud one-click installer ==='
        Write-Log 'INFO' ("time        : {0}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))
        Write-Log 'INFO' ("powershell  : {0}" -f $PSVersionTable.PSVersion)
        Write-Log 'INFO' ("args        : Browser={0} NoLaunch={1} NoFfmpeg={2} NoRestartFluxDown={3}" -f $Browser, [bool]$NoLaunch, [bool]$NoFfmpeg, [bool]$NoRestartFluxDown)
        Write-Log 'INFO' ("package root: {0}" -f $root)
        Write-Log 'INFO' ("install root: {0}" -f $installRoot)
        $manifest = Join-Path $root 'extension\edge-mv3\manifest.json'
        if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
            $manifest = Join-Path $root 'extension\chrome-mv3\manifest.json'
        }
        if (Test-Path -LiteralPath $manifest -PathType Leaf) {
            try {
                $version = (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).version
                Write-Log 'INFO' ("package ver : {0}" -f $version)
            }
            catch { }
        }
    }
    catch {
        $script:logFile = $null
    }
}

function Get-FullPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
    try {
        return [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    }
    catch {
        return $Path.TrimEnd('\', '/')
    }
}

function Test-SamePath([string]$A, [string]$B) {
    return [string]::Equals((Get-FullPath $A), (Get-FullPath $B), [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-BrowserExe([string]$Name) {
    $candidates = if ($Name -eq 'Edge') {
        @(
            "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
            "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
            "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
        )
    }
    else {
        @(
            "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
            "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
            "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
        )
    }
    foreach ($path in $candidates) {
        if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) { return $path }
    }
    return $null
}

function Get-BuildFolderName([string]$Name) {
    if ($Name -eq 'Edge') { return 'edge-mv3' }
    return 'chrome-mv3'
}

function Get-BrowserRoot([string]$Name) {
    if ($Name -eq 'Edge') {
        return Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'
    }
    return Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
}

# Reads Preferences / Secure Preferences and returns the sideloaded extension
# whose folder name ends with the given build folder name. Mirrors the browser's
# own ID, which is authoritative when it differs from the path-derived value.
function Find-InstalledExtension([string]$Name, [string]$FolderName) {
    $rootPath = Get-BrowserRoot $Name
    if (-not (Test-Path -LiteralPath $rootPath)) { return $null }

    $profiles = @()
    foreach ($dir in Get-ChildItem -LiteralPath $rootPath -Directory -ErrorAction SilentlyContinue) {
        if ($dir.Name -eq 'Default' -or $dir.Name -like 'Profile *') { $profiles += $dir.FullName }
    }

    $pattern = [regex]::Escape($FolderName)
    $found = @()
    foreach ($profileDir in $profiles) {
        foreach ($fileName in @('Preferences', 'Secure Preferences')) {
            $prefs = Join-Path $profileDir $fileName
            if (-not (Test-Path -LiteralPath $prefs -PathType Leaf)) { continue }
            $raw = Get-Content -LiteralPath $prefs -Raw -ErrorAction SilentlyContinue
            if (-not $raw) { continue }

            $idMatches = [regex]::Matches($raw, '"([a-p]{32})"\s*:\s*\{')
            $pathMatches = [regex]::Matches($raw, '"path"\s*:\s*"([^"]*)"')
            foreach ($pm in $pathMatches) {
                $path = $pm.Groups[1].Value -replace '\\\\', '\'
                if ($path -notmatch "\\$pattern\\?$") { continue }
                $owner = $null
                foreach ($im in $idMatches) {
                    if ($im.Index -ge $pm.Index) { break }
                    $owner = $im.Groups[1].Value
                }
                if (-not $owner) { continue }
                if (-not (Test-Path -LiteralPath (Join-Path $path 'manifest.json') -PathType Leaf)) { continue }
                $found += [pscustomobject]@{ Browser = $Name; Profile = $profileDir; Id = $owner; Path = $path }
            }
        }
    }

    if ($found.Count -eq 0) { return $null }

    # Prefer an install that already lives in our managed folder.
    foreach ($item in $found) {
        if ((Get-FullPath $item.Path).StartsWith((Get-FullPath $extensionRoot), [System.StringComparison]::OrdinalIgnoreCase)) {
            return $item
        }
    }
    return $found[0]
}

# Chromium derives an unpacked extension's ID from the absolute folder path:
# SHA-256 over the UTF-16LE path bytes, first 16 bytes, each nibble mapped to
# 'a'..'p'. Verified against this machine's Edge install.
function Get-UnpackedExtensionId([string]$Path) {
    $full = Get-FullPath $Path
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash([System.Text.Encoding]::Unicode.GetBytes($full))
    }
    finally {
        $sha.Dispose()
    }
    $sb = New-Object System.Text.StringBuilder
    for ($i = 0; $i -lt 16; $i++) {
        $b = $hash[$i]
        [void]$sb.Append([char](97 + ($b -shr 4)))
        [void]$sb.Append([char](97 + ($b -band 15)))
    }
    return $sb.ToString()
}

function Copy-ExtensionFiles([string]$Source, [string]$Target) {
    if (Test-SamePath $Source $Target) { return }
    if (-not (Test-Path -LiteralPath (Join-Path $Source 'manifest.json') -PathType Leaf)) {
        throw "extension source is incomplete: $Source"
    }
    New-Item -ItemType Directory -Path $Target -Force | Out-Null
    Copy-Item -Path (Join-Path $Source '*') -Destination $Target -Recurse -Force
}

function Register-Bridge([string]$Name, [string]$ExtensionId) {
    $installer = Join-Path $scriptDir 'install-native-host.ps1'
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
        throw "install-native-host.ps1 is missing"
    }
    $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $installer `
        -ExtensionId $ExtensionId -Browser $Name 2>&1
    $code = $LASTEXITCODE
    foreach ($line in $output) {
        Write-Host ("    " + $line) -ForegroundColor DarkGray
        Write-Log 'BRIDGE' ([string]$line)
    }
    Write-Log 'BRIDGE' ("install-native-host.ps1 exit code = {0} (browser={1}, id={2})" -f $code, $Name, $ExtensionId)
    return $code
}

<#
 * 写完白名单后回读校验：确认 allowed_origins 真的包含本次的扩展 ID。
 * 之前只信任子进程退出码，出现「注册报成功但文件没改」时无从发现。
#>
function Test-BridgeWhitelist([string]$ExtensionId) {
    $manifest = Join-Path $installRoot 'nmh\com.fluxdown.cloud.nmh.json'
    $origin = "chrome-extension://$ExtensionId/"
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
        return [pscustomobject]@{
            Ok     = $false
            Path   = $manifest
            Detail = '白名单文件不存在'
            Origins = ''
        }
    }
    try {
        $parsed = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        return [pscustomobject]@{
            Ok     = $false
            Path   = $manifest
            Detail = ("白名单文件无法解析：{0}" -f $_.Exception.Message)
            Origins = ''
        }
    }
    $origins = @($parsed.allowed_origins | Where-Object { $_ })
    $hit = $origins -contains $origin
    return [pscustomobject]@{
        Ok      = $hit
        Path    = $manifest
        Origins = ($origins -join ', ')
        Detail  = if ($hit) { "allowed_origins 含 $origin" }
                  else { "allowed_origins = [$($origins -join ', ')]，缺少 $origin" }
    }
}

function Send-EnvironmentChange {
    try {
        if (-not ('Win32.NativeMethods' -as [type])) {
            Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
        }
        $result = [UIntPtr]::Zero
        [void][Win32.NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
    }
    catch {
        # Best effort only; new processes pick the PATH up after the next logon.
    }
}

function Install-Ffmpeg {
    $source = Join-Path $root 'tools\ffmpeg'
    if (-not (Test-Path -LiteralPath (Join-Path $source 'ffmpeg.exe') -PathType Leaf)) {
        return [pscustomobject]@{ Installed = $false; PathAdded = $false; Reason = '安装包内未找到 tools\ffmpeg\ffmpeg.exe' }
    }

    $existed = Test-Path -LiteralPath (Join-Path $ffmpegDir 'ffmpeg.exe') -PathType Leaf
    $copied = $false
    foreach ($fileName in @('ffmpeg.exe', 'ffprobe.exe')) {
        $src = Join-Path $source $fileName
        if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { continue }
        $dst = Join-Path $ffmpegDir $fileName
        if (-not (Test-Path -LiteralPath $dst -PathType Leaf) -or
            (Get-Item -LiteralPath $dst).Length -ne (Get-Item -LiteralPath $src).Length) {
            New-Item -ItemType Directory -Path $ffmpegDir -Force | Out-Null
            Copy-Item -LiteralPath $src -Destination $dst -Force
            $copied = $true
        }
    }

    $notice = Join-Path $source 'README.txt'
    if (Test-Path -LiteralPath $notice -PathType Leaf) {
        New-Item -ItemType Directory -Path $ffmpegDir -Force | Out-Null
        Copy-Item -LiteralPath $notice -Destination (Join-Path $ffmpegDir 'README.txt') -Force
    }

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($null -eq $userPath) { $userPath = '' }
    $alreadyOurs = $false
    $otherFfmpeg = $false
    foreach ($entry in ($userPath -split ';')) {
        if (-not $entry) { continue }
        if (Test-SamePath $entry $ffmpegDir) { $alreadyOurs = $true; continue }
        if (Test-Path -LiteralPath (Join-Path $entry 'ffmpeg.exe') -PathType Leaf) { $otherFfmpeg = $true }
    }

    $pathAdded = $false
    if (-not $alreadyOurs -and -not $otherFfmpeg) {
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        Set-Content -LiteralPath (Join-Path $backupDir "user-path-$stamp.txt") -Value $userPath -Encoding UTF8
        $trimmed = $userPath.TrimEnd(';')
        $newPath = if ($trimmed) { $trimmed + ';' + $ffmpegDir } else { $ffmpegDir }
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
        Send-EnvironmentChange
        $pathAdded = $true
    }

    $verify = & (Join-Path $ffmpegDir 'ffmpeg.exe') -version 2>&1 | Select-Object -First 1
    if ($LASTEXITCODE -ne 0) {
        return [pscustomobject]@{ Installed = $false; PathAdded = $pathAdded; Reason = 'ffmpeg.exe 无法运行' }
    }

    return [pscustomobject]@{
        Installed = $true
        PathAdded = $pathAdded
        OtherOnPath = $otherFfmpeg
        Copied    = $copied
        Existed   = $existed
        Version   = [string]$verify
        Reason    = ''
    }
}

# ------------------------------------------------------- FluxDown restart
# FFmpeg 靠用户 PATH 生效，而 PATH 在进程启动时就固定了：桌面端已经在跑时，
# 新装的 FFmpeg 它看不到，带独立音轨的 HLS 会被静默降级成「只有画面」。
# 因此装完 FFmpeg 再重启一次桌面端，但先确认没有正在下载的任务。

function Get-FluxDownProcesses {
    return @(Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -match '^(flux_down|fluxdown-desktop|fluxdown-agent|fluxdownd)$' })
}

function Resolve-FluxDownRelay([object[]]$Processes) {
    foreach ($p in $Processes) {
        $dir = $null
        try { $dir = Split-Path -Parent $p.Path } catch { $dir = $null }
        if (-not $dir) { continue }
        $relay = Join-Path $dir 'fluxdown_nmh.exe'
        if (Test-Path -LiteralPath $relay -PathType Leaf) { return $relay }
    }
    return $null
}

# Native Messaging 帧：4 字节小端长度 + UTF-8 JSON。必须用管道启动中继
# （文件重定向会被当成"直接运行"而打印帮助）。
function Invoke-NmhAction([string]$Relay, [string]$Origin, [string]$Action, [int]$TimeoutMs) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Relay
    $psi.Arguments = $Origin
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $process = $null
    try {
        $process = [System.Diagnostics.Process]::Start($psi)
        $payload = '{"action":"' + $Action + '","msg_id":1}'
        $body = [System.Text.Encoding]::UTF8.GetBytes($payload)
        $header = [BitConverter]::GetBytes([int]$body.Length)
        $stdin = $process.StandardInput.BaseStream
        $stdin.Write($header, 0, 4)
        $stdin.Write($body, 0, $body.Length)
        $stdin.Flush()

        $buffer = New-Object byte[] 65536
        $all = New-Object System.IO.MemoryStream
        $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
        while ((Get-Date) -lt $deadline) {
            $read = $process.StandardOutput.BaseStream.ReadAsync($buffer, 0, $buffer.Length)
            while (-not $read.IsCompleted -and (Get-Date) -lt $deadline) {
                Start-Sleep -Milliseconds 20
            }
            if (-not $read.IsCompleted) { break }
            $count = $read.Result
            if ($count -le 0) { break }
            $all.Write($buffer, 0, $count)
            $bytes = $all.ToArray()
            if ($bytes.Length -ge 4) {
                $size = [BitConverter]::ToInt32($bytes, 0)
                if ($size -ge 0 -and $bytes.Length -ge 4 + $size) {
                    $text = [System.Text.Encoding]::UTF8.GetString($bytes, 4, $size)
                    return ($text | ConvertFrom-Json)
                }
            }
        }
        return $null
    }
    catch {
        return $null
    }
    finally {
        if ($process) {
            try { $process.StandardInput.Close() } catch { }
            try { if (-not $process.HasExited) { $process.Kill() } } catch { }
            try { $process.Dispose() } catch { }
        }
    }
}

function Get-ActiveTaskCount([string]$Relay, [string]$Origin) {
    $response = Invoke-NmhAction $Relay $Origin 'tasks' 8000
    if ($null -eq $response -or -not $response.success) { return $null }
    $active = 0
    foreach ($task in @($response.tasks)) {
        if ($null -eq $task) { continue }
        # 0=pending 1=downloading 5=preparing（与扩展任务轮询一致）
        if (@(0, 1, 5) -contains [int]$task.status) { $active++ }
    }
    return $active
}

function Restart-FluxDownForFfmpeg([string]$ExtensionId) {
    $processes = Get-FluxDownProcesses
    if ($processes.Count -eq 0) { return 'not-running' }

    $relay = Resolve-FluxDownRelay $processes
    if (-not $relay) { return 'no-relay' }
    $origin = 'chrome-extension://' + $ExtensionId + '/'

    $active = Get-ActiveTaskCount $relay $origin
    if ($null -eq $active) { return 'unknown' }
    if ($active -gt 0) { return ('busy:' + $active) }

    $installDir = $null
    foreach ($p in $processes) {
        try { $dir = Split-Path -Parent $p.Path } catch { $dir = $null }
        if ($dir -and (Test-Path -LiteralPath (Join-Path $dir 'fluxdown-desktop.exe'))) {
            $installDir = $dir
            break
        }
    }
    if (-not $installDir) { $installDir = Split-Path -Parent $relay }

    $launcher = Join-Path $installDir 'flux_down.exe'
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
        $launcher = Join-Path $installDir 'fluxdown-desktop.exe'
    }
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { return 'no-launcher' }

    $desktop = @($processes | Where-Object { $_.ProcessName -eq 'fluxdown-desktop' }) | Select-Object -First 1
    if ($desktop) {
        try { [void]$desktop.CloseMainWindow() } catch { }
        Start-Sleep -Seconds 3
    }
    # 守护进程会把子进程拉起来：按 desktop → agent → daemon 顺序结束，再补扫一遍残留。
    foreach ($name in @('fluxdown-desktop', 'fluxdown-agent', 'fluxdownd', 'flux_down')) {
        Get-Process -Name $name -ErrorAction SilentlyContinue |
            ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch { } }
    }
    Start-Sleep -Milliseconds 800
    foreach ($name in @('fluxdown-desktop', 'fluxdown-agent', 'fluxdownd', 'flux_down')) {
        Get-Process -Name $name -ErrorAction SilentlyContinue |
            ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch { } }
    }

    # 本脚本比 PATH 变更更早启动，子进程默认继承本脚本的旧环境块；
    # 先按"机器 + 用户"重新拼一次，重启后的 FluxDown 才能看到新 PATH。
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($machinePath, $userPath) | Where-Object { $_ }) -join ';'

    Start-Process -FilePath $launcher -WorkingDirectory $installDir
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        $caps = Invoke-NmhAction $relay $origin 'capabilities' 4000
        if ($null -ne $caps -and $caps.success) { return 'restarted' }
    }
    return 'restart-timeout'
}

function New-BrowserShortcut([string]$Name, [string]$Exe, [string]$ExtensionPath) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    if ([string]::IsNullOrWhiteSpace($desktop)) { return $null }
    $shortcutPath = Join-Path $desktop ("FluxDown Cloud ({0}).lnk" -f $Name)
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $Exe
    $shortcut.Arguments = "--load-extension=`"$ExtensionPath`""
    $shortcut.WorkingDirectory = Split-Path -Parent $Exe
    $shortcut.Description = 'FluxDown Cloud extension (auto-loaded)'
    $shortcut.Save()
    return $shortcutPath
}

function Wait-InstalledExtension([string]$Name, [string]$FolderName, [int]$Seconds) {
    for ($i = 0; $i -lt $Seconds; $i++) {
        Start-Sleep -Seconds 1
        $hit = Find-InstalledExtension $Name $FolderName
        if ($hit) { return $hit }
    }
    return $null
}

# ---------------------------------------------------------------- main flow

Initialize-Log $LogPath

Write-Head "=== FluxDown Cloud 一键安装 / 更新 ==="
Write-Host ("安装目录：{0}" -f $installRoot) -ForegroundColor DarkGray
if ($script:logFile) {
    Write-Host ("安装日志：{0}" -f $script:logFile) -ForegroundColor DarkGray
}

if (-not (Test-Path -LiteralPath (Join-Path $root 'extension') -PathType Container)) {
    Fail "没有找到 extension 目录。请先完整解压压缩包，再双击 一键安装.cmd。"
}

# Remove the Mark-of-the-Web so the bundled binaries run without SmartScreen
# prompts after the zip has been downloaded from the internet.
try {
    Get-ChildItem -LiteralPath $root -Recurse -File -Include *.ps1, *.exe, *.dll |
        Unblock-File -ErrorAction SilentlyContinue
}
catch { }

$wanted = @()
if ($Browser -eq 'Auto') {
    foreach ($name in @('Edge', 'Chrome')) {
        if (Get-BrowserExe $name) { $wanted += $name }
    }
}
elseif ($Browser -eq 'All') {
    $wanted = @('Edge', 'Chrome')
}
else {
    $wanted = @($Browser)
}

if ($wanted.Count -eq 0) {
    Fail "没有检测到 Edge 或 Chrome。请先安装浏览器，或用 -Browser Edge / -Browser Chrome 指定。"
}

$fluxdownRunning = @(Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match '^fluxdown-(agent|desktop)$|^fluxdownd$' })
if ($fluxdownRunning.Count -eq 0) {
    Write-WarnMsg "FluxDown 桌面端当前没有运行；桥注册仍然可以完成，但下载需要先启动它。"
}

$results = @()

foreach ($name in $wanted) {
    $exe = Get-BrowserExe $name
    if (-not $exe) {
        Write-WarnMsg ("未安装 {0}，跳过。" -f $name)
        continue
    }

    $folderName = Get-BuildFolderName $name
    $source = Join-Path $root ("extension\{0}" -f $folderName)
    if (-not (Test-Path -LiteralPath (Join-Path $source 'manifest.json') -PathType Leaf)) {
        Write-WarnMsg ("安装包缺少 {0}，跳过。" -f $folderName)
        continue
    }

    Write-Head ("--- {0} ---" -f $name)

    Write-Step "检查现有扩展安装"
    $existing = Find-InstalledExtension $name $folderName
    if ($existing) {
        $target = $existing.Path
        Write-Note ("沿用已有目录：{0}" -f $target)
    }
    else {
        $target = Join-Path $extensionRoot $folderName
        Write-Note ("全新安装到：{0}" -f $target)
    }

    Write-Step "复制扩展文件"
    try {
        Copy-ExtensionFiles $source $target
        Write-Ok ("已更新：{0}" -f $target)
        $manifest = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw | ConvertFrom-Json
        Write-Note ("扩展版本：{0}" -f $manifest.version)
    }
    catch {
        Write-WarnMsg ("复制失败：{0}" -f $_.Exception.Message)
        continue
    }

    Write-Step "计算扩展 ID 并注册下载桥"
    $extensionId = if ($existing) { $existing.Id } else { Get-UnpackedExtensionId $target }
    Write-Note ("扩展 ID：{0}" -f $extensionId)
    $code = Register-Bridge $name $extensionId
    $verify = Test-BridgeWhitelist $extensionId
    if ($code -ne 0 -or -not $verify.Ok) {
        Write-WarnMsg "桥注册未完成：白名单没有写入本次扩展 ID。"
        Write-Note ("白名单文件：{0}" -f $verify.Path)
        Write-Note ("回读结果：{0}" -f $verify.Detail)
    }
    else {
        Write-Ok "Native Messaging 已注册（com.fluxdown.cloud.nmh）"
        Write-Note ("白名单已回读确认：{0}" -f $verify.Path)
    }

    Write-Step "创建桌面快捷方式"
    $shortcut = New-BrowserShortcut $name $exe $target
    if ($shortcut) { Write-Ok ("快捷方式：{0}" -f $shortcut) }

    $results += [pscustomobject]@{
        Browser   = $name
        Exe       = $exe
        Target    = $target
        Id        = $extensionId
        Fresh     = (-not $existing)
        Running   = [bool](Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Select-Object -First 1)
        Shortcut  = $shortcut
        Folder    = $folderName
        Version   = $manifest.version
        BridgeOk  = [bool]($code -eq 0 -and $verify.Ok)
        BridgeWhy = $verify.Detail
        BridgeFile = $verify.Path
    }
}

if ($results.Count -eq 0) {
    Fail "没有完成任何浏览器安装，请检查压缩包是否完整。"
}

Write-Head "--- FFmpeg ---"
if ($NoFfmpeg) {
    Write-Step "跳过 FFmpeg（-NoFfmpeg）"
}
else {
    Write-Step "安装内置 FFmpeg"
    $ff = Install-Ffmpeg
    if ($ff.Installed) {
        Write-Ok ("FFmpeg 可用：{0}" -f $ff.Version)
        Write-Note ("路径：{0}" -f $ffmpegDir)
        if ($ff.PathAdded) { Write-Ok "已加入当前用户 PATH（已备份旧 PATH）" }
        elseif ($ff.OtherOnPath) { Write-Note "系统 PATH 中已有其它 FFmpeg，未重复添加" }
        else { Write-Note "PATH 中已存在，无需重复添加" }
    }
    else {
        Write-WarnMsg ("FFmpeg 安装失败：{0}" -f $ff.Reason)
    }
}

# 桌面端进程的 PATH 是启动时继承的：不重启就读不到刚装的 FFmpeg，
# 带独立音轨的 HLS 会只下画面。先确认空闲再自动重启。
if (-not $NoFfmpeg -and -not $NoRestartFluxDown -and $ff -and $ff.Installed) {
    Write-Head "--- 重启 FluxDown ---"
    Write-Step "让桌面端识别新装的 FFmpeg"
    $restart = Restart-FluxDownForFfmpeg $results[0].Id
    switch -Wildcard ($restart) {
        'restarted' { Write-Ok "FluxDown 已重启，FFmpeg 已生效" }
        'not-running' { Write-Note "FluxDown 当前没有运行；下次启动会自动带上 FFmpeg" }
        'busy:*' {
            $busy = ($restart -split ':', 2)[1]
            Write-WarnMsg ("有 {0} 个任务正在下载，未重启；下载完成后请手动退出托盘图标再打开 FluxDown" -f $busy)
        }
        'unknown' { Write-WarnMsg "无法确认是否有下载任务，未自动重启；请手动退出托盘图标后重新打开 FluxDown" }
        'no-relay' { Write-WarnMsg "没有找到 fluxdown_nmh.exe，未自动重启；请手动重启 FluxDown" }
        'no-launcher' { Write-WarnMsg "没有找到 FluxDown 启动程序，未自动重启；请手动重启 FluxDown" }
        'restart-timeout' { Write-WarnMsg "FluxDown 重启后没有响应；请手动确认它已打开" }
        default { Write-WarnMsg ("未自动重启（{0}）；请手动重启 FluxDown" -f $restart) }
    }
}

# Verify the real ID after the browser has loaded a fresh install, then fix the
# whitelist if Chromium derived a different ID than our path hash.
if (-not $NoLaunch) {
    foreach ($item in $results) {
        if ($item.Running) { continue }
        Write-Step ("启动 {0} 以加载扩展" -f $item.Browser)
        Start-Process -FilePath $item.Exe -ArgumentList ("--load-extension=`"{0}`"" -f $item.Target)
        $hit = Wait-InstalledExtension $item.Browser $item.Folder 25
        if ($hit -and $hit.Id -ne $item.Id) {
            Write-WarnMsg ("检测到实际扩展 ID 为 {0}，重新注册桥。" -f $hit.Id)
            [void](Register-Bridge $item.Browser $hit.Id)
            $item.Id = $hit.Id
            $recheck = Test-BridgeWhitelist $hit.Id
            $item.BridgeOk = [bool]$recheck.Ok
            $item.BridgeWhy = $recheck.Detail
            if ($recheck.Ok) { Write-Ok "白名单已按实际 ID 回读确认" }
            else { Write-WarnMsg ("白名单回读仍不含 {0}：{1}" -f $hit.Id, $recheck.Detail) }
        }
        elseif ($hit) {
            Write-Ok ("浏览器已加载扩展（ID {0}）" -f $hit.Id)
            $recheck = Test-BridgeWhitelist $hit.Id
            $item.BridgeOk = [bool]$recheck.Ok
            $item.BridgeWhy = $recheck.Detail
        }
        else {
            Write-WarnMsg "浏览器没有在 25 秒内记录扩展；请用桌面快捷方式启动，或手动加载。"
        }
    }
}

Write-Head "=== 完成 ==="
foreach ($item in $results) {
    Write-Host ("{0}：{1}（v{2}）" -f $item.Browser, $item.Target, $item.Version)
    Write-Host ("  扩展 ID：{0}" -f $item.Id) -ForegroundColor DarkGray
    if ($item.BridgeOk) {
        Write-Host "  下载桥：OK（白名单已包含该 ID）" -ForegroundColor DarkGray
    }
    else {
        Write-Host ("  下载桥：失败 - {0}" -f $item.BridgeWhy) -ForegroundColor Red
        Write-Host ("  白名单：{0}" -f $item.BridgeFile) -ForegroundColor Red
    }
    if ($item.Fresh -and $item.Running) {
        Write-Host ("  首次安装：请先完全退出 {0}，再双击桌面快捷方式「FluxDown Cloud ({0})」启动一次。" -f $item.Browser) -ForegroundColor Yellow
    }
}
$bridgeFailures = @($results | Where-Object { -not $_.BridgeOk })
if ($script:logFile) {
    try {
        $summary = [ordered]@{
            time       = (Get-Date).ToString('o')
            logFile    = $script:logFile
            package    = $root
            results    = @($results | ForEach-Object {
                [ordered]@{
                    browser  = $_.Browser
                    target   = $_.Target
                    version  = $_.Version
                    id       = $_.Id
                    bridgeOk = $_.BridgeOk
                    bridge   = $_.BridgeWhy
                }
            })
            ffmpeg     = if ($ff) { [ordered]@{ installed = $ff.Installed; pathAdded = $ff.PathAdded; version = $ff.Version; reason = $ff.Reason } } else { $null }
        }
        Write-Log 'SUMMARY' ($summary | ConvertTo-Json -Depth 6 -Compress)
    }
    catch { }
    Write-Host ""
    Write-Host ("安装日志：{0}" -f $script:logFile) -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "最后一步（必须）：" -ForegroundColor Yellow
Write-Host "  · 如果浏览器当前开着，请完全退出后重新打开；" -ForegroundColor Yellow
Write-Host "  · 或者打开 edge://extensions/（Chrome 为 chrome://extensions/），" -ForegroundColor Yellow
Write-Host "    在 FluxDown Cloud 卡片上点一次「重新加载」。" -ForegroundColor Yellow
Write-Host ""
Write-Host "更新时：解压新包覆盖旧目录，再双击一次 一键安装.cmd 即可。" -ForegroundColor DarkGray
Write-Host "FFmpeg 首次生效需要重启 FluxDown 桌面端（托盘退出后重新打开）。" -ForegroundColor DarkGray

if ($bridgeFailures.Count -gt 0) {
    Write-Host ""
    Write-Host "下载桥注册失败：扩展会显示「未连接」。请把上面的安装日志发给分享者。" -ForegroundColor Red
    exit 1
}
