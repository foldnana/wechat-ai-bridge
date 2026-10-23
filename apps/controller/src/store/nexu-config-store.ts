import crypto from "node:crypto";
import path from "node:path";
import type {
  BotResponse,
  ChannelResponse,
  ModelProviderConfig,
  PersistedModelsConfig,
} from "@nexu/shared";
import {
  getDefaultProviderBaseUrls,
  getProviderRuntimePolicy,
  parseCustomProviderKey,
  restoreModelProviderApiKeys,
  type updateAuthSourceSchema,
  type updateUserProfileSchema,
  type upsertProviderBodySchema,
  userProfileResponseSchema,
} from "@nexu/shared";
import type { z } from "zod";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import { LowDbStore } from "./lowdb-store.js";
import {
  CANONICAL_MODELS_PROVIDERS_CUTOVER_SCHEMA_VERSION,
  type ControllerRuntimeConfig,
  type NexuConfig,
  nexuConfigSchema,
  type storedProviderResponseSchema,
} from "./schemas.js";

type UpsertProviderBody = z.infer<typeof upsertProviderBodySchema>;
export class ProviderConfigConflictError extends Error {
  constructor() {
    super("Provider configuration changed");
  }
}
type StoredProviderResponse = z.infer<typeof storedProviderResponseSchema>;
type UserProfileResponse = z.infer<typeof userProfileResponseSchema>;
type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
type UpdateAuthSourceInput = z.infer<typeof updateAuthSourceSchema>;

export type DesktopCloudStateChange = {
  hadCloudInventory: boolean;
  hasCloudInventory: boolean;
  connected: boolean;
};

function defaultLocalProfile(): UserProfileResponse {
  return {
    id: "desktop-local-user",
    email: "desktop@nexu.local",
    name: "Desktop User",
    image: null,
    plan: "local",
    inviteAccepted: true,
    onboardingCompleted: true,
    authSource: "desktop-local",
  };
}

function readLocalProfile(config: NexuConfig): UserProfileResponse {
  const desktop = config.desktop as Record<string, unknown>;
  const parsed = userProfileResponseSchema.safeParse(desktop.localProfile);
  return parsed.success ? parsed.data : defaultLocalProfile();
}

function readDesktopLocale(config: NexuConfig): "en" | "zh-CN" | null {
  const desktop = config.desktop as Record<string, unknown>;
  if (desktop.locale === "zh-CN") {
    return "zh-CN";
  }
  if (desktop.locale === "en") {
    return "en";
  }
  return null;
}

function now(): string {
  return new Date().toISOString();
}

function parseModelsJson(modelsJson: string | undefined): string[] {
  if (!modelsJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(modelsJson) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function getProviderMetadata(
  provider: ModelProviderConfig | undefined,
): Record<string, unknown> | null {
  if (!provider) {
    return null;
  }
  return typeof provider.metadata === "object" && provider.metadata !== null
    ? provider.metadata
    : null;
}

function getLegacyProviderField(
  provider: ModelProviderConfig,
  key: string,
): string | null {
  const metadata = getProviderMetadata(provider);
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getLegacyOauthCredential(provider: ModelProviderConfig): {
  provider: string;
  access: string;
  refresh?: string;
  expires?: number;
  email?: string;
} | null {
  const metadata = getProviderMetadata(provider);
  const value = metadata?.legacyOauthCredential;
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const credential = value as Record<string, unknown>;
  if (
    typeof credential.provider !== "string" ||
    typeof credential.access !== "string"
  ) {
    return null;
  }

  return {
    provider: credential.provider,
    access: credential.access,
    ...(typeof credential.refresh === "string"
      ? { refresh: credential.refresh }
      : {}),
    ...(typeof credential.expires === "number"
      ? { expires: credential.expires }
      : {}),
    ...(typeof credential.email === "string"
      ? { email: credential.email }
      : {}),
  };
}

function serializeProvider(
  providerId: string,
  provider: ModelProviderConfig,
): StoredProviderResponse {
  const oauthCredential = getLegacyOauthCredential(provider);
  const modelIds = provider.models.map((model) => model.id);
  return {
    id: getLegacyProviderField(provider, "legacyId") ?? providerId,
    providerId,
    displayName: provider.displayName ?? null,
    enabled: provider.enabled,
    baseUrl: provider.baseUrl ?? null,
    authMode: provider.auth === "oauth" ? "oauth" : "apiKey",
    hasApiKey:
      typeof provider.apiKey === "string" && provider.apiKey.length > 0,
    hasOauthCredential: oauthCredential !== null,
    oauthRegion: provider.oauthRegion ?? null,
    oauthEmail: oauthCredential?.email ?? null,
    modelsJson: JSON.stringify(modelIds),
    createdAt: getLegacyProviderField(provider, "legacyCreatedAt") ?? undefined,
    updatedAt: getLegacyProviderField(provider, "legacyUpdatedAt") ?? undefined,
    apiKey: typeof provider.apiKey === "string" ? provider.apiKey : null,
    models: modelIds,
  };
}

function listCanonicalProviders(config: NexuConfig): StoredProviderResponse[] {
  return Object.entries(config.models.providers).map(([providerId, provider]) =>
    serializeProvider(providerId, provider),
  );
}

function buildProviderBaseUrl(
  providerId: string,
  baseUrl: string | null | undefined,
  oauthRegion: "global" | "cn" | null | undefined,
): string {
  if (typeof baseUrl === "string" && baseUrl.trim().length > 0) {
    return baseUrl;
  }
  if (providerId === "minimax" && oauthRegion === "cn") {
    return "https://api.minimaxi.com/anthropic";
  }
  return (
    getDefaultProviderBaseUrls(providerId)[0] ?? "https://api.openai.com/v1"
  );
}

function buildProviderConfig(
  providerKey: string,
  input: UpsertProviderBody,
  currentTime: string,
  existing?: ModelProviderConfig,
): ModelProviderConfig {
  const customProvider = parseCustomProviderKey(providerKey);
  const providerId = customProvider?.templateId ?? providerKey;
  const runtimePolicy = getProviderRuntimePolicy(providerId);
  const existingMetadata = getProviderMetadata(existing) ?? {};
  const authMode =
    input.authMode ?? (existing?.auth === "oauth" ? "oauth" : "apiKey");
  const nextModels =
    input.modelsJson === undefined
      ? (existing?.models ?? [])
      : parseModelsJson(input.modelsJson).map((modelId) => ({
          id: modelId,
          name: modelId,
          reasoning: false,
          input: ["text"] as Array<"text" | "image">,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
          },
          contextWindow: 0,
          maxTokens: 0,
          ...(runtimePolicy?.apiKind ? { api: runtimePolicy.apiKind } : {}),
        }));
  const nextOauthRegion =
    authMode === "apiKey" ? null : (existing?.oauthRegion ?? null);
  const nextMetadata: Record<string, unknown> = {
    ...existingMetadata,
    legacyId:
      (typeof existingMetadata.legacyId === "string" &&
        existingMetadata.legacyId) ||
      crypto.randomUUID(),
    legacyCreatedAt:
      (typeof existingMetadata.legacyCreatedAt === "string" &&
        existingMetadata.legacyCreatedAt) ||
      currentTime,
    legacyUpdatedAt: currentTime,
  };

  return {
    ...(customProvider
      ? {
          providerTemplateId: customProvider.templateId,
          instanceId: customProvider.instanceId,
        }
      : {}),
    enabled: input.enabled ?? existing?.enabled ?? true,
    ...((input.displayName ?? existing?.displayName)
      ? { displayName: input.displayName ?? existing?.displayName }
      : {}),
    baseUrl: buildProviderBaseUrl(
      providerId,
      input.baseUrl === undefined ? existing?.baseUrl : input.baseUrl,
      nextOauthRegion,
    ),
    ...(authMode === "oauth"
      ? {
          auth: "oauth" as const,
          ...(existing?.oauthProfileRef
            ? { oauthProfileRef: existing.oauthProfileRef }
            : {}),
        }
      : { auth: "api-key" as const }),
    ...(runtimePolicy?.apiKind ? { api: runtimePolicy.apiKind } : {}),
    ...(authMode === "apiKey"
      ? {
          apiKey:
            input.apiKey === undefined
              ? existing?.apiKey
              : (input.apiKey ?? undefined),
        }
      : {}),
    ...(nextOauthRegion ? { oauthRegion: nextOauthRegion } : {}),
    models: nextModels,
    metadata:
      authMode === "apiKey"
        ? Object.fromEntries(
            Object.entries(nextMetadata).filter(
              ([key]) => key !== "legacyOauthCredential",
            ),
          )
        : nextMetadata,
  };
}

export class NexuConfigStore {
  private readonly store: LowDbStore<NexuConfig>;

  constructor(private readonly env: ControllerEnv) {
    this.store = new LowDbStore<NexuConfig>(
      env.nexuConfigPath,
      nexuConfigSchema,
      () => ({
        $schema: "https://nexu.io/config.json",
        schemaVersion: CANONICAL_MODELS_PROVIDERS_CUTOVER_SCHEMA_VERSION,
        app: {},
        bots: [],
        runtime: {
          gateway: {
            port: env.openclawGatewayPort,
            bind: "loopback",
            authMode: env.openclawGatewayToken ? "token" : "none",
          },
          defaultModelId: env.defaultModelId,
        },
        models: {
          mode: "merge",
          providers: {},
        },
        integrations: [],
        channels: [],
        templates: {},
        desktop: {
          analyticsEnabled: false,
        },
        secrets: {},
      }),
    );
  }

  async getConfig(): Promise<NexuConfig> {
    return this.store.read();
  }

  async listBots(): Promise<BotResponse[]> {
    const config = await this.getConfig();
    return config.bots;
  }

  async getBot(botId: string): Promise<BotResponse | null> {
    const config = await this.getConfig();
    return config.bots.find((bot) => bot.id === botId) ?? null;
  }

  async getOrCreateDefaultBot(): Promise<BotResponse> {
    const existing = await this.listBots();
    if (existing.length > 0) {
      const firstBot = existing[0];
      if (firstBot) {
        logger.info(
          {
            botId: firstBot.id,
            slug: firstBot.slug,
            workspacePath: path.join(
              this.env.openclawStateDir,
              "agents",
              firstBot.id,
            ),
            existingBotCount: existing.length,
            resolution: "reused_existing",
          },
          "default_bot_resolution",
        );
        return firstBot;
      }
    }

    const config = await this.getConfig();
    const bot = await this.createBot({
      name: "微信 AI",
      slug: "nexu-assistant",
      modelId: config.runtime.defaultModelId,
    });
    logger.info(
      {
        botId: bot.id,
        slug: bot.slug,
        workspacePath: path.join(this.env.openclawStateDir, "agents", bot.id),
        existingBotCount: existing.length,
        resolution: "created_implicit_default",
      },
      "default_bot_resolution",
    );
    return bot;
  }

  async createBot(input: {
    name: string;
    slug: string;
    systemPrompt?: string;
    modelId?: string;
    poolId?: string;
  }): Promise<BotResponse> {
    const createdAt = now();
    const bot: BotResponse = {
      id: crypto.randomUUID(),
      name: input.name,
      slug: input.slug,
      poolId: input.poolId ?? null,
      status: "active",
      modelId: input.modelId ?? (await this.getConfig()).runtime.defaultModelId,
      systemPrompt: input.systemPrompt ?? null,
      createdAt,
      updatedAt: createdAt,
    };

    await this.store.update((config) => ({
      ...config,
      bots: [...config.bots, bot],
    }));

    logger.info(
      {
        botId: bot.id,
        slug: bot.slug,
        workspacePath: path.join(this.env.openclawStateDir, "agents", bot.id),
        createdVia: "nexu_config_store.createBot",
      },
      "bot_created",
    );

    return bot;
  }

  async updateBot(
    botId: string,
    input: {
      name?: string;
      systemPrompt?: string;
      modelId?: string;
    },
  ): Promise<BotResponse | null> {
    let updatedBot: BotResponse | null = null;

    await this.store.update((config) => ({
      ...config,
      bots: config.bots.map((bot) => {
        if (bot.id !== botId) {
          return bot;
        }

        updatedBot = {
          ...bot,
          name: input.name ?? bot.name,
          systemPrompt: input.systemPrompt ?? bot.systemPrompt,
          modelId: input.modelId ?? bot.modelId,
          updatedAt: now(),
        };
        return updatedBot;
      }),
    }));

    return updatedBot;
  }

  async setBotStatus(
    botId: string,
    status: BotResponse["status"],
  ): Promise<BotResponse | null> {
    let updatedBot: BotResponse | null = null;

    await this.store.update((config) => ({
      ...config,
      bots: config.bots.map((bot) => {
        if (bot.id !== botId) {
          return bot;
        }

        updatedBot = {
          ...bot,
          status,
          updatedAt: now(),
        };
        return updatedBot;
      }),
    }));

    return updatedBot;
  }

  async deleteBot(botId: string): Promise<boolean> {
    let deleted = false;

    await this.store.update((config) => {
      const bots = config.bots.filter((bot) => {
        if (bot.id === botId) {
          deleted = true;
          return false;
        }

        return true;
      });

      return {
        ...config,
        bots,
        channels: config.channels.filter((channel) => channel.botId !== botId),
      };
    });

    return deleted;
  }

  async listChannels(): Promise<ChannelResponse[]> {
    const config = await this.getConfig();
    return config.channels.filter(
      (channel) => channel.channelType === "wechat",
    );
  }

  async getSecret(key: string): Promise<string | null> {
    const config = await this.getConfig();
    return config.secrets[key] ?? null;
  }

  async setSecret(key: string, value: string): Promise<void> {
    await this.store.update((config) => ({
      ...config,
      secrets: {
        ...config.secrets,
        [key]: value,
      },
    }));
  }

  async deleteSecretsByPrefix(prefix: string): Promise<void> {
    await this.store.update((config) => ({
      ...config,
      secrets: Object.fromEntries(
        Object.entries(config.secrets).filter(
          ([key]) => !key.startsWith(prefix),
        ),
      ),
    }));
  }

  async getChannel(channelId: string): Promise<ChannelResponse | null> {
    const config = await this.getConfig();
    return config.channels.find((channel) => channel.id === channelId) ?? null;
  }

  async connectWechat(input: { accountId: string }): Promise<ChannelResponse> {
    const bot = await this.getOrCreateDefaultBot();
    const connectedAt = now();
    const channel: ChannelResponse = {
      id: crypto.randomUUID(),
      botId: bot.id,
      channelType: "wechat",
      accountId: input.accountId,
      status: "connected",
      teamName: null,
      appId: null,
      botUserId: null,
      createdAt: connectedAt,
      updatedAt: connectedAt,
    };

    await this.store.update((config) => ({
      ...config,
      channels: [
        ...config.channels.filter(
          (existing) =>
            !(
              existing.channelType === channel.channelType &&
              existing.accountId === channel.accountId
            ),
        ),
        channel,
      ],
    }));

    return channel;
  }

  async disconnectChannel(channelId: string): Promise<boolean> {
    let disconnectedChannel: ChannelResponse | null = null;

    await this.store.update((config) => ({
      ...config,
      channels: config.channels.flatMap((channel) => {
        if (channel.id === channelId) {
          disconnectedChannel = channel;
          if (channel.channelType === "feishu") {
            return [
              {
                ...channel,
                status: "disconnected",
                updatedAt: new Date().toISOString(),
              },
            ];
          }

          return [];
        }

        return [channel];
      }),
      secrets:
        disconnectedChannel === null ||
        disconnectedChannel.channelType === "feishu"
          ? config.secrets
          : Object.fromEntries(
              Object.entries(config.secrets).filter(
                ([key]) => !key.startsWith(`channel:${channelId}:`),
              ),
            ),
    }));

    return disconnectedChannel !== null;
  }

  async listProviders(): Promise<StoredProviderResponse[]> {
    const config = await this.getConfig();
    return listCanonicalProviders(config);
  }

  async getProvider(
    providerId: string,
  ): Promise<StoredProviderResponse | null> {
    const config = await this.getConfig();
    const provider =
      listCanonicalProviders(config).find(
        (item) => item.providerId === providerId,
      ) ?? null;
    return provider;
  }

  async upsertProvider(
    providerId: string,
    input: UpsertProviderBody,
  ): Promise<{ provider: StoredProviderResponse; created: boolean }> {
    const currentTime = now();
    let result: ModelProviderConfig | null = null;
    let created = false;

    await this.store.update((config) => {
      const existing = config.models.providers[providerId];
      const nextProvider = buildProviderConfig(
        providerId,
        input,
        currentTime,
        existing,
      );

      created = existing === undefined;
      result = nextProvider;

      return {
        ...config,
        schemaVersion: Math.max(
          config.schemaVersion,
          CANONICAL_MODELS_PROVIDERS_CUTOVER_SCHEMA_VERSION,
        ),
        models: {
          ...config.models,
          providers: {
            ...config.models.providers,
            [providerId]: nextProvider,
          },
        },
      };
    });

    if (result === null) {
      throw new Error(`Failed to upsert provider ${providerId}`);
    }

    return {
      provider: serializeProvider(providerId, result),
      created,
    };
  }

  async setProviderOauthCredentials(
    providerId: string,
    input: {
      displayName?: string;
      enabled?: boolean;
      baseUrl?: string | null;
      models: string[];
      oauthRegion: "global" | "cn";
      oauthCredential: {
        provider: string;
        access: string;
        refresh?: string;
        expires?: number;
        email?: string;
      };
    },
  ): Promise<StoredProviderResponse> {
    const currentTime = now();
    let result: ModelProviderConfig | null = null;

    await this.store.update((config) => {
      const existing = config.models.providers[providerId];
      const existingMetadata = getProviderMetadata(existing) ?? {};
      const nextProvider: ModelProviderConfig = {
        ...(existing?.providerTemplateId
          ? {
              providerTemplateId: existing.providerTemplateId,
              instanceId: existing.instanceId,
            }
          : {}),
        enabled: input.enabled ?? existing?.enabled ?? true,
        displayName: input.displayName ?? existing?.displayName ?? providerId,
        baseUrl: buildProviderBaseUrl(
          providerId,
          input.baseUrl === undefined ? existing?.baseUrl : input.baseUrl,
          input.oauthRegion,
        ),
        auth: "oauth",
        ...(existing?.api ? { api: existing.api } : {}),
        oauthRegion: input.oauthRegion,
        oauthProfileRef: input.oauthCredential.provider,
        models: input.models.map((modelId) => ({
          id: modelId,
          name: modelId,
          reasoning: false,
          input: ["text"] as Array<"text" | "image">,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 0,
          maxTokens: 0,
          ...(existing?.api ? { api: existing.api } : {}),
        })),
        metadata: {
          ...existingMetadata,
          legacyId:
            (typeof existingMetadata.legacyId === "string" &&
              existingMetadata.legacyId) ||
            crypto.randomUUID(),
          legacyCreatedAt:
            (typeof existingMetadata.legacyCreatedAt === "string" &&
              existingMetadata.legacyCreatedAt) ||
            currentTime,
          legacyUpdatedAt: currentTime,
          legacyOauthCredential: input.oauthCredential,
        },
      };

      result = nextProvider;

      return {
        ...config,
        schemaVersion: Math.max(
          config.schemaVersion,
          CANONICAL_MODELS_PROVIDERS_CUTOVER_SCHEMA_VERSION,
        ),
        models: {
          ...config.models,
          providers: {
            ...config.models.providers,
            [providerId]: nextProvider,
          },
        },
      };
    });

    if (result === null) {
      throw new Error(`Failed to set oauth provider ${providerId}`);
    }

    return serializeProvider(providerId, result);
  }

  async deleteProvider(providerId: string): Promise<boolean> {
    let deleted = false;

    await this.store.update((config) => {
      for (const provider of listCanonicalProviders(config)) {
        if (provider.providerId === providerId) {
          deleted = true;
        }
      }

      const nextCanonicalProviders = {
        ...config.models.providers,
      };
      delete nextCanonicalProviders[providerId];

      return {
        ...config,
        schemaVersion: Math.max(
          config.schemaVersion,
          CANONICAL_MODELS_PROVIDERS_CUTOVER_SCHEMA_VERSION,
        ),
        models: {
          ...config.models,
          providers: nextCanonicalProviders,
        },
      };
    });

    return deleted;
  }

  async getLocalProfile(): Promise<UserProfileResponse> {
    const config = await this.getConfig();
    return readLocalProfile(config);
  }

  async updateLocalProfile(
    input: UpdateUserProfileInput,
  ): Promise<UserProfileResponse> {
    let nextProfile = defaultLocalProfile();

    await this.store.update((config) => {
      const currentProfile = readLocalProfile(config);
      nextProfile = {
        ...currentProfile,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.image !== undefined ? { image: input.image } : {}),
      };

      return {
        ...config,
        desktop: {
          ...config.desktop,
          localProfile: nextProfile,
        },
      };
    });

    return nextProfile;
  }

  async updateLocalAuthSource(
    input: UpdateAuthSourceInput,
  ): Promise<UserProfileResponse> {
    let nextProfile = defaultLocalProfile();

    await this.store.update((config) => {
      const currentProfile = readLocalProfile(config);
      nextProfile = {
        ...currentProfile,
        authSource: input.source,
      };

      return {
        ...config,
        desktop: {
          ...config.desktop,
          localProfile: nextProfile,
        },
      };
    });

    return nextProfile;
  }

  async getStoredDesktopLocale(): Promise<"en" | "zh-CN" | null> {
    const config = await this.getConfig();
    return readDesktopLocale(config);
  }

  async getDesktopLocale(): Promise<"en" | "zh-CN"> {
    return (await this.getStoredDesktopLocale()) ?? "en";
  }

  async setDesktopLocale(locale: "en" | "zh-CN"): Promise<"en" | "zh-CN"> {
    await this.store.update((config) => ({
      ...config,
      desktop: {
        ...config.desktop,
        locale,
      },
    }));

    return locale;
  }

  async getStoredDesktopAnalyticsEnabled(): Promise<boolean | null> {
    const config = await this.getConfig();
    return typeof config.desktop.analyticsEnabled === "boolean"
      ? config.desktop.analyticsEnabled
      : null;
  }
  async getDesktopAnalyticsEnabled(): Promise<boolean> {
    return false;
  }
  async setDesktopAnalyticsEnabled(_enabled: boolean): Promise<boolean> {
    return false;
  }

  async setDefaultModel(modelId: string): Promise<void> {
    await this.store.update((config) => ({
      ...config,
      runtime: {
        ...config.runtime,
        defaultModelId: modelId,
      },
      bots: config.bots.map((bot) => ({
        ...bot,
        modelId,
        updatedAt: now(),
      })),
    }));
  }

  async getRuntimeConfig(): Promise<ControllerRuntimeConfig> {
    const config = await this.getConfig();
    return config.runtime;
  }

  async setRuntimeConfig(
    runtime: ControllerRuntimeConfig,
  ): Promise<ControllerRuntimeConfig> {
    await this.store.update((config) => ({
      ...config,
      runtime,
    }));

    return runtime;
  }

  async getModelProviderConfigDocument(): Promise<PersistedModelsConfig> {
    const config = await this.getConfig();
    return config.models;
  }

  async saveProviderAndSelectModel(
    providerKey: string,
    provider: ModelProviderConfig,
    modelId: string,
    expectedProvider?: ModelProviderConfig,
  ): Promise<void> {
    await this.store.update((config) => {
      if (
        expectedProvider &&
        JSON.stringify(config.models.providers[providerKey]) !==
          JSON.stringify(expectedProvider)
      ) {
        throw new ProviderConfigConflictError();
      }
      return {
        ...config,
        schemaVersion: Math.max(
          config.schemaVersion,
          CANONICAL_MODELS_PROVIDERS_CUTOVER_SCHEMA_VERSION,
        ),
        models: {
          ...config.models,
          providers: { ...config.models.providers, [providerKey]: provider },
        },
        runtime: { ...config.runtime, defaultModelId: modelId },
        bots: config.bots.map((bot) => ({ ...bot, modelId, updatedAt: now() })),
      };
    });
  }

  async setModelProviderConfigDocument(
    models: PersistedModelsConfig,
  ): Promise<PersistedModelsConfig> {
    await this.store.update((config) => ({
      ...config,
      schemaVersion: Math.max(
        config.schemaVersion,
        CANONICAL_MODELS_PROVIDERS_CUTOVER_SCHEMA_VERSION,
      ),
      models: restoreModelProviderApiKeys(models, config.models),
    }));

    return (await this.getConfig()).models;
  }

  async syncManagedRuntimeGateway(input: {
    port: number;
    authMode: ControllerRuntimeConfig["gateway"]["authMode"];
  }): Promise<void> {
    await this.store.update((config) => {
      if (
        config.runtime.gateway.port === input.port &&
        config.runtime.gateway.authMode === input.authMode
      ) {
        return config;
      }

      return {
        ...config,
        runtime: {
          ...config.runtime,
          gateway: {
            ...config.runtime.gateway,
            port: input.port,
            authMode: input.authMode,
          },
        },
      };
    });
  }

  async listTemplates() {
    const config = await this.getConfig();
    return Object.values(config.templates);
  }

  async upsertTemplate(input: {
    name: string;
    content: string;
    writeMode?: "seed" | "inject";
    status?: "active" | "inactive";
  }) {
    const existing = (await this.getConfig()).templates[input.name];
    const timestamp = now();
    const template = {
      id: existing?.id ?? crypto.randomUUID(),
      name: input.name,
      content: input.content,
      writeMode: input.writeMode ?? existing?.writeMode ?? "seed",
      status: input.status ?? existing?.status ?? "active",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    await this.store.update((config) => ({
      ...config,
      templates: {
        ...config.templates,
        [input.name]: template,
      },
    }));

    return template;
  }

  async getRuntimeTemplatesSnapshot(): Promise<{
    version: number;
    templatesHash: string;
    templates: Record<
      string,
      { content: string; writeMode: "seed" | "inject" }
    >;
    createdAt: string;
  }> {
    const templates = (await this.listTemplates()).filter(
      (template) => template.status === "active",
    );
    const payload = Object.fromEntries(
      templates.map((template) => [
        template.name,
        {
          content: template.content,
          writeMode: template.writeMode,
        },
      ]),
    );
    const createdAt = now();
    return {
      version: templates.length,
      templatesHash: crypto
        .createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex"),
      templates: payload,
      createdAt,
    };
  }
}
