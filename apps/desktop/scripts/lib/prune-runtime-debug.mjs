import { lstat, readdir, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

// Only disposable debugging sidecars; keep JS, TypeScript runtime sources,
// declarations, native binaries, assets and license notices intact.
export async function pruneRuntimeDebugFiles(root) {
  const base = resolve(root);
  const rootStat = await lstat(base);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error("Runtime pruning requires a real staging directory");
  let files = 0;
  let bytes = 0;
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name);
      const rel = relative(base, target);
      if (rel.startsWith("..") || isAbsolute(rel))
        throw new Error("Debug pruning escaped runtime directory");
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(target);
      else if (
        entry.isFile() &&
        (/\.(?:[cm]?js|[cm]?ts|css)\.map$/i.test(entry.name) ||
          /\.pdb$/i.test(entry.name))
      ) {
        const stat = await lstat(target);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        await unlink(target);
        files++;
        bytes += stat.size;
      }
    }
  }
  await visit(base);
  return { files, bytes };
}
