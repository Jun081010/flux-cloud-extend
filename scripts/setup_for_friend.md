# FluxDown 网盘下载拦截扩展：朋友一键安装说明

> 说明：本安装包直接分享给朋友时，请让朋友解压到自己能找到的文件夹，不要用鼠标选中
> 整包复制后粘贴到 C:\ 根目录那种「跨盘符/深层路径」。路径里最好只有英文、数字、横杠、
> 下划线，不要有中文、空格、括号，否则部分脚本在 Windows 10/11 里可能遇到权限/解析问题。

## 一句话总览

朋友只需要做三件事：

1. 浏览器里加载扩展。
2. 双击运行安装包里的「一键安装」批处理，把扩展自动注册到 FluxDown 桌面端。
3. 按提示完成浏览器重启和 FluxDown 登录后，用网盘链接测试。

## 你需要提前准备的东西

1. **FluxDown 桌面端已经安装**。本扩展是为 FluxDown 提供下载拦截/直链/资源嗅探能力，不是单独替代 FluxDown。
2. **一台 Windows 10 或 Windows 11 电脑**。
3. **浏览器**：Microsoft Edge 或 Google Chrome。

> 如果对下面这些词不理解：
> - 扩展 = 浏览器插件
> - Native Messaging = 浏览器插件和桌面程序之间交换下载任务的机制
> - 提取码 = 网盘分享链接里的解压密码，很多网盘分享需要它才能拿到下载链接
> - 直链 = 秒传/分享链接，浏览器可以直接拿到文件真实下载连接

## 第一步：解压安装包

1. 右键点击 FluxDown-Cloud-Extension-0.1.39.zip，选择 **全部解压缩**。
2. 解压到的目标文件夹建议这样取名，例如：
   - C:\FluxDown-Cloud-Extension-0.1.39
   - D:\Soft\FluxDown-Cloud-Extension-0.1.39
3. 解压后文件夹里面至少能看到这些：
   - dge-mv3：Chrome/Edge 扩展
   - chrome-mv3：Chrome 扩展
   - scripts\run-auto-setup.bat：双击安装批处理
   - scripts\setup-for-friend.ps1：Powershell 一键安装脚本
   - README-安装说明.md：本说明文件

> 危险目录提示：不要解压到 C:\Program Files、C:\Windows、C:\ProgramData、C:\Windows\System32。
> 这些目录容易被安全软件拦截，也可能涉及权限问题。

## 第二步：双击「一键安装」批处理

在解压后的文件夹里双击：

`	ext
scripts\run-auto-setup.bat
`

它会自动做三件事：

1. 启动当前浏览器。
2. 让浏览器自动加载本扩展。
3. 读取浏览器里扩展的真实 ID，并把扩展注册到 FluxDown 桌面端。

如果机器上浏览器在默认安装位置找不到，批处理会提示你手动指定浏览器路径。

### 常见路径

#### Microsoft Edge

`	ext
C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
C:\Program Files\Microsoft\Edge\Application\msedge.exe
`

#### Google Chrome

`	ext
C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
C:\Program Files\Google\Chrome\Application\chrome.exe
`

## 第三步：确认浏览器已加载扩展

1. 启动/重启浏览器，地址栏输入：

   - Edge：dge://extensions/
   - Chrome：chrome://extensions/
2. 打开 **开发者模式**。
3. 应该看到本扩展卡片。
4. 如果标题栏显示 **已连接**，说明注册完成。

> 常见错误：
> - 网络权限没有开：请给扩展添加 <all_urls> 权限。
> - 浏览器版本过低：需要较新版本的 Chromium 内核。
> - 路径里有特殊字符：重命名到简单路径后重试。

## 第四步：启动 FluxDown 并登录

1. 打开 FluxDown 桌面端。
2. 在浏览器扩展集成中启用扩展。
3. 在浏览器中登录网盘账号，至少打开一个分享链接页面。
4. 查看浏览器 FluxDown 图标是否显示 **已连接**。

> 登录状态和 Cookie 保存在浏览器，不由本扩展保存。不要要求朋友把账号密码交给你。

## 第五步：测试网盘链接

在浏览器打开一个网盘分享链接，点悬浮球后应能看到：

1. 普通网页资源：视频、图片、文件。
2. 网盘分享链接：会提示是否自动转直链。
3. 拖动刷子到以下位置时应出现下载操作：
   - 网页视频标签
   - 图片文件
   - 文件链接
   - 网盘分享链接
   - 带提取码的网盘分享文本

## 第六步：测试你提到的两个文章案例

你提到的资料中有两个候选地址：

1. https://ysyx.oscc.cc/docs/2607/f/2.html#%E7%8E%AF%E5%A2%83%E9%9C%80%E6%B1%82
2. https://ysyx.oscc.cc/docs/2607/f/2.html#%E4%B8%8B%E8%BD%BD%E5%AE%89%E8%A3%85

请从浏览器右上角访问这两个地址，并在扩展面板里找是否能识别出网盘链接。

如果这里两个链接都无法识别，说明我还需要你给出：
- 真实的网盘分享链接
- 提取码
- 浏览器导航到的网盘页面截图
- 你在面板里看到的实际资源列表

我会逐条整理成：
- 网盘 URL
- 提取码
- 预计测试动作
- 验收结果

## 故障排查

### 1. 看不到扩展

1. 检查是否打开了 dge://extensions/ 或 chrome://extensions/。
2. 检查是否启动了开发者模式。
3. 检查是否加载了对的文件夹：dge-mv3 或 chrome-mv3。

### 2. 标题栏不是「已连接」

1. 重启浏览器。
2. 重启 FluxDown 桌面端。
3. 使用桌面端的浏览器扩展集成功能重新启用。
4. 如果还不行，重新运行 scripts\run-auto-setup.bat。

### 3. 下载任务被弹出「新建下载」确认

这是正常现象。

- 浏览器拦截到了下载，但 FluxDown 桌面端需要你确认。
- 打开 FluxDown 任务栏弹出的 **新建下载** 窗口点确认。
- 如不想每次都弹窗，可进入 FluxDown 设置中开启 **静默下载**。

### 4. 网盘链接为空、提取码无法识别

1. 确认网页处于登录状态。
2. 确认网页包含可识别的分享链接。
3. 确认链接里明确带有文件/目录 URL。
4. 如果网盘侧有「转直链/下载助手」按钮，可先用网页按钮手动生成直链，然后再拖到刷子上。

### 5. 拖动刷子不响应

1. 把鼠标先移到浏览器窗口内侧，让刷子悬浮球显示。
2. 确认当前页面有可识别资源。
3. 对网盘网页，刷子通常要先在页面内移动一段距离。

### 6. 网盘限速、失败、登录后仍不正常

可能原因：

1. 网盘限速。
2. 网盘登录态失效。
3. 网盘侧防盗链或下载接口被限流。
4. 浏览器插件拦截过于严格。

## 升级和重装

1. 打开扩展管理页。
2. 点击扩展卡片上的 **重新加载**。
3. 打开文件夹 dge-mv3 或 chrome-mv3，替换所有文件后再次点击 **重新加载**。

## 技术细节

本安装包内嵌代码主要分为：

- 浏览器扩展：dge-mv3 / chrome-mv3
- 安装脚本：scripts 目录
- 说明文件：README-安装说明.md

扩展会读取系统代理和 FluxDown 可用通道，并把下载请求交给 FluxDown 运行。

> 截图/学习资料里的实际链接：
> 1. https://ysyx.oscc.cc/docs/2607/f/2.html#%E7%8E%AF%E5%A2%83%E9%9C%80%E6%B1%82
> 2. https://ysyx.oscc.cc/docs/2607/f/2.html#%E4%B8%8B%E8%BD%BD%E5%AE%89%E8%A3%85

## 许可

本扩展基于 FluxDown 官方扩展与 LinkSwift 构建，均为 AGPL-3.0 第三方组件，
整体按 AGPL-3.0 发布。详见 LICENSE 与 THIRD_PARTY_NOTICES.md。
