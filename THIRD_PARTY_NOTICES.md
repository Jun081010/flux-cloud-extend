# 第三方组件

## FluxDown

- 来源：https://github.com/zerx-lab/FluxDown
- 版本：克隆时 `main` 分支（2026-11-16）
- 许可证：AGPL-3.0
- 用途：浏览器下载拦截、Native Messaging、任务发送与扩展 UI 底座
- 本项目对 `fluxDown/` 的副本进行了修改，新增网盘页面注入与直链发送桥。

## LinkSwift

- 来源：https://github.com/hmjz100/LinkSwift
- 版本：1.1.4（2026-11-16 克隆的 `main` 分支）
- 许可证：AGPL-3.0
- 用途：网盘页面直链解析
- 本项目通过构建期补丁新增 FluxDown 下载模式，并在扩展内注入。

## LinkSwift 本地运行时依赖

以下固定版本文件由 `vendor/LinkSwift/` 随项目分发，并由 `scripts/patch-linkswift.mjs` 复制到 `app/public/cloud/vendor/`；上游 LinkSwift 以 `@require` / `@resource` 声明它们。前三个 JS 依赖在生成 `app/public/cloud/linkswift.bundle.js` 时由构建期包装器隔离加载，两份 CSS 由 background 读入 boot 的 `resources`，再由 shim 通过 `GM_getResourceText` 提供；页面原有 `jQuery` / `$` / `Swal` / `md5` 等引用保持。

实际注入浏览器的是 `app/public/cloud/linkswift.bundle.js`（当前 984404 bytes，SHA-256 `c9b20466486d3e232a30222b4940ece6c1f8d9853923d52edebb3fff20bb3fe1`）；`linkswift.user.js` 只作为补丁审计副本（840263 bytes，SHA-256 `86d61a4692e975097e17b8cb9911faeb635940506ffa453dd6dec484b304caab`）。运行时不会从 unpkg 拉取上述依赖。构建脚本与补丁测试均已在本项目内实际执行，两者的哈希由 `bun run test:cloud` 与 `Get-FileHash` 复核。

### jQuery

- 来源：https://jquery.com/ 与 https://github.com/jquery/jquery
- 版本：3.6.0
- 许可证：MIT
- 版权：(c) OpenJS Foundation and other contributors
- 本地文件：`vendor/LinkSwift/jquery.min.js`、`app/public/cloud/vendor/jquery.min.js`
- 用途：LinkSwift 页面 DOM 操作与事件处理的本地运行时依赖，由隔离 bundle 内联加载。

### SweetAlert2

- 来源：https://sweetalert2.github.io/ 与 https://github.com/sweetalert2/sweetalert2
- 版本：11.4.8
- 许可证：MIT
- 本地文件：`vendor/LinkSwift/sweetalert2.min.js`、`vendor/LinkSwift/sweetalert2.min.css`、`app/public/cloud/vendor/sweetalert2.min.js`、`app/public/cloud/vendor/sweetalert2.min.css`
- 用途：LinkSwift 弹窗交互；JS 由隔离 bundle 内联加载，CSS 作为 boot 资源提供。

### @sweetalert2/theme-dark

- 来源：https://github.com/sweetalert2/sweetalert2-themes
- 版本：5.0.26
- 许可证：MIT
- 本地文件：`vendor/LinkSwift/sweetalert2-dark.min.css`、`app/public/cloud/vendor/sweetalert2-dark.min.css`
- 用途：LinkSwift 深色主题样式，作为 boot 资源提供。

### js-md5

- 来源：https://github.com/emn178/js-md5
- 版本：0.7.3
- 许可证：MIT
- 版权：Chen, Yi-Cyuan 2014-2017
- 本地文件：`vendor/LinkSwift/md5.min.js`、`app/public/cloud/vendor/md5.min.js`
- 用途：LinkSwift 字符串哈希计算的本地运行时依赖，由隔离 bundle 内联加载。

## FFmpeg（分享包内置）

- 来源：https://ffmpeg.org/ ，Windows 构建来自 https://www.gyan.dev/ffmpeg/builds/
- 版本：ffmpeg 6.0-essentials_build（2023，`--enable-gpl`）
- 许可证：GPL-3.0（该构建启用 x264/x265）
- 本地文件：`tools/ffmpeg/ffmpeg.exe`、`tools/ffmpeg/ffprobe.exe`
- 用途：FluxDown 引擎合并 DASH/HLS 分离的音视频轨（如 B 站、X）
- 分发说明：分享包仅原样转分发上述二进制，未做修改；源码与构建脚本见上游链接，
  完整许可证见 https://www.gnu.org/licenses/gpl-3.0.txt

## 许可证

本项目整体按 GNU Affero General Public License v3.0 发布，见根目录 `LICENSE`。
