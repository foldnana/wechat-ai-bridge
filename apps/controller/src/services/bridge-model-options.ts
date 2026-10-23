import { z } from "@hono/zod-openapi";
import type { ModelProviderConfig } from "@nexu/shared";

export const bridgeModelOptionsSchema = z
  .object({
    thinking: z.enum(["auto", "off", "low", "high", "max"]),
    timeoutSeconds: z.number().int().min(30).max(180),
    retries: z.number().int().min(0).max(2),
  })
  .strict();
export type BridgeModelOptions = z.infer<typeof bridgeModelOptionsSchema>;
export const defaultBridgeModelOptions: BridgeModelOptions = {
  thinking: "auto",
  timeoutSeconds: 90,
  retries: 1,
};
export function savedModelOptions(
  provider: ModelProviderConfig,
): Record<string, BridgeModelOptions> {
  const parsed = z
    .record(bridgeModelOptionsSchema)
    .safeParse(provider.metadata?.bridgeModelOptions);
  return parsed.success ? parsed.data : {};
}
export function supportsBridgeThinking(
  baseUrl: string,
  model: string,
): boolean {
  try {
    const url = new URL(baseUrl);
    return (
      url.origin === "https://api.deepseek.com" &&
      ["deepseek-flash", "deepseek-v4-pro"].includes(model)
    );
  } catch {
    return false;
  }
}
export function bridgeThinkingPayload(
  thinking: BridgeModelOptions["thinking"] = "auto",
) {
  if (thinking === "auto") return {};
  if (thinking === "off") return { thinking: { type: "disabled" } };
  return { thinking: { type: "enabled" }, reasoning_effort: thinking };
}
