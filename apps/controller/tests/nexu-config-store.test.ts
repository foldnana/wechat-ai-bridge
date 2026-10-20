import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import { NexuConfigStore } from "../src/store/nexu-config-store.js";

describe("NexuConfigStore", () => {
  let rootDir = "";
  let env: ControllerEnv;

  it("saves a tested provider and its model selection together, retaining other providers and presets", async () => {
    const store = new NexuConfigStore(env);
    await store.upsertProvider("openai", {
      apiKey: "existing-test-key",
      enabled: true,
      modelsJson: '["test-model"]',
    });
    await store.upsertProvider("deepseek", {
      apiKey: "old-test-key",
      enabled: true,
      modelsJson: '["deepseek-chat"]',
    });
    const bot = await store.getOrCreateDefaultBot();
    await store.updateBot(bot.id, { systemPrompt: "用户自己的预设" });
    const config = await store.getModelProviderConfigDocument();
    const provider = { ...config.providers.deepseek, apiKey: "new-test-key" };
    await store.saveProviderAndSelectModel(
      "deepseek",
      provider,
      "deepseek/deepseek-chat",
    );
    // Reload from disk rather than relying on the in-memory copy.
    const reloaded = await new NexuConfigStore(env).getConfig();
    expect(reloaded.models.providers.openai.apiKey).toBe("existing-test-key");
    expect(reloaded.models.providers.deepseek.apiKey).toBe("new-test-key");
    expect(reloaded.runtime.defaultModelId).toBe("deepseek/deepseek-chat");
    expect(reloaded.bots[0]).toMatchObject({
      modelId: "deepseek/deepseek-chat",
      systemPrompt: "用户自己的预设",
    });
  });

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-controller-"));
    env = {
      nodeEnv: "test",
      port: 3010,
      host: "127.0.0.1",
      webUrl: "http://localhost:5173",
      nexuHomeDir: path.join(rootDir, ".nexu"),
      nexuConfigPath: path.join(rootDir, ".nexu", "config.json"),
      artifactsIndexPath: path.join(
        rootDir,
        ".nexu",
        "artifacts",
        "index.json",
      ),
      compiledOpenclawSnapshotPath: path.join(
        rootDir,
        ".nexu",
        "compiled-openclaw.json",
      ),
      openclawStateDir: path.join(rootDir, ".openclaw"),
      openclawConfigPath: path.join(rootDir, ".openclaw", "openclaw.json"),
      openclawSkillsDir: path.join(rootDir, ".openclaw", "skills"),
      userSkillsDir: path.join(rootDir, ".agents", "skills"),
      openclawBuiltinExtensionsDir: null,
      openclawExtensionsDir: path.join(rootDir, ".openclaw", "extensions"),
      bundledRuntimePluginsDir: path.join(rootDir, "bundled-runtime-plugins"),
      runtimePluginTemplatesDir: path.join(rootDir, "runtime-plugins"),
      openclawRuntimeModelStatePath: path.join(
        rootDir,
        ".openclaw",
        "nexu-runtime-model.json",
      ),
      skillhubCacheDir: path.join(rootDir, ".nexu", "skillhub-cache"),
      skillDbPath: path.join(rootDir, ".nexu", "skill-ledger.json"),
      analyticsStatePath: path.join(rootDir, ".nexu", "analytics-state.json"),
      staticSkillsDir: undefined,
      platformTemplatesDir: undefined,
      openclawWorkspaceTemplatesDir: path.join(
        rootDir,
        ".openclaw",
        "workspace-templates",
      ),
      openclawOwnershipMode: "external",
      openclawBaseUrl: "http://127.0.0.1:18789",
      openclawBin: "openclaw",
      openclawLogDir: path.join(rootDir, ".nexu", "logs", "openclaw"),
      openclawLaunchdLabel: null,
      litellmBaseUrl: null,
      litellmApiKey: null,
      openclawGatewayPort: 18789,
      openclawGatewayToken: undefined,
      manageOpenclawProcess: false,
      gatewayProbeEnabled: false,
      runtimeSyncIntervalMs: 2000,
      runtimeHealthIntervalMs: 5000,
      defaultModelId: "anthropic/claude-sonnet-4",
      posthogApiKey: undefined,
      posthogHost: undefined,
    };
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("persists bot, channel, provider, and template state", async () => {
    const store = new NexuConfigStore(env);

    const bot = await store.createBot({ name: "Assistant", slug: "assistant" });
    const channel = await store.connectWechat({ accountId: "test-wechat" });
    const provider = await store.upsertProvider("openai", {
      apiKey: "sk-test",
      displayName: "OpenAI",
      modelsJson: JSON.stringify(["gpt-4o"]),
    });
    await store.upsertTemplate({ name: "AGENTS.md", content: "hello" });

    expect(bot.slug).toBe("assistant");
    expect(channel.accountId).toBe("test-wechat");
    expect(provider.provider.hasApiKey).toBe(true);
    expect(await store.listTemplates()).toHaveLength(1);
    expect(await store.listProviders()).toHaveLength(1);
    expect(await store.listChannels()).toHaveLength(1);
  });

  it("clears an existing provider API key when null is explicitly provided", async () => {
    const store = new NexuConfigStore(env);

    await store.upsertProvider("openai", {
      apiKey: "sk-test",
      displayName: "OpenAI",
      modelsJson: JSON.stringify(["gpt-5.4"]),
    });

    const result = await store.upsertProvider("openai", {
      apiKey: null,
      modelsJson: JSON.stringify(["gpt-5.4"]),
    });

    expect(result.provider.hasApiKey).toBe(false);
    expect(result.provider.apiKey).toBeNull();
  });

  it("writes provider changes into canonical config.models.providers only", async () => {
    const store = new NexuConfigStore(env);

    await store.upsertProvider("openai", {
      apiKey: "sk-test",
      displayName: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      modelsJson: JSON.stringify(["gpt-5.4"]),
    });

    const config = await store.getConfig();

    expect(config.models.providers.openai).toMatchObject({
      enabled: true,
      displayName: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      auth: "api-key",
      api: "openai-completions",
      apiKey: "sk-test",
    });
    expect(config.models.providers.openai?.models).toEqual([
      expect.objectContaining({
        id: "gpt-5.4",
        name: "gpt-5.4",
        api: "openai-completions",
      }),
    ]);
    expect(config).not.toHaveProperty("providers");
    expect(config.schemaVersion).toBe(2);
  });

  it("migrates legacy config.providers into canonical config.models.providers on read", async () => {
    await mkdir(path.dirname(env.nexuConfigPath), { recursive: true });
    await writeFile(
      env.nexuConfigPath,
      JSON.stringify(
        {
          $schema: "https://nexu.io/config.json",
          schemaVersion: 1,
          app: {},
          bots: [],
          runtime: {},
          providers: [
            {
              id: "provider-openai",
              providerId: "openai",
              displayName: "OpenAI",
              enabled: true,
              baseUrl: "https://api.openai.com/v1",
              authMode: "apiKey",
              apiKey: "sk-test",
              oauthRegion: null,
              oauthCredential: null,
              models: ["gpt-4o"],
              createdAt: "2026-04-04T00:00:00.000Z",
              updatedAt: "2026-04-04T00:00:00.000Z",
            },
          ],
          integrations: [],
          channels: [],
          templates: {},
          desktop: {},
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new NexuConfigStore(env);
    const config = await store.getConfig();

    expect(config.models.providers.openai).toMatchObject({
      displayName: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      auth: "api-key",
      apiKey: "sk-test",
    });
    expect(config.models.providers.openai?.models).toEqual([
      expect.objectContaining({ id: "gpt-4o", name: "gpt-4o" }),
    ]);
    expect(config).not.toHaveProperty("providers");
    expect(config.schemaVersion).toBe(2);
  });

  it("derives legacy provider compatibility state from canonical config.models.providers", async () => {
    await mkdir(path.dirname(env.nexuConfigPath), { recursive: true });
    await writeFile(
      env.nexuConfigPath,
      JSON.stringify(
        {
          $schema: "https://nexu.io/config.json",
          schemaVersion: 1,
          app: {},
          bots: [],
          runtime: {},
          models: {
            mode: "merge",
            providers: {
              openai: {
                enabled: true,
                displayName: "OpenAI",
                baseUrl: "https://api.openai.com/v1",
                auth: "api-key",
                api: "openai-completions",
                apiKey: "sk-test",
                models: [
                  {
                    id: "gpt-4o-mini",
                    name: "gpt-4o-mini",
                    api: "openai-completions",
                    reasoning: false,
                    input: ["text"],
                    cost: {
                      input: 0,
                      output: 0,
                      cacheRead: 0,
                      cacheWrite: 0,
                    },
                    contextWindow: 128000,
                    maxTokens: 16384,
                  },
                ],
              },
            },
          },
          providers: [],
          integrations: [],
          channels: [],
          templates: {},
          desktop: {},
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new NexuConfigStore(env);
    const providers = await store.listProviders();

    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({
      providerId: "openai",
      displayName: "OpenAI",
      hasApiKey: true,
      modelsJson: JSON.stringify(["gpt-4o-mini"]),
    });
  });

  it("normalizes persisted saved model refs on read", async () => {
    await mkdir(path.dirname(env.nexuConfigPath), { recursive: true });
    await writeFile(
      env.nexuConfigPath,
      JSON.stringify(
        {
          $schema: "https://nexu.io/config.json",
          schemaVersion: 1,
          app: {},
          bots: [
            {
              id: "bot-1",
              name: "Assistant",
              slug: "assistant",
              poolId: null,
              status: "active",
              modelId: "custom-openai__team%20gateway/openai/gpt-4.1",
              systemPrompt: null,
              createdAt: "2026-04-05T00:00:00.000Z",
              updatedAt: "2026-04-05T00:00:00.000Z",
            },
          ],
          runtime: {
            defaultModelId: "byok_openai/openai/gpt-4.1",
          },
          models: {
            mode: "merge",
            providers: {
              openai: {
                enabled: true,
                displayName: "OpenAI",
                baseUrl: "https://api.openai.com/v1",
                auth: "api-key",
                api: "openai-completions",
                apiKey: "sk-test",
                models: [
                  {
                    id: "openai/gpt-4.1",
                    name: "gpt-4.1",
                    api: "openai-completions",
                    reasoning: false,
                    input: ["text"],
                    cost: {
                      input: 0,
                      output: 0,
                      cacheRead: 0,
                      cacheWrite: 0,
                    },
                    contextWindow: 128000,
                    maxTokens: 16384,
                  },
                ],
              },
              "custom-openai/team gateway": {
                providerTemplateId: "custom-openai",
                instanceId: "team gateway",
                enabled: true,
                displayName: "Team Gateway",
                baseUrl: "https://gateway.example.com/v1",
                auth: "api-key",
                api: "openai-completions",
                apiKey: "sk-custom",
                models: [
                  {
                    id: "openai/gpt-4.1",
                    name: "gpt-4.1",
                    api: "openai-completions",
                    reasoning: false,
                    input: ["text"],
                    cost: {
                      input: 0,
                      output: 0,
                      cacheRead: 0,
                      cacheWrite: 0,
                    },
                    contextWindow: 128000,
                    maxTokens: 16384,
                  },
                ],
              },
            },
          },
          providers: [],
          integrations: [],
          channels: [],
          templates: {},
          desktop: {
            selectedModelId: "google/gemini-2.5-flash",
          },
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new NexuConfigStore(env);
    const config = await store.getConfig();

    expect(config.runtime.defaultModelId).toBe("openai/gpt-4.1");
    expect(config.bots[0]?.modelId).toBe(
      "custom-openai/team gateway/openai/gpt-4.1",
    );
    expect(config.desktop.selectedModelId).toBe("google/gemini-2.5-flash");
    expect(config.models.providers.openai?.models[0]?.id).toBe("gpt-4.1");
    expect(
      config.models.providers["custom-openai/team gateway"]?.models[0]?.id,
    ).toBe("openai/gpt-4.1");
  });

  it("rewrites saved model refs to canonical form on save", async () => {
    const store = new NexuConfigStore(env);

    await store.setModelProviderConfigDocument({
      mode: "merge",
      providers: {
        google: {
          enabled: true,
          displayName: "Gemini",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
          auth: "api-key",
          api: "openai-completions",
          apiKey: "gemini-key",
          models: [
            {
              id: "google/gemini-2.5-flash",
              name: "gemini-2.5-flash",
              api: "openai-completions",
              reasoning: false,
              input: ["text"],
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
              contextWindow: 128000,
              maxTokens: 16384,
            },
          ],
        },
        "custom-openai/team gateway": {
          providerTemplateId: "custom-openai",
          instanceId: "team gateway",
          enabled: true,
          displayName: "Team Gateway",
          baseUrl: "https://gateway.example.com/v1",
          auth: "api-key",
          api: "openai-completions",
          apiKey: "sk-custom",
          models: [
            {
              id: "custom-openai/team gateway/gpt-4.1",
              name: "gpt-4.1",
              api: "openai-completions",
              reasoning: false,
              input: ["text"],
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
              contextWindow: 128000,
              maxTokens: 16384,
            },
          ],
        },
      },
    });
    await store.setDefaultModel("google/gemini-2.5-flash");
    const bot = await store.createBot({
      name: "Assistant",
      slug: "assistant",
      modelId: "custom-openai__team%20gateway/openai/gpt-4.1",
    });
    await store.updateBot(bot.id, {
      modelId: "byok_gemini/gemini/gemini-2.5-pro",
    });

    const config = await store.getConfig();

    expect(config.models.providers.google?.models[0]?.id).toBe(
      "gemini-2.5-flash",
    );
    expect(
      config.models.providers["custom-openai/team gateway"]?.models[0]?.id,
    ).toBe("gpt-4.1");
    expect(config.runtime.defaultModelId).toBe("google/gemini-2.5-flash");
    expect(config.bots[0]?.modelId).toBe("google/gemini-2.5-pro");
    expect(config).not.toHaveProperty("providers");
    expect(config.schemaVersion).toBe(2);
  });

  it("preserves slash-qualified model ids for custom anthropic providers", async () => {
    const store = new NexuConfigStore(env);

    await store.setModelProviderConfigDocument({
      mode: "merge",
      providers: {
        "custom-anthropic/team gateway": {
          providerTemplateId: "custom-anthropic",
          instanceId: "team gateway",
          enabled: true,
          displayName: "Team Gateway",
          baseUrl: "https://gateway.example.com/v1",
          auth: "api-key",
          api: "anthropic-messages",
          apiKey: "sk-custom",
          models: [
            {
              id: "anthropic/claude-haiku-4.5",
              name: "claude-haiku-4.5",
              api: "anthropic-messages",
              reasoning: false,
              input: ["text"],
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
              contextWindow: 128000,
              maxTokens: 16384,
            },
          ],
        },
      },
    });
    const bot = await store.createBot({
      name: "Assistant",
      slug: "assistant",
      modelId: "custom-anthropic__team%20gateway/anthropic/claude-haiku-4.5",
    });

    const config = await store.getConfig();

    expect(
      config.models.providers["custom-anthropic/team gateway"]?.models[0]?.id,
    ).toBe("anthropic/claude-haiku-4.5");
    expect(config.bots.find((item) => item.id === bot.id)?.modelId).toBe(
      "custom-anthropic/team gateway/anthropic/claude-haiku-4.5",
    );
  });

  it("recovers from a broken primary config using backup-compatible data", async () => {
    const brokenConfigPath = env.nexuConfigPath;
    const backupPath = `${brokenConfigPath}.bak`;

    await mkdir(path.dirname(brokenConfigPath), { recursive: true });
    await writeFile(brokenConfigPath, "{not-json", "utf8");
    await writeFile(
      backupPath,
      JSON.stringify(
        {
          $schema: "https://nexu.io/config.json",
          bots: [],
          runtime: {},
          providers: [],
          integrations: [],
          channels: [],
          templates: {},
          desktop: {},
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new NexuConfigStore(env);
    const config = await store.getConfig();

    expect(config.schemaVersion).toBe(2);
    expect(config.$schema).toBe("https://nexu.io/config.json");
  });
});
