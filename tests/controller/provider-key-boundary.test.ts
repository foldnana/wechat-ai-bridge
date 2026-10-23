import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SAVED_PROVIDER_API_KEY,
  modelProviderConfigSchema,
} from "@nexu/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "#controller/app/container";
import { createApp } from "#controller/app/create-app";
import type { ControllerEnv } from "#controller/app/env";
import { ModelProviderService } from "#controller/services/model-provider-service";
import { NexuConfigStore } from "#controller/store/nexu-config-store";

const dirs: string[] = [];
const secret = "synthetic-provider-key-never-return";
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) {
    if (
      path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith("bridge-key-boundary-")
    )
      throw new Error("Invalid cleanup path");
    await rm(dir, { recursive: true, force: true });
  }
});

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bridge-key-boundary-"));
  dirs.push(root);
  const env = {
    nexuHomeDir: root,
    nexuConfigPath: path.join(root, "config.json"),
    openclawStateDir: path.join(root, "runtime"),
    webUrl: "http://localhost:5173",
    defaultModelId: "",
    openclawGatewayPort: 18789,
  } as ControllerEnv;
  const store = new NexuConfigStore(env);
  await store.setModelProviderConfigDocument({
    mode: "merge",
    providers: {
      deepseek: modelProviderConfigSchema.parse({
        apiKey: secret,
        auth: "api-key",
        baseUrl: "https://api.deepseek.com",
        models: [{ id: "deepseek-chat", name: "Chat" }],
      }),
    },
  });
  const syncAll = vi.fn();
  const service = new ModelProviderService(
    store,
    env,
    { syncAll } as never,
    {
      stop: vi.fn(),
      restart: vi.fn(),
      enableAutoRestart: vi.fn(),
      start: vi.fn(),
    } as never,
  );
  const app = createApp({
    env,
    modelProviderService: service,
    desktopLocalService: { restartRuntime: vi.fn() },
  } as unknown as ControllerContainer);
  const getConfig = async () => {
    const response = await app.request("/api/v1/model-providers/config");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain(secret);
    return JSON.parse(body).config;
  };
  const putConfig = (config: unknown) =>
    app.request("/api/v1/model-providers/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    });
  return { store, env, app, service, syncAll, getConfig, putConfig };
}

describe("provider config API key boundary", () => {
  it("masks GET/PUT and retains the real key when editing models and other settings", async () => {
    const { store, env, getConfig, putConfig } = await setup();
    const config = await getConfig();
    expect(config.providers.deepseek.apiKey).toBe(SAVED_PROVIDER_API_KEY);
    config.providers.deepseek.displayName = "Updated";
    config.providers.deepseek.models.push({ id: "another", name: "Another" });
    const response = await putConfig(config);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(secret);
    const stored = await new NexuConfigStore(
      env,
    ).getModelProviderConfigDocument();
    expect(stored.providers.deepseek.apiKey).toBe(secret);
    expect(stored.providers.deepseek.models).toHaveLength(2);
    expect(stored.providers.deepseek.displayName).toBe("Updated");
    expect(await readFile(env.nexuConfigPath, "utf8")).not.toContain(
      SAVED_PROVIDER_API_KEY,
    );
    expect((await store.getProvider("deepseek"))?.apiKey).toBe(secret);
  });

  it("replaces a key without echoing it, and still deletes providers", async () => {
    const { store, getConfig, putConfig } = await setup();
    const config = await getConfig();
    config.providers.deepseek.apiKey = "replacement-test-key";
    const response = await putConfig(config);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("replacement-test-key");
    expect((await store.getProvider("deepseek"))?.apiKey).toBe(
      "replacement-test-key",
    );
    config.providers = {};
    expect((await putConfig(config)).status).toBe(200);
    expect((await store.getModelProviderConfigDocument()).providers).toEqual(
      {},
    );
  });

  it("refreshes models using the saved key, never sending the marker upstream", async () => {
    const { app, getConfig } = await setup();
    const config = await getConfig();
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${secret}`,
      );
      return Response.json({ data: [{ id: "deepseek-chat" }] });
    });
    vi.stubGlobal("fetch", fetch);
    const response = await app.request(
      "/api/v1/model-providers/deepseek/validate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey: config.providers.deepseek.apiKey,
          baseUrl: config.providers.deepseek.baseUrl,
        }),
      },
    );
    expect(await response.json()).toMatchObject({
      valid: true,
      models: ["deepseek-chat"],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects markers for missing connections or changed addresses without modifying the saved key", async () => {
    const { store, service, syncAll, getConfig, putConfig } = await setup();
    const config = await getConfig();
    config.providers.deepseek.baseUrl = "https://another.example.invalid";
    expect((await putConfig(config)).status).toBe(400);
    expect(syncAll).not.toHaveBeenCalled();
    expect((await store.getProvider("deepseek"))?.apiKey).toBe(secret);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      await service.verifyProvider("deepseek", {
        apiKey: SAVED_PROVIDER_API_KEY,
        baseUrl: config.providers.deepseek.baseUrl,
      }),
    ).toMatchObject({ valid: false });
    expect(
      await service.verifyProvider("openai", {
        apiKey: SAVED_PROVIDER_API_KEY,
      }),
    ).toMatchObject({ valid: false });
    expect(fetch).not.toHaveBeenCalled();
    config.providers = {};
    config.providers.openai = modelProviderConfigSchema.parse({
      apiKey: SAVED_PROVIDER_API_KEY,
      auth: "api-key",
      baseUrl: "https://api.openai.com/v1",
    });
    expect((await putConfig(config)).status).toBe(400);
  });
});
