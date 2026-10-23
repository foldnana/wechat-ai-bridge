import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { pruneRuntimeDebugFiles } from "../../apps/desktop/scripts/lib/prune-runtime-debug.mjs";

it("removes only debug sidecars and preserves executable sources, assets and licenses", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-prune-"));
  try {
    for (const file of [
      "index.js",
      "index.ts",
      "index.d.ts",
      "LICENSE",
      "model.map",
      "native.node",
      "index.js.map",
      "native.pdb",
    ])
      await writeFile(join(root, file), "keep-or-debug");
    expect(await pruneRuntimeDebugFiles(root)).toEqual({ files: 2, bytes: 26 });
    expect(await readdir(root)).not.toContain("index.js.map");
    expect(await readFile(join(root, "LICENSE"), "utf8")).toBe("keep-or-debug");
    expect(await readdir(root)).toHaveLength(6);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
