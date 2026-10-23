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
      expect(disabled).not.toContain("不要使用 Unicode emoji。");
      await writer.write("openai/gpt-4.1");
      await unlink(behaviorFile);
      expect(
        (await handler?.({}, { agentId: "bot" }))?.prependSystemContext,
      ).toContain(WHALE_PERSONA);
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
      expect(result?.prependSystemContext).toContain("Current model: DeepSeek");
      if (preset) expect(result?.prependSystemContext).toContain(preset);
      expect(result?.prependSystemContext).toContain("不需要用户选择聊天模式");
      expect(result?.prependSystemContext).not.toContain("another user's");
    }
  });
  it("ignores retired expression settings without rewriting files or replacing an authored preset", async () => {
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
      await writeFile(
        stateModulePath,
        JSON.stringify({
          selectedModelRef: "deepseek/deepseek-chat",
          promptNotice: "Current model: DeepSeek",
          userPresets: {
            bot: "我的自写人设：需要时使用详细分析。",
            other: "another user's private preset",
          },
        }),
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
      for (const responseIntent of ["chat", "listen", "help"]) {
        const raw = JSON.stringify({
          responseIntent,
          tone: "warm",
          length: "short",
          emoji: "off",
          followUp: "rare",
          actions: "off",
          examples: "RETIRED_EXAMPLE_ONLY",
          promptContext:
            "RETIRED_GENERATED_PROMPT：通常用一到三句简短回答，不要使用 Unicode emoji。",
        });
        await writeFile(behaviorFile, raw);
        const result = await handler?.({}, { agentId: "bot" });
        expect(result?.prependSystemContext).toContain(
          "Current model: DeepSeek",
        );
        expect(result?.prependSystemContext).toContain(
          "我的自写人设：需要时使用详细分析。",
        );
        expect(result?.prependSystemContext).not.toContain(
          "another user's private preset",
        );
        expect(result?.prependSystemContext).not.toContain("RETIRED_");
        expect(result?.prependSystemContext).not.toContain(
          "通常用一到三句简短回答",
        );
        expect(result?.prependSystemContext).not.toContain(
          "不要使用 Unicode emoji。",
        );
        expect(result?.prependSystemContext).toContain(
          "根据当前内容决定篇幅、结构和语气",
        );
        expect(result?.prependSystemContext).toContain(
          "不把这些要求写入跨会话偏好",
        );
        expect(await readFile(behaviorFile, "utf8")).toBe(raw);
      }
      await writeFile(behaviorFile, "{bad");
      expect(
        (await handler?.({}, { agentId: "bot" }))?.prependSystemContext,
      ).toContain("不需要用户选择聊天模式");
    } finally {
      if (previous === null) await unlink(behaviorFile).catch(() => {});
      else await writeFile(behaviorFile, previous);
    }
  });

  it("adapts every turn without any saved behavior configuration", async () => {
    const behaviorFile = path.join(
      path.dirname(stateModulePath),
      "bridge-behavior.json",
    );
    const previous = await readFile(behaviorFile, "utf8").catch(() => null);
    try {
      const { default: plugin } = await import(
        `${pluginModulePath}?automatic=${Date.now()}`
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
      await unlink(behaviorFile).catch(() => {});
      const automatic = (await handler?.({}, { agentId: "bot" }))
        ?.prependSystemContext;
      expect(automatic).toContain("不需要用户选择聊天模式");
      expect(automatic).toContain("跟随当下话题变化");
      expect(automatic).toContain("一句话同时表达情绪和求助时兼顾两者");
      expect(automatic).toContain("只有确实影响回答时才自然问一个具体问题");
      expect(automatic).toContain("根据当前内容决定篇幅、结构和语气");
      expect(automatic).toContain("不把这些要求写入跨会话偏好");
      expect(automatic).toContain("不要输出表情图库标记。");
    } finally {
      if (previous === null) await unlink(behaviorFile).catch(() => {});
      else await writeFile(behaviorFile, previous);
    }
  });

  it("reloads enabled legacy sticker metadata without resaving and never advertises invalid or disabled libraries", async () => {
    const behaviorFile = path.join(
      path.dirname(stateModulePath),
      "bridge-behavior.json",
    );
    const stickersFile = path.join(
      path.dirname(stateModulePath),
      "bridge-stickers.json",
    );
    const previousBehavior = await readFile(behaviorFile, "utf8").catch(
      () => null,
    );
    const previousStickers = await readFile(stickersFile, "utf8").catch(
      () => null,
    );
    try {
      const { default: plugin } = await import(
        `${pluginModulePath}?stickers=${Date.now()}`
      );
      await writeFile(
        stateModulePath,
        JSON.stringify({
          selectedModelRef: "deepseek/deepseek-chat",
          promptNotice: "Current model: DeepSeek",
          deepseek: true,
          whalePersona: "Retained local persona",
        }),
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
      const item = {
        id: "11111111-1111-4111-8111-111111111111",
        label: "打招呼",
        tags: "见面、问候",
        extension: "png",
        privatePath: "MUST_NOT_REACH_MODEL",
      };
      const changed = {
        ...item,
        id: "22222222-2222-4222-8222-222222222222",
        label: "挥手",
        tags: "再见",
      };
      const legacy = JSON.stringify({
        length: "short",
        stickers: { enabled: true },
        promptContext: "STALE_GENERATED_LIBRARY_AND_STYLE",
      });
      await writeFile(behaviorFile, legacy);
      await writeFile(stickersFile, JSON.stringify([item]));
      const first = (await handler?.({}, { agentId: "bot" }))
        ?.prependSystemContext;
      expect(first).toContain(item.id);
      expect(first).toContain(item.label);
      expect(first).toContain(item.tags);
      expect(first).not.toContain("MUST_NOT_REACH_MODEL");
      expect(first).not.toContain("STALE_GENERATED");
      await writeFile(stickersFile, JSON.stringify([changed]));
      const current = (await handler?.({}, { agentId: "bot" }))
        ?.prependSystemContext;
      expect(current).toContain(changed.id);
      expect(current).toContain(changed.label);
      expect(current).not.toContain(item.id);
      expect(await readFile(behaviorFile, "utf8")).toBe(legacy);

      const expectHiddenLibrary = async () => {
        const context = (await handler?.({}, { agentId: "bot" }))
          ?.prependSystemContext;
        expect(context).toContain("不要输出表情图库标记。");
        expect(context).toContain("Retained local persona");
        expect(context).toContain("根据当前内容决定篇幅、结构和语气");
        expect(context).not.toContain(item.id);
        expect(context).not.toContain(changed.id);
        expect(context).not.toContain("可选表情图库");
      };
      await unlink(stickersFile);
      await expectHiddenLibrary();
      for (const invalid of [
        "{bad",
        JSON.stringify({ items: [item] }),
        JSON.stringify([]),
        JSON.stringify([item, { ...changed, id: "../../unknown-file" }]),
        JSON.stringify([{ ...item, label: "x".repeat(31) }]),
        JSON.stringify([{ ...item, tags: "x".repeat(121) }]),
        JSON.stringify(Array.from({ length: 25 }, () => item)),
      ]) {
        await writeFile(stickersFile, invalid);
        await expectHiddenLibrary();
      }
      await writeFile(stickersFile, JSON.stringify([item]));
      for (const enabled of [false, "true", undefined]) {
        await writeFile(
          behaviorFile,
          JSON.stringify({ stickers: { enabled } }),
        );
        await expectHiddenLibrary();
      }
    } finally {
      if (previousBehavior === null) await unlink(behaviorFile).catch(() => {});
      else await writeFile(behaviorFile, previousBehavior);
      if (previousStickers === null) await unlink(stickersFile).catch(() => {});
      else await writeFile(stickersFile, previousStickers);
    }
  });
});
