# 微信 AI 接入助手 / wechat-ai-bridge

面向非技术用户的 Windows 本地微信 AI 接入工具，基于 nexu 二次开发。

目标流程：安装软件 → 填写用户自己的 API → 测试模型 → 微信扫码授权 → 验证第一条回复。

## 当前状态

已完成第一轮功能精简：界面保留微信连接、自带 API / 模型和基础设置；移除上游账号、积分奖励、推广、技能市场、办公集成及非微信连接接口。尚未完成微信端到端实测、安装包验收和密钥存储改造，当前代码不是已验收的收费产品。

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
pnpm dist:win:local
```

最后一个命令仅用于本地 Windows 打包检查，不代表发布版安装包已经验收。

## 目录

- apps/desktop：Electron 桌面外壳、后台生命周期和更新。
- apps/web：配置界面与微信扫码入口。
- apps/controller：本地配置、模型服务和运行时管理。
- packages/shared：共享数据结构与模型供应商配置。
- docs/project：本项目范围、阶段计划和验收标准。
- upstream-reference：上游文档、CODEOWNERS 和已停用工作流的归档。

内部 @nexu/* 包名暂时保留。模型切换所需的内部运行插件也继续保留。上游统计初始化和自动更新已停用；应用标识、数据目录、图标及其他品牌素材的替换属于下一阶段。

## 发布前检查

见 [开发计划与验收标准](docs/project/ROADMAP.md) 和 [本轮精简记录](docs/project/CLEANUP.md)。工具、自动任务和自动长期记忆已在生成的运行配置中禁用，但仍须在实际安装包中验证权限边界。

## 许可和来源

nexu 原始代码采用 MIT License，版权属于 Powerformer, Inc. 及相应权利人。保留 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。其他依赖及素材须分别核对许可。本项目不代表 nexu、腾讯、微信或任何模型服务商官方。
