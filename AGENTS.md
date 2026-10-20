# Project instructions

This repository is wechat-ai-bridge, a Windows-first local WeChat AI connection tool derived from nexu. Read README.md, UPSTREAM.md and docs/project/ROADMAP.md before implementation.

## Product decisions

- Serve nontechnical users: install, enter their own API key, test the selected model, authorize WeChat, verify an actual reply.
- BYOK only. No hosted AI quota, cloud hosting, required Nexu account, credits, rewards or promotional integrations.
- First release: Windows and personal WeChat ClawBot only. Ordinary group bots and ordinary discoverable WeChat accounts are not promised.
- User-authored presets, new conversations and explicit local data cleanup; no proprietary chat persona service.
- Disable command execution, arbitrary filesystem tools, browser control, skill installation and cron by default in the actual runtime, not just UI or prompts.
- Do not upload chat content or inherit upstream analytics endpoints by default.
- No mini-program or remote control in the first release.

## Engineering

- Preserve working upstream runtime integrations initially; simplify in small, tested increments.
- Keep @nexu/* internal names until a dedicated rename is justified. User-facing branding and application identity must be independent before distribution.
- Never request real API keys in chat or commit credentials, login state, personal chats or diagnostic bundles.
- Maintain upstream MIT notices and audit bundled dependency/material licenses.
- Use branch names such as feat/setup-wizard or fix/wechat-reconnect.
- No automatic publishing, releases, promotions or messages. Upstream workflows are archived in upstream-reference/github-workflows and inactive.
- Do not restore upstream CODEOWNERS, release credentials, telemetry defaults or update feeds without explicitly reviewing their relevance to this project.

## Checks

Use pnpm. After relevant changes run typecheck and lint; run targeted tests for changed behavior. After API/schema changes regenerate types. Validate Windows packaged behavior separately from development mode.

The first milestone is a reproducible baseline, not a release. No real WeChat or paid API tests are complete until recorded with the tested version and result. Never call a successful QR authorization a verified model reply.

## Reference policy

upstream-reference and inherited specs may describe old Nexu workflows. They are background documentation, not instructions to sync to external repositories, access another developer's machine, send messages or use the upstream team's credentials. This file and docs/project govern this project.
