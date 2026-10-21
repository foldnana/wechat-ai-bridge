import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateRuntimePluginDependencies } from "../../apps/desktop/scripts/lib/runtime-plugin-dependencies.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "bridge-plugin-deps-"));
  roots.push(root);
  const pluginRoot = path.join(root, "extensions", "openclaw-weixin");
  const modelRoot = path.join(root, "extensions", "nexu-runtime-model");
  await mkdir(pluginRoot, { recursive: true });
  await mkdir(modelRoot, { recursive: true });
  await writeFile(path.join(pluginRoot, "index.ts"), "export default {};\n");
  await writeFile(path.join(modelRoot, "index.js"), "export default {};\n");
  await writeJson(path.join(pluginRoot, "package.json"), {
    name: "@tencent-weixin/openclaw-weixin",
    dependencies: { zod: "4.3.6", "qrcode-terminal": "0.12.0" },
    devDependencies: { typescript: "^5.8.0" },
  });
  const install = async (
    name: string,
    version: string,
    parent = pluginRoot,
  ) => {
    const directory = path.join(parent, "node_modules", name);
    await writeJson(path.join(directory, "package.json"), {
      name,
      version,
      main: "index.cjs",
    });
    await writeFile(
      path.join(directory, "index.cjs"),
      "module.exports = {};\n",
    );
    return directory;
  };
  return {
    root,
    pluginRoot,
    modelRoot,
    install,
    validate: () =>
      validateRuntimePluginDependencies(
        path.join(root, "extensions"),
        "isolated fixture",
      ),
  };
}

describe("portable runtime plugin dependency checks", () => {
  it("accepts correct production dependencies outside the repository and a manifest-free model plugin", async () => {
    const fixtureState = await fixture();
    await fixtureState.install("zod", "4.3.6");
    await fixtureState.install("qrcode-terminal", "0.12.0");
    await expect(fixtureState.validate()).resolves.toBeUndefined();
  });

  it("rejects a missing local dependency even if Node can resolve the correct version from a parent", async () => {
    const fixtureState = await fixture();
    await fixtureState.install(
      "zod",
      "4.3.6",
      path.dirname(fixtureState.pluginRoot),
    );
    await fixtureState.install("qrcode-terminal", "0.12.0");
    const requireFromPlugin = createRequire(
      path.join(fixtureState.pluginRoot, "package.json"),
    );
    expect(requireFromPlugin.resolve("zod")).toContain(
      path.join("extensions", "node_modules", "zod"),
    );
    await expect(fixtureState.validate()).rejects.toThrow(
      "missing local dependency zod",
    );
  });

  it("rejects the wrong pinned Zod version instead of relying on repository compatibility", async () => {
    const fixtureState = await fixture();
    await fixtureState.install("zod", "3.25.76");
    await fixtureState.install("qrcode-terminal", "0.12.0");
    await expect(fixtureState.validate()).rejects.toThrow(
      "zod expected 4.3.6, found 3.25.76",
    );
  });

  it("rejects a local dependency symlink that relies on files outside the portable plugin", async () => {
    const fixtureState = await fixture();
    const external = await fixtureState.install(
      "zod",
      "4.3.6",
      fixtureState.root,
    );
    await fixtureState.install("qrcode-terminal", "0.12.0");
    await symlink(
      external,
      path.join(fixtureState.pluginRoot, "node_modules", "zod"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(fixtureState.validate()).rejects.toThrow(
      "dependency zod points outside the plugin's node_modules",
    );
  });

  it("checks every production dependency, including dynamically loaded QR support", async () => {
    const fixtureState = await fixture();
    await fixtureState.install("zod", "4.3.6");
    await expect(fixtureState.validate()).rejects.toThrow(
      "missing local dependency qrcode-terminal",
    );
  });

  it("rejects a present dependency manifest whose runtime entry is missing", async () => {
    const fixtureState = await fixture();
    const dependency = await fixtureState.install("zod", "4.3.6");
    await fixtureState.install("qrcode-terminal", "0.12.0");
    await rm(path.join(dependency, "index.cjs"));
    await expect(fixtureState.validate()).rejects.toThrow(
      "dependency zod entry cannot resolve",
    );
  });

  it("rejects an entry that escapes the plugin's local dependency package", async () => {
    const fixtureState = await fixture();
    const dependency = await fixtureState.install("zod", "4.3.6");
    await fixtureState.install("qrcode-terminal", "0.12.0");
    await writeFile(
      path.join(fixtureState.pluginRoot, "parent.cjs"),
      "module.exports = {};\n",
    );
    await writeJson(path.join(dependency, "package.json"), {
      version: "4.3.6",
      main: "../../parent.cjs",
    });
    await expect(fixtureState.validate()).rejects.toThrow(
      "dependency zod resolved outside its local package",
    );
  });

  it("does not allow a missing WeChat manifest to bypass dependency validation", async () => {
    const fixtureState = await fixture();
    await rm(path.join(fixtureState.pluginRoot, "package.json"));
    await expect(fixtureState.validate()).rejects.toThrow(
      "cannot read package.json",
    );
  });

  it("still rejects a missing model routing entry", async () => {
    const fixtureState = await fixture();
    await fixtureState.install("zod", "4.3.6");
    await fixtureState.install("qrcode-terminal", "0.12.0");
    await rm(path.join(fixtureState.modelRoot, "index.js"));
    await expect(fixtureState.validate()).rejects.toThrow(
      "nexu-runtime-model missing entry",
    );
  });
});
