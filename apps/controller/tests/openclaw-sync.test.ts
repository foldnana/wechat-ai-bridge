import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { modelProviderConfigSchema } from "@nexu/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import type { compileOpenClawConfig } from "../src/lib/openclaw-config-compiler.js";
import { OpenClawAuthProfilesStore } from "../src/runtime/openclaw-auth-profiles-store.js";
import { OpenClawAuthProfilesWriter } from "../src/runtime/openclaw-auth-profiles-writer.js";
import { OpenClawConfigWriter } from "../src/runtime/openclaw-config-writer.js";
import { OpenClawWatchTrigger } from "../src/runtime/openclaw-watch-trigger.js";
import { OpenClawRuntimeModelWriter } from "../src/runtime/slimclaw-runtime-model-writer.js";
import { OpenClawRuntimePluginWriter } from "../src/runtime/slimclaw-runtime-plugin-writer.js";
import { WorkspaceTemplateWriter } from "../src/runtime/workspace-template-writer.js";
import type { OpenClawGatewayService } from "../src/services/openclaw-gateway-service.js";
import { OpenClawSyncService } from "../src/services/openclaw-sync-service.js";
import { CompiledOpenClawStore } from "../src/store/compiled-openclaw-store.js";
import { NexuConfigStore } from "../src/store/nexu-config-store.js";

describe("OpenClawSyncService", () => {
  let rootDir = "";
  let env: ControllerEnv;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-controller-sync-"));
    env = {
      nodeEnv: "test",
      port: 3010,
      host: "127.0.0.1",
      webUrl: "http://localhost:5173",
      nexuHomeDir: path.join(rootDir, ".nexu"),
      nexuConfigPath: path.join(rootDir, ".nexu", "config.json"),
      artifactsIndexPath: path.join(
        rootDir,
        ".nexu",
        "artifacts",
        "index.json",
      ),
      compiledOpenclawSnapshotPath: path.join(
        rootDir,
        ".nexu",
        "compiled-openclaw.json",
      ),
      openclawStateDir: path.join(rootDir, ".openclaw"),
      openclawConfigPath: path.join(rootDir, ".openclaw", "openclaw.json"),
      openclawSkillsDir: path.join(rootDir, ".openclaw", "skills"),
      openclawExtensionsDir: path.join(rootDir, ".openclaw", "extensions"),
      runtimePluginTemplatesDir: path.join(rootDir, "runtime-plugins"),
      openclawCuratedSkillsDir: path.join(
        rootDir,
        ".openclaw",
        "bundled-skills",
      ),
      openclawRuntimeModelStatePath: path.join(
        rootDir,
        ".openclaw",
        "nexu-runtime-model.json",
      ),
      creditGuardStatePath: path.join(
        rootDir,
        ".openclaw",
        "nexu-credit-guard-state.json",
      ),
      skillhubCacheDir: path.join(rootDir, ".nexu", "skillhub-cache"),
      skillDbPath: path.join(rootDir, ".nexu", "skill-ledger.json"),
      analyticsStatePath: path.join(rootDir, ".nexu", "analytics-state.json"),
      staticSkillsDir: undefined,
      platformTemplatesDir: undefined,
      openclawWorkspaceTemplatesDir: path.join(
        rootDir,
        ".openclaw",
        "workspace-templates",
      ),
      openclawBin: "openclaw",
      litellmBaseUrl: null,
      litellmApiKey: null,
      openclawGatewayPort: 18789,
      openclawGatewayToken: undefined,
      manageOpenclawProcess: false,
      gatewayProbeEnabled: false,
      runtimeSyncIntervalMs: 2000,
      runtimeHealthIntervalMs: 5000,
      defaultModelId: "anthropic/claude-sonnet-4",
      posthogApiKey: undefined,
      posthogHost: undefined,
    };
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("writes compiled config and templates from controller state", async () => {
    const configStore = new NexuConfigStore(env);
    const compiledStore = new CompiledOpenClawStore(env);
    const authProfilesStore = new OpenClawAuthProfilesStore(env);
    const syncService = new OpenClawSyncService(
      env,
      configStore,
      compiledStore,
      new OpenClawConfigWriter(env),
      new OpenClawAuthProfilesWriter(authProfilesStore),
      authProfilesStore,
      new OpenClawRuntimePluginWriter(env),
      new OpenClawRuntimeModelWriter(env),
      new WorkspaceTemplateWriter(env),
      new OpenClawWatchTrigger(env),
      {
        isConnected: () => false,
        shouldPushConfig: async () => false,
        noteConfigWritten: () => {},
      } as unknown as OpenClawGatewayService,
    );

    const bot = await configStore.createBot({
      name: "Assistant",
      slug: "assistant",
    });
    await configStore.connectWechat({ accountId: "test-wechat" });
    env.platformTemplatesDir = path.join(rootDir, "platform-templates");
    await mkdir(env.platformTemplatesDir, { recursive: true });
    await writeFile(path.join(env.platformTemplatesDir, "AGENTS.md"), "hello");
    await syncService.writePlatformTemplatesForBot(bot.id);
    const options = { thinking: "auto", timeoutSeconds: 120, retries: 0 };
    await configStore.saveProviderAndSelectModel(
      "custom-openai/bridge",
      modelProviderConfigSchema.parse({
        providerTemplateId: "custom-openai",
        instanceId: "bridge",
        api: "openai-completions",
        apiKey: "synthetic-key",
        baseUrl: "https://api.example.invalid/v1",
        models: [
          { id: "synthetic-model", name: "Synthetic" },
          { id: "legacy-model", name: "Legacy" },
        ],
        metadata: { bridgeModelOptions: { "synthetic-model": options } },
      }),
      "custom-openai/bridge/synthetic-model",
    );

    await syncService.syncAll();
    const runtimeState = JSON.parse(
      await readFile(env.openclawRuntimeModelStatePath, "utf8"),
    );
    expect(runtimeState.requestOptions).toEqual([
      {
        provider: "custom-openai__bridge",
        model: "synthetic-model",
        baseUrl: "https://api.example.invalid/v1",
        options,
      },
      {
        provider: "custom-openai__bridge",
        model: "legacy-model",
        baseUrl: "https://api.example.invalid/v1",
        options: { thinking: "auto", timeoutSeconds: 90, retries: 1 },
      },
    ]);
    expect(JSON.stringify(runtimeState)).not.toContain("synthetic-key");

    const config = JSON.parse(
      await readFile(env.openclawConfigPath, "utf8"),
    ) as ReturnType<typeof compileOpenClawConfig>;
    expect(config.agents.list).toHaveLength(1);
    expect(
      config.channels["openclaw-weixin"]?.accounts?.["test-wechat"],
    ).toEqual({ enabled: true });

    const templateFile = await readFile(
      path.join(env.openclawStateDir, "agents", bot.id, "AGENTS.md"),
      "utf8",
    );
    expect(templateFile).toBe("hello");

    const snapshot = JSON.parse(
      await readFile(env.compiledOpenclawSnapshotPath, "utf8"),
    ) as { config: Record<string, unknown> };
    expect(snapshot.config).toBeTruthy();
  });
});
