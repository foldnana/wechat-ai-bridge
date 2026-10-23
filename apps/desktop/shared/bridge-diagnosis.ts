// Browser-safe IPC summary: never include credentials, log tails or chat content.
export type BridgeDiagnosis = {
  checkedAt: string;
  service: "ready" | "starting" | "unavailable";
  model: "configured" | "missing" | "unknown";
  wechat: "ready" | "disconnected" | "unknown";
  units: Array<{ id: string; phase: string }>;
  timings: Array<{ stage: string; elapsedMs: number }>;
};
