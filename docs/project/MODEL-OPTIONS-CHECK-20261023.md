# 模型说明与高级设置验收（2026-10-23）

本机验收包：`apps/desktop/release/model-options-20261023/win-unpacked/WeChat AI Bridge.exe`，版本 0.1.12，标记 `bce62d3-local-model-options`。保持 Windows 本地 BYOK 和现有微信通道；本次未推送远端、未发布安装器。

## 功能

- 模型发现保留服务商提供的名称、上下文和输出上限、输入模态及思考能力；未知字段不返回前端。只有完整列表成功返回时才提示当前模型缺席，保留旧配置。
- 新增百炼北京、硅基流动大陆快捷地址，支持手动改地址。切换服务商清空草稿密钥；两种预设单独保存，避免互相覆盖。硅基流动请求聊天模型列表。
- 高级设置默认折叠，按连接和模型保存。已保存密钥只在本机控制器使用；调整同一个模型的设置也能测试并保存。失败不覆盖原配置。
- 思考控制限定 DeepSeek 官方 `deepseek-flash` / `deepseek-v4-pro`：默认、关闭、low、high、max；其他接口不发送未经验证的思考参数。
- 默认单次请求总时限 90 秒、网络重试 1 次，支持 30–180 秒、0–2 次；旧连接也应用这一默认值。设置会同步到不含密钥的运行时状态文件。
- 在实际 pi-ai Chat Completions 传输处设置请求参数、SDK 重试和覆盖流式正文的截止信号。禁用 Pi 会话层的自动重放，避免叠加重试或重发半截回答；保留既有上下文整理流程。
- 修复 proxyFetch 在响应头到达后撤销调用方取消信号的问题，以及 SDK 流式超时被误判为正常结束的问题。

## 验证与边界

- 仓库测试 783 通过、38 跳过；后续请求适配修正针对测试 20 通过。
- 控制器完整测试 123 通过；包括持久化、运行时配置同步、旧模型默认值和不泄露密钥。
- 全工作区 typecheck、lint 通过。
- 浏览器使用 Windows Edge，对安装包内网页测试配置、新旧 API、能力说明、高级设置、按钮点击、诊断和不同窗口尺寸。
- `scripts/check-bridge-model-transport.mjs <打包运行时路径> --packaged` 加载包内实际 pi-ai 模块并连接本机模拟服务：503 后恢复、不重试、最多两次重试、401 不重试、流式中断不重试、收到响应头但正文卡住约 30 秒后失败。检查所有相关 OpenClaw bundle 已关闭 Pi 自动重试。
- `scripts/check-bridge-packaged.mjs <exe>` 使用隔离数据目录和随机端口验证真实 EXE 启动、图标点击、服务就绪和故障重试恢复。不会读取用户真实 API 或微信登录数据。
- 没有使用真实付费模型 API，也没有发送微信消息；参数格式与模拟接口验证不等于真实供应商或端到端微信验收。服务商公布的模型能力也不代表微信图片输入已接通。

机器结果位于 `node_modules/.cache/bridge-audit/model-options-{build,ui,packaged,controller-all,typecheck,lint}.log` 和 `model-options-transport.json`。

## 参数依据

- [DeepSeek 思考参数](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)
- [DeepSeek 模型列表](https://api-docs.deepseek.com/zh-cn/api/list-models/)
- [百炼地域与接口地址](https://help.aliyun.com/zh/model-studio/base-url)
- [硅基流动聊天模型列表](https://api-docs.siliconflow.cn/docs/api/models-get)

运行时适配由 `packages/slimclaw/patch-model-request.mjs` 在准备 runtime 时执行，源锚点变化会阻止构建。`runtime-stage.ts` 的缓存版本已更新，后续升级 OpenClaw/pi-ai 需重新执行上述包内验证。
