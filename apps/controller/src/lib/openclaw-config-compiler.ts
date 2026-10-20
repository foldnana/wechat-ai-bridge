import type { OpenClawConfig } from "@nexu/shared";
import { openclawConfigSchema } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import type { OAuthConnectionState } from "../runtime/openclaw-auth-profiles-store.js";
import type { NexuConfig } from "../store/schemas.js";
import {
  compileChannelBindings,
  compileChannelsConfig,
} from "./channel-binding-compiler.js";
import {
  buildProviderRuntimeModelId,
  buildProviderRuntimeModelRef,
  findProviderDescriptorForModelRef,
  listModelProviderRuntimeDescriptors,
  resolveModelProviderApiKey,
} from "./model-provider-runtime.js";

export type { OAuthConnectionState };

const EMPTY_OAUTH_CONNECTION_STATE: OAuthConnectionState = {
  connectedProviderIds: [],
};

const OAUTH_PROVIDER_MAP: Record<string, string> = {
  openai: "openai-codex",
};

function getDesktopSelectedModel(config: NexuConfig): string | null {
  const selectedModelId = config.desktop.selectedModelId;
  return typeof selectedModelId === "string" && selectedModelId.length > 0
    ? selectedModelId
    : null;
}

function buildModelEntry(id: string, name?: string) {
  return {
    id,
    name: name ?? id,
    reasoning: false,
    input: ["text", "image"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 200000,
    maxTokens: 8192,
    compat: {
      supportsStore: false,
    },
  };
}

function collectLitellmModelIds(config: NexuConfig): string[] {
  const selectedModelId = getDesktopSelectedModel(config);
  const candidateIds = [
    ...config.bots.map((bot) => bot.modelId),
    config.runtime.defaultModelId,
    selectedModelId,
  ];

  return [...new Set(candidateIds)]
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    .map((value) => value.replace(/^litellm\//, ""))
    .filter(
      (value) => !value.startsWith("link/") && !value.startsWith("debug/"),
    );
}

function compileModelsConfig(
  config: NexuConfig,
  env: ControllerEnv,
): OpenClawConfig["models"] {
  const providers: NonNullable<OpenClawConfig["models"]>["providers"] = {};

  if (env.litellmBaseUrl && env.litellmApiKey) {
    providers.litellm = {
      baseUrl: env.litellmBaseUrl,
      apiKey: env.litellmApiKey,
      api: "openai-completions",
      models: collectLitellmModelIds(config).map((modelId) =>
        buildModelEntry(modelId),
      ),
    };
  }

  for (const descriptor of listModelProviderRuntimeDescriptors(config)) {
    if (!descriptor.provider.enabled) {
      continue;
    }

    const apiKey = resolveModelProviderApiKey(descriptor);
    if (apiKey === null && descriptor.provider.auth !== "oauth") {
      continue;
    }

    // Keep apiKey when it's a non-empty string or a secret-ref object; only
    // drop it when null/undefined or an empty string. Emitting apiKey:""
    // caused OpenClaw to reject the provider (and caused relogin to fail
    // with "Unknown model: link/...").
    const hasUsableApiKey =
      apiKey !== null && !(typeof apiKey === "string" && apiKey.length === 0);
    providers[descriptor.runtimeKey] = {
      baseUrl: descriptor.provider.baseUrl,
      ...(hasUsableApiKey ? { apiKey } : {}),
      api: descriptor.apiKind,
      ...(descriptor.authHeader ? { authHeader: true } : {}),
      ...(descriptor.defaultHeaders
        ? { headers: descriptor.defaultHeaders }
        : {}),
      models: descriptor.provider.models.map((model) =>
        buildModelEntry(
          buildProviderRuntimeModelId(descriptor, model.id),
          model.name,
        ),
      ),
    };
  }

  return Object.keys(providers).length > 0
    ? {
        mode: "merge",
        providers,
      }
    : undefined;
}

export function resolveModelId(
  config: NexuConfig,
  env: ControllerEnv,
  rawModelId: string,
  oauthState: OAuthConnectionState = EMPTY_OAUTH_CONNECTION_STATE,
): string {
  if (rawModelId.startsWith("litellm/") || rawModelId.startsWith("link/")) {
    return rawModelId;
  }

  const descriptors = listModelProviderRuntimeDescriptors(config).filter(
    (descriptor) => descriptor.provider.enabled,
  );
  const matchedDescriptor = findProviderDescriptorForModelRef(
    descriptors,
    rawModelId,
  );

  if (matchedDescriptor) {
    const oauthTarget =
      OAUTH_PROVIDER_MAP[matchedDescriptor.descriptor.providerId];
    if (
      oauthTarget &&
      oauthState.connectedProviderIds.includes(
        matchedDescriptor.descriptor.providerId,
      )
    ) {
      return `${oauthTarget}/${matchedDescriptor.modelId}`;
    }

    return buildProviderRuntimeModelRef(
      matchedDescriptor.descriptor,
      matchedDescriptor.modelId,
    );
  }

  if (env.litellmBaseUrl && env.litellmApiKey) {
    return `litellm/${rawModelId}`;
  }

  return rawModelId;
}

function compileAgentList(
  config: NexuConfig,
  env: ControllerEnv,
  oauthState: OAuthConnectionState,
  _installedSkillSlugs?: readonly string[],
  _workspaceSkillsByAgent?: ReadonlyMap<string, readonly string[]>,
): OpenClawConfig["agents"]["list"] {
  return config.bots
    .filter((bot) => bot.status === "active")
    .sort((left, right) => left.slug.localeCompare(right.slug))
    .map((bot, index) => {
      return {
        id: bot.id,
        name: bot.name,
        workspace: `${env.openclawStateDir}/agents/${bot.id}`,
        default: index === 0,
        model: bot.modelId
          ? { primary: resolveModelId(config, env, bot.modelId, oauthState) }
          : undefined,
        skills: [],
      };
    });
}
function compilePlugins(
  config: NexuConfig,
  env: ControllerEnv,
): OpenClawConfig["plugins"] {
  const minimaxOauth = listModelProviderRuntimeDescriptors(config).some(
    (descriptor) =>
      descriptor.providerId === "minimax" &&
      descriptor.provider.enabled &&
      descriptor.provider.auth === "oauth" &&
      descriptor.legacyOauthCredential !== null,
  );
  return {
    load: { paths: [env.openclawExtensionsDir] },
    allow: [
      "openclaw-weixin",
      "nexu-runtime-model",
      ...(minimaxOauth ? ["minimax-portal-auth"] : []),
    ],
    entries: {
      "openclaw-weixin": { enabled: true },
      "nexu-runtime-model": { enabled: true },
      ...(minimaxOauth ? { "minimax-portal-auth": { enabled: true } } : {}),
    },
  };
}

export function compileOpenClawConfig(
  config: NexuConfig,
  env: ControllerEnv,
  oauthState: OAuthConnectionState = EMPTY_OAUTH_CONNECTION_STATE,
  _installedSkillSlugs?: readonly string[],
  _workspaceSkillsByAgent?: ReadonlyMap<string, readonly string[]>,
): OpenClawConfig {
  const disableMdnsDiscovery = process.env.CI === "true";
  const activeBots = config.bots.filter((bot) => bot.status === "active");
  const firstBotModel = activeBots[0]?.modelId ?? null;
  const defaultModelId = resolveModelId(
    config,
    env,
    firstBotModel ??
      getDesktopSelectedModel(config) ??
      config.runtime.defaultModelId,
    oauthState,
  );

  const openClawConfig: OpenClawConfig = {
    ...(disableMdnsDiscovery
      ? {
          discovery: {
            mdns: {
              mode: "off",
            },
          },
        }
      : {}),
    gateway: {
      port: env.openclawGatewayPort,
      mode: "local",
      bind: config.runtime.gateway.bind,
      auth: {
        mode: config.runtime.gateway.authMode,
        ...(env.openclawGatewayToken
          ? { token: env.openclawGatewayToken }
          : {}),
      },
      reload: {
        mode: "hybrid",
      },
      controlUi: {
        allowedOrigins: [env.webUrl],
        dangerouslyAllowHostHeaderOriginFallback: true,
      },
      http: {
        endpoints: {
          chatCompletions: {
            enabled: true,
          },
        },
      },
      tools: { allow: [], deny: ["*"] },
    },
    agents: {
      defaults: {
        model: { primary: defaultModelId },
        compaction: {
          // "safeguard" mode: Pi framework auto-compacts when prompt
          // approaches context window. The safeguard extension (compaction-
          // safeguard.ts) handles LLM summarization with quality guards.
          mode: "safeguard",
          // Max fraction of context window for retained history after
          // compaction. 0.3 = 70% reserved for system prompt + response.
          // Tested: 0.5 was too tight for models with large system prompts.
          maxHistoryShare: 0.3,
          keepRecentTokens: 20000,
          recentTurnsPreserve: 5,
          qualityGuard: { enabled: true },
          memoryFlush: {
            enabled: false,
          },
        },
        // LLM call timeout. Default is 600s (10min) which causes the bot to
        // appear unresponsive when the provider is down. 300s (5min) leaves
        // room for reasoning models (o1/o3 long thinking chains) while
        // cutting max wait time in half. Aligns with compaction's own 300s
        // safety timeout (EMBEDDED_COMPACTION_TIMEOUT_MS).
        timeoutSeconds: 300,
        humanDelay: {
          mode: "off",
        },
        verboseDefault: "off",
        memorySearch: { enabled: false },
        heartbeat: { every: "0m" },
      },
      list: compileAgentList(
        config,
        env,
        oauthState,
        _installedSkillSlugs,
        _workspaceSkillsByAgent,
      ),
    },
    tools: {
      deny: ["*"],
      exec: { security: "deny", ask: "always", host: "gateway" },
      web: { search: { enabled: false }, fetch: { enabled: false } },
    },
    session: {
      dmScope: "per-peer",
      // Disable automatic session reset. OpenClaw defaults to daily reset at
      // 4 AM which silently drops conversation history — unexpected for a
      // desktop chat app where users expect persistent sessions.
      reset: {
        mode: "idle",
        idleMinutes: 525_600, // 1 year
      },
    },
    cron: {
      enabled: false,
    },
    messages: {
      ackReaction: "eyes",
      ackReactionScope: "group-mentions",
      removeAckAfterReply: true,
    },
    models: compileModelsConfig(config, env),
    channels: compileChannelsConfig({
      channels: config.channels.filter(
        (channel) => channel.channelType === "wechat",
      ),
      secrets: config.secrets,
      gatewayBaseUrl: `http://127.0.0.1:${env.openclawGatewayPort}`,
      gatewayToken: env.openclawGatewayToken,
    }),
    bindings: compileChannelBindings(
      config.bots,
      config.channels.filter((channel) => channel.channelType === "wechat"),
    ),
    plugins: compilePlugins(config, env),
    skills: { load: { watch: false, extraDirs: [] } },
    commands: {
      native: false,
      nativeSkills: false,
      restart: false,
      ownerDisplay: "raw",
      ownerAllowFrom: ["*"],
    },
    diagnostics: { enabled: false },
  };

  return openclawConfigSchema.parse(openClawConfig);
}
