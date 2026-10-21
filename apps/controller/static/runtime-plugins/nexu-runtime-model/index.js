import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginDir = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.resolve(
  pluginDir,
  "..",
  "..",
  "nexu-runtime-model.json",
);

let cachedRaw = null;
let cachedState = null;

// Applied on every turn, including before behavior settings have ever been saved.
const conversationGuidance = [
  "自然接话规则（每一轮结合当前消息与上下文理解，不需要用户选择聊天模式）：",
  "对方分享小事时回应具体内容，自然接话；倾诉和吐槽时先听、回应具体遭遇，不急着劝好、诊断或列建议；询问办法、解释或具体帮助时认真解决问题，先给最有用的下一步。",
  "同一个人可以从吐槽转到求助，再转到玩笑。跟随当下话题变化，不沿用上一轮的意图标签，不凭单个关键词判断；一句话同时表达情绪和求助时兼顾两者。",
  "不要求对方去设置、不宣布切换模式，也不要每轮问‘你需要倾听还是建议’。意思不够明确时先回应已知内容，只有确实影响回答时才自然问一个具体问题。",
  "根据当前内容决定篇幅、结构和语气：闲聊简短，复杂问题讲清楚，不为凑长度补话，也不为简短省略必要信息。对方说‘简单点’‘展开讲讲’‘别分点’等要求时，在当前对话中直接适应；不要求修改设置，也不把这些要求写入跨会话偏好。",
  "默认使用自然的聊天文字，避免重复问候、客服套话、长篇说教、机械追问和无关的括号旁白。用户自写的人设和当前明确要求仍生效；对方结束话题时自然收尾。",
].join("\n");

function stickerContext(enabled) {
  if (enabled === true) {
    try {
      const items = JSON.parse(
        readFileSync(
          path.join(path.dirname(statePath), "bridge-stickers.json"),
          "utf8",
        ),
      );
      if (
        Array.isArray(items) &&
        items.length > 0 &&
        items.length <= 24 &&
        items.every(
          (item) =>
            item &&
            typeof item.id === "string" &&
            /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
              item.id,
            ) &&
            typeof item.label === "string" &&
            item.label.trim().length > 0 &&
            item.label.length <= 30 &&
            typeof item.tags === "string" &&
            item.tags.trim().length > 0 &&
            item.tags.length <= 120,
        )
      ) {
        return `可选表情图库（只依据标签选择，不需要读取文件）：${JSON.stringify(items.map(({ id, label, tags }) => ({ id, label, tags })))}。合适时在正常文字末尾添加一个 [[sticker:ID]]，ID 必须来自图库；没有合适的就不加。不要声称图片已经发送，发送由程序决定。`;
      }
    } catch {
      /* Missing or invalid metadata cannot enable sticker selection. */
    }
  }
  return "不要输出表情图库标记。";
}

function loadState() {
  try {
    const raw = readFileSync(statePath, "utf8");
    if (cachedState && cachedRaw === raw) {
      return cachedState;
    }
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.selectedModelRef !== "string" ||
      typeof parsed.promptNotice !== "string"
    ) {
      return null;
    }
    cachedRaw = raw;
    cachedState = parsed;
    return parsed;
  } catch {
    return cachedState;
  }
}

const plugin = {
  id: "nexu-runtime-model",
  name: "Nexu Runtime Model",
  description:
    "Injects Nexu runtime model selection into model routing and prompt context.",
  register(api) {
    api.on("before_model_resolve", async () => {
      const state = loadState();
      if (!state) {
        return;
      }
      if (state.selectedModelRef.trim().length === 0) {
        return;
      }
      const slashIndex = state.selectedModelRef.indexOf("/");
      const providerOverride = state.selectedModelRef.slice(0, slashIndex);
      const modelOverride =
        slashIndex > 0
          ? state.selectedModelRef.slice(slashIndex + 1)
          : state.selectedModelRef;
      return {
        ...(slashIndex > 0 ? { providerOverride } : {}),
        modelOverride,
      };
    });

    api.on("before_prompt_build", async (_event, ctx) => {
      const state = loadState();
      if (
        !state ||
        state.selectedModelRef.trim().length === 0 ||
        state.promptNotice.trim().length === 0
      ) {
        return;
      }
      const preset = state.userPresets?.[ctx?.agentId];
      let stickersEnabled = false;
      let persona = "auto";
      try {
        const behavior = JSON.parse(
          readFileSync(
            path.join(path.dirname(statePath), "bridge-behavior.json"),
            "utf8",
          ),
        );
        // Retired global expression settings and generated promptContext are
        // deliberately ignored, including in existing installations.
        stickersEnabled = behavior.stickers?.enabled === true;
        persona = ["auto", "whale", "none"].includes(behavior.persona)
          ? behavior.persona
          : "auto";
      } catch (error) {
        if (error?.code !== "ENOENT") persona = "none";
        /* Missing or unreadable behavior settings do not change the base preset. */
      }
      const customPreset = typeof preset === "string" ? preset.trim() : "";
      const defaultPersona =
        persona === "whale" || (persona === "auto" && state.deepseek === true)
          ? state.whalePersona
          : "";
      return {
        prependSystemContext: [
          state.promptNotice,
          customPreset ||
            (typeof defaultPersona === "string" ? defaultPersona : ""),
          conversationGuidance,
          stickerContext(stickersEnabled),
        ]
          .filter(Boolean)
          .join("\n\n"),
      };
    });
  },
};

export default plugin;
