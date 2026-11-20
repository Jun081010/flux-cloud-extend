# FluxDown 云盘下载拦截扩展

## 目标

在 FluxDown 官方浏览器扩展基础上，增加网盘页面直链解析与「推送至 FluxDown」能力：

- 普通浏览器下载仍由 FluxDown 官方拦截链路接管。
- 在受支持的网盘页面自动注入最小补丁版 LinkSwift。
- LinkSwift 的下载结果增加「FluxDown 下载」模式。
- 悬浮球拖到网盘分享链接时打开带 `fluxdown_auto=1` 的分享页；百度分享页由补丁版 LinkSwift 自动提链并直接推送 FluxDown，无需再点页面按钮。
- 百度分享页未登录时会保留自动标志并持续等待，登录完成后自动续跑；不保存账号、密码或 Cookie 副本，只复用浏览器自身登录会话。
- 点击后把直链、文件名、大小、Referer、User-Agent、Cookie/Cookie 头等交给扩展后台。
- 扩展后台通过本项目专属主机名 `com.fluxdown.cloud.nmh` 复用 FluxDown 官方 Native Messaging 中继链路，把任务发送给本机 FluxDown。

## 不可变边界

- 不修改 `<FluxDown 安装目录>` 内的可执行文件。
- 不读取、追加或修改官方 `com.fluxdown.nmh` 清单与官方两个 HKCU 键（那是桌面端官方主机名，本项目不再使用）；本项目注册独立主机名 `com.fluxdown.cloud.nmh`。
- 不改 FluxDown 的 Rust/Native Messaging 协议。
- 不绕过网盘会员、限速或鉴权；只使用 LinkSwift 已实现的公开 API 获取链接。
- 不把 Cookie、令牌写入日志、URL、遥测或可导出的调试信息。
- 不保存网盘账号、密码或 Cookie 副本；登录状态由浏览器自身持久化。
- 所有新增或修改文件必须位于本仓库根目录内。
- 第三方代码保持 AGPL-3.0 许可与署名；本项目整体按 AGPL-3.0 发布。

## 目录

- `app/`：FluxDown 官方扩展副本，在其上增加网盘桥接。
- `vendor/LinkSwift/linkswift.user.js`：未经修改的上游 LinkSwift。
- `scripts/patch-linkswift.mjs`：确定性地生成 `app/public/cloud/linkswift.user.js`（补丁后的审计副本）与 `app/public/cloud/linkswift.bundle.js`（MAIN world 实际注入的隔离产物），并复制本地依赖到 `app/public/cloud/vendor/`。
- `scripts/install-native-host.ps1`：注册项目专属主机名 `com.fluxdown.cloud.nmh` 的清单与 HKCU 键，支持 `-ExtensionId`（必填）、`-Browser Edge|Chrome|All`、`-RelayPath`、`-HostManifest`（仅作定位 relay 的线索）、`-Uninstall`、`-Restore -BackupPath`。
- `scripts/Get-ExtensionId.ps1`：探测浏览器侧载扩展的真实 ID。
- `scripts/setup-for-friend.ps1`：一键安装（探测 ID → 调安装脚本 → 打印后续步骤），支持 `-WhatIf`。
- `scripts/package-release.ps1`：打包发布 zip 到桌面（`FluxDown-Cloud-Extension-<版本>.zip`）。
- `app/public/cloud/linkswift.user.js`：补丁后的 LinkSwift 审计副本，不用于注入。
- `app/public/cloud/linkswift.bundle.js`：隔离包装后的 LinkSwift，实际注入 MAIN world。
- `app/public/cloud/linkswift-gm-shim.js`：MAIN world 的 GM_* 兼容层与 FluxDown 调用桥。
- `app/public/cloud/vendor/`：本地运行时依赖，含 jQuery 3.6.0、SweetAlert2 11.4.8、SweetAlert2 dark theme 5.0.26、js-md5 0.7.3，以及 `sweetalert2.min.css`、`sweetalert2-dark.min.css`。前三个 JS 依赖由构建期包装器隔离加载，页面原有 `jQuery` / `$` / `Swal` / `md5` 等引用保持；两份 CSS 在 boot 阶段作为资源原文传给 shim。

## 支持页面

- `pan.baidu.com`, `yun.baidu.com`
- `www.aliyundrive.com`, `www.alipan.com`
- `yun.139.com`, `caiyun.139.com`
- `cloud.189.cn`
- `pan.xunlei.com`
- `www.guangyapan.com`
- `pan.quark.cn`
- `drive.uc.cn`
- `*.123pan.com`, `*.123pan.cn`, `*.123684.com`, `*.123865.com`, `*.123952.com`, `*.123912.com`

## 扩展内部契约

### 注入

`cloud.content.ts` 在 `document_start` 运行，只处理顶层帧：

1. 生成 32 位十六进制 `channelId`。
2. 向 background 发送 `{ action: "cloudInject", channelId }`。
3. 在 `window` 上监听带 `channelId` 的 `postMessage` 请求。
4. background 校验 sender 是受支持网盘顶层页后，用 `scripting.executeScript` 依次注入：
   - boot 配置（`world: "MAIN"`，含 `channelId`、`values`、`resources`；`setting_init` 预置为已点亮状态，避免初始化弹窗挡住「下载助手」）；
   - `cloud/linkswift-gm-shim.js`（`world: "MAIN"`）；
   - `cloud/linkswift.bundle.js`（`world: "MAIN"`）。

`linkswift.user.js` 只作为补丁后的审计副本保留；`linkswift.bundle.js` 由 `scripts/patch-linkswift.mjs` 生成，内联隔离加载 jQuery、SweetAlert2、js-md5 三个本地 JS 依赖，并执行补丁后的 LinkSwift 代码。两份 CSS 不作为独立文件注入页面；background 读取 CSS 原文放入 boot 的 `resources`，shim 通过 `GM_getResourceText` 提供给 LinkSwift，由 LinkSwift 按需写入 `<style>`。

### MAIN world ↔ content script 消息

请求：

```js
window.postMessage({
  __fluxdown: 1,
  channel: channelId,
  id: "req-1",
  op: "fetch" | "storage" | "download" | "openTab",
  args: {}
}, location.origin)
```

响应：

```js
window.postMessage({
  __fluxdownResult: 1,
  channel: channelId,
  id: "req-1",
  ok: true,
  result: {}
}, location.origin)
```

### background action

- `cloudInject`：`{ channelId }`，返回 `{ ok, reason? }`
- `cloudFetch`：`{ request: { url, method, headers, body, timeout, responseType } }`
- `cloudStorage`：`{ op: "get" | "set" | "delete", key?, value? }`
- `cloudDownload`：`{ items: [{ url, filename?, size?, headers?, referrer? }] }`
- `cloudOpenTab`：`{ url }`

所有 action 都必须校验 sender：

- `sender.tab.id` 存在；
- `sender.frameId === 0`；
- `sender.url` 与 `sender.tab.url` 同时存在，且都必须是受支持网盘页面；
- `sender.url` 与 `sender.tab.url` 必须同 origin，避免标签页在消息期间导航到其他站点；
- sender 页面只允许 `https:`；代理/直链目标允许 `http:` / `https:`，但必须命中当前厂商白名单。
- LinkSwift 的 `GM_*` 持久化按厂商分区，页面只能读取/修改本厂商的 `cloud.linkswift:<vendor>:*` 键。

### 下载

`cloudDownload` 转为 FluxDown 官方 `sendToFluxDown` 输入：

- `url`
- `filename`
- `fileSize`
- `referrer`（缺省用页面 URL）
- `storedHeaders`（过滤 hop-by-hop/危险头）
- `storedCookies`（从 `Cookie` 头拆出，并从 headers 删除）
- `pageHost`
- `filename` 已做 basename 与 Windows 安全净化；空名或纯路径名回退为 `undefined`，由桌面端自行探测。

单条任务走完整认证链；多条顺序发送并返回 `{ success, sent, failed, message? }`。

## LinkSwift 补丁要求

补丁必须幂等、可验证，并至少包含：

1. `config.base.dom.method.fluxdown` 标题/footer。
2. 所有模式菜单增加 `data-mode="fluxdown"`（保留原有条目）。
3. `temp.mode === "fluxdown"` 的下载列表分支：每条文件有「推送至 FluxDown」和「复制地址」按钮。
4. 额外区域有「全部推送至 FluxDown」。
5. `sendto` 点击处理增加 `case "fluxdown"`。
6. `download.tools.sendTo.fluxdown()` 调用 `GM_fluxdownDownload`。
7. `GM_fluxdownDownload` 由 shim 提供，最终走 `cloudDownload`。

## GM_* 兼容层

shim 至少提供：

- `GM_info`
- `GM_getValue` / `GM_setValue` / `GM_deleteValue`（同步读缓存、异步持久化）
- `GM_xmlhttpRequest` 与 `GM.xmlHttpRequest`
- `GM_setClipboard` / `GM.setClipboard`
- `GM_openInTab`
- `GM_registerMenuCommand`
- `GM_getResourceText`
- `GM_fluxdownDownload`

`GM_xmlhttpRequest` 需要：

- 支持 GET/POST 等；
- 支持 `headers`、`data`、`timeout`、`responseType: "json" | "text" | "blob" | "arraybuffer"`；
- 返回 `abort()`；
- 触发 `onload` / `onerror` / `ontimeout` / `onabort`；
- 响应字段至少包括 `status`, `statusText`, `responseText`, `response`, `responseHeaders`, `finalUrl`。

## 网络与安全

- 按页面厂商隔离：百度页面只能代理百度 API/CDN，阿里、139、189、迅雷、广雅、夸克、UC、123 同理；页面 A 不能调用页面 B 的厂商域名。
- `cloudFetch` 的请求目标限制在当前页面厂商的 API/CDN 域名，禁止 localhost、私网 IP、非 HTTP(S)、`file:`、`data:`。
- `cloudFetch` 使用 `redirect: "error"`，不跟随隐式重定向；响应 `response.url` 仍会再次校验厂商归属。
- 单次请求体 ≤ 2 MiB，响应 ≤ 32 MiB，超时上限 120 秒；响应优先按 `Content-Length` 拒绝，未知长度时流式读取并在超限时取消。
- 下载头过滤 `host`, `content-length`, `connection`, `transfer-encoding`, `upgrade`, `proxy-*`, `sec-*`。
- 下载文件名只保留 basename，移除 C0/C1 控制字符、常见 bidi 控制符与 Windows 非法字符，处理保留设备名、尾部空格/点和 200 UTF-16 单元长度上限。
- `Cookie`、`Authorization` 不写日志。
- 消息必须带随机 `channelId`，content script 校验来源窗口与 origin。
- `web_accessible_resources.matches` 已收窄为云盘 content script 的 match patterns，不再对任意站点暴露注入资源。

## 验收

以下为验收清单；已执行项记录实际结果，未执行项单独列出：

1. 已通过：`bun run test:cloud`，补丁审计副本 `linkswift.user.js` sha256=`86d61a4692e975097e17b8cb9911faeb635940506ffa453dd6dec484b304caab`、840263 bytes；注入产物 `linkswift.bundle.js` sha256=`c9b20466486d3e232a30222b4940ece6c1f8d9853923d52edebb3fff20bb3fe1`、984404 bytes。
2. 已通过：`bun run test:all`（68 个 `bun:test` 文件 836 通过 / 1 跳过，3 个 `node:test` 文件 37 通过）。
3. 已通过：`bun run typecheck`。
4. 已通过：`bun run build:edge`；`bun run build`。
5. 已核对：Edge/Chrome 的 `manifest.json` 中 WAR matches 为云盘 patterns，cloud content script 为 `all_frames: false`、`run_at: document_start`，四个 `/cloud/` 资源均在产物中。
6. 已核对：构建产物的 `linkswift.bundle.js`、`linkswift-gm-shim.js` 哈希与 `app/public/cloud/` 一致。
7. 已用 Node 直连原生宿主验证 `ping` 返回 `{"success":true,"message":"pong"}`；未确认真实任务出现在 FluxDown 列表。
8. Native Messaging 已改用独立主机名 `com.fluxdown.cloud.nmh`：桌面端 `fluxdown-agent.exe` 每次启动会重写官方 `com.fluxdown.nmh.json`（只含官方扩展 ID）并把官方两个 HKCU 键指回该清单，旁加载 ID 被挤出白名单且每次重启复发；中继 `fluxdown_nmh.exe` 不读取主机名，换名不影响下载链路。新落点：清单 `%LOCALAPPDATA%\FluxDownCloudExtension\nmh\com.fluxdown.cloud.nmh.json`，注册表键 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.fluxdown.cloud.nmh` 与 `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.fluxdown.cloud.nmh`，备份 `%LOCALAPPDATA%\FluxDownCloudExtension\backups\nmhcloud-backup-<时间戳>.json`。
9. 已完成独立 GLM 只读复核：未发现 P0；提出 2 个 P1（HTTP sender、注入异步 TOCTOU）与 2 个 P2（存储未按厂商分区、响应体先整读后限长）。对应修复已落盘并新增测试；剩余风险是 `executeScript` 没有 `documentId` 原子绑定，校验与注入之间仍存在极短竞态，已用二次标签页校验与 boot origin guard 收窄。
10. 已通过：`bun test entrypoints/panel.content/drop-target.test.ts rules/x-rules.test.ts`（内核落点选择 + X 规则 13/13）；`bun run typecheck`；`bun run build:edge`。
11. 已通过：隔离 Edge（CDP 9223）+ 本地测试页内核球冒烟：悬浮球显示、Shift 拖出内核、失败停留并提示、轻点收回、拖放发起下载（NMH 未连时保留内核）。
12. 未验证：X / Twitter 真实页面（当前网络不可达）；DRM / 登录 / 会员内容不承诺可下载。
13. 已通过：连接诊断把浏览器原文归类为「扩展 ID 不在白名单 / 没找到下载桥 / 清单损坏」（`utils/nmh-diagnostics-tips.test.ts`）；侧边栏「诊断」页显示可复制的扩展 ID 与对应处理提示；`一键安装.cmd` 写 `logs\install-<时间>.log`（含每步结果与 `SUMMARY`），并在写完清单后回读校验 `allowed_origins`。

资源嗅探与内核球状态：B 站公开页 `BV1GJ411x7h7` 已真实验证（probe live，DASH 候选可下载）；X 规则仅限 twimg 域名并通过单测，未做真实页面验证。悬浮球可见性只依赖 pageDot（含全局与站点配置），与嗅探开关解耦。

当前未验证：真实网盘页面端到端任务与 FluxDown 任务列表结果，以及各网盘在登录状态下的实际 API/CDN 域名是否完全命中当前厂商映射。注入路径的毫秒级导航竞态未做浏览器级压力复现。X / Twitter 规则仅限 twimg 域名并通过单测，未做真实站点端到端验证。

已知限制：仅 Windows，需 FluxDown 桌面端已安装并在运行；DRM / 需登录 / 会员专属资源无法下载；不支持 `blob:` / MSE 流；旁加载扩展 ID 由绝对路径派生，换目录后必须重跑安装脚本；未连接时扩展会「熔断」放行浏览器原生下载（`breaker.ts` 30 秒冷却），部分下载看起来「没被拦截」属正常；`ruleSyncOutcome: fetch-failed` 属远程规则拉取的网络问题，不影响本机连接与下载。PowerShell 5.1 下 `[System.IO.File]::Replace($tmp,$dst,$null)` 会把 `$null` 绑成空串抛 `ArgumentException`（脚本已用 `Move-Item -Force` 回退）；无 BOM 含中文 `.ps1` 在 PS5.1 会解析错乱（脚本一律纯 ASCII）；`powershell -Command` 会吞 `$` 变量，必须用 `-File` 调用。
