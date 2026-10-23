import { afterEach, describe, expect, it, vi } from "vitest";
import { listBridgeModels } from "#controller/services/bridge-model-list";
import { bridgeModelOptionsSchema } from "#controller/services/bridge-model-options";
import { testBridgeModel } from "#controller/services/bridge-model-test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const input = {
  provider: "deepseek" as const,
  apiKey: "synthetic-key",
  model: "deepseek-flash",
  options: { thinking: "low" as const, timeoutSeconds: 90, retries: 1 },
};
describe("Bridge model advanced settings", () => {
  it("validates bounds and rejects unknown settings", () => {
    for (const options of [
      { ...input.options, retries: 3 },
      { ...input.options, timeoutSeconds: 181 },
      { ...input.options, temperature: 1 },
    ])
      expect(bridgeModelOptionsSchema.safeParse(options).success).toBe(false);
  });
  it("uses selected thinking and retries transient errors within the same deadline", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: "OK" } }] }),
      );
    vi.stubGlobal("fetch", fetch);
    expect((await testBridgeModel(input)).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    const first = fetch.mock.calls[0][1];
    expect(JSON.parse(first.body)).toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "low",
    });
    expect(fetch.mock.calls[1][1].signal).toBe(first.signal);
  });
  it("never retries bad credentials or a valid but empty answer", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("bad key", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    expect((await testBridgeModel(input)).code).toBe("credentials");
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch
      .mockClear()
      .mockResolvedValue(
        Response.json({ choices: [{ message: { content: "" } }] }),
      );
    expect((await testBridgeModel(input)).code).toBe("empty_reply");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not send unverified thinking parameters to another provider", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await testBridgeModel({
          ...input,
          provider: "custom-openai",
          baseUrl: "https://api.example.invalid/v1",
        })
      ).code,
    ).toBe("unsupported_thinking");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retains bounded model details without leaking unrelated provider fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          data: [
            {
              id: "deepseek-flash",
              name: "DeepSeek Flash",
              context_window: 1048576,
              input_modalities: ["text", "image"],
              secret: "not exposed",
            },
            { id: "other", context_window: "malformed" },
          ],
        }),
      ),
    );
    const result = await listBridgeModels(input);
    expect(result.models).toEqual(["deepseek-flash", "other"]);
    expect(result.details?.[0]).toMatchObject({
      name: "DeepSeek Flash",
      context_window: 1048576,
    });
    expect(JSON.stringify(result)).not.toContain("not exposed");
  });
});
