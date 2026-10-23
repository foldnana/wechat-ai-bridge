import type { WeixinMessage } from "../api/types.js";
import { incomingWaitMs } from "./bridge-incoming-rhythm.js";

type Batch = {
  messages: WeixinMessage[];
  text: string[];
  started: number;
  lastAdded: number;
  version: string;
  timer: ReturnType<typeof setTimeout>;
};
type Job = { message: WeixinMessage; version: string };
/** One account owns an inbox. Polling continues while a single serialized worker replies. */
export class BridgeInbox {
  private pending = new Map<string, Batch>();
  private jobs: Job[] = [];
  private running = false;
  private closed = false;
  private waiters: Array<() => void> = [];
  constructor(
    private options: {
      waitMs: () => number;
      automatic?: () => boolean;
      version: () => string;
      paused: () => boolean;
      run: (message: WeixinMessage, valid: () => boolean) => Promise<unknown>;
      error: () => void;
    },
  ) {}
  get idle() {
    return !this.running && !this.pending.size && !this.jobs.length;
  }
  private notify() {
    if (this.idle) for (const resolve of this.waiters.splice(0)) resolve();
  }
  async settled() {
    if (!this.idle)
      await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  private flush(peer: string) {
    const batch = this.pending.get(peer);
    if (!batch) return;
    clearTimeout(batch.timer);
    this.pending.delete(peer);
    const last = batch.messages[batch.messages.length - 1]!;
    this.jobs.push({
      version: batch.version,
      message:
        batch.messages.length === 1
          ? last
          : {
              ...last,
              context_token: [...batch.messages]
                .reverse()
                .find((m) => m.context_token)?.context_token,
              item_list: [
                { type: 1, text_item: { text: batch.text.join("\n") } },
              ],
            },
    });
    void this.drain();
  }
  async add(message: WeixinMessage) {
    // Backpressure rather than silently dropping an arbitrary queue tail.
    if (this.jobs.length + this.pending.size >= 100) await this.settled();
    if (this.closed || this.options.paused()) return;
    const peer = message.from_user_id ?? "";
    const items = message.item_list;
    const text = items?.[0]?.text_item?.text;
    const automatic = this.options.automatic?.() === true;
    const now = Date.now();
    const previousBatch = this.pending.get(peer);
    const waitMs = automatic
      ? incomingWaitMs(text ?? "", previousBatch ? now - previousBatch.lastAdded : undefined)
      : this.options.waitMs();
    const maxWaitMs = automatic ? 20000 : 90000;
    const version = this.options.version();
    const mergeable =
      peer &&
      waitMs > 0 &&
      items?.length === 1 &&
      items[0]?.type === 1 &&
      !items[0].ref_msg &&
      typeof text === "string" &&
      text.trim() &&
      !text.trimStart().startsWith("/") &&
      !message.group_id;
    const previous = this.pending.get(peer);
    if (
      previous &&
      (previous.version !== version ||
        previous.messages[0]?.session_id !== message.session_id ||
        previous.messages.length >= 20 ||
        previous.text.join("\n").length + (text?.length ?? 0) > 12000)
    )
      this.flush(peer);
    if (!mergeable) {
      this.flush(peer);
      this.jobs.push({ message, version });
      void this.drain();
      return;
    }
    const batch = this.pending.get(peer);
    if (batch) {
      clearTimeout(batch.timer);
      batch.messages.push(message);
      batch.text.push(text);
      batch.lastAdded = now;
      batch.timer = setTimeout(
        () => this.flush(peer),
        Math.max(0, Math.min(waitMs, maxWaitMs - (now - batch.started))),
      );
    } else {
      this.pending.set(peer, {
        messages: [message],
        text: [text],
        started: now,
        lastAdded: now,
        version,
        timer: setTimeout(() => this.flush(peer), waitMs),
      });
    }
  }
  async runWhenIdle(work: () => Promise<void>) {
    if (!this.idle || this.closed || this.options.paused()) return;
    this.running = true;
    try {
      await work();
    } catch {
      this.options.error();
    } finally {
      this.running = false;
      void this.drain();
      this.notify();
    }
  }
  private async drain() {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      while (this.jobs.length && !this.closed) {
        const job = this.jobs.shift()!;
        if (this.options.paused() || job.version !== this.options.version())
          continue;
        try {
          await this.options.run(
            job.message,
            () =>
              !this.closed &&
              !this.options.paused() &&
              job.version === this.options.version(),
          );
        } catch {
          this.options.error();
        }
      }
    } finally {
      this.running = false;
      this.notify();
    }
  }
  close() {
    this.closed = true;
    for (const batch of this.pending.values()) clearTimeout(batch.timer);
    this.pending.clear();
    this.jobs = [];
    this.notify();
  }
}
