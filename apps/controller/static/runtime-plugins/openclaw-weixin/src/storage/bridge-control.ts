import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "./state-dir.js";

export function bridgeControlVersion(): string {
  try { return readFileSync(path.join(resolveStateDir(), "bridge-control.json"), "utf8"); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "initial" : "unreadable"; }
}

export function bridgeRepliesPaused(): boolean {
  try {
    const value = JSON.parse(readFileSync(path.join(resolveStateDir(), "bridge-control.json"), "utf8"));
    return value.paused !== false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}
