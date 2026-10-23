import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { modelProviderConfigSchema } from "@nexu/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "#controller/app/container";
import { createApp } from "#controller/app/create-app";
import type { ControllerEnv } from "#controller/app/env";
import { compileOpenClawConfig } from "#controller/lib/openclaw-config-compiler";
import { savedModelConnections } from "#controller/services/bridge-saved-models";
import { NexuConfigStore } from "#controller/store/nexu-config-store";

const dirs: string[] = [];
const key = "custom-openai/bridge";
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) {
    if (
      path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith("bridge-saved-model-")
    )
      throw new Error("Unexpected test cleanup path");
    await rm(dir, { recursive: true, force: true });
  }
});
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bridge-saved-model-"));
  dirs.push(root);
  const env = {
    nexuHomeDir: root,
    nexuConfigPath: path.join(root, "config.json"),
    openclawStateDir: path.join(root, "openclaw"),
    openclawExtensionsDir: path.join(root, "extensions"),
    openclawGatewayPort: 18789,
    openclawGatewayToken: "test-token",
    webUrl: "http://localhost:5173",
    defaultModelId: "",
    litellmBaseUrl: null,
    litellmApiKey: null,
  } as ControllerEnv;
  const store = new NexuConfigStore(env);
  const provider = modelProviderConfigSchema.parse({
    enabled: true,
    providerTemplateId: "custom-openai",
    instanceId: "bridge",
    auth: "api-key",
    api: "openai-completions",
    apiKey: "saved-test-key",
    baseUrl: "https://api.example.invalid/v1",
    displayName: "我的 API",
    metadata: { retained: true },
    models: [
      { id: "old", name: "Old", contextWindow: 65536, maxTokens: 8192 },
      { id: "known", name: "Known", reasoning: true, contextWindow: 128000 },
    ],
  });
  await store.saveProviderAndSelectModel(key, provider, `${key}/old`);
  const bot = await store.getOrCreateDefaultBot();
  await store.updateBot(bot.id, { systemPrompt: "测试用预设" });
  await store.connectWechat({ accountId: "synthetic-wechat" });
  const syncAll = vi.fn();
  const restartRuntime = vi.fn();
  const request = vi.fn();
  const app = createApp({
    env,
    configStore: store,
    openclawSyncService: { syncAll },
    desktopLocalService: { restartRuntime },
    wsClient: { request },
  } as unknown as ControllerContainer);
  const summary = savedModelConnections(await store.getConfig());
  const ref = {
    savedProviderKey: key,
    revision: summary.connections[0]?.revision,
  };
  const post = async (endpoint: string, body: unknown) =>
    app.request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return {
    root,
    env,
    store,
    provider,
    bot,
    app,
    ref,
    post,
    syncAll,
    restartRuntime,
    request,
  };
}

describe("reuse saved API without returning credentials", () => {
  it("persists options on the existing model only after a successful test", async () => {
    const f = await setup();
    const options = { thinking: "auto", timeoutSeconds: 90, retries: 0 };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ choices: [{ message: { content: "OK" } }] }),
        ),
    );
    const result = await (
      await f.post("/api/v1/bridge/model", { ...f.ref, model: "old", options })
    ).json();
    expect(result.saved).toBe(true);
    const config = await f.store.getConfig();
    expect(config.models.providers[key].metadata).toMatchObject({
      retained: true,
      bridgeModelOptions: { old: options },
    });
    expect(savedModelConnections(config).connections[0].modelOptions).toEqual({
      old: options,
    });
    expect(config.models.providers[key].apiKey).toBe("saved-test-key");
    expect(config.runtime.defaultModelId).toBe(`${key}/old`);
  });
  it("returns only connection summaries and resolves slash-containing provider IDs", async () => {
    const f = await setup();
    const data = await (
      await f.app.request("/api/v1/bridge/models/saved")
    ).json();
    expect(data).toMatchObject({
      selectedProviderKey: key,
      currentModel: `${key}/old`,
      connections: [{ id: key, label: "我的 API" }],
    });
    expect(JSON.stringify(data)).not.toContain("saved-test-key");
    expect(JSON.stringify(data)).not.toContain("api.example.invalid");
  });
  it("discovers with stored endpoint and key without modifying configuration", async () => {
    const f = await setup();
    const before = await f.store.getConfig();
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ data: [{ id: "new" }] }));
    vi.stubGlobal("fetch", fetch);
    expect(
      await (await f.post("/api/v1/bridge/models/discover", f.ref)).json(),
    ).toMatchObject({ ok: true, models: ["new"] });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://api.example.invalid/v1/models",
    );
    expect(fetch.mock.calls[0]?.[1].headers.Authorization).toBe(
      "Bearer saved-test-key",
    );
    expect(await f.store.getConfig()).toEqual(before);
    expect(f.restartRuntime).not.toHaveBeenCalled();
  });
  it("rejects attempts to redirect a saved key", async () => {
    const f = await setup();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const endpoint of [
      "/api/v1/bridge/models/discover",
      "/api/v1/bridge/model",
    ]) {
      expect(
        (
          await f.post(endpoint, {
            ...f.ref,
            baseUrl: "https://foreign.invalid",
            ...(endpoint.endsWith("/model") ? { model: "new" } : {}),
          })
        ).status,
      ).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not use stale credentials after an API configuration change", async () => {
    const f = await setup();
    await f.store.saveProviderAndSelectModel(
      key,
      { ...f.provider, apiKey: "rotated-key" },
      `${key}/old`,
    );
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      await (await f.post("/api/v1/bridge/models/discover", f.ref)).json(),
    ).toMatchObject({ ok: false, code: "config_changed" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("switches while preserving agent routing, preset, provider metadata and local session files", async () => {
    const f = await setup();
    const before = await f.store.getConfig();
    const sessionDir = path.join(
      f.env.openclawStateDir,
      "agents",
      f.bot.id,
      "sessions",
    );
    await mkdir(sessionDir, { recursive: true });
    const history = '{"role":"user","content":"虚构记录：周日去杭州"}\n';
    await writeFile(path.join(sessionDir, "synthetic.jsonl"), history);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ choices: [{ message: { content: "OK" } }] }),
        ),
    );
    expect(
      await (
        await f.post("/api/v1/bridge/model", { ...f.ref, model: "new" })
      ).json(),
    ).toMatchObject({ ok: true, saved: true, modelId: `${key}/new` });
    const after = await f.store.getConfig();
    expect(after.bots[0]).toMatchObject({
      id: f.bot.id,
      systemPrompt: "测试用预设",
      modelId: `${key}/new`,
    });
    expect(after.channels).toEqual(before.channels);
    expect(after.models.providers[key]).toMatchObject({
      apiKey: "saved-test-key",
      metadata: { retained: true },
      displayName: "我的 API",
      baseUrl: f.provider.baseUrl,
    });
    expect(after.models.providers[key]?.models.map((m) => m.id)).toEqual([
      "old",
      "known",
      "new",
    ]);
    expect(after.models.providers[key]?.models[0]).toEqual(
      f.provider.models[0],
    );
    const compiledBefore = compileOpenClawConfig(before, f.env);
    const compiledAfter = compileOpenClawConfig(after, f.env);
    expect(compiledAfter.bindings).toEqual(compiledBefore.bindings);
    expect(compiledAfter.session).toEqual(compiledBefore.session);
    expect(
      await readFile(path.join(sessionDir, "synthetic.jsonl"), "utf8"),
    ).toBe(history);
    expect(f.request).not.toHaveBeenCalled();
    expect(f.restartRuntime).toHaveBeenCalledOnce();
  });
  it("retains known model capabilities rather than replacing them with defaults", async () => {
    const f = await setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ choices: [{ message: { content: "OK" } }] }),
        ),
    );
    await f.post("/api/v1/bridge/model", { ...f.ref, model: "known" });
    expect((await f.store.getConfig()).models.providers[key]?.models).toEqual(
      f.provider.models,
    );
  });
  it("leaves the current model unchanged when testing fails", async () => {
    const f = await setup();
    const before = await f.store.getConfig();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 401 })),
    );
    expect(
      await (
        await f.post("/api/v1/bridge/model", { ...f.ref, model: "new" })
      ).json(),
    ).toMatchObject({ saved: false, ok: false });
    expect(await f.store.getConfig()).toEqual(before);
    expect(f.restartRuntime).not.toHaveBeenCalled();
  });
  it("does not overwrite a key updated during the generation test", async () => {
    const f = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        await f.store.saveProviderAndSelectModel(
          key,
          { ...f.provider, apiKey: "new-key" },
          `${key}/old`,
        );
        return Response.json({ choices: [{ message: { content: "OK" } }] });
      }),
    );
    expect(
      await (
        await f.post("/api/v1/bridge/model", { ...f.ref, model: "new" })
      ).json(),
    ).toMatchObject({ saved: false, code: "config_changed" });
    expect((await f.store.getConfig()).models.providers[key]?.apiKey).toBe(
      "new-key",
    );
    expect((await f.store.getConfig()).runtime.defaultModelId).toBe(
      `${key}/old`,
    );
    expect(f.restartRuntime).not.toHaveBeenCalled();
  });
});
