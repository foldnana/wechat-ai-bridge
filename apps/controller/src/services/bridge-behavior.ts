import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "@hono/zod-openapi";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const behaviorSchema = z.object({
  persona: z.enum(["auto", "whale", "none"]).default("auto"),
  incoming: z
    .object({ waitMs: z.number().int().min(0).max(60000).default(12000) })
    .default({}),
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
      topicMode: z.enum(["recent", "greeting"]).default("recent"),
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
