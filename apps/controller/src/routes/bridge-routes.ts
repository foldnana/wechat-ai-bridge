import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { modelProviderConfigSchema } from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import {
  bridgeModelListResultSchema,
  listBridgeModels,
} from "../services/bridge-model-list.js";
import {
  bridgeModelOptionsSchema,
  savedModelOptions,
} from "../services/bridge-model-options.js";
import {
  bridgeModelConnectionSchema,
  bridgeModelInputSchema,
  bridgeModelResultSchema,
  resolveBridgeBaseUrl,
  testBridgeModel,
} from "../services/bridge-model-test.js";
import {
  resolveSavedModelConnection,
  savedModelConnectionSchema,
  savedModelConnections,
  savedModelConnectionsSchema,
} from "../services/bridge-saved-models.js";
import { ProviderConfigConflictError } from "../store/nexu-config-store.js";
import type { ControllerBindings } from "../types.js";

const activitySchema = z.object({
  runId: z.string(),
  receivedAt: z.string().datetime(),
  generatedAt: z.string().datetime().nullable(),
  sentAt: z.string().datetime().nullable(),
  lastSuccessfulReplyAt: z.string().datetime().nullable(),
  error: z.enum(["generation", "send"]).nullable(),
  trigger: z.literal("proactive").optional(),
  cancelled: z.boolean().optional(),
  warning: z.literal("sticker").optional(),
});

export function registerBridgeRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  let savingModel = false;
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/bridge/models/saved",
      tags: ["Bridge"],
      responses: {
        200: {
          content: {
            "application/json": { schema: savedModelConnectionsSchema },
          },
          description: "Saved compatible connections without credentials",
        },
      },
    }),
    async (c) =>
      c.json(
        savedModelConnections(await container.configStore.getConfig()),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/bridge/models/discover",
      tags: ["Bridge"],
      request: {
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z.union([
                savedModelConnectionSchema,
                bridgeModelConnectionSchema.strict(),
              ]),
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: bridgeModelListResultSchema },
          },
          description:
            "Read provider model IDs without saving configuration or generating text",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      if (!("savedProviderKey" in body))
        return c.json(await listBridgeModels(body), 200);
      const saved = resolveSavedModelConnection(
        await container.configStore.getConfig(),
        body,
      );
      if (!saved)
        return c.json(
          {
            ok: false,
            code: "config_changed",
            message: "已保存 API 已更改或不可用，请刷新页面后重试。",
            models: [],
            incomplete: false,
          },
          200,
        );
      return c.json(await listBridgeModels(saved.input), 200);
    },
  );
  const pauseFile = path.join(
    container.env.openclawStateDir ?? ".",
    "bridge-control.json",
  );
  const controlSchema = z.object({ paused: z.boolean() });
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/bridge/control",
      tags: ["Bridge"],
      responses: {
        200: {
          content: { "application/json": { schema: controlSchema } },
          description: "Reply pause state",
        },
      },
    }),
    async (c) => {
      try {
        return c.json(
          controlSchema.parse(JSON.parse(await readFile(pauseFile, "utf8"))),
          200,
        );
      } catch (error) {
        // Corrupt/unreadable controls fail closed, matching the runtime reader.
        return c.json(
          { paused: (error as NodeJS.ErrnoException).code !== "ENOENT" },
          200,
        );
      }
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/api/v1/bridge/control",
      tags: ["Bridge"],
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: controlSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: controlSchema } },
          description: "Pause or resume new replies",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      await mkdir(path.dirname(pauseFile), { recursive: true });
      const temp = `${pauseFile}.${c.get("requestId")}.tmp`;
      await writeFile(
        temp,
        JSON.stringify({ ...body, revision: randomUUID() }),
        { mode: 0o600 },
      );
      await rename(temp, pauseFile);
      return c.json(body, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/bridge/sessions/{id}/new",
      tags: ["Bridge"],
      request: { params: z.object({ id: z.string() }) },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({ ok: z.boolean(), message: z.string() }),
            },
          },
          description:
            "Reset the active runtime conversation while preserving the preset",
        },
      },
    }),
    async (c) => {
      const session = await container.sessionService.getSession(
        c.req.valid("param").id,
      );
      if (
        !session ||
        !["wechat", "openclaw-weixin"].includes(session.channelType ?? "")
      ) {
        return c.json(
          {
            ok: false,
            message: "未找到微信对话，请先在微信发消息，再刷新列表。",
          },
          200,
        );
      }
      try {
        await container.wsClient.request(
          "sessions.reset",
          { key: session.sessionKey, reason: "new" },
          { timeoutMs: 30_000 },
        );
        return c.json(
          { ok: true, message: "已新开对话，预设保留。旧本机记录未删除。" },
          200,
        );
      } catch {
        return c.json(
          {
            ok: false,
            message: "运行服务未能确认新开对话，请检查服务后重试。",
          },
          200,
        );
      }
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/bridge/activity",
      tags: ["Bridge"],
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({
                activities: z.array(
                  z.object({
                    channelId: z.string(),
                    activity: activitySchema.nullable(),
                  }),
                ),
              }),
            },
          },
          description: "Local WeChat delivery stages without chat contents",
        },
      },
    }),
    async (c) => {
      const channels = await container.channelService.listChannels();
      const activities = await Promise.all(
        channels
          .filter((ch) => ch.channelType === "wechat")
          .map(async (channel) => {
            try {
              const name = createHash("sha256")
                .update(channel.accountId)
                .digest("hex");
              const raw = await readFile(
                path.join(
                  container.env.openclawStateDir,
                  "bridge-activity",
                  `${name}.json`,
                ),
                "utf8",
              );
              return {
                channelId: channel.id,
                activity: activitySchema.parse(JSON.parse(raw)),
              };
            } catch {
              return { channelId: channel.id, activity: null };
            }
          }),
      );
      return c.json({ activities }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/bridge/model",
      tags: ["Bridge"],
      request: {
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z.union([
                savedModelConnectionSchema.extend({
                  model: z.string().trim().min(1).max(200),
                  options: bridgeModelOptionsSchema.optional(),
                }),
                bridgeModelInputSchema.strict(),
              ]),
            },
          },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: bridgeModelResultSchema } },
          description: "Test generation, then save and select the model",
        },
      },
    }),
    async (c) => {
      if (savingModel) {
        return c.json(
          {
            ok: false,
            saved: false,
            code: "busy",
            message: "已有模型测试正在进行，请稍候。",
          },
          200,
        );
      }
      savingModel = true;
      let saved = false;
      try {
        const body = c.req.valid("json");
        const stored =
          "savedProviderKey" in body
            ? resolveSavedModelConnection(
                await container.configStore.getConfig(),
                body,
              )
            : null;
        if ("savedProviderKey" in body && !stored)
          return c.json(
            {
              ok: false,
              saved: false,
              code: "config_changed",
              message: "已保存 API 已更改或不可用，请刷新页面后重试。",
            },
            200,
          );
        const input = stored
          ? {
              ...stored.input,
              model: body.model,
              options:
                body.options ?? savedModelOptions(stored.provider)[body.model],
            }
          : (body as z.infer<typeof bridgeModelInputSchema>);
        const tested = await testBridgeModel(input);
        if (!tested.ok) return c.json(tested, 200);
        const baseUrl = resolveBridgeBaseUrl(input);
        const preset =
          baseUrl === "https://dashscope.aliyuncs.com/compatible-mode/v1"
            ? "bailian"
            : baseUrl === "https://api.siliconflow.cn/v1"
              ? "siliconflow"
              : "bridge";
        const key =
          stored?.key ??
          (input.provider === "deepseek"
            ? "deepseek"
            : `custom-openai/${preset}`);
        const provider = modelProviderConfigSchema.parse(
          stored
            ? {
                ...stored.provider,
                models: stored.provider.models.some(
                  (entry) => entry.id === input.model,
                )
                  ? stored.provider.models
                  : [
                      ...stored.provider.models,
                      {
                        id: input.model,
                        name: input.model,
                        contextWindow: 32768,
                        maxTokens: 4096,
                      },
                    ],
              }
            : {
                providerTemplateId: input.provider,
                ...(input.provider === "custom-openai"
                  ? { instanceId: preset }
                  : {}),
                enabled: true,
                auth: "api-key",
                api: "openai-completions",
                apiKey: input.apiKey,
                baseUrl,
                ...(preset === "bailian"
                  ? { displayName: "阿里云百炼（北京）" }
                  : preset === "siliconflow"
                    ? { displayName: "硅基流动（中国大陆）" }
                    : {}),
                models: [
                  {
                    id: input.model,
                    name: input.model,
                    contextWindow: 32768,
                    maxTokens: 4096,
                  },
                ],
              },
        );
        if (input.options) {
          provider.metadata = {
            ...provider.metadata,
            bridgeModelOptions: {
              ...savedModelOptions(provider),
              [input.model]: input.options,
            },
          };
        }
        const modelId = `${key}/${input.model}`;
        if (stored)
          await container.configStore.saveProviderAndSelectModel(
            key,
            provider,
            modelId,
            stored.provider,
          );
        else
          await container.configStore.saveProviderAndSelectModel(
            key,
            provider,
            modelId,
          );
        saved = true;
        await container.openclawSyncService.syncAll();
        await container.desktopLocalService.restartRuntime();
        return c.json(
          {
            ok: true,
            saved: true,
            code: "saved",
            message: stored
              ? "测试通过，已切换模型，现有会话保留。后台正在重新连接。"
              : "测试通过，模型已保存并选中。请继续微信扫码。",
            modelId,
          },
          200,
        );
      } catch (error) {
        if (error instanceof ProviderConfigConflictError)
          return c.json(
            {
              ok: false,
              saved: false,
              code: "config_changed",
              message: "API 配置在测试期间发生了变化，请刷新页面后重试。",
            },
            200,
          );
        return c.json(
          {
            ok: false,
            saved,
            code: saved ? "runtime" : "save",
            message: saved
              ? "模型测试通过且配置已保存，但本地服务尚未就绪。请重启软件后继续，无需重新付费测试。"
              : "配置未能完整保存，请检查本机磁盘和目录权限后重试。",
          },
          200,
        );
      } finally {
        savingModel = false;
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/bridge/preset",
      tags: ["Bridge"],
      responses: {
        200: {
          content: {
            "application/json": { schema: z.object({ preset: z.string() }) },
          },
          description: "User preset",
        },
      },
    }),
    async (c) => {
      const bot = await container.configStore.getOrCreateDefaultBot();
      return c.json({ preset: bot.systemPrompt ?? "" }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/api/v1/bridge/preset",
      tags: ["Bridge"],
      request: {
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z.object({ preset: z.string().max(16000) }),
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: z.object({ ok: z.boolean() }) },
          },
          description: "Save user preset",
        },
      },
    }),
    async (c) => {
      const bot = await container.configStore.getOrCreateDefaultBot();
      await container.agentService.updateBot(bot.id, {
        systemPrompt: c.req.valid("json").preset,
      });
      return c.json({ ok: true }, 200);
    },
  );
}
