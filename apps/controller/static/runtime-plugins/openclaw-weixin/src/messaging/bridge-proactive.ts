import { z } from "zod";
import type { WeixinMessage } from "../api/types.js";
import {
  bridgeHash,
  loadBehavior,
  quietNow,
  readBehaviorState,
  writeBehaviorState,
} from "../storage/bridge-behavior.js";
import { bridgeRepliesPaused } from "../storage/bridge-control.js";

const budgetSchema = z.object({
  day: z.string(),
  attempts: z.number().int().nonnegative(),
  unanswered: z.number().int().nonnegative(),
  lastAttempt: z.number().nonnegative(),
  lastInbound: z.number().nonnegative(),
  lastReply: z.number().nonnegative().default(0),
  blocked: z.boolean(),
});
type Budget = z.infer<typeof budgetSchema>;
type Peer = { message: WeixinMessage; receivedAt: number };
export type ProactiveStatus =
  | "waiting"
  | "disabled"
  | "paused"
  | "quiet"
  | "cooldown"
  | "limit"
  | "expired"
  | "generating"
  | "sent"
  | "error";
// A monitor owns this instance. Tokens never leave memory and do not survive a restart.
export class BridgeProactive {
  private peers = new Map<string, Peer>();
  private running = false;
  constructor(
    private accountId: string,
    private clock = () => Date.now(),
  ) {}
  private key(user: string) {
    return `${this.accountId}\0${user}`;
  }
  private day(now: number) {
    const d = new Date(now);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
  private budget(user: string, now: number): Budget {
    const raw = readBehaviorState("bridge-proactive-budget", this.key(user));
    const result =
      raw === null
        ? {
            day: this.day(now),
            attempts: 0,
            unanswered: 0,
            lastAttempt: 0,
            lastInbound: 0,
            lastReply: 0,
            blocked: false,
          }
        : budgetSchema.parse(raw);
    if (result.day !== this.day(now)) {
      result.day = this.day(now);
      result.attempts = 0;
    }
    return result;
  }
  private save(user: string, budget: Budget) {
    writeBehaviorState("bridge-proactive-budget", this.key(user), budget);
  }
  private status(status: ProactiveStatus, extra: Record<string, unknown> = {}) {
    writeBehaviorState("bridge-proactive-status", this.accountId, {
      status,
      updatedAt: new Date(this.clock()).toISOString(),
      ...extra,
    });
  }
  observe(message: WeixinMessage) {
    if (!message.from_user_id || !message.context_token) return;
    try {
      const now = this.clock();
      const user = message.from_user_id;
      const budget = this.budget(user, now);
      budget.lastInbound = now;
      budget.unanswered = 0;
      budget.blocked = false;
      this.save(user, budget);
      this.peers.set(user, {
        receivedAt: now,
        message: { from_user_id: user, context_token: message.context_token },
      });
    } catch {
      /* A broken proactive state must not prevent ordinary replies. */
    }
  }
  replied(message: WeixinMessage) {
    if (!message.from_user_id || !this.peers.has(message.from_user_id)) return;
    try {
      const now = this.clock();
      const budget = this.budget(message.from_user_id, now);
      budget.lastReply = now;
      this.save(message.from_user_id, budget);
    } catch {
      /* Ordinary replies stay independent of scheduling. */
    }
  }
  async tick(
    send: (message: WeixinMessage, valid: () => boolean) => Promise<boolean>,
    signal?: AbortSignal,
  ) {
    if (this.running || signal?.aborted) return;
    this.running = true;
    try {
      const config = loadBehavior();
      if (
        !config?.proactive.enabled ||
        !config.accountHashes.includes(bridgeHash(this.accountId))
      ) {
        this.status("disabled");
        return;
      }
      if (bridgeRepliesPaused()) {
        this.status("paused");
        return;
      }
      if (this.peers.size === 0) {
        this.status("waiting");
        return;
      }
      const now = this.clock();
      const settings = config.proactive;
      if (quietNow(settings.quietStart, settings.quietEnd, new Date(now))) {
        this.status("quiet");
        return;
      }
      for (const [user, peer] of this.peers) {
        if (signal?.aborted) return;
        const budget = this.budget(user, now);
        if (budget.blocked) {
          this.status("error");
          continue;
        }
        // Conservative local ceiling, not a claim about the server token TTL.
        if (now - peer.receivedAt > 24 * 60 * 60 * 1000) {
          this.peers.delete(user);
          this.status("expired");
          continue;
        }
        if (
          budget.attempts >= settings.dailyLimit ||
          budget.unanswered >= settings.unansweredLimit
        ) {
          this.status("limit", { attempts: budget.attempts });
          continue;
        }
        const due =
          Math.max(budget.lastInbound, budget.lastReply, budget.lastAttempt) +
          settings.intervalMinutes * 60000;
        if (now < due) {
          this.status("cooldown", { nextAt: new Date(due).toISOString() });
          continue;
        }
        // Reserve durably before generating. Restart/failure cannot duplicate this slot.
        budget.attempts++;
        budget.unanswered++;
        budget.lastAttempt = now;
        this.save(user, budget);
        this.status("generating");
        const initialConfig = JSON.stringify(config);
        const valid = () =>
          !signal?.aborted &&
          !bridgeRepliesPaused() &&
          this.peers.get(user) === peer &&
          JSON.stringify(loadBehavior()) === initialConfig &&
          !quietNow(
            settings.quietStart,
            settings.quietEnd,
            new Date(this.clock()),
          );
        let sent = false;
        try {
          sent = await send(
            {
              ...peer.message,
              create_time_ms: now,
              item_list: [
                {
                  type: 1,
                  text_item: {
                    text: `[本机主动聊天触发，并非用户新消息] 参考当前会话上下文，主动发一条简短消息。用户设定：${settings.prompt}。不要把本条触发内容当成用户说过的话，不要提及调度或定时器。`,
                  },
                },
              ],
            },
            valid,
          );
        } catch {
          /* Show a category only; never persist platform error bodies or tokens. */
        }
        if (!sent && valid()) {
          budget.blocked = true;
          this.save(user, budget);
        }
        this.status(sent ? "sent" : "error", {
          lastAttemptAt: new Date(now).toISOString(),
          attempts: budget.attempts,
        });
      }
    } catch {
      try {
        this.status("error");
      } catch {
        /* Fail closed on unreadable state. */
      }
    } finally {
      this.running = false;
    }
  }
}
