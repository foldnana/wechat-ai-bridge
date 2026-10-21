import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "#controller/app/container";
import { createApp } from "#controller/app/create-app";
import {
  behaviorPrompt,
  behaviorSchema,
  decodeSticker,
  writeBridgeJson,
} from "#controller/services/bridge-behavior";
import { BridgeProactive } from "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/bridge-proactive";
import {
  bridgeHash,
  chooseSticker,
  loadBehavior,
  quietNow,
  stripStickerMarkers,
} from "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/storage/bridge-behavior";

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bridge-behavior-"));
  dirs.push(root);
  vi.stubEnv("OPENCLAW_STATE_DIR", root);
  const account = randomUUID();
  const config = {
    ...behaviorSchema.parse({}),
    accountHashes: [bridgeHash(account)],
  };
  config.proactive = {
    ...config.proactive,
    enabled: true,
    quietStart: "00:00",
    quietEnd: "00:00",
    intervalMinutes: 5,
  };
  await writeBridgeJson(root, "bridge-behavior.json", config);
  let now = new Date(2026, 9, 22, 12).getTime();
  const scheduler = new BridgeProactive(account, () => now);
  const inbound = {
    from_user_id: "authorized-test-peer",
    context_token: "private-token-do-not-persist",
  };
  const advance = (minutes = 6) => {
    now += minutes * 60000;
  };
  return { root, account, config, scheduler, inbound, advance, now: () => now };
}
describe("behavior preferences and managed sticker library", () => {
  it("defaults to no stickers and no proactive messages, with bounded settings", () => {
    expect(behaviorSchema.parse({})).toMatchObject({
      persona: "auto",
      stickers: { enabled: false },
      proactive: { enabled: false },
    });
    expect(
      behaviorSchema.safeParse({ proactive: { intervalMinutes: 0 } }).success,
    ).toBe(false);
    expect(
      behaviorSchema.safeParse({ proactive: { quietStart: "25:80" } }).success,
    ).toBe(false);
    expect(() => decodeSticker("data:image/svg+xml;base64,PHN2Zz4=")).toThrow();
    expect(() =>
      decodeSticker(
        `data:image/png;base64,${Buffer.from("not a real image at all").toString("base64")}`,
      ),
    ).toThrow();
  });
  it("persists configuration, resolves only existing WeChat targets, and builds the live prompt", async () => {
    const { root, account } = await setup();
    const app = createApp({
      env: { openclawStateDir: root, webUrl: "http://localhost:5173" },
      channelService: {
        listChannels: async () => [
          { id: "wechat", channelType: "wechat", accountId: account },
        ],
      },
    } as ControllerContainer);
    const put = (body: unknown) =>
      app.request("/api/v1/bridge/behavior", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await put({ persona: "unknown" })).status).toBe(400);
    expect(
      (await put({ proactive: { enabled: true, channelIds: ["unknown"] } }))
        .status,
    ).toBe(400);
    expect(
      (
        await put({
          tone: "warm",
          persona: "none",
          proactive: { enabled: true, channelIds: ["wechat"] },
        })
      ).status,
    ).toBe(200);
    expect(loadBehavior()?.accountHashes).toEqual([bridgeHash(account)]);
    const saved = JSON.parse(
      await readFile(path.join(root, "bridge-behavior.json"), "utf8"),
    );
    expect(saved.promptContext).toContain("温和、耐心");
    expect(saved.persona).toBe("none");
    expect(
      (await (await app.request("/api/v1/bridge/behavior")).json()).persona,
    ).toBe("none");
    expect(saved.promptContext).not.toContain(account);
    expect(
      (await (await app.request("/api/v1/bridge/behavior")).json())
        .accountHashes,
    ).toBeUndefined();
  });
  it("imports, previews and deletes only managed images", async () => {
    const { root, account } = await setup();
    const app = createApp({
      env: { openclawStateDir: root, webUrl: "http://localhost:5173" },
      channelService: {
        listChannels: async () => [
          { id: "wechat", channelType: "wechat", accountId: account },
        ],
      },
    } as ControllerContainer);
    const data =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
    const response = await app.request("/api/v1/bridge/stickers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "开心", tags: "庆祝、赞同", data }),
    });
    expect(response.status).toBe(200);
    const [item] = await response.json();
    expect(item).toMatchObject({ extension: "png", label: "开心" });
    const preview = await app.request(
      `/api/v1/bridge/stickers/${item.id}/image`,
    );
    expect(preview.headers.get("content-type")).toBe("image/png");
    expect(
      (
        await app.request("/api/v1/bridge/stickers/not-a-uuid", {
          method: "DELETE",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(`/api/v1/bridge/stickers/${item.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    expect(
      (await app.request(`/api/v1/bridge/stickers/${item.id}/image`)).status,
    ).toBe(404);
    expect(await readdir(path.join(root, "bridge-stickers"))).toEqual([]);
  });
  it("restricts model markers to imported IDs and enforces probability, pause and cooldown", async () => {
    const { root, config, now } = await setup();
    const id = randomUUID();
    const key = randomUUID();
    config.stickers = { enabled: true, probability: 25, cooldownMinutes: 10 };
    await writeBridgeJson(root, "bridge-behavior.json", config);
    await writeBridgeJson(root, "bridge-stickers.json", [
      { id, label: "开心", tags: "庆祝", extension: "png" },
    ]);
    const text = `真好！ [[sticker:${id}]]`;
    expect(chooseSticker(text, key, now(), () => 0.8)).toBeUndefined();
    expect(
      chooseSticker(`[[sticker:${randomUUID()}]]`, key, now(), () => 0),
    ).toBeUndefined();
    expect(chooseSticker(text, key, now(), () => 0)).toBe(
      path.join(root, "bridge-stickers", `${id}.png`),
    );
    expect(chooseSticker(text, key, now() + 60000, () => 0)).toBeUndefined();
    expect(stripStickerMarkers("你好 [[sticker:../../secret]]")).toBe("你好");
    await writeBridgeJson(root, "bridge-control.json", { paused: true });
    expect(chooseSticker(text, key, now() + 3600000, () => 0)).toBeUndefined();
    await writeFile(path.join(root, "bridge-behavior.json"), "{bad");
    expect(loadBehavior()).toBeNull();
  });
  it("does not advertise sticker selection when the feature is disabled", () => {
    const config = behaviorSchema.parse({});
    expect(
      behaviorPrompt(config, [
        { id: randomUUID(), label: "私有标签", tags: "开心", extension: "png" },
      ]),
    ).not.toContain("私有标签");
  });
});
describe("opt-in proactive scheduling", () => {
  it("waits for a quiet interval after the ordinary reply finishes", async () => {
    const f = await setup();
    const send = vi.fn().mockResolvedValue(true);
    f.scheduler.observe(f.inbound);
    f.advance(6);
    f.scheduler.replied(f.inbound);
    await f.scheduler.tick(send);
    expect(send).not.toHaveBeenCalled();
    f.advance(6);
    await f.scheduler.tick(send);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("handles overnight quiet hours and the disabled quiet-period convention", () => {
    expect(quietNow("22:00", "08:00", new Date(2026, 9, 22, 23))).toBe(true);
    expect(quietNow("22:00", "08:00", new Date(2026, 9, 22, 7))).toBe(true);
    expect(quietNow("22:00", "08:00", new Date(2026, 9, 22, 8))).toBe(false);
    expect(quietNow("08:00", "08:00", new Date())).toBe(false);
  });
  it("requires a current authorized inbound context and stops after one unanswered attempt", async () => {
    const f = await setup();
    const send = vi.fn().mockResolvedValue(true);
    await f.scheduler.tick(send);
    expect(send).not.toHaveBeenCalled();
    f.scheduler.observe(f.inbound);
    await f.scheduler.tick(send);
    expect(send).not.toHaveBeenCalled();
    f.advance();
    await f.scheduler.tick(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].item_list[0].text_item.text).toContain(
      "并非用户新消息",
    );
    f.advance();
    await f.scheduler.tick(send);
    expect(send).toHaveBeenCalledTimes(1);
    const files = await readdir(path.join(f.root, "bridge-proactive-budget"));
    const data = await readFile(
      path.join(f.root, "bridge-proactive-budget", files[0] ?? ""),
      "utf8",
    );
    expect(data).not.toMatch(/private-token|authorized-test-peer|问候/);
    const restarted = new BridgeProactive(f.account, f.now);
    await restarted.tick(send);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not send while paused, disabled, outside selected accounts, or during quiet hours", async () => {
    const f = await setup();
    const send = vi.fn().mockResolvedValue(true);
    f.scheduler.observe(f.inbound);
    f.advance();
    await writeBridgeJson(f.root, "bridge-control.json", { paused: true });
    await f.scheduler.tick(send);
    await writeBridgeJson(f.root, "bridge-control.json", { paused: false });
    f.config.proactive.enabled = false;
    await writeBridgeJson(f.root, "bridge-behavior.json", f.config);
    await f.scheduler.tick(send);
    f.config.proactive.enabled = true;
    f.config.accountHashes = [];
    await writeBridgeJson(f.root, "bridge-behavior.json", f.config);
    await f.scheduler.tick(send);
    f.config.accountHashes = [bridgeHash(f.account)];
    f.config.proactive.quietStart = "11:00";
    f.config.proactive.quietEnd = "13:00";
    await writeBridgeJson(f.root, "bridge-behavior.json", f.config);
    await f.scheduler.tick(send);
    expect(send).not.toHaveBeenCalled();
  });
  it("blocks retries after a failed send until a fresh inbound message", async () => {
    const f = await setup();
    const send = vi.fn().mockResolvedValue(false);
    f.scheduler.observe(f.inbound);
    f.advance();
    await f.scheduler.tick(send);
    f.advance();
    await f.scheduler.tick(send);
    expect(send).toHaveBeenCalledTimes(1);
    f.scheduler.observe({ ...f.inbound, context_token: "fresh" });
    f.advance();
    await f.scheduler.tick(send);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("persists the daily attempt cap across restarts and new replies", async () => {
    const f = await setup();
    f.config.proactive.dailyLimit = 1;
    await writeBridgeJson(f.root, "bridge-behavior.json", f.config);
    const send = vi.fn().mockResolvedValue(true);
    f.scheduler.observe(f.inbound);
    f.advance();
    await f.scheduler.tick(send);
    const restarted = new BridgeProactive(f.account, f.now);
    restarted.observe(f.inbound);
    f.advance();
    await restarted.tick(send);
    expect(send).toHaveBeenCalledTimes(1);
    f.advance(1440);
    restarted.observe(f.inbound);
    f.advance();
    await restarted.tick(send);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("prevents overlapping runs and rechecks stop controls after generation", async () => {
    const f = await setup();
    f.scheduler.observe(f.inbound);
    f.advance();
    const send = vi.fn(async (_message, valid) => {
      await writeBridgeJson(f.root, "bridge-control.json", { paused: true });
      expect(valid()).toBe(false);
      return false;
    });
    await Promise.all([f.scheduler.tick(send), f.scheduler.tick(send)]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("expires old contexts and fails closed on corrupt budgets", async () => {
    const f = await setup();
    const send = vi.fn();
    f.scheduler.observe(f.inbound);
    f.advance(1441);
    await f.scheduler.tick(send);
    expect(send).not.toHaveBeenCalled();
    const files = await readdir(path.join(f.root, "bridge-proactive-budget"));
    await writeFile(
      path.join(f.root, "bridge-proactive-budget", files[0] ?? ""),
      "{bad",
    );
    expect(() => f.scheduler.observe(f.inbound)).not.toThrow();
    await f.scheduler.tick(send);
    expect(send).not.toHaveBeenCalled();
  });
});
