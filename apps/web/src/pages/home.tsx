import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  KeyRound,
  Laptop,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Unplug,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  deleteApiV1ChannelsByChannelId,
  getApiInternalDesktopDefaultModel,
  getApiV1BridgeActivity,
  getApiV1BridgeControl,
  getApiV1Channels,
  getApiV1ChannelsLiveStatus,
  getApiV1Models,
  putApiV1BridgeControl,
} from "../../lib/api/sdk.gen";
import { BridgeConfirmDialog } from "../components/bridge/confirm-dialog";
import { ConnectionScene } from "../components/bridge/connection-scene";
import { WechatSetupView } from "../components/channel-setup/wechat-setup-view";

const SUGGESTED_MESSAGE = "你好，介绍一下你能帮我做什么。";

export function HomePage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [showQr, setShowQr] = useState(searchParams.get("connect") === "1");
  const qrPanel = useRef<HTMLDivElement>(null);
  const [disconnectId, setDisconnectId] = useState<string | null>(null);
  useEffect(() => {
    if (!showQr) return;
    qrPanel.current?.scrollIntoView({ block: "center" });
    qrPanel.current?.focus({ preventScroll: true });
  }, [showQr]);
  const control = useQuery({
    queryKey: ["bridge-control"],
    queryFn: async () =>
      (await getApiV1BridgeControl({ throwOnError: true })).data,
    refetchInterval: 10_000,
  });
  const pause = useMutation({
    mutationFn: async (paused: boolean) =>
      (await putApiV1BridgeControl({ body: { paused }, throwOnError: true }))
        .data,
    onSuccess: (data) => queryClient.setQueryData(["bridge-control"], data),
  });
  const model = useQuery({
    queryKey: ["desktop-default-model"],
    queryFn: async () =>
      (await getApiInternalDesktopDefaultModel({ throwOnError: true })).data,
  });
  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await getApiV1Channels({ throwOnError: true })).data,
    refetchInterval: 10_000,
  });
  const inventory = useQuery({
    queryKey: ["models"],
    queryFn: async () => (await getApiV1Models({ throwOnError: true })).data,
  });
  const live = useQuery({
    queryKey: ["bridge-live"],
    queryFn: async () =>
      (
        await getApiV1ChannelsLiveStatus({
          throwOnError: true,
          signal: AbortSignal.timeout(15_000),
        })
      ).data,
    refetchInterval: 10_000,
    retry: false,
  });
  const activity = useQuery({
    queryKey: ["bridge-activity"],
    queryFn: async () =>
      (await getApiV1BridgeActivity({ throwOnError: true })).data,
    refetchInterval: 3000,
  });
  const hasSelectedModel =
    inventory.data?.models.some(
      (candidate) => candidate.id === model.data?.modelId,
    ) ?? false;
  const disconnect = useMutation({
    mutationFn: async (channelId: string) => {
      await deleteApiV1ChannelsByChannelId({
        path: { channelId },
        throwOnError: true,
      });
    },
    onSuccess: () => {
      setDisconnectId(null);
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
      void queryClient.invalidateQueries({ queryKey: ["bridge-live"] });
    },
    onError: () => toast.error("断开失败，请稍后重试。"),
  });
  const wechatChannels =
    channels.data?.channels.filter(
      (channel) => channel.channelType === "wechat",
    ) ?? [];
  const hasAuthorization = wechatChannels.some(
    (channel) => channel.status === "connected",
  );
  const wechatReady =
    !channels.isError &&
    !live.isError &&
    hasAuthorization &&
    live.data?.gatewayConnected &&
    wechatChannels.some(
      (channel) =>
        channel.status === "connected" &&
        live.data?.channels.some(
          (item) => item.channelId === channel.id && item.ready,
        ),
    );
  const serviceError =
    control.isError || model.isError || inventory.isError || channels.isError;
  const ready = hasSelectedModel && !serviceError && wechatReady;
  const canAuthorize = hasSelectedModel && !model.isError && !inventory.isError;
  const environmentReady =
    !live.isError && live.data?.gatewayConnected === true;
  const checking =
    control.isPending ||
    model.isPending ||
    inventory.isPending ||
    channels.isPending;
  const paused = control.data?.paused ?? false;
  const modelName = model.data?.modelId?.split("/").pop();
  const serviceState = live.isError
    ? "状态读取失败"
    : live.isPending
      ? "正在检查"
      : live.data?.gatewayConnected
        ? "运行中"
        : "尚未连接";
  function recheck() {
    void Promise.all([
      control.refetch(),
      model.refetch(),
      inventory.refetch(),
      channels.refetch(),
      live.refetch(),
    ]);
  }
  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(SUGGESTED_MESSAGE);
      toast.success("已复制，去微信粘贴发送即可。");
    } catch {
      toast.error("暂时无法复制，可以手动选中示例文字复制。");
    }
  }
  return (
    <div className="bridge-page bridge-home">
      <div className="bridge-page-heading">
        <div>
          <span className="bridge-eyebrow">YOUR AI. YOUR WECHAT.</span>
          <h1>把 AI 接入你的微信。</h1>
          <p>环境由软件准备。你只需配置 API，再用手机微信扫码授权。</p>
        </div>
        <span className="bridge-edition">
          <span />
          个人工作空间
        </span>
      </div>
      <ol className="bridge-setup-progress" aria-label="接入步骤">
        <li className={environmentReady ? "is-complete" : "is-current"}>
          <span className="bridge-progress-icon">
            {environmentReady ? <Check size={17} /> : <Laptop size={17} />}
          </span>
          <div>
            <strong>环境准备</strong>
            <span>
              {live.isPending
                ? "正在检查本地服务"
                : environmentReady
                  ? "本地服务已就绪"
                  : "本地服务尚未就绪"}
            </span>
          </div>
        </li>
        <li
          className={
            canAuthorize ? "is-complete" : environmentReady ? "is-current" : ""
          }
          aria-current={environmentReady && !canAuthorize ? "step" : undefined}
        >
          <span className="bridge-progress-icon">
            {canAuthorize ? <Check size={17} /> : "1"}
          </span>
          <div>
            <strong>配置模型 API</strong>
            <span>
              {canAuthorize
                ? "配置已保存，可继续扫码"
                : "填写密钥 → 测试并保存"}
            </span>
          </div>
        </li>
        <li
          className={
            wechatReady ? "is-complete" : canAuthorize ? "is-current" : ""
          }
          aria-current={canAuthorize && !wechatReady ? "step" : undefined}
        >
          <span className="bridge-progress-icon">
            {wechatReady ? <Check size={17} /> : "2"}
          </span>
          <div>
            <strong>微信扫码授权</strong>
            <span>
              {wechatReady
                ? "连接已就绪"
                : hasAuthorization
                  ? "已授权，等待服务就绪"
                  : "获取二维码 → 手机确认"}
            </span>
          </div>
        </li>
      </ol>
      <section className="bridge-hero" aria-label="连接概览">
        <div className="bridge-hero-copy">
          <span className="bridge-hero-kicker">
            <span
              className={`bridge-dot ${ready && !paused ? "is-live" : ""}`}
            />
            {ready
              ? paused
                ? "连接已就绪 · 回复已暂停"
                : "连接已就绪"
              : checking
                ? "正在检查配置"
                : serviceError
                  ? "需要处理 · 本地服务"
                  : !environmentReady
                    ? "准备环境"
                    : canAuthorize
                      ? "下一步 · 微信扫码授权"
                      : "下一步 · 配置模型 API"}
          </span>
          <h2>
            {checking ? (
              <>
                正在检查，
                <br />
                请稍候。
              </>
            ) : serviceError ? (
              <>
                先恢复<span>本地服务</span>。
              </>
            ) : !environmentReady ? (
              <>
                本地服务
                <br />
                <span>尚未就绪</span>。
              </>
            ) : ready ? (
              <>
                连接已完成，
                <br />
                去微信<span>聊聊吧</span>。
              </>
            ) : canAuthorize ? (
              <>
                API 已保存，
                <br />
                现在<span>连接微信</span>。
              </>
            ) : (
              <>
                先配置
                <br />
                你的<span>模型 API</span>。
              </>
            )}
          </h2>
          <p>
            {checking
              ? "正在读取本地服务、模型和微信连接状态。"
              : serviceError
                ? "无法读取本机配置。请点击重新检查；如果仍失败，请重新打开软件。恢复前不要反复提交密钥。"
                : !environmentReady
                  ? "可以先配置模型。服务就绪后才能自动回复微信；请重新检查，持续未就绪时重新打开软件。"
                  : ready
                    ? paused
                      ? "想聊的时候，恢复自动回复就好。"
                      : "模型与微信已准备好，随时开启你的下一段对话。"
                    : canAuthorize
                      ? "点击下方按钮获取授权二维码，再打开手机微信「+ → 扫一扫」，扫码后在手机上确认。"
                      : "准备模型服务商的 API Key，粘贴到设置页。\n点击「测试并保存模型」，成功后再连接微信。"}
          </p>
          <div className="bridge-hero-actions">
            {serviceError || (!checking && !environmentReady) ? (
              <button type="button" className="bridge-button" onClick={recheck}>
                重新检查服务
                <RefreshCw size={17} />
              </button>
            ) : !canAuthorize ? (
              <Link className="bridge-button" to="/workspace/models">
                {model.isError || inventory.isError
                  ? "检查模型配置"
                  : "第 1 步：配置模型 API"}
                <ArrowUpRight size={17} />
              </Link>
            ) : !hasAuthorization ? (
              <button
                type="button"
                className="bridge-button"
                onClick={() => setShowQr(true)}
              >
                第 2 步：打开微信扫码
                <QrCode size={17} />
              </button>
            ) : (
              <a className="bridge-button" href="#bridge-runtime">
                查看运行状态
                <ArrowDown size={17} />
              </a>
            )}
            <span className="bridge-hero-footnote">
              {serviceError || !environmentReady ? (
                <Link to="/workspace/models">
                  查看模型配置 <ArrowRight size={13} />
                </Link>
              ) : (
                "首次试聊可选，不影响完成配置"
              )}
            </span>
          </div>
        </div>
        <ConnectionScene />
        <span className="bridge-hero-index">01 — CONNECT YOUR EVERYDAY</span>
      </section>
      <div className="bridge-section-heading">
        <h2>连接工作台</h2>
        <span>两步配置，随时开始</span>
      </div>
      <div className="bridge-connection-grid">
        <section className="bridge-panel bridge-connection-card">
          <div className="bridge-card-top">
            <span className="bridge-icon-box">
              <KeyRound size={21} strokeWidth={1.6} />
            </span>
            <span className="bridge-step-number">01 / MODEL</span>
          </div>
          <div className="bridge-card-title">
            <h3>配置模型 API</h3>
            <span
              className={`bridge-badge ${hasSelectedModel && !inventory.isError && !model.isError ? "is-success" : ""}`}
            >
              {model.isError || inventory.isError
                ? "读取失败"
                : hasSelectedModel
                  ? "已配置"
                  : "待配置"}
            </span>
          </div>
          <p className="bridge-card-description">
            填写自己的 API，让喜欢的模型为你回答。
          </p>
          <div className="bridge-model-display">
            <span className="bridge-model-avatar">
              {hasSelectedModel ? <Check size={18} /> : <Plus size={18} />}
            </span>
            <div>
              <strong title={model.data?.modelId ?? undefined}>
                {model.isError
                  ? "模型配置暂时不可用"
                  : model.isPending
                    ? "正在读取配置…"
                    : (modelName ?? "尚未选择模型")}
              </strong>
              <span>
                {hasSelectedModel
                  ? "自带 API · 配置已保存"
                  : "默认推荐 DeepSeek，也支持兼容接口"}
              </span>
            </div>
          </div>
          <div className="bridge-card-footer">
            <Link className="bridge-text-button" to="/workspace/models">
              {hasSelectedModel ? "管理 API 与模型" : "配置自己的 API"}
              <ArrowRight size={16} />
            </Link>
            {(inventory.isError || model.isError) && (
              <button
                type="button"
                className="bridge-icon-button"
                aria-label="重新读取模型配置"
                onClick={() => {
                  void inventory.refetch();
                  void model.refetch();
                }}
              >
                <RefreshCw size={16} />
              </button>
            )}
          </div>
        </section>
        <section className="bridge-panel bridge-connection-card">
          <div className="bridge-card-top">
            <span className="bridge-icon-box is-wechat">
              <MessageCircle size={22} strokeWidth={1.6} />
            </span>
            <span className="bridge-step-number">02 / WECHAT</span>
          </div>
          <div className="bridge-card-title">
            <h3>微信扫码授权</h3>
            <span className={`bridge-badge ${wechatReady ? "is-success" : ""}`}>
              {channels.isError
                ? "读取失败"
                : wechatReady
                  ? "已就绪"
                  : hasAuthorization
                    ? "已授权"
                    : "待连接"}
            </span>
          </div>
          <p className="bridge-card-description">
            微信扫码授权，连接个人微信 ClawBot。
          </p>
          <div className="bridge-wechat-summary">
            <span className={`bridge-dot ${wechatReady ? "is-live" : ""}`} />
            <div>
              <strong>
                {channels.isPending
                  ? "正在读取连接信息…"
                  : channels.isError
                    ? "暂时无法读取微信授权"
                    : hasAuthorization
                      ? wechatReady
                        ? "微信已准备好"
                        : "授权已保存，等待服务就绪"
                      : "尚未连接微信"}
              </strong>
              <span>
                {hasAuthorization
                  ? "授权保存在本机，随时查看连接状态"
                  : hasSelectedModel
                    ? "准备好手机，扫码即可完成授权"
                    : "先完成第 1 步模型配置，再来扫码"}
              </span>
            </div>
          </div>
          <div className="bridge-card-footer">
            <button
              type="button"
              className="bridge-text-button"
              disabled={!canAuthorize}
              onClick={() => setShowQr(!showQr)}
            >
              {showQr ? "收起扫码" : hasAuthorization ? "重新连接" : "开始扫码"}
              {showQr ? <X size={16} /> : <QrCode size={16} />}
            </button>
            {channels.isError && (
              <button
                type="button"
                className="bridge-icon-button"
                aria-label="重新读取微信连接"
                onClick={() => void channels.refetch()}
              >
                <RefreshCw size={16} />
              </button>
            )}
            {wechatChannels.length === 1 && (
              <button
                type="button"
                className="bridge-icon-button"
                aria-label="断开微信连接"
                title="断开微信连接"
                onClick={() => setDisconnectId(wechatChannels[0]?.id ?? null)}
              >
                <Unplug size={16} />
              </button>
            )}
          </div>
        </section>
      </div>
      {wechatChannels.length > 1 && (
        <div className="bridge-panel bridge-account-list">
          {wechatChannels.map((channel, index) => (
            <div key={channel.id}>
              <span>
                <MessageCircle size={16} />
                微信连接 {index + 1}
                <span className="bridge-badge">
                  {channel.status === "connected" ? "已授权" : "未就绪"}
                </span>
              </span>
              <button
                type="button"
                className="bridge-text-button"
                onClick={() => setDisconnectId(channel.id)}
              >
                断开连接
                <Unplug size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      {showQr && (
        <div
          className="bridge-qr-expansion"
          ref={qrPanel}
          tabIndex={-1}
          aria-label="微信扫码"
        >
          <WechatSetupView
            disabled={!canAuthorize}
            onConnected={() => {
              setShowQr(false);
              void queryClient.invalidateQueries({ queryKey: ["channels"] });
              void queryClient.invalidateQueries({ queryKey: ["bridge-live"] });
              toast.success("微信授权已保存，正在检查服务状态。");
            }}
          />
        </div>
      )}
      {hasAuthorization && (
        <aside className="bridge-try-chat">
          <span className="bridge-try-icon">
            <MessageCircle size={21} />
          </span>
          <div>
            <strong>
              {wechatReady
                ? "打开微信里的助手对话，发条消息试试。"
                : "服务就绪后，在微信里的助手对话试聊。"}
              <span>可选</span>
            </strong>
            <p>{SUGGESTED_MESSAGE}</p>
          </div>
          <button
            type="button"
            className="bridge-button bridge-button-secondary"
            onClick={copyMessage}
          >
            <Copy size={15} />
            复制示例消息
          </button>
        </aside>
      )}
      <section id="bridge-runtime" className="bridge-panel bridge-runtime">
        <div className="bridge-runtime-header">
          <div className="bridge-runtime-title">
            <Activity size={18} />
            <h2>运行状态</h2>
          </div>
          <div className="bridge-runtime-controls">
            <span
              className={`bridge-runtime-label ${!live.isError && live.data?.gatewayConnected ? "is-ready" : ""}`}
            >
              <span
                className={`bridge-dot ${!live.isError && live.data?.gatewayConnected ? "is-live" : ""}`}
              />
              本地服务 · {serviceState}
            </span>
            <button
              type="button"
              className={`bridge-button bridge-button-secondary bridge-button-small ${paused ? "" : "is-running"}`}
              disabled={!control.data || control.isError || pause.isPending}
              onClick={() => pause.mutate(!paused)}
            >
              {pause.isPending ? (
                <Loader2 size={14} className="bridge-spin" />
              ) : paused ? (
                <Play size={14} />
              ) : (
                <Pause size={14} />
              )}
              {control.isError
                ? "状态读取失败"
                : control.isPending
                  ? "正在读取"
                  : paused
                    ? "恢复回复"
                    : "暂停回复"}
            </button>
          </div>
        </div>
        <p className="bridge-runtime-explanation">
          {paused
            ? "已暂停自动回复。暂停期间的新消息会被忽略，恢复后可以继续聊天。"
            : "开启后会自动处理微信新消息；暂停时忽略新消息，已开始的回复可能继续完成。"}
        </p>
        {(pause.isError || live.isError) && (
          <p role="alert" className="bridge-feedback is-error">
            {pause.isError
              ? "操作未能完成，请检查本地服务后重试。"
              : "无法读取运行状态，请检查本地服务或重启软件。"}
          </p>
        )}
        <details className="bridge-activity">
          <summary>
            <span>
              <CheckCheck size={16} />
              最近消息记录
            </span>
            <ChevronDown size={16} />
          </summary>
          <div className="bridge-activity-body">
            {activity.isPending && (
              <p className="bridge-muted">正在读取记录…</p>
            )}
            {activity.isError && (
              <p role="alert" className="bridge-feedback is-error">
                回复状态读取失败，请检查本地服务。
              </p>
            )}
            {activity.data &&
              !activity.data.activities.some(({ activity: item }) => item) && (
                <div className="bridge-empty-activity">
                  <MessageCircle size={23} strokeWidth={1.4} />
                  <p>
                    这里，还在等第一声「你好」。
                    <span>随时去微信聊聊，消息记录会自动出现在这里。</span>
                  </p>
                </div>
              )}
            {activity.data?.activities.map(
              ({ channelId, activity: item }) =>
                item && (
                  <div className="bridge-activity-entry" key={channelId}>
                    <span className="bridge-activity-date">
                      {new Date(item.receivedAt).toLocaleString()}
                    </span>
                    <div className="bridge-activity-stages">
                      <span>
                        <Check size={14} />
                        收到消息
                      </span>
                      <ArrowRight size={13} />
                      <span className={item.generatedAt ? "is-complete" : ""}>
                        {item.generatedAt && <Check size={14} />}AI 生成
                        {item.generatedAt ? "完成" : "暂无记录"}
                      </span>
                      <ArrowRight size={13} />
                      <span className={item.sentAt ? "is-complete" : ""}>
                        {item.sentAt && <Check size={14} />}
                        {item.sentAt ? "已发送" : "发送暂无记录"}
                      </span>
                    </div>
                    {item.error && (
                      <p role="alert" className="bridge-feedback is-error">
                        {item.error === "generation"
                          ? "模型处理失败，请检查 API、额度与模型设置。"
                          : "发送失败，请检查微信授权与网络后再发一条消息。"}
                      </p>
                    )}
                    {item.lastSuccessfulReplyAt && (
                      <p className="bridge-muted">
                        最近成功发送：
                        {new Date(item.lastSuccessfulReplyAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                ),
            )}
            <p className="bridge-microcopy">
              仅记录处理状态，不含聊天正文。“已发送”表示微信已接受发送请求，实际回复可在手机上查看。
            </p>
          </div>
        </details>
      </section>
      <footer className="bridge-page-footer">
        <span>
          <Laptop size={14} />
          电脑需要保持开机、联网且不休眠
        </span>
        <span>简单连接，自在对话。</span>
      </footer>
      <BridgeConfirmDialog
        open={disconnectId !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnectId(null);
        }}
        title="断开这条微信连接？"
        description="断开后会停止通过该连接回复。想再次使用时，重新扫码授权即可。"
        confirmLabel="断开连接"
        pending={disconnect.isPending}
        onConfirm={() => {
          if (disconnectId) disconnect.mutate(disconnectId);
        }}
      />
    </div>
  );
}
