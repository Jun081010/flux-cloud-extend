# FluxDown 云盘下载拦截扩展

在 FluxDown 官方 MV3 扩展副本上增加网盘页面直链解析与「推送至 FluxDown」能力。普通浏览器下载仍由 FluxDown 官方拦截链路接管；受支持网盘页面注入最小补丁版 LinkSwift，把解析出的直链、文件名、大小、Referer、请求头与 Cookie 信息交给扩展后台，再经本项目专属主机名 `com.fluxdown.cloud.nmh` 的 Native Messaging 链路发给本机 FluxDown 桌面客户端。

本项目只提供扩展侧桥接与 Windows Native Messaging 安装脚本，不修改 FluxDown 安装目录、官方 NMH 清单（`com.fluxdown.nmh` 是桌面端官方主机名，本项目不再使用）、FluxDown 可执行文件，也不改 Rust/Native Messaging 协议。

## 分享包（给朋友）

`scripts/package-release.ps1` 会在桌面生成 `FluxDown-Cloud-Extension-<版本>.zip`（并附带同名的 `.zip.sha256` 校验文件），里面包含 Edge / Chrome 两套扩展、内置 FFmpeg、桥注册脚本，以及根目录的 `一键安装.cmd` 与 `一键卸载.cmd`。朋友解压后只需双击 `一键安装.cmd`：

1. 自动识别浏览器并复制扩展到 `%LOCALAPPDATA%\FluxDownCloudExtension\extension\<浏览器>-mv3`（已有安装则原地更新，扩展 ID 不变）。
2. 计算扩展 ID 并注册 `com.fluxdown.cloud.nmh` 桥（HKCU，自动备份）。
3. 安装内置 FFmpeg 到 `%LOCALAPPDATA%\FluxDownCloudExtension\ffmpeg\bin` 并写入用户 PATH。
4. 确认没有活跃下载任务后重启 FluxDown 桌面端，让新 PATH 立即生效；有任务时跳过并提示。
5. 创建桌面快捷方式，之后自动加载扩展。

`0.1.42` 及更早的分享包没有打包 FFmpeg，B 站 / X 等分离音轨的视频会静默变成无声视频；`0.1.45` 起随包内置并在安装后自动重启桌面端。

更新同样只需解压覆盖后再次双击；最后在扩展页点一次「重新加载」或重启浏览器。完整说明见 `scripts/release-readme-template.md`。

卸载时先退出 FluxDown 桌面端，再双击 `一键卸载.cmd`：它会注销 `com.fluxdown.cloud.nmh`、删除桌面快捷方式、从用户 PATH 移除本项目追加的 `...\ffmpeg\bin`，并清掉 `%LOCALAPPDATA%\FluxDownCloudExtension`（可用 `-KeepBackups` 保留备份）。官方 `com.fluxdown.nmh` 与 FluxDown 安装目录不受影响；浏览器里的扩展仍需在扩展页手动「移除」。

## 目录

- `app/`：FluxDown 官方扩展副本，网盘桥接代码位于此目录。
- `vendor/LinkSwift/linkswift.user.js`：上游 LinkSwift 原文件。
- `scripts/patch-linkswift.mjs`：构建期确定性生成 `app/public/cloud/linkswift.user.js`（补丁后的审计副本）与 `app/public/cloud/linkswift.bundle.js`（MAIN world 实际注入的隔离产物），并复制本地依赖到 `app/public/cloud/vendor/`。
- `scripts/test-linkswift-patch.mjs`：补丁生成与幂等性验证脚本。
- `scripts/install-native-host.ps1`：注册本项目专属主机名 `com.fluxdown.cloud.nmh` 的 NMH 清单与 HKCU 键，支持 `-Restore`；不读取、追加或修改官方 `com.fluxdown.nmh` 清单与官方两个键。
- `app/public/cloud/linkswift.user.js`：补丁后的 LinkSwift 审计副本，不用于注入。
- `app/public/cloud/linkswift.bundle.js`：隔离包装后的 LinkSwift，实际注入 MAIN world。
- `app/public/cloud/linkswift-gm-shim.js`：MAIN world 的 GM_* 兼容层与 FluxDown 调用桥。
- `app/public/cloud/vendor/`：本地运行时依赖，含 jQuery 3.6.0、SweetAlert2 11.4.8、SweetAlert2 dark theme 5.0.26、js-md5 0.7.3，以及 `sweetalert2.min.css`、`sweetalert2-dark.min.css`。前三个 JS 依赖由构建期包装器隔离加载，页面原有 `jQuery` / `$` / `Swal` / `md5` 等引用保持；两份 CSS 在 boot 阶段作为资源原文传给 shim。
- `LICENSE`、`THIRD_PARTY_NOTICES.md`：许可证与第三方组件说明。
- `STATUS.md`：项目进度、已知缺陷、关键点与待办（交接用）。

## 构建

前置条件：Bun 1.4.5（`app/package.json` 固定版本，依赖锁文件为 `app/bun.lock`）与 Node.js 22.18+。`test:node` 使用 `registerHooks` 并直接运行 TypeScript。构建脚本 `prebuild` 会自动运行 `scripts/patch-linkswift.mjs`。

```powershell
cd <仓库根目录>\app
bun install --frozen-lockfile
bun run build
```

Edge 目标可改用：

```powershell
bun run build:edge
```

WXT 默认把 MV3 产物放在 `app\.output\chrome-mv3`；Edge 构建通常为 `app\.output\edge-mv3`。构建产物应包含 `cloud/linkswift-gm-shim.js`、`cloud/linkswift.bundle.js`、`cloud/linkswift.user.js` 与 `cloud/vendor/` 中的两份 CSS；其中 `linkswift.bundle.js` 是注入文件，`linkswift.user.js` 只作补丁审计副本。注入顺序为 boot（`channelId` + `values` + `resources`）→ `linkswift-gm-shim.js` → `linkswift.bundle.js`。实际目录名以构建结果为准，加载前先查看：

```powershell
Get-ChildItem -LiteralPath app\.output
```

不要假定固定目录名，也不要把 `dev` 模式产物当作最终构建产物。

## 加载已解压扩展并获取 ID

1. 启动目标浏览器。Edge 可执行文件为 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`。
2. Edge 打开 `edge://extensions/`，Chrome 打开 `chrome://extensions/`，开启「开发人员模式」。
3. 选择「加载已解压的扩展」，目录选上一步确认的实际构建输出目录，例如 `app\.output\edge-mv3` 或 `app\.output\chrome-mv3`。
4. 在扩展详情页复制扩展 ID。ID 必须是 32 位 `a-p` 小写字符。

Chrome 构建在 `app/wxt.config.ts` 中带 `key` 字段，设计上用于把侧载 ID 固定为 `meleenglfggcmcajknpeeeiobnpfmahc`；仍以扩展页实际显示的 ID 为准。Edge 不支持 `key` 固定侧载 ID，ID 可能随加载路径或重装变化，因此 Edge 侧载后必须用实际 ID 重新运行安装脚本。

## Native Messaging 安装

本项目使用独立的 Native Messaging 主机名 `com.fluxdown.cloud.nmh`，注册表键、清单 `name`、清单文件名三者同名。`com.fluxdown.nmh` 是桌面端官方主机名，本项目不再使用。

不再复用官方主机名的原因：桌面端 `fluxdown-agent.exe` 每次启动都会重写 `D:\FluxDown-<ver>-windows-x64\portable_data\nmh\com.fluxdown.nmh.json`（只含官方两个扩展 ID），并把 HKCU 两个官方键默认值指回该清单。本项目旁加载扩展 ID 被挤出白名单后 `connectNative()` 被拒，面板显示「未连接」，且每次桌面端重启都会复发。中继程序 `fluxdown_nmh.exe` 不读取主机名（只在浏览器 stdio 与 `\\.\pipe\fluxdown-*` 之间转发），换名不影响下载链路。

安装脚本不读取、追加或修改官方 `com.fluxdown.nmh` 清单与官方两个键；官方清单只在自动定位 `fluxdown_nmh.exe` 时作为线索使用。安装流程：

1. 定位 `fluxdown_nmh.exe`：优先 `-RelayPath` 显式指定；其次运行中的 `fluxdown-agent.exe` 所在目录；再次 HKCU 官方键指向的官方清单 `path`；最后扫描常见目录。
2. 把项目清单原子写到 `%LOCALAPPDATA%\FluxDownCloudExtension\nmh\com.fluxdown.cloud.nmh.json`，`allowed_origins` 只含 `chrome-extension://<ExtensionId>/`。
3. 把改动前的 HKCU 默认值备份到 `%LOCALAPPDATA%\FluxDownCloudExtension\backups\nmhcloud-backup-<时间戳>.json`。
4. 写入 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.fluxdown.cloud.nmh` 与 `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.fluxdown.cloud.nmh`，默认值指向项目清单。

脚本只写 `%LOCALAPPDATA%\FluxDownCloudExtension` 与 HKCU；不写 FluxDown 安装目录，不写 HKLM，不需要管理员权限，也不递归删除任何目录。

### 官方主机名参考（本项目不再使用）

官方 NMH 名称为 `com.fluxdown.nmh`。官方清单当前位于：

```text
D:\FluxDown-0.2.3-windows-x64\portable_data\nmh\com.fluxdown.nmh.json
```

其 `allowed_origins` 含官方 Chrome ID `meleenglfggcmcajknpeeeiobnpfmahc` 与官方 Edge ID `nglkkjbogjghekbhhcnccnpfedjbdhhd`。当前 HKCU 默认值：

```text
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.fluxdown.nmh
HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.fluxdown.nmh
```

均指向上述官方清单。该清单由桌面端维护，本项目不再修改。

安装命令（在项目根目录执行）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-native-host.ps1 -ExtensionId <32位ID> -Browser Edge
```

`-Browser` 可取 `Edge`、`Chrome`、`All`，默认 `All`。仅预览改动：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-native-host.ps1 -ExtensionId <32位ID> -Browser Edge -WhatIf
```

`-RelayPath` 可显式指定 `fluxdown_nmh.exe` 路径；`-HostManifest` 已降级为定位线索，只用于从官方清单读取 `path`；`-Uninstall` 卸载本项目注册。脚本支持 `-WhatIf`。注意：在 PowerShell 5.1 下调用方不要通过命令行传 `-Confirm:$false`（会报 SwitchParameter 转换错误），应在脚本内设 `$ConfirmPreference = 'None'` 或用 splat 传布尔值；上面的安装示例均使用 `-File` 调用，避免 `powershell -Command "..."` 吞掉 `$` 变量。

恢复时把安装时打印的备份路径传给 `-BackupPath`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-native-host.ps1 -Restore -BackupPath "$env:LOCALAPPDATA\FluxDownCloudExtension\backups\nmhcloud-backup-20261116-120000-123-abcd1234.json"
```

`-Restore` 只恢复备份中记录的 HKCU 默认值，不删除项目副本或备份文件。脚本会校验备份路径必须位于 `%LOCALAPPDATA%\FluxDownCloudExtension\backups` 内，且拒绝符号链接等重解析点路径；不会按备份内容写任意注册表键。

一键安装可改用 `scripts\setup-for-friend.ps1`：自动探测扩展 ID，调用安装脚本并打印后续步骤，支持 `-WhatIf`。打包分发用 `scripts\package-release.ps1`，在桌面生成 `FluxDown-Cloud-Extension-<版本>.zip`。项目数据目录固定为 `%LOCALAPPDATA%\FluxDownCloudExtension`。

## 使用

1. 启动 FluxDown 桌面客户端，并启用浏览器扩展连接。
2. 用上述方式加载构建后的扩展，并用实际扩展 ID 运行安装脚本。
3. 登录受支持网盘；把悬浮球拖到网盘分享链接（含提取码）上松手。
4. 打开 123 云盘分享页后，点击悬浮球即可在面板里直接浏览目录：文件夹可逐级进入 / 返回上级，文件右侧「下载」会把官方接口返回的直链发送给 FluxDown。
5. 其他网盘的分享页仍可使用「解析直链 / 下载助手 → FluxDown 下载」；扩展后台校验来源页面与顶层帧后，经 Native Messaging 发给本机 FluxDown。
6. 首次使用请在浏览器里完成一次网盘登录，并勾选「记住登录 / 保持登录」。扩展不保存账号密码，只复用浏览器自身的登录 Cookie。网盘提示流量不足或要求会员时，这是网盘侧限制，扩展不会绕过。

更新扩展后必须在浏览器扩展管理页点一次「重新加载」，否则 Service Worker 可能继续运行旧脚本。

## 诊断与日志

连不上桌面端、下载无声、网盘解析失败时，先取证据再排查：

- **侧边栏「诊断」页**：显示扩展 ID（可一键复制）、连接状态与最近一次断开原因。浏览器给的是英文原文（如 `Access to the specified native messaging host ... is forbidden`），扩展会归类成「扩展 ID 不在白名单 / 没找到下载桥 / 清单损坏」并显示对应处理办法。
- **连接诊断 JSON**：诊断页底部「导出连接诊断」下载 `fluxdown-connection-diagnostics-<时间>.json`，含扩展 ID、版本、浏览器信息、连接事件与扩展错误日志；URL、路径、凭据在导出前统一脱敏成占位符。
- **安装日志**：`一键安装.cmd` 每次运行写 `%LOCALAPPDATA%\FluxDownCloudExtension\logs\install-<时间>.log`，记录每一步结果、解析到的扩展 ID、下载桥注册退出码与白名单回读结果，末尾附一行 `SUMMARY` JSON。
- **白名单回读校验**：安装脚本写完 `nmh\com.fluxdown.cloud.nmh.json` 后会重新读取并确认 `allowed_origins` 含本次扩展 ID；不匹配直接报错退出，避免「显示成功但文件没改」。

## 资源嗅探与悬浮球内核

- 资源嗅探沿用 FluxDown 官方链路：B 站公开页（`BV1GJ411x7h7`）已真实验证 `probe: "live"`，可拿到 DASH 候选（`.m4s` 视频轨 + `30280` 音频轨）。
- 官方规则新增 X / Twitter 三条：`pbs.twimg.com` 图片（需开启图片嗅探）、`video.twimg.com` 的 `/pl/` 播放列表与 `/vid/` 视频分片；仅限定 twimg 域名，不放宽成全局规则。
- 多档位媒体默认选最高清：按分辨率（宽高）、码率、帧率、文件大小依次比较，不再依赖清单档位顺序；没有分辨率信息的 `auto` 不会仅因排在首位被当成最高清。
- 视频轨带独立音频轨时（B 站 DASH、HLS `EXT-X-MEDIA`），链接抓取、快速下载、内核小球落到链接等「单 URL」入口会自动回落到候选下载，把音频轨一并交给桌面端合并；只发视频轨会得到无声视频。
- 嗅探默认开启图片，单页上限 1000 条；图片会同时采集 `srcset` / `<picture>` / 懒加载属性 / `og:image` / `twitter:image` / 视频封面，DOM 小图按 320px 阈值过滤。旧版本写入的「图片关闭、上限 200」会在升级后一次性抬到新默认值。
- 除 `http(s)` 外，悬浮球落点与右键菜单还识别 `magnet:`、`ed2k:`、`thunder:`、`115://` 链接并转交桌面端；桌面端对这些协议的真实支持以 FluxDown 当前版本为准。
- 悬浮球是「球中球」：外层球 36px，内部常驻 14px 内核。悬浮球在所有网站显示（可见性由 `pageDot` 全局 / 站点配置控制，与嗅探开关解耦）：普通点击打开资源面板，拖动外层球移动位置。
- `Shift + 按住外层球拖动`超过阈值后拖出独立内核球；内核球可单独拖动，落到视频 / 图片 / 文件链接上松手即可直接发起下载；成功或拖回外层球收回，失败（含 DRM、仅限网页内、发送失败）保留内核球并弹 toast 提示。
- 内核球落点识别顺序为媒体元素 → 图片 → 文件链接 → 当前文件页；只接受 `http(s)`，拒绝 `javascript:` / `mailto:` / `data:` / 纯锚点，并递归穿透开放 Shadow DOM。

## 兼容网盘

- 百度网盘：`pan.baidu.com`、`yun.baidu.com`
- 阿里云盘 / 阿里盘：`www.aliyundrive.com`、`www.alipan.com`
- 移动云盘：`yun.139.com`、`caiyun.139.com`
- 天翼云盘：`cloud.189.cn`
- 迅雷云盘：`pan.xunlei.com`
- 广雅盘：`www.guangyapan.com`
- 夸克网盘：`pan.quark.cn`
- UC 网盘：`drive.uc.cn`
- 123 云盘：`*.123pan.com`、`*.123pan.cn`、`*.123684.com`、`*.123865.com`、`*.123952.com`、`*.123912.com`

支持范围来自 `PROJECT.md` 与 LinkSwift 补丁目标，实际可用性受网盘页面与接口变化影响。

## 安全边界

- 不绕过网盘会员、限速或鉴权；只使用网盘页面自身的登录态与官方接口（或 LinkSwift 已实现的公开 API）获取链接。
- 不把 Cookie、令牌写入日志、URL、遥测或可导出的调试信息。
- 不保存网盘账号、密码或 Cookie 副本；登录状态由浏览器自身的 Cookie 持久化。
- 页面厂商隔离：百度页面只能代理百度的 API/CDN，阿里、139、189、迅雷、广雅、夸克、UC、123 同理；页面 A 不能调用页面 B 的厂商域名。
- `cloudFetch` 限制在当前页面厂商的 API/CDN 域名，禁止 localhost、私网 IP、非 HTTP(S)、`file:`、`data:`；请求体与响应体、超时均有上限，响应按 `Content-Length` 预检并在未知长度时流式限量。
- `cloudFetch` 使用 `redirect: "error"` 拒绝隐式跳转，响应 `response.url` 会再次校验厂商归属。
- 下载头会过滤 hop-by-hop 与危险头；`Cookie` 从 headers 拆出后按官方协议传递。
- 下载文件名只保留 basename，并清理 Windows 非法字符、控制字符、保留设备名、尾部空格/点和超长名。
- MAIN world 消息必须带随机 `channelId`；background 同时校验 `sender.url` 与 `sender.tab.url`、二者同 origin、`sender.frameId === 0`，且 sender 页面必须是 `https:` 网盘页。
- LinkSwift 的 `GM_*` 持久化按厂商分区，页面只能读写本厂商的 `cloud.linkswift:<vendor>:*` 键，不能读取其他厂商的状态。
- `web_accessible_resources.matches` 已收窄为云盘页面 match patterns，不再对任意站点暴露注入资源。
- 安装脚本只处理 `com.fluxdown.cloud.nmh` 两个 HKCU 键与项目清单，拒绝不安全路径；官方 `com.fluxdown.nmh` 注册保持不动。
- 官方扩展声明了 `<all_urls>` host permission；本项目继承该底座，未额外扩大 Native Messaging 协议能力。

## 已知限制

- 网盘接口与页面结构易变，LinkSwift 补丁可能需要随上游更新。
- 受支持网盘页面必须使用 HTTPS；HTTP 页面不会注入，也不会被接受为 sender。
- 分离音轨的合并由桌面端完成：需要 FluxDown 能找到 FFmpeg（PATH 或「设置 → 组件」手动路径）。分享包从 `0.1.44` 起内置 FFmpeg，`0.1.45` 起安装脚本会在无活跃任务时自动重启桌面端使其生效。
- 已通过补丁测试、`bun run test:all`（68 个 bun 测试文件 836 通过 / 1 跳过，3 个 `node:test` 文件 37 通过）、类型检查、Edge/Chrome 构建；内核小球在隔离 Edge（CDP 9223）+ 本地测试页冒烟验证：悬浮球显示、Shift 拖出内核、失败停留并提示、轻点收回、拖放发起下载（NMH 未连时保留内核）。
- 百度网盘分享页已用真实链接验证：自动模式会触发、初始化状态不再挡住「下载助手」、未登录时会提示并持续等待，60 秒内不会提前判失败。登录后的自动续跑与最终 FluxDown 任务仍需在已登录账号中复核。
- 扩展无法读取浏览器密码管理器中的账号密码，因此不做自动填写或自动登录；请使用浏览器「记住登录」保持网盘会话。
- 当前厂商映射依据 LinkSwift 1.1.4 的 `@connect` 列表与源码 API 常量；登录状态下各网盘实际返回的直链 CDN 是否完全命中映射，仍需端到端页面验证。若出现新 CDN，需要按厂商补充后缀，不能放宽成全局白名单。
- `redirect: "error"` 是安全优先策略；如果某网盘 API 依赖 30x 跳转，该接口会被拒绝，需要单独确认后为该厂商增加显式处理。
- 注入路径已增加资源读取后的二次标签页校验与 boot origin guard，但 `scripting.executeScript` 没有绑定 `documentId`，校验与注入之间仍有极短导航竞态；未做浏览器级压力复现。
- 仅支持 Windows，且需要 FluxDown 桌面端已安装并在运行。
- DRM 保护、需登录、会员专属内容无法直接下载。
- 不支持 `blob:` / MSE 流（部分 HLS/DASH 播放器的媒体源）。
- 旁加载扩展 ID 由绝对路径派生，重装、换路径或换浏览器后 ID 变化，必须重跑安装脚本。
- 未连接时扩展会「熔断」放行浏览器原生下载（30 秒冷却），期间部分下载看起来「没被拦截」属正常现象；冷却到期、popup 打开 ping 成功或待发队列 flush 成功会解除。
- `ruleSyncOutcome: fetch-failed` 表示远程规则拉取失败，属网络问题，不影响本机连接与下载。
- PowerShell 5.1 下 `[System.IO.File]::Replace($tmp,$dst,$null)` 会把 `$null` 绑成空串抛 `ArgumentException`，导致安装静默失败；脚本已加 `Move-Item -Force` 回退。无 BOM 的含中文 `.ps1` 在 PS5.1 会解析错乱，脚本一律纯 ASCII。调用脚本必须用 `-File`，`powershell -Command "..."` 会吞掉 `$` 变量。
- WXT `dev` 模式在 Chrome 126+ 上会调起 NMH 后关闭 stdin，Native Messaging 连接可能始终显示未连接；请使用正式浏览器加载已构建扩展测试。
- `linkswift.user.js` 仅用于补丁审计，不能在浏览器里直接作为用户脚本加载替代 `linkswift.bundle.js`；本地依赖由构建期包装器隔离，页面原有 `jQuery` / `$` / `Swal` / `md5` 等引用保持。
- FluxDown 与 LinkSwift 均为 AGPL-3.0 第三方组件，本项目整体按 AGPL-3.0 发布，见 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`。
- X / Twitter 规则已通过单测与规则包校验，但当前网络无法访问 X 真实页面，未做真实站点端到端验证。

## 验证方式

已在本环境实际执行并通过：

```powershell
cd <仓库根目录>\app
bun install --frozen-lockfile
bun run test:cloud
bun run test:baidu
bun run typecheck
bun run test:all
bun run build:edge
bun run build
```

实际结果：补丁测试通过（审计副本 `linkswift.user.js` 840263 bytes、sha256=`86d61a4692e975097e17b8cb9911faeb635940506ffa453dd6dec484b304caab`；注入产物 `linkswift.bundle.js` 984404 bytes、sha256=`c9b20466486d3e232a30222b4940ece6c1f8d9853923d52edebb3fff20bb3fe1`）；`typecheck` 通过；Edge 与 Chrome MV3 构建成功。

测试分成两批，`bun run test:all` 会依次跑完：

- `bun run test`：`bun:test` 用例，开机即用 `--isolate` 隔离每个文件的全局对象。`cloud-bridge` / `cloud-downloads` / `download-urls-audio` 三个文件用 `node:test` + `node:module` 的 `registerHooks`，Bun 未实现该 API，因此从这批里排除。
- `bun run test:node`：运行上述三个文件。
- `bun run test:baidu`：用本地夹具验证百度页面消息桥，包括列目录、下载错误提示和无效请求。
- `powershell -NoProfile -File .\scripts\test-package-release.ps1`（仓库根目录）：用临时夹具验证版本拒绝、压缩包校验和成品替换。
- `app/utils/filename.test.ts` 里与 FluxDown 引擎共享的用例表位于 `native/engine/src/naming/fixtures/content_disposition.json`，该文件不随本仓库分发；缺失时这组用例标记为 `skip`，其余文件名用例照常执行。

仍需在目标机器上执行：登录网盘后真实推送任务并核对 FluxDown 任务列表。安装脚本可先用 `-WhatIf` 预览；实际注册、浏览器加载与扩展 ID 获取需按上文步骤单独验证。
