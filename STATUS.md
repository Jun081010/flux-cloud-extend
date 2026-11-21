# 项目状态（FluxDown 云盘下载拦截扩展）

最后更新：2026-11-21 · 对应版本 **0.1.48** · 仓库 https://github.com/Jun081010/flux-cloud-extend

这份文件是交接用的「现在到哪了」：已完成的能力、已知缺陷、架构关键点、取证方式、待办。
设计与契约细节见 `PROJECT.md`，使用者文档见 `README.md`。

## 一、当前状态

| 项 | 值 |
| --- | --- |
| 最新发布 | v0.1.48（2026-11-21），分享包 `FluxDown-Cloud-Extension-0.1.48.zip`（60,943,089 B）+ `.zip.sha256` |
| 分享包 SHA256 | `cacb9089143eb9a33bdcf73a864684ec248241d35a85057c542371aa9ef63f19`（60,943,089 B） |
| 扩展版本 | `app/package.json` = manifest = 0.1.48（Edge / Chrome 两套 MV3） |
| 仓库状态 | `main` 已含 2026-11-20 的源码工作区迁移与 STATUS 更新；最近两次提交的 CI 与 CodeQL 均 success；分支保护开启（禁强推 / 禁删除 / 需解决对话） |
| 测试 | `bun run test:all`：69 个 bun 文件 840 通过 / 1 跳过；3 个 `node:test` 文件 37 通过 |
| 构建 | `typecheck`、`test:cloud`、`build`、`build:edge` 全过；产物 3.9 MB 级（不含 FFmpeg） |
| 分发形态 | 绿色包：扩展 + 内置 FFmpeg + 桥脚本 + `一键安装.cmd` / `一键卸载.cmd` |

本地目录（本机）：

| 用途 | 路径 |
| --- | --- |
| Codex 工作区 / 分享包归档 | `D:\fluxdown-cloud-extenstion`（0.1.41–0.1.47 zip + `.sha256` + 本文件） |
| 源码 | `D:\fluxdown-cloud-extenstion\source`（非 git 仓库；`E:\codex\fluxdown-cloud-extension` 为迁移前旧副本，仅作备份） |
| 临时克隆 | `E:\codex\tmp\flux-cloud-extend-push-*\repo`（`main` 镜像，仅用于提交/推送） |

## 二、版本时间线

| 版本 | 时间 | 主要内容 |
| --- | --- | --- |
| 0.1.41 | 11-19 14:23 | 早期分享包（无 FFmpeg，约 3 MB） |
| 0.1.42 | 11-19 20:13 | 网盘识别、悬浮球、资源嗅探基线 |
| 0.1.43 | 11-20 07:34 | 修复音视频合并前序问题 |
| 0.1.44 | 11-20 07:46 | 分享包内置 FFmpeg（体积升到约 60 MB） |
| 0.1.45 | 11-20 10:57 | 音频轨下载修复（此前只有画面） |
| 0.1.46 | 11-20 12:16 | CI / CodeQL、Bun 锁文件、一键卸载、FFmpeg 哈希与 `SHA256SUMS`、文档修正 |
| 0.1.47 | 11-20 12:43 | 诊断页（扩展 ID 一键复制 + 失败归类）、安装日志、白名单回读校验、打包版本来源修复 |
| 0.1.48 | 11-21 | 资源列表图片缩略图（懒加载 + 失败回退 + X 图片走 name=small） |

## 三、已完成能力

**下载拦截与转交**

- `webRequest` / `downloads` 拦截后经 Native Messaging 交给本机 FluxDown；未连接时熔断 30 秒放行浏览器原生下载。
- 悬浮球全站显示：轻点打开资源面板，拖动移动位置，`Shift + 拖动`拉出内核小球；内核球落到视频 / 图片 / 文件链接 / 协议链接即直接发起下载，失败保留并提示。
- 落点识别顺序：媒体元素 → 图片（含 `srcset` / 懒加载 / `og:image`）→ 文件链接 → 当前文件页；只接受 `http(s)` 与 `magnet:` / `ed2k:` / `thunder:` / `115://`。
- 拖到网页文本上可识别网盘分享链接与提取码（含 `?pwd=` 与「提取码: xxxx」文案）。

**网盘**

- 支持：百度、阿里云盘 / 阿里盘、移动云盘、天翼云盘、迅雷云盘、广雅盘、夸克、UC、123 云盘（含 123 的多个镜像域名）。
- 百度走 LinkSwift 补丁版（`下载助手`）；123 云盘支持在面板内逐级浏览目录并点「下载」。
- LinkSwift 的 `GM_*` 存储按厂商分区，页面只能读写本厂商键。

**资源嗅探**

- B 站 DASH 候选（视频轨 + `30280` 音频轨）已真实验证；X / Twitter 三条 twimg 规则通过单测。
- 多档位默认选最高清（分辨率 → 码率 → 帧率 → 大小）；图片单页上限 1000，DOM 小图 320px 阈值过滤。
- 带独立音频轨的候选会自动把音频一起提交，避免无声视频。

**连接与安装**

- 独立主机名 `com.fluxdown.cloud.nmh`，避开官方 `com.fluxdown.nmh` 每次启动的自我修复。
- 一键脚本：复制扩展、解析/等待扩展 ID、注册 HKCU 键与项目清单、白名单回读校验、装 FFmpeg、写桌面快捷方式、写安装日志。
- 一键卸载只清理本项目写入的键、快捷方式、PATH 条目与目录，不动官方注册。

**诊断**

- 侧边栏「诊断」：连接状态、扩展 ID（可复制）、失败归类、规则同步、页面规则命中、错误日志、导出连接诊断 JSON。
- 安装日志：`%LOCALAPPDATA%\FluxDownCloudExtension\logs\install-<时间>.log`，末尾 `SUMMARY` JSON。

## 四、架构与关键链路

```
网页下载 / 悬浮球拖放 / 资源面板
        │  (content script → background)
        ▼
background：拦截判定、规则匹配、候选合并、source 校验
        │  chrome.runtime.connectNative("com.fluxdown.cloud.nmh")
        ▼
fluxdown_nmh.exe（中继，只转发 stdio ↔ 命名管道）
        ▼
FluxDown 桌面端（任务队列 / 下载 / 调用 FFmpeg 合并音视频）
```

- 扩展侧白名单：`%LOCALAPPDATA%\FluxDownCloudExtension\nmh\com.fluxdown.cloud.nmh.json` 的 `allowed_origins` 必须含 `chrome-extension://<当前ID>/`。
- 注册表：`HKCU\Software\Google\Chrome\NativeMessagingHosts\com.fluxdown.cloud.nmh` 与 `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.fluxdown.cloud.nmh`。
- 旁加载扩展 ID 由扩展绝对路径派生：换目录、删目录再加载都会换 ID，必须重跑安装脚本。
- 音视频合并依赖桌面端找到 FFmpeg：优先内置 `%LOCALAPPDATA%\FluxDownCloudExtension\ffmpeg\bin`，其次 PATH，最后「设置 → 组件」手动路径。
- 安全边界：`cloudFetch` 只允许当前厂商 API/CDN，禁私网与非 HTTP(S)，不跟随重定向；日志与导出统一脱敏 URL / 路径 / 凭据。

## 五、关键点与易错点

- **扩展 ID 是路径派生的**：升级时保持同一目录，脚本会原地覆盖；换目录后必须重跑安装，否则白名单对不上。
- **装完必须重载扩展**：更新后在 `edge://extensions/` 点一次「重新加载」，否则 Service Worker 还是旧脚本。
- **FFmpeg 的 PATH 是进程启动时继承的**：改 PATH 后要完全退出 FluxDown（托盘退出）再启动；不行就手动指定路径。
- **分享包必须同时有 `.zip.sha256`**：校验和与 GitHub Release 的 `digest` 应当一致。
- **打包版本取自构建产物 manifest**：`package-release.ps1` 会校验 Edge/Chrome 版本一致，不再读 `.test-artifacts` 里的旧值。
- **PowerShell 5.1 限制**：含中文的 `.ps1` 必须 UTF-8 带 BOM；纯 ASCII 脚本（如 `package-release.ps1`）保持 ASCII；`powershell -Command` 会吞 `$`，统一用 `-File`。
- **Bun / Node 双轨测试**：`bun run test` 排除三个使用 `registerHooks` 的文件，由 `bun run test:node`（Node 20+）单独跑；`test:all` 一次跑完。
- **白名单「写成功但没落盘」**：0.1.47 起安装脚本会回读 `allowed_origins`，不匹配直接失败并写日志。

## 六、已知缺陷与限制

### 6.1 已确认缺陷（有反馈、未彻底解决）

| # | 现象 | 现状 | 影响 / 规避 |
| --- | --- | --- | --- |
| 1 | 部分站点下载拦不住（如 zcode） | 未解决，未定位到具体触发方式 | 用悬浮球拖到文件链接或资源面板手动下载 |
| 2 | 首次安装后「未连接」，白名单里是旧 ID | 0.1.47 有日志 + 回读校验，可定位；根因多为脚本没解析到当前 ID | 重跑 `一键安装.cmd`，看 `logs\install-*.log` 的 `SUMMARY` |
| 3 | FluxDown 找不到 FFmpeg（内置已复制） | 桌面端进程 PATH 未刷新 | 托盘退出后重启，或「设置 → 组件」填 `...\ffmpeg\bin\ffmpeg.exe` |
| 4 | B 站音视频合并/音频缺失 | 0.1.45 修音频轨，0.1.46 起内置 FFmpeg；未做真实页面端到端回归 | 用资源面板点视频条目的「下载」（同时提交两轨） |
| 5 | X 视频下载失败 / 抓到缩略图 | 规则与「取最高清」已修，X 真实站点未验证 | 优先资源面板；仍失败时导出诊断 |

### 6.2 设计边界（不计划绕过）

- 不绕过网盘会员、限速与流量限制；转直链后的速度仍受账号与直链策略约束。
- 不保存网盘账号、密码或 Cookie 副本；登录态完全依赖浏览器 Cookie，需用户手动登录一次。
- `blob:` / `data:` / Service Worker 流式生成的文件、DRM 内容、需要站点鉴权的直链无法接管。
- 仅 Windows（Edge / Chrome MV3）；Firefox 有构建目标但未作为分享包验证。

### 6.3 未验证项

- 真实网盘登录态下的端到端下载（百度、夸克、123 等）与 FluxDown 任务列表结果。
- X / Twitter 真实页面嗅探与下载；B 站真实页面的「视频+音频」合并结果。
- 不同 Edge 版本下 `Wait-InstalledExtension` 的 ID 发现时序。
- `app/utils/filename.test.ts` 依赖 FluxDown 引擎仓库的共享用例表，文件缺失时该组跳过（1 skip 即此项）。
- Dependabot 对 `bun.lock` 的 npm 生态支持（当前只开 GitHub Actions）。

## 七、出问题怎么取证

1. 侧边栏「诊断」：看连接状态、复制扩展 ID、看失败归类。
2. 「导出连接诊断」：`fluxdown-connection-diagnostics-<时间>.json`，含事件与扩展错误（已脱敏）。
3. 安装日志：`%LOCALAPPDATA%\FluxDownCloudExtension\logs\install-<时间>.log`，看最后一行 `SUMMARY`。
4. 资源调试日志：诊断页「导出资源日志」，按 tab 记录规则命中与候选选择。

## 八、开发与发布

```powershell
cd <仓库根目录>\app
bun install --frozen-lockfile
bun run typecheck
bun run test:all
bun run build:edge
bun run build
```

打包（在仓库根目录）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-release.ps1
```

产物默认落在桌面：`FluxDown-Cloud-Extension-<版本>.zip`、`.zip.sha256`，并校验 FFmpeg 固定哈希与 12 项包内文件。

源码目录 `D:\fluxdown-cloud-extenstion\source` **不是 git 仓库**，历史只在 GitHub 与临时克隆里；提交前先把改动同步进克隆。

先查清仓库实际跟踪的顶层内容（实测：`.gitattributes`、`LICENSE`、`PROJECT.md`、`README.md`、`STATUS.md`、`THIRD_PARTY_NOTICES.md`、`.github`、`app`、`scripts`、`tools`、`vendor`、`.gitignore`，共 349 个文件；`tools/ffmpeg/*.exe`、`app/node_modules`、`app/.output`、`app/.wxt` 等被 `.gitignore` 排除）：

```powershell
git -C <clone> ls-files | %{ ($_ -split '/')[0] } | Sort-Object -Unique
```

同步（只按 `git ls-files` 复制跟踪文件；下面命令已用未改动的源码目录实测，`git status --porcelain` 输出为空）：

```powershell
$clone = 'E:\codex\tmp\flux-cloud-extend-push-20261120-113240\repo'
$src   = 'D:\fluxdown-cloud-extenstion\source'
git -C $clone reset --hard origin/main
git -C $clone ls-files | %{
  $from = Join-Path $src ($_ -replace '/', '\')
  $to   = Join-Path $clone ($_ -replace '/', '\')
  if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { return }   # .gitignore 等只在克隆维护的文件
  if (Test-Path -LiteralPath $to -PathType Leaf) {
    $oldText = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($from)) -replace "`r`n", "`n"
    $newText = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($to))   -replace "`r`n", "`n"
    if ($oldText -ceq $newText) { return }   # 仅 CRLF/LF 换行差异时不改克隆工作副本
  }
  [void][IO.Directory]::CreateDirectory((Split-Path -Parent $to))
  [IO.File]::Copy($from, $to, $true)
}
git -C $clone status --porcelain
```

说明：提交前用 `git -C $clone status --porcelain` 确认待提交项，`git diff` 自查；仓库的 `.gitignore` 由克隆维护，源码目录缺失时跳过。严禁使用 `robocopy /MIR`（会删掉克隆的 `.git`），也不要复制 `.git`、`node_modules`、`.output`、`.wxt`。

提交与推送（普通 push，不要 force）：

```powershell
git -C $clone add STATUS.md
git -C $clone commit -m "Clarify repo status line and document push workflow"
git -C $clone push origin main
```

推送后确认远端与 CI：

```powershell
& 'C:\Program Files\GitHub CLI\gh.exe' api repos/Jun081010/flux-cloud-extend/commits/main --jq .sha
& 'C:\Program Files\GitHub CLI\gh.exe' run list -R Jun081010/flux-cloud-extend -L 2
```

## 九、待办（按优先级）

1. 真实环境回归：百度 / 夸克 / 123 登录态下载、B 站合并、X 视频，逐项记录结果到本文件。
2. zcode 等「拦不住」的下载：抓 `webRequest` 与 `downloads` 事件，判断是权限、时机还是站点自身下载方式。
3. 网盘登录体验：评估「记住登录」提示与登录后自动续提链的覆盖范围（不引入凭证存储）。
4. 安装桥完全免手输：验证不同 Edge 版本下的 ID 发现，必要时改为读取 Preferences 兜底。
5. tag 触发的自动打包 workflow，让 Release 资产由 CI 产出。
6. 确认 Dependabot 支持后补 npm 生态条目。

## 十、文件索引

- `app/background/`：拦截、任务发送、通知、自动续传、主机通信。
- `app/entrypoints/`：background、content scripts、侧边栏、选项页、弹窗。
- `app/entrypoints/sidepanel/DiagnosticsPane.tsx`：诊断页。
- `app/utils/nmh-diagnostics-tips.ts`：NMH 失败归类。
- `app/utils/connection-diagnostics*.ts`：诊断事件存储与导出。
- `app/rules/`、`app/public/cloud/`：规则与 LinkSwift 运行时。
- `scripts/one-click.ps1`、`scripts/install-native-host.ps1`、`scripts/uninstall.ps1`：安装 / 注册 / 卸载。
- `scripts/package-release.ps1`：打包与校验。
- `PROJECT.md`：契约、安全边界、验收清单。
