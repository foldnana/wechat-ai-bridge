import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resolveStateDir } from "./state-dir.js";
import { bridgeRepliesPaused } from "./bridge-control.js";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const schema = z.object({
  delivery: z.object({
    mode: z.enum(["single", "natural"]),
    maxBubbles: z.number().int().min(2).max(3),
    pauseMs: z.number().int().min(500).max(3000),
  }).default({ mode: "single", maxBubbles: 2, pauseMs: 1200 }),
  stickers: z.object({
    enabled: z.boolean(),
    probability: z.number().int().min(0).max(100),
    cooldownMinutes: z.number().int().min(1).max(1440),
  }),
  proactive: z.object({
    enabled: z.boolean(),
    intervalMinutes: z.number().int().min(5).max(1440),
    quietStart: clock,
    quietEnd: clock,
    dailyLimit: z.number().int().min(1).max(12),
    unansweredLimit: z.number().int().min(1).max(3),
    prompt: z.string().min(1).max(2000),
  }),
  accountHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(20),
});
export type Behavior = z.infer<typeof schema>;
export function loadBehavior(): Behavior | null {
  try {
    return schema.parse(
      JSON.parse(
        readFileSync(
          path.join(resolveStateDir(), "bridge-behavior.json"),
          "utf8",
        ),
      ),
    );
  } catch {
    return null;
  }
}
export const bridgeHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function writeBehaviorState(
  folder: string,
  key: string,
  value: unknown,
) {
  const dir = path.join(resolveStateDir(), folder);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${bridgeHash(key)}.json`);
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  renameSync(temp, file);
}
export function readBehaviorState(folder: string, key: string): unknown {
  try {
    return JSON.parse(
      readFileSync(
        path.join(resolveStateDir(), folder, `${bridgeHash(key)}.json`),
        "utf8",
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export function stripStickerMarkers(text: string) {
  return text.replace(/\[\[sticker:[^\]\r\n]*\]\]/gi, "").trim();
}
const stickersSchema = z
  .array(
    z.object({
      id: z.string().uuid(),
      label: z.string(),
      tags: z.string(),
      extension: z.enum(["png", "jpg", "gif"]),
    }),
  )
  .max(24);
const stickerTimes = new Map<string, number>();
export function chooseSticker(
  text: string,
  key: string,
  now = Date.now(),
  random = Math.random,
): string | undefined {
  const config = loadBehavior();
  if (!config?.stickers.enabled || bridgeRepliesPaused()) return;
  if (
    now - (stickerTimes.get(key) ?? 0) <
    config.stickers.cooldownMinutes * 60000
  )
    return;
  const id = /\[\[sticker:([a-f0-9-]{36})\]\]/i.exec(text)?.[1];
  if (!id || random() * 100 >= config.stickers.probability) return;
  try {
    const list = stickersSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(resolveStateDir(), "bridge-stickers.json"),
          "utf8",
        ),
      ),
    );
    const sticker = list.find((s) => s.id === id);
    if (!sticker) return;
    stickerTimes.set(key, now); // reserve before upload; failed uploads do not trigger a retry storm
    return path.join(
      resolveStateDir(),
      "bridge-stickers",
      `${sticker.id}.${sticker.extension}`,
    );
  } catch {
    return;
  }
}
export function quietNow(start: string, end: string, date: Date) {
  if (start === end) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  const parse = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
  const a = parse(start),
    b = parse(end);
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}
