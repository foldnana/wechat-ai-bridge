import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import { ChannelService } from "../src/services/channel-service.js";
import type { OpenClawSyncService } from "../src/services/openclaw-sync-service.js";
import type { NexuConfigStore } from "../src/store/nexu-config-store.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "bridge-qr-"));
  roots.push(root);
  const service = new ChannelService(
    { openclawStateDir: root } as ControllerEnv,
    {} as NexuConfigStore,
    {} as OpenClawSyncService,
  );
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ qrcode: "test-code", qrcode_img_content: "test-image" }),
    );
  vi.stubGlobal("fetch", fetch);
  const started = await service.wechatQrStart();
  return { root, service, fetch, started };
}

describe("WeChat QR server cancellation and expiry", () => {
  it("refuses a confirmation that arrives after the caller has cancelled", async () => {
    const { root, service, fetch, started } = await setup();
    const controller = new AbortController();
    fetch.mockImplementationOnce(async () => {
      controller.abort();
      return Response.json({
        status: "confirmed",
        bot_token: "test-token",
        ilink_bot_id: "test-account",
      });
    });
    await expect(
      service.wechatQrWait(started.sessionKey, controller.signal),
    ).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  });
  it("uses the original QR expiry rather than extending it when waiting begins", async () => {
    vi.useFakeTimers();
    const { service, fetch, started } = await setup();
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    expect(await service.wechatQrWait(started.sessionKey)).toMatchObject({
      connected: false,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
