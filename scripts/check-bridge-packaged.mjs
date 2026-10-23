import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { _electron as electron, expect } from "@playwright/test";

const executablePath = resolve(process.argv[2]);
const baseline = process.argv.includes("--baseline");
const root = resolve(
  "node_modules/.cache/bridge-audit",
  `packaged-${baseline ? "before" : "after"}-${Date.now()}`,
);
await mkdir(root, { recursive: true });
async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
const controllerPort = await freePort();
const webPort = await freePort();
const gatewayPort = await freePort();
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name, value]) =>
      value !== undefined &&
      !/^(NEXU_|OPENCLAW_|ELECTRON_)/.test(name) &&
      !/API_KEY|TOKEN|SECRET|PASSWORD/.test(name),
  ),
);
Object.assign(env, {
  NEXU_HOME: join(root, "config"),
  NEXU_DESKTOP_USER_DATA_ROOT: join(root, "user-data"),
  NEXU_CONTROLLER_PORT: String(controllerPort),
  NEXU_WEB_PORT: String(webPort),
  NEXU_OPENCLAW_BASE_URL: `http://127.0.0.1:${gatewayPort}`,
  NEXU_DESKTOP_AUTO_UPDATE_ENABLED: "false",
  CI: "1",
});
const started = performance.now();
const app = await electron.launch({ executablePath, env, timeout: 45_000 });
const childProcess = app.process();
const processId = childProcess.pid;
const result = {
  root,
  executablePath,
  baseline,
  launchedMs: Math.round(performance.now() - started),
};
async function guest(code) {
  return app.evaluate(async ({ webContents }, source) => {
    const contents = webContents
      .getAllWebContents()
      .find(
        (item) =>
          item.getType() === "webview" && item.getURL().includes("/workspace"),
      );
    if (!contents) throw new Error("Workspace not loaded");
    return contents.executeJavaScript(source);
  }, code);
}
async function ready() {
  try {
    return (
      (
        await (
          await fetch(
            `http://127.0.0.1:${controllerPort}/api/internal/desktop/ready`,
            { signal: AbortSignal.timeout(1000) },
          )
        ).json()
      ).ready === true
    );
  } catch {
    return false;
  }
}
try {
  const window = await app.firstWindow();
  await expect
    .poll(
      () =>
        guest(
          "Boolean(document.querySelector('.bridge-theme-trigger svg'))",
        ).catch(() => false),
      { timeout: 45_000 },
    )
    .toBe(true);
  result.workspaceObservedMs = Math.round(performance.now() - started);
  result.dragOverlays = await window.locator(".window-drag-bar").count();
  async function clickGuest(selector) {
    const bounds = await guest(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
    );
    const frame = await window.locator("webview").first().boundingBox();
    // Send mouse input through the actual parent window so drag overlays cannot be bypassed.
    await window.mouse.click(frame.x + bounds.x, frame.y + bounds.y);
  }
  await clickGuest(".bridge-theme-trigger svg");
  result.iconClickOpened = await guest(
    "Boolean(document.querySelector('[role=dialog]'))",
  );
  if (!baseline) {
    await expect
      .poll(() => guest("Boolean(document.querySelector('[role=dialog]'))"))
      .toBe(true);
    result.iconClickOpened = true;
    await guest(
      "Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='完成').click()",
    );
    await clickGuest(".bridge-theme-trigger span");
    await expect
      .poll(() => guest("Boolean(document.querySelector('[role=dialog]'))"))
      .toBe(true);
    result.labelClickOpened = true;
    await guest(
      "Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='完成').click()",
    );
  }
  await expect.poll(ready, { timeout: 90_000, intervals: [500] }).toBe(true);
  result.backendObservedMs = Math.round(performance.now() - started);
  if (!baseline) {
    result.diagnosis = await guest(
      "window.nexuHost.invoke('bridge:diagnose', undefined)",
    );
    if (result.diagnosis.model !== "missing")
      throw new Error("Isolated profile unexpectedly has a configured model");
    // Stop only this test instance's controller, then recover through the user-facing button.
    await guest(
      "window.nexuHost.invoke('runtime:stop-unit', {id:'controller'})",
    );
    await guest(
      "Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='诊断').click()",
    );
    await expect
      .poll(
        () =>
          guest(
            "document.querySelector('[role=dialog]')?.textContent.includes('需要恢复')",
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    await guest(
      "Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='重试启动服务').click()",
    );
    await expect.poll(ready, { timeout: 90_000, intervals: [500] }).toBe(true);
    await expect
      .poll(
        () =>
          guest(
            "document.querySelector('[role=dialog]')?.textContent.includes('运行正常')",
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    result.recoveryPassed = true;
    await guest(
      "document.querySelector('.bridge-startup-timings').open = true",
    );
  }
  await window.screenshot({ path: join(root, "desktop.png") });
  await writeFile(join(root, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  try {
    await Promise.race([
      guest(
        "window.nexuHost.invoke('app:quit', {decision:'quit-completely'})",
      ).catch(() => {}),
      new Promise((done) => setTimeout(done, 10_000)),
    ]);
    await Promise.race([
      app.close(),
      new Promise((done) => setTimeout(done, 10_000)),
    ]);
  } finally {
    if (childProcess.exitCode === null)
      spawnSync("taskkill", ["/PID", String(processId), "/T", "/F"], {
        windowsHide: true,
      });
  }
}
