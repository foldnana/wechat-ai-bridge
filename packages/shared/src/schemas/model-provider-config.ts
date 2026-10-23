import { z } from "zod";

/** Public config placeholder: round-trip to retain this provider's local key. */
export const SAVED_PROVIDER_API_KEY = "__BRIDGE_SAVED_API_KEY__";

export function redactModelProviderApiKeys(
  config: PersistedModelsConfig,
): PersistedModelsConfig {
  return {
    ...config,
    providers: Object.fromEntries(
      Object.entries(config.providers).map(([id, provider]) => [
        id,
        {
          ...provider,
          ...(provider.apiKey ? { apiKey: SAVED_PROVIDER_API_KEY } : {}),
        },
      ]),
    ),
  };
}

export class SavedProviderApiKeyError extends Error {
  constructor() {
    super("已保存的密钥不可用于新的连接地址，请重新填写 API Key。");
  }
}

export function restoreModelProviderApiKeys(
  incoming: PersistedModelsConfig,
  stored: PersistedModelsConfig,
): PersistedModelsConfig {
  return {
    ...incoming,
    providers: Object.fromEntries(
      Object.entries(incoming.providers).map(([id, provider]) => {
        if (provider.apiKey !== SAVED_PROVIDER_API_KEY) return [id, provider];
        const existing = stored.providers[id];
        if (
          !existing?.apiKey ||
          existing.apiKey === SAVED_PROVIDER_API_KEY ||
          existing.baseUrl !== provider.baseUrl
        ) {
          throw new SavedProviderApiKeyError();
        }
        return [id, { ...provider, apiKey: existing.apiKey }];
      }),
    ),
  };
}

export const persistedProviderAuthModeSchema = z.enum([
  "api-key",
  "aws-sdk",
  "oauth",
  "token",
]);

export const modelApiSchema = z.enum([
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "anthropic-messages",
  "google-generative-ai",
  "github-copilot",
  "bedrock-converse-stream",
  "ollama",
]);

export const providerOauthRegionSchema = z.enum(["global", "cn"]);

export const providerSecretRefSchema = z.object({
  source: z.enum(["env", "file", "exec"]),
  provider: z.string().min(1),
  id: z.string().min(1),
});

export const providerSecretInputSchema = z.union([
  z.string().min(1),
  providerSecretRefSchema,
]);

export const modelProviderModelInputSchema = z.enum(["text", "image"]);

export const modelProviderModelCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
});

export const modelProviderModelEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  api: modelApiSchema.optional(),
  reasoning: z.boolean().default(false),
  input: z.array(modelProviderModelInputSchema).default(["text"]),
  cost: modelProviderModelCostSchema.default({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  }),
  contextWindow: z.number().default(0),
  maxTokens: z.number().default(0),
  headers: z.record(z.string(), z.string()).optional(),
  compat: z.record(z.string(), z.unknown()).optional(),
});

export const modelProviderConfigSchema = z
  .object({
    providerTemplateId: z.string().min(1).optional(),
    instanceId: z.string().min(1).optional(),
    enabled: z.boolean().default(true),
    auth: persistedProviderAuthModeSchema.optional(),
    api: modelApiSchema.optional(),
    apiKey: providerSecretInputSchema.optional(),
    baseUrl: z.string().min(1),
    oauthRegion: providerOauthRegionSchema.nullable().optional(),
    oauthProfileRef: z.string().min(1).optional(),
    displayName: z.string().min(1).optional(),
    headers: z
      .record(z.string(), z.union([z.string(), providerSecretRefSchema]))
      .optional(),
    models: z.array(modelProviderModelEntrySchema).default([]),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.auth === "oauth" && !value.oauthProfileRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["oauthProfileRef"],
        message: "oauthProfileRef is required when auth is 'oauth'",
      });
    }

    if ((value.auth === "api-key" || value.auth === "token") && !value.apiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["apiKey"],
        message: "apiKey is required when auth is 'api-key' or 'token'",
      });
    }
  });

export const modelsProviderMapSchema = z.record(
  z.string().min(1),
  modelProviderConfigSchema,
);

export const persistedModelsConfigSchema = z.object({
  mode: z.enum(["merge", "replace"]).default("merge"),
  providers: modelsProviderMapSchema.default({}),
  bedrockDiscovery: z
    .object({
      enabled: z.boolean().optional(),
      region: z.string().optional(),
      providerFilter: z.array(z.string()).optional(),
      refreshInterval: z.number().optional(),
      defaultContextWindow: z.number().optional(),
      defaultMaxTokens: z.number().optional(),
    })
    .optional(),
});

export type ProviderSecretRef = z.infer<typeof providerSecretRefSchema>;
export type ProviderSecretInput = z.infer<typeof providerSecretInputSchema>;
export type ModelProviderModelEntry = z.infer<
  typeof modelProviderModelEntrySchema
>;
export type ModelProviderConfig = z.infer<typeof modelProviderConfigSchema>;
export type PersistedModelsConfig = z.infer<typeof persistedModelsConfigSchema>;
