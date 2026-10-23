// Isolated packaged-app persistence checks. No real model calls or WeChat messages.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { _electron as electron, expect } from "@playwright/test";

if (!process.argv[2]) throw new Error("Pass the packaged EXE path");
const executablePath = resolve(process.argv[2]);
const root = resolve(
  "node_modules/.cache/bridge-audit",
  `lifecycle-${Date.now()}`,
);
await mkdir(root, { recursive: true });
async function port() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  await new Promise((done) => server.close(done));
  return address.port;
}
const controllerPort = await port();
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) =>
      value !== undefined &&
      !/^(NEXU_|OPENCLAW_|ELECTRON_)/.test(key) &&
      !/API_KEY|TOKEN|SECRET|PASSWORD/.test(key),
  ),
);
Object.assign(env, {
  NEXU_HOME: join(root, "config"),
  NEXU_DESKTOP_USER_DATA_ROOT: join(root, "user-data"),
  NEXU_CONTROLLER_PORT: String(controllerPort),
  NEXU_WEB_PORT: String(await port()),
  NEXU_OPENCLAW_BASE_URL: `http://127.0.0.1:${await port()}`,
  NEXU_DESKTOP_AUTO_UPDATE_ENABLED: "false",
  CI: "1",
});
async function request(
  endpoint,
  body,
  method = body === undefined ? "GET" : "PUT",
) {
  const response = await fetch(
    `http://127.0.0.1:${controllerPort}${endpoint}`,
    {
      method,
      signal: AbortSignal.timeout(45000),
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    },
  );
  assert.equal(response.status, 200, `HTTP failure for ${endpoint}`);
  return response.json();
}
let app;
async function start() {
  app = await electron.launch({ executablePath, env, timeout: 45000 });
  await expect
    .poll(
      async () => {
        try {
          return (await request("/api/internal/desktop/ready")).ready;
        } catch {
          return false;
        }
      },
      { timeout: 90000, intervals: [500] },
    )
    .toBe(true);
}
const timeout = (ms) =>
  new Promise((done) => {
    const timer = setTimeout(done, ms);
    timer.unref();
  });
async function stop() {
  if (!app) return;
  const child = app.process();
  try {
    await Promise.race([
      app
        .evaluate(async ({ webContents }) => {
          const guest = webContents
            .getAllWebContents()
            .find((c) => c.getType() === "webview");
          if (guest)
            await guest.executeJavaScript(
              "window.nexuHost.invoke('app:quit', {decision:'quit-completely'})",
            );
        })
        .catch(() => {}),
      timeout(10000),
    ]);
    await Promise.race([app.close().catch(() => {}), timeout(10000)]);
  } finally {
    if (child.exitCode === null)
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
      });
    app = undefined;
  }
}
const preset = "Synthetic lifecycle preset. Not a real conversation.";
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
try {
  await start();
  assert.deepEqual(
    (await request("/api/v1/model-providers/config")).config.providers,
    {},
  );
  await request("/api/v1/bridge/control", { paused: true });
  await request("/api/v1/bridge/preset", { preset });
  const behavior = await request("/api/v1/bridge/behavior");
  behavior.delivery.mode = "single";
  await request("/api/v1/bridge/behavior", behavior);
  const stickers = await request(
    "/api/v1/bridge/stickers",
    { label: "Test image", tags: "synthetic", data: image },
    "POST",
  );
  assert.equal(stickers.length, 1);
  const saved = await request("/api/v1/model-providers/config", {
    mode: "merge",
    providers: {
      "custom-openai/lifecycle": {
        enabled: true,
        auth: "api-key",
        api: "openai-completions",
        apiKey: "synthetic-lifecycle-key",
        baseUrl: "https://lifecycle.example.invalid/v1",
        models: [{ id: "synthetic-model", name: "Synthetic" }],
      },
    },
  });
  assert.equal(
    saved.config.providers["custom-openai/lifecycle"].apiKey,
    "__BRIDGE_SAVED_API_KEY__",
  );
  await stop();
  await start();
  assert.equal((await request("/api/v1/bridge/control")).paused, true);
  assert.equal((await request("/api/v1/bridge/preset")).preset, preset);
  assert.equal(
    (await request("/api/v1/bridge/behavior")).delivery.mode,
    "single",
  );
  assert.equal(
    (await request("/api/v1/model-providers/config")).config.providers[
      "custom-openai/lifecycle"
    ].apiKey,
    "__BRIDGE_SAVED_API_KEY__",
  );
  assert.equal(
    (await request("/api/internal/desktop/default-model")).modelId,
    "custom-openai/lifecycle/synthetic-model",
  );
  assert.equal(
    (await request("/api/v1/bridge/stickers"))[0].id,
    stickers[0].id,
  );
  const picture = await fetch(
    `http://127.0.0.1:${controllerPort}/api/v1/bridge/stickers/${stickers[0].id}/image`,
  );
  assert.equal(picture.status, 200);
  assert.equal(picture.headers.get("content-type"), "image/png");
  assert.equal(
    (
      await request(
        `/api/v1/bridge/stickers/${stickers[0].id}`,
        undefined,
        "DELETE",
      )
    ).length,
    0,
  );
  await request("/api/v1/bridge/control", { paused: false });
  assert.equal((await request("/api/v1/bridge/control")).paused, false);
  const result = {
    executablePath,
    root,
    passed: true,
    syntheticOnly: true,
    launches: 2,
    checks: [
      "clean profile",
      "restart keeps API/model, preset, pacing and pause",
      "sticker upload, persistence, image retrieval and deletion",
      "resume replies",
    ],
    realWechat: false,
    paidApi: false,
  };
  await writeFile(join(root, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await stop();
}
