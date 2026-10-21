import { describe, expect, it } from "vitest";
import {
  replyBubbles,
  sendReplyBubbles,
} from "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/bridge-reply-rhythm";

const config = { mode: "natural", maxBubbles: 2, pauseMs: 500 } as const;
describe("natural reply delivery", () => {
  it("preserves every character and limits bubbles without cutting sentences", () => {
    const text =
      "终于可以喘一口气了。今天真的辛苦你啦！\n晚上可以好好歇一会儿。";
    const bubbles = replyBubbles(text, text, config);
    expect(bubbles).toHaveLength(2);
    expect(bubbles.join("")).toBe(text);
    expect(bubbles[0]).toBe("终于可以喘一口气了。");
    expect(replyBubbles("好，晚安。", "好，晚安。", config)).toEqual([
      "好，晚安。",
    ]);
  });
  it.each([
    "文档在这里哦。https://example.com/a?next=yes。你可以看看。",
    "解释在这里。\n```js\nconsole.log(1)\n```",
    "这是两个步骤。\n1. 第一步\n2. 第二步",
    "她说：“今天真的好开心！终于能歇一会儿了。”",
    "这是很长的解释。".repeat(60),
  ])("keeps structured or long responses intact", (text) => {
    expect(replyBubbles(text, text, config)).toEqual([text]);
  });
  it("sends the first bubble immediately and aborts a pending pause", async () => {
    const abort = new AbortController();
    const sent: string[] = [];
    const result = sendReplyBubbles(
      ["第一条", "第二条"],
      3000,
      async (text) => {
        sent.push(text);
      },
      () => true,
      abort.signal,
    );
    expect(sent).toEqual(["第一条"]);
    await Promise.resolve();
    abort.abort();
    expect(await result).toBe(false);
    expect(sent).toEqual(["第一条"]);
  });
  it("checks stop conditions again after waiting and stops on send failure", async () => {
    let valid = true;
    const sent: string[] = [];
    const result = sendReplyBubbles(
      ["第一条", "第二条"],
      10,
      async (text) => {
        sent.push(text);
      },
      () => valid,
    );
    await Promise.resolve();
    valid = false;
    expect(await result).toBe(false);
    expect(sent).toEqual(["第一条"]);
    await expect(
      sendReplyBubbles(
        ["失败", "不发送"],
        0,
        async () => {
          throw new Error("send failed");
        },
        () => true,
      ),
    ).rejects.toThrow("send failed");
  });
});
