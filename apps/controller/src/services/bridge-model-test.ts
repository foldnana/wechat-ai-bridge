import { z } from "@hono/zod-openapi";
import { proxyFetch } from "../lib/proxy-fetch.js";
import {
  bridgeModelOptionsSchema,
  bridgeThinkingPayload,
  supportsBridgeThinking,
} from "./bridge-model-options.js";

export const bridgeModelConnectionSchema = z.object({
  provider: z.enum(["deepseek", "custom-openai"]).default("deepseek"),
  apiKey: z.string().trim().min(1).max(4096),
  baseUrl: z.string().url().optional(),
});
export const bridgeModelInputSchema = bridgeModelConnectionSchema.extend({
  model: z.string().trim().min(1).max(200).default("deepseek-chat"),
  options: bridgeModelOptionsSchema.optional(),
});

export const bridgeModelResultSchema = z.object({
  ok: z.boolean(),
  saved: z.boolean().default(false),
  code: z.string(),
  message: z.string(),
  modelId: z.string().optional(),
});

export type BridgeModelInput = z.infer<typeof bridgeModelInputSchema>;
export type BridgeModelResult = z.infer<typeof bridgeModelResultSchema>;

export function resolveBridgeBaseUrl(
  input: z.infer<typeof bridgeModelConnectionSchema>,
): string {
  const url = new URL(
    input.provider === "deepseek"
      ? "https://api.deepseek.com"
      : (input.baseUrl ?? ""),
  );
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Invalid API base URL");
  }
  return url.toString().replace(/\/+$/, "");
}

function failure(code: string, message: string): BridgeModelResult {
  return { ok: false, saved: false, code, message };
}

/** Generate a small real response. Never return provider bodies or credentials. */
export async function testBridgeModel(
  input: BridgeModelInput,
): Promise<BridgeModelResult> {
  let baseUrl: string;
  try {
    baseUrl = resolveBridgeBaseUrl(input);
  } catch {
    return failure(
      "invalid_url",
      "请填写 HTTPS 接口基础地址；本机接口可使用 HTTP。地址不要包含密钥、查询参数或 /chat/completions。",
    );
  }
  if (
    input.options?.thinking &&
    input.options.thinking !== "auto" &&
    !supportsBridgeThinking(baseUrl, input.model)
  ) {
    return failure(
      "unsupported_thinking",
      "此接口或模型尚未验证思考模式控制，请选择「服务商默认」。",
    );
  }
  const timeoutSeconds = input.options?.timeoutSeconds ?? 60;
  const signal = AbortSignal.timeout(timeoutSeconds * 1000);
  try {
    let response: Response | undefined;
    const retries = input.options?.retries ?? 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        response = await proxyFetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          redirect: "error",
          signal,
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: input.model,
            messages: [{ role: "user", content: "Reply with only OK." }],
            max_tokens:
              input.options && input.options.thinking !== "off" ? 4096 : 128,
            stream: false,
            ...bridgeThinkingPayload(input.options?.thinking),
          }),
        });
      } catch (error) {
        if (signal.aborted || attempt === retries) throw error;
      }
      if (
        response &&
        ![408, 409, 429, 500, 502, 503, 504].includes(response.status)
      )
        break;
      if (attempt === retries) break;
      await response?.body?.cancel();
      response = undefined;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => {
            signal.removeEventListener("abort", abort);
            resolve();
          },
          500 * (attempt + 1),
        );
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    }
    if (!response) throw new Error("No response");
    if (!response.ok) {
      const code = response.status;
      await response.body?.cancel();
      if (code === 401 || code === 403) {
        return failure(
          "credentials",
          "密钥无效或没有访问权限，请检查 API Key 和模型权限。",
        );
      }
      if (code === 402)
        return failure("quota", "账户额度不足，请到模型服务商处检查余额。");
      if (code === 429)
        return failure(
          "rate_limit",
          "请求受限或额度已用完，请检查服务商额度并稍后重试。",
        );
      if (code === 400 || code === 404 || code === 422) {
        return failure(
          "model_or_endpoint",
          "模型名称、接口地址或请求格式不被支持，请检查高级设置。",
        );
      }
      return failure(
        "provider",
        `模型服务暂时不可用（HTTP ${code}），请稍后重试。`,
      );
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      return failure(
        "empty_reply",
        "接口未返回可用的文字回答，请检查模型是否支持 Chat Completions；推理模型可能需要更多输出额度。",
      );
    }
    return {
      ok: true,
      saved: false,
      code: "tested",
      message: "模型已成功生成测试回答。",
    };
  } catch {
    return failure(
      signal.aborted ? "timeout" : "network",
      signal.aborted
        ? `模型测试超过 ${timeoutSeconds} 秒，请检查网络或更换模型后重试。`
        : "未能取得有效回答，请检查网络、代理和接口地址后重试。",
    );
  }
}
