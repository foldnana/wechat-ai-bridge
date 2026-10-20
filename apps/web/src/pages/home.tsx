import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
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
import { WechatSetupView } from "../components/channel-setup/wechat-setup-view";
export function HomePage() {
  const queryClient = useQueryClient();
  const [showQr, setShowQr] = useState(false);
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
        {inventory.isError && (
          <p role="alert">
            模型列表读取失败，
            <button
              type="button"
              className="underline"
              onClick={() => void inventory.refetch()}
            >
              点击重试
            </button>
            。
          </p>
        )}
        {!hasSelectedModel && !inventory.isPending && !inventory.isError && (
          <p className="mt-2 text-sm">请先保存一个可用模型，再进行扫码。</p>
        )}
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
              <span className="ml-3 text-sm">
                运行状态：
                {live.isError
                  ? "读取失败"
                  : live.data?.channels.find(
                        (item) => item.channelId === channel.id,
                      )?.ready
                    ? "已就绪"
                    : "尚未就绪"}
              </span>
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
      <section className="space-y-3 rounded-xl border border-border p-5">
        <h3 className="font-medium">3. 验证微信回复与运行状态</h3>
        <p>
          自动回复：
          {control.isError
            ? "状态读取失败"
            : control.isPending
              ? "正在读取…"
              : control.data?.paused
                ? "已暂停"
                : "已启用"}
        </p>
        <button
          type="button"
          disabled={!control.data || control.isError || pause.isPending}
          className="rounded border border-border px-3 py-2 disabled:opacity-40"
          onClick={() => pause.mutate(!control.data?.paused)}
        >
          {control.data?.paused ? "恢复回复" : "暂停回复"}
        </button>
        <p className="text-sm text-text-secondary">
          暂停后新收到的消息会被忽略，不会在恢复后补发；已开始处理的消息可能仍会完成。
        </p>
        {pause.isError && <p role="alert">操作失败，请检查本地服务后重试。</p>}
        <p>
          本地服务：
          {live.isError
            ? "状态读取失败"
            : live.isPending
              ? "正在检查…"
              : live.data?.gatewayConnected
                ? "已连接"
                : "尚未连接，请等待启动或重启软件"}
        </p>
        <p className="text-sm">
          扫码后，在微信中发送一条普通文字消息（例如“你好”）。这里会显示最近一条消息的处理结果。
        </p>
        {activity.isError && (
          <p role="alert">回复状态读取失败，请检查本地服务。</p>
        )}
        {activity.data?.activities.map(({ channelId, activity: item }) => (
          <div
            key={channelId}
            className="space-y-2 rounded border border-border p-3"
          >
            <p>
              收到微信消息：
              {item ? new Date(item.receivedAt).toLocaleString() : "等待消息"}
            </p>
            <p>模型产出回答：{item?.generatedAt ? "已产出" : "待确认"}</p>
            <p>微信接口接受发送：{item?.sentAt ? "已确认" : "待确认"}</p>
            {item?.error && (
              <p className="text-red-600">
                {item.error === "generation"
                  ? "模型处理失败，请检查 API、额度与模型设置。"
                  : "发送失败，请检查微信授权与网络后再发一条消息。"}
              </p>
            )}
            {item?.lastSuccessfulReplyAt && (
              <p>
                最近成功发送：
                {new Date(item.lastSuccessfulReplyAt).toLocaleString()}
              </p>
            )}
          </div>
        ))}
        <p className="text-sm text-text-secondary">
          发送结果以微信接口返回为准，请同时在手机上确认收到回复。状态记录不包含聊天正文。
        </p>
      </section>
    </div>
  );
}
