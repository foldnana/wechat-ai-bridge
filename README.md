# 微信 AI 接入助手 / wechat-ai-bridge

面向非技术用户的 Windows 本地微信 AI 快速接入工具，基于 nexu 二次开发。核心价值是帮用户准备和管理运行环境，用自己的 API 快速连接微信；收费对象是软件或安装协助。

目标流程：安装并准备环境 → 填写用户自己的 API 并测试 → 微信扫码授权 → 查看连接状态，开始使用。

连接后提供可选的聊天建议和示例消息复制按钮，用户可以随时去微信试聊。首次回复不是完成配置或使用其他功能的前置条件；消息记录用于了解运行情况和排查问题。

## 当前状态

已完成第一轮功能精简和首次配置流程改造：默认 DeepSeek，填写 API 后实际生成测试回答，再保存并选择模型；提供有限重试的微信扫码、运行状态、回复阶段记录、暂停／恢复、用户预设和新开对话。开发模式下的桌面程序与后台已实际启动。尚未完成真实微信端到端实测、安装包验收和密钥存储改造，当前代码不是已验收的收费产品。

本仓库为独立的公开开发仓库，保留上游 MIT 许可。源码基线和差异见 [UPSTREAM.md](UPSTREAM.md)。

## 产品边界

- 用户自行购买和管理模型 API；不提供模型额度、云端托管或聊天内容服务。
- 程序在用户自己的 Windows 电脑上运行；电脑需要开机、联网且未休眠。
- 第一版仅做个人微信 ClawBot 接入，不承诺普通微信群或可被他人添加的普通微信账号。
- 用户自己编辑预设；提供新开对话与明确的数据清理入口。
- 默认关闭电脑命令执行、任意文件操作、浏览器控制、技能市场和自动任务。
- API 和聊天数据的存储保护、日志脱敏及隐私边界必须在发布前完成。
- 小程序和远程手机控制不在第一版范围内。

## 开始开发

开发依赖安装、类型检查以及前端、控制器和桌面壳构建已验证。完整 OpenClaw 运行环境、安装包和真实微信收发仍需单独验收。

开发机准备 Node.js 24 或以上及 pnpm 10.26.0（以 package.json 为准）。这些是开发依赖，不应要求最终用户安装。

```powershell
pnpm install
pnpm --filter @nexu/shared build
pnpm dev start
```

首次安装会执行上游 postinstall，准备运行时和依赖。开始前应先阅读 [AGENTS.md](AGENTS.md) 与 [开发计划](docs/project/ROADMAP.md)。

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm dev stop
pnpm dist:win:local
```

最后一个命令仅用于本地 Windows 打包检查，不代表发布版安装包已经验收。

Windows 打包前先停止开发服务，避免开发文件监视器占用暂存目录。如果 Electron 下载不可用，可把环境变量 `NEXU_DESKTOP_ELECTRON_DIST` 指向已安装、版本一致的 Electron `dist` 目录；不会自动下载或安装新版本。

打包会检查微信插件自己的生产依赖，不能依靠仓库根目录的依赖代替。若曾通过 `NEXU_SKIP_RUNTIME_POSTINSTALL` 跳过运行时准备，需先运行 `npm --prefix apps/controller/static/runtime-plugins/openclaw-weixin ci --omit=dev --ignore-scripts --no-audit --no-fund`，再重新打包。否则用户目录中的插件可能因缺少 `zod` 等模块而无法收消息，即使主界面和本地服务能够正常打开。

## 目录

- apps/desktop：Electron 桌面外壳、后台生命周期和更新。
- apps/web：配置界面与微信扫码入口。
- apps/controller：本地配置、模型服务和运行时管理。
- packages/shared：共享数据结构与模型供应商配置。
- docs/project：本项目范围、阶段计划和验收标准。
- upstream-reference：上游文档、CODEOWNERS 和已停用工作流的归档。

内部 @nexu/* 包名暂时保留。模型切换所需的内部运行插件也继续保留。上游统计初始化和自动更新已停用。Windows 应用标识、产品名、注册表和默认数据路径已独立；图标、启动素材及帮助地址的完整替换仍待完成。

默认配置目录为 `~/.wechat-ai-bridge`，Windows 桌面数据默认位于 `%APPDATA%/wechat-ai-bridge`，不会自动导入原版 nexu 的配置。开发模式使用项目内的独立运行目录。

Windows 窗口默认固定为 1280 × 800，屏幕可用区域较小时自动缩小；可以移动和最小化，不允许拖动边框缩放或最大化。较长页面通过上下滚动查看。

暂停会忽略新收到的消息，不在恢复后补发；已经开始的回复可能继续完成。新开对话通过运行服务重置上下文，保留预设和历史本机记录。首页可展开最近消息记录，其中的发送确认表示微信接口接受了请求，不代表手机已读，也不要求用户确认后才能继续使用。

## 发布前检查

见 [开发计划与验收标准](docs/project/ROADMAP.md) 和 [本轮精简记录](docs/project/CLEANUP.md)。工具、自动任务和自动长期记忆已在生成的运行配置中禁用，但仍须在实际安装包中验证权限边界。

## 许可和来源

nexu 原始代码采用 MIT License，版权属于 Powerformer, Inc. 及相应权利人。保留 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。其他依赖及素材须分别核对许可。本项目不代表 nexu、腾讯、微信或任何模型服务商官方。
