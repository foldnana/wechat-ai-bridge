import { createHash } from "node:crypto";
import { z } from "@hono/zod-openapi";
import type { ModelProviderConfig } from "@nexu/shared";
import type { NexuConfig } from "../store/schemas.js";
import {
  bridgeModelOptionsSchema,
  savedModelOptions,
} from "./bridge-model-options.js";

export const savedModelConnectionSchema = z
  .object({
    savedProviderKey: z.string().min(1).max(200),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const savedModelConnectionsSchema = z.object({
  connections: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      revision: z.string(),
      deepseekOfficial: z.boolean().optional(),
      modelOptions: z.record(bridgeModelOptionsSchema).optional(),
    }),
  ),
  selectedProviderKey: z.string().nullable(),
  currentModel: z.string().nullable(),
});
function reusable(provider: ModelProviderConfig) {
  return (
    provider.enabled &&
    typeof provider.apiKey === "string" &&
    provider.apiKey.trim().length > 0 &&
    (!provider.api || provider.api === "openai-completions") &&
    provider.auth !== "oauth" &&
    (!provider.headers || Object.keys(provider.headers).length === 0)
  );
}
function revision(key: string, provider: ModelProviderConfig) {
  return createHash("sha256")
    .update(key)
    .update(JSON.stringify(provider))
    .digest("hex");
}
export function savedModelConnections(config: NexuConfig) {
  const connections = Object.entries(config.models.providers)
    .filter(([, provider]) => reusable(provider))
    .map(([id, provider]) => ({
      id,
      label:
        provider.displayName || (id === "deepseek" ? "DeepSeek 官方 API" : id),
      revision: revision(id, provider),
      deepseekOfficial: /^https:\/\/api\.deepseek\.com(?:\/|$)/.test(
        provider.baseUrl,
      ),
      modelOptions: savedModelOptions(provider),
    }));
  const currentModel = config.runtime.defaultModelId || null;
  const selectedProviderKey =
    connections
      .map(({ id }) => id)
      .sort((a, b) => b.length - a.length)
      .find((id) => currentModel?.startsWith(`${id}/`)) ?? null;
  return { connections, selectedProviderKey, currentModel };
}
export function resolveSavedModelConnection(
  config: NexuConfig,
  ref: z.infer<typeof savedModelConnectionSchema>,
) {
  const provider = config.models.providers[ref.savedProviderKey];
  if (
    !provider ||
    !reusable(provider) ||
    revision(ref.savedProviderKey, provider) !== ref.revision
  )
    return null;
  // Resolve credentials and endpoint together; the client cannot redirect a saved key.
  return {
    key: ref.savedProviderKey,
    provider,
    input: {
      provider: "custom-openai" as const,
      apiKey: provider.apiKey as string,
      baseUrl: provider.baseUrl,
    },
  };
}
