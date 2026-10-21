import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { GetApiInternalDesktopReadyResponse } from "../../apps/web/lib/api/types.gen";
import { WorkspaceLayout } from "../../apps/web/src/layouts/workspace-layout";
import { HomePage } from "../../apps/web/src/pages/home";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
function renderHome(
  modelId: string | null,
  state: {
    authorized?: boolean;
    ready?: boolean;
    paused?: boolean;
    serviceError?: boolean;
    runtime?: Partial<GetApiInternalDesktopReadyResponse>;
    readError?: "runtime" | "live";
  } = {},
) {
  const client = new QueryClient();
  client.setQueryData(["bridge-control"], { paused: state.paused ?? false });
  client.setQueryData(["desktop-default-model"], { modelId });
  client.setQueryData(["channels"], {
    channels: state.authorized
      ? [{ id: "wechat-local", channelType: "wechat", status: "connected" }]
      : [],
  });
  client.setQueryData(["bridge-live"], {
    gatewayConnected: state.ready ?? false,
    channels: [{ channelId: "wechat-local", ready: state.ready ?? false }],
  });
  client.setQueryData(["desktop-runtime-ready"], {
    ready: true,
    coreReady: true,
    degraded: false,
    bootPhase: "ready",
    workspacePath: "local-workspace",
    controlPlane: { ok: true, phase: "ready", wsConnected: true },
    status: "active",
    ...state.runtime,
  } satisfies GetApiInternalDesktopReadyResponse);
  client.setQueryData(["bridge-activity"], {
    activities: [{ channelId: "wechat-local", activity: null }],
  });
  client.setQueryData(["models"], {
    models: modelId
      ? [{ id: modelId, name: modelId, provider: "deepseek" }]
      : [],
  });
  if (state.serviceError) {
    client
      .getQueryCache()
      .find({ queryKey: ["bridge-control"] })
      ?.setState({
        status: "error",
        error: new Error("Local service unavailable"),
      });
  }
  if (state.readError) {
    client
      .getQueryCache()
      .find({
        queryKey: [
          state.readError === "runtime"
            ? "desktop-runtime-ready"
            : "bridge-live",
        ],
      })
      ?.setState({
        status: "error",
        error: new Error("Runtime status unavailable"),
      });
  }
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  client.clear();
  return html;
}
describe("local bridge setup", () => {
  it("requires a selected model before starting QR authorization", () => {
    const html = renderHome(null);
    expect(html).toContain("尚未选择模型");
    expect(html).toContain('disabled=""');
    expect(html).not.toContain("cloud-connect");
  });
  it("offers QR authorization after choosing a user model and preparing the environment", () => {
    const html = renderHome("deepseek/deepseek-chat", { ready: true });
    expect(html).toContain("deepseek/deepseek-chat");
    expect(html).not.toContain('disabled=""');
    expect(html).toContain("电脑需要保持开机");
  });
  it("exposes only the connection and model navigation", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <WorkspaceLayout />
      </MemoryRouter>,
    );
    expect(html).toContain("微信连接");
    expect(html).toContain("API 与模型");
    expect(html).not.toMatch(/rewards|skills|integrations|登录/);
  });
  it("does not describe authorization alone as a ready connection", () => {
    const html = renderHome("deepseek/deepseek-chat", { authorized: true });
    expect(html).toContain("授权已保存，等待服务就绪");
    expect(html).not.toContain("连接已就绪");
  });
  it("shows readiness without requiring a first reply", () => {
    const html = renderHome("deepseek/deepseek-chat", {
      authorized: true,
      ready: true,
    });
    expect(html).toContain("连接已就绪");
    expect(html).toContain("复制示例消息");
    expect(html).toContain("可选");
    expect(html).toContain("最近消息记录");
    expect(html).not.toContain('disabled=""');
  });
  it("keeps a paused connection distinct from an active one", () => {
    const html = renderHome("deepseek/deepseek-chat", {
      authorized: true,
      ready: true,
      paused: true,
    });
    expect(html).toContain("连接已就绪 · 回复已暂停");
    expect(html).toContain("恢复回复");
    expect(html).toContain("暂停期间的新消息会被忽略");
  });
  it("guides users to configure their API after the environment is ready", () => {
    const html = renderHome(null, { ready: true });
    expect(html).toContain("本地服务已就绪");
    expect(html).toContain("第 1 步：配置模型 API");
    expect(html).toContain("填写密钥 → 测试并保存");
  });
  it("points to phone authorization after saving the model", () => {
    const html = renderHome("deepseek/deepseek-chat", { ready: true });
    expect(html).toContain("第 2 步：打开微信扫码");
    expect(html).toContain("获取二维码 → 手机确认");
  });
  it("offers service recovery instead of claiming readiness from stale state", () => {
    const html = renderHome("deepseek/deepseek-chat", {
      authorized: true,
      ready: true,
      serviceError: true,
    });
    expect(html).toContain("重新检查服务");
    expect(html).not.toContain("连接已完成，");
  });
  it("lets users configure their API while the local runtime starts", () => {
    const html = renderHome(null, {
      runtime: {
        ready: false,
        coreReady: false,
        status: "starting",
        bootPhase: "stabilizing-runtime",
      },
    });
    expect(html).toContain(
      "本地服务正在启动，状态会自动更新，可以先配置 API。",
    );
    expect(html).toContain("第 1 步：配置模型 API");
    expect(html).toContain('href="/workspace/models"');
    expect(html).not.toMatch(/重新检查服务|重新打开软件|尚未就绪/);
  });
  it("waits for the environment before offering QR even with a saved model", () => {
    const html = renderHome("deepseek/deepseek-chat", {
      runtime: {
        ready: false,
        coreReady: false,
        status: "starting",
        bootPhase: "stabilizing-runtime",
      },
    });
    expect(html).toContain("配置已保存，等待服务就绪");
    expect(html).toContain("模型已保存，服务就绪后即可扫码");
    expect(html).toContain('disabled=""');
    expect(html).not.toContain("第 2 步：打开微信扫码");
    expect(html).not.toContain("重新检查服务");
  });
  it.each(["unhealthy", "degraded"] as const)(
    "treats %s as a fault even if the boot phase is still stabilizing",
    (status) => {
      const html = renderHome("deepseek/deepseek-chat", {
        authorized: true,
        ready: true,
        runtime: {
          ready: false,
          coreReady: false,
          status,
          bootPhase: "stabilizing-runtime",
        },
      });
      expect(html).toContain("重新检查服务");
      expect(html).toContain("本地服务暂时不可用");
      expect(html).not.toMatch(/状态会自动更新|连接已就绪|连接已完成，/);
    },
  );
  it.each(["runtime", "live"] as const)(
    "shows recovery when reading %s fails instead of retaining a stale starting state",
    (readError) => {
      const html = renderHome("deepseek/deepseek-chat", {
        runtime: {
          ready: false,
          status: "starting",
          bootPhase: "stabilizing-runtime",
        },
        readError,
      });
      expect(html).toContain("重新检查服务");
      expect(html).toContain("无法读取本机配置或运行状态");
      expect(html).not.toContain("本地服务正在启动，状态会自动更新");
    },
  );
  it("does not call a runtime with a completed boot phase normal startup", () => {
    const html = renderHome("deepseek/deepseek-chat", {
      runtime: { ready: false, status: "starting", bootPhase: "ready" },
    });
    expect(html).toContain("重新检查服务");
    expect(html).not.toContain("本地服务正在启动，状态会自动更新");
  });
});
