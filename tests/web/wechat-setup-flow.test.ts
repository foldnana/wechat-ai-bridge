import { afterEach, describe, expect, it, vi } from "vitest";
import {
  postApiV1ChannelsWechatConnect,
  postApiV1ChannelsWechatQrStart,
  postApiV1ChannelsWechatQrWait,
} from "../../apps/web/lib/api/sdk.gen";
import { runWechatSetup } from "../../apps/web/src/components/channel-setup/wechat-setup-flow";
vi.mock("../../apps/web/lib/api/sdk.gen", () => ({
  postApiV1ChannelsWechatQrStart: vi.fn(),
  postApiV1ChannelsWechatQrWait: vi.fn(),
  postApiV1ChannelsWechatConnect: vi.fn(),
}));
afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe("bounded and cancellable WeChat authorization", () => {
  it("stops after three unsuccessful QR requests", async () => {
    vi.useFakeTimers();
    vi.mocked(postApiV1ChannelsWechatQrStart).mockResolvedValue({} as never);
    const attempt = runWechatSetup(
      new AbortController().signal,
      vi.fn(),
      vi.fn(),
    );
    const assertion = expect(attempt).rejects.toThrow("获取二维码失败");
    await vi.runAllTimersAsync();
    await assertion;
    expect(postApiV1ChannelsWechatQrStart).toHaveBeenCalledTimes(3);
    expect(postApiV1ChannelsWechatQrWait).not.toHaveBeenCalled();
  });
  it("does not save an expired authorization", async () => {
    vi.mocked(postApiV1ChannelsWechatQrStart).mockResolvedValue({
      data: { sessionKey: "test-session", qrDataUrl: "test-qr" },
    } as never);
    vi.mocked(postApiV1ChannelsWechatQrWait).mockResolvedValue({
      data: { connected: false },
    } as never);
    await expect(
      runWechatSetup(new AbortController().signal, vi.fn(), vi.fn()),
    ).rejects.toThrow("过期");
    expect(postApiV1ChannelsWechatConnect).not.toHaveBeenCalled();
  });
  it("stops a cancelled wait before saving, even when a stale result arrives", async () => {
    const controller = new AbortController();
    vi.mocked(postApiV1ChannelsWechatQrStart).mockResolvedValue({
      data: { sessionKey: "test-session", qrDataUrl: "test-qr" },
    } as never);
    vi.mocked(postApiV1ChannelsWechatQrWait).mockImplementation(async () => {
      controller.abort();
      return { data: { connected: true, accountId: "test-account" } } as never;
    });
    await expect(
      runWechatSetup(controller.signal, vi.fn(), vi.fn()),
    ).rejects.toThrow();
    expect(postApiV1ChannelsWechatConnect).not.toHaveBeenCalled();
  });
  it("uses real loading, scanning and saving states without claiming a model reply", async () => {
    vi.mocked(postApiV1ChannelsWechatQrStart).mockResolvedValue({
      data: { sessionKey: "test-session", qrDataUrl: "test-qr" },
    } as never);
    vi.mocked(postApiV1ChannelsWechatQrWait).mockResolvedValue({
      data: { connected: true, accountId: "test-account" },
    } as never);
    vi.mocked(postApiV1ChannelsWechatConnect).mockResolvedValue({
      data: { id: "test-channel" },
    } as never);
    const phase = vi.fn();
    await runWechatSetup(new AbortController().signal, phase, vi.fn());
    expect(phase.mock.calls.flat()).toEqual(["loading", "scanning", "saving"]);
    expect(postApiV1ChannelsWechatConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { accountId: "test-account" },
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
