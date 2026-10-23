import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { patchBridgeModelRequest } from "../../packages/slimclaw/patch-model-request.mjs";
import { prepareBridgeModelRequest } from "../../packages/slimclaw/runtime-bridge/model-request.mjs";

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) {
    if (
      path.dirname(dir) !== os.tmpdir() ||
      !path.basename(dir).startsWith("bridge-request-")
    )
      throw new Error("Unsafe cleanup");
    await rm(dir, { recursive: true, force: true });
  }
});
async function setup(thinking = "low") {
  const root = await mkdtemp(path.join(os.tmpdir(), "bridge-request-"));
  dirs.push(root);
  const model = {
    provider: "deepseek",
    id: "deepseek-flash",
    baseUrl: "https://api.deepseek.com",
  };
  await writeFile(
    path.join(root, "nexu-runtime-model.json"),
    JSON.stringify({
      requestOptions: [
        {
          provider: model.provider,
          model: model.id,
          baseUrl: model.baseUrl,
          options: { thinking, timeoutSeconds: 30, retries: 1 },
        },
      ],
    }),
  );
  vi.stubEnv("OPENCLAW_STATE_DIR", root);
  return { root, model };
}
describe("actual runtime request adapter", () => {
  it("changes DeepSeek wire payload and preserves external cancellation", async () => {
    const { model } = await setup();
    const controller = new AbortController();
    const payload = { reasoning_effort: "off" };
    const options = prepareBridgeModelRequest(
      model,
      payload,
      controller.signal,
    );
    expect(payload).toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "low",
    });
    expect(options).toMatchObject({ timeout: 30000, maxRetries: 1 });
    controller.abort();
    expect(options.signal.aborted).toBe(true);
  });
  it("bounds the entire streaming request including retry time", async () => {
    const { model } = await setup();
    vi.useFakeTimers();
    // Node's AbortSignal.timeout uses native timers; inspect the requested bound without waiting 30s.
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(new AbortController().signal);
    prepareBridgeModelRequest(model, {});
    expect(timeout).toHaveBeenCalledWith(30000);
    timeout.mockRestore();
  });
  it.each(["auto", "off", "max"])(
    "handles %s and never leaks settings to another model",
    async (thinking) => {
      const { model } = await setup(thinking);
      const payload: Record<string, unknown> = { reasoning_effort: "medium" };
      prepareBridgeModelRequest(model, payload);
      if (thinking === "auto") expect(JSON.stringify(payload)).toBe("{}");
      if (thinking === "off")
        expect(payload.thinking).toEqual({ type: "disabled" });
      if (thinking === "max") expect(payload.reasoning_effort).toBe("max");
      const untouched = {};
      expect(
        prepareBridgeModelRequest({ ...model, id: "different" }, untouched),
      ).toEqual({ signal: undefined });
      expect(untouched).toEqual({});
    },
  );
  it("patches the actual SDK invocation idempotently and fails on upstream drift", async () => {
    const { root } = await setup();
    const providerDir = path.join(
      root,
      "node_modules/@mariozechner/pi-ai/dist/providers",
    );
    await mkdir(providerDir, { recursive: true });
    const target = path.join(providerDir, "openai-completions.js");
    await writeFile(
      target,
      "const openaiStream = await client.chat.completions.create(params, { signal: options?.signal });\n            finishCurrentBlock(currentBlock);\n            if (options?.signal?.aborted) {}",
    );
    await patchBridgeModelRequest(root);
    const once = await readFile(target, "utf8");
    await patchBridgeModelRequest(root);
    expect(await readFile(target, "utf8")).toBe(once);
    expect(once).toContain(
      "prepareBridgeModelRequest(model, params, options?.signal)",
    );
    await writeFile(target, "changed upstream");
    await expect(patchBridgeModelRequest(root)).rejects.toThrow(
      "must be reviewed",
    );
  });
});
