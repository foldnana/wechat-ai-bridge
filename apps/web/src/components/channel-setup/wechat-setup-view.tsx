import { Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { type WechatSetupPhase, runWechatSetup } from "./wechat-setup-flow";

export interface WechatSetupViewProps {
  onConnected: () => void;
  disabled?: boolean;
  gatewayReady?: boolean;
  showHeader?: boolean;
}

export function WechatSetupView({
  onConnected,
  disabled,
  showHeader = true,
}: WechatSetupViewProps) {
  const [phase, setPhase] = useState<WechatSetupPhase>("idle");
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState("");
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);
  const busy = ["loading", "scanning", "saving"].includes(phase);
  async function start() {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setError("");
    setQr(null);
    try {
      await runWechatSetup(controller.signal, setPhase, setQr);
      if (!controller.signal.aborted) {
        setPhase("done");
        onConnected();
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setPhase("error");
      setError(err instanceof Error ? err.message : "连接失败，请重新扫码。");
    }
  }
  return (
    <div className="space-y-4 rounded-xl border border-border p-5">
      {showHeader && <h3 className="font-medium">微信扫码授权</h3>}
      <output className="block" aria-live="polite">
        {phase === "loading" && "正在获取微信二维码（最多尝试 3 次）…"}
        {phase === "scanning" &&
          "请用微信扫码，并在手机上确认；二维码约 5 分钟内有效。"}
        {phase === "saving" && "微信已确认，正在保存授权并同步本地服务…"}
        {phase === "done" &&
          "授权已保存，请在微信发送一条普通文字消息测试回复。"}
        {phase === "idle" && "点击下方按钮获取二维码。"}
      </output>
      {busy && <Loader2 className="animate-spin" aria-label="处理中" />}
      {qr && phase === "scanning" && (
        <div className="inline-block rounded-xl bg-white p-3">
          {qr.trim().startsWith("data:image/") ? (
            <img src={qr} alt="微信授权二维码" width={208} height={208} />
          ) : (
            <QRCodeSVG value={qr} size={208} />
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {busy ? (
        <button
          type="button"
          className="underline"
          onClick={() => {
            current.current?.abort();
            setPhase("idle");
            setQr(null);
          }}
        >
          取消等待
        </button>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={start}
          className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-40"
        >
          {phase === "error" || phase === "done" ? "重新扫码" : "获取二维码"}
        </button>
      )}
    </div>
  );
}
