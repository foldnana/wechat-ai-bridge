import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "#controller/app/container";
import { createApp } from "#controller/app/create-app";
import {
  behaviorSchema,
  decodeSticker,
  readStickers,
  writeBridgeJson,
} from "#controller/services/bridge-behavior";
import {
  contactSettingsSchema,
  saveContactProfile,
} from "#controller/services/bridge-contacts";
import { ensureDefaultStickers } from "#controller/services/bridge-default-stickers";
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
  it("ignores retired expression controls while keeping actual delivery settings bounded", () => {
    const config = behaviorSchema.parse({
      followUp: "rare",
      examples: "对方：晚安。回复：明天见。",
      delivery: { mode: "natural" },
    });
    expect(config).not.toHaveProperty("followUp");
    expect(config).not.toHaveProperty("examples");
    expect(behaviorSchema.safeParse({ delivery: { pauseMs: 0 } }).success).toBe(
      false,
    );
    expect(
      behaviorSchema.safeParse({ delivery: { maxBubbles: 4 } }).success,
    ).toBe(false);
  });
  it("defaults to no stickers and no proactive messages, with bounded settings", () => {
    expect(behaviorSchema.parse({})).toMatchObject({
      persona: "whale",
      incoming: { mode: "auto", waitMs: 4000 },
      delivery: { mode: "natural", maxBubbles: 2 },
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
          responseIntent: "listen", // Legacy clients cannot lock a conversation into a mode.
          incoming: { waitMs: 20000 },
          persona: "none",
          followUp: "rare",
          examples: "对方：忙完了。回复：先歇会儿。",
          delivery: { mode: "natural", maxBubbles: 3, pauseMs: 1800 },
          proactive: { enabled: true, channelIds: ["wechat"] },
        })
      ).status,
    ).toBe(200);
    expect(loadBehavior()?.accountHashes).toEqual([bridgeHash(account)]);
    expect(loadBehavior()?.incoming.waitMs).toBe(20000);
    expect(loadBehavior()?.incoming.mode).toBe("fixed");
    expect(loadBehavior()?.delivery).toEqual({
      mode: "natural",
      maxBubbles: 3,
      pauseMs: 1800,
    });
    const saved = JSON.parse(
      await readFile(path.join(root, "bridge-behavior.json"), "utf8"),
    );
    for (const field of [
      "responseIntent",
      "tone",
      "followUp",
      "examples",
      "promptContext",
    ])
      expect(saved).not.toHaveProperty(field);
    expect(saved.persona).toBe("none");
    const roundTrip = await (
      await app.request("/api/v1/bridge/behavior")
    ).json();
    expect(roundTrip).toMatchObject({
      incoming: { waitMs: 20000 },
      delivery: { mode: "natural", maxBubbles: 3, pauseMs: 1800 },
    });
    for (const field of [
      "responseIntent",
      "tone",
      "followUp",
      "examples",
      "promptContext",
    ])
      expect(roundTrip).not.toHaveProperty(field);
    expect(
      (await (await app.request("/api/v1/bridge/behavior")).json()).persona,
    ).toBe("none");
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
    const items = await response.json();
    const item = items.find(
      (entry: { label: string }) => entry.label === "开心",
    );
    expect(items).toHaveLength(6);
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
    const files = await readdir(path.join(root, "bridge-stickers"));
    expect(files).toHaveLength(5);
    expect(files).not.toContain(`${item.id}.png`);
  });
  it("adds bundled pictures once, serves bundled images, and respects a user's deletion", async () => {
    const { root } = await setup();
    const app = createApp({
      env: { openclawStateDir: root, webUrl: "http://localhost:5173" },
      channelService: { listChannels: async () => [] },
    } as unknown as ControllerContainer);
    const response = await app.request("/api/v1/bridge/stickers");
    expect(response.status).toBe(200);
    const items = await response.json();
    expect(items.map((item: { label: string }) => item.label)).toEqual([
      "大肥鱼·吃饭时间",
      "大肥鱼·你好呀",
      "大肥鱼·歇一会儿",
      "大肥鱼·吃什么呢",
      "大肥鱼·没吃饱喵",
    ]);
    for (const item of items) {
      const preview = await app.request(
        `/api/v1/bridge/stickers/${item.id}/image`,
      );
      expect(preview.status).toBe(200);
      const bytes = Buffer.from(await preview.arrayBuffer());
      expect(preview.headers.get("content-type")).toBe(
        `image/${item.extension}`,
      );
      if (item.extension === "webp") {
        expect(
          decodeSticker(`data:image/webp;base64,${bytes.toString("base64")}`)
            .extension,
        ).toBe("webp");
      } else {
        // Original bundled PNGs may exceed the user-upload limit of 2 MB.
        expect(bytes.subarray(0, 8)).toEqual(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        );
      }
    }
    expect(loadBehavior()?.stickers.enabled).toBe(false);
    expect(
      (
        await app.request(`/api/v1/bridge/stickers/${items[0].id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    expect(await ensureDefaultStickers(root)).toHaveLength(4);
    expect(await readStickers(root)).not.toContainEqual(items[0]);
  });
  it("keeps existing stickers and the 24-image limit, including after capacity is freed", async () => {
    const { root } = await setup();
    const existing = Array.from({ length: 23 }, (_, i) => ({
      id: randomUUID(),
      label: `自选 ${i}`,
      tags: "开心",
      extension: "png",
    }));
    await writeBridgeJson(root, "bridge-stickers.json", existing);
    const items = await ensureDefaultStickers(root);
    expect(items).toHaveLength(24);
    expect(items.slice(0, 23)).toEqual(existing);
    await writeBridgeJson(root, "bridge-stickers.json", items.slice(1));
    expect(await ensureDefaultStickers(root)).toHaveLength(23);
  });
  it("does not overwrite a damaged user library with defaults", async () => {
    const { root } = await setup();
    await writeFile(path.join(root, "bridge-stickers.json"), "{broken");
    await expect(ensureDefaultStickers(root)).rejects.toThrow(
      "表情图库无法读取",
    );
    expect(
      await readFile(path.join(root, "bridge-stickers.json"), "utf8"),
    ).toBe("{broken");
  });
  it("replaces retired defaults on upgrade without deleting user imports", async () => {
    const { root } = await setup();
    await ensureDefaultStickers(root);
    const retired = [1, 2, 3, 4].map((n) => ({
      id: `9c786dee-6910-41fc-a269-55d79487910${n}`,
      label: "旧默认表情",
      tags: "旧图库",
      extension: "png",
    }));
    const personal = {
      id: randomUUID(),
      label: "我的表情",
      tags: "个人",
      extension: "png",
    };
    for (const item of [...retired, personal]) {
      await writeFile(
        path.join(root, "bridge-stickers", `${item.id}.png`),
        "keep-or-retire",
      );
    }
    await rm(path.join(root, "bridge-whale-stickers-v4.json"));
    await writeBridgeJson(root, "bridge-whale-stickers-v1.json", {
      version: 1,
    });
    await writeBridgeJson(root, "bridge-stickers.json", [...retired, personal]);
    const upgraded = await ensureDefaultStickers(root);
    expect(upgraded).toHaveLength(6);
    expect(upgraded).toContainEqual(personal);
    expect(
      upgraded.some((item) => retired.some((old) => old.id === item.id)),
    ).toBe(false);
    for (const old of retired) {
      await expect(
        readFile(path.join(root, "bridge-stickers", `${old.id}.png`)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(
      await readFile(
        path.join(root, "bridge-stickers", `${personal.id}.png`),
        "utf8",
      ),
    ).toBe("keep-or-retire");
    expect(await ensureDefaultStickers(root)).toHaveLength(6);
  });
  it("removes rejected v2 art without restoring deleted images or removing user imports", async () => {
    const { root } = await setup();
    const defaults = await ensureDefaultStickers(root);
    const rejected = [1, 2, 3, 4].map((n) => ({
      id: `9c786dee-6910-41fc-a269-55d79487920${n}`,
      label: "被否定的 Q 版",
      tags: "旧图库",
      extension: "webp",
    }));
    const personal = {
      id: randomUUID(),
      label: "自选",
      tags: "开心",
      extension: "png",
    };
    await rm(path.join(root, "bridge-whale-stickers-v4.json"));
    await writeBridgeJson(root, "bridge-whale-stickers-v2.json", {
      version: 2,
    });
    await writeBridgeJson(root, "bridge-stickers.json", [
      ...defaults.slice(1),
      ...rejected,
      personal,
    ]);
    for (const item of rejected) {
      await writeFile(
        path.join(root, "bridge-stickers", `${item.id}.webp`),
        "retired",
      );
    }
    const expected = [...defaults.slice(1), personal];
    expect(await ensureDefaultStickers(root)).toEqual(expected);
    expect(await ensureDefaultStickers(root)).toEqual(expected);
    for (const item of rejected) {
      await expect(
        readFile(path.join(root, "bridge-stickers", `${item.id}.webp`)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
  it.each([2, 3])(
    "adds the supplied image once when upgrading v%s and preserves deletions",
    async (version) => {
      const { root } = await setup();
      const defaults = await ensureDefaultStickers(root);
      const added = defaults.find((item) => item.label === "大肥鱼·没吃饱喵");
      expect(added).toBeDefined();
      const previous = defaults.filter((item) => item !== added).slice(1);
      await rm(path.join(root, "bridge-whale-stickers-v4.json"));
      await writeBridgeJson(root, `bridge-whale-stickers-v${version}.json`, {
        version,
      });
      await writeBridgeJson(root, "bridge-stickers.json", previous);
      expect(await ensureDefaultStickers(root)).toEqual([...previous, added]);
      await writeBridgeJson(root, "bridge-stickers.json", previous);
      expect(await ensureDefaultStickers(root)).toEqual(previous);
    },
  );
  it("rejects forged WebP and permits imported WebP in the runtime selector", async () => {
    expect(() =>
      decodeSticker(
        `data:image/webp;base64,${Buffer.from("not a WebP picture").toString("base64")}`,
      ),
    ).toThrow();
    const { root, config, now } = await setup();
    const item = {
      id: randomUUID(),
      label: "自选 WebP",
      tags: "开心",
      extension: "webp",
    };
    await writeBridgeJson(root, "bridge-stickers.json", [item]);
    config.stickers = { enabled: true, probability: 100, cooldownMinutes: 1 };
    await writeBridgeJson(root, "bridge-behavior.json", config);
    expect(
      chooseSticker(`[[sticker:${item?.id}]]`, randomUUID(), now(), () => 0),
    ).toBe(path.join(root, "bridge-stickers", `${item?.id}.webp`));
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
});
describe("opt-in proactive scheduling", () => {
  it("uses a recent topic and time, cancels on fresh inbound, and respects per-contact opt-out", async () => {
    const f = await setup();
    f.scheduler.observe({
      ...f.inbound,
      item_list: [{ type: 1, text_item: { text: "明天有面试" } }],
    });
    f.advance();
    const send = vi.fn(async (message, valid) => {
      expect(message.item_list[0].text_item.text).toContain("明天有面试");
      expect(message.item_list[0].text_item.text).toContain("上次收到消息");
      f.scheduler.invalidate(f.inbound.from_user_id);
      expect(valid()).toBe(false);
      return false;
    });
    await f.scheduler.tick(send);
    const id = bridgeHash(`${f.account}\0${f.inbound.from_user_id}`);
    await saveContactProfile(
      f.root,
      id,
      contactSettingsSchema.parse({ proactive: "off" }),
    );
    f.scheduler.observe(f.inbound);
    f.advance();
    await f.scheduler.tick(send);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("waits after goodnight and leaves the previous topic out in greeting mode", async () => {
    const f = await setup();
    f.scheduler.observe({
      ...f.inbound,
      item_list: [{ type: 1, text_item: { text: "晚安，先睡了" } }],
    });
    f.advance();
    const send = vi.fn().mockResolvedValue(true);
    await f.scheduler.tick(send);
    expect(send).not.toHaveBeenCalled();
    const id = bridgeHash(`${f.account}\0${f.inbound.from_user_id}`);
    await saveContactProfile(
      f.root,
      id,
      contactSettingsSchema.parse({ topicMode: "greeting" }),
    );
    f.scheduler.observe({
      ...f.inbound,
      item_list: [{ type: 1, text_item: { text: "不应被翻出的私密话题" } }],
    });
    f.advance();
    await f.scheduler.tick(send);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].item_list[0].text_item.text).not.toContain(
      "不应被翻出的私密话题",
    );
    expect(send.mock.calls[0]?.[0].item_list[0].text_item.text).toContain(
      "轻量问候",
    );
  });
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
