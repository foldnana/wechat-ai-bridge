import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, relative, resolve } from "node:path";

const requiredPlugins = [
  { id: "openclaw-weixin", entry: "index.ts", manifestRequired: true },
  { id: "nexu-runtime-model", entry: "index.js", manifestRequired: false },
];

function isWithin(parent, child) {
  const result = relative(parent, child);
  return result === "" || (!result.startsWith("..") && !isAbsolute(result));
}

async function requireFile(file, message) {
  try {
    if ((await stat(file)).isFile()) return;
  } catch {
    // Use the same actionable build failure for missing or inaccessible files.
  }
  throw new Error(`${message}: ${file}`);
}

/** Validate the portable plugin tree that will be copied into the user's state. */
export async function validateRuntimePluginDependencies(rootDir, label) {
  for (const plugin of requiredPlugins) {
    const pluginRoot = resolve(rootDir, plugin.id);
    const prefix = `[runtime-plugins] ${label}: ${plugin.id}`;
    await requireFile(
      resolve(pluginRoot, plugin.entry),
      `${prefix} missing entry`,
    );

    const manifestPath = resolve(pluginRoot, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      // The explicitly dependency-free model routing plugin has no package file.
      if (!plugin.manifestRequired && error.code === "ENOENT") continue;
      throw new Error(`${prefix} cannot read package.json`, { cause: error });
    }

    const requireFromPlugin = createRequire(manifestPath);
    const localModules = resolve(await realpath(pluginRoot), "node_modules");
    for (const [name, expectedVersion] of Object.entries(
      manifest.dependencies ?? {},
    )) {
      const dependencyRoot = resolve(pluginRoot, "node_modules", name);
      if (!isWithin(resolve(pluginRoot, "node_modules"), dependencyRoot)) {
        throw new Error(`${prefix} invalid dependency name: ${name}`);
      }
      const dependencyManifestPath = resolve(dependencyRoot, "package.json");
      await requireFile(
        dependencyManifestPath,
        `${prefix} missing local dependency ${name}`,
      );
      const actualRoot = await realpath(dependencyRoot);
      if (!isWithin(localModules, actualRoot)) {
        throw new Error(
          `${prefix} dependency ${name} points outside the plugin's node_modules`,
        );
      }
      const dependencyManifest = JSON.parse(
        await readFile(dependencyManifestPath, "utf8"),
      );
      // Pinned production dependencies must not silently resolve another version
      // from the controller or the developer's repository node_modules.
      if (
        /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(expectedVersion) &&
        dependencyManifest.version !== expectedVersion
      ) {
        throw new Error(
          `${prefix} dependency ${name} expected ${expectedVersion}, found ${dependencyManifest.version}`,
        );
      }
      let entry;
      try {
        entry = await realpath(requireFromPlugin.resolve(name));
      } catch (error) {
        throw new Error(`${prefix} dependency ${name} entry cannot resolve`, {
          cause: error,
        });
      }
      if (!isWithin(actualRoot, entry)) {
        throw new Error(
          `${prefix} dependency ${name} resolved outside its local package`,
        );
      }
    }
  }
}
