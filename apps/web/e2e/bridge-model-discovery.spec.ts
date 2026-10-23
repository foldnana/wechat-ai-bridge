import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";

// Works against a built web directory, including the actual packaged payload.
// All controller requests are intercepted; no real API key or account is used.
const root = path.resolve(
  process.env.BRIDGE_WEB_DIST ?? path.join(import.meta.dirname, "../dist"),
);
let server: http.Server;
let origin: string;
test.use({
  viewport: { width: 1264, height: 761 },
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
test.beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      const file = pathname.startsWith("/workspace")
        ? "index.html"
        : pathname.slice(1);
      const target = path.resolve(root, file);
      if (!target.startsWith(`${root}${path.sep}`)) {
        res.writeHead(403).end();
        return;
      }
      const types: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".woff2": "font/woff2",
      };
      res.setHeader(
        "Content-Type",
        types[path.extname(target)] ?? "application/octet-stream",
      );
      res.end(await readFile(target));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No server address");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function setup(page: Page, showGuide = false) {
  if (!showGuide) {
    await page.addInitScript(() =>
      localStorage.setItem("bridge-welcome-seen", "yes"),
    );
  }
  const saved: Array<Record<string, unknown>> = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/bridge/model") {
      saved.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          ok: true,
          saved: true,
          code: "saved",
          message: "测试通过，模型已保存。",
        },
      });
    }
    if (url.pathname.startsWith("/api/")) {
      const data: Record<string, unknown> = {
        "/api/internal/desktop/default-model": { modelId: null },
        "/api/v1/models": { models: [] },
        "/api/v1/bridge/behavior": { persona: "whale" },
        "/api/v1/bridge/preset": { preset: "" },
        "/api/v1/bridge/control": { paused: false },
        "/api/v1/channels": { channels: [] },
        "/api/v1/channels/live-status": {
          gatewayConnected: false,
          channels: [],
        },
        "/api/internal/desktop/ready": {
          ready: false,
          status: "starting",
          bootPhase: "starting",
        },
        "/api/v1/bridge/stickers": [],
        "/api/v1/bridge/contacts": [],
        "/api/v1/bridge/activity": { activities: [] },
        "/api/v1/bridge/behavior/status": { accounts: [] },
        "/api/v1/sessions": { sessions: [] },
        "/api/v1/bridge/models/saved": {
          connections: [],
          selectedProviderKey: null,
          currentModel: null,
        },
      };
      return route.fulfill({ json: data[url.pathname] ?? {} });
    }
    if (url.origin !== origin) return route.abort();
    return route.continue();
  });
  return saved;
}
const discoveryPath = "**/api/v1/bridge/models/discover";

test("experience: memory clear requires confirmation and retains other contact fields", async ({
  page,
}) => {
  await setup(page);
  let cleared = 0;
  let settings = {
    label: "测试联系人",
    nickname: "小林",
    memoryEnabled: true,
    memories: ["不喜欢剧透"],
  };
  await page.route("**/api/v1/bridge/contacts", (route) =>
    route.fulfill({
      json: [
        {
          id: "contact-one",
          label: "测试联系人",
          memoryEnabled: settings.memoryEnabled,
          memoryCount: settings.memories.length,
        },
      ],
    }),
  );
  await page.route("**/api/v1/bridge/contacts/contact-one", (route) =>
    route.fulfill({ json: { revision: "test", settings } }),
  );
  await page.route(
    "**/api/v1/bridge/contacts/contact-one/memories",
    (route) => {
      cleared++;
      settings = { ...settings, memories: [], memoryEnabled: false };
      return route.fulfill({ json: { revision: "cleared", settings } });
    },
  );
  await page.goto(`${origin}/workspace/behavior/contacts`);
  await page.getByRole("button", { name: "记住哪些事", exact: true }).click();
  await page
    .getByRole("button", { name: "清空已保存记忆", exact: true })
    .click();
  expect(cleared).toBe(0);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(cleared).toBe(0);
  await page
    .getByRole("button", { name: "清空已保存记忆", exact: true })
    .click();
  await page.getByRole("button", { name: "确定清空记忆", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: /允许使用这些记忆/ }),
  ).not.toBeChecked();
  await expect(page.getByLabel(/想让它记住的事/)).toHaveValue("");
  await page.getByRole("button", { name: "相处方式", exact: true }).click();
  await expect(
    page.getByLabel("希望 AI 怎么称呼对方", { exact: true }),
  ).toHaveValue("小林");
  expect(cleared).toBe(1);
});

test("experience: cancelling QR wait ignores a late confirmation", async ({
  page,
}) => {
  await setup(page);
  const statuses: Record<string, unknown> = {
    "/api/internal/desktop/default-model": {
      modelId: "deepseek/deepseek-chat",
    },
    "/api/v1/models": {
      models: [
        { id: "deepseek/deepseek-chat", name: "Chat", provider: "deepseek" },
      ],
    },
    "/api/internal/desktop/ready": {
      ready: true,
      status: "ready",
      bootPhase: "ready",
    },
    "/api/v1/channels/live-status": { gatewayConnected: true, channels: [] },
  };
  for (const [endpoint, json] of Object.entries(statuses))
    await page.route(`**${endpoint}`, (route) => route.fulfill({ json }));
  await page.route("**/api/v1/channels/wechat/qr-start", (route) =>
    route.fulfill({
      json: {
        sessionKey: "synthetic-qr",
        qrDataUrl: "https://weixin.qq.com/qr/synthetic-test",
      },
    }),
  );
  let release = () => {};
  let waiting = false;
  let completed = false;
  let connections = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/channels/wechat/qr-wait", async (route) => {
    waiting = true;
    await gate;
    await route
      .fulfill({ json: { connected: true, accountId: "synthetic" } })
      .catch(() => {});
    completed = true;
  });
  await page.route("**/api/v1/channels/wechat/connect", (route) => {
    connections++;
    return route.fulfill({ json: {} });
  });
  await page.goto(`${origin}/workspace/wechat`);
  await page
    .getByRole("button", { name: "获取微信授权二维码", exact: true })
    .click();
  await expect.poll(() => waiting).toBe(true);
  await page.getByRole("button", { name: "取消等待", exact: true }).click();
  release();
  await expect.poll(() => completed).toBe(true);
  await expect(
    page.getByRole("button", { name: "获取微信授权二维码", exact: true }),
  ).toBeEnabled();
  expect(connections).toBe(0);
});

test("experience: failed sticker upload retains form and blocks simultaneous deletion", async ({
  page,
}) => {
  await setup(page);
  let release = () => {};
  let uploading = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/bridge/stickers", async (route) => {
    if (route.request().method() === "POST") {
      uploading = true;
      await gate;
      return route.fulfill({
        status: 400,
        json: { error: "模拟图片保存失败" },
      });
    }
    return route.fulfill({
      json: [{ id: "old-sticker", label: "旧表情", tags: "开心" }],
    });
  });
  await page.goto(`${origin}/workspace/behavior?tab=stickers`);
  await page.getByLabel("选择表情图片", { exact: true }).setInputFiles({
    name: "test.png",
    mimeType: "image/png",
    buffer: Buffer.from("synthetic-file"),
  });
  await page.getByLabel("表情名称", { exact: true }).fill("新表情");
  await page.getByLabel("适用场景标签", { exact: true }).fill("赞同");
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await expect.poll(() => uploading).toBe(true);
  try {
    await expect(
      page.getByRole("button", { name: "移除 旧表情", exact: true }),
    ).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByRole("alert")).toContainText("模拟图片保存失败");
  await expect(page.getByLabel("表情名称", { exact: true })).toHaveValue(
    "新表情",
  );
  await expect(page.getByLabel("适用场景标签", { exact: true })).toHaveValue(
    "赞同",
  );
  await expect(
    page.getByRole("button", { name: "导入", exact: true }),
  ).toBeEnabled();
});

test("experience: contact pagination keeps the editor on the visible page", async ({
  page,
}) => {
  await setup(page);
  const contacts = Array.from({ length: 7 }, (_, i) => ({
    id: `contact-${i + 1}`,
    label: `联系人${i + 1}`,
    memoryEnabled: false,
    memoryCount: 0,
  }));
  await page.route("**/api/v1/bridge/contacts", (route) =>
    route.fulfill({ json: contacts }),
  );
  await page.route("**/api/v1/bridge/contacts/*", (route) =>
    route.fulfill({
      json: {
        revision: "test",
        settings: {
          label: contacts.find((c) => route.request().url().endsWith(c.id))
            ?.label,
          memories: [],
        },
      },
    }),
  );
  await page.goto(`${origin}/workspace/behavior/contacts`);
  await expect(
    page.getByRole("heading", { name: "联系人1的相处方式" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "联系人6的相处方式" }),
  ).toBeVisible();
  await expect(
    page.locator('.bridge-contact-item[aria-pressed="true"]'),
  ).toContainText("联系人6");
  await page.getByLabel("本地备注名", { exact: true }).fill("未保存的名字");
  await expect(
    page.getByRole("button", { name: "上一页", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "联系人1的相处方式" }),
  ).toBeVisible();
});

test("experience: sticker deletion blocks concurrent import until it completes", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/v1/bridge/stickers", (route) =>
    route.fulfill({
      json: [{ id: "test-sticker", label: "开心", tags: "开心" }],
    }),
  );
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/bridge/stickers/test-sticker", async (route) => {
    await gate;
    return route.fulfill({ json: [] });
  });
  await page.goto(`${origin}/workspace/behavior?tab=stickers`);
  await page.getByRole("button", { name: "移除 开心", exact: true }).click();
  try {
    await expect(
      page.getByLabel("选择表情图片", { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "导入", exact: true }),
    ).toBeDisabled();
  } finally {
    release();
  }
  await expect(
    page.getByRole("heading", { name: "导入表情图片" }),
  ).toBeVisible();
  await expect(page.getByLabel("选择表情图片", { exact: true })).toBeEnabled();
});

test("experience: sticker load failure can be retried without reloading the page", async ({
  page,
}) => {
  await setup(page);
  let available = false;
  await page.route("**/api/v1/bridge/stickers", (route) =>
    available
      ? route.fulfill({ json: [] })
      : route.fulfill({ status: 503, json: { error: "暂时不可用" } }),
  );
  await page.goto(`${origin}/workspace/behavior?tab=stickers`);
  await expect(page.getByText(/图库读取失败/)).toBeVisible({ timeout: 15000 });
  available = true;
  await page.getByRole("button", { name: "重新读取图库", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "导入表情图片" }),
  ).toBeVisible();
});

test("experience: preset save failure preserves edits and retry survives reload", async ({
  page,
}) => {
  await setup(page);
  let preset = "原有预设";
  let saves = 0;
  await page.route("**/api/v1/bridge/preset", (route) => {
    if (route.request().method() === "PUT") {
      if (++saves === 1)
        return route.fulfill({ status: 503, json: { error: "暂时失败" } });
      preset = route.request().postDataJSON().preset;
    }
    return route.fulfill({ json: { preset } });
  });
  await page.goto(`${origin}/workspace/preset`);
  await expect(page.getByLabel("AI 预设", { exact: true })).toHaveValue(
    "原有预设",
  );
  await page.getByLabel("AI 预设", { exact: true }).fill("新的用户自定义预设");
  await page.getByRole("button", { name: "保存预设", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("AI 预设", { exact: true })).toHaveValue(
    "新的用户自定义预设",
  );
  await page.getByRole("button", { name: "保存预设", exact: true }).click();
  await expect.poll(() => saves).toBe(2);
  await page.reload();
  await expect(page.getByLabel("AI 预设", { exact: true })).toHaveValue(
    "新的用户自定义预设",
  );
});
const listed = (models: string[]) => ({
  ok: true,
  code: "listed",
  models,
  incomplete: false,
  message: `已读取 ${models.length} 个模型。`,
});

test("advanced controls edit a saved model without reentering its API key", async ({
  page,
}) => {
  await setup(page);
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/v1/bridge/models/saved", (route) =>
    route.fulfill({
      json: {
        connections: [
          {
            id: "deepseek",
            label: "DeepSeek 官方 API",
            revision: "a".repeat(64),
            deepseekOfficial: true,
            modelOptions: {
              "deepseek-flash": {
                thinking: "off",
                timeoutSeconds: 60,
                retries: 0,
              },
            },
          },
        ],
        selectedProviderKey: "deepseek",
        currentModel: "deepseek/deepseek-flash",
      },
    }),
  );
  await page.route(discoveryPath, (route) =>
    route.fulfill({
      json: {
        ...listed(["deepseek-flash"]),
        details: [
          {
            id: "deepseek-flash",
            name: "DeepSeek Flash",
            context_window: 1048576,
            effort: { supported_levels: ["low", "high", "max"] },
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/bridge/model", (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({
      json: {
        ok: false,
        saved: false,
        code: "synthetic",
        message: "模拟测试，不调用真实 API。",
      },
    });
  });
  await page.goto(`${origin}/workspace/models`);
  await expect(page.getByText("DeepSeek Flash", { exact: true })).toBeVisible();
  await expect(page.getByLabel("思考模式", { exact: true })).not.toBeVisible();
  await page.locator(".bridge-model-advanced summary").click();
  await expect(page.getByLabel("思考模式", { exact: true })).toHaveValue("off");
  await page.getByLabel("思考模式", { exact: true }).selectOption("low");
  await page.getByLabel("请求时限", { exact: true }).selectOption("120");
  await page.getByLabel("网络重试", { exact: true }).selectOption("2");
  await page.screenshot({
    path: test.info().outputPath("model-options-preview.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "测试并保存设置", exact: true })
    .click();
  await expect(page.getByText("模拟测试，不调用真实 API。")).toBeVisible();
  expect(submitted).toMatchObject({
    model: "deepseek-flash",
    options: { thinking: "low", timeoutSeconds: 120, retries: 2 },
  });
  expect(submitted).not.toHaveProperty("apiKey");
  await page.screenshot({
    path: test.info().outputPath("model-advanced.png"),
    fullPage: true,
  });
});

test("provider presets populate endpoints and discard a previous provider's draft key", async ({
  page,
}) => {
  await setup(page);
  await page.route(discoveryPath, (route) =>
    route.fulfill({ json: listed(["deepseek-flash"]) }),
  );
  await page.goto(`${origin}/workspace/models`);
  await page.locator("#bridge-api-key").fill("synthetic-not-real");
  await page.locator("#bridge-provider").selectOption("bailian");
  await expect(page.locator("#bridge-api-key")).toHaveValue("");
  await expect(page.locator("#bridge-base-url")).toHaveValue(
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
  );
  await page.locator("#bridge-provider").selectOption("siliconflow");
  await expect(page.locator("#bridge-base-url")).toHaveValue(
    "https://api.siliconflow.cn/v1",
  );
  await page.locator(".bridge-model-advanced summary").click();
  await expect(page.getByLabel("思考模式", { exact: true })).toBeDisabled();
});

test("topbar icons and labels open controls and diagnosis retries without a model call", async ({
  page,
}) => {
  await setup(page);
  await page.addInitScript(() => {
    let retried = false;
    Object.assign(window, {
      nexuHost: {
        invoke: async (channel: string) => {
          if (channel === "bridge:retry") retried = true;
          return {
            checkedAt: new Date().toISOString(),
            service: retried ? "ready" : "unavailable",
            model: "missing",
            wechat: "disconnected",
            units: [],
            timings: [{ stage: "workspace:loaded", elapsedMs: 1200 }],
          };
        },
      },
    });
  });
  await page.goto(`${origin}/workspace/models`);
  await page
    .getByRole("button", { name: "配色", exact: true })
    .locator("svg")
    .click();
  await expect(page.getByRole("dialog")).toContainText("选择配色");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page
    .getByRole("button", { name: "配色", exact: true })
    .locator("span")
    .click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page
    .getByRole("button", { name: "诊断", exact: true })
    .locator("svg")
    .click();
  await expect(page.getByRole("dialog")).toContainText("需要恢复");
  await page.getByRole("button", { name: "重试启动服务", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("运行正常");
  await expect(
    page.getByRole("button", { name: "重试启动服务", exact: true }),
  ).toBeDisabled();
  await page.getByText("本次启动耗时", { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("1.20 秒");
  const note = await page
    .getByRole("dialog")
    .locator(".bridge-form-disclosure")
    .boundingBox();
  const actions = await page
    .getByRole("dialog")
    .locator(".bridge-diagnostic-actions")
    .boundingBox();
  expect(note && actions && note.y + note.height <= actions.y).toBe(true);
  await page.screenshot({ path: test.info().outputPath("diagnostics.png") });
});

for (const viewport of [
  { width: 1264, height: 761 },
  { width: 1024, height: 728 },
  { width: 850, height: 600 },
]) {
  test(`workspace pages remain usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await setup(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const [route, title] of [
      ["", "连接总览"],
      ["/models", "模型连接"],
      ["/wechat", "微信连接"],
      ["/preset", "回答风格"],
      ["/sessions", "对话管理"],
      ["/activity", "运行记录"],
      ["/behavior", "聊天行为"],
      ["/behavior?tab=stickers", "聊天行为"],
      ["/behavior?tab=proactive", "聊天行为"],
      ["/behavior/contacts", "联系人与记忆"],
    ]) {
      await page.goto(`${origin}/workspace${route}`);
      await expect(
        page.getByRole("heading", { name: title, exact: true, level: 1 }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    }
    await page.goto(`${origin}/workspace/behavior?tab=stickers`);
    await page.screenshot({
      path: test.info().outputPath("sticker-layout.png"),
      fullPage: true,
      animations: "disabled",
    });
  });
}

test("behavior save failure keeps the draft and permits retry", async ({
  page,
}) => {
  await setup(page);
  let attempts = 0;
  let config: Record<string, unknown> = { persona: "whale" };
  await page.route("**/api/v1/bridge/behavior", (route) => {
    if (route.request().method() === "PUT") {
      attempts++;
      if (attempts === 1)
        return route.fulfill({
          status: 500,
          json: { error: "模拟磁盘暂时不可用" },
        });
      config = route.request().postDataJSON();
    }
    return route.fulfill({ json: config });
  });
  await page.goto(`${origin}/workspace/behavior`);
  await page
    .getByRole("combobox", { name: "发送方式", exact: true })
    .selectOption("single");
  await page.getByRole("button", { name: "保存行为设置" }).click();
  await expect(page.getByRole("alert")).toContainText("模拟磁盘暂时不可用");
  await expect(
    page.getByRole("combobox", { name: "发送方式", exact: true }),
  ).toHaveValue("single");
  await page.getByRole("button", { name: "保存行为设置" }).click();
  await expect(
    page.getByText("已保存，下次回复或调度检查时生效。", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "发送方式", exact: true }),
  ).toHaveValue("single");
});

test("does not overwrite a pending preset load with the default template", async ({
  page,
}) => {
  await setup(page);
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/bridge/preset", async (route) => {
    await ready;
    return route.fulfill({ json: { preset: "已经保存的个人预设" } });
  });
  await page.goto(`${origin}/workspace/preset`);
  await expect(
    page.getByRole("button", { name: "编辑大肥鱼预设" }),
  ).toBeDisabled();
  release();
  await expect(page.getByLabel("AI 预设", { exact: true })).toHaveValue(
    "已经保存的个人预设",
  );
});

test("session reset is explicit and a server failure keeps the session available", async ({
  page,
}) => {
  await setup(page);
  let resets = 0;
  await page.route("**/api/v1/sessions?*", (route) =>
    route.fulfill({
      json: {
        sessions: [
          { id: "synthetic-session", title: "测试会话", channelType: "wechat" },
        ],
      },
    }),
  );
  await page.route("**/api/v1/bridge/sessions/*/new", (route) => {
    resets++;
    return route.fulfill({
      json: { ok: false, message: "服务暂不可用，请重试。" },
    });
  });
  await page.goto(`${origin}/workspace/sessions`);
  await page.getByRole("button", { name: "新开对话", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(resets).toBe(0);
  await page.getByRole("button", { name: "新开对话", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /新开/ }).click();
  await expect(
    page.getByText("服务暂不可用，请重试。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("测试会话", { exact: true })).toBeVisible();
  expect(resets).toBe(1);
});

test("keeps the saved-but-runtime-failed warning after switching to the saved API panel", async ({
  page,
}) => {
  await setup(page);
  let persisted = false;
  await page.route("**/api/v1/bridge/models/saved", (route) =>
    route.fulfill({
      json: {
        connections: persisted
          ? [{ id: "deepseek", label: "DeepSeek", revision: "a".repeat(64) }]
          : [],
        selectedProviderKey: persisted ? "deepseek" : null,
        currentModel: persisted ? "deepseek/deepseek-flash" : null,
      },
    }),
  );
  await page.route(discoveryPath, (route) =>
    route.fulfill({ json: listed(["deepseek-flash"]) }),
  );
  await page.route("**/api/v1/bridge/model", (route) => {
    persisted = true;
    return route.fulfill({
      json: {
        ok: false,
        saved: true,
        code: "runtime",
        message:
          "模型测试通过且配置已保存，但本地服务尚未就绪。请重启软件后继续，无需重新付费测试。",
      },
    });
  });
  await page.goto(`${origin}/workspace/models`);
  await page.locator("#bridge-api-key").fill("test-only-placeholder");
  await page.locator("#bridge-api-key").blur();
  await expect(page.locator("#bridge-model-name")).toHaveValue(
    "deepseek-flash",
  );
  await page
    .getByRole("button", { name: "测试并保存模型", exact: true })
    .click();
  await expect(page.locator("#bridge-saved-api")).toBeVisible();
  await expect(
    page.getByText(
      "模型测试通过且配置已保存，但本地服务尚未就绪。请重启软件后继续，无需重新付费测试。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText("模型准备好了。", { exact: true })).toHaveCount(
    0,
  );
});

test("explains that enabled stickers need imported images", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/v1/bridge/behavior", (route) =>
    route.fulfill({
      json: {
        persona: "whale",
        stickers: { enabled: true, probability: 25, cooldownMinutes: 10 },
      },
    }),
  );
  await page.route("**/api/v1/bridge/stickers", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/channels", (route) =>
    route.fulfill({ json: { channels: [] } }),
  );
  await page.goto(`${origin}/workspace/behavior?tab=stickers`);
  await expect(
    page.getByText("已开启表情，但图库为空；导入至少一张图片后才能发送。", {
      exact: true,
    }),
  ).toBeVisible();
});

test("saved API automatically lists models and switches without a key in the browser", async ({
  page,
}) => {
  await setup(page);
  let currentModel = "deepseek/deepseek-chat";
  const reads: Array<Record<string, unknown>> = [];
  const switches: Array<Record<string, unknown>> = [];
  const revision = "a".repeat(64);
  await page.route("**/api/v1/bridge/models/saved", (route) =>
    route.fulfill({
      json: {
        connections: [{ id: "deepseek", label: "DeepSeek 官方 API", revision }],
        selectedProviderKey: "deepseek",
        currentModel,
      },
    }),
  );
  await page.route("**/api/internal/desktop/default-model", (route) =>
    route.fulfill({ json: { modelId: currentModel } }),
  );
  await page.route(discoveryPath, (route) => {
    reads.push(route.request().postDataJSON());
    return route.fulfill({
      json: listed(["deepseek-flash", "deepseek-v4-pro"]),
    });
  });
  await page.route("**/api/v1/bridge/model", (route) => {
    const body = route.request().postDataJSON();
    switches.push(body);
    currentModel = `deepseek/${body.model}`;
    return route.fulfill({
      json: {
        ok: true,
        saved: true,
        code: "saved",
        modelId: currentModel,
        message: "测试通过，已切换模型，现有会话保留。后台正在重新连接。",
      },
    });
  });
  await page.goto(`${origin}/workspace/models`);
  await expect(page.locator("#bridge-saved-model")).toBeEnabled();
  await expect(page.locator("#bridge-saved-model")).toHaveValue(
    "deepseek-chat",
  );
  await expect(page.locator("#bridge-api-key")).toHaveCount(0);
  expect(reads).toEqual([{ savedProviderKey: "deepseek", revision }]);
  expect(switches).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: "测试并切换模型", exact: true }),
  ).toBeDisabled();
  await page.locator("#bridge-saved-model").selectOption("deepseek-flash");
  await page.screenshot({
    path: test.info().outputPath("saved-model-picker.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "测试并切换模型", exact: true })
    .click();
  await expect(
    page.getByText("测试通过，已切换模型", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".bridge-saved-model strong")).toHaveText(
    "deepseek/deepseek-flash",
  );
  expect(switches).toEqual([
    {
      savedProviderKey: "deepseek",
      revision,
      model: "deepseek-flash",
      options: { thinking: "auto", timeoutSeconds: 90, retries: 1 },
    },
  ]);
  await page.getByRole("button", { name: "更换密钥或配置其他 API" }).click();
  await expect(page.locator("#bridge-api-key")).toHaveValue("");
  await page.getByRole("button", { name: "返回已保存 API" }).click();
  await expect(page.locator("#bridge-saved-model")).toHaveValue(
    "deepseek-flash",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("saved API still allows manual selection when its list endpoint is unavailable", async ({
  page,
}) => {
  await setup(page);
  const revision = "b".repeat(64);
  await page.route("**/api/v1/bridge/models/saved", (route) =>
    route.fulfill({
      json: {
        connections: [
          { id: "custom-openai/bridge", label: "我的 API", revision },
        ],
        selectedProviderKey: "custom-openai/bridge",
        currentModel: "custom-openai/bridge/old",
      },
    }),
  );
  await page.route(discoveryPath, (route) =>
    route.fulfill({
      json: {
        ok: false,
        code: "unsupported",
        models: [],
        incomplete: false,
        message: "服务商未提供模型列表，请手动填写。",
      },
    }),
  );
  let tested: unknown;
  await page.route("**/api/v1/bridge/model", (route) => {
    tested = route.request().postDataJSON();
    return route.fulfill({
      json: {
        ok: false,
        saved: false,
        code: "model_or_endpoint",
        message: "该模型测试失败，原模型未改变。",
      },
    });
  });
  await page.goto(`${origin}/workspace/models`);
  await expect(
    page.getByText("服务商未提供模型列表", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "手动填写", exact: true }).click();
  await page.locator("#bridge-saved-model").fill("custom/model");
  await page
    .getByRole("button", { name: "测试并切换模型", exact: true })
    .click();
  await expect(page.getByText("该模型测试失败，原模型未改变。")).toBeVisible();
  expect(tested).toEqual({
    savedProviderKey: "custom-openai/bridge",
    revision,
    model: "custom/model",
    options: { thinking: "auto", timeoutSeconds: 90, retries: 1 },
  });
  await expect(page.locator("#bridge-api-key")).toHaveCount(0);
  await page.getByRole("button", { name: "从列表选择", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "测试并切换模型", exact: true }),
  ).toBeDisabled();
});

test("automatically discovers, selects, and only saves after an explicit chat test", async ({
  page,
}) => {
  const saved = await setup(page);
  const reads: unknown[] = [];
  await page.route(discoveryPath, (route) => {
    reads.push(route.request().postDataJSON());
    return route.fulfill({
      json: listed(["deepseek-chat", "deepseek-reasoner"]),
    });
  });
  await page.goto(`${origin}/workspace/models`);
  await page
    .getByLabel("API Key", { exact: false })
    .first()
    .fill("fake-key-one");
  await page.getByLabel("API Key", { exact: false }).first().press("Tab");
  await expect(page.locator("#bridge-model-name")).toHaveValue("deepseek-chat");
  await expect(page.locator("#bridge-model-name option")).toHaveCount(3);
  expect(reads).toEqual([{ provider: "deepseek", apiKey: "fake-key-one" }]);
  expect(saved).toHaveLength(0);
  await page.locator("#bridge-model-name").selectOption("deepseek-reasoner");
  await page
    .getByRole("button", { name: "测试并保存模型", exact: true })
    .click();
  await expect(page.getByText("模型准备好了。", { exact: true })).toBeVisible();
  expect(saved[0]).toMatchObject({
    model: "deepseek-reasoner",
    apiKey: "fake-key-one",
  });
});

test("replacing credentials invalidates an in-flight list and ignores its late result", async ({
  page,
}) => {
  await setup(page);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = () => {};
  const oldStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let finishOld = () => {};
  const oldFinished = new Promise<void>((resolve) => {
    finishOld = resolve;
  });
  await page.route(discoveryPath, async (route) => {
    if (route.request().postDataJSON().apiKey === "fake-old-key") {
      started();
      await gate;
      await route.fulfill({ json: listed(["old-model"]) }).catch(() => {});
      finishOld();
    } else await route.fulfill({ json: listed(["new-model"]) });
  });
  try {
    await page.goto(`${origin}/workspace/models`);
    await page.locator("#bridge-api-key").fill("fake-old-key");
    await page.locator("#bridge-api-key").press("Tab");
    await oldStarted;
    await page.locator("#bridge-api-key").fill("fake-new-key");
    await page.locator("#bridge-api-key").press("Tab");
    await expect(page.locator("#bridge-model-name")).toHaveValue("new-model");
    release();
    await oldFinished;
    await expect(page.locator("#bridge-model-name option")).toHaveText([
      "填写密钥后自动读取",
      "new-model",
    ]);
    await page.getByRole("button", { name: "刷新模型列表" }).click();
    await expect(page.locator("#bridge-model-name")).toHaveValue("new-model");
  } finally {
    release();
  }
});

test("offers manual input after unsupported discovery and uses the typed model", async ({
  page,
}) => {
  const saved = await setup(page);
  await page.route(discoveryPath, (route) =>
    route.fulfill({
      json: {
        ok: false,
        code: "unsupported",
        models: [],
        incomplete: false,
        message: "服务商未提供模型列表，请切换为手动填写模型 ID。",
      },
    }),
  );
  await page.goto(`${origin}/workspace/models`);
  await page.locator("#bridge-api-key").fill("fake-key");
  await page.locator("#bridge-api-key").press("Tab");
  await expect(
    page.getByText("服务商未提供模型列表", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "测试并保存模型" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "手动填写", exact: true }).click();
  await page.locator("#bridge-model-name").fill("private-chat-model");
  await page.getByRole("button", { name: "测试并保存模型" }).click();
  await expect(page.getByText("模型准备好了。", { exact: true })).toBeVisible();
  expect(saved[0]?.model).toBe("private-chat-model");
});

test("changing provider clears the draft key and changing endpoint clears the list", async ({
  page,
}) => {
  await setup(page);
  const reads: Array<Record<string, unknown>> = [];
  await page.route(discoveryPath, (route) => {
    reads.push(route.request().postDataJSON());
    return route.fulfill({ json: listed(["chat-one", "chat-two"]) });
  });
  await page.goto(`${origin}/workspace/models`);
  await page.locator("#bridge-api-key").fill("fake-deepseek-key");
  await page.locator("#bridge-api-key").press("Tab");
  await expect(page.locator("#bridge-model-name")).toHaveValue("chat-one");
  await page.locator("#bridge-provider").selectOption("custom-openai");
  await expect(page.locator("#bridge-api-key")).toHaveValue("");
  await expect(page.locator("#bridge-model-name")).toBeDisabled();
  await page.locator("#bridge-base-url").fill("https://example.invalid/v1");
  await page.locator("#bridge-api-key").fill("fake-custom-key");
  await page.locator("#bridge-api-key").press("Tab");
  await expect(page.locator("#bridge-model-name")).toHaveValue("chat-one");
  expect(reads[1]).toEqual({
    provider: "custom-openai",
    apiKey: "fake-custom-key",
    baseUrl: "https://example.invalid/v1",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("custom-model-list.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.locator("#bridge-base-url").fill("https://changed.invalid/v1");
  await expect(page.locator("#bridge-model-name")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "测试并保存模型" }),
  ).toBeDisabled();
});

test("manual entry cancels a slow discovery without blocking model testing", async ({
  page,
}) => {
  const saved = await setup(page);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(discoveryPath, async (route) => {
    await gate;
    await route.fulfill({ json: listed(["late-model"]) }).catch(() => {});
  });
  try {
    await page.goto(`${origin}/workspace/models`);
    await page.locator("#bridge-api-key").fill("fake-key");
    await page.locator("#bridge-api-key").press("Tab");
    await expect(
      page.getByRole("button", { name: "正在读取模型…" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "手动填写", exact: true }).click();
    await page.locator("#bridge-model-name").fill("manual-chat");
    await page.getByRole("button", { name: "测试并保存模型" }).click();
    await expect(
      page.getByText("模型准备好了。", { exact: true }),
    ).toBeVisible();
    expect(saved[0]?.model).toBe("manual-chat");
  } finally {
    release();
  }
});

test("welcome guide completes three steps without configuring or sending anything", async ({
  page,
}, testInfo) => {
  const saved = await setup(page, true);
  const mutations: string[] = [];
  page.on("request", (request) => {
    // Theme preference synchronization already runs at application startup.
    if (
      new URL(request.url()).pathname.startsWith("/api/v1/") &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())
    )
      mutations.push(request.url());
  });
  await page.goto(`${origin}/workspace`);
  const guide = page.getByRole("dialog");
  await expect(
    guide.getByRole("heading", { name: "先把模型接上" }),
  ).toBeVisible();
  await expect(guide.getByRole("button", { name: "上一步" })).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("welcome-step1.png"),
    animations: "disabled",
  });
  // Hit the icon at the center, not just the button's edge.
  const icon = await guide
    .getByRole("button", { name: "下一步" })
    .locator("svg")
    .boundingBox();
  if (!icon) throw new Error("Guide next icon is missing");
  await page.mouse.click(icon.x + icon.width / 2, icon.y + icon.height / 2);
  await expect(guide.getByText("电脑要开机", { exact: false })).toBeVisible();
  await guide.getByRole("button", { name: "上一步" }).click();
  await expect(
    guide.getByRole("heading", { name: "先把模型接上" }),
  ).toBeVisible();
  await guide.getByRole("button", { name: "下一步" }).click();
  await guide.getByRole("button", { name: "下一步" }).click();
  await expect(
    guide.getByRole("heading", { name: "先聊起来，其他慢慢调" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("welcome-step3.png"),
    animations: "disabled",
  });
  await guide.getByRole("button", { name: "开始配置 API" }).click();
  await expect(page).toHaveURL(`${origin}/workspace/models`);
  await expect(guide).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "模型连接", exact: true }),
  ).toBeVisible();
  await expect(guide).toHaveCount(0);
  expect(saved).toHaveLength(0);
  expect(mutations).toHaveLength(0);
});

test("welcome guide can be skipped, reopened from help and dismissed with Escape", async ({
  page,
}) => {
  await setup(page, true);
  await page.goto(`${origin}/workspace`);
  await page.getByRole("button", { name: "跳过指引" }).click();
  await page.reload();
  await expect(page.getByRole("link", { name: "模型连接" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "使用说明", exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("button", { name: "重新查看新手指引" }).click();
  await expect(
    page.getByRole("heading", { name: "先把模型接上" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "模型连接" }).click();
  await expect(page).toHaveURL(`${origin}/workspace/models`);
});

test("welcome guide remains usable on a narrow screen and without local storage", async ({
  page,
}, testInfo) => {
  await setup(page, true);
  await page.setViewportSize({ width: 390, height: 680 });
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("storage unavailable");
    };
    Storage.prototype.setItem = () => {
      throw new Error("storage unavailable");
    };
  });
  await page.goto(`${origin}/workspace`);
  await expect(
    page.getByRole("heading", { name: "先把模型接上" }),
  ).toBeVisible();
  const button = page.getByRole("button", { name: "下一步" });
  await expect(button).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("welcome-narrow.png"),
    animations: "disabled",
  });
  await button.click();
  await expect(
    page.getByRole("heading", { name: "拿起手机，扫码连接" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
