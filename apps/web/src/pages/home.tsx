import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Laptop,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ConnectionScene } from "../components/bridge/connection-scene";
import { DiagnosticsButton } from "../components/bridge/diagnostics-button";
import { WhaleCompanion } from "../components/bridge/whale-companion";
import { useBridgeStatus } from "../hooks/use-bridge-status";

export const SUGGESTED_MESSAGE = "你好，介绍一下你能帮我做什么。";
export async function copySuggestedMessage() {
  try {
    await navigator.clipboard.writeText(SUGGESTED_MESSAGE);
    toast.success("已复制，去微信粘贴发送即可。");
  } catch {
    toast.error("暂时无法复制，可以手动选中示例文字复制。");
  }
}
export function HomePage() {
  const state = useBridgeStatus();
  const [params] = useSearchParams();
  if (params.get("connect") === "1")
    return <Navigate to="/workspace/wechat" replace />;
  const {
    ready,
    paused,
    checking,
    serviceError,
    environmentStarting,
    environmentReady,
    environmentUnavailable,
    modelConfigured,
    canAuthorize,
    hasAuthorization,
    wechatReady,
    model,
    serviceState,
    control,
    pause,
    recheck,
  } = state;
  const needsRecovery = serviceError || environmentUnavailable;
  const status = needsRecovery
    ? "需要检查本地服务"
    : checking
      ? "正在检查配置"
      : ready
        ? paused
          ? "连接已就绪 · 回复已暂停"
          : "连接已就绪"
        : environmentStarting
          ? "本地服务正在启动"
          : modelConfigured
            ? "下一步 · 连接微信"
            : "从你的模型开始";
  return (
    <div className="bridge-page bridge-overview">
      <header className="bridge-page-heading">
        <div>
          <span className="bridge-eyebrow">微信 AI 接入助手</span>
          <h1>连接总览</h1>
          <p>查看模型、微信连接和自动回复状态。</p>
        </div>
        <span className="bridge-edition">
          <span />
          本机运行
        </span>
      </header>
      <div className="bridge-overview-grid">
        <section className="bridge-overview-hero" aria-label="连接概览">
          <span className="bridge-hero-kicker">
            <span
              className={`bridge-dot ${ready && !paused ? "is-live" : ""}`}
            />
            {status}
          </span>
          <h2>
            {needsRecovery ? (
              <>
                先恢复
                <br />
                <em>本地服务。</em>
              </>
            ) : checking ? (
              <>
                正在确认，
                <br />
                <em>稍等片刻。</em>
              </>
            ) : ready ? (
              <>
                连接已完成，
                <br />
                <em>去微信聊聊吧。</em>
              </>
            ) : modelConfigured ? (
              <>
                模型已配置，
                <br />
                <em>接下来连接微信。</em>
              </>
            ) : (
              <>
                填写 API，
                <br />
                <em>连接微信。</em>
              </>
            )}
          </h2>
          <p className="bridge-overview-description">
            {needsRecovery
              ? "无法读取本机配置或运行状态。请重新检查；如果仍失败，请重新打开软件。"
              : environmentStarting
                ? "本地服务正在启动，状态会自动更新，可以先配置 API。"
                : ready
                  ? "模型与微信已准备好。打开手机里的助手对话，随时开始。"
                  : modelConfigured
                    ? "模型配置已保存。前往微信连接，用手机扫码完成授权。"
                    : "先填写模型服务商提供的 API Key，再用微信扫码授权。"}
          </p>
          <div className="bridge-overview-action">
            {needsRecovery ? (
              <DiagnosticsButton prominent />
            ) : (
              <Link
                className="bridge-button"
                to={
                  ready
                    ? "/workspace/wechat"
                    : modelConfigured
                      ? "/workspace/wechat"
                      : "/workspace/models"
                }
              >
                {ready
                  ? "打开微信连接"
                  : modelConfigured
                    ? canAuthorize
                      ? "第 2 步：打开微信扫码"
                      : "查看微信连接状态"
                    : "第 1 步：配置模型 API"}
                <ArrowUpRight size={17} />
              </Link>
            )}
            <span>首次试聊可选</span>
          </div>
          <ConnectionScene />
          <div className="bridge-whale-hero">
            <WhaleCompanion />
            <span>大肥鱼：配好 API，微信见。</span>
          </div>
          <span className="bridge-overview-signature">API 自备 · 本机运行</span>
        </section>
        <section className="bridge-panel bridge-journey" aria-label="接入步骤">
          <div className="bridge-journey-title">
            <span className="bridge-eyebrow">配置进度</span>
            <h2>接入步骤</h2>
          </div>
          <Link to="/workspace/models" className="bridge-journey-step">
            <span className="bridge-journey-number">
              {modelConfigured ? <Check size={18} /> : "01"}
            </span>
            <div>
              <h3>配置模型 API</h3>
              <p>{modelConfigured ? "配置已保存" : "填写密钥 → 测试并保存"}</p>
              <span
                className="bridge-journey-detail"
                title={model.data?.modelId ?? undefined}
              >
                {modelConfigured ? model.data?.modelId : "尚未选择模型"}
              </span>
            </div>
            <ArrowUpRight size={16} />
          </Link>
          <Link to="/workspace/wechat" className="bridge-journey-step">
            <span className="bridge-journey-number">
              {wechatReady ? <Check size={18} /> : "02"}
            </span>
            <div>
              <h3>微信扫码授权</h3>
              <p>
                {wechatReady
                  ? "连接已就绪"
                  : hasAuthorization
                    ? "授权已保存，等待服务就绪"
                    : "获取二维码 → 手机确认"}
              </p>
              <span className="bridge-journey-detail">
                {canAuthorize
                  ? "准备好手机，即可开始"
                  : modelConfigured
                    ? "模型已保存，服务就绪后即可扫码"
                    : "先完成模型配置"}
              </span>
            </div>
            <ArrowUpRight size={16} />
          </Link>
          <div className="bridge-journey-environment">
            <Laptop size={17} />
            <div>
              <strong>环境准备</strong>
              <span>
                {environmentReady
                  ? "本地服务已就绪"
                  : environmentStarting
                    ? "本地服务正在启动"
                    : serviceState}
              </span>
            </div>
            {needsRecovery && (
              <button
                className="bridge-icon-button"
                type="button"
                aria-label="重新检查服务"
                onClick={recheck}
              >
                <RefreshCw size={15} />
              </button>
            )}
          </div>
        </section>
      </div>
      <div className="bridge-overview-bottom">
        <section className="bridge-panel bridge-quick-control">
          <span className="bridge-icon-box">
            <MessageCircle size={21} />
          </span>
          <div>
            <h2>
              自动回复{" "}
              <span className="bridge-muted">
                {paused ? "已暂停" : "已开启"}
              </span>
            </h2>
            <p>
              {paused
                ? "暂停期间的新消息会被忽略。"
                : "开启后处理新消息；暂停会停止尚未发出的回复。"}
            </p>
            {pause.isError && <p role="alert">操作失败，请重试。</p>}
          </div>
          <button
            className="bridge-button bridge-button-secondary bridge-button-small"
            type="button"
            disabled={!control.data || control.isError || pause.isPending}
            onClick={() => pause.mutate(!paused)}
          >
            {pause.isPending ? (
              <Loader2 className="bridge-spin" size={15} />
            ) : paused ? (
              <Play size={15} />
            ) : (
              <Pause size={15} />
            )}{" "}
            {paused ? "恢复回复" : "暂停回复"}
          </button>
        </section>
        <Link className="bridge-panel bridge-style-link" to="/workspace/preset">
          <span className="bridge-icon-box">
            <Sparkles size={21} />
          </span>
          <div>
            <h2>回答风格</h2>
            <p>默认大肥鱼，可编辑预设或关闭人设。</p>
          </div>
          <ArrowUpRight size={19} />
        </Link>
      </div>
      <footer className="bridge-page-footer">
        <span>
          <Laptop size={14} />
          电脑需要保持开机、联网且不休眠
        </span>
        <Link to="/workspace/activity">
          查看运行记录 <ArrowRight size={13} />
        </Link>
      </footer>
    </div>
  );
}
