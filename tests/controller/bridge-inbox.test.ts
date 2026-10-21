import { afterEach, describe, expect, it, vi } from "vitest";
import type { WeixinMessage } from "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/api/types";
import { BridgeInbox } from "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/bridge-inbox";

afterEach(() => vi.useRealTimers());
const msg = (
  text: string,
  peer = "alice",
  token = "latest",
): WeixinMessage => ({
  from_user_id: peer,
  context_token: token,
  item_list: [{ type: 1, text_item: { text } }],
});
function setup(run = vi.fn().mockResolvedValue(undefined), wait = 12000) {
  vi.useFakeTimers();
  let version = "first";
  const error = vi.fn();
  const inbox = new BridgeInbox({
    run,
    waitMs: () => wait,
    version: () => version,
    paused: () => false,
    error,
  });
  return {
    inbox,
    run,
    error,
    pauseAndResume: () => {
      version = "resumed";
    },
  };
}
describe("continuous inbound chat", () => {
  it("merges across polls only for the same peer and uses the final context token", async () => {
    const f = setup();
    await f.inbox.add(msg("明天面试", "alice", "old"));
    await vi.advanceTimersByTimeAsync(8000);
    expect(f.run).not.toHaveBeenCalled();
    await f.inbox.add(msg("有点紧张"));
    await f.inbox.add(msg("另外一个人的消息", "bob"));
    await vi.advanceTimersByTimeAsync(11999);
    expect(f.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.run).toHaveBeenCalledTimes(2);
    expect(f.run.mock.calls[0]?.[0]).toMatchObject({
      from_user_id: "alice",
      context_token: "latest",
      item_list: [{ text_item: { text: "明天面试\n有点紧张" } }],
    });
    expect(f.run.mock.calls[1]?.[0].from_user_id).toBe("bob");
  });
  it("bounds continuous typing and keeps commands and media separate", async () => {
    const f = setup(vi.fn().mockResolvedValue(undefined), 60000);
    await f.inbox.add(msg("第一句"));
    await vi.advanceTimersByTimeAsync(40000);
    await f.inbox.add(msg("第二句"));
    await vi.advanceTimersByTimeAsync(40000);
    await f.inbox.add(msg("第三句"));
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.run).toHaveBeenCalledTimes(1);
    await f.inbox.add(msg("新的文字"));
    await f.inbox.add({ from_user_id: "alice", item_list: [{ type: 2 }] });
    await f.inbox.add(msg("/new"));
    await f.inbox.settled();
    expect(
      f.run.mock.calls.slice(1).map(([m]) => m.item_list?.[0]?.type),
    ).toEqual([1, 2, 1]);
    expect(f.run.mock.calls[3]?.[0].item_list?.[0]?.text_item?.text).toBe(
      "/new",
    );
  });
  it("continues receiving while generation runs but never overlaps replies or proactive work", async () => {
    let release = () => {};
    const run = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            release = r;
          }),
      )
      .mockResolvedValue(undefined);
    const f = setup(run, 0);
    await f.inbox.add(msg("一"));
    await f.inbox.add(msg("二"));
    const proactive = vi.fn();
    await f.inbox.runWhenIdle(proactive);
    expect(run).toHaveBeenCalledTimes(1);
    expect(proactive).not.toHaveBeenCalled();
    release();
    await f.inbox.settled();
    expect(run).toHaveBeenCalledTimes(2);
    await f.inbox.runWhenIdle(proactive);
    expect(proactive).toHaveBeenCalledOnce();
  });
  it("discards queued text across pause/resume and cancels pending timers on shutdown", async () => {
    const f = setup();
    await f.inbox.add(msg("暂停前"));
    f.pauseAndResume();
    await vi.advanceTimersByTimeAsync(15000);
    expect(f.run).not.toHaveBeenCalled();
    await f.inbox.add(msg("退出前"));
    f.inbox.close();
    await vi.advanceTimersByTimeAsync(15000);
    expect(f.run).not.toHaveBeenCalled();
    expect(f.inbox.idle).toBe(true);
  });
  it("recovers after a failed reply without losing the next queued message", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("failure"))
      .mockResolvedValue(undefined);
    const f = setup(run, 0);
    await f.inbox.add(msg("一"));
    await f.inbox.add(msg("二"));
    await f.inbox.settled();
    expect(f.error).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
