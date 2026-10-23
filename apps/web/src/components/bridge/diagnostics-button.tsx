import { useQueryClient } from "@tanstack/react-query";
import { Stethoscope } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BridgeDiagnosis } from "../../../../desktop/shared/bridge-diagnosis";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";

const timingLabels: Record<string, string> = {
  "electron main module evaluated": "主程序加载",
  "app.whenReady resolved": "桌面环境就绪",
  "main window ready-to-show": "主窗口就绪",
  "local-services:listening": "本地服务可访问",
  "controller:core-ready": "配置服务就绪",
  "workspace:loaded": "操作页面加载",
  "controller:ready": "聊天后台就绪",
};

export function DiagnosticsButton({
  prominent = false,
}: { prominent?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BridgeDiagnosis | null>(null);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const cache = useQueryClient();
  const host =
    typeof window === "undefined"
      ? undefined
      : (
          window as Window & {
            nexuHost?: {
              invoke(
                channel: "bridge:diagnose" | "bridge:retry",
                payload: undefined,
              ): Promise<BridgeDiagnosis>;
            };
          }
        ).nexuHost;
  const check = useCallback(
    async (retry = false) => {
      if (lock.current) return;
      if (!host) {
        setMessage("请在桌面软件中使用诊断与重试。浏览器无法启动本机后台。");
        return;
      }
      lock.current = true;
      setBusy(true);
      setMessage("");
      try {
        const data = await host.invoke(
          retry ? "bridge:retry" : "bridge:diagnose",
          undefined,
        );
        setResult(data);
        if (retry)
          setMessage(
            data.service === "ready"
              ? "本地服务已就绪。"
              : data.service === "starting"
                ? "后台正在启动，请稍后重新检查。"
                : "服务仍未就绪，请重新打开软件；若仍失败，请保留本机日志供排查。",
          );
        void cache.invalidateQueries();
      } catch {
        setMessage("诊断未能完成，请重试；若仍失败，请重新打开软件。");
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [host, cache],
  );
  useEffect(() => {
    if (!open || result?.service !== "starting") return;
    const timer = setTimeout(() => void check(), 2000);
    return () => clearTimeout(timer);
  }, [open, result, check]);
  return (
    <>
      <button
        type="button"
        className={prominent ? "bridge-button" : "bridge-theme-trigger"}
        onClick={() => {
          setOpen(true);
          void check();
        }}
      >
        <Stethoscope size={17} />
        <span>{prominent ? "诊断并重试" : "诊断"}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bridge-dialog bridge-diagnostics-dialog">
          <DialogTitle className="bridge-dialog-title">连接诊断</DialogTitle>
          <DialogDescription className="bridge-dialog-description">
            检查本机状态，不发送试聊消息，不产生模型费用。
          </DialogDescription>
          {result && (
            <>
              <ul className="bridge-diagnostic-list">
                <li>
                  <strong>本地服务</strong>
                  <span>
                    {result.service === "ready"
                      ? "运行正常"
                      : result.service === "starting"
                        ? "正在启动"
                        : "需要恢复"}
                  </span>
                </li>
                <li>
                  <strong>模型配置</strong>
                  <span>
                    {result.model === "configured"
                      ? "已保存（未检查余额与可用性）"
                      : result.model === "missing"
                        ? "请前往模型连接填写 API"
                        : "暂时无法读取"}
                  </span>
                </li>
                <li>
                  <strong>微信连接</strong>
                  <span>
                    {result.wechat === "ready"
                      ? "通道就绪（不代表已验证收发）"
                      : result.wechat === "disconnected"
                        ? "请前往微信连接检查授权"
                        : "暂时无法读取"}
                  </span>
                </li>
              </ul>
              <details className="bridge-startup-timings">
                <summary>本次启动耗时</summary>
                <p>从程序进程启动算起；各阶段有并行工作，不能相加。</p>
                <ul className="bridge-diagnostic-list">
                  {Object.entries(timingLabels).map(([stage, label]) => {
                    const timing = result.timings.find(
                      (item) => item.stage === stage,
                    );
                    return (
                      <li key={stage}>
                        <span>{label}</span>
                        <span>
                          {timing
                            ? `${(timing.elapsedMs / 1000).toFixed(2)} 秒`
                            : "尚未记录"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </details>
            </>
          )}
          <output aria-live="polite" className="bridge-feedback">
            {busy ? "正在检查本地服务…" : message}
          </output>
          <p className="bridge-form-disclosure">
            重试只恢复异常的本地服务，保留
            API、预设和微信授权；可能中断正在进行的回复。授权失效或 API
            额度不足需分别处理。
          </p>
          <div className="bridge-diagnostic-actions">
            <button
              type="button"
              className="bridge-button"
              disabled={busy || !host}
              onClick={() => void check()}
            >
              重新检查
            </button>
            <button
              type="button"
              className="bridge-button"
              disabled={
                busy || !host || !result || result.service !== "unavailable"
              }
              onClick={() => void check(true)}
            >
              重试启动服务
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
