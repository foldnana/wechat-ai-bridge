import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import type { ControllerContainer } from "../app/container.js";
import {
  contactIdSchema,
  contactIndexSchema,
  contactProfileSchema,
  listContacts,
  readContact,
  readContactProfile,
  saveContactProfile,
} from "../services/bridge-contacts.js";
import type { ControllerBindings } from "../types.js";

export function registerBridgeContactRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
) {
  const root = container.env.openclawStateDir;
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>) => {
    const result = queue.then(work, work);
    queue = result.catch(() => {});
    return result;
  };
  const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
    description,
    content: { "application/json": { schema } },
  });
  const error = json(
    z.object({ error: z.string() }),
    "Contact unavailable or stale edit",
  );
  const profileResponse = {
    200: json(contactProfileSchema, "Local contact preferences"),
    404: error,
    409: error,
    500: error,
  };
  const params = z.object({ id: contactIdSchema });
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/bridge/contacts",
      tags: ["Bridge"],
      responses: {
        200: json(
          z.array(
            contactIndexSchema.extend({
              label: z.string(),
              memoryCount: z.number(),
              memoryEnabled: z.boolean(),
            }),
          ),
          "Authorized conversations observed on this computer",
        ),
        500: error,
      },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      try {
        return c.json(await listContacts(root), 200);
      } catch {
        return c.json({ error: "联系人资料无法读取，请检查本机文件。" }, 500);
      }
    },
  );
  app.use("/api/v1/bridge/contacts/*", bodyLimit({ maxSize: 48_000 }));
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/bridge/contacts/{id}",
      tags: ["Bridge"],
      request: { params },
      responses: profileResponse,
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      try {
        await readContact(root, c.req.valid("param").id);
      } catch {
        return c.json({ error: "未找到这个会话，请刷新列表。" }, 404);
      }
      try {
        return c.json(
          await readContactProfile(root, c.req.valid("param").id),
          200,
        );
      } catch {
        return c.json({ error: "资料读取失败，未覆盖原有文件。" }, 500);
      }
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/api/v1/bridge/contacts/{id}",
      tags: ["Bridge"],
      request: {
        params,
        body: {
          required: true,
          content: { "application/json": { schema: contactProfileSchema } },
        },
      },
      responses: profileResponse,
    }),
    async (c) => {
      const id = c.req.valid("param").id;
      const body = c.req.valid("json");
      try {
        await readContact(root, id);
      } catch {
        return c.json({ error: "未找到这个会话。" }, 404);
      }
      try {
        const result = await serialize(async () => {
          const current = await readContactProfile(root, id);
          if (current.revision !== body.revision) return null;
          return saveContactProfile(root, id, body.settings);
        });
        if (!result)
          return c.json(
            { error: "资料已在其他页面更新，请重新读取后再修改。" },
            409,
          );
        return c.json(result, 200);
      } catch {
        return c.json({ error: "保存失败，请检查本机文件。" }, 500);
      }
    },
  );
  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/bridge/contacts/{id}/memories",
      tags: ["Bridge"],
      request: { params },
      responses: profileResponse,
    }),
    async (c) => {
      const id = c.req.valid("param").id;
      try {
        await readContact(root, id);
      } catch {
        return c.json({ error: "未找到这个会话。" }, 404);
      }
      try {
        const profile = await serialize(async () => {
          const current = await readContactProfile(root, id);
          return saveContactProfile(root, id, {
            ...current.settings,
            memories: [],
            memoryEnabled: false,
          });
        });
        return c.json(profile, 200);
      } catch {
        return c.json({ error: "清空失败，请重试。" }, 500);
      }
    },
  );
}
