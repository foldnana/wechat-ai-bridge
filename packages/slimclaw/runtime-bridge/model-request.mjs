import { readFileSync } from "node:fs";
import path from "node:path";

// This file is copied beside pi-ai's OpenAI transport. No credentials are read.
export function prepareBridgeModelRequest(model, payload, parentSignal) {
  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (!stateDir) return { signal: parentSignal };
  let entry;
  try {
    const state = JSON.parse(
      readFileSync(path.join(stateDir, "nexu-runtime-model.json"), "utf8"),
    );
    entry = state.requestOptions?.find(
      (item) =>
        item.provider === model.provider &&
        item.model === model.id &&
        item.baseUrl.replace(/\/+$/, "") === model.baseUrl.replace(/\/+$/, ""),
    );
  } catch {
    return { signal: parentSignal };
  }
  if (!entry) return { signal: parentSignal };
  const { thinking, timeoutSeconds, retries } = entry.options ?? {};
  if (
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds < 30 ||
    timeoutSeconds > 180 ||
    !Number.isInteger(retries) ||
    retries < 0 ||
    retries > 2
  )
    return { signal: parentSignal };
  if (
    new URL(model.baseUrl).origin === "https://api.deepseek.com" &&
    ["deepseek-flash", "deepseek-v4-pro"].includes(model.id)
  ) {
    // Remove upstream reasoning defaults so "auto" really follows the provider.
    payload.reasoning_effort = undefined;
    payload.thinking = undefined;
    if (thinking === "off") payload.thinking = { type: "disabled" };
    if (["low", "high", "max"].includes(thinking)) {
      payload.thinking = { type: "enabled" };
      payload.reasoning_effort = thinking;
    }
  }
  const deadline = AbortSignal.timeout(timeoutSeconds * 1000);
  return {
    // SDK retries happen only before accepting the response stream. Never replay a partial answer.
    maxRetries: retries,
    timeout: timeoutSeconds * 1000,
    signal: parentSignal ? AbortSignal.any([parentSignal, deadline]) : deadline,
  };
}
