# macLinker

开源的 Mac 连接工具：用 Moonlight 提供低延迟桌面和声音，用内置 VNC 作为桌面回退，用内置 SSH / SFTP 管理文件与执行命令，再通过 AI harness 进行远控。主要功能放在客户端，被控 Mac 无需安装 macLinker。

**当前版本：v0.3.1 Electron 桌面客户端。** 桌面版采用 Electron、React、TypeScript，内置 SSH / SFTP、VNC 桌面和 AI 工具调用循环。Android、iOS 是后续方向；Electron 只用于本阶段桌面端。

## 启动桌面版

开发环境需要 Node.js 24+，在仓库根目录执行：

```bash
npm install
npm run dev
```

或构建后运行：

```bash
npm run build
npm start
```

桌面安装包自带 Electron / Node.js 运行时和 SSH 实现，无需另外安装开发环境或系统 SSH 命令。高性能音视频串流需单独安装 Moonlight Qt；内置 VNC 无需额外客户端。

1. 添加设备，填写 Mac 的地址、SSH 用户名和端口，可选私钥文件。
2. 被控 Mac 至少开启“远程登录”（SSH）。点击连接，输入账户密码或使用私钥 / SSH agent；首次连接核对主机指纹。连接成功后自动检查 Sunshine 安装与运行状态、本机 Moonlight、串流端口和远端 VNC。
3. 在“文件”中浏览目录、预览文本、新建文件夹、上传和下载；在“远程命令”中运行 shell 命令。
4. 概览会推荐可用的桌面方式：优先 Moonlight，条件不足时回退到内置 VNC；两者都未就绪时继续使用 SSH。Moonlight 首次使用需要配对，在独立窗口播放；VNC 在应用内打开。
5. 在设置中填写支持 Chat Completions 工具调用的 AI 服务基础地址、模型 ID 和 API Key，再到“AI 助手”中输入任务。

桌面 AI 自己完成会话和工具调用循环，不要求安装其他 Agent。它可以列目录、读取文本和申请执行远程命令。**每条 AI shell 命令都需要在桌面原生对话框中确认**；可取消任务，每轮最多 8 次模型调用，工具结果与历史上下文有长度限制。不同设备的模型上下文相互隔离。会话仅保留在本次应用运行中。

文件内容和命令结果会发送给你配置的模型服务；SSH 密码和私钥不会提供给模型。服务地址要求 HTTPS，本机服务可用 HTTP。系统钥匙串可用时加密保存 API Key；SSH 密码是否保存由连接窗口中的选项控制。钥匙串不可用时仅保留在内存，不明文落盘。

桌面配置保存在 Electron 的用户数据目录下的 `workspace.json`：Linux 为 `~/.config/maclinker-desktop/`，macOS 为 `~/Library/Application Support/maclinker-desktop/`，Windows 位于 `%APPDATA%/maclinker-desktop/`。可用 `MACLINKER_DATA_DIR` 指定隔离的调试目录。桌面版不会自动读取 `.test/` 的凭据。

### Moonlight 集成方式与服务端引导

当前采用官方 **Moonlight Qt + Sunshine** 的串流方案，macLinker 负责设备管理、SSH、检测和启动；**尚未 fork Moonlight / Sunshine，也未把 Moonlight 协议栈和解码器内嵌进 Electron**。目前会调用本机安装的 Moonlight，在独立窗口显示画面。VNC 查看器已经内置。

连接 SSH 后，即使 VNC 可用，也会建议启用高性能串流。概览的“设置高性能串流”按检测结果提供下一步：未安装 Sunshine 时建议在被控 Mac 安装；已安装但未运行时提示启动和系统授权；远端已响应而本机缺少 Moonlight 时提示安装客户端。引导包含官方下载、管理页、配对和重新检查，不会自动运行安装命令。官方下载链接在当前电脑打开，界面会明确区分服务端和客户端应安装的位置。

后续内置客户端的目标是复用 [moonlight-common-c](https://github.com/moonlight-stream/moonlight-common-c) 的原生 GameStream 客户端核心，并接入硬件解码、音频和输入。该核心也被 Moonlight 的桌面、Android、iOS 客户端复用。Electron 继续承载工作台界面；内置原生串流属于后续开发，当前安装包不包含这部分。服务端优先兼容原版 Sunshine；若后续扩展确实需要改动服务端，fork 的项目应是 Sunshine。

### 剪贴板与复制文件的后续设计（尚未实现）

音视频使用 Moonlight / Sunshine；剪贴板和文件使用独立的数据通道，复用 SSH 的认证与加密、SFTP 的文件传输。这些增强不要求修改 GameStream 视频协议，也不依赖某个 Sunshine 分支独有的扩展。

- **文字剪贴板**：由客户端与被控 Mac 的桌面辅助进程同步。辅助进程必须运行在授权的图形用户会话中；SSH 登录账户不一定就是正在使用桌面的账户，不能仅凭 SSH 已登录就认定能访问该桌面的剪贴板。按设备和会话启用同步，用来源与版本标记防止反复回写；断开或切换设备立即停止。剪贴板内容不进入 AI 会话。
- **复制文件后粘贴**：复制的是文件清单，文件内容通过 SFTP 传输；待传输完成，再通过辅助进程将目标端文件引用写入系统剪贴板，让 Finder / 文件管理器完成粘贴。需要同时处理目录、临时文件、同名冲突、取消和进度；不能只把本机路径作为文字发给远端。双向文件粘贴需要各客户端平台的原生文件剪贴板适配。
- **安装层次**：SSH 仍是最低要求；Sunshine 是推荐的高性能桌面服务端；桌面辅助进程是未来剪贴板等增强功能的可选组件。当前没有安装或启动该辅助进程。

截至 2026-11-11，官方 [Moonlight 使用说明](https://github.com/moonlight-stream/moonlight-docs/wiki/Setup-Guide#keyboardmousegamepad-input-options) 提供 `Ctrl+Alt+Shift+V` 将本机剪贴板文字输入远端；这不等于双向系统剪贴板。上游 [双向文字同步 PR #2019](https://github.com/moonlight-stream/moonlight-qt/pull/2019) 仍待合并，且依赖匹配的服务端支持，当前版本不会将其视为已有能力。

### 首次检查与 VNC 回退

每次 SSH 连接成功都会自动检查，也可以手动“重新检查”。**Moonlight 是客户端，被控端检查的是 Sunshine 服务端**。

| 检查结果 | 桌面行为 |
| --- | --- |
| Sunshine 已安装并运行、TCP 47989 可达、本机已安装 Moonlight | 优先启动 Moonlight；若 VNC 可用，可点“改用 VNC” |
| Sunshine 未安装、未启动、端口不可达或本机没有 Moonlight，但 VNC 已响应 | 自动选择内置 VNC，通过当前 SSH 连接转发 |
| 两种桌面都不可用 | 显示启用说明；SSH 文件、命令和 AI 工具继续可用 |

VNC 连接固定转发到被控端 `127.0.0.1:5900`，可在设备的高级选项中更改端口。检查会验证 RFB 协议标识，不会将任意开放端口误判为 VNC。SSH 服务需要允许本地端口转发。应用没有额外监听本机 WebSocket 端口，图像与输入通过 Electron IPC 和 SSH 通道传输。

Mac 可以在“系统设置 → 通用 → 共享”中开启“屏幕共享”，并配置允许访问的用户；若已经开启“远程管理”，在其设置中配置访问权限。使用传统 VNC 认证时，需要开启允许 VNC 查看器控制屏幕的选项并设置 VNC 密码。内置查看器按服务端要求提示用户名 / 密码，**VNC 密码可能不同于 SSH 密码，不会自动复用或保存 SSH 密码**。[Apple 屏幕共享说明](https://support.apple.com/guide/mac-help/mh11848/mac)。

VNC 支持画面、键鼠和仅查看模式，不传输音频。离开 VNC 页面、断开 SSH 或关闭窗口会关闭隧道；桌面密码仅用于当前认证，不持久化。仅开启 SSH 不会自动打开图形桌面；macLinker 不会自动安装 Sunshine 或修改屏幕共享权限。桌面可用性仍取决于 Mac 的登录状态和授权。

TCP 检查通过不等于 Moonlight 音视频已经连通；配对、UDP 网络和系统权限仍需实际验证。Moonlight 无法创建进程时会尝试 VNC；若进程已启动但配对或串流失败，可返回概览点击“改用 VNC”。

### 桌面版当前边界

- SFTP 支持单文件、多文件上传、单文件下载、文本预览和新建目录；完整目录传输和增量同步尚未实现。
- 上传采用独占创建，同名目标会被拒绝，避免静默覆盖。失败或取消的上传可能保留部分远程文件；界面会显示结果。下载先写临时文件，失败和取消时保留原目标文件。
- 远程命令每次独立执行，最长 60 秒；还没有交互式 PTY 终端。取消会关闭本地通道，不保证所有远程子进程随之结束。
- 桌面 SSH 不解析 OpenSSH 配置中的别名或 ProxyJump，填写实际主机地址。
- AI 当前接入 Chat Completions 工具调用兼容服务；不包含模型账号、订阅或内置模型，也没有视觉点击 Agent。
- 高性能串流的解码、键鼠和声音由外部 Moonlight 处理；VNC 回退已内嵌，但没有内嵌 Moonlight 播放器。当前已实测 Linux 桌面客户端连接 Mac，macOS / Windows 构建已配置，仍需各平台运行验收。

### 打包与检查

```bash
npm run typecheck
npm test
npm run build
npm run test:desktop
npm run pack                 # 当前平台的未安装应用目录
npm run dist                 # 当前平台安装包
```

打包配置包含 macOS DMG / ZIP、Windows NSIS、Linux AppImage / DEB，输出到 `release/`。发布前需在目标平台构建并完成签名、公证或安装验收；当前没有配置发布凭据。Linux 无桌面 CI 可用 `xvfb-run -a npm run test:desktop`。开发服务器支持界面热更新；修改主进程或连接核心后重新启动 `npm run dev`。

真实设备测试显式启用，并使用已信任的 SSH 主机记录：

```bash
MACLINKER_LIVE_DEVICE_FILE=.test/devices.txt \
MACLINKER_LIVE_KNOWN_HOSTS=.test/known_hosts npm run test:desktop
```

常规桌面测试包括独立 SSH/VNC 服务夹具，验证自动检测与回退、独立 VNC 密码认证、错误密码、画面像素、键鼠输入、仅查看模式和隧道清理；不代表所有 macOS VNC 认证组合都已实机验证。本次另用测试 Mac 验证了 macOS 屏幕共享的账户认证（ARD）与 1920×1080 锁屏画面；未自动解锁或修改桌面设置。

真实设备测试覆盖自动服务检测、桌面密码登录、带特殊字符的文件传输与 SHA-256 校验、同名上传保护、预览、远程命令、取消后恢复、下载取消不覆盖本地文件，以及本地兼容模型服务调用真实 SSH 工具。模型服务是测试夹具，**不代表真实付费模型账号已经验证**。测试只使用独立的本地临时目录及远程 `/tmp/maclinker-desktop.*`，结束时清理。

## 组件关系

| 位置 | 组件 | 用途 |
| --- | --- | --- |
| 被控 Mac | Sunshine | 桌面画面、声音和输入的串流服务端 |
| 被控 Mac | 系统“远程登录” / SSH（必需） | 命令、文件传输和 VNC 隧道 |
| 被控 Mac（可选） | 系统“屏幕共享” / VNC | Sunshine 不可用时提供桌面回退 |
| 控制端 | macLinker Desktop | 设备、诊断、文件和内置 AI 助手 |
| 控制端（可选） | Moonlight Qt | 解码、播放声音、转发键鼠 |
| 控制端（内置） | noVNC | VNC 桌面渲染与键鼠输入 |

Moonlight 是客户端；被控端需要安装的是 [Sunshine](https://github.com/LizardByte/Sunshine)。参考 [Moonlight 官方站点](https://moonlight-stream.org/)和 [Sunshine 安装说明](https://docs.lizardbyte.dev/projects/sunshine/latest/md_docs_2getting__started.html)。macLinker 不会自动安装服务或修改 Mac 的系统权限。

`.test/` 用于私有设备配置、凭据及测试结果，整个目录由 `.gitignore` 忽略。应用不会自动读取其中的凭据。Git 不识别 `.gitigr`，因此原文件已改正为 `.gitignore`。

## 代码结构与后续方向

```text
src/shared/         设备、连接、事件与 IPC 接口类型
src/core/           SSH / SFTP、服务探测、VNC 隧道、配置、Moonlight、AI 工具循环
src/main/           Electron 主进程、系统对话框、钥匙串及隔离的 preload
src/renderer/       React 桌面界面
src/tests/          参数、存储、服务探测、VNC 隧道与 AI 循环测试
src/e2e/            Electron 交互及可选真实设备测试
scripts/            项目所需的 Node.js 开发、构建和启动脚本
.github/workflows/  桌面应用跨平台构建与测试
```

项目源码、自动化测试和开发脚本使用 TypeScript / JavaScript。`scripts/` 中的四个 `.mjs` 文件是 `npm run dev`、`npm run build` 和 `npm start` 实际调用的项目构建工具。一次性排查、环境探测等临时脚本放在系统临时目录 `/tmp`，不作为项目源码保留。

AI 实现参考 [Cline](https://github.com/cline/cline)、[OpenHands](https://github.com/OpenHands/OpenHands) 的工具循环与操作确认思路；协议格式参考[工具调用文档](https://developers.openai.com/api/docs/guides/function-calling)。这里是独立实现，没有复制这些项目源码，也不依赖其运行时。[Electron 安全边界](https://www.electronjs.org/docs/latest/tutorial/security)用于隔离界面与主进程；凭据使用 [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) 的异步接口。

VNC 查看器使用 [noVNC 1.7.0](https://github.com/novnc/noVNC/tree/v1.7.0)，其核心源码未修改；MPL-2.0、依赖许可、作者与源码获取说明在 `src/assets/licenses/noVNC/`，并随安装包分发。

下一阶段包括完整的目录同步界面、交互式终端、内嵌 Moonlight 串流与视觉操作。移动端可以复用设备与事件契约、工具定义和 AI 会话逻辑，但需要新的移动端界面、SSH / 串流适配层及平台钥匙串实现；不会把 Electron 直接移植到 Android / iOS。
