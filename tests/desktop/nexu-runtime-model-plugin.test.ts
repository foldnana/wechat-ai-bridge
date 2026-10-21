import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WHALE_PERSONA, isDeepSeekModel } from "@nexu/shared/bridge-persona";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "../../apps/controller/src/app/env.js";
import { OpenClawRuntimeModelWriter } from "../../apps/controller/src/runtime/slimclaw-runtime-model-writer.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const pluginModulePath = path.resolve(
  testDir,
  "../../apps/controller/static/runtime-plugins/nexu-runtime-model/index.js",
);
const stateModulePath = path.resolve(
  testDir,
  "../../apps/controller/static/nexu-runtime-model.json",
);

async function writeState(selectedModelRef: string, promptNotice?: string) {
  await writeFile(
    stateModulePath,
    `${JSON.stringify(
      {
        selectedModelRef,
        promptNotice:
          promptNotice ??
          `Authoritative runtime model for this turn: ${selectedModelRef}.`,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

describe("nexu-runtime-model plugin", () => {
  let beforeState: string | null = null;

  beforeEach(async () => {
    try {
      beforeState = await readFile(stateModulePath, "utf8");
    } catch {
      beforeState = null;
    }
  });

  afterEach(async () => {
    if (beforeState === null) {
      await unlink(stateModulePath).catch(() => undefined);
      return;
    }
    await writeFile(stateModulePath, beforeState, "utf8");
  });

  it("recognizes DeepSeek references without matching unrelated names", () => {
    for (const ref of [
      "deepseek/deepseek-chat",
      "byok_deepseek/deepseek-reasoner",
      "custom-openai/bridge/deepseek-chat",
      "openrouter/deepseek/deepseek-v3",
    ]) {
      expect(isDeepSeekModel(ref)).toBe(true);
    }
    for (const ref of [
      null,
      "",
      "openai/gpt-4.1",
      "not-deepseek/model",
      "custom/my-deepseek-notes",
    ]) {
      expect(isDeepSeekModel(ref)).toBe(false);
    }
  });

  it("applies the whale default only as configured and never replaces an agent's custom preset", async () => {
    const behaviorFile = path.join(
      path.dirname(stateModulePath),
      "bridge-behavior.json",
    );
    const previous = await readFile(behaviorFile, "utf8").catch(() => null);
    const writer = new OpenClawRuntimeModelWriter({
      openclawRuntimeModelStatePath: stateModulePath,
    } as ControllerEnv);
    try {
      const { default: plugin } = await import(
        `${pluginModulePath}?whale=${Date.now()}`
      );
      let handler:
        | ((
            event: unknown,
            ctx: { agentId: string },
          ) => Promise<{ prependSystemContext: string } | undefined>)
        | undefined;
      plugin.register({
        on(event, callback) {
          if (event === "before_prompt_build") handler = callback;
        },
      });
      await unlink(behaviorFile).catch(() => {});
      await writer.write("deepseek/deepseek-chat", {
        custom: "请只用商务语气。",
      });
      expect(
        (await handler?.({}, { agentId: "bot" }))?.prependSystemContext,
      ).toContain(WHALE_PERSONA);
      const custom = (await handler?.({}, { agentId: "custom" }))
        ?.prependSystemContext;
      expect(custom).toContain("请只用商务语气。");
      expect(custom).not.toContain(WHALE_PERSONA);
      await writeFile(
        behaviorFile,
        JSON.stringify({
          persona: "none",
          promptContext: "不要使用 Unicode emoji。",
        }),
      );
      const disabled = (await handler?.({}, { agentId: "bot" }))
        ?.prependSystemContext;
      expect(disabled).not.toContain(WHALE_PERSONA);
      expect(disabled).toContain("不要使用 Unicode emoji。");
      await writer.write("openai/gpt-4.1");
      await writeFile(behaviorFile, JSON.stringify({ persona: "auto" }));
      expect(
        (await handler?.({}, { agentId: "bot" }))?.prependSystemContext,
      ).not.toContain(WHALE_PERSONA);
      await writeFile(behaviorFile, JSON.stringify({ persona: "whale" }));
      const forced = (await handler?.({}, { agentId: "bot" }))
        ?.prependSystemContext;
      expect(forced).toContain(WHALE_PERSONA);
      expect(forced).toContain("openai/gpt-4.1");
      await writeFile(behaviorFile, "{bad");
      expect(
        (await handler?.({}, { agentId: "bot" }))?.prependSystemContext,
      ).not.toContain(WHALE_PERSONA);
    } finally {
      if (previous === null) await unlink(behaviorFile).catch(() => {});
      else await writeFile(behaviorFile, previous);
    }
  });

  it("preserves provider overrides for Link and proxied BYOK providers", async () => {
    const { default: plugin } = await import(
      `${pluginModulePath}?t=${Date.now()}`
    );

    await writeState("link/claude-sonnet-4");
    let linkHandler:
      | (() => Promise<Record<string, string> | undefined>)
      | undefined;
    plugin.register({
      on(event, handler) {
        if (event === "before_model_resolve") {
          linkHandler = handler;
        }
      },
    });
    expect(await linkHandler?.()).toEqual({
      providerOverride: "link",
      modelOverride: "claude-sonnet-4",
    });

    await writeState("byok_openai/openai/gpt-4.1");
    let byokHandler:
      | (() => Promise<Record<string, string> | undefined>)
      | undefined;
    plugin.register({
      on(event, handler) {
        if (event === "before_model_resolve") {
          byokHandler = handler;
        }
      },
    });
    expect(await byokHandler?.()).toEqual({
      providerOverride: "byok_openai",
      modelOverride: "openai/gpt-4.1",
    });
  });

  it("ignores empty runtime-model state", async () => {
    const { default: plugin } = await import(
      `${pluginModulePath}?t=${Date.now()}`
    );

    await writeState("", "");
    let beforeModelResolveHandler:
      | (() => Promise<Record<string, string> | undefined>)
      | undefined;
    let beforePromptBuildHandler:
      | (() => Promise<Record<string, string> | undefined>)
      | undefined;
    plugin.register({
      on(event, handler) {
        if (event === "before_model_resolve") {
          beforeModelResolveHandler = handler;
        }
        if (event === "before_prompt_build") {
          beforePromptBuildHandler = handler;
        }
      },
    });

    await expect(beforeModelResolveHandler?.()).resolves.toBeUndefined();
    await expect(beforePromptBuildHandler?.()).resolves.toBeUndefined();
  });

  it("loads the current agent preset on every turn and supports clearing it", async () => {
    const { default: plugin } = await import(
      `${pluginModulePath}?preset=${Date.now()}`
    );
    let handler:
      | ((
          event: unknown,
          ctx: { agentId: string },
        ) => Promise<{ prependSystemContext: string } | undefined>)
      | undefined;
    plugin.register({
      on(event, callback) {
        if (event === "before_prompt_build") handler = callback;
      },
    });
    for (const preset of ["只用简洁中文回答", "先给结论", ""]) {
      await writeFile(
        stateModulePath,
        JSON.stringify({
          selectedModelRef: "deepseek/deepseek-chat",
          promptNotice: "Current model: DeepSeek",
          userPresets: { bot: preset, other: "another user's private preset" },
        }),
      );
      const result = await handler?.({}, { agentId: "bot" });
      expect(result?.prependSystemContext).toBe(
        ["Current model: DeepSeek", preset].filter(Boolean).join("\n\n"),
      );
      expect(result?.prependSystemContext).not.toContain("another user's");
    }
  });
  it("loads behavior preferences at generation time without replacing the user's preset", async () => {
    const behaviorFile = path.join(
      path.dirname(stateModulePath),
      "bridge-behavior.json",
    );
    let previous: string | null = null;
    try {
      previous = await readFile(behaviorFile, "utf8");
    } catch {
      /* No local test settings. */
    }
    try {
      const { default: plugin } = await import(
        `${pluginModulePath}?behavior=${Date.now()}`
      );
      await writeState("deepseek/deepseek-chat", "Current model: DeepSeek");
      let handler:
        | ((
            event: unknown,
            ctx: { agentId: string },
          ) => Promise<{ prependSystemContext: string } | undefined>)
        | undefined;
      plugin.register({
        on(event, callback) {
          if (event === "before_prompt_build") handler = callback;
        },
      });
      for (const promptContext of [
        "用温和语气，偶尔点缀 emoji。",
        "不要使用 Unicode emoji。",
      ]) {
        await writeFile(behaviorFile, JSON.stringify({ promptContext }));
        const result = await handler?.({}, { agentId: "bot" });
        expect(result?.prependSystemContext).toContain(
          "Current model: DeepSeek",
        );
        expect(result?.prependSystemContext).toContain(promptContext);
      }
      await writeFile(behaviorFile, "{bad");
      expect(
        (await handler?.({}, { agentId: "bot" }))?.prependSystemContext,
      ).toBe("Current model: DeepSeek");
    } finally {
      if (previous === null) await unlink(behaviorFile).catch(() => {});
      else await writeFile(behaviorFile, previous);
    }
  });
});
