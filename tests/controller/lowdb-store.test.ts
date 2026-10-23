import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { LowDbStore } from "../../apps/controller/src/store/lowdb-store.js";

const schema = z.object({ model: z.string(), preset: z.string() });
const defaults = () => ({ model: "original", preset: "original" });
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bridge-store-audit-"));
  roots.push(root);
  const file = path.join(root, "config.json");
  return { file, store: new LowDbStore(file, schema, defaults) };
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("configuration durability", () => {
  it("preserves concurrent changes to different settings on first use", async () => {
    const { store, file } = await fixture();
    await Promise.all([
      store.update((value) => ({ ...value, model: "new-model" })),
      store.update((value) => ({ ...value, preset: "new-preset" })),
    ]);
    expect(await store.read()).toEqual({
      model: "new-model",
      preset: "new-preset",
    });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(
      await store.read(),
    );
  });

  it("allows retry after a failed disk write", async () => {
    const { store, file } = await fixture();
    await store.read();
    await mkdir(`${file}.tmp`);
    await expect(
      store.update((value) => ({ ...value, model: "failed" })),
    ).rejects.toThrow();
    await rm(`${file}.tmp`, { recursive: true });
    await store.update((value) => ({ ...value, preset: "retry-succeeded" }));
    expect(await store.read()).toEqual({
      model: "original",
      preset: "retry-succeeded",
    });
  });

  it("does not mutate cached settings when an updater fails", async () => {
    const { store } = await fixture();
    await store.read();
    await expect(
      store.update((value) => {
        value.model = "uncommitted";
        throw new Error("failed update");
      }),
    ).rejects.toThrow("failed update");
    expect((await store.read()).model).toBe("original");
  });

  it("recovers a valid backup", async () => {
    const { store, file } = await fixture();
    await writeFile(file, "broken");
    await writeFile(
      `${file}.bak`,
      JSON.stringify({ model: "saved", preset: "keep" }),
    );
    expect(await store.read()).toEqual({ model: "saved", preset: "keep" });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(
      await store.read(),
    );
  });

  it("preserves corrupt files instead of silently replacing user configuration", async () => {
    const { store, file } = await fixture();
    await writeFile(file, "broken-primary");
    await writeFile(`${file}.bak`, "broken-backup");
    await expect(store.read()).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("broken-primary");
    expect(await readFile(`${file}.bak`, "utf8")).toBe("broken-backup");
  });
});
