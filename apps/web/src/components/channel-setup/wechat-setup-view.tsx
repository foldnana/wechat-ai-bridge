import { ArrowUpRight, Loader2, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { parseWechatQr } from "./wechat-qr";
import { type WechatSetupPhase, runWechatSetup } from "./wechat-setup-flow";

export interface WechatSetupViewProps {
  onConnected: () => void;
  disabled?: boolean;
  disabledReason?: string;
  gatewayReady?: boolean;
  showHeader?: boolean;
}

export function WechatSetupView({
  onConnected,
  disabled,
  disabledReason,
  showHeader = true,
}: WechatSetupViewProps) {
  const [phase, setPhase] = useState<WechatSetupPhase>("idle");
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState("");
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);
  const busy = ["loading", "scanning", "saving"].includes(phase);
  const parsedQr = qr ? parseWechatQr(qr) : null;
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
    <div className="bridge-panel bridge-qr">
      <div className="bridge-qr-copy">
        <span className="bridge-eyebrow">STEP 02 · WECHAT</span>
        {showHeader && <h3>用手机微信完成授权</h3>}
        <ol className="bridge-form-guide bridge-qr-instructions">
          <li>
            <span>1</span>点击「获取微信授权二维码」。
          </li>
          <li>
            <span>2</span>打开手机微信，点右上角「+ → 扫一扫」。
          </li>
          <li>
            <span>3</span>扫描本页二维码，在手机上确认，再等此页显示授权结果。
          </li>
        </ol>
        <output className="bridge-qr-status" aria-live="polite">
          {phase === "loading" && "正在获取微信二维码（最多尝试 3 次）…"}
          {phase === "scanning" &&
            "请用微信扫码，并在手机上确认；二维码约 5 分钟内有效。"}
          {phase === "saving" && "微信已确认，正在保存授权并同步本地服务…"}
          {phase === "done" && "授权已保存，接下来会检查服务是否就绪。"}
          {phase === "idle" &&
            (disabled
              ? (disabledReason ??
                "请先完成第 1 步，测试并保存模型，再来获取二维码。")
              : "获取二维码后，使用微信扫码并在手机上确认授权。")}
        </output>
        {error && (
          <p role="alert" className="bridge-feedback is-error">
            {error}
          </p>
        )}
        {busy ? (
          <button
            type="button"
            className="bridge-button bridge-button-secondary"
            onClick={() => {
              current.current?.abort();
              setPhase("idle");
              setQr(null);
            }}
          >
            <Loader2 size={16} className="bridge-spin" />
            取消等待
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={start}
            className="bridge-button"
          >
            {phase === "error" || phase === "done"
              ? "重新获取二维码"
              : "获取微信授权二维码"}
            <ArrowUpRight size={16} />
          </button>
        )}
        <details className="bridge-qr-help">
          <summary>扫不出来，或手机提示无效？</summary>
          <p>
            请用手机微信的「扫一扫」，不要使用付款或收款入口。保持二维码完整可见；提示过期或无效时，取消等待并重新获取。若手机提示暂不支持此功能，请按微信页面的说明处理。
          </p>
        </details>
      </div>
      <div className="bridge-qr-picture">
        {parsedQr && phase === "scanning" ? (
          parsedQr.kind === "image" ? (
            <img
              src={parsedQr.value}
              alt="微信授权二维码"
              width={224}
              height={224}
              onError={() => {
                current.current?.abort();
                setQr(null);
                setPhase("error");
                setError("二维码图片加载失败，请检查网络后重新获取。");
              }}
            />
          ) : (
            <QRCodeSVG
              value={parsedQr.value}
              size={224}
              level="M"
              marginSize={4}
              bgColor="#ffffff"
              fgColor="#000000"
              title="微信授权二维码"
            />
          )
        ) : (
          <div className="bridge-qr-placeholder" aria-hidden="true">
            {busy ? (
              <Loader2 size={35} className="bridge-spin" />
            ) : (
              <QrCode size={50} strokeWidth={1} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
