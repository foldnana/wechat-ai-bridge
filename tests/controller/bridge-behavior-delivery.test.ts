import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  behaviorSchema,
  writeBridgeJson,
} from "#controller/services/bridge-behavior";
import {
  contactSettingsSchema,
  saveContactProfile,
} from "#controller/services/bridge-contacts";
import {
  type ProcessMessageDeps,
  processOneMessage,
} from "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/process-message";
import { bridgeHash } from "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/storage/bridge-behavior";

const calls = vi.hoisted(() => ({
  text: vi.fn(),
  media: vi.fn(),
  notice: vi.fn(),
  authorized: true,
  context: vi.fn(),
}));
vi.mock("openclaw/plugin-sdk", () => ({
  createTypingCallbacks: () => ({}),
  resolvePreferredOpenClawTmpDir: () => "unused-test-temp",
  resolveDirectDmAuthorizationOutcome: () =>
    calls.authorized ? "allowed" : "unauthorized",
  resolveSenderCommandAuthorizationWithRuntime: async () => ({
    senderAllowedForCommands: calls.authorized,
    commandAuthorized: false,
  }),
}));
vi.mock(
  "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/util/logger",
  () => ({
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }),
);
vi.mock(
  "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/send",
  () => ({
    markdownToPlainText: (text: string) => text,
    sendMessageWeixin: calls.text,
  }),
);
vi.mock(
  "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/send-media",
  () => ({ sendWeixinMediaFile: calls.media }),
);
vi.mock(
  "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/error-notice",
  () => ({ sendWeixinErrorNotice: calls.notice }),
);
vi.mock(
  "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/debug-mode",
  () => ({ isDebugMode: () => false }),
);
vi.mock(
  "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/slash-commands",
  () => ({ handleSlashCommand: async () => ({ handled: false }) }),
);
vi.mock(
  "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/media/media-download",
  () => ({ downloadMediaFromItem: vi.fn() }),
);
vi.mock(
  "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/cdn/upload",
  () => ({ downloadRemoteImageToTemp: vi.fn() }),
);
vi.mock(
  "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/api/api",
  () => ({ sendTyping: vi.fn() }),
);
vi.mock(
  "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/auth/accounts",
  () => ({ loadWeixinAccount: () => ({ userId: "test-peer" }) }),
);
vi.mock(
  "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/auth/pairing",
  () => ({ readFrameworkAllowFromList: () => ["test-peer"] }),
);
const dirs: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  calls.authorized = true;
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function harness(text: string, beforeDelivery = () => {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bridge-delivery-"));
  dirs.push(root);
  vi.stubEnv("OPENCLAW_STATE_DIR", root);
  let deliver: (payload: { text: string }) => Promise<void> = async () => {};
  const deps = {
    accountId: randomUUID(),
    config: {},
    baseUrl: "https://wechat.invalid",
    cdnBaseUrl: "https://cdn.invalid",
    token: "test-token",
    log: vi.fn(),
    errLog: vi.fn(),
    onAuthorized: vi.fn(),
    channelRuntime: {
      commands: {},
      routing: {
        resolveAgentRoute: () => ({
          agentId: "bot",
          sessionKey: "test-session",
          mainSessionKey: "test-session",
        }),
      },
      session: {
        resolveStorePath: () => "unused-test-store",
        recordInboundSession: vi.fn(),
      },
      reply: {
        finalizeInboundContext: (ctx: unknown) => {
          calls.context(ctx);
          return ctx;
        },
        resolveHumanDelayConfig: () => ({}),
        createReplyDispatcherWithTyping: (options: {
          deliver: typeof deliver;
        }) => {
          deliver = options.deliver;
          return {
            dispatcher: {},
            replyOptions: {},
            markDispatchIdle: vi.fn(),
          };
        },
        withReplyDispatcher: async ({ run }: { run: () => Promise<void> }) =>
          run(),
        dispatchReplyFromConfig: async () => {
          beforeDelivery();
          await deliver({ text });
        },
      },
    },
  } as unknown as ProcessMessageDeps;
  const full = {
    from_user_id: "test-peer",
    context_token: "context-for-test-peer",
    item_list: [{ type: 1, text_item: { text: "你好" } }],
  };
  return { root, deps, full };
}
describe("behavior settings in the actual reply delivery path", () => {
  it("cancels remaining bubbles if contact memories are cleared during a reply", async () => {
    const f = await harness("终于可以喘一口气了。今天真的辛苦你啦！");
    const id = bridgeHash(`${f.deps.accountId}\0test-peer`);
    await saveContactProfile(
      f.root,
      id,
      contactSettingsSchema.parse({
        memoryEnabled: true,
        memories: ["以前的备忘"],
      }),
    );
    await writeBridgeJson(f.root, "bridge-behavior.json", {
      ...behaviorSchema.parse({ delivery: { mode: "natural", pauseMs: 500 } }),
      accountHashes: [],
    });
    calls.text.mockImplementationOnce(async () => {
      await saveContactProfile(f.root, id, contactSettingsSchema.parse({}));
    });
    expect(await processOneMessage(f.full, f.deps)).toBe(false);
    expect(calls.text).toHaveBeenCalledTimes(1);
  });
  it("injects only the current contact's enabled notes as system context, not user messages", async () => {
    const f = await harness("回复");
    await saveContactProfile(
      f.root,
      bridgeHash(`${f.deps.accountId}\0test-peer`),
      contactSettingsSchema.parse({
        nickname: "小明",
        memoryEnabled: true,
        memories: ["不喜欢剧透"],
      }),
    );
    await saveContactProfile(
      f.root,
      bridgeHash(`${f.deps.accountId}\0other-peer`),
      contactSettingsSchema.parse({
        memoryEnabled: true,
        memories: ["另一个人的资料"],
      }),
    );
    await processOneMessage(f.full, f.deps);
    const ctx = calls.context.mock.calls[0]?.[0];
    expect(ctx.GroupSystemPrompt).toContain("不喜欢剧透");
    expect(ctx.GroupSystemPrompt).not.toContain("另一个人的资料");
    expect(ctx.Body).toBe("你好");
  });
  it("uses saved rhythm in real delivery and keeps the same context for every bubble", async () => {
    const text = "终于可以喘一口气了。今天真的辛苦你啦！";
    const f = await harness(text);
    await writeBridgeJson(f.root, "bridge-behavior.json", {
      ...behaviorSchema.parse({ delivery: { mode: "natural", pauseMs: 500 } }),
      accountHashes: [],
    });
    expect(await processOneMessage(f.full, f.deps)).toBe(true);
    expect(calls.text).toHaveBeenCalledTimes(2);
    expect(calls.text.mock.calls.map(([call]) => call.text).join("")).toBe(
      text,
    );
    for (const [call] of calls.text.mock.calls)
      expect(call.opts.contextToken).toBe("context-for-test-peer");
  });
  it("stops unsent bubbles when automatic replies are paused during delivery", async () => {
    const f = await harness("终于可以喘一口气了。今天真的辛苦你啦！");
    await writeBridgeJson(f.root, "bridge-behavior.json", {
      ...behaviorSchema.parse({ delivery: { mode: "natural", pauseMs: 500 } }),
      accountHashes: [],
    });
    calls.text.mockImplementationOnce(async () => {
      await writeBridgeJson(f.root, "bridge-control.json", { paused: true });
    });
    expect(await processOneMessage(f.full, f.deps)).toBe(false);
    expect(calls.text).toHaveBeenCalledTimes(1);
  });
  it("strips control markers and sends the selected local image with the same conversation context", async () => {
    const id = randomUUID();
    const f = await harness(`真好！ [[sticker:${id}]]`);
    await writeBridgeJson(f.root, "bridge-behavior.json", {
      ...behaviorSchema.parse({
        stickers: { enabled: true, probability: 100 },
      }),
      accountHashes: [],
    });
    await writeBridgeJson(f.root, "bridge-stickers.json", [
      { id, label: "赞同", tags: "开心", extension: "png" },
    ]);
    expect(await processOneMessage(f.full, f.deps)).toBe(true);
    expect(f.deps.onAuthorized).toHaveBeenCalledWith(f.full);
    expect(calls.text).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "真好！",
        to: "test-peer",
        opts: expect.objectContaining({
          contextToken: "context-for-test-peer",
        }),
      }),
    );
    expect(calls.media).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: path.join(f.root, "bridge-stickers", `${id}.png`),
        to: "test-peer",
        text: "",
        opts: expect.objectContaining({
          contextToken: "context-for-test-peer",
        }),
      }),
    );
  });
  it("never sends model-selected sticker paths outside the imported library", async () => {
    const f = await harness("你好 [[sticker:../../secret.txt]]");
    await processOneMessage(f.full, f.deps);
    expect(calls.media).not.toHaveBeenCalled();
    expect(calls.text).toHaveBeenCalledWith(
      expect.objectContaining({ text: "你好" }),
    );
  });
  it("does not send a proactive result after the stop condition changes during generation", async () => {
    let valid = true;
    const f = await harness("问候", () => {
      valid = false;
    });
    f.deps.proactiveValid = () => valid;
    expect(await processOneMessage(f.full, f.deps)).toBe(false);
    expect(calls.text).not.toHaveBeenCalled();
    expect(calls.media).not.toHaveBeenCalled();
    expect(f.deps.onAuthorized).not.toHaveBeenCalled();
  });
  it("never registers an unauthorized sender for proactive chat", async () => {
    calls.authorized = false;
    const f = await harness("回复");
    expect(await processOneMessage(f.full, f.deps)).toBe(false);
    expect(f.deps.onAuthorized).not.toHaveBeenCalled();
    expect(calls.text).not.toHaveBeenCalled();
  });
});
