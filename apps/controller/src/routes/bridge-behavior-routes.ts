import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import type { ControllerContainer } from "../app/container.js";
import {
  behaviorSchema,
  decodeSticker,
  readBehavior,
  stickerInputSchema,
  stickerListSchema,
  writeBridgeJson,
} from "../services/bridge-behavior.js";
import { ensureDefaultStickers } from "../services/bridge-default-stickers.js";
import type { ControllerBindings } from "../types.js";

export function registerBridgeBehaviorRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
) {
  const root = container.env.openclawStateDir;
  let queue: Promise<unknown> = Promise.resolve();
  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work, work);
    queue = result.catch(() => {});
    return result;
  }
  async function saveConfig(config: z.infer<typeof behaviorSchema>) {
    const channels = await container.channelService.listChannels();
    const targets = channels.filter(
      (ch) =>
        ch.channelType === "wechat" &&
        config.proactive.channelIds.includes(ch.id),
    );
    await writeBridgeJson(root, "bridge-behavior.json", {
      ...config,
      accountHashes: targets.map((ch) =>
        createHash("sha256").update(ch.accountId).digest("hex"),
      ),
    });
  }
  const errorResponse = {
    description: "Invalid settings or image",
    content: {
      "application/json": { schema: z.object({ error: z.string() }) },
    },
  };
  const configResponse = {
    200: {
      description: "Local behavior preferences",
      content: { "application/json": { schema: behaviorSchema } },
    },
    400: errorResponse,
  };
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/bridge/behavior",
      tags: ["Bridge"],
      responses: configResponse,
    }),
    async (c) => c.json(await readBehavior(root), 200),
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/api/v1/bridge/behavior",
      tags: ["Bridge"],
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: behaviorSchema } },
        },
      },
      responses: configResponse,
    }),
    async (c) => {
      const config = c.req.valid("json");
      const channels = await container.channelService.listChannels();
      const targets = channels.filter(
        (ch) =>
          ch.channelType === "wechat" &&
          config.proactive.channelIds.includes(ch.id),
      );
      if (
        config.proactive.enabled &&
        (targets.length === 0 ||
          targets.length !== new Set(config.proactive.channelIds).size)
      )
        return c.json({ error: "请选择有效的微信连接。" }, 400);
      await serialize(() => saveConfig(config));
      return c.json(config, 200);
    },
  );
  const listResponse = {
    200: {
      description: "User imported sticker images",
      content: { "application/json": { schema: stickerListSchema } },
    },
    400: errorResponse,
  };
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/bridge/stickers",
      tags: ["Bridge"],
      responses: listResponse,
    }),
    async (c) =>
      c.json(await serialize(() => ensureDefaultStickers(root)), 200),
  );
  app.use("/api/v1/bridge/stickers", bodyLimit({ maxSize: 2_900_000 }));
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/bridge/stickers",
      tags: ["Bridge"],
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: stickerInputSchema } },
        },
      },
      responses: listResponse,
    }),
    async (c) => {
      const input = c.req.valid("json");
      try {
        const { bytes, extension } = decodeSticker(input.data);
        const items = await serialize(async () => {
          const list = await ensureDefaultStickers(root);
          if (list.length >= 24)
            throw new Error("最多保存 24 张表情，请先移除不需要的图片。");
          const id = randomUUID();
          const folder = path.join(root, "bridge-stickers");
          await mkdir(folder, { recursive: true });
          const file = path.join(folder, `${id}.${extension}`);
          await writeFile(file, bytes, { mode: 0o600 });
          list.push({ id, label: input.label, tags: input.tags, extension });
          try {
            await writeBridgeJson(root, "bridge-stickers.json", list);
          } catch (error) {
            await unlink(file).catch(() => {});
            throw error;
          }
          await saveConfig(await readBehavior(root));
          return list;
        });
        return c.json(items, 200);
      } catch (error) {
        return c.json(
          { error: error instanceof Error ? error.message : "无法保存图片。" },
          400,
        );
      }
    },
  );
  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/bridge/stickers/{id}",
      tags: ["Bridge"],
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: listResponse,
    }),
    async (c) => {
      const id = c.req.valid("param").id;
      const items = await serialize(async () => {
        const list = await ensureDefaultStickers(root);
        const item = list.find((s) => s.id === id);
        const next = list.filter((s) => s.id !== id);
        await writeBridgeJson(root, "bridge-stickers.json", next);
        await saveConfig(await readBehavior(root));
        if (item)
          await unlink(
            path.join(root, "bridge-stickers", `${item.id}.${item.extension}`),
          ).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
        return next;
      });
      return c.json(items, 200);
    },
  );
  app.get("/api/v1/bridge/stickers/:id/image", async (c) => {
    const item = (await serialize(() => ensureDefaultStickers(root))).find(
      (s) => s.id === c.req.param("id"),
    );
    if (!item) return c.notFound();
    const bytes = await readFile(
      path.join(root, "bridge-stickers", `${item.id}.${item.extension}`),
    );
    c.header(
      "Content-Type",
      `image/${item.extension === "jpg" ? "jpeg" : item.extension}`,
    );
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "no-store");
    return c.body(bytes);
  });
  const statusSchema = z.object({
    status: z.enum([
      "waiting",
      "disabled",
      "paused",
      "quiet",
      "cooldown",
      "limit",
      "expired",
      "generating",
      "resting",
      "contact-disabled",
      "sent",
      "error",
    ]),
    updatedAt: z.string().datetime(),
    nextAt: z.string().datetime().optional(),
    lastAttemptAt: z.string().datetime().optional(),
    attempts: z.number().int().optional(),
  });
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/bridge/behavior/status",
      tags: ["Bridge"],
      responses: {
        200: {
          description: "Proactive chat runtime state without message contents",
          content: {
            "application/json": {
              schema: z.array(
                z.object({
                  channelId: z.string(),
                  state: statusSchema.nullable(),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const channels = await container.channelService.listChannels();
      return c.json(
        await Promise.all(
          channels
            .filter((ch) => ch.channelType === "wechat")
            .map(async (ch) => {
              try {
                const file = path.join(
                  root,
                  "bridge-proactive-status",
                  `${createHash("sha256").update(ch.accountId).digest("hex")}.json`,
                );
                return {
                  channelId: ch.id,
                  state: statusSchema.parse(
                    JSON.parse(await readFile(file, "utf8")),
                  ),
                };
              } catch {
                return { channelId: ch.id, state: null };
              }
            }),
        ),
        200,
      );
    },
  );
}
