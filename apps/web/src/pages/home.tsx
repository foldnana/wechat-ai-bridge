import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  deleteApiV1ChannelsByChannelId,
  getApiInternalDesktopDefaultModel,
  getApiV1Channels,
  getApiV1Models,
} from "../../lib/api/sdk.gen";
import { WechatSetupView } from "../components/channel-setup/wechat-setup-view";
export function HomePage() {
  const queryClient = useQueryClient();
  const [showQr, setShowQr] = useState(false);
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
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: () => toast.error("断开失败，请稍后重试。"),
  });
  const wechatChannels =
    channels.data?.channels.filter(
      (channel) => channel.channelType === "wechat",
    ) ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-semibold">连接你自己的微信 AI</h2>
        <p className="mt-2 text-sm text-text-secondary">
          使用你自己的模型 API，在本机运行。电脑需要保持开机、联网且不休眠。
        </p>
      </div>
      <section className="rounded-xl border border-border p-5">
        <h3 className="font-medium">1. 配置 API 与模型</h3>
        <p className="my-3 text-sm">
          {model.isError
            ? "读取模型配置失败。"
            : model.isPending
              ? "正在读取配置…"
              : model.data?.modelId
                ? `当前模型：${model.data.modelId}`
                : "尚未选择模型。"}
        </p>
        <Link
          className="text-accent underline"
          to="/workspace/models?tab=providers"
        >
          配置自己的 API
        </Link>
      </section>
      <section className="space-y-4 rounded-xl border border-border p-5">
        <h3 className="font-medium">2. 微信扫码授权</h3>
        <p className="text-sm text-text-secondary">
          当前仅支持个人微信 ClawBot
          接入。扫码授权成功后，请在微信中发一条消息确认能够回复。
        </p>
        {channels.isPending && <p>正在读取连接信息…</p>}
        {channels.isError && (
          <button type="button" onClick={() => void channels.refetch()}>
            连接信息读取失败，点击重试
          </button>
        )}
        {wechatChannels.map((channel) => (
          <div
            key={channel.id}
            className="flex items-center justify-between gap-4"
          >
            <span>
              微信授权：
              {channel.status === "connected" ? "已保存" : channel.status}
            </span>
            <button
              type="button"
              disabled={disconnect.isPending}
              className="text-sm underline"
              onClick={() => {
                if (window.confirm("断开后需要重新扫码授权，是否继续？"))
                  disconnect.mutate(channel.id);
              }}
            >
              断开连接
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={!hasSelectedModel}
          onClick={() => setShowQr((value) => !value)}
          className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-40"
        >
          {showQr ? "收起扫码" : "开始扫码 / 重新连接"}
        </button>
        {showQr && (
          <WechatSetupView
            onConnected={() => {
              setShowQr(false);
              void queryClient.invalidateQueries({ queryKey: ["channels"] });
              toast.success("授权已保存，请到微信发送消息测试回复。");
            }}
          />
        )}
      </section>
    </div>
  );
}
