import { describe, expect, it, vi } from "vitest";
import type { RuntimeOrchestrator } from "../../apps/desktop/main/runtime/daemon-supervisor";
import { createBridgeRecovery } from "../../apps/desktop/main/services/bridge-recovery";

function fixture(initial = "active") {
  let status = initial;
  const state = {
    units: [
      {
        id: "controller",
        phase: "running",
        logTail: ["private"],
        lastError: "secret",
      },
      { id: "web", phase: "running" },
    ],
  };
  const restartOne = vi.fn(async () => {
    status = "active";
    return state;
  });
  const startOne = vi.fn(async () => state);
  const request = vi.fn(async (url: URL) =>
    Response.json(
      url.pathname.endsWith("/ready")
        ? { ready: status === "active", status }
        : url.pathname.endsWith("/default-model")
          ? { modelId: null }
          : { channels: [{ channelType: "wechat", ready: false }] },
    ),
  );
  const recovery = createBridgeRecovery(
    {
      getRuntimeState: () => state,
      restartOne,
      startOne,
    } as unknown as RuntimeOrchestrator,
    "http://127.0.0.1:54830",
    request as unknown as typeof fetch,
  );
  return { recovery, restartOne, startOne, request };
}
describe("local diagnosis and recovery", () => {
  it("checks only local status and never exports logs or tests a paid model", async () => {
    const { recovery, request, restartOne } = fixture();
    const result = await recovery.diagnose();
    expect(result).toMatchObject({
      service: "ready",
      model: "missing",
      wechat: "disconnected",
    });
    expect(JSON.stringify(result)).not.toMatch(/private|secret/);
    expect(request.mock.calls.map(([url]) => url.pathname)).toEqual([
      "/api/internal/desktop/ready",
      "/api/internal/desktop/default-model",
      "/api/v1/channels/live-status",
    ]);
    expect(restartOne).not.toHaveBeenCalled();
  });
  it("does not restart a healthy service just because API or WeChat is unconfigured", async () => {
    const { recovery, restartOne } = fixture();
    await recovery.retry();
    expect(restartOne).not.toHaveBeenCalled();
  });
  it("recovers an unhealthy controller once for concurrent clicks", async () => {
    const { recovery, restartOne } = fixture("unhealthy");
    const [a, b] = await Promise.all([recovery.retry(), recovery.retry()]);
    expect(restartOne).toHaveBeenCalledExactlyOnceWith("controller");
    expect(a.service).toBe("ready");
    expect(b).toEqual(a);
  });
  it("leaves a normal ongoing startup alone", async () => {
    const { recovery, restartOne } = fixture("starting");
    expect((await recovery.retry()).service).toBe("starting");
    expect(restartOne).not.toHaveBeenCalled();
  });
  it("permits retry after the restart operation fails", async () => {
    const { recovery, restartOne } = fixture("unhealthy");
    restartOne.mockRejectedValueOnce(new Error("failed restart"));
    await expect(recovery.retry()).rejects.toThrow("failed restart");
    expect((await recovery.retry()).service).toBe("ready");
    expect(restartOne).toHaveBeenCalledTimes(2);
  });
});
