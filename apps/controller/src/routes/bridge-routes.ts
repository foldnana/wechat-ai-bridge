import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { modelProviderConfigSchema } from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import {
  bridgeModelInputSchema,
  bridgeModelResultSchema,
  resolveBridgeBaseUrl,
  testBridgeModel,
} from "../services/bridge-model-test.js";
import type { ControllerBindings } from "../types.js";

const activitySchema = z.object({
  runId: z.string(),
  receivedAt: z.string().datetime(),
  generatedAt: z.string().datetime().nullable(),
  sentAt: z.string().datetime().nullable(),
  lastSuccessfulReplyAt: z.string().datetime().nullable(),
  error: z.enum(["generation", "send"]).nullable(),
  trigger: z.literal("proactive").optional(),
});

export function registerBridgeRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  let savingModel = false;
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
      await writeFile(temp, JSON.stringify(body), { mode: 0o600 });
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
          content: { "application/json": { schema: bridgeModelInputSchema } },
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
        const input = c.req.valid("json");
        const tested = await testBridgeModel(input);
        if (!tested.ok) return c.json(tested, 200);
        const key =
          input.provider === "deepseek" ? "deepseek" : "custom-openai/bridge";
        const provider = modelProviderConfigSchema.parse({
          providerTemplateId: input.provider,
          ...(input.provider === "custom-openai"
            ? { instanceId: "bridge" }
            : {}),
          enabled: true,
          auth: "api-key",
          api: "openai-completions",
          apiKey: input.apiKey,
          baseUrl: resolveBridgeBaseUrl(input),
          models: [
            {
              id: input.model,
              name: input.model,
              contextWindow: 32768,
              maxTokens: 4096,
            },
          ],
        });
        const modelId = `${key}/${input.model}`;
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
            message: "测试通过，模型已保存并选中。请继续微信扫码。",
            modelId,
          },
          200,
        );
      } catch {
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
