import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "@hono/zod-openapi";
import { writeBridgeJson } from "./bridge-behavior.js";

export const contactIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const contactIndexSchema = z.object({
  id: contactIdSchema,
  accountHash: contactIdSchema,
  lastSeen: z.string().datetime(),
});
export const contactSettingsSchema = z.object({
  label: z.string().trim().max(40).default(""),
  nickname: z.string().trim().max(40).default(""),
  relationship: z.string().trim().max(200).default(""),
  instructions: z.string().trim().max(2000).default(""),
  memoryEnabled: z.boolean().default(false),
  memories: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  proactive: z.enum(["inherit", "off"]).default("inherit"),
  topicMode: z.enum(["inherit", "recent", "greeting"]).default("inherit"),
});
export const contactProfileSchema = z.object({
  revision: z.string().min(1).max(80),
  settings: contactSettingsSchema,
});
export async function readContact(root: string, id: string) {
  contactIdSchema.parse(id);
  const index = contactIndexSchema.parse(
    JSON.parse(
      await readFile(
        path.join(root, "bridge-contact-index", `${id}.json`),
        "utf8",
      ),
    ),
  );
  if (index.id !== id) throw new Error("Invalid contact index");
  return index;
}
export async function readContactProfile(root: string, id: string) {
  contactIdSchema.parse(id);
  try {
    return contactProfileSchema.parse(
      JSON.parse(
        await readFile(
          path.join(root, "bridge-contact-profiles", `${id}.json`),
          "utf8",
        ),
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { revision: "initial", settings: contactSettingsSchema.parse({}) };
    throw error;
  }
}
export async function saveContactProfile(
  root: string,
  id: string,
  settings: z.infer<typeof contactSettingsSchema>,
) {
  contactIdSchema.parse(id);
  const profile = { revision: randomUUID(), settings };
  await writeBridgeJson(
    path.join(root, "bridge-contact-profiles"),
    `${id}.json`,
    profile,
  );
  return profile;
}
export async function listContacts(root: string) {
  let files: string[];
  try {
    files = await readdir(path.join(root, "bridge-contact-index"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const contacts = await Promise.all(
    files
      .filter((file) => /^[a-f0-9]{64}\.json$/.test(file))
      .map(async (file) => {
        const index = await readContact(root, file.slice(0, -5));
        const { settings } = await readContactProfile(root, index.id);
        return {
          ...index,
          label: settings.label || `微信会话 ${index.id.slice(0, 6)}`,
          memoryCount: settings.memories.length,
          memoryEnabled: settings.memoryEnabled,
        };
      }),
  );
  return contacts.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}
