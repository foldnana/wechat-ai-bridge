import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "#controller/app/container";
import { createApp } from "#controller/app/create-app";
import { listBridgeModels } from "#controller/services/bridge-model-list";

const input = { provider: "deepseek" as const, apiKey: "test-secret" };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("provider model discovery", () => {
  it("lists IDs without generation, deduplicates and ignores invalid entries", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        data: [
          { id: "deepseek-reasoner", private: "not returned" },
          { id: "deepseek-chat" },
          { id: "deepseek-chat" },
          { id: "" },
          { id: 42 },
          { id: "a\nb" },
          null,
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await listBridgeModels(input)).toMatchObject({
      ok: true,
      models: ["deepseek-chat", "deepseek-reasoner"],
      incomplete: false,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://api.deepseek.com/models",
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: {
        Authorization: "Bearer test-secret",
        Accept: "application/json",
      },
    });
    expect(fetch.mock.calls[0]?.[1].body).toBeUndefined();
  });
  it("keeps pagination on the exact custom origin and path, ignoring foreign next URLs", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: "a/model" }],
          has_more: true,
          last_id: "a/model",
          next: "https://foreign.invalid/models",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "z" }], has_more: false }),
      );
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await listBridgeModels({
          ...input,
          provider: "custom-openai",
          baseUrl: "http://127.0.0.1:1234/v1/",
        })
      ).models,
    ).toEqual(["a/model", "z"]);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:1234/v1/models",
      "http://127.0.0.1:1234/v1/models?after=a%2Fmodel",
    ]);
  });
  it("stops repeating pagination and reports an incomplete list", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(Response.json({ data: [{ id: "a" }], has_more: true })),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await listBridgeModels(input)).toMatchObject({
      ok: true,
      incomplete: true,
      models: ["a"],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    [401, "credentials"],
    [403, "credentials"],
    [404, "unsupported"],
    [405, "unsupported"],
    [429, "rate_limit"],
    [503, "provider"],
  ])(
    "handles HTTP %s without returning provider error bodies",
    async (status, code) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response("test-secret", { status: Number(status) }),
          ),
      );
      const result = await listBridgeModels(input);
      expect(result).toMatchObject({ ok: false, code, models: [] });
      expect(JSON.stringify(result)).not.toContain(input.apiKey);
    },
  );
  it.each([{ data: [] }, { data: [{ id: 1 }] }, { choices: [] }])(
    "supports manual fallback for empty or incompatible lists",
    async (payload) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
      expect(await listBridgeModels(input)).toMatchObject({
        ok: false,
        models: [],
      });
    },
  );
  it("rejects unsafe base URLs before transmitting the key", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const baseUrl of [
      "http://remote.invalid/v1",
      "https://secret@remote.invalid",
      "https://remote.invalid/v1?key=secret",
      "file:///models",
    ]) {
      expect(
        (
          await listBridgeModels({
            ...input,
            provider: "custom-openai",
            baseUrl,
          })
        ).code,
      ).toBe("invalid_url");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds large responses and hides network diagnostics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("x".repeat(2_000_001))),
    );
    expect((await listBridgeModels(input)).ok).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("test-secret private URL")),
    );
    expect(JSON.stringify(await listBridgeModels(input))).not.toContain(
      "test-secret",
    );
  });
  it("identifies a timed out read", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("aborted")));
    expect((await listBridgeModels(input)).code).toBe("timeout");
  });
  it("discovery route never saves configuration or restarts the runtime", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ data: [{ id: "deepseek-chat" }] })),
    );
    const save = vi.fn();
    const sync = vi.fn();
    const restart = vi.fn();
    const app = createApp({
      env: { webUrl: "http://localhost:5173" },
      configStore: { saveProviderAndSelectModel: save },
      openclawSyncService: { syncAll: sync },
      desktopLocalService: { restartRuntime: restart },
    } as unknown as ControllerContainer);
    const response = await app.request("/api/v1/bridge/models/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      models: ["deepseek-chat"],
    });
    expect(save).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });
});
