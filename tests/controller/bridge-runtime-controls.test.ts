import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "#controller/app/container";
import { createApp } from "#controller/app/create-app";
import { sendMessage } from "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/api/api";
import { beginBridgeActivity } from "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/storage/bridge-activity";
import { bridgeRepliesPaused } from "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/storage/bridge-control";

vi.mock(
  "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/util/logger",
  () => ({ logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() } }),
);
vi.mock(
  "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/auth/accounts",
  () => ({ loadConfigRouteTag: () => undefined }),
);
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { force: true, recursive: true })),
  );
});
async function root() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bridge-status-"));
  directories.push(dir);
  vi.stubEnv("OPENCLAW_STATE_DIR", dir);
  return dir;
}

describe("local reply controls and truthful delivery evidence", () => {
  it("persists pause/resume for the runtime, including a conservative corrupt-file fallback", async () => {
    const dir = await root();
    const app = createApp({
      env: { webUrl: "http://localhost:5173", openclawStateDir: dir },
    } as ControllerContainer);
    expect(bridgeRepliesPaused()).toBe(false);
    for (const paused of [true, false]) {
      await app.request("/api/v1/bridge/control", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused }),
      });
      expect(bridgeRepliesPaused()).toBe(paused);
    }
    await writeFile(path.join(dir, "bridge-control.json"), "{bad");
    expect(bridgeRepliesPaused()).toBe(true);
    expect(await (await app.request("/api/v1/bridge/control")).json()).toEqual({
      paused: true,
    });
  });
  it("tracks only stages, retaining the last success when a later reply fails", async () => {
    const dir = await root();
    const account = randomUUID();
    const file = path.join(
      dir,
      "bridge-activity",
      `${createHash("sha256").update(account).digest("hex")}.json`,
    );
    const first = beginBridgeActivity(account);
    let state = JSON.parse(await readFile(file, "utf8"));
    expect(state.generatedAt).toBeNull();
    expect(state.sentAt).toBeNull();
    first.generated();
    first.sent();
    state = JSON.parse(await readFile(file, "utf8"));
    const success = state.sentAt;
    const second = beginBridgeActivity(account);
    second.generated();
    second.failed("send");
    state = JSON.parse(await readFile(file, "utf8"));
    expect(state).toMatchObject({
      sentAt: null,
      lastSuccessfulReplyAt: success,
      error: "send",
    });
    expect(JSON.stringify(state)).not.toContain(account);
    expect(Object.keys(state).sort()).toEqual(
      [
        "runId",
        "receivedAt",
        "generatedAt",
        "sentAt",
        "lastSuccessfulReplyAt",
        "error",
      ].sort(),
    );
  });
  it("does not overwrite a newer message with a late completion of an earlier one", async () => {
    const dir = await root();
    const account = randomUUID();
    const file = path.join(
      dir,
      "bridge-activity",
      `${createHash("sha256").update(account).digest("hex")}.json`,
    );
    const first = beginBridgeActivity(account);
    beginBridgeActivity(account);
    const latest = JSON.parse(await readFile(file, "utf8"));
    first.generated();
    first.sent();
    expect(JSON.parse(await readFile(file, "utf8")).runId).toBe(latest.runId);
    expect(JSON.parse(await readFile(file, "utf8")).sentAt).toBeNull();
  });
  it.each([{ ret: -14 }, { ret: 0, errcode: -1 }, {}])(
    "does not treat HTTP 200 with a rejected send as success: %j",
    async (response) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json(response)),
      );
      await expect(
        sendMessage({
          baseUrl: "https://wechat.invalid",
          body: { msg: {} } as never,
        }),
      ).rejects.toThrow("WeChat rejected");
    },
  );
  it("accepts the explicit successful send result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ ret: 0 })),
    );
    await expect(
      sendMessage({
        baseUrl: "https://wechat.invalid",
        body: { msg: {} } as never,
      }),
    ).resolves.toBeUndefined();
  });
  it("starts a conversation through the live runtime instead of truncating a transcript", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const resetSession = vi.fn();
    const app = createApp({
      env: { webUrl: "http://localhost:5173", openclawStateDir: await root() },
      sessionService: {
        getSession: vi.fn().mockResolvedValue({
          sessionKey: "agent:bot:openclaw-weixin:direct:test",
          channelType: "wechat",
        }),
        resetSession,
      },
      wsClient: { request },
    } as unknown as ControllerContainer);
    const result = await app.request("/api/v1/bridge/sessions/test-id/new", {
      method: "POST",
    });
    expect(await result.json()).toMatchObject({ ok: true });
    expect(request).toHaveBeenCalledWith(
      "sessions.reset",
      { key: "agent:bot:openclaw-weixin:direct:test", reason: "new" },
      { timeoutMs: 30_000 },
    );
    expect(resetSession).not.toHaveBeenCalled();
  });
});
