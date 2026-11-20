<#
 * FluxDown 云盘下载拦截扩展 - 一键卸载
 *
 * 只清理本项目自己写入的内容：
 *   1. HKCU 下 com.fluxdown.cloud.nmh 的两个 NativeMessagingHosts 键 + 项目清单
 *   2. 桌面快捷方式 "FluxDown Cloud (Edge).lnk" / "FluxDown Cloud (Chrome).lnk"
 *   3. 本项追加到用户 PATH 的 ...\FluxDownCloudExtension\ffmpeg\bin
 *   4. %LOCALAPPDATA%\FluxDownCloudExtension 下的 extension / ffmpeg / nmh
 *      （backups 默认保留，可用 -KeepBackups 明确保留）
 *
 * 不会触碰官方 com.fluxdown.nmh 注册、FluxDown 安装目录或用户下载的文件。
 *
 * 本文件必须保存为 UTF-8 WITH BOM：Windows PowerShell 5.1 读取无 BOM 的
 * 非 ASCII .ps1 会按 ANSI 解码，导致中文乱码或解析失败。
 *
 * 用法：
 *   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
 *   ... -Force          跳过确认提示
 *   ... -KeepBackups    保留 backups 目录
 *   ... -WhatIf         只显示将要执行的删除，不做修改
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [switch]$Force,
    [switch]$KeepBackups
)

$ErrorActionPreference = 'Stop'

$installRoot   = Join-Path $env:LOCALAPPDATA 'FluxDownCloudExtension'
$extensionRoot = Join-Path $installRoot 'extension'
$ffmpegRoot    = Join-Path $installRoot 'ffmpeg'
$ffmpegBin     = Join-Path $ffmpegRoot 'bin'
$nmhRoot       = Join-Path $installRoot 'nmh'
$backupRoot    = Join-Path $installRoot 'backups'
$shortcutNames = @('FluxDown Cloud (Edge).lnk', 'FluxDown Cloud (Chrome).lnk')

function Write-Step([string]$Text) { Write-Host ''; Write-Host ('==> ' + $Text) -ForegroundColor Cyan }
function Write-Ok([string]$Text)   { Write-Host ('    OK  ' + $Text) -ForegroundColor Green }
function Write-Skip([string]$Text) { Write-Host ('    --  ' + $Text) -ForegroundColor DarkGray }
function Write-Warn([string]$Text) { Write-Host ('    !!  ' + $Text) -ForegroundColor Yellow }

function Get-SafeChildPath([string]$Path) {
    $full = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
    $root = [System.IO.Path]::GetFullPath($installRoot).TrimEnd('\')
    if ($full.Length -le $root.Length -or
        -not $full.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝操作安装目录之外的路径：$full"
    }
    return $full
}

function Remove-ProjectDirectory([string]$Path, [string]$Label) {
    $safe = Get-SafeChildPath $Path
    if (-not (Test-Path -LiteralPath $safe -PathType Container)) {
        Write-Skip "$Label 不存在，跳过"
        return
    }
    if ($WhatIfPreference) {
        Write-Skip "[WhatIf] 将删除 $Label：$safe"
        return
    }
    Remove-Item -LiteralPath $safe -Recurse -Force
    Write-Ok "已删除 $Label"
}

function Remove-ProjectShortcut([string]$Name) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    if ([string]::IsNullOrWhiteSpace($desktop)) {
        Write-Skip "无法定位桌面目录，跳过 $Name"
        return
    }
    $path = Join-Path $desktop $Name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Write-Skip "快捷方式不存在：$Name"
        return
    }
    if ($WhatIfPreference) {
        Write-Skip "[WhatIf] 将删除快捷方式：$path"
        return
    }
    Remove-Item -LiteralPath $path -Force
    Write-Ok "已删除快捷方式：$Name"
}

function Remove-FfmpegFromUserPath {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ([string]::IsNullOrWhiteSpace($userPath)) {
        Write-Skip '用户 PATH 为空，无需处理'
        return
    }

    $target = ([System.IO.Path]::GetFullPath($ffmpegBin)).TrimEnd('\')
    $kept = New-Object 'System.Collections.Generic.List[string]'
    $removed = 0

    foreach ($entry in ($userPath -split ';')) {
        if ([string]::IsNullOrWhiteSpace($entry)) { continue }
        $candidate = $entry.Trim()
        $same = $false
        try {
            $resolved = ([System.IO.Path]::GetFullPath($candidate)).TrimEnd('\')
            $same = [string]::Equals($resolved, $target, [System.StringComparison]::OrdinalIgnoreCase)
        }
        catch {
            $same = $false
        }
        if ($same) { $removed++; continue }
        $kept.Add($candidate)
    }

    if ($removed -eq 0) {
        Write-Skip '用户 PATH 中没有本项目的 FFmpeg 目录'
        return
    }
    if ($WhatIfPreference) {
        Write-Skip "[WhatIf] 将从用户 PATH 移除：$target"
        return
    }
    [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), 'User')
    Write-Ok "已从用户 PATH 移除：$target"
}

Write-Host ''
Write-Host 'FluxDown 云盘下载拦截扩展 - 卸载' -ForegroundColor White
Write-Host '----------------------------------------' -ForegroundColor DarkGray
Write-Host ("安装目录：{0}" -f $installRoot)
Write-Host ''
Write-Host '将删除：' -ForegroundColor White
Write-Host '  - Native Messaging 注册（com.fluxdown.cloud.nmh）与项目清单'
Write-Host '  - 桌面快捷方式 FluxDown Cloud (Edge/Chrome)'
Write-Host '  - 用户 PATH 中的 FFmpeg 目录'
Write-Host ('  - {0}\extension 与 {0}\ffmpeg' -f $installRoot)
if ($KeepBackups) {
    Write-Host '保留：backups 目录（-KeepBackups）'
} else {
    Write-Host ('  - {0}\backups（可用 -KeepBackups 保留）' -f $installRoot)
}
Write-Host ''
Write-Host '不会动：官方 com.fluxdown.nmh 注册、FluxDown 安装目录、已下载文件。' -ForegroundColor DarkGray

$running = @(Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match '^(flux_down|fluxdown-desktop|fluxdown-agent|fluxdownd)$' })
if ($running.Count -gt 0 -and -not $Force) {
    Write-Host ''
    Write-Warn '检测到 FluxDown 桌面端正在运行。'
    Write-Host '请先退出 FluxDown（含托盘图标），再重新运行本脚本；' -ForegroundColor Yellow
    Write-Host '确实要强制卸载请加 -Force 参数。' -ForegroundColor Yellow
    exit 1
}

if (-not $Force -and -not $WhatIfPreference) {
    Write-Host ''
    $answer = Read-Host '确认卸载？输入 y 回车继续，其他任意输入取消'
    if ($answer -notmatch '^(y|yes)$') {
        Write-Host '已取消，未做任何修改。' -ForegroundColor Yellow
        exit 0
    }
}

$failed = $false

Write-Step '移除 Native Messaging 注册'
$hostScript = Join-Path $PSScriptRoot 'install-native-host.ps1'
if (Test-Path -LiteralPath $hostScript -PathType Leaf) {
    $nativeArgs = @{
        Uninstall = $true
        Browser   = 'All'
        Confirm   = $false
    }
    if ($WhatIfPreference) { $nativeArgs['WhatIf'] = $true }
    try {
        & $hostScript @nativeArgs
    }
    catch {
        Write-Warn ('Native Messaging 注销失败：' + $_.Exception.Message)
        $failed = $true
    }
} else {
    Write-Warn "未找到 $hostScript，跳过注册表清理。"
    Write-Warn '可手动删除 HKCU 下 Chrome/Edge 的 NativeMessagingHosts\com.fluxdown.cloud.nmh。'
}

Write-Step '移除桌面快捷方式'
foreach ($name in $shortcutNames) { Remove-ProjectShortcut $name }

Write-Step '移除用户 PATH 中的 FFmpeg 目录'
Remove-FfmpegFromUserPath

Write-Step '移除已安装的扩展与 FFmpeg'
Remove-ProjectDirectory $extensionRoot '扩展目录'
Remove-ProjectDirectory $ffmpegRoot 'FFmpeg 目录'
Remove-ProjectDirectory $nmhRoot '项目 NMH 清单目录'

if (-not $KeepBackups) {
    Write-Step '移除备份目录'
    Remove-ProjectDirectory $backupRoot '备份目录'
}

if (-not $WhatIfPreference -and (Test-Path -LiteralPath $installRoot -PathType Container)) {
    $leftover = @(Get-ChildItem -LiteralPath $installRoot -Force -ErrorAction SilentlyContinue)
    if ($leftover.Count -eq 0) {
        Remove-Item -LiteralPath $installRoot -Force
        Write-Ok '已删除空的安装根目录'
    } else {
        Write-Skip ("安装根目录仍有内容，保留：{0}" -f $installRoot)
    }
}

Write-Host ''
Write-Host '卸载完成。' -ForegroundColor Green
Write-Host ''
Write-Host '最后一步（浏览器不允许脚本自动卸载扩展）：' -ForegroundColor White
Write-Host '  1. 打开 edge://extensions/ 或 chrome://extensions/'
Write-Host '  2. 找到 "FluxDown Cloud"，点"移除"'
Write-Host '  3. 重新打开浏览器'
Write-Host ''
Write-Host '如果曾在 FluxDown「设置 -> 组件」里手动填过 FFmpeg 路径，请在那里清空。' -ForegroundColor DarkGray
Write-Host '重启后系统 PATH 才会彻底不含旧目录。' -ForegroundColor DarkGray

if ($failed) {
    exit 1
}
