// Explicit manual evaluation: synthetic conversations, real configured model.
// Does not read existing chats, use WeChat credentials, or send WeChat messages.
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ControllerEnv } from "../apps/controller/src/app/env.ts";
import { proxyFetch } from "../apps/controller/src/lib/proxy-fetch.ts";
import { OpenClawRuntimeModelWriter } from "../apps/controller/src/runtime/slimclaw-runtime-model-writer.ts";
import { incomingWaitMs } from "../apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/bridge-incoming-rhythm.ts";
import { replyBubbles } from "../apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/bridge-reply-rhythm.ts";
import { WHALE_PERSONA } from "../packages/shared/src/bridge-persona.ts";

const args = process.argv.slice(2);
const option = (key: string) => {
  const index = args.indexOf(key);
  const value = index < 0 ? undefined : args[index + 1];
  return value?.startsWith("--") ? undefined : value;
};
if (
  !args.includes("--live") ||
  !args.includes("--config") ||
  !args.includes("--out")
) {
  console.error(
    "Manual API evaluation requires --live --config <local config.json> --out <private output directory>. Uses paid API; no WeChat messages are sent.",
  );
  process.exit(1);
}
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = option("--config");
const outputPath = option("--out");
if (!configPath || !outputPath)
  throw new Error("Missing config or output path");
const suite = option("--suite") ?? "core";
if (suite !== "core" && suite !== "transfer") throw new Error("Unknown suite");
const out = path.resolve(outputPath);
await mkdir(out, { recursive: true });
const config = JSON.parse(await readFile(configPath, "utf8"));
const selected: string = config.bots?.[0]?.modelId ?? "";
const slash = selected.indexOf("/");
const provider = config.models?.providers?.[selected.slice(0, slash)];
if (
  !provider?.enabled ||
  typeof provider.apiKey !== "string" ||
  !provider.apiKey ||
  slash < 1
) {
  throw new Error(
    "No configured enabled model found; credentials are never printed.",
  );
}
const base = new URL(provider.baseUrl);
if (
  base.protocol !== "https:" ||
  base.username ||
  base.password ||
  base.search ||
  base.hash
)
  throw new Error("Unsupported API endpoint");
const core: Array<{ id: string; focus: string; turns: string[] }> = [
  {
    id: "casual",
    focus: "日常接话，不用角色比喻填充每句",
    turns: [
      "刚下班，今天开了一天会，脑子都木了。",
      "回家只想瘫着。",
      "哈哈你这条鱼懂什么上班",
    ],
  },
  {
    id: "listen-to-help",
    focus: "先倾听，再响应明确求助",
    turns: [
      "领导临下班又改需求，真的很烦。别急着教我怎么做，我就是吐槽一下。",
      "他一句很简单，我们就得重做。",
      "算了，帮我写一句明早跟他确认优先级的话吧。",
    ],
  },
  {
    id: "correction",
    focus: "合并消息采用后续纠正，不猜测",
    turns: [
      "明天去上海\n说错了，是后天去杭州\n下午两点到",
      "所以我哪天去哪？一句话就行。",
    ],
  },
  {
    id: "goodnight",
    focus: "结束时不追问，不承诺主动联系",
    turns: ["先不聊了，我去睡觉，晚安。"],
  },
  {
    id: "practical",
    focus: "直接给可执行帮助，少铺垫",
    turns: [
      "明早九点面试，我现在只有半小时准备，先做什么？",
      "就三件事，别讲大道理。",
    ],
  },
  {
    id: "reality",
    focus: "角色玩笑不冒充真实经历",
    turns: ["大肥鱼，你今天午饭吃啥？", "你真吃过？还是编的？"],
  },
  {
    id: "ambiguity",
    focus: "缺上下文只问必要问题",
    turns: ["他又这样了。", "我说的是我室友又把垃圾留给我倒了。"],
  },
  {
    id: "unknown-memory",
    focus: "不编造未提供的记忆",
    turns: ["你还记得我昨天去哪了吗？", "不知道就说不知道，别猜。"],
  },
];
const transfer = [
  {
    id: "small-win",
    focus: "接住开心的事情，不索取更多互动",
    turns: [
      "我第一次自己做蛋糕，虽然塌了但居然挺好吃哈哈",
      "不许给我上烘焙课，我就是来炫耀的",
    ],
  },
  {
    id: "changed-plan",
    focus: "后续纠正覆盖旧事实",
    turns: [
      "给姐姐买红色的杯子\n等等，是给妹妹，颜色改成绿色",
      "现在买给谁，什么颜色？只说答案",
    ],
  },
  {
    id: "text-only",
    focus: "没有图片时不假装看到了",
    turns: ["我刚剪了头发，你看好看不？", "我没发照片，就是想逗你一下"],
  },
  {
    id: "quick-copy",
    focus: "急着出门时给能直接使用的短句",
    turns: [
      "我正赶公交，帮我写一句告诉朋友我会晚到十分钟，不要解释",
      "好，我先走了，你不用再问了",
    ],
  },
  {
    id: "change-intent",
    focus: "从吐槽切换到办事，不沿用上一轮意图",
    turns: [
      "复习半天还是什么都记不住，烦死了，先让我吐槽",
      "好了，帮我把今晚四十分钟分成两个复习步骤，别再安慰我",
    ],
  },
];
const scenarios = suite === "core" ? core : transfer;
// Run the actual prompt plugin against a separate, synthetic state directory.
const isolated = await mkdtemp(path.join(os.tmpdir(), "bridge-chat-eval-"));
const pluginDir = path.join(isolated, "runtime-plugins", "nexu-runtime-model");
await mkdir(pluginDir, { recursive: true });
await cp(
  path.join(
    repo,
    "apps/controller/static/runtime-plugins/nexu-runtime-model/index.js",
  ),
  path.join(pluginDir, "index.mjs"),
);
await new OpenClawRuntimeModelWriter({
  openclawRuntimeModelStatePath: path.join(isolated, "nexu-runtime-model.json"),
} as ControllerEnv).write(selected);
await writeFile(
  path.join(isolated, "bridge-behavior.json"),
  JSON.stringify({ persona: "whale", stickers: { enabled: false } }),
);
const { default: plugin } = await import(
  pathToFileURL(path.join(pluginDir, "index.mjs")).href
);
type PromptHook = (
  event: unknown,
  ctx: unknown,
) => Promise<{ prependSystemContext: string }>;
const hooks: { buildPrompt?: PromptHook } = {};
plugin.register({
  on(event: string, handler: PromptHook) {
    if (event === "before_prompt_build") hooks.buildPrompt = handler;
  },
});
if (!hooks.buildPrompt) throw new Error("Missing application prompt hook");
const system = (
  await hooks.buildPrompt({}, { agentId: "synthetic-evaluation" })
).prependSystemContext;
if (!system.includes(WHALE_PERSONA)) {
  throw new Error(
    "Stale shared build: run pnpm --filter @nexu/shared build before evaluation. No API requests were made.",
  );
}
await writeFile(path.join(out, "prompt.txt"), system);
const results: unknown[] = [];
let failedTurns = 0;
let cursor = 0;
async function worker() {
  while (cursor < scenarios.length) {
    const scenario = scenarios[cursor++];
    if (!scenario) break;
    const messages = [{ role: "system", content: system }];
    const turns: unknown[] = [];
    for (const user of scenario.turns) {
      messages.push({ role: "user", content: user });
      const start = performance.now();
      try {
        const response = await proxyFetch(
          `${base.toString().replace(/\/+$/, "")}/chat/completions`,
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(60000),
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${provider.apiKey}`,
            },
            body: JSON.stringify({
              model: selected.slice(slash + 1),
              messages,
              max_tokens: 600,
              temperature: 0.7,
              stream: false,
            }),
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`HTTP ${response.status}`);
        }
        const result = (await response.json()) as {
          choices?: Array<{
            message?: { content?: string };
            finish_reason?: string;
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const answer = result.choices?.[0]?.message?.content;
        if (typeof answer !== "string" || !answer.trim())
          throw new Error("empty response");
        messages.push({ role: "assistant", content: answer });
        turns.push({
          user,
          answer,
          generationMs: Math.round(performance.now() - start),
          gatheringMs: incomingWaitMs(user),
          bubbles: replyBubbles(answer, answer, {
            mode: "natural",
            maxBubbles: 2,
            pauseMs: 1200,
          }),
          usage: result.usage,
          finishReason: result.choices?.[0]?.finish_reason,
        });
      } catch (error) {
        failedTurns++;
        // Never print fetch errors, URLs, provider bodies or the configuration.
        turns.push({
          user,
          error:
            error instanceof Error &&
            /^HTTP \d+$|^empty response$/.test(error.message)
              ? error.message
              : "network_or_timeout",
        });
        break;
      }
    }
    const record = { id: scenario.id, focus: scenario.focus, turns };
    results.push(record);
    await writeFile(
      path.join(out, `${scenario.id}.json`),
      JSON.stringify(record, null, 2),
    );
    console.log(
      JSON.stringify({ scenario: scenario.id, completedTurns: turns.length }),
    );
  }
}
await Promise.all([worker(), worker()]);
await writeFile(
  path.join(out, "results.json"),
  JSON.stringify(
    {
      model: selected,
      suite,
      failedTurns,
      createdAt: new Date().toISOString(),
      syntheticOnly: true,
      transport: "direct-model-api-with-application-prompt-hook",
      fullOpenClawAndWeChatTested: false,
      temperature: 0.7,
      maxOutputTokens: 600,
      promptHash: createHash("sha256").update(system).digest("hex"),
      scenarios: results,
    },
    null,
    2,
  ),
);
if (failedTurns) process.exitCode = 1;
