import { copyFile, mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "@hono/zod-openapi";
import {
  readStickers,
  stickerSchema,
  writeBridgeJson,
} from "./bridge-behavior.js";

const packRoot = fileURLToPath(
  new URL("../../static/stickers/whale/", import.meta.url),
);
const marker = "bridge-whale-stickers-v4.json";
const newStickerId = "9c786dee-6910-41fc-a269-55d794879209";
const retiredIds = new Set([
  "9c786dee-6910-41fc-a269-55d794879101",
  "9c786dee-6910-41fc-a269-55d794879102",
  "9c786dee-6910-41fc-a269-55d794879103",
  "9c786dee-6910-41fc-a269-55d794879104",
  "9c786dee-6910-41fc-a269-55d794879201",
  "9c786dee-6910-41fc-a269-55d794879202",
  "9c786dee-6910-41fc-a269-55d794879203",
  "9c786dee-6910-41fc-a269-55d794879204",
]);
const packSchema = z.array(
  stickerSchema.extend({
    file: z.string().regex(/^[a-z][a-z0-9-]*\.(png|webp)$/),
  }),
);

// Call inside the library mutation queue. Keep the marker after deletion so
// removed defaults stay removed; importing this pack never enables sending.
export async function ensureDefaultStickers(root: string) {
  const existing = await readStickers(root);
  try {
    await readFile(path.join(root, marker));
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const pack = packSchema.parse(
    JSON.parse(await readFile(path.join(packRoot, "manifest.json"), "utf8")),
  );
  // Add only the new image on upgrade; preserve deletions from earlier packs.
  let seededPriorPack = false;
  for (const version of [2, 3]) {
    try {
      await readFile(path.join(root, `bridge-whale-stickers-v${version}.json`));
      seededPriorPack = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  // Only retire our exact bundled IDs, never user-imported pictures.
  const items = existing.filter((item) => !retiredIds.has(item.id));
  const added: string[] = [];
  const folder = path.join(root, "bridge-stickers");
  await mkdir(folder, { recursive: true });
  for (const { file, ...item } of pack) {
    if (seededPriorPack && item.id !== newStickerId) continue;
    if (items.length >= 24) break;
    if (items.some((existing) => existing.id === item.id)) continue;
    await copyFile(
      path.join(packRoot, file),
      path.join(folder, `${item.id}.${item.extension}`),
    );
    items.push(item);
    added.push(item.id);
  }
  await writeBridgeJson(root, "bridge-stickers.json", items);
  for (const item of existing.filter((entry) => retiredIds.has(entry.id))) {
    await unlink(path.join(folder, `${item.id}.${item.extension}`)).catch(
      (error) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
  }
  await writeBridgeJson(root, marker, { version: 4, added });
  return items;
}
