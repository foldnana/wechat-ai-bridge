import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "./state-dir.js";

type Activity = {
  runId: string;
  receivedAt: string;
  generatedAt: string | null;
  sentAt: string | null;
  lastSuccessfulReplyAt: string | null;
  error: "generation" | "send" | null;
};
const latest = new Map<string, Activity>();

/** Local status only: no message text, peer identity, API key or context token. */
export function beginBridgeActivity(accountId: string) {
  const directory = path.join(resolveStateDir(), "bridge-activity");
  const file = path.join(
    directory,
    `${createHash("sha256").update(accountId).digest("hex")}.json`,
  );
  let previous = latest.get(accountId)?.lastSuccessfulReplyAt ?? null;
  if (!previous) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (typeof parsed.lastSuccessfulReplyAt === "string") previous = parsed.lastSuccessfulReplyAt;
    } catch { /* No activity yet. */ }
  }
  const activity: Activity = {
    runId: randomUUID(),
    receivedAt: new Date().toISOString(),
    generatedAt: null,
    sentAt: null,
    lastSuccessfulReplyAt: previous,
    error: null,
  };
  latest.set(accountId, activity);
  const persist = (snapshot = activity) => {
    if (latest.get(accountId) !== snapshot) return;
    try {
      mkdirSync(directory, { recursive: true });
      const temp = `${file}.tmp`;
      writeFileSync(temp, JSON.stringify(snapshot), { mode: 0o600 });
      renameSync(temp, file);
    } catch { /* A status write must never break message delivery. */ }
  };
  persist();
  return {
    generated() {
      activity.generatedAt = new Date().toISOString();
      persist();
    },
    sent() {
      activity.sentAt = new Date().toISOString();
      activity.lastSuccessfulReplyAt = activity.sentAt;
      // A slower previous message can still update the last successful time.
      const current = latest.get(accountId);
      if (current && current !== activity) current.lastSuccessfulReplyAt = activity.sentAt;
      persist(current ?? activity);
    },
    failed(stage: "generation" | "send") {
      if (!activity.error || stage === "send") activity.error = stage;
      persist();
    },
  };
}
