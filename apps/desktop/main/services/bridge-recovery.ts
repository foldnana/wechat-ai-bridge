import type { BridgeDiagnosis } from "../../shared/host";
import type { RuntimeOrchestrator } from "../runtime/daemon-supervisor";
import { getStartupTimings } from "../startup-timing";

export function createBridgeRecovery(
  orchestrator: Pick<
    RuntimeOrchestrator,
    "getRuntimeState" | "restartOne" | "startOne"
  >,
  controllerUrl: string,
  request: typeof fetch = fetch,
) {
  let retrying: Promise<BridgeDiagnosis> | null = null;
  async function read(route: string): Promise<Record<string, unknown> | null> {
    try {
      const response = await request(new URL(route, controllerUrl), {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }
  async function diagnose(): Promise<BridgeDiagnosis> {
    const [ready, model, live] = await Promise.all([
      read("/api/internal/desktop/ready"),
      read("/api/internal/desktop/default-model"),
      read("/api/v1/channels/live-status"),
    ]);
    const units = orchestrator
      .getRuntimeState()
      .units.map(({ id, phase }) => ({ id, phase }));
    return {
      checkedAt: new Date().toISOString(),
      service:
        ready?.ready === true &&
        ready?.degraded !== true &&
        ready?.status !== "unhealthy" &&
        ready?.status !== "degraded"
          ? "ready"
          : ready?.status === "starting" && ready?.bootPhase !== "ready"
            ? "starting"
            : "unavailable",
      model: model
        ? typeof model.modelId === "string" && model.modelId
          ? "configured"
          : "missing"
        : "unknown",
      wechat: live
        ? Array.isArray(live.channels) &&
          live.channels.some(
            (item: { channelType?: string; ready?: boolean }) =>
              item.channelType === "wechat" && item.ready,
          )
          ? "ready"
          : "disconnected"
        : "unknown",
      units,
      timings: getStartupTimings(),
    };
  }
  function retry(): Promise<BridgeDiagnosis> {
    if (retrying) return retrying;
    retrying = (async () => {
      const before = await diagnose();
      // An ordinary configuration/authorization problem must not restart a healthy runtime.
      if (before.service !== "ready" && before.service !== "starting") {
        await orchestrator.restartOne("controller");
      }
      const web = orchestrator
        .getRuntimeState()
        .units.find((unit) => unit.id === "web");
      if (web && web.phase !== "running" && web.phase !== "starting") {
        await orchestrator.startOne("web");
      }
      return diagnose();
    })().finally(() => {
      retrying = null;
    });
    return retrying;
  }
  return { diagnose, retry };
}
