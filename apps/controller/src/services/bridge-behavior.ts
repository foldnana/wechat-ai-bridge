import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "@hono/zod-openapi";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const behaviorSchema = z.object({
  persona: z.enum(["auto", "whale", "none"]).default("auto"),
  tone: z.enum(["natural", "warm", "concise"]).default("natural"),
  length: z.enum(["short", "balanced", "detailed"]).default("balanced"),
  emoji: z.enum(["off", "occasional", "expressive"]).default("occasional"),
  followUp: z.enum(["rare", "natural", "curious"]).default("natural"),
  actions: z.enum(["off", "occasional"]).default("off"),
  examples: z.string().trim().max(2000).default(""),
  delivery: z
    .object({
      mode: z.enum(["single", "natural"]).default("single"),
      maxBubbles: z.number().int().min(2).max(3).default(2),
      pauseMs: z.number().int().min(500).max(3000).default(1200),
    })
    .default({}),
  stickers: z
    .object({
      enabled: z.boolean().default(false),
      probability: z.number().int().min(0).max(100).default(25),
      cooldownMinutes: z.number().int().min(1).max(1440).default(10),
    })
    .default({}),
  proactive: z
    .object({
      enabled: z.boolean().default(false),
      channelIds: z.array(z.string().min(1).max(200)).max(20).default([]),
      intervalMinutes: z.number().int().min(5).max(1440).default(120),
      quietStart: clock.default("22:00"),
      quietEnd: clock.default("08:00"),
      dailyLimit: z.number().int().min(1).max(12).default(3),
      unansweredLimit: z.number().int().min(1).max(3).default(1),
      prompt: z
        .string()
        .trim()
        .min(1)
        .max(2000)
        .default(
          "自然地问候，或接着之前的话题轻轻聊一句。不要催促回复，不要虚构实时消息。",
        ),
    })
    .default({}),
});
export const stickerSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(30),
  tags: z.string().trim().min(1).max(120),
  extension: z.enum(["png", "jpg", "gif"]),
});
export const stickerListSchema = z.array(stickerSchema).max(24);
export const stickerInputSchema = z.object({
  label: stickerSchema.shape.label,
  tags: stickerSchema.shape.tags,
  data: z.string().max(2_800_000),
});
export function behaviorPrompt(
  config: z.infer<typeof behaviorSchema>,
  items: z.infer<typeof stickerListSchema>,
) {
  const tone = {
    natural: "语气自然，像日常聊天，避免客服套话。",
    warm: "语气温和、耐心，尊重对方，不强迫亲密或回复。",
    concise: "表达直接，先说重点，减少寒暄。",
  };
  const length = {
    short: "通常用一到三句简短回答，复杂问题可适当展开。",
    balanced: "按问题复杂程度控制篇幅，日常聊天不要长篇说教。",
    detailed: "需要解释时给出清晰细节和例子，避免重复。",
  };
  const emoji = {
    off: "不要使用 Unicode emoji。",
    occasional: "偶尔使用贴合语境的 emoji，不要每条都用。",
    expressive: "可以使用贴合语境的 emoji，每条通常不超过两个。",
  };
  return [
    "用户在本机设置的聊天偏好：",
    tone[config.tone],
    length[config.length],
    emoji[config.emoji],
    "日常闲聊先回应对方此刻的内容和情绪，不把一句闲聊写成分析报告。除非问题需要，不使用标题、编号、总结或建议清单。不要复述整句提问，不要反复用‘我理解你的感受’或‘还有什么可以帮你’收尾。",
    "顺着已有上下文接话，避免每轮重新问候。对方只是分享时可以简单回应，不急着给解决方案。对方要求具体帮助时认真回答，不能为了简短而遗漏必要内容。",
    {
      rare: "通常不在结尾追问；只有回答所必需的信息缺失时，才问一个具体问题。",
      natural:
        "不必每句都接一个问题。有真正值得接着聊的细节时，偶尔问一个具体问题；对方说要休息或结束时自然收尾。",
      curious:
        "可以围绕对方刚说的细节接着聊，每次最多问一个问题，避免连续盘问；对方不想聊或要结束时停止追问。",
    }[config.followUp],
    config.actions === "off"
      ? "只用聊天文字表达，不添加括号动作、舞台旁白或心理描写。"
      : "在已约定的角色扮演中可以偶尔用一句简短动作描写；普通问答不加旁白，不把虚构动作说成真实发生。",
    "以下仅是表达方式示例，不是对方的经历或记忆；不要照抄示例、固定开场或与用户完整预设冲突的身份。",
    config.examples ||
      {
        natural:
          "对方：终于忙完了。\n回复：终于能喘口气了。今天辛苦啦。\n对方：先去睡了。\n回复：去吧，晚安。",
        warm: "对方：今天什么都没做成。\n回复：有时候一天就是会这样。先歇一会儿，别急着给今天打分。\n对方：不想说话。\n回复：好，那就安静待会儿。想聊的时候再来。",
        concise:
          "对方：两个方案选不出来。\n回复：把两个方案发我，我帮你看看差别。\n对方：搞定了。\n回复：好，收工。",
      }[config.tone],
    config.stickers.enabled && items.length
      ? `可选表情图库（只依据标签选择，不需要读取文件）：${JSON.stringify(items.map(({ id, label, tags }) => ({ id, label, tags })))}。合适时在正常文字末尾添加一个 [[sticker:ID]]，ID 必须来自图库；没有合适的就不加。不要声称图片已经发送，发送由程序决定。`
      : "不要输出表情图库标记。",
    "完整预设中的身份与关系设定、用户当前明确要求优先于以上通用风格示例。这些偏好不改变用户当前问题。不要虚构实时信息、经历、未提供的共同记忆或外部行动。不要主动反复声明 AI 身份；被问及时如实说明。",
  ].join("\n");
}
export async function readBehavior(root: string) {
  try {
    return behaviorSchema.parse(
      JSON.parse(
        await readFile(path.join(root, "bridge-behavior.json"), "utf8"),
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return behaviorSchema.parse({});
    throw new Error("行为配置无法读取，请检查本机文件。");
  }
}
export async function readStickers(root: string) {
  try {
    return stickerListSchema.parse(
      JSON.parse(
        await readFile(path.join(root, "bridge-stickers.json"), "utf8"),
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("表情图库无法读取。");
  }
}
export async function writeBridgeJson(
  root: string,
  name: string,
  data: unknown,
) {
  await mkdir(root, { recursive: true });
  const target = path.join(root, name);
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data), { mode: 0o600 });
  await rename(temp, target);
}
export function decodeSticker(data: string) {
  const match =
    /^data:image\/(png|jpeg|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match) throw new Error("请选择 PNG、JPEG 或 GIF 图片。");
  const bytes = Buffer.from(match[2] ?? "", "base64");
  if (bytes.length > 2 * 1024 * 1024 || bytes.length < 16)
    throw new Error("图片应小于 2 MB，且是有效的图片文件。");
  const valid =
    match[1] === "png"
      ? bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : match[1] === "jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString());
  if (!valid) throw new Error("图片内容与格式不一致。");
  return {
    bytes,
    extension: (match[1] === "jpeg" ? "jpg" : match[1]) as
      | "png"
      | "jpg"
      | "gif",
  };
}
