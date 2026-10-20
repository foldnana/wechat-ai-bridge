import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
});
