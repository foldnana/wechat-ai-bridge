import type { GetApiV1BridgeBehaviorResponse } from "../../lib/api/types.gen";

// Only expression and delivery preferences: never change identity, custom examples,
// imported stickers, or permission to initiate a conversation.
export const chatRecipes = [
  {
    id: "friend",
    name: "自然朋友",
    detail: "短句接话，偶尔问一句",
    sample: "终于能喘口气了。今天辛苦啦。",
    settings: {
      tone: "natural",
      length: "short",
      emoji: "occasional",
      followUp: "natural",
      actions: "off",
      delivery: { mode: "natural", maxBubbles: 2, pauseMs: 1200 },
    },
  },
  {
    id: "companion",
    name: "温柔陪伴",
    detail: "先听你说，不急着提建议",
    sample: "先歇一会儿吧。今天已经很努力了。",
    settings: {
      tone: "warm",
      length: "short",
      emoji: "occasional",
      followUp: "rare",
      actions: "off",
      delivery: { mode: "natural", maxBubbles: 2, pauseMs: 1800 },
    },
  },
  {
    id: "assistant",
    name: "利落助手",
    detail: "少寒暄，有事说重点",
    sample: "好，收工。剩下的明天再说。",
    settings: {
      tone: "concise",
      length: "balanced",
      emoji: "off",
      followUp: "rare",
      actions: "off",
      delivery: { mode: "single", maxBubbles: 2, pauseMs: 1200 },
    },
  },
] satisfies Array<{
  id: string;
  name: string;
  detail: string;
  sample: string;
  settings: Partial<GetApiV1BridgeBehaviorResponse>;
}>;
