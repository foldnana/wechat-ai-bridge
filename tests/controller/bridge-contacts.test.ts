import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "#controller/app/container";
import { createApp } from "#controller/app/create-app";
import { contactSettingsSchema } from "#controller/services/bridge-contacts";
import {
  contactPrompt,
  loadContact,
  observeContact,
} from "../../apps/controller/static/runtime-plugins/openclaw-weixin/src/storage/bridge-contacts";
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bridge-contacts-"));
  dirs.push(root);
  vi.stubEnv("OPENCLAW_STATE_DIR", root);
  const app = createApp({
    env: { openclawStateDir: root, webUrl: "http://localhost:5173" },
  } as ControllerContainer);
  observeContact("account-a", "private-peer");
  const [item] = await (await app.request("/api/v1/bridge/contacts")).json();
  const endpoint = `/api/v1/bridge/contacts/${item.id}`;
  const put = (revision: string, settings: unknown) =>
    app.request(endpoint, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision, settings }),
    });
  return { root, app, item, endpoint, put };
}
describe("local per-contact preferences and explicit memory", () => {
  it("separates local edits from reply invalidation and cannot restore a cleared reply revision", async () => {
    const f = await setup();
    const settings = contactSettingsSchema.parse({
      memoryEnabled: true,
      memories: ["记忆"],
    });
    const first = await (await f.put("initial", settings)).json();
    const renamed = await (
      await f.put(first.revision, { ...settings, label: "本地备注" })
    ).json();
    expect(renamed.revision).not.toBe(first.revision);
    expect(renamed.replyRevision).toBe(first.replyRevision);
    const cleared = await (
      await f.app.request(`${f.endpoint}/memories`, { method: "DELETE" })
    ).json();
    expect(cleared.replyRevision).not.toBe(first.replyRevision);
    const restored = await (await f.put(cleared.revision, settings)).json();
    expect(restored.replyRevision).not.toBe(first.replyRevision);
  });
  it("registers only hashed identifiers and isolates the same peer across accounts", async () => {
    const f = await setup();
    observeContact("account-b", "private-peer");
    const list = await (await f.app.request("/api/v1/bridge/contacts")).json();
    expect(list).toHaveLength(2);
    expect(list[0].id).not.toBe(list[1].id);
    const files = await readdir(path.join(f.root, "bridge-contact-index"));
    for (const file of files)
      expect(
        await readFile(path.join(f.root, "bridge-contact-index", file), "utf8"),
      ).not.toContain("private-peer");
    expect(
      loadContact("account-a", "private-peer")?.settings.memoryEnabled,
    ).toBe(false);
  });
  it("applies edited memories only when enabled and prevents stale writes from restoring cleared data", async () => {
    const f = await setup();
    const settings = contactSettingsSchema.parse({
      label: "仅本机备注",
      nickname: "小明",
      memories: ["不喜欢剧透"],
      memoryEnabled: false,
    });
    const first = await (await f.put("initial", settings)).json();
    expect(
      contactPrompt(loadContact("account-a", "private-peer")),
    ).not.toContain("不喜欢剧透");
    const second = await (
      await f.put(first.revision, { ...settings, memoryEnabled: true })
    ).json();
    expect(contactPrompt(loadContact("account-a", "private-peer"))).toContain(
      "不喜欢剧透",
    );
    expect(
      contactPrompt(loadContact("account-a", "private-peer")),
    ).not.toContain("仅本机备注");
    expect(contactPrompt(loadContact("account-b", "private-peer"))).toBe("");
    const cleared = await (
      await f.app.request(`${f.endpoint}/memories`, { method: "DELETE" })
    ).json();
    expect(cleared.settings).toMatchObject({
      nickname: "小明",
      memories: [],
      memoryEnabled: false,
    });
    expect(
      (await f.put(second.revision, { ...settings, memoryEnabled: true }))
        .status,
    ).toBe(409);
    const saved = await readFile(
      path.join(f.root, "bridge-contact-profiles", `${f.item.id}.json`),
      "utf8",
    );
    expect(saved).not.toContain("不喜欢剧透");
    expect(
      contactPrompt(loadContact("account-a", "private-peer")),
    ).not.toContain("不喜欢剧透");
  });
  it("rejects unknown contacts, oversized memories and traversal paths", async () => {
    const f = await setup();
    expect(
      (await f.put("initial", { memories: ["x".repeat(301)] })).status,
    ).toBe(400);
    expect(
      (await f.put("initial", { memories: Array(21).fill("note") })).status,
    ).toBe(400);
    expect(
      (await f.app.request(`/api/v1/bridge/contacts/${"a".repeat(64)}`)).status,
    ).toBe(404);
    expect(
      (await f.app.request("/api/v1/bridge/contacts/not-a-hash")).status,
    ).toBe(400);
  });
});
