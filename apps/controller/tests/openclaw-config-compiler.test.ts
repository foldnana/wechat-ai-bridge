import { describe, expect, it } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import {
  type OAuthConnectionState,
  compileOpenClawConfig,
} from "../src/lib/openclaw-config-compiler.js";
import {
  type NexuConfig,
  migrateLegacyProvidersToCanonicalModelsConfig,
  nexuConfigSchema,
} from "../src/store/schemas.js";

function createEnv(overrides: Record<string, unknown> = {}): ControllerEnv {
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuHomeDir: "/tmp/nexu-test",
    nexuConfigPath: "/tmp/nexu-test/config.json",
    artifactsIndexPath: "/tmp/nexu-test/artifacts/index.json",
    compiledOpenclawSnapshotPath: "/tmp/nexu-test/compiled-openclaw.json",
    openclawStateDir: "/tmp/openclaw",
    openclawConfigPath: "/tmp/openclaw/openclaw.json",
    openclawSkillsDir: "/tmp/openclaw/skills",
    userSkillsDir: "/tmp/.agents/skills",
    openclawWorkspaceTemplatesDir: "/tmp/openclaw/workspace-templates",
    openclawBin: "openclaw",
    openclawGatewayPort: 18789,
    openclawGatewayToken: "token-123",
    manageOpenclawProcess: false,
    gatewayProbeEnabled: false,
    runtimeSyncIntervalMs: 2000,
    runtimeHealthIntervalMs: 5000,
    defaultModelId: "link/gemini-3-flash-preview",
    ...overrides,
  } as unknown as ControllerEnv;
}

function createConfig(overrides: Partial<NexuConfig> = {}): NexuConfig {
  const now = new Date().toISOString();
  const raw = {
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
        modelId: "anthropic/claude-sonnet-4",
        systemPrompt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    runtime: {
      gateway: {
        port: 18789,
        bind: "loopback",
        authMode: "token",
      },
      defaultModelId: "anthropic/claude-sonnet-4",
    },
    models: {
      mode: "merge",
      providers: {},
    },
    providers: [
      {
        id: "provider-1",
        providerId: "openai",
        displayName: "OpenAI",
        enabled: true,
        baseUrl: null,
        apiKey: "sk-test",
        models: ["gpt-4o"],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "provider-2",
        providerId: "anthropic",
        displayName: "Anthropic Proxy",
        enabled: true,
        baseUrl: "https://proxy.example.com/v1",
        apiKey: "proxy-key",
        models: ["claude-sonnet-4"],
        createdAt: now,
        updatedAt: now,
      },
    ],
    integrations: [],
    channels: [
      {
        id: "slack-channel-1",
        botId: "bot-1",
        channelType: "slack",
        accountId: "slack-A123-T123",
        status: "connected",
        teamName: "Acme",
        appId: "A123",
        botUserId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "feishu-channel-1",
        botId: "bot-1",
        channelType: "feishu",
        accountId: "cli_a1b2c3",
        status: "connected",
        teamName: null,
        appId: "cli_a1b2c3",
        botUserId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    templates: {},
    skills: {
      version: 1,
      defaults: {
        enabled: true,
        source: "inline",
      },
      items: {},
    },
    desktop: {
      selectedModelId: "gpt-4o",
      cloud: {
        linkUrl: "https://link.example.com",
        apiKey: "link-key",
        models: [
          {
            id: "gemini-2.5-flash",
            name: "Gemini 2.5 Flash",
            provider: "google",
          },
        ],
      },
    },
    secrets: {
      "channel:slack-channel-1:botToken": "xoxb-test",
      "channel:slack-channel-1:signingSecret": "signing-secret",
      "channel:feishu-channel-1:appId": "cli_a1b2c3",
      "channel:feishu-channel-1:appSecret": "feishu-secret",
      "channel:feishu-channel-1:connectionMode": "webhook",
      "channel:feishu-channel-1:verificationToken": "verify-token",
    },
    ...overrides,
  };
  return Object.assign(
    nexuConfigSchema.parse({
      ...raw,
      models:
        overrides.models ??
        migrateLegacyProvidersToCanonicalModelsConfig(raw.providers ?? []),
    }),
    { providers: raw.providers },
  );
}

describe("compileOpenClawConfig", () => {
  it("keeps gateway authentication while excluding old channel and cloud configuration", () => {
    const result = compileOpenClawConfig(createConfig(), createEnv());
    expect(result.gateway.auth.mode).toBe("token");
    expect(result.gateway.auth.token).toBe("token-123");
    expect(result.agents.list[0]).toMatchObject({
      id: "bot-1",
      workspace: "/tmp/openclaw/agents/bot-1",
    });
    expect(result.models?.providers.link).toBeUndefined();
    expect(Object.keys(result.channels)).toEqual(["openclaw-weixin"]);
    expect(result.skills?.load?.extraDirs).toEqual([]);
  });

  it("prewarms openclaw-weixin in plugins.allow even with no connected wechat channel", () => {
    // Regression: without this, first wechat connect changes plugins.allow
    // -> SIGUSR1 -> ~11s drain -> GatewayDrainingError on inbound messages.
    const result = compileOpenClawConfig(
      createConfig({
        channels: [],
        secrets: {},
      }),
      createEnv(),
    );

    expect(result.plugins?.allow).toContain("openclaw-weixin");
    expect(result.plugins?.entries?.["openclaw-weixin"]?.enabled).toBe(true);
  });

  it("injects env-backed litellm routing for bare local model ids", () => {
    const result = compileOpenClawConfig(
      createConfig({
        providers: [],
        desktop: {},
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "anthropic/claude-sonnet-4",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "anthropic/claude-sonnet-4",
        },
      }),
      createEnv({
        litellmBaseUrl: "https://litellm.powerformer.net",
        litellmApiKey: "litellm-key",
      }),
    );

    expect(result.models?.providers.litellm?.baseUrl).toBe(
      "https://litellm.powerformer.net",
    );
    expect(result.models?.providers.litellm?.models[0]?.id).toBe(
      "anthropic/claude-sonnet-4",
    );
    expect(result.agents.defaults?.model).toEqual({
      primary: "litellm/anthropic/claude-sonnet-4",
    });
    expect(result.agents.list[0]?.model).toEqual({
      primary: "litellm/anthropic/claude-sonnet-4",
    });
  });

  it("does not remap openai models to OAuth providers without persisted OAuth state", () => {
    const baseConfig = createConfig();
    const baseBot = baseConfig.bots[0];
    const baseProvider = baseConfig.providers?.[0];
    if (!baseBot || !baseProvider) {
      throw new Error("expected base config fixtures");
    }
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...baseBot,
            modelId: "openai/gpt-5.4",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "openai/gpt-5.4",
        },
        providers: [
          {
            ...baseProvider,
            apiKey: null,
            models: ["gpt-5.4"],
          },
        ],
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.agents.defaults?.model).toEqual({
      primary: "openai/gpt-5.4",
    });
    expect(result.agents.list[0]?.model).toEqual({
      primary: "openai/gpt-5.4",
    });
  });

  it("uses SiliconFlow's cn API base URL by default", () => {
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
        },
        providers: [
          {
            id: "provider-siliconflow",
            providerId: "siliconflow",
            displayName: "SiliconFlow",
            enabled: true,
            authMode: "apiKey",
            baseUrl: null,
            apiKey: "sk-test",
            oauthRegion: null,
            oauthCredential: null,
            models: ["Pro/MiniMaxAI/MiniMax-M2.5"],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.models?.providers.siliconflow?.baseUrl).toBe(
      "https://api.siliconflow.cn/v1",
    );
    expect(result.models?.providers.siliconflow?.models[0]?.id).toBe(
      "Pro/MiniMaxAI/MiniMax-M2.5",
    );
    expect(result.agents.defaults?.model).toEqual({
      primary: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
    });
  });

  it("treats the explicit SiliconFlow .cn URL as a direct official endpoint", () => {
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
        },
        providers: [
          {
            id: "provider-siliconflow-cn",
            providerId: "siliconflow",
            displayName: "SiliconFlow",
            enabled: true,
            authMode: "apiKey",
            baseUrl: "https://api.siliconflow.cn/v1",
            apiKey: "sk-test",
            oauthRegion: null,
            oauthCredential: null,
            models: ["Pro/MiniMaxAI/MiniMax-M2.5"],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.models?.providers.siliconflow?.baseUrl).toBe(
      "https://api.siliconflow.cn/v1",
    );
    expect(result.models?.providers.byok_siliconflow).toBeUndefined();
    expect(result.models?.providers.siliconflow?.models[0]?.id).toBe(
      "Pro/MiniMaxAI/MiniMax-M2.5",
    );
    expect(result.agents.defaults?.model).toEqual({
      primary: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
    });
  });

  it("normalizes the legacy SiliconFlow endpoint before compilation", () => {
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
        },
        providers: [
          {
            id: "provider-siliconflow-legacy",
            providerId: "siliconflow",
            displayName: "SiliconFlow",
            enabled: true,
            authMode: "apiKey",
            baseUrl: "https://api.siliconflow.com/v1",
            apiKey: "sk-test",
            oauthRegion: null,
            oauthCredential: null,
            models: ["Pro/MiniMaxAI/MiniMax-M2.5"],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.models?.providers.siliconflow?.baseUrl).toBe(
      "https://api.siliconflow.cn/v1",
    );
    expect(result.models?.providers.byok_siliconflow).toBeUndefined();
    expect(result.models?.providers.siliconflow?.models[0]?.id).toBe(
      "Pro/MiniMaxAI/MiniMax-M2.5",
    );
    expect(result.agents.defaults?.model).toEqual({
      primary: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
    });
  });

  it("treats custom SiliconFlow gateway URLs as proxied endpoints", () => {
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "byok_siliconflow/siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId:
            "byok_siliconflow/siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
        },
        providers: [
          {
            id: "provider-siliconflow-proxy",
            providerId: "siliconflow",
            displayName: "SiliconFlow Proxy",
            enabled: true,
            authMode: "apiKey",
            baseUrl: "https://models.example.com/v1",
            apiKey: "sk-test",
            oauthRegion: null,
            oauthCredential: null,
            models: ["Pro/MiniMaxAI/MiniMax-M2.5"],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.models?.providers.byok_siliconflow?.baseUrl).toBe(
      "https://models.example.com/v1",
    );
    expect(result.models?.providers.siliconflow).toBeUndefined();
    expect(result.models?.providers.byok_siliconflow?.models[0]?.id).toBe(
      "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
    );
    expect(result.agents.defaults?.model).toEqual({
      primary: "byok_siliconflow/siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
    });
  });

  it("ignores unsupported custom providers in compiled model config", () => {
    const baseConfig = createConfig();
    const baseProviders = baseConfig.providers ?? [];
    const baseProvider = baseProviders[0];
    if (!baseProvider) {
      throw new Error("expected base config providers");
    }
    const result = compileOpenClawConfig(
      createConfig({
        providers: [
          ...baseProviders,
          {
            ...baseProvider,
            id: "provider-3",
            providerId: "custom",
            displayName: "Custom",
            baseUrl: "https://models.example.com/v1",
            apiKey: "custom-key",
            models: ["anthropic/claude-sonnet-4"],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
      createEnv(),
    );

    expect(Object.keys(result.models?.providers ?? {})).not.toContain("custom");
    expect(
      Object.keys(result.models?.providers ?? {}).some((key) =>
        key.startsWith("custom_"),
      ),
    ).toBe(false);
  });

  it("uses the CN MiniMax endpoint for CN OAuth providers", () => {
    const now = new Date().toISOString();
    const result = compileOpenClawConfig(
      createConfig({
        providers: [
          {
            id: "provider-minimax-cn",
            providerId: "minimax",
            displayName: "MiniMax",
            enabled: true,
            baseUrl: null,
            authMode: "oauth",
            apiKey: null,
            oauthRegion: "cn",
            oauthCredential: {
              provider: "minimax-portal",
              access: "access-token",
              refresh: "refresh-token",
              expires: Date.now() + 60_000,
            },
            models: ["MiniMax-M2.7"],
            createdAt: now,
            updatedAt: now,
          },
        ],
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.models?.providers.minimax?.baseUrl).toBe(
      "https://api.minimaxi.com/anthropic",
    );
  });

  it("compiles canonical custom provider instances with deterministic runtime keys", () => {
    const now = new Date().toISOString();
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "custom-openai/team-gateway/anthropic/claude-haiku-4.5",
            createdAt: now,
            updatedAt: now,
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId:
            "custom-openai/team-gateway/anthropic/claude-haiku-4.5",
        },
        providers: [],
        models: {
          mode: "merge",
          providers: {
            "custom-openai/team-gateway": {
              providerTemplateId: "custom-openai",
              instanceId: "team-gateway",
              enabled: true,
              auth: "api-key",
              api: "openai-completions",
              apiKey: "custom-key",
              baseUrl: "https://gateway.example.com/v1",
              displayName: "Team Gateway",
              headers: {
                "x-team-id": "team-gateway",
              },
              models: [
                {
                  id: "anthropic/claude-haiku-4.5",
                  name: "Claude Haiku 4.5",
                  reasoning: false,
                  input: ["text"],
                  cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  contextWindow: 0,
                  maxTokens: 0,
                },
              ],
            },
          },
        },
        desktop: {},
      }),
      createEnv(),
    );

    expect(
      result.models?.providers["custom-openai__team-gateway"],
    ).toMatchObject({
      baseUrl: "https://gateway.example.com/v1",
      apiKey: "custom-key",
      api: "openai-completions",
      headers: {
        "x-team-id": "team-gateway",
      },
    });
    expect(
      result.models?.providers["custom-openai__team-gateway"]?.models[0]?.id,
    ).toBe("anthropic/claude-haiku-4.5");
    expect(result.agents.defaults?.model).toEqual({
      primary: "custom-openai__team-gateway/anthropic/claude-haiku-4.5",
    });
  });

  it("preserves secret-ref provider API keys in compiled models config", () => {
    const result = compileOpenClawConfig(
      createConfig({
        providers: [],
        models: {
          mode: "merge",
          providers: {
            openai: {
              enabled: true,
              auth: "api-key",
              api: "openai-completions",
              apiKey: {
                source: "env",
                provider: "nexu",
                id: "openai-api-key",
              },
              baseUrl: "https://api.openai.com/v1",
              models: [
                {
                  id: "gpt-4.1",
                  name: "GPT-4.1",
                  reasoning: false,
                  input: ["text"],
                  cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  contextWindow: 0,
                  maxTokens: 0,
                },
              ],
            },
          },
        },
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.models?.providers.openai?.apiKey).toEqual({
      source: "env",
      provider: "nexu",
      id: "openai-api-key",
    });
    expect(result.models?.providers.openai?.models[0]?.id).toBe("gpt-4.1");
  });

  it("normalizes legacy byok model refs against canonical provider config", () => {
    const now = new Date().toISOString();
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "byok_openai/openai/gpt-4.1",
            createdAt: now,
            updatedAt: now,
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "byok_openai/openai/gpt-4.1",
        },
        providers: [],
        models: {
          mode: "merge",
          providers: {
            openai: {
              enabled: true,
              auth: "api-key",
              api: "openai-completions",
              apiKey: "sk-test",
              baseUrl: "https://api.openai.com/v1",
              models: [
                {
                  id: "gpt-4.1",
                  name: "GPT-4.1",
                  reasoning: false,
                  input: ["text"],
                  cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  contextWindow: 0,
                  maxTokens: 0,
                },
              ],
            },
          },
        },
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.agents.defaults?.model).toEqual({
      primary: "openai/gpt-4.1",
    });
  });

  it("remaps openai models to OAuth provider ids when persisted OAuth state is connected", () => {
    const baseConfig = createConfig();
    const baseBot = baseConfig.bots[0];
    const baseProvider = baseConfig.providers?.[0];
    if (!baseBot || !baseProvider) {
      throw new Error("expected base config fixtures");
    }
    const oauthState: OAuthConnectionState = {
      connectedProviderIds: ["openai"],
    };
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...baseBot,
            modelId: "openai/gpt-5.4",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "openai/gpt-5.4",
        },
        providers: [
          {
            ...baseProvider,
            apiKey: null,
            models: ["gpt-5.4"],
          },
        ],
        desktop: {},
      }),
      createEnv(),
      oauthState,
    );

    expect(result.agents.defaults?.model).toEqual({
      primary: "openai-codex/gpt-5.4",
    });
    expect(result.agents.list[0]?.model).toEqual({
      primary: "openai-codex/gpt-5.4",
    });
  });

  it("leaves OAuth model registration to the runtime auth profile", () => {
    const result = compileOpenClawConfig(
      createConfig({
        providers: [],
        models: {
          mode: "merge",
          providers: {
            openai: {
              enabled: true,
              auth: "oauth",
              api: "openai-completions",
              apiKey: null,
              oauthProfileRef: "openai-codex",
              baseUrl: "https://api.openai.com/v1",
              models: [
                {
                  id: "gpt-5.4",
                  name: "GPT-5.4",
                  reasoning: false,
                  input: ["text"],
                  cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  contextWindow: 0,
                  maxTokens: 0,
                },
              ],
            },
          },
        },
        desktop: {
          selectedModelId: null,
        },
      }),
      createEnv(),
    );

    expect(result.models?.providers.openai).toBeUndefined();
  });
});
