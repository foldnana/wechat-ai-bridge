import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "#controller/app/container";
import { createApp } from "#controller/app/create-app";
import type { ControllerEnv } from "#controller/app/env";
import { compileOpenClawConfig } from "#controller/lib/openclaw-config-compiler";
import { ModelProviderService } from "#controller/services/model-provider-service";
import { NexuConfigStore } from "#controller/store/nexu-config-store";
import type { NexuConfig } from "#controller/store/schemas";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function environment(root: string): ControllerEnv {
  return {
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
}

describe("WeChat bridge product boundary", () => {
  it("removes obsolete routes while retaining WeChat, BYOK and local preferences", async () => {
    const app = createApp({
      env: environment("unused"),
    } as ControllerContainer);
    for (const endpoint of [
      "/api/internal/desktop/cloud-status",
      "/api/internal/desktop/cloud-connect",
      "/api/internal/desktop/rewards",
      "/api/v1/channels/slack/connect",
      "/api/v1/channels/discord/connect",
      "/api/v1/channels/feishu/connect",
      "/api/v1/channels/whatsapp/qr-start",
      "/api/v1/skillhub/install",
      "/api/v1/integrations",
      "/api/v1/quota/fallback-to-byok",
    ]) {
      expect((await app.request(endpoint, { method: "POST" })).status).toBe(
        404,
      );
      expect((await app.request(endpoint)).status).toBe(404);
    }
    const document = app.getOpenAPIDocument({
      openapi: "3.1.0",
      info: { title: "Test", version: "1" },
    });
    expect(document.paths).toHaveProperty("/api/v1/channels/wechat/qr-start");
    expect(document.paths).toHaveProperty("/api/v1/channels/wechat/qr-wait");
    expect(document.paths).toHaveProperty("/api/v1/channels/wechat/connect");
    expect(document.paths).toHaveProperty("/api/v1/model-providers/config");
    expect(document.paths).toHaveProperty(
      "/api/internal/desktop/default-model",
    );
  });

  it("does not revive cloud inventory, other IM plugins or tools from legacy config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bridge-policy-"));
    directories.push(root);
    const env = environment(root);
    const store = new NexuConfigStore(env);
    await store.upsertProvider("deepseek", {
      apiKey: "test-only-key",
      enabled: true,
      modelsJson: JSON.stringify(["deepseek-chat"]),
    });
    const bot = await store.getOrCreateDefaultBot();
    await store.connectWechat({ accountId: "test-wechat" });
    await store.setDefaultModel("deepseek/deepseek-chat");
    const config = await store.getConfig();
    config.desktop.cloud = {
      connected: true,
      apiKey: "old-cloud-key",
      linkUrl: "https://old-cloud.invalid",
      models: [{ id: "old-cloud-model", name: "Old model" }],
    };
    config.desktop.analyticsEnabled = true;
    config.channels.push({
      ...config.channels[0],
      id: "legacy-slack",
      channelType: "slack",
      accountId: "legacy",
    } as NexuConfig["channels"][number]);
    const compiled = compileOpenClawConfig(
      config,
      env,
      undefined,
      ["legacy-skill"],
      new Map([[bot.id, ["workspace-skill"]]]),
    );
    expect(Object.keys(compiled.channels)).toEqual(["openclaw-weixin"]);
    expect(
      compiled.bindings.every(
        (binding) => binding.match.channel === "openclaw-weixin",
      ),
    ).toBe(true);
    expect(compiled.models?.providers.deepseek?.apiKey).toBe("test-only-key");
    expect(compiled.models?.providers.link).toBeUndefined();
    expect(compiled.plugins?.allow).toEqual([
      "openclaw-weixin",
      "nexu-runtime-model",
    ]);
    expect(compiled.tools?.deny).toEqual(["*"]);
    expect(compiled.tools?.exec?.security).toBe("deny");
    expect(compiled.cron?.enabled).toBe(false);
    expect(compiled.diagnostics?.enabled).toBe(false);
    expect(compiled.agents.defaults?.compaction?.memoryFlush?.enabled).toBe(
      false,
    );
    expect(
      compiled.agents.list.every((agent) => agent.skills?.length === 0),
    ).toBe(true);
  });

  it("lists user models without contacting Nexu and keeps analytics disabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bridge-models-"));
    directories.push(root);
    const env = environment(root);
    const store = new NexuConfigStore(env);
    expect((await store.getConfig()).runtime.defaultModelId).toBe("");
    await store.upsertProvider("deepseek", {
      apiKey: "test-only-key",
      enabled: true,
      modelsJson: JSON.stringify(["deepseek-chat"]),
    });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("No network expected"));
    const service = new ModelProviderService(
      store,
      env,
      {} as never,
      {} as never,
    );
    expect(
      (await service.listModels()).models.map((model) => model.id),
    ).toEqual(["deepseek/deepseek-chat"]);
    expect(await store.setDesktopAnalyticsEnabled(true)).toBe(false);
    expect(await store.getDesktopAnalyticsEnabled()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
