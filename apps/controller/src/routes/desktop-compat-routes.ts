import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const defaultModelBodySchema = z.object({ modelId: z.string() });
const defaultModelResponseSchema = z.object({ modelId: z.string().nullable() });
const defaultModelSetResponseSchema = z.object({
  ok: z.boolean(),
  modelId: z.string(),
  configPushed: z.boolean(),
});
const desktopAuthSessionResponseSchema = z.object({
  session: z.object({
    id: z.string(),
    expiresAt: z.string(),
  }),
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    image: z.string().nullable(),
  }),
});

export function registerDesktopCompatRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/auth/get-session",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: desktopAuthSessionResponseSchema },
          },
          description: "Desktop-local auth session",
        },
      },
    }),
    async (c) =>
      c.json(
        {
          session: {
            id: "desktop-local-session",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
          user: {
            id: "desktop-local-user",
            email: "desktop@nexu.local",
            name: "Desktop User",
            image: null,
          },
        },
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/internal/desktop/default-model",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: defaultModelResponseSchema },
          },
          description: "Default model",
        },
      },
    }),
    async (c) => {
      const config = await container.configStore.getConfig();
      const rawModelId = config.runtime.defaultModelId;
      const modelId = rawModelId || null;
      return c.json({ modelId }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/api/internal/desktop/default-model",
      tags: ["Desktop"],
      request: {
        body: {
          content: { "application/json": { schema: defaultModelBodySchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: defaultModelSetResponseSchema },
          },
          description: "Set default model",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      await container.desktopLocalService.setDefaultModel(body.modelId);
      const config = await container.configStore.getConfig();
      // Immediately sync so OpenClaw picks up the change
      const { configPushed } = await container.openclawSyncService.syncAll();
      return c.json(
        {
          ok: true,
          modelId: config.runtime.defaultModelId,
          configPushed,
        },
        200,
      );
    },
  );
}
