import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "#controller/app/container";
import { createApp } from "#controller/app/create-app";
import { testBridgeModel } from "#controller/services/bridge-model-test";

const input = {
  provider: "deepseek" as const,
  apiKey: "test-secret",
  model: "deepseek-chat",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("real model test", () => {
  it("calls chat completions for the selected model, never lists models", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ choices: [{ message: { content: "OK" } }] }),
      );
    vi.stubGlobal("fetch", fetch);
    expect((await testBridgeModel(input)).ok).toBe(true);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://api.deepseek.com/chat/completions");
    expect(JSON.parse(init.body)).toMatchObject({
      model: "deepseek-chat",
      stream: false,
      max_tokens: 128,
    });
    expect(init.redirect).toBe("error");
  });
  it.each([
    [401, "credentials"],
    [402, "quota"],
    [404, "model_or_endpoint"],
    [429, "rate_limit"],
    [503, "provider"],
  ])(
    "explains HTTP %s without echoing provider secrets",
    async (status, code) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response("test-secret echoed", { status: Number(status) }),
          ),
      );
      const result = await testBridgeModel(input);
      expect(result).toMatchObject({ ok: false, saved: false, code });
      expect(JSON.stringify(result)).not.toContain("test-secret");
    },
  );
  it("rejects a successful HTTP response without an answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ data: [] })),
    );
    expect((await testBridgeModel(input)).code).toBe("empty_reply");
  });
  it("rejects remote cleartext endpoints and credential-bearing URLs without fetching", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const baseUrl of [
      "http://example.com/v1",
      "https://key@example.com",
      "https://example.com?key=secret",
    ]) {
      expect(
        (
          await testBridgeModel({
            ...input,
            provider: "custom-openai",
            baseUrl,
          })
        ).code,
      ).toBe("invalid_url");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses the exact custom endpoint including its /v1 path", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ choices: [{ message: { content: "OK" } }] }),
      );
    vi.stubGlobal("fetch", fetch);
    await testBridgeModel({
      ...input,
      provider: "custom-openai",
      baseUrl: "http://127.0.0.1:12000/v1/",
    });
    expect(String(fetch.mock.calls[0][0])).toBe(
      "http://127.0.0.1:12000/v1/chat/completions",
    );
  });
});

describe("test before replacing saved configuration", () => {
  function setup() {
    const configStore = { saveProviderAndSelectModel: vi.fn() };
    const syncAll = vi.fn();
    const restartRuntime = vi.fn();
    const app = createApp({
      env: { webUrl: "http://localhost:5173" },
      configStore,
      openclawSyncService: { syncAll },
      desktopLocalService: { restartRuntime },
    } as unknown as ControllerContainer);
    const request = () =>
      app.request("/api/v1/bridge/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    return { configStore, syncAll, restartRuntime, request };
  }
  it("does not touch the previous config after a failed model test", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 401 })),
    );
    const { configStore, request } = setup();
    expect((await (await request()).json()).saved).toBe(false);
    expect(configStore.saveProviderAndSelectModel).not.toHaveBeenCalled();
  });
  it("saves the tested provider and selection together before runtime sync", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ choices: [{ message: { content: "OK" } }] }),
        ),
    );
    const { configStore, syncAll, request } = setup();
    expect(await (await request()).json()).toMatchObject({
      ok: true,
      saved: true,
      modelId: "deepseek/deepseek-chat",
    });
    expect(configStore.saveProviderAndSelectModel).toHaveBeenCalledWith(
      "deepseek",
      expect.objectContaining({ apiKey: "test-secret" }),
      "deepseek/deepseek-chat",
    );
    expect(
      configStore.saveProviderAndSelectModel.mock.invocationCallOrder[0],
    ).toBeLessThan(syncAll.mock.invocationCallOrder[0]);
  });
  it("reports saved configuration separately from runtime sync failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ choices: [{ message: { content: "OK" } }] }),
        ),
    );
    const { syncAll, request } = setup();
    syncAll.mockRejectedValue(new Error("private diagnostic"));
    expect(await (await request()).json()).toMatchObject({
      ok: false,
      saved: true,
      code: "runtime",
    });
  });
});
