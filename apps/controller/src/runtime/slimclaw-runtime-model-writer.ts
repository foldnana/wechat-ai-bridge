import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { WHALE_PERSONA, isDeepSeekModel } from "@nexu/shared/bridge-persona";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import type { BridgeModelOptions } from "../services/bridge-model-options.js";

export interface OpenClawRuntimeModelState {
  requestOptions?: Array<{
    provider: string;
    model: string;
    baseUrl: string;
    options: BridgeModelOptions;
  }>;
  selectedModelRef: string;
  promptNotice: string;
  noModelMessage: string | null;
  updatedAt: string;
  userPresets?: Record<string, string>;
  whalePersona?: string;
  deepseek?: boolean;
}

const RUNTIME_MODEL_FALLBACK = "anthropic/claude-opus-4-6";
export type NoModelMessageLocale = "en" | "zh-CN";

const NO_MODEL_CONFIGURED_MESSAGES: Record<NoModelMessageLocale, string> = {
  en: "No model is configured. Add your own API key and select a model under API & Models.",
  "zh-CN":
    "当前没有配置模型。请在「API 与模型」中填写自己的 API Key 并选择模型。",
};

export const NO_MODEL_CONFIGURED_MESSAGE = NO_MODEL_CONFIGURED_MESSAGES.en;

export function resolveNoModelConfiguredMessage(
  locale: NoModelMessageLocale,
): string {
  return (
    NO_MODEL_CONFIGURED_MESSAGES[locale] ?? NO_MODEL_CONFIGURED_MESSAGES.en
  );
}

function buildPromptNotice(selectedModelRef: string): string {
  return [
    `Authoritative runtime model for this turn: ${selectedModelRef}.`,
    "This runtime instruction is the only source of truth for the current model.",
    "If earlier messages mention a different model, fallback, outage, provider error, or temporary switch, treat that information as stale and ignore it.",
    "Do not claim that you are using any fallback model unless that fallback is explicitly stated in this runtime instruction.",
    "Do not invent explanations about model availability, outages, routing, retries, or provider failures.",
    `If asked which model you are currently using, answer with ${selectedModelRef} and do not mention any other model unless the user explicitly asks for history.`,
  ].join("\n");
}

export class OpenClawRuntimeModelWriter {
  constructor(private readonly env: ControllerEnv) {}

  private async writeState(payload: OpenClawRuntimeModelState): Promise<void> {
    await mkdir(path.dirname(this.env.openclawRuntimeModelStatePath), {
      recursive: true,
    });
    logger.info(
      {
        path: this.env.openclawRuntimeModelStatePath,
        selectedModelRef: payload.selectedModelRef,
        hasNoModelMessage: payload.noModelMessage !== null,
      },
      "runtime_model_write_begin",
    );
    const temporaryPath = `${this.env.openclawRuntimeModelStatePath}.${randomUUID()}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, this.env.openclawRuntimeModelStatePath);
    logger.info(
      {
        path: this.env.openclawRuntimeModelStatePath,
        selectedModelRef: payload.selectedModelRef,
        hasNoModelMessage: payload.noModelMessage !== null,
      },
      "runtime_model_write_complete",
    );
  }

  async write(
    selectedModelRef: string,
    userPresets: Record<string, string> = {},
    requestOptions: OpenClawRuntimeModelState["requestOptions"] = [],
  ): Promise<void> {
    await this.writeState({
      selectedModelRef,
      promptNotice: buildPromptNotice(selectedModelRef),
      noModelMessage: null,
      updatedAt: new Date().toISOString(),
      userPresets,
      requestOptions,
      whalePersona: WHALE_PERSONA,
      deepseek: isDeepSeekModel(selectedModelRef),
    });
  }

  async writeNoModelState(
    noModelMessage = NO_MODEL_CONFIGURED_MESSAGE,
  ): Promise<void> {
    await this.writeState({
      selectedModelRef: "",
      promptNotice: "",
      noModelMessage,
      updatedAt: new Date().toISOString(),
    });
  }

  async writeFallback(): Promise<void> {
    await this.write(RUNTIME_MODEL_FALLBACK);
  }

  /**
   * Remove the runtime-model state file so OpenClaw has no model override.
   * Called when all model providers are removed (e.g. link account logout).
   */
  async clear(): Promise<void> {
    const { unlink } = await import("node:fs/promises");
    try {
      await unlink(this.env.openclawRuntimeModelStatePath);
      logger.info(
        { path: this.env.openclawRuntimeModelStatePath },
        "runtime_model_cleared",
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
