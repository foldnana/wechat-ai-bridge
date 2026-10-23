import { z } from "@hono/zod-openapi";
import { proxyFetch } from "../lib/proxy-fetch.js";
import {
  type bridgeModelConnectionSchema,
  resolveBridgeBaseUrl,
} from "./bridge-model-test.js";

const modelDetailSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().max(200).optional(),
  context_window: z.number().int().positive().max(100_000_000).optional(),
  max_output_tokens: z.number().int().positive().max(100_000_000).optional(),
  input_modalities: z
    .array(z.enum(["text", "image", "audio", "video"]))
    .max(8)
    .optional(),
  effort: z
    .object({
      supported_levels: z.array(z.enum(["low", "high", "max"])).max(3),
    })
    .optional(),
});
export const bridgeModelListResultSchema = z.object({
  ok: z.boolean(),
  code: z.string(),
  message: z.string(),
  models: z.array(z.string()),
  incomplete: z.boolean().default(false),
  details: z.array(modelDetailSchema).optional(),
});
type Result = z.infer<typeof bridgeModelListResultSchema>;
type Connection = z.infer<typeof bridgeModelConnectionSchema>;
const fail = (code: string, message: string): Result => ({
  ok: false,
  code,
  message,
  models: [],
  incomplete: false,
});

async function readList(response: Response): Promise<unknown> {
  // The list is untrusted provider data. Bound it before parsing or rendering.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error("oversized");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Discovery only: never saves credentials, selects a model, or generates text. */
export async function listBridgeModels(input: Connection): Promise<Result> {
  let base: string;
  try {
    base = resolveBridgeBaseUrl(input);
  } catch {
    return fail(
      "invalid_url",
      "请填写正确的 HTTPS 接口基础地址，本机接口可使用 HTTP。",
    );
  }
  const signal = AbortSignal.timeout(20_000);
  const models = new Set<string>();
  const details = new Map<string, z.infer<typeof modelDetailSchema>>();
  const cursors = new Set<string>();
  let after: string | undefined;
  let incomplete = false;
  try {
    for (let page = 0; page < 10; page++) {
      const url = new URL(`${base}/models`);
      if (url.origin === "https://api.siliconflow.cn")
        url.searchParams.set("sub_type", "chat");
      if (after) url.searchParams.set("after", after);
      const response = await proxyFetch(url.toString(), {
        method: "GET",
        redirect: "error",
        signal,
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403)
          return fail(
            "credentials",
            "密钥无效或没有模型列表权限，请检查 API Key；也可手动填写模型后测试。",
          );
        if ([404, 405, 501].includes(response.status))
          return fail(
            "unsupported",
            "服务商未提供模型列表，请切换为手动填写模型 ID。",
          );
        if (response.status === 429)
          return fail(
            "rate_limit",
            "读取过于频繁或额度受限，请稍后重试，也可手动填写模型。",
          );
        return fail("provider", "暂时无法读取模型列表，请稍后重试或手动填写。");
      }
      const payload = await readList(response);
      const parsed = z
        .object({
          data: z.array(z.unknown()),
          has_more: z.boolean().optional(),
          last_id: z.string().optional(),
        })
        .safeParse(payload);
      if (!parsed.success)
        return fail(
          "invalid_response",
          "接口返回的模型列表格式不兼容，请手动填写模型 ID。",
        );
      let lastId: string | undefined;
      for (const item of parsed.data.data) {
        const detail = modelDetailSchema.safeParse(item);
        const model = detail.success
          ? detail
          : z.object({ id: modelDetailSchema.shape.id }).safeParse(item);
        if (
          !model.success ||
          [...model.data.id].some(
            (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
          )
        )
          continue;
        lastId = model.data.id;
        models.add(lastId);
        details.set(lastId, model.data);
        if (models.size >= 5000) {
          incomplete = true;
          break;
        }
      }
      if (incomplete || !parsed.data.has_more) break;
      after = parsed.data.last_id || lastId;
      if (!after || cursors.has(after) || page === 9) {
        incomplete = true;
        break;
      }
      cursors.add(after);
    }
    if (!models.size)
      return fail(
        "empty",
        "服务商没有返回可选模型，请检查权限或手动填写模型 ID。",
      );
    return {
      ok: true,
      code: "listed",
      models: [...models].sort(),
      details: [...details.values()],
      incomplete,
      message: incomplete
        ? `已读取 ${models.size} 个模型，列表可能不完整；找不到的模型可手动填写。`
        : `已读取 ${models.size} 个模型。选择后仍需测试聊天是否可用。`,
    };
  } catch {
    return fail(
      signal.aborted ? "timeout" : "network",
      signal.aborted
        ? "读取超过 20 秒，请重试或手动填写模型。"
        : "未能读取有效的模型列表，请检查网络和接口地址，也可手动填写。",
    );
  }
}
