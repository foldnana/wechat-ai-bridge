import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getApiInternalDesktopDefaultModel,
  getApiInternalDesktopReady,
  getApiV1BridgeControl,
  getApiV1Channels,
  getApiV1ChannelsLiveStatus,
  getApiV1Models,
  putApiV1BridgeControl,
} from "../../lib/api/sdk.gen";
export function useBridgeStatus() {
  const queryClient = useQueryClient();
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
  const runtime = useQuery({
    queryKey: ["desktop-runtime-ready"],
    queryFn: async () =>
      (
        await getApiInternalDesktopReady({
          throwOnError: true,
          signal: AbortSignal.timeout(5000),
        })
      ).data,
    refetchInterval: (query) => (query.state.data?.ready ? 10_000 : 1000),
    retry: false,
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
    refetchInterval: (query) =>
      query.state.data?.gatewayConnected ? 10_000 : 1000,
    retry: false,
  });
  const hasSelectedModel =
    inventory.data?.models.some(
      (candidate) => candidate.id === model.data?.modelId,
    ) ?? false;
  const wechatChannels =
    channels.data?.channels.filter(
      (channel) => channel.channelType === "wechat",
    ) ?? [];
  const hasAuthorization = wechatChannels.some(
    (channel) => channel.status === "connected",
  );
  const serviceReadError =
    control.isError ||
    model.isError ||
    inventory.isError ||
    channels.isError ||
    runtime.isError ||
    live.isError;
  const serviceError =
    serviceReadError ||
    runtime.data?.status === "unhealthy" ||
    runtime.data?.status === "degraded" ||
    runtime.data?.degraded === true;
  const environmentReady =
    !serviceError &&
    runtime.data?.ready === true &&
    live.data?.gatewayConnected === true;
  const environmentStarting =
    !serviceError &&
    runtime.data?.status === "starting" &&
    runtime.data.bootPhase !== "ready";
  const wechatReady =
    environmentReady &&
    hasAuthorization &&
    wechatChannels.some(
      (channel) =>
        channel.status === "connected" &&
        live.data?.channels.some(
          (item) => item.channelId === channel.id && item.ready,
        ),
    );
  const ready = hasSelectedModel && !serviceError && wechatReady;
  const modelConfigured =
    hasSelectedModel && !model.isError && !inventory.isError;
  const canAuthorize = modelConfigured && environmentReady;
  const checking =
    !serviceError &&
    !environmentStarting &&
    (control.isPending ||
      model.isPending ||
      inventory.isPending ||
      channels.isPending ||
      runtime.isPending ||
      live.isPending);
  const environmentUnavailable =
    !checking && !environmentReady && !environmentStarting;
  const paused = control.data?.paused ?? false;
  const modelName = model.data?.modelId?.split("/").pop();
  const serviceState = serviceReadError
    ? "状态读取失败"
    : serviceError
      ? "需要检查"
      : environmentStarting
        ? "正在启动"
        : checking
          ? "正在检查"
          : environmentReady
            ? "运行中"
            : "尚未连接";
  function recheck() {
    void Promise.all([
      control.refetch(),
      model.refetch(),
      inventory.refetch(),
      channels.refetch(),
      runtime.refetch(),
      live.refetch(),
    ]);
  }

  return {
    control,
    pause,
    model,
    channels,
    inventory,
    runtime,
    live,
    hasSelectedModel,
    wechatChannels,
    hasAuthorization,
    serviceReadError,
    serviceError,
    environmentReady,
    environmentStarting,
    environmentUnavailable,
    wechatReady,
    ready,
    modelConfigured,
    canAuthorize,
    checking,
    paused,
    modelName,
    serviceState,
    recheck,
  };
}
