// Manual, explicitly authorized paid-API evaluation. Never connects to WeChat.
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildProviderRuntimeModelId,
  listModelProviderRuntimeDescriptors,
} from "../apps/controller/src/lib/model-provider-runtime.js";
import {
  defaultBridgeModelOptions,
  savedModelOptions,
} from "../apps/controller/src/services/bridge-model-options.js";

const args = process.argv.slice(2);
const opt = (name: string) => args[args.indexOf(name) + 1];
if (
  !args.includes("--live") ||
  !args.includes("--package") ||
  !args.includes("--cases") ||
  !args.includes("--out")
)
  throw new Error("Requires explicit --live --package --cases --out");
const packaged = path.resolve(opt("--package"));
const out = path.resolve(opt("--out"));
await mkdir(out, { recursive: true });
const config = JSON.parse(
  await readFile(
    path.join(os.homedir(), ".wechat-ai-bridge/config.json"),
    "utf8",
  ),
);
const selected =
  config.runtime?.defaultModelId ||
  config.desktop?.selectedModelId ||
  config.bots?.[0]?.modelId;
const descriptor = listModelProviderRuntimeDescriptors(config)
  .sort((a, b) => b.persistedKey.length - a.persistedKey.length)
  .find((item) => selected?.startsWith(`${item.persistedKey}/`));
if (
  !descriptor?.provider.enabled ||
  typeof descriptor.provider.apiKey !== "string" ||
  descriptor.apiKind !== "openai-completions"
)
  throw new Error("No compatible configured model");
const id = selected.slice(descriptor.persistedKey.length + 1);
const base = new URL(descriptor.provider.baseUrl);
if (
  base.protocol !== "https:" ||
  base.username ||
  base.password ||
  base.search ||
  base.hash
)
  throw new Error("Unsupported provider URL");
const runtime = path.join(packaged, "resources/runtime");
const load = (file: string) => import(pathToFileURL(file).href);
const { OpenClawRuntimeModelWriter } = await load(
  path.join(
    runtime,
    "controller/dist/runtime/slimclaw-runtime-model-writer.js",
  ),
);
const { streamOpenAICompletions } = await load(
  path.join(
    runtime,
    "openclaw/node_modules/@mariozechner/pi-ai/dist/providers/openai-completions.js",
  ),
);
const isolated = await mkdtemp(path.join(os.tmpdir(), "bridge-release-eval-"));
process.env.OPENCLAW_STATE_DIR = isolated;
const pluginDir = path.join(isolated, "runtime-plugins/nexu-runtime-model");
await mkdir(pluginDir, { recursive: true });
await cp(
  path.join(
    runtime,
    "controller/static/runtime-plugins/nexu-runtime-model/index.js",
  ),
  path.join(pluginDir, "index.mjs"),
);
const model = {
  id: buildProviderRuntimeModelId(descriptor, id),
  name: id,
  api: "openai-completions",
  provider: descriptor.runtimeKey,
  baseUrl: descriptor.provider.baseUrl,
  reasoning: false,
  input: ["text", "image"],
  contextWindow: 200000,
  maxTokens: 8192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: { supportsStore: false },
};
const options =
  savedModelOptions(descriptor.provider)[id] ?? defaultBridgeModelOptions;
const botId = "synthetic-release-review";
await new OpenClawRuntimeModelWriter({
  openclawRuntimeModelStatePath: path.join(isolated, "nexu-runtime-model.json"),
}).write(
  `${model.provider}/${model.id}`,
  { [botId]: config.bots?.[0]?.systemPrompt ?? "" },
  [
    {
      provider: model.provider,
      model: model.id,
      baseUrl: model.baseUrl,
      options,
    },
  ],
);
await writeFile(
  path.join(isolated, "bridge-behavior.json"),
  JSON.stringify({ persona: "whale", stickers: { enabled: false } }),
);
const { default: plugin } = await load(path.join(pluginDir, "index.mjs"));
let hook:
  | ((
      event: unknown,
      context: unknown,
    ) => Promise<{ prependSystemContext: string }>)
  | undefined;
plugin.register({
  on(name: string, fn: typeof hook) {
    if (name === "before_prompt_build") hook = fn;
  },
});
if (!hook) throw new Error("Prompt hook unavailable");
const systemPrompt = (await hook({}, { agentId: botId })).prependSystemContext;
const scenarios: Array<{ id: string; turns: string[] }> = JSON.parse(
  await readFile(path.resolve(opt("--cases")), "utf8"),
);
const prior = args.includes("--continue-from")
  ? JSON.parse(await readFile(path.resolve(opt("--continue-from")), "utf8"))
  : null;
if (scenarios.reduce((sum, s) => sum + s.turns.length, 0) > 30)
  throw new Error("Evaluation capped at 30 turns");
const results: unknown[] = [];
const apiKey = descriptor.provider.apiKey;
let index = 0;
let failures = 0;
async function worker() {
  while (index < scenarios.length && failures < 2) {
    const scenario = scenarios[index++];
    const messages: unknown[] = [];
    const history =
      prior?.scenarios?.find((s: { id: string }) => s.id === scenario.id)
        ?.turns ?? [];
    for (const turn of history) {
      if (!turn.answer || turn.failed) continue;
      messages.push({
        role: "user",
        content: turn.user,
        timestamp: Date.now(),
      });
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: turn.answer }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        stopReason: "stop",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: model.cost,
        },
        timestamp: Date.now(),
      });
    }
    const turns: unknown[] = [];
    for (const user of scenario.turns) {
      if (failures >= 2) break;
      messages.push({ role: "user", content: user, timestamp: Date.now() });
      const started = performance.now();
      let firstTextMs: number | null = null;
      try {
        const stream = streamOpenAICompletions(
          model,
          { systemPrompt, messages },
          { apiKey },
        );
        for await (const event of stream)
          if (event.type === "text_delta" && firstTextMs === null)
            firstTextMs = Math.round(performance.now() - started);
        const answer = await stream.result();
        const text = answer.content
          .filter((block: { type: string }) => block.type === "text")
          .map((block: { text: string }) => block.text)
          .join("");
        const failed = answer.stopReason !== "stop" || !text.trim();
        if (failed) failures++;
        turns.push({
          user,
          answer: text,
          stopReason: answer.stopReason,
          failed,
          firstTextMs,
          generationMs: Math.round(performance.now() - started),
          usage: {
            input: answer.usage.input,
            output: answer.usage.output,
            cacheRead: answer.usage.cacheRead,
          },
          ...(failed ? { error: "provider_or_timeout_or_truncation" } : {}),
        });
        if (failed) break;
        messages.push(answer);
      } catch {
        failures++;
        turns.push({ user, failed: true, error: "request_failed" });
        break;
      }
    }
    const record = { id: scenario.id, turns };
    results.push(record);
    await writeFile(
      path.join(out, `${scenario.id}.json`),
      JSON.stringify(record, null, 2),
    );
    console.log(
      JSON.stringify({ scenario: scenario.id, turns: turns.length, failures }),
    );
  }
}
await Promise.all([worker(), worker()]);
await writeFile(
  path.join(out, "results.json"),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      selectedModel: selected,
      options,
      package: packaged,
      transport: "packaged-pi-ai-and-prompt-plugin",
      realApi: true,
      realWechat: false,
      syntheticOnly: true,
      failures,
      plannedScenarios: scenarios.length,
      scenarios: results,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ completed: results.length, failures, output: out }),
);
if (failures) process.exitCode = 1;
