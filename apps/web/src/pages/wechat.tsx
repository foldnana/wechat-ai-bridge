import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Copy,
  MessageCircle,
  QrCode,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { deleteApiV1ChannelsByChannelId } from "../../lib/api/sdk.gen";
import { BridgeConfirmDialog } from "../components/bridge/confirm-dialog";
import { WechatSetupView } from "../components/channel-setup/wechat-setup-view";
import { useBridgeStatus } from "../hooks/use-bridge-status";
import { SUGGESTED_MESSAGE, copySuggestedMessage } from "./home";

export function WechatPage() {
  const state = useBridgeStatus();
  const cache = useQueryClient();
  const [reconnecting, setReconnecting] = useState(false);
  const [disconnectId, setDisconnectId] = useState<string | null>(null);
  const [accountPage, setAccountPage] = useState(0);
  const disconnect = useMutation({
    mutationFn: async (id: string) => {
      await deleteApiV1ChannelsByChannelId({
        path: { channelId: id },
        throwOnError: true,
      });
    },
    onSuccess: () => {
      setDisconnectId(null);
      void cache.invalidateQueries({ queryKey: ["channels"] });
      void cache.invalidateQueries({ queryKey: ["bridge-live"] });
    },
    onError: () => toast.error("断开失败，请稍后重试。"),
  });
  const currentAccount = Math.min(
    accountPage,
    Math.max(0, state.wechatChannels.length - 1),
  );
  const account = state.wechatChannels[currentAccount];
  const accountReady =
    state.environmentReady &&
    account?.status === "connected" &&
    state.live.data?.channels.some(
      (channel) => channel.channelId === account.id && channel.ready,
    );
  return (
    <div className="bridge-page bridge-wechat-page">
      <header className="bridge-page-heading">
        <div>
          <span className="bridge-eyebrow">第 2 步 · 扫码授权</span>
          <h1>微信连接</h1>
          <p>用手机微信授权，连接个人微信 ClawBot。</p>
        </div>
        <Link className="bridge-back-link" to="/workspace/models">
          01 模型连接 <ArrowRight size={16} /> 02 微信授权
        </Link>
      </header>
      <div className="bridge-wechat-prerequisite">
        <span className={`bridge-dot ${state.canAuthorize ? "is-live" : ""}`} />
        {state.serviceError
          ? "本地服务状态暂时不可用，正在进行的扫码会保留。"
          : !state.modelConfigured
            ? "先配置模型 API，再来连接微信。"
            : !state.environmentReady
              ? "模型已保存，等待本地服务就绪后即可扫码。"
              : "模型与本地服务已就绪，可以开始授权。"}
        {!state.modelConfigured ? (
          <Link to="/workspace/models">
            配置模型 <ArrowRight size={14} />
          </Link>
        ) : !state.environmentReady ? (
          <button type="button" onClick={state.recheck}>
            重新检查 <RefreshCw size={14} />
          </button>
        ) : (
          <Check size={16} />
        )}
      </div>
      {!state.hasAuthorization || reconnecting ? (
        <section className="bridge-wechat-stage" aria-label="微信扫码">
          <WechatSetupView
            disabled={!state.canAuthorize}
            disabledReason={
              !state.modelConfigured
                ? "请先测试并保存模型，再来获取二维码。"
                : "本地服务就绪后即可获取二维码，页面会自动更新。"
            }
            onConnected={() => {
              setReconnecting(false);
              void cache.invalidateQueries({ queryKey: ["channels"] });
              void cache.invalidateQueries({ queryKey: ["bridge-live"] });
              toast.success("授权已保存，正在检查微信连接。");
            }}
          />
          {reconnecting && (
            <button
              type="button"
              className="bridge-text-button bridge-cancel-reconnect"
              onClick={() => setReconnecting(false)}
            >
              返回已保存的连接
            </button>
          )}
        </section>
      ) : (
        <section className="bridge-panel bridge-connected-stage">
          <div className="bridge-connected-art" aria-hidden="true">
            <span />
            <span />
            <MessageCircle size={62} strokeWidth={1.1} />
          </div>
          <div className="bridge-connected-copy">
            <span className="bridge-eyebrow">授权状态</span>
            <h2>{accountReady ? "微信已连接" : "授权已保存"}</h2>
            <p>
              {state.serviceError || state.environmentUnavailable
                ? "本地服务需要检查，恢复后会自动更新连接状态。"
                : accountReady
                  ? "打开微信里的助手对话，就可以开始聊天了。"
                  : "正在等待本地服务就绪，状态会自动更新。"}
            </p>
            <div className="bridge-connected-account">
              <span className={`bridge-dot ${accountReady ? "is-live" : ""}`} />
              <strong>微信连接 {currentAccount + 1}</strong>
              <span>
                {account?.status === "connected" ? "已授权" : "待检查"}
              </span>
            </div>
            <div className="bridge-connected-actions">
              <button
                type="button"
                className="bridge-button bridge-button-secondary"
                disabled={!state.canAuthorize}
                onClick={() => setReconnecting(true)}
              >
                <QrCode size={16} />
                重新扫码
              </button>
              <button
                type="button"
                className="bridge-text-button"
                onClick={() => setDisconnectId(account?.id ?? null)}
              >
                <Unplug size={15} />
                断开连接
              </button>
            </div>
            {state.wechatChannels.length > 1 && (
              <div className="bridge-pagination">
                <button
                  type="button"
                  disabled={currentAccount === 0}
                  onClick={() => setAccountPage(currentAccount - 1)}
                >
                  上一条
                </button>
                <span>
                  {currentAccount + 1} / {state.wechatChannels.length}
                </span>
                <button
                  type="button"
                  disabled={currentAccount >= state.wechatChannels.length - 1}
                  onClick={() => setAccountPage(currentAccount + 1)}
                >
                  下一条
                </button>
              </div>
            )}
          </div>
        </section>
      )}
      <aside className="bridge-wechat-note">
        <MessageCircle size={18} />
        <div>
          <strong>
            发送测试消息 <span>可选，不影响配置完成</span>
          </strong>
          <p>{SUGGESTED_MESSAGE}</p>
        </div>
        <button
          className="bridge-text-button"
          type="button"
          onClick={copySuggestedMessage}
        >
          <Copy size={15} />
          复制示例消息
        </button>
      </aside>
      <BridgeConfirmDialog
        open={disconnectId !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnectId(null);
        }}
        title="断开这条微信连接？"
        description="断开后停止通过该连接回复，再次使用需要重新扫码授权。"
        confirmLabel="断开连接"
        pending={disconnect.isPending}
        onConfirm={() => {
          if (disconnectId) disconnect.mutate(disconnectId);
        }}
      />
    </div>
  );
}
