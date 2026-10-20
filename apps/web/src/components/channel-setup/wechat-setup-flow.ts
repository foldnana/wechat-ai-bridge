import {
  postApiV1ChannelsWechatConnect,
  postApiV1ChannelsWechatQrStart,
  postApiV1ChannelsWechatQrWait,
} from "../../../lib/api/sdk.gen";

export type WechatSetupPhase =
  | "idle"
  | "loading"
  | "scanning"
  | "saving"
  | "done"
  | "error";

function delay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 2000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function runWechatSetup(
  signal: AbortSignal,
  phase: (phase: WechatSetupPhase) => void,
  qr: (value: string) => void,
) {
  phase("loading");
  let sessionKey: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    try {
      const { data } = await postApiV1ChannelsWechatQrStart({
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
      signal.throwIfAborted();
      if (data?.sessionKey && data.qrDataUrl) {
        sessionKey = data.sessionKey;
        qr(data.qrDataUrl);
        break;
      }
    } catch {
      signal.throwIfAborted();
    }
    if (attempt < 2) await delay(signal);
  }
  if (!sessionKey)
    throw new Error("获取二维码失败，请检查网络及本地服务，然后重试。");
  phase("scanning");
  const { data, error } = await postApiV1ChannelsWechatQrWait({
    body: { sessionKey },
    signal: AbortSignal.any([signal, AbortSignal.timeout(310_000)]),
  }).catch(() => {
    throw new Error("等待扫码超时或连接中断，请重新获取二维码。");
  });
  signal.throwIfAborted();
  if (error || !data?.connected || !data.accountId) {
    throw new Error("二维码已过期、未确认或连接中断，请重新扫码。");
  }
  phase("saving");
  const result = await postApiV1ChannelsWechatConnect({
    body: { accountId: data.accountId },
    signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
  }).catch(() => {
    throw new Error(
      "授权同步超时，请先刷新首页检查是否已保存，再决定是否重试。",
    );
  });
  signal.throwIfAborted();
  if (result.error || !result.data)
    throw new Error("授权保存失败，请检查本地服务后重新扫码。");
}
