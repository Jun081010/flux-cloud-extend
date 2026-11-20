# FluxDown 云盘下载拦截扩展（分享版 {{VERSION}}）

在 FluxDown 官方浏览器扩展基础上，增加网盘直链解析、资源嗅探与「悬浮球内核拖拽下载」，
并把朋友电脑上最容易缺的两样东西一起打包：**下载桥注册脚本**和 **FFmpeg**。

整个安装过程只需要双击一个文件。

## 这个包里有什么

| 目录 / 文件 | 作用 |
| --- | --- |
| `一键安装.cmd` | 唯一需要双击的文件：装扩展、注册桥、装 FFmpeg、重启桌面端、建快捷方式 |
| `extension\edge-mv3` | Edge 版扩展 |
| `extension\chrome-mv3` | Chrome 版扩展 |
| `tools\ffmpeg` | 内置 FFmpeg（合并 B 站 / X 等分离的音视频轨） |
| `scripts` | 一键脚本、桥注册脚本与手动排查脚本 |
| `README-安装说明.md` | 本文件 |

## 前置条件

- Windows 10 / 11。
- Microsoft Edge 或 Google Chrome（Chromium 116 以上）。
- 已安装 **FluxDown 桌面端**（下载器本体，不在本包内）：
  https://github.com/zerx-lab/FluxDown

## 30 秒安装

1. 把压缩包解压到**一个不会被随手删掉的目录**（例如 `D:\Tools\FluxDownCloud`）。
2. 双击根目录的 **`一键安装.cmd`**。
3. 看到「完成」后，按提示做最后一步：
   - 浏览器当前开着：完全退出后重新打开；或
   - 打开 `edge://extensions/`（Chrome 为 `chrome://extensions/`），
     在 FluxDown Cloud 卡片上点一次「**重新加载**」。
4. 从托盘启动 FluxDown 桌面端。点击浏览器工具栏的 FluxDown 图标，标题栏显示「**已连接**」即成功。

> 首次安装时如果浏览器正开着，一键脚本无法把扩展塞进已启动的进程：
> 请先完全退出浏览器，再双击桌面上的 `FluxDown Cloud (Edge)` 快捷方式启动一次。
> 之后正常打开浏览器即可，扩展会一直保留。

> 脚本会在装完 FFmpeg 后**自动重启一次 FluxDown 桌面端**，让它读到新的 PATH。
> 如果当时有任务正在下载，脚本会跳过重启并提示你下载完成后再手动重启。
> **0.1.42 及更早的分享包不含 FFmpeg**，会出现「视频有画面没声音」，请改用 {{VERSION}}。

## 一键脚本做了什么

`一键安装.cmd` 会按顺序完成下面这些事，全部写入当前用户，**不需要管理员权限**：

1. 自动识别已安装的 Edge / Chrome。
2. 找到浏览器里已有的 FluxDown Cloud 扩展：有就原地更新，没有就装到
   `%LOCALAPPDATA%\FluxDownCloudExtension\extension\<浏览器>-mv3`。
3. 计算扩展 ID，注册本项目专属的 Native Messaging 桥
   `com.fluxdown.cloud.nmh`（注册表只写 `HKCU`，改动前自动备份）。
4. 把内置的 `ffmpeg.exe` / `ffprobe.exe` 复制到
   `%LOCALAPPDATA%\FluxDownCloudExtension\ffmpeg\bin`，并加入当前用户 PATH。
5. 确认没有正在进行的下载任务后，重启 FluxDown 桌面端，让新 PATH 生效
   （有任务在跑时跳过并提示，不会打断下载）。
6. 在桌面创建 `FluxDown Cloud (Edge)` / `(Chrome)` 快捷方式，
   以后从快捷方式启动会自动加载扩展。
7. 打印扩展 ID、安装目录与最后一步提示。

脚本是幂等的：重复运行不会产生第二份安装，只会更新文件并重新确认桥注册。

## 更新

1. 把新压缩包**解压覆盖**到旧目录（保留原来的 `scripts` 与 `extension` 结构即可）。
2. 再双击一次 `一键安装.cmd`。
3. 按提示重新加载扩展 / 重启浏览器。

已有安装会被原地更新，扩展 ID 不变，桥注册不需要重新折腾。

从 **0.1.42 或更早**升级时请务必安装 {{VERSION}}：旧分享包没有打包 FFmpeg，
B 站、X 等「画面与声音分开传输」的视频只会下到画面。

## 日常使用

**下载拦截**：普通浏览器下载会自动接管并推送到 FluxDown。

**悬浮球**：任意网页右侧显示悬浮球。

- 点击球体：打开资源面板，查看嗅探到的视频 / 音频 / 图片 / 文件。
- 拖动球体：移动位置并记住（自动贴边吸附）。
- `Shift` + 拖动球体：拖出 14px 内核小球。
- 打开 123 云盘分享页后点击球体：面板直接列出网盘目录，可进入文件夹、返回上级，
  文件右侧「下载」会通过网盘官方接口把直链发送给 FluxDown。

**内核小球拖拽下载**：

- 拖到**视频、图片、文件链接**上松手，即可直接下载。
- 拖到**网盘分享链接**（含提取码文本）上松手，扩展会打开分享页并自动转直链推送 FluxDown。
- 拖到 X 的图片上会取原图（`name=orig`），不是缩略图。
- 下载成功小球收回；失败（DRM、登录受限、桌面端未连接等）小球留在原地，可再试。
- 把小球拖回大球范围，或轻点小球，即可收回。

**资源质量**：

- 多档位视频默认取**最高清**（分辨率 → 码率 → 帧率 → 文件大小），不用手动挑档。
- 资源嗅探默认开启图片、单页上限 1000 条，会采集 `srcset` / `<picture>` / 懒加载 /
  `og:image` / 视频封面。
- 除 `http(s)` 外还识别 `magnet:` / `ed2k:` / `thunder:` / `115://` 链接并转交桌面端
  （桌面端是否支持以 FluxDown 当前版本为准）。

## 手动安装（一键脚本失败时）

1. 打开 `edge://extensions/`（Chrome 为 `chrome://extensions/`），开启「开发人员模式」。
2. 点「加载已解压的扩展」，选择 `extension\edge-mv3`（Chrome 选 `extension\chrome-mv3`）。
3. 在扩展卡片上复制 32 位扩展 ID。
4. 在解压目录打开 PowerShell，执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-for-friend.ps1 -Browser Edge -ExtensionId <你复制的ID>
```

Chrome 把 `Edge` 换成 `Chrome`；两个都装用 `All`。
FFmpeg 可手动把 `tools\ffmpeg` 加入系统 PATH。

## 常见问题

**显示「未连接」**

1. 确认 FluxDown 桌面端正在运行（托盘里有图标）。
2. 完全退出浏览器（所有窗口），确认托盘没有残留后台进程，再重新打开。
3. 重新运行一次 `一键安装.cmd`，它会按当前扩展 ID 重新注册桥。

本扩展用的是独立主机名 `com.fluxdown.cloud.nmh`，不会被 FluxDown 启动时的自我修复挤掉。

**扩展 ID 变了 / 装了两份**

Edge 的侧载扩展 ID 与「加载路径」绑定。移动或删除扩展目录都会换 ID。
一键脚本会优先原地更新已有目录，正常升级不会变 ID；如果手动换过目录，重新运行一次脚本即可。

**某些下载没被接管**

以下情况官方层面就无法交给下载器，属于正常现象：

- 网页在浏览器内生成的文件（`blob:` / `data:` 链接、Service Worker 流式下载）。
- 受 DRM 保护的视频（下载到的只是无法播放的密文）。
- 需要登录 / 会员 / 站点鉴权的直链。

**点击下载后浏览器没下载、FluxDown 里也没有任务**

很可能是拦截**已经生效**，FluxDown 弹出了「新建下载」确认窗口在等你确认。
到任务栏找 FluxDown 的「新建下载」窗口点确认即可。
不想每次都确认：FluxDown「设置 → 行为」勾选「静默下载」（`download.silent_download`）。

**B 站 / X 视频只有画面没有声音**

原因：这类站点把画面和声音分成两条轨，桌面端必须调用 FFmpeg 合并。
旧分享包（0.1.42 及更早）没有内置 FFmpeg，也不会有任何报错，只会**静默**留下无声视频。

1. 确认用的是 {{VERSION}}（`extension\edge-mv3\manifest.json` 里的 `version`）。
2. 确认 `%LOCALAPPDATA%\FluxDownCloudExtension\ffmpeg\bin\ffmpeg.exe` 存在。
3. 完全退出 FluxDown 桌面端后重新启动（PATH 需要新进程才会生效）。
4. 仍不行：在 FluxDown「设置 → 组件」里把 FFmpeg 手动路径指向上面的 `ffmpeg.exe`。

**网盘页面没有出现「推送至 FluxDown」按钮**

受支持网盘：百度网盘、阿里云盘、天翼云盘、移动云盘、迅雷云盘、广雅盘、夸克网盘、UC 网盘、123 云盘。
页面必须是 `https://`，且需要先登录。百度网盘的按钮名为「下载助手」；
拖动分享链接时会自动提链，不需要手动点它。

**下载速度只有几百 KB/s，或越下越慢**

这是网盘对账号 / 直链的限速，扩展不绕过会员与流量限制；换网络、错峰或使用网盘会员可改善。

## 网盘登录与会话

- 扩展不保存网盘账号、密码或 Cookie 副本，登录状态由浏览器自身的 Cookie 持久化。
- 首次使用请在浏览器中登录一次，并勾选「记住登录 / 保持登录」。
- 百度网盘分享页未登录时会保留自动标志并持续等待，登录完成后自动继续提链，最多等待 10 分钟。
- 若登录后仍未开始，把分享链接重新拖到内核小球上一次。

## 卸载

1. 在扩展管理页移除 FluxDown Cloud。
2. 删除 `%LOCALAPPDATA%\FluxDownCloudExtension`（扩展副本、FFmpeg、备份）。
3. 删除桌面上的 `FluxDown Cloud (...)` 快捷方式。
4. 如不需要 FFmpeg，可从「用户环境变量 PATH」里删掉对应的 `...\ffmpeg\bin`。
5. 可选：`.\scripts\install-native-host.ps1 -Uninstall` 清理桥注册表项。

## 许可

本扩展基于 FluxDown 官方扩展与 LinkSwift 构建，均为 AGPL-3.0 第三方组件，
整体按 AGPL-3.0 发布。内置 FFmpeg 为 GPL-3.0 构建，仅原样转分发。
详见 `LICENSE`、`THIRD_PARTY_NOTICES.md` 与 `tools\ffmpeg\README.txt`。
